import React, { useCallback, useEffect, useMemo, useState } from 'react';
import Header from '../components/Header';
import { PRODUCT_NAME } from '../branding';
import { fetchKmsItems, saveKmsConfig, buildKmsIndex, fetchEvalItemDefs } from '../services/api';
import { Plus, Save, Trash2, AlertTriangle, CheckCircle2, Info, X, Database, FileText } from 'lucide-react';

// ============================================================
// AI 평가항목 관리 > [KMS]
//
// 축은 **평가항목**이다. 항목을 KMS 로 지정하면 평가항목 관리 목록에 KMS 배지가 뜨고,
// 그 항목에 근거 문서를 붙인다. [RAG 색인] 이 문서를 임베딩해 검색 대상으로 만든다.
//
//  · [평가항목 문서] 탭 — 항목별 KMS 지정 + 근거 문서 등록 + 색인
//  · [업무 데이터] 탭  — 업무별 필수 확인정보·복창·필수안내(짧은 참조표. 문서와 별개 채널)
//
// 영속화: qa_batch_configs.config.kms { marked_items[], docs[], items[] }
//   (전용 테이블 없음 — DDL 금지 원칙, golden/skill 키와 형제)
//
// ★ 색인 엔드포인트는 파이프라인 측 신설 대기 중이다. 색인기 자체는 존재하나 CLI 전용
//   (`v2/scripts/bootstrap_aoss_qa.py::_index_business_knowledge`). [RAG 색인] 을 누르면
//   파이프라인 응답을 그대로 표면화한다 — 미구현이면 그 사유가 화면에 보인다.
// ============================================================

const EMPTY_TASK = {
    task: '',
    confirm_info: [],
    readback: false,
    mandatory_notice: [],
    linked_items: [],
    active: true,
    note: '',
};

const EMPTY_DOC = { title: '', body: '', tags: [], linked_items: [], active: true };

// 확인정보·태그 = 짧은 토큰 → 줄바꿈·콤마·가운뎃점 모두 구분자(원천 표가 ' · ' 구분).
const parseTokens = (s) =>
    String(s || '')
        .split(/[\n,·]/)
        .map((t) => t.trim())
        .filter(Boolean);

// 필수안내 = 문장 → 줄바꿈만 구분자(문장 안의 가운뎃점 보호).
const parseLines = (s) =>
    String(s || '')
        .split('\n')
        .map((t) => t.trim())
        .filter(Boolean);

const joinLines = (a) => (Array.isArray(a) ? a : []).join('\n');

const fmtTime = (iso) => {
    if (!iso) return null;
    try {
        const d = new Date(iso);
        if (Number.isNaN(d.getTime())) return null;
        const p = (n) => String(n).padStart(2, '0');
        return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
    } catch {
        return null;
    }
};

const Banner = ({ kind, children, onClose }) => {
    const tone =
        kind === 'error'
            ? 'border-[#FDA29B] bg-[#FEF3F2] text-[#B42318]'
            : kind === 'warn'
              ? 'border-[#FEC84B] bg-[#FFFCF5] text-[#B54708]'
              : 'border-[var(--border)] bg-white text-[var(--ink-700)]';
    const IconEl = kind === 'error' ? AlertTriangle : kind === 'warn' ? AlertTriangle : CheckCircle2;
    return (
        <div className={`mb-4 flex items-start gap-2 px-4 py-3 rounded-lg border ${tone}`}>
            <IconEl size={15} className="mt-0.5 shrink-0" />
            <div className="text-[12.5px] flex-1 leading-relaxed whitespace-pre-line">{children}</div>
            {onClose && (
                <button type="button" onClick={onClose} aria-label="닫기" className="opacity-60 hover:opacity-100">
                    <X size={14} />
                </button>
            )}
        </div>
    );
};

const KmsItems = ({ activeBrandId, topOffset = 0 }) => {
    const [mode, setMode] = useState('docs');       // 'docs' | 'tasks'
    const [defs, setDefs] = useState([]);
    const [marks, setMarks] = useState([]);         // KMS 지정 평가항목 order_no
    const [docs, setDocs] = useState([]);
    const [tasks, setTasks] = useState([]);
    const [indexedAt, setIndexedAt] = useState(null);

    const [selItem, setSelItem] = useState(null);   // order_no
    const [selDoc, setSelDoc] = useState(null);     // docs 인덱스
    const [selTask, setSelTask] = useState(null);   // tasks 인덱스

    const [dirty, setDirty] = useState(false);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [indexing, setIndexing] = useState(false);
    const [err, setErr] = useState('');
    const [toast, setToast] = useState(null);
    const [scoped, setScoped] = useState(true);

    const load = useCallback(async () => {
        setLoading(true);
        setErr('');
        try {
            const [kms, defRes] = await Promise.all([
                fetchKmsItems(),
                // 항목 목록 로드 실패해도 문서 편집은 계속 가능해야 한다.
                fetchEvalItemDefs().catch(() => null),
            ]);
            setTasks(Array.isArray(kms?.items) ? kms.items : []);
            setMarks(Array.isArray(kms?.marked_items) ? kms.marked_items : []);
            setDocs(Array.isArray(kms?.docs) ? kms.docs : []);
            setIndexedAt(kms?.indexed_at ?? null);
            setScoped(!!kms?.org_id);
            const rows = Array.isArray(defRes) ? defRes : defRes?.items || [];
            setDefs(rows.filter((r) => r && r.order_no != null));
            setSelItem(null);
            setSelDoc(null);
            setSelTask(null);
            setDirty(false);
        } catch (e) {
            setErr(String(e?.message || e));
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        load();
    }, [load, activeBrandId]);

    const docsByItem = useMemo(() => {
        const m = new Map();
        docs.forEach((d, i) => {
            (d.linked_items || []).forEach((no) => {
                if (!m.has(no)) m.set(no, []);
                m.get(no).push(i);
            });
        });
        return m;
    }, [docs]);

    // 연결 항목이 하나도 없는 문서 — 색인돼도 어떤 항목에도 주입되지 않는다.
    const orphanDocs = useMemo(() => docs.filter((d) => !(d.linked_items || []).length).length, [docs]);
    const activeDocs = useMemo(() => docs.filter((d) => d.active !== false).length, [docs]);
    const totalChars = useMemo(() => docs.reduce((a, d) => a + String(d.body || '').length, 0), [docs]);

    const currentDoc = selDoc != null ? docs[selDoc] : null;
    const currentTask = selTask != null ? tasks[selTask] : null;

    const patchDoc = (changes) => {
        setDocs((prev) => prev.map((d, i) => (i === selDoc ? { ...d, ...changes } : d)));
        setDirty(true);
    };
    const patchTask = (changes) => {
        setTasks((prev) => prev.map((t, i) => (i === selTask ? { ...t, ...changes } : t)));
        setDirty(true);
    };

    const toggleMark = (no) => {
        setMarks((prev) => (prev.includes(no) ? prev.filter((n) => n !== no) : [...prev, no].sort((a, b) => a - b)));
        setDirty(true);
    };

    const addDoc = () => {
        // 항목 선택 상태에서 추가하면 그 항목에 자동 연결 — 연결 누락(고아 문서) 방지.
        const linked = selItem != null ? [selItem] : [];
        setDocs((prev) => [...prev, { ...EMPTY_DOC, linked_items: linked }]);
        setSelDoc(docs.length);
        setDirty(true);
    };
    const removeDoc = () => {
        if (selDoc == null) return;
        setDocs((prev) => prev.filter((_, i) => i !== selDoc));
        setSelDoc(null);
        setDirty(true);
    };
    const addTask = () => {
        setTasks((prev) => [...prev, { ...EMPTY_TASK }]);
        setSelTask(tasks.length);
        setDirty(true);
    };
    const removeTask = () => {
        if (selTask == null) return;
        setTasks((prev) => prev.filter((_, i) => i !== selTask));
        setSelTask(null);
        setDirty(true);
    };

    const dupTasks = useMemo(() => {
        const seen = new Set();
        const dup = new Set();
        tasks.forEach((t) => {
            const k = String(t.task || '').trim();
            if (!k) return;
            if (seen.has(k)) dup.add(k);
            seen.add(k);
        });
        return dup;
    }, [tasks]);

    const dupDocs = useMemo(() => {
        const seen = new Set();
        const dup = new Set();
        docs.forEach((d) => {
            const k = String(d.title || '').trim();
            if (!k) return;
            if (seen.has(k)) dup.add(k);
            seen.add(k);
        });
        return dup;
    }, [docs]);

    const onSave = async () => {
        setSaving(true);
        setErr('');
        try {
            const res = await saveKmsConfig({ items: tasks, marked_items: marks, docs });
            setTasks(Array.isArray(res?.items) ? res.items : tasks);
            setMarks(Array.isArray(res?.marked_items) ? res.marked_items : marks);
            setDocs(Array.isArray(res?.docs) ? res.docs : docs);
            setDirty(false);
            setSelDoc(null);
            setSelTask(null);
            const dropped = Number(res?.dropped || 0);
            setToast(
                `저장 완료 — 문서 ${res?.docs?.length ?? docs.length}건 · 업무 ${res?.items?.length ?? tasks.length}건 · KMS 지정 ${(res?.marked_items || marks).length}항목` +
                    (dropped > 0 ? `\n${dropped}건 제외(제목/업무명 없음 · 중복 · 본문 총량 초과)` : '')
            );
        } catch (e) {
            setErr(String(e?.message || e));
        } finally {
            setSaving(false);
        }
    };

    const onBuild = async () => {
        setIndexing(true);
        setErr('');
        try {
            const res = await buildKmsIndex();
            setIndexedAt(res?.indexed_at ?? null);
            setToast(`RAG 색인 완료 — 문서 ${res?.docs ?? activeDocs}건`);
        } catch (e) {
            setErr(`RAG 색인 실패 — ${String(e?.message || e)}`);
        } finally {
            setIndexing(false);
        }
    };

    const panelBox =
        'bg-white border border-[var(--border)] rounded-xl shadow-[0_1px_2px_rgba(16,24,40,0.04)] flex flex-col overflow-hidden';
    const sectionHead = 'px-5 py-3 border-b border-[var(--muted)] bg-[var(--background-soft)] flex items-center gap-2';
    const inputCls =
        'w-full px-3 py-2 rounded-lg border border-[var(--border-strong)] text-[13px] text-[var(--ink-900)] focus:outline-none focus:border-[var(--primary)]';
    const labelCls = 'block text-[12px] font-bold text-[var(--ink-700)] mb-1.5';

    return (
        <div className="pb-10 w-full">
            <Header
                title={`${PRODUCT_NAME} · KMS`}
                subtitle={
                    '평가항목을 KMS 로 지정하고 근거 문서를 등록합니다. 지정한 항목은 [평가항목 관리] 목록에 KMS 배지로 표시됩니다.\n' +
                    '[RAG 색인] 은 등록 문서를 임베딩해 검색 대상으로 만듭니다.'
                }
                actions={
                    <div className="flex items-center gap-2">
                        <button
                            type="button"
                            onClick={onBuild}
                            disabled={indexing || saving || !scoped || activeDocs === 0 || dirty}
                            title={
                                dirty
                                    ? '변경을 저장한 뒤 색인하세요'
                                    : activeDocs === 0
                                      ? '색인할 활성 문서가 없습니다'
                                      : '등록 문서를 임베딩해 RAG 검색 대상으로 만듭니다'
                            }
                            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold border transition-all ${
                                indexing || saving || !scoped || activeDocs === 0 || dirty
                                    ? 'bg-[var(--background-soft)] border-[var(--border)] text-[var(--ink-300)] cursor-not-allowed'
                                    : 'bg-white border-[var(--border-strong)] text-[var(--ink-700)] hover:bg-[var(--background-soft)] shadow-sm'
                            }`}
                        >
                            <Database size={15} />
                            {indexing ? '색인 중…' : 'RAG 색인'}
                        </button>
                        <button
                            type="button"
                            onClick={onSave}
                            disabled={!dirty || saving || !scoped}
                            className={`flex items-center gap-2 px-5 py-2 rounded-lg text-sm font-semibold shadow-sm transition-all ${
                                !dirty || saving || !scoped
                                    ? 'bg-[var(--background-soft)] border border-[var(--border)] text-[var(--ink-300)] cursor-not-allowed'
                                    : 'bg-[var(--primary)] text-white hover:opacity-90'
                            }`}
                        >
                            <Save size={15} />
                            {saving ? '저장 중…' : dirty ? '변경 저장' : '저장됨'}
                        </button>
                    </div>
                }
            />

            {/* 서브 탭 */}
            <div className="flex items-center gap-1 mb-4">
                {[
                    { key: 'docs', label: `평가항목 문서 (${docs.length})` },
                    { key: 'tasks', label: `업무 데이터 (${tasks.length})` },
                ].map((t) => {
                    const on = mode === t.key;
                    return (
                        <button
                            key={t.key}
                            type="button"
                            onClick={() => setMode(t.key)}
                            className={`px-3.5 py-1.5 rounded-lg text-[12.5px] font-semibold border transition-colors ${
                                on
                                    ? 'border-[var(--primary)] bg-[var(--primary-soft-flat)] text-[var(--primary)]'
                                    : 'border-[var(--border)] bg-white text-[var(--ink-500)] hover:text-[var(--ink-900)]'
                            }`}
                        >
                            {t.label}
                        </button>
                    );
                })}
                <span className="ml-auto text-[11.5px] text-[var(--ink-500)] tabular-nums">
                    활성 문서 {activeDocs} · 본문 {totalChars.toLocaleString()}자
                    {fmtTime(indexedAt) ? ` · 마지막 색인 ${fmtTime(indexedAt)}` : ' · 색인 이력 없음'}
                </span>
            </div>

            {!scoped && (
                <Banner kind="info">
                    브랜드를 선택하면 해당 브랜드의 KMS 를 등록할 수 있습니다. (전체 보기 상태에서는 저장·색인할 수 없습니다)
                </Banner>
            )}
            {err && (
                <Banner kind="error" onClose={() => setErr('')}>
                    {err}
                </Banner>
            )}
            {toast && (
                <Banner kind="ok" onClose={() => setToast(null)}>
                    {toast}
                </Banner>
            )}
            {orphanDocs > 0 && (
                <Banner kind="warn">
                    연결 평가항목이 없는 문서 {orphanDocs}건 — 색인은 되지만 어떤 항목의 판정에도 쓰이지 않습니다.
                </Banner>
            )}

            <div
                className="grid gap-5"
                style={{
                    gridTemplateColumns: '340px minmax(0, 1fr)',
                    height: `calc(100vh - ${300 + topOffset}px)`,
                    minHeight: 540,
                }}
            >
                {/* ══ 평가항목 문서 ══ */}
                {mode === 'docs' && (
                    <>
                        {/* 좌: 평가항목 + KMS 지정 */}
                        <div className={panelBox}>
                            <div className={sectionHead}>
                                <h3 className="text-[13px] font-bold text-[var(--ink-900)] tracking-tight">평가항목</h3>
                                <span className="text-[11.5px] text-[var(--ink-500)] font-medium">
                                    KMS 지정 {marks.length}
                                </span>
                            </div>
                            <div className="flex-1 overflow-y-auto p-2 min-h-0">
                                {loading && <p className="px-3 py-4 text-[12.5px] text-[var(--ink-500)]">불러오는 중…</p>}
                                {!loading && defs.length === 0 && (
                                    <p className="px-3 py-4 text-[12.5px] text-[var(--ink-500)] leading-relaxed">
                                        평가항목을 불러오지 못했습니다.
                                        <br />
                                        [평가항목 관리] 탭에서 항목을 먼저 등록하세요.
                                    </p>
                                )}
                                {defs.map((d) => {
                                    const no = Number(d.order_no);
                                    const marked = marks.includes(no);
                                    const cnt = (docsByItem.get(no) || []).length;
                                    const on = selItem === no;
                                    return (
                                        <div
                                            key={`it-${no}`}
                                            onClick={() => {
                                                setSelItem(no);
                                                setSelDoc(null);
                                            }}
                                            className={`flex items-center gap-2 px-3 py-2.5 rounded-lg mb-0.5 transition-colors cursor-pointer ${
                                                on ? 'bg-[var(--primary-soft-flat)]' : 'hover:bg-[var(--background-soft)]'
                                            }`}
                                        >
                                            <input
                                                type="checkbox"
                                                checked={marked}
                                                onChange={() => toggleMark(no)}
                                                onClick={(e) => e.stopPropagation()}
                                                title="KMS 항목으로 지정 (평가항목 관리에 배지 표시)"
                                            />
                                            <span className="text-[10px] font-bold text-[var(--ink-500)] tabular-nums">
                                                #{String(no).padStart(2, '0')}
                                            </span>
                                            <span
                                                className={`flex-1 text-[12.5px] font-bold truncate ${
                                                    on ? 'text-[var(--primary)]' : 'text-[var(--ink-900)]'
                                                }`}
                                            >
                                                {d.item}
                                            </span>
                                            {marked && (
                                                <span className="shrink-0 text-[9px] font-bold px-1.5 py-0.5 rounded bg-[var(--primary)] text-white">
                                                    KMS
                                                </span>
                                            )}
                                            {cnt > 0 && (
                                                <span className="shrink-0 text-[10px] font-bold text-[var(--ink-500)] tabular-nums">
                                                    {cnt}건
                                                </span>
                                            )}
                                        </div>
                                    );
                                })}
                            </div>
                        </div>

                        {/* 우: 선택 항목의 문서 */}
                        <div className={panelBox}>
                            <div className={sectionHead}>
                                <FileText size={14} className="text-[var(--ink-500)]" />
                                <h3 className="text-[13px] font-bold text-[var(--ink-900)] tracking-tight">
                                    {selItem == null
                                        ? '근거 문서'
                                        : `#${String(selItem).padStart(2, '0')} ${defs.find((d) => Number(d.order_no) === selItem)?.item || ''} · 근거 문서`}
                                </h3>
                                <button
                                    type="button"
                                    onClick={addDoc}
                                    className="ml-auto flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-dashed border-[var(--border-strong)] bg-white text-[12px] font-semibold text-[var(--ink-500)] hover:border-[var(--primary)] hover:text-[var(--primary)] transition-colors"
                                >
                                    <Plus size={13} strokeWidth={2.5} />
                                    문서 추가
                                </button>
                            </div>

                            <div className="flex-1 overflow-y-auto min-h-0">
                                {/* 문서 목록 (선택 항목 기준, 미선택 시 전체) */}
                                <div className="p-2 border-b border-[var(--muted)]">
                                    {(() => {
                                        const idxs =
                                            selItem == null ? docs.map((_, i) => i) : docsByItem.get(selItem) || [];
                                        if (!idxs.length) {
                                            return (
                                                <p className="px-3 py-3 text-[12.5px] text-[var(--ink-500)]">
                                                    {selItem == null
                                                        ? '등록된 문서가 없습니다. [문서 추가] 로 시작하세요.'
                                                        : '이 항목에 연결된 문서가 없습니다. [문서 추가] 를 누르면 이 항목에 자동 연결됩니다.'}
                                                </p>
                                            );
                                        }
                                        return idxs.map((i) => {
                                            const d = docs[i];
                                            const on = selDoc === i;
                                            const name = String(d.title || '').trim();
                                            return (
                                                <div
                                                    key={`doc-${i}`}
                                                    onClick={() => setSelDoc(i)}
                                                    className={`flex items-center gap-2 px-3 py-2 rounded-lg mb-0.5 transition-colors cursor-pointer ${
                                                        on ? 'bg-[var(--primary-soft-flat)]' : 'hover:bg-[var(--background-soft)]'
                                                    }`}
                                                >
                                                    <span
                                                        className={`flex-1 text-[12.5px] font-semibold truncate ${
                                                            name ? 'text-[var(--ink-900)]' : 'text-[var(--ink-300)] italic'
                                                        }`}
                                                    >
                                                        {name || '(제목 미입력)'}
                                                    </span>
                                                    {d.active === false && (
                                                        <span className="shrink-0 text-[9px] font-bold px-1.5 py-0.5 rounded bg-[var(--muted)] text-[var(--ink-500)]">
                                                            제외
                                                        </span>
                                                    )}
                                                    {name && dupDocs.has(name) && (
                                                        <span className="shrink-0 text-[9px] font-bold px-1.5 py-0.5 rounded bg-[#FEF3F2] text-[#B42318]">
                                                            중복
                                                        </span>
                                                    )}
                                                    <span className="shrink-0 text-[10.5px] text-[var(--ink-500)] tabular-nums">
                                                        {String(d.body || '').length.toLocaleString()}자 · 연결{' '}
                                                        {(d.linked_items || []).length}
                                                    </span>
                                                </div>
                                            );
                                        });
                                    })()}
                                </div>

                                {/* 문서 편집 */}
                                {!currentDoc && (
                                    <p className="p-6 text-[13px] text-[var(--ink-500)] text-center leading-relaxed">
                                        문서를 선택하면 제목·본문·연결 항목을 편집할 수 있습니다.
                                    </p>
                                )}
                                {currentDoc && (
                                    <div className="p-5 flex flex-col gap-5">
                                        <div className="flex flex-wrap items-end gap-4">
                                            <label className="flex-1 min-w-[260px]">
                                                <span className={labelCls}>문서 제목</span>
                                                <input
                                                    type="text"
                                                    value={currentDoc.title || ''}
                                                    onChange={(e) => patchDoc({ title: e.target.value })}
                                                    placeholder="예) IDPW 초기화 처리 절차"
                                                    className={inputCls}
                                                />
                                            </label>
                                            <label className="flex items-center gap-2 pb-2 cursor-pointer">
                                                <input
                                                    type="checkbox"
                                                    checked={currentDoc.active !== false}
                                                    onChange={(e) => patchDoc({ active: e.target.checked })}
                                                />
                                                <span className="text-[12.5px] font-semibold text-[var(--ink-700)]">
                                                    색인 포함
                                                </span>
                                            </label>
                                            <button
                                                type="button"
                                                onClick={removeDoc}
                                                className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-[var(--border-strong)] bg-white text-[12px] font-semibold text-[#B42318] hover:bg-[#FEF3F2] transition-colors"
                                            >
                                                <Trash2 size={13} />
                                                문서 삭제
                                            </button>
                                        </div>

                                        <label className="block">
                                            <span className={labelCls}>
                                                본문
                                                <span className="ml-1.5 font-medium text-[var(--ink-500)]">
                                                    {String(currentDoc.body || '').length.toLocaleString()}자 · 색인 시 이
                                                    본문이 chunk 로 쪼개집니다
                                                </span>
                                            </span>
                                            <textarea
                                                rows={12}
                                                value={currentDoc.body || ''}
                                                onChange={(e) => patchDoc({ body: e.target.value })}
                                                placeholder={'업무 처리 절차·안내 문구·예외 조건 등 판정 근거가 되는 원문을 붙여넣습니다.'}
                                                className={`${inputCls} leading-relaxed font-mono text-[12.5px]`}
                                            />
                                        </label>

                                        <label className="block">
                                            <span className={labelCls}>
                                                태그
                                                <span className="ml-1.5 font-medium text-[var(--ink-500)]">
                                                    검색 보조 · 줄바꿈·콤마·가운뎃점 구분 · 현재{' '}
                                                    {(currentDoc.tags || []).length}개
                                                </span>
                                            </span>
                                            <input
                                                type="text"
                                                value={(currentDoc.tags || []).join(', ')}
                                                onChange={(e) => patchDoc({ tags: parseTokens(e.target.value) })}
                                                placeholder="본인확인, 필수안내, 임시비밀번호"
                                                className={inputCls}
                                            />
                                        </label>

                                        <div>
                                            <span className={labelCls}>
                                                연결 평가항목
                                                <span className="ml-1.5 font-medium text-[var(--ink-500)]">
                                                    이 문서를 근거로 판정할 항목 — 현재{' '}
                                                    {(currentDoc.linked_items || []).length}개
                                                </span>
                                            </span>
                                            <div
                                                className="grid gap-1.5"
                                                style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))' }}
                                            >
                                                {defs.map((d) => {
                                                    const no = Number(d.order_no);
                                                    const on = (currentDoc.linked_items || []).includes(no);
                                                    return (
                                                        <label
                                                            key={`dl-${no}`}
                                                            className={`flex items-center gap-2 px-3 py-2 rounded-lg border cursor-pointer transition-colors ${
                                                                on
                                                                    ? 'border-[var(--primary)] bg-[var(--primary-soft-flat)]'
                                                                    : 'border-[var(--border)] hover:bg-[var(--background-soft)]'
                                                            }`}
                                                        >
                                                            <input
                                                                type="checkbox"
                                                                checked={on}
                                                                onChange={(e) => {
                                                                    const set = new Set(currentDoc.linked_items || []);
                                                                    if (e.target.checked) set.add(no);
                                                                    else set.delete(no);
                                                                    patchDoc({ linked_items: [...set].sort((a, b) => a - b) });
                                                                }}
                                                            />
                                                            <span className="text-[10px] font-bold text-[var(--ink-500)] tabular-nums">
                                                                #{String(no).padStart(2, '0')}
                                                            </span>
                                                            <span className="text-[12.5px] text-[var(--ink-900)] truncate">
                                                                {d.item}
                                                            </span>
                                                        </label>
                                                    );
                                                })}
                                            </div>
                                        </div>
                                    </div>
                                )}
                            </div>
                        </div>
                    </>
                )}

                {/* ══ 업무 데이터 ══ */}
                {mode === 'tasks' && (
                    <>
                        <div className={panelBox}>
                            <div className={sectionHead}>
                                <h3 className="text-[13px] font-bold text-[var(--ink-900)] tracking-tight">등록 업무</h3>
                                <span className="text-[11.5px] text-[var(--ink-500)] font-medium">{tasks.length}건</span>
                            </div>
                            <div className="flex-1 overflow-y-auto p-2 pb-1 min-h-0">
                                {!loading && tasks.length === 0 && (
                                    <p className="px-3 py-4 text-[12.5px] text-[var(--ink-500)] leading-relaxed">
                                        등록된 업무가 없습니다.
                                        <br />
                                        아래 [새 업무 추가] 로 시작하세요.
                                    </p>
                                )}
                                {tasks.map((it, idx) => {
                                    const on = selTask === idx;
                                    const name = String(it.task || '').trim();
                                    return (
                                        <div
                                            key={`task-${idx}`}
                                            onClick={() => setSelTask(idx)}
                                            className={`flex items-center gap-2 px-3 py-2.5 rounded-lg mb-0.5 transition-colors cursor-pointer ${
                                                on ? 'bg-[var(--primary-soft-flat)]' : 'hover:bg-[var(--background-soft)]'
                                            }`}
                                        >
                                            <div className="min-w-0 flex-1">
                                                <div className="flex items-center gap-1.5">
                                                    <span
                                                        className={`text-[13px] font-semibold truncate ${
                                                            name ? 'text-[var(--ink-900)]' : 'text-[var(--ink-300)] italic'
                                                        }`}
                                                    >
                                                        {name || '(업무명 미입력)'}
                                                    </span>
                                                    {it.active === false && (
                                                        <span className="shrink-0 text-[10px] font-bold px-1.5 py-0.5 rounded bg-[var(--muted)] text-[var(--ink-500)]">
                                                            비활성
                                                        </span>
                                                    )}
                                                    {name && dupTasks.has(name) && (
                                                        <span className="shrink-0 text-[10px] font-bold px-1.5 py-0.5 rounded bg-[#FEF3F2] text-[#B42318]">
                                                            중복
                                                        </span>
                                                    )}
                                                </div>
                                                <div className="mt-0.5 text-[11px] text-[var(--ink-500)] tabular-nums">
                                                    확인정보 {it.confirm_info?.length || 0} · 안내{' '}
                                                    {it.mandatory_notice?.length || 0}
                                                    {it.readback ? ' · 복창' : ''}
                                                    {it.linked_items?.length ? ` · 연결 ${it.linked_items.length}` : ''}
                                                </div>
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                            <div className="px-2 pb-1.5 shrink-0 border-t border-[var(--muted)] bg-white">
                                <button
                                    type="button"
                                    onClick={addTask}
                                    className="w-full mt-1.5 mb-1 flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-lg border border-dashed border-[var(--border-strong)] bg-white text-[12.5px] font-semibold text-[var(--ink-500)] hover:border-[var(--primary)] hover:text-[var(--primary)] hover:bg-[var(--background-soft)] transition-colors"
                                >
                                    <Plus size={13} strokeWidth={2.5} />
                                    새 업무 추가
                                </button>
                            </div>
                        </div>

                        <div className={panelBox}>
                            {!currentTask && (
                                <div className="flex-1 flex items-center justify-center p-8">
                                    <p className="text-[13px] text-[var(--ink-500)] text-center leading-relaxed">
                                        좌측에서 업무를 선택하면 상세를 편집할 수 있습니다.
                                        <br />
                                        <span className="text-[12px] text-[var(--ink-300)]">
                                            업무명 · 필수 확인정보 · 확인 복창 · 필수 안내 · 연결 평가항목
                                        </span>
                                    </p>
                                </div>
                            )}
                            {currentTask && (
                                <>
                                    <div className={sectionHead}>
                                        <h3 className="text-[13px] font-bold text-[var(--ink-900)] tracking-tight">업무 상세</h3>
                                        <button
                                            type="button"
                                            onClick={removeTask}
                                            className="ml-auto flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-[var(--border-strong)] bg-white text-[12px] font-semibold text-[#B42318] hover:bg-[#FEF3F2] transition-colors"
                                        >
                                            <Trash2 size={13} />
                                            이 업무 삭제
                                        </button>
                                    </div>
                                    <div className="flex-1 overflow-y-auto p-5 min-h-0 flex flex-col gap-5">
                                        <div className="flex flex-wrap items-end gap-4">
                                            <label className="flex-1 min-w-[260px]">
                                                <span className={labelCls}>업무명</span>
                                                <input
                                                    type="text"
                                                    value={currentTask.task || ''}
                                                    onChange={(e) => patchTask({ task: e.target.value })}
                                                    placeholder="예) IDPW 초기화"
                                                    className={inputCls}
                                                />
                                            </label>
                                            <label className="flex items-center gap-2 pb-2 cursor-pointer">
                                                <input
                                                    type="checkbox"
                                                    checked={currentTask.readback === true}
                                                    onChange={(e) => patchTask({ readback: e.target.checked })}
                                                />
                                                <span className="text-[12.5px] font-semibold text-[var(--ink-700)]">
                                                    확인 복창 필요
                                                </span>
                                            </label>
                                            <label className="flex items-center gap-2 pb-2 cursor-pointer">
                                                <input
                                                    type="checkbox"
                                                    checked={currentTask.active !== false}
                                                    onChange={(e) => patchTask({ active: e.target.checked })}
                                                />
                                                <span className="text-[12.5px] font-semibold text-[var(--ink-700)]">활성</span>
                                            </label>
                                        </div>

                                        <label className="block">
                                            <span className={labelCls}>
                                                필수 확인정보
                                                <span className="ml-1.5 font-medium text-[var(--ink-500)]">
                                                    줄바꿈 · 콤마 · 가운뎃점(·) 구분 — 현재{' '}
                                                    {currentTask.confirm_info?.length || 0}개
                                                </span>
                                            </span>
                                            <textarea
                                                rows={4}
                                                value={joinLines(currentTask.confirm_info)}
                                                onChange={(e) => patchTask({ confirm_info: parseTokens(e.target.value) })}
                                                placeholder={'성함\n생년월일\n본인여부\n증권계좌 비밀번호\n연락처'}
                                                className={`${inputCls} leading-relaxed`}
                                            />
                                            {(currentTask.confirm_info?.length || 0) > 0 && (
                                                <div className="mt-2 flex flex-wrap gap-1.5">
                                                    {currentTask.confirm_info.map((t, i) => (
                                                        <span
                                                            key={`ci-${i}`}
                                                            className="text-[11.5px] font-medium px-2 py-0.5 rounded-md bg-[var(--primary-soft-flat)] text-[var(--ink-700)]"
                                                        >
                                                            {t}
                                                        </span>
                                                    ))}
                                                </div>
                                            )}
                                        </label>

                                        <label className="block">
                                            <span className={labelCls}>
                                                필수 안내
                                                <span className="ml-1.5 font-medium text-[var(--ink-500)]">
                                                    한 줄에 1개 — 현재 {currentTask.mandatory_notice?.length || 0}개
                                                </span>
                                            </span>
                                            <textarea
                                                rows={4}
                                                value={joinLines(currentTask.mandatory_notice)}
                                                onChange={(e) =>
                                                    patchTask({ mandatory_notice: parseLines(e.target.value) })
                                                }
                                                placeholder={'임시 비밀번호 재설정 화면을 안내한다\n처리 후 재로그인 필요를 안내한다'}
                                                className={`${inputCls} leading-relaxed`}
                                            />
                                        </label>

                                        <div>
                                            <span className={labelCls}>
                                                연결 평가항목
                                                <span className="ml-1.5 font-medium text-[var(--ink-500)]">
                                                    현재 {currentTask.linked_items?.length || 0}개
                                                </span>
                                            </span>
                                            <div
                                                className="grid gap-1.5"
                                                style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))' }}
                                            >
                                                {defs.map((d) => {
                                                    const no = Number(d.order_no);
                                                    const on = (currentTask.linked_items || []).includes(no);
                                                    return (
                                                        <label
                                                            key={`tl-${no}`}
                                                            className={`flex items-center gap-2 px-3 py-2 rounded-lg border cursor-pointer transition-colors ${
                                                                on
                                                                    ? 'border-[var(--primary)] bg-[var(--primary-soft-flat)]'
                                                                    : 'border-[var(--border)] hover:bg-[var(--background-soft)]'
                                                            }`}
                                                        >
                                                            <input
                                                                type="checkbox"
                                                                checked={on}
                                                                onChange={(e) => {
                                                                    const set = new Set(currentTask.linked_items || []);
                                                                    if (e.target.checked) set.add(no);
                                                                    else set.delete(no);
                                                                    patchTask({
                                                                        linked_items: [...set].sort((a, b) => a - b),
                                                                    });
                                                                }}
                                                            />
                                                            <span className="text-[10px] font-bold text-[var(--ink-500)] tabular-nums">
                                                                #{String(no).padStart(2, '0')}
                                                            </span>
                                                            <span className="text-[12.5px] text-[var(--ink-900)] truncate">
                                                                {d.item}
                                                            </span>
                                                        </label>
                                                    );
                                                })}
                                            </div>
                                        </div>

                                        <label className="block">
                                            <span className={labelCls}>비고</span>
                                            <input
                                                type="text"
                                                value={currentTask.note || ''}
                                                onChange={(e) => patchTask({ note: e.target.value })}
                                                placeholder="출처·예외 조건 등 (선택)"
                                                className={inputCls}
                                            />
                                        </label>
                                    </div>
                                </>
                            )}
                        </div>
                    </>
                )}
            </div>

            <div className="mt-3 flex items-start gap-2">
                <Info size={13} className="mt-0.5 shrink-0 text-[var(--ink-300)]" />
                <p className="text-[11.5px] text-[var(--ink-500)] leading-relaxed">
                    색인된 문서는 연결 평가항목의 판정 근거로만 쓰입니다. 채점 반영은 파이프라인 지식문서 연동 후
                    적용되며, 그때까지 등록·색인 상태만 유지됩니다.
                </p>
            </div>
        </div>
    );
};

export default KmsItems;
