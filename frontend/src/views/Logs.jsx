import React, { useEffect, useRef, useState } from 'react';
import { Loader2, Pause, Play, RefreshCw, ChevronDown, ListChecks, Terminal, Sparkles, Wand2 } from 'lucide-react';
import Header from '../components/Header';
import { fetchAuditLogs, fetchAppLogsRecent, fetchRagLogRecent, fetchSkillLogRecent, fetchSkillMemory } from '../services/api';

const POLL_INTERVAL_MS = 5000;
const PAGE_SIZE = 100;
const APP_LOG_LIMIT = 500;
// 서버 보관: 3일 (qa_audit_logs prune 주기 / winston-daily-rotate-file maxFiles=3d 동일) / 화면 노출: 1일
const VIEW_WINDOW_DAYS = 1;

const ACTION_TONES = {
    AUTH_LOGIN_SUCCESS: 'bg-[var(--success-soft)] text-[var(--success)]',
    AUTH_LOGIN_FAIL: 'bg-[var(--destructive-soft)] text-[var(--destructive)]',
    AUTH_LOGOUT: 'bg-[var(--muted)] text-[var(--ink-700)]',
    QA_MANUAL_EVAL_SAVE: 'bg-[var(--primary-soft)] text-[var(--primary)]',
    QA_ADMIN_COMMENTS_SAVE: 'bg-[var(--primary-soft)] text-[var(--primary)]',
    SAMPLE_INGEST: 'bg-[var(--warning-soft)] text-[var(--warning)]',
    SAMPLE_CLEAR: 'bg-[var(--warning-soft)] text-[var(--warning)]',
    INGEST_AI_CANVAS: 'bg-[var(--warning-soft)] text-[var(--warning)]',
    INGEST_COLLECTION_CALL: 'bg-[var(--warning-soft)] text-[var(--warning)]',
    BRAND_CREATE: 'bg-[var(--cat-account-soft)] text-[var(--cat-account)]',
    BRAND_UPDATE: 'bg-[var(--cat-account-soft)] text-[var(--cat-account)]',
    BRAND_DELETE: 'bg-[var(--cat-account-soft)] text-[var(--cat-account)]',
    USER_CREATE: 'bg-[var(--cat-policy-soft)] text-[var(--cat-policy)]',
    USER_UPDATE: 'bg-[var(--cat-policy-soft)] text-[var(--cat-policy)]',
    USER_DELETE: 'bg-[var(--cat-policy-soft)] text-[var(--cat-policy)]',
    DOMAIN_CREATE: 'bg-[var(--cat-service-soft)] text-[var(--cat-service)]',
    DOMAIN_UPDATE: 'bg-[var(--cat-service-soft)] text-[var(--cat-service)]',
    DOMAIN_DELETE: 'bg-[var(--cat-service-soft)] text-[var(--cat-service)]',
};

const ACTION_OPTIONS = [
    { value: '', label: '전체 액션' },
    { value: 'AUTH_LOGIN_SUCCESS', label: '로그인 성공' },
    { value: 'AUTH_LOGIN_FAIL', label: '로그인 실패' },
    { value: 'AUTH_LOGOUT', label: '로그아웃' },
    { value: 'QA_MANUAL_EVAL_SAVE', label: '평가 저장' },
    { value: 'SAMPLE_INGEST', label: '샘플 적재' },
    { value: 'SAMPLE_CLEAR', label: '샘플 일괄 삭제' },
    { value: 'INGEST_AI_CANVAS', label: 'AI Canvas 적재' },
    { value: 'INGEST_COLLECTION_CALL', label: '외부 콜 적재' },
    { value: 'BRAND_CREATE', label: '브랜드 생성' },
    { value: 'BRAND_UPDATE', label: '브랜드 수정' },
    { value: 'BRAND_DELETE', label: '브랜드 삭제' },
    { value: 'USER_CREATE', label: '사용자 생성' },
    { value: 'USER_UPDATE', label: '사용자 수정' },
    { value: 'USER_DELETE', label: '사용자 삭제' },
    { value: 'DOMAIN_CREATE', label: '도메인 생성' },
    { value: 'DOMAIN_UPDATE', label: '도메인 수정' },
    { value: 'DOMAIN_DELETE', label: '도메인 삭제' },
    // 백엔드 활동(비-audit) — '__' prefix 는 서버(fetchAuditLogs)에 전달하지 않는 클라이언트 필터.
    { value: '__rag', label: 'RAG · 사전 (백엔드)' },
    { value: '__skill', label: 'LLM 스킬 (백엔드)' },
];

const LEVEL_TONES = {
    DEBUG: 'bg-[var(--muted)] text-[var(--ink-700)]',
    INFO: 'bg-[var(--primary-soft)] text-[var(--primary)]',
    WARNING: 'bg-[var(--warning-soft)] text-[var(--warning)]',
    WARN: 'bg-[var(--warning-soft)] text-[var(--warning)]',
    ERROR: 'bg-[var(--destructive-soft)] text-[var(--destructive)]',
    CRITICAL: 'bg-[var(--destructive-soft)] text-[var(--destructive)]',
};

function ActionChip({ action }) {
    const tone = ACTION_TONES[action] || 'bg-[var(--muted)] text-[var(--ink-500)]';
    return (
        <span className={`inline-flex items-center px-2 py-0.5 rounded-md text-[11px] font-semibold font-mono ${tone}`}>
            {action}
        </span>
    );
}

function LevelChip({ level }) {
    const tone = LEVEL_TONES[String(level || '').toUpperCase()] || 'bg-[var(--muted)] text-[var(--ink-500)]';
    return (
        <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold font-mono ${tone}`}>
            {level || '—'}
        </span>
    );
}

function fmtTime(iso) {
    if (!iso) return '—';
    const d = new Date(iso);
    return d.toLocaleString('ko-KR', {
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
    });
}

/* ── Audit 패널 (DB qa_audit_logs + 백엔드 RAG·LLM 스킬 활동 통합) ───
 * 전용 탭(RAG·사전/LLM 스킬) 제거(2026-07-08 사용자 지시) — 백엔드 인메모리 링버퍼
 * 활동을 사용자 활동 피드에 시간순 통합. 백엔드 행 클릭 시 상세(RAG 카드·메모리
 * 스냅샷·주입 룰 원문)가 토글로 펼쳐짐. 카드 컴포넌트(RagItemGroup 등)는 재사용.
 */

/** RAG 링버퍼 엔트리 → 대화(qa_id)별 1행 그룹. hit 항목은 item_number 최신 1건 유지, 금지어는 별도 수집. */
function buildRagQaGroups(entries) {
    const byQa = new Map();
    for (const e of entries) {
        const qa = e.qa_id || 'unknown';
        if (!byQa.has(qa)) byQa.set(qa, { items: new Map(), forbidden: [] });
        const g = byQa.get(qa);
        if (e.kind === 'forbidden') {
            g.forbidden.push(e);
            continue;
        }
        const key = Number(e.item_number);
        const prev = g.items.get(key);
        if (!prev || (e.ts || 0) > (prev.ts || 0)) g.items.set(key, e);
    }
    return Array.from(byQa.entries()).map(([qaId, g]) => {
        const items = Array.from(g.items.values()).sort((a, b) => Number(a.item_number) - Number(b.item_number));
        const hitCount = items.reduce((s, e) => s + (Array.isArray(e.hits) ? e.hits.length : 0), 0);
        const ts = Math.max(0, ...items.map((e) => e.ts || 0), ...g.forbidden.map((e) => e.ts || 0));
        return { qaId, items, forbidden: g.forbidden, hitCount, ts };
    });
}

function AuditPanel() {
    const [logs, setLogs] = useState([]);
    const [ragGroups, setRagGroups] = useState([]);
    const [skillEntries, setSkillEntries] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [paused, setPaused] = useState(false);
    const [actionFilter, setActionFilter] = useState('');
    const [loadingMore, setLoadingMore] = useState(false);
    const seenIdsRef = useRef(new Set());
    // 백엔드 행 펼침 상태 + 메모리 스냅샷 캐시(org_id 단위 — 재펼침 시 재조회 없음)
    const [openKeys, setOpenKeys] = useState(() => new Set());
    const [memCache, setMemCache] = useState({});

    const isBackendFilter = actionFilter === '__rag' || actionFilter === '__skill';
    const auditAction = actionFilter && !isBackendFilter ? actionFilter : undefined;

    const toggleOpen = (k) =>
        setOpenKeys((prev) => {
            const next = new Set(prev);
            if (next.has(k)) next.delete(k);
            else next.add(k);
            return next;
        });

    async function loadMemory(orgId) {
        setMemCache((prev) => ({ ...prev, [orgId]: { loading: true } }));
        try {
            const data = await fetchSkillMemory({ orgId });
            if (data?.ok === false) throw new Error(data.error || '메모리 조회 실패');
            setMemCache((prev) => ({ ...prev, [orgId]: { loading: false, data } }));
        } catch (e) {
            setMemCache((prev) => ({ ...prev, [orgId]: { loading: false, error: e?.message || '메모리 조회 실패' } }));
        }
    }

    async function loadBackend() {
        // 백엔드 인메모리 링버퍼 스냅샷 — 증분 병합 불필요(매번 전량 교체)
        try {
            const [ragRows, skillRows] = await Promise.all([
                fetchRagLogRecent({ limit: PAGE_SIZE }),
                fetchSkillLogRecent({ limit: PAGE_SIZE }),
            ]);
            setRagGroups(buildRagQaGroups(Array.isArray(ragRows) ? ragRows : []));
            setSkillEntries(Array.isArray(skillRows) ? skillRows : []);
        } catch (e) {
            console.error('backend activity load error:', e);
        }
    }

    async function loadInitial() {
        setLoading(true);
        try {
            const [rows] = await Promise.all([
                fetchAuditLogs({ limit: PAGE_SIZE, action: auditAction }),
                loadBackend(),
            ]);
            setLogs(rows);
            seenIdsRef.current = new Set(rows.map((r) => r.audit_id));
            setError(null);
        } catch (e) {
            setError(e?.message || '로그 로드 실패');
        } finally {
            setLoading(false);
        }
    }

    async function tailNew() {
        loadBackend();
        try {
            const rows = await fetchAuditLogs({ limit: PAGE_SIZE, action: auditAction });
            const fresh = rows.filter((r) => !seenIdsRef.current.has(r.audit_id));
            if (fresh.length === 0) return;
            for (const r of fresh) seenIdsRef.current.add(r.audit_id);
            setLogs((prev) => [...fresh, ...prev].slice(0, 500));
        } catch (e) {
            console.error('audit tail error:', e);
        }
    }

    async function loadMore() {
        if (loadingMore || logs.length === 0) return;
        setLoadingMore(true);
        try {
            const last = logs[logs.length - 1];
            const more = await fetchAuditLogs({
                limit: PAGE_SIZE,
                before: last.audit_id,
                action: auditAction,
            });
            for (const r of more) seenIdsRef.current.add(r.audit_id);
            setLogs((prev) => [...prev, ...more]);
        } catch (e) {
            setError(e?.message || '추가 로드 실패');
        } finally {
            setLoadingMore(false);
        }
    }

    useEffect(() => {
        loadInitial();
    }, [actionFilter]);

    useEffect(() => {
        if (paused) return;
        const id = setInterval(tailNew, POLL_INTERVAL_MS);
        return () => clearInterval(id);
    }, [paused, actionFilter]);

    // 시간순 통합 피드 — audit(DB) + RAG 조회(대화별 1행) + LLM 스킬 이벤트(건별)
    const mergedRows = [];
    if (!isBackendFilter) for (const l of logs) mergedRows.push({ kind: 'audit', ts: new Date(l.created_at).getTime() || 0, key: `a-${l.audit_id}`, audit: l });
    if (actionFilter === '' || actionFilter === '__rag') for (const g of ragGroups) mergedRows.push({ kind: 'rag', ts: g.ts, key: `r-${g.qaId}`, rag: g });
    if (actionFilter === '' || actionFilter === '__skill') skillEntries.forEach((e, i) => mergedRows.push({ kind: 'skill', ts: e.ts || 0, key: `s-${e.ts || 'na'}-${e.qa_id || i}`, skill: e }));
    mergedRows.sort((a, b) => b.ts - a.ts);

    return (
        <>
            <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 text-[12px] text-[var(--ink-500)]">
                    <span className="inline-flex items-center gap-1.5">
                        <span className={`w-2 h-2 rounded-full ${paused ? 'bg-[var(--ink-500)]' : 'bg-[var(--success)] animate-pulse'}`} />
                        {paused ? '갱신 일시정지' : `자동 갱신 중 (${POLL_INTERVAL_MS / 1000}초)`}
                    </span>
                    <span>·</span>
                    <span>총 {mergedRows.length}건 표시</span>
                </div>
                <div className="flex items-center gap-2">
                    <select
                        value={actionFilter}
                        onChange={(e) => setActionFilter(e.target.value)}
                        className="h-[34px] px-3 rounded-xl border border-[var(--border)] bg-white text-[12.5px] outline-none focus:border-[var(--primary)] cursor-pointer text-[var(--ink-900)]"
                    >
                        {ACTION_OPTIONS.map((opt) => (
                            <option key={opt.value || 'all'} value={opt.value}>
                                {opt.label}
                            </option>
                        ))}
                    </select>
                    <button
                        onClick={() => setPaused((v) => !v)}
                        className="inline-flex items-center gap-1.5 h-[34px] px-3.5 rounded-full border border-[var(--border)] bg-white text-[12.5px] font-semibold text-[var(--ink-900)] hover:bg-[var(--muted)] cursor-pointer"
                    >
                        {paused ? <Play size={12} /> : <Pause size={12} />}
                        {paused ? '재개' : '일시정지'}
                    </button>
                    <button
                        onClick={loadInitial}
                        className="inline-flex items-center gap-1.5 h-[34px] px-3.5 rounded-full bg-[var(--primary)] text-white text-[12.5px] font-semibold hover:bg-[var(--primary)] shadow-sm cursor-pointer"
                    >
                        <RefreshCw size={12} /> 새로고침
                    </button>
                </div>
            </div>

            {loading ? (
                <div className="flex justify-center py-12">
                    <Loader2 className="h-5 w-5 animate-spin text-[var(--ink-500)]" />
                </div>
            ) : (
                <>
                    {error && <p className="text-sm text-[var(--destructive)]">{error}</p>}
                    <div className="bg-white border border-[var(--border)] rounded-xl overflow-hidden">
                        <table className="w-full text-sm">
                            <thead>
                                <tr className="border-b border-[var(--border)] bg-[var(--background-soft)]">
                                    <th className="px-3 py-2.5 text-left text-[11px] font-semibold text-[var(--ink-500)] uppercase tracking-wider w-[140px]">시각</th>
                                    <th className="px-3 py-2.5 text-left text-[11px] font-semibold text-[var(--ink-500)] uppercase tracking-wider w-[180px]">액션</th>
                                    <th className="px-3 py-2.5 text-left text-[11px] font-semibold text-[var(--ink-500)] uppercase tracking-wider w-[140px]">수행자</th>
                                    <th className="px-3 py-2.5 text-left text-[11px] font-semibold text-[var(--ink-500)] uppercase tracking-wider w-[80px]">역할</th>
                                    <th className="px-3 py-2.5 text-left text-[11px] font-semibold text-[var(--ink-500)] uppercase tracking-wider">자원</th>
                                    <th className="px-3 py-2.5 text-left text-[11px] font-semibold text-[var(--ink-500)] uppercase tracking-wider w-[100px]">IP</th>
                                    <th className="px-3 py-2.5 text-center text-[11px] font-semibold text-[var(--ink-500)] uppercase tracking-wider w-[60px]">결과</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-[var(--border)] font-mono">
                                {mergedRows.length === 0 && (
                                    <tr>
                                        <td colSpan={7} className="px-3 py-10 text-center text-sm text-[var(--ink-500)]">
                                            로그가 없습니다
                                        </td>
                                    </tr>
                                )}
                                {mergedRows.map((m) => {
                                    /* ── ① 사용자 audit 행 ── */
                                    if (m.kind === 'audit') {
                                        const l = m.audit;
                                        return (
                                            <tr key={m.key} className="hover:bg-[var(--background-soft)]">
                                                <td className="px-3 py-2 text-[11.5px] text-[var(--ink-500)] tabular-nums">{fmtTime(l.created_at)}</td>
                                                <td className="px-3 py-2"><ActionChip action={l.action} /></td>
                                                <td className="px-3 py-2 text-[12px] text-[var(--ink-900)]">{l.login_id || '—'}</td>
                                                <td className="px-3 py-2 text-[11px] text-[var(--ink-500)]">{l.role || '—'}</td>
                                                <td className="px-3 py-2 text-[12px] text-[var(--ink-700)]">
                                                    <span className="font-semibold">{l.resource_type}</span>
                                                    {l.resource_id && <span className="text-[var(--ink-500)]">/{l.resource_id}</span>}
                                                    {l.http_method && (
                                                        <span className="ml-1.5 inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold bg-[var(--muted)] text-[var(--ink-500)]">
                                                            {l.http_method}
                                                        </span>
                                                    )}
                                                </td>
                                                <td className="px-3 py-2 text-[11px] text-[var(--ink-400)] tabular-nums">{l.client_ip || '—'}</td>
                                                <td className="px-3 py-2 text-center">
                                                    {l.success === 1 || l.success === true ? (
                                                        // 'skip:' prefix = 무해 종료(멱등 스킵 등) — 서버 audit 기록 규약(index.js SKILL_LEARN_RUN 참고)
                                                        String(l.error_message || '').startsWith('skip:') ? (
                                                            <span title={l.error_message} className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold bg-[var(--warning-soft)] text-[var(--warning)]">SKIP</span>
                                                        ) : (
                                                            <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold bg-[var(--success-soft)] text-[var(--success)]">OK</span>
                                                        )
                                                    ) : (
                                                        <span title={l.error_message || ''} className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold bg-[var(--destructive-soft)] text-[var(--destructive)]">FAIL</span>
                                                    )}
                                                </td>
                                            </tr>
                                        );
                                    }
                                    /* ── ② RAG 조회 행 (대화별 1행 · 클릭 시 항목별 카드 토글) ── */
                                    if (m.kind === 'rag') {
                                        const g = m.rag;
                                        const isOpen = openKeys.has(m.key);
                                        return (
                                            <React.Fragment key={m.key}>
                                                <tr onClick={() => toggleOpen(m.key)} className="align-top hover:bg-[var(--background-soft)] cursor-pointer">
                                                    <td className="px-3 py-2 text-[11.5px] text-[var(--ink-500)] tabular-nums">{fmtRagTime(m.ts)}</td>
                                                    <td className="px-3 py-2">
                                                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-semibold bg-[var(--success-soft)] text-[var(--success)] whitespace-nowrap">
                                                            <Sparkles size={11} /> RAG 조회
                                                        </span>
                                                    </td>
                                                    <td className="px-3 py-2 text-[12px] text-[var(--ink-500)]">백엔드</td>
                                                    <td className="px-3 py-2 text-[11px] text-[var(--ink-500)]">AI</td>
                                                    <td className="px-3 py-2 text-[12px] text-[var(--ink-700)]">
                                                        <ChevronDown
                                                            size={13}
                                                            className={`inline-block mr-1 -mt-0.5 text-[var(--ink-400)] transition-transform ${isOpen ? '' : '-rotate-90'}`}
                                                        />
                                                        <span className="font-semibold text-[var(--ink-900)] break-all">{g.qaId}</span>
                                                        <span className="text-[var(--ink-500)]"> · 항목 {g.items.length} · 사례 {g.hitCount}건</span>
                                                        {g.forbidden.length > 0 && (
                                                            <span className="ml-1.5 inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold bg-[var(--destructive-soft)] text-[var(--destructive)]">금지어 {g.forbidden.length}건</span>
                                                        )}
                                                        {!isOpen && (
                                                            <span className="ml-1.5 inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-[var(--success-soft)] text-[var(--success)]">클릭해 상세 보기</span>
                                                        )}
                                                    </td>
                                                    <td className="px-3 py-2 text-[11px] text-[var(--ink-400)]">—</td>
                                                    <td className="px-3 py-2 text-center">
                                                        <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold bg-[var(--success-soft)] text-[var(--success)]">OK</span>
                                                    </td>
                                                </tr>
                                                {isOpen && (
                                                    <tr className="bg-[var(--background-soft)]">
                                                        <td colSpan={7} className="px-4 py-3 font-sans">
                                                            <div className="text-[11px] font-semibold text-[var(--ink-500)] uppercase tracking-wide mb-2">
                                                                골든셋 RAG — 평가 시 sub-agent fewshot 으로 참조된 사람 검수 정답
                                                            </div>
                                                            <div className="space-y-2">
                                                                {g.items.map((e2) => (
                                                                    <RagItemGroup key={`${g.qaId}-${e2.item_number}`} entry={e2} defaultOpen={false} />
                                                                ))}
                                                            </div>
                                                            {g.forbidden.length > 0 && (
                                                                <div className="mt-3">
                                                                    <div className="text-[11px] font-semibold text-[var(--ink-500)] uppercase tracking-wide mb-1.5">
                                                                        금지어 · 사전 매칭 — {g.forbidden.length}건
                                                                    </div>
                                                                    <div className="space-y-1.5">
                                                                        {g.forbidden.map((e2, i) => (
                                                                            <div key={i} className="bg-white border border-[var(--border)] rounded-lg px-3 py-2">
                                                                                <div className="text-[11px] text-[var(--ink-400)] mb-0.5">
                                                                                    #{e2.item_number}{e2.item_name ? ` ${e2.item_name}` : ''} · {fmtRagTime(e2.ts)}
                                                                                </div>
                                                                                <RagContentCell entry={e2} />
                                                                            </div>
                                                                        ))}
                                                                    </div>
                                                                </div>
                                                            )}
                                                        </td>
                                                    </tr>
                                                )}
                                            </React.Fragment>
                                        );
                                    }
                                    /* ── ③ LLM 스킬 이벤트 행 (메모리·평가 적용 행은 클릭 토글) ── */
                                    const e = m.skill;
                                    const stage = SKILL_STAGE_META[e.stage] || { label: e.stage || '—', cls: 'bg-[var(--muted)] text-[var(--ink-500)]' };
                                    const isErr = e.stage === 'error';
                                    const changedCount = Array.isArray(e.items_changed) ? e.items_changed.length : null;
                                    const hasItems = Array.isArray(e.items) && e.items.length > 0;
                                    const isMem = e.stage === 'memory' && e.org_id != null;
                                    const expandable = hasItems || isMem;
                                    const isOpen = expandable && openKeys.has(m.key);
                                    return (
                                        <React.Fragment key={m.key}>
                                            <tr
                                                onClick={expandable ? () => {
                                                    if (isMem && !openKeys.has(m.key) && !memCache[e.org_id]) loadMemory(e.org_id);
                                                    toggleOpen(m.key);
                                                } : undefined}
                                                className={`align-top ${isErr ? 'bg-[var(--destructive-soft)]' : 'hover:bg-[var(--background-soft)]'} ${expandable ? 'cursor-pointer' : ''}`}
                                            >
                                                <td className="px-3 py-2 text-[11.5px] text-[var(--ink-500)] tabular-nums">{fmtRagTime(e.ts)}</td>
                                                <td className="px-3 py-2">
                                                    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-semibold whitespace-nowrap ${stage.cls}`}>
                                                        <Wand2 size={11} /> 스킬 {stage.label}
                                                    </span>
                                                </td>
                                                <td className="px-3 py-2 text-[12px] text-[var(--ink-500)]">백엔드</td>
                                                <td className="px-3 py-2 text-[11px] text-[var(--ink-500)]">AI</td>
                                                <td className="px-3 py-2 text-[12px] text-[var(--ink-700)]">
                                                    {expandable && (
                                                        <ChevronDown
                                                            size={13}
                                                            className={`inline-block mr-1 -mt-0.5 text-[var(--ink-400)] transition-transform ${isOpen ? '' : '-rotate-90'}`}
                                                        />
                                                    )}
                                                    <span className={`text-[12px] ${isErr ? 'text-[var(--destructive)]' : 'text-[var(--ink-700)]'}`}>{e.message || e.error || '—'}</span>
                                                    <span className="inline-flex flex-wrap items-center gap-1 ml-2 align-middle">
                                                        {e.org_id != null && (
                                                            <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-[var(--muted)] text-[var(--ink-500)]">org {e.org_id}</span>
                                                        )}
                                                        {e.source && (
                                                            <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-[var(--muted)] text-[var(--ink-500)]">{e.source}</span>
                                                        )}
                                                        {e.case_count != null && (
                                                            <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold bg-[var(--primary-soft)] text-[var(--primary)]">케이스 {e.case_count}건</span>
                                                        )}
                                                        {changedCount != null && (
                                                            <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold bg-[var(--success-soft)] text-[var(--success)]">항목 {changedCount}개</span>
                                                        )}
                                                        {e.version_id && (
                                                            <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] bg-[var(--muted)] text-[var(--ink-700)]">{e.version_id}</span>
                                                        )}
                                                        {hasItems && !isOpen && (
                                                            <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-[var(--cat-policy-soft)] text-[var(--cat-policy)]">클릭해 주입 룰 보기</span>
                                                        )}
                                                        {isMem && !isOpen && (
                                                            <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-[var(--cat-service-soft)] text-[var(--cat-service)]">클릭해 메모리 보기</span>
                                                        )}
                                                    </span>
                                                    {isErr && e.error && e.error !== e.message && (
                                                        <div className="mt-0.5 text-[11px] text-[var(--destructive)] break-all">{e.error}</div>
                                                    )}
                                                </td>
                                                <td className="px-3 py-2 text-[11px] text-[var(--ink-400)]">—</td>
                                                <td className="px-3 py-2 text-center">
                                                    {isErr ? (
                                                        <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold bg-[var(--destructive-soft)] text-[var(--destructive)]">FAIL</span>
                                                    ) : (
                                                        <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold bg-[var(--success-soft)] text-[var(--success)]">OK</span>
                                                    )}
                                                </td>
                                            </tr>
                                            {isOpen && isMem && (
                                                <tr className="bg-[var(--background-soft)]">
                                                    <td colSpan={7} className="px-4 py-3 font-sans">
                                                        <MemorySnapshot state={memCache[e.org_id]} />
                                                    </td>
                                                </tr>
                                            )}
                                            {isOpen && hasItems && (
                                                <tr className="bg-[var(--background-soft)]">
                                                    <td colSpan={7} className="px-4 py-3 font-sans">
                                                        <div className="text-[11px] font-semibold text-[var(--ink-500)] uppercase tracking-wide mb-2">
                                                            항목별 스킬 주입 내용 — 평가 시점에 프롬프트에 실제 들어간 룰 원문
                                                        </div>
                                                        <div className="space-y-2">
                                                            {e.items.map((it, i) => (
                                                                <div key={i} className="bg-white border border-[var(--border)] rounded-lg px-3 py-2">
                                                                    <div className="flex flex-wrap items-center gap-2 text-[12px]">
                                                                        <span className="font-semibold text-[var(--ink-900)]">{it.item_name || `#${it.item_number}`}</span>
                                                                        {Number.isFinite(it.item_number) && it.item_name && (
                                                                            <span className="text-[11px] text-[var(--ink-400)]">#{it.item_number}</span>
                                                                        )}
                                                                        {it.applied ? (
                                                                            <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold bg-[var(--success-soft)] text-[var(--success)]">주입</span>
                                                                        ) : (
                                                                            <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-[var(--muted)] text-[var(--ink-500)]">미주입 — 이 항목 룰 없음</span>
                                                                        )}
                                                                        {it.applied && it.overlay_chars > 0 && (
                                                                            <span className="text-[11px] text-[var(--ink-400)]">{Number(it.overlay_chars).toLocaleString()}자</span>
                                                                        )}
                                                                    </div>
                                                                    {it.applied && it.overlay_text && (
                                                                        <pre className="mt-1.5 text-[11.5px] font-mono text-[var(--ink-700)] whitespace-pre-wrap leading-relaxed bg-[var(--background-soft)] border border-[var(--muted)] rounded-md px-2.5 py-2 max-h-[240px] overflow-auto">{it.overlay_text}</pre>
                                                                    )}
                                                                    {it.applied && !it.overlay_text && (
                                                                        <div className="mt-1 text-[11px] text-[var(--ink-400)]">주입 원문 미기록 — 이전 버전 파이프라인 이벤트(글자수만 기록됨)</div>
                                                                    )}
                                                                </div>
                                                            ))}
                                                        </div>
                                                    </td>
                                                </tr>
                                            )}
                                        </React.Fragment>
                                    );
                                })}
                            </tbody>
                        </table>
                        {logs.length >= PAGE_SIZE && (
                            <div className="px-4 py-3 border-t border-[var(--border)] bg-[var(--background-soft)] flex justify-center">
                                <button
                                    onClick={loadMore}
                                    disabled={loadingMore}
                                    className="inline-flex items-center gap-1.5 h-[32px] px-4 rounded-full border border-[var(--border)] bg-white text-[12px] font-semibold text-[var(--ink-900)] hover:bg-[var(--muted)] cursor-pointer disabled:opacity-50"
                                >
                                    {loadingMore ? <Loader2 size={12} className="animate-spin" /> : <ChevronDown size={12} />}
                                    {loadingMore ? '로드 중...' : '이전 100건 더 보기'}
                                </button>
                            </div>
                        )}
                    </div>
                </>
            )}
        </>
    );
}

/* ── App 패널 (winston 파일 로그) ────────────────────────── */
function AppPanel() {
    const [file, setFile] = useState('');
    const [exists, setExists] = useState(false);
    const [lines, setLines] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [paused, setPaused] = useState(false);
    const [levelFilter, setLevelFilter] = useState('');
    const lastFingerprintRef = useRef('');

    async function load() {
        try {
            const data = await fetchAppLogsRecent({ limit: APP_LOG_LIMIT });
            setFile(data.file || '');
            setExists(Boolean(data.exists));
            const incoming = Array.isArray(data.lines) ? data.lines : [];
            // 변경 감지용 fingerprint: 마지막 5줄의 ts+message 해시 대체로 join
            const fp = incoming.slice(-5).map((l) => `${l.ts}|${l.message}`).join('§');
            if (fp !== lastFingerprintRef.current) {
                lastFingerprintRef.current = fp;
                setLines(incoming);
            }
            setError(null);
        } catch (e) {
            setError(e?.message || '앱 로그 로드 실패');
        } finally {
            setLoading(false);
        }
    }

    useEffect(() => {
        load();
    }, []);

    useEffect(() => {
        if (paused) return;
        const id = setInterval(load, POLL_INTERVAL_MS);
        return () => clearInterval(id);
    }, [paused]);

    const filtered = levelFilter
        ? lines.filter((l) => String(l.level || '').toUpperCase() === levelFilter)
        : lines;

    return (
        <>
            <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 text-[12px] text-[var(--ink-500)]">
                    <span className="inline-flex items-center gap-1.5">
                        <span className={`w-2 h-2 rounded-full ${paused ? 'bg-[var(--ink-500)]' : 'bg-[var(--success)] animate-pulse'}`} />
                        {paused ? '갱신 일시정지' : `자동 갱신 중 (${POLL_INTERVAL_MS / 1000}초)`}
                    </span>
                    <span>·</span>
                    <span className="font-mono">{exists ? file : '(파일 없음)'} · {filtered.length}줄</span>
                </div>
                <div className="flex items-center gap-2">
                    <select
                        value={levelFilter}
                        onChange={(e) => setLevelFilter(e.target.value)}
                        className="h-[34px] px-3 rounded-xl border border-[var(--border)] bg-white text-[12.5px] outline-none focus:border-[var(--primary)] cursor-pointer text-[var(--ink-900)]"
                    >
                        <option value="">전체 레벨</option>
                        <option value="INFO">INFO</option>
                        <option value="WARN">WARN</option>
                        <option value="WARNING">WARNING</option>
                        <option value="ERROR">ERROR</option>
                        <option value="DEBUG">DEBUG</option>
                    </select>
                    <button
                        onClick={() => setPaused((v) => !v)}
                        className="inline-flex items-center gap-1.5 h-[34px] px-3.5 rounded-full border border-[var(--border)] bg-white text-[12.5px] font-semibold text-[var(--ink-900)] hover:bg-[var(--muted)] cursor-pointer"
                    >
                        {paused ? <Play size={12} /> : <Pause size={12} />}
                        {paused ? '재개' : '일시정지'}
                    </button>
                    <button
                        onClick={load}
                        className="inline-flex items-center gap-1.5 h-[34px] px-3.5 rounded-full bg-[var(--primary)] text-white text-[12.5px] font-semibold hover:bg-[var(--primary)] shadow-sm cursor-pointer"
                    >
                        <RefreshCw size={12} /> 새로고침
                    </button>
                </div>
            </div>

            {loading ? (
                <div className="flex justify-center py-12">
                    <Loader2 className="h-5 w-5 animate-spin text-[var(--ink-500)]" />
                </div>
            ) : (
                <>
                    {error && <p className="text-sm text-[var(--destructive)]">{error}</p>}
                    <div className="bg-[var(--console-bg)] text-[var(--border)] border border-[var(--console-border)] rounded-xl overflow-hidden">
                        <div className="max-h-[68vh] overflow-y-auto font-mono text-[12px] leading-relaxed">
                            {filtered.length === 0 ? (
                                <div className="px-4 py-10 text-center text-[var(--ink-500)]">표시할 로그가 없습니다</div>
                            ) : (
                                <table className="w-full">
                                    <tbody>
                                        {filtered.map((l, idx) => (
                                            <tr key={`${l.ts}-${idx}`} className="border-b border-[var(--console-border)]/60 last:border-0">
                                                <td className="px-3 py-1.5 align-top text-[var(--ink-500)] whitespace-nowrap w-[160px]">
                                                    {l.ts || '—'}
                                                </td>
                                                <td className="px-2 py-1.5 align-top w-[80px]">
                                                    <LevelChip level={l.level} />
                                                </td>
                                                <td className="px-2 py-1.5 align-top text-[var(--console-accent)] whitespace-nowrap w-[200px] truncate" title={l.module}>
                                                    {l.module || '—'}
                                                </td>
                                                <td className="px-2 py-1.5 align-top text-[var(--border)] break-all">
                                                    {l.message}
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            )}
                        </div>
                    </div>
                </>
            )}
        </>
    );
}

/* ── RAG · 사전 패널 (백엔드 인메모리 링버퍼) ──────────────── */
function fmtRagTime(ts) {
    if (!ts) return '—';
    const d = new Date(ts);
    if (Number.isNaN(d.getTime())) return '—';
    return d.toLocaleString('ko-KR', {
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
    });
}

/* ──────────────────────────────────────────────────────────────────────────
 * 골든셋 RAG 리치 카드 — chatbot-ui-next UnifiedRagPanel 이식(TSX→JSX, 인라인 색상).
 *  · 항목(item_number)별 접이식 토글(기본 접힘) → 버킷(full/partial/zero) 그룹 → 카드.
 *  · 카드 섹션(STT 원문·색인요약·근거발화·검수자코멘트)은 각각 펼치기/접기 토글.
 * ────────────────────────────────────────────────────────────────────────── */

const _DASH_LINE_RE = /^[\-=*_~·•\s]{3,}$/;
function stripSeparatorLines(text) {
    if (!text) return '';
    const out = [];
    for (const raw of String(text).split('\n')) {
        const s = raw.trim();
        if (s && _DASH_LINE_RE.test(s)) continue;
        out.push(raw.replace(/\s+$/, ''));
    }
    const compact = [];
    let prevBlank = false;
    for (const ln of out) {
        const blank = !ln.trim();
        if (blank && prevBlank) continue;
        compact.push(ln);
        prevBlank = blank;
    }
    return compact.join('\n').trim();
}

function RagSourceBadge({ source }) {
    const meta =
        source === 'hitl'
            ? { label: '📚 HITL', title: 'qa-hitl-cases — 운영 검수 누적', bg: 'var(--warning-soft)', fg: 'var(--warning)' }
            : source === 'self_match'
              ? { label: '🔁 동일상담', title: '현재 평가 중인 원문 자체 매칭', bg: 'var(--destructive-soft)', fg: 'var(--destructive)' }
              : { label: '🌱 골든셋', title: 'qa-golden-set — 사람 검수 정답', bg: 'var(--success-soft)', fg: 'var(--success)' };
    return (
        <span
            title={meta.title}
            style={{ fontSize: 9.5, fontWeight: 700, background: meta.bg, color: meta.fg, padding: '1px 9px', borderRadius: 999, letterSpacing: '0.04em' }}
        >
            {meta.label}
        </span>
    );
}

function RagSimilarityChips({ hit }) {
    const chips = [];
    const cos = hit.cosine_score;
    if (cos != null && Number.isFinite(cos)) {
        chips.push(
            <span key="cos" title="cosine 의미 유사도 (0~1)" style={{ fontSize: 9.5, fontWeight: 700, background: 'var(--background)', color: 'var(--primary)', padding: '1px 7px', borderRadius: 999 }}>
                cos {Number(cos).toFixed(2)}
            </span>,
        );
    }
    const rrf = hit.rrf_score;
    if (rrf != null && Number.isFinite(rrf)) {
        const RRF_MAX = 2 / 61;
        const rrfNorm = Math.min(1, Math.max(0, Number(rrf) / RRF_MAX));
        chips.push(
            <span key="rrf" title={`RRF(BM25+KNN) 0~1 정규화 · raw=${Number(rrf).toFixed(4)}`} style={{ fontSize: 9.5, fontWeight: 600, background: 'var(--muted)', color: 'var(--ink-700)', padding: '1px 7px', borderRadius: 999 }}>
                rrf {rrfNorm.toFixed(2)}
            </span>,
        );
    }
    const rr = hit.cohere_rerank_score;
    const isCohere = hit.rerank_provider === 'cohere';
    const skip = hit.rerank_skipped_reason;
    if (skip) {
        const txt =
            skip === 'bucket_le_quota' ? '🤖 bucket 직채택' : skip === 'disabled' ? '🤖 reranker OFF' : skip === 'leftover_fill' ? '🤖 leftover 채택' : '🤖 rerank 폴백';
        chips.push(
            <span key="rerank-skip" title={`rerank 스킵: ${skip}`} style={{ fontSize: 9.5, fontWeight: 600, background: 'var(--background)', color: 'var(--ink-500)', padding: '1px 7px', borderRadius: 999 }}>
                {txt}
            </span>,
        );
    } else if (rr != null && Number.isFinite(rr) && Number(rr) > 0) {
        chips.push(
            <span
                key="rerank"
                title={`${isCohere ? 'Cohere Rerank 3.5' : 'LLM(Haiku 4.5) reranker'} · 0~10 스케일(raw=${Number(rr).toFixed(4)})`}
                style={{ fontSize: 9.5, fontWeight: 700, background: isCohere ? 'var(--success-soft)' : 'var(--primary-soft-flat)', color: isCohere ? 'var(--success)' : 'var(--primary)', padding: '1px 7px', borderRadius: 999 }}
            >
                {isCohere ? '🪶 Cohere' : '🤖 Haiku'} rerank {(Number(rr) * 10).toFixed(1)}/10
            </span>,
        );
    }
    if (chips.length === 0) return null;
    return <span style={{ display: 'inline-flex', gap: 4, flexWrap: 'wrap' }}>{chips}</span>;
}

function RagCardSection({ eyebrow, body, tone = 'default', defaultOpen = true, previewChars }) {
    const [open, setOpen] = useState(defaultOpen);
    if (!body) return null;
    const previewBody = previewChars != null && body.length > previewChars ? body.slice(0, previewChars).trimEnd() + ' …' : body;
    const visible = open ? body : previewChars != null ? previewBody : '';
    return (
        <div
            style={{
                marginTop: 6,
                padding: tone === 'info' ? '6px 8px' : '0 0 0 4px',
                background: tone === 'info' ? 'var(--primary-soft-flat)' : 'transparent',
                border: tone === 'info' ? '1px solid #b2ddff' : 'none',
                borderRadius: tone === 'info' ? 6 : 0,
            }}
        >
            <div style={{ fontSize: 9, fontWeight: 700, color: 'var(--ink-500)', marginBottom: 3, textTransform: 'uppercase', letterSpacing: '0.08em', display: 'flex', alignItems: 'center', gap: 5 }}>
                <span>{eyebrow}</span>
                <button
                    type="button"
                    onClick={() => setOpen((o) => !o)}
                    style={{ fontSize: 9, padding: '0 5px', background: 'transparent', border: '1px solid var(--border)', borderRadius: 3, cursor: 'pointer', color: 'var(--ink-500)' }}
                >
                    {open ? '접기' : '펼치기'}
                </button>
            </div>
            {visible && <div style={{ fontSize: 11, color: 'var(--ink-700)', whiteSpace: 'pre-wrap', wordBreak: 'break-word', lineHeight: 1.55 }}>{visible}</div>}
        </div>
    );
}

function RagGoldenCard({ hit }) {
    const source = hit.source || (hit.rater_type === 'hitl' ? 'hitl' : hit.is_self_match ? 'self_match' : 'golden_set');
    const isSelf = source === 'self_match';
    const _trim = (s) => String(s || '').trim();
    const segBody = _trim(hit.segment_text) || _trim(hit.transcript_excerpt);
    const noteBody = _trim(hit.rationale) || _trim(hit.human_note);
    const debugSummary = JSON.stringify(
        {
            segment_text_len: (hit.segment_text || '').length,
            parsed_text_len: (hit.parsed_text || '').length,
            rationale_len: (hit.rationale || '').length,
            index_summary_len: (hit.index_summary || '').length,
            reranker: hit.rerank_provider ?? null,
            rr: hit.cohere_rerank_score ?? null,
            rerank_skipped_reason: hit.rerank_skipped_reason ?? null,
        },
        null,
        2,
    );
    // 색인 요약 = AOSS BM25/KNN 색인된 구조 요약(원문/근거발화와 별개). 비어있으면 재구성하지
    // 않고 섹션 숨김 — segment+rationale 재구성은 근거발화·검수자코멘트와 중복돼 혼란 유발(사용자 지적).
    const idxBody = stripSeparatorLines(_trim(hit.index_summary).replace(/\s+\|\s+/g, '\n'));
    return (
        <div
            style={{
                marginBottom: 8,
                padding: '10px 12px',
                background: isSelf ? 'var(--destructive-soft)' : '#ffffff',
                border: `1px solid ${isSelf ? 'var(--destructive-soft)' : 'var(--border)'}`,
                borderLeft: `3px solid ${isSelf ? 'var(--destructive)' : source === 'hitl' ? 'var(--warning)' : 'var(--success)'}`,
                borderRadius: 6,
            }}
        >
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center', marginBottom: 5 }}>
                <RagSourceBadge source={source} />
                <code style={{ fontSize: 10, fontWeight: 700, background: 'var(--muted)', color: 'var(--ink-900)', padding: '1px 7px', borderRadius: 999 }}>{hit.example_id}</code>
                {hit.item_number && (
                    <span style={{ fontSize: 9.5, color: 'var(--ink-500)', background: 'var(--muted)', padding: '1px 6px', borderRadius: 4 }}>#{hit.item_number}</span>
                )}
                {hit.score_bucket && hit.score_bucket !== 'unknown' && (
                    <span style={{ fontSize: 9.5, color: 'var(--ink-500)', background: 'var(--muted)', padding: '1px 6px', borderRadius: 4 }}>{hit.score_bucket}</span>
                )}
            </div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center', marginBottom: 5, fontSize: 11 }}>
                {hit.score != null && (
                    <span style={{ fontWeight: 600 }}>
                        人 <b>{hit.score}{hit.max_score != null ? `/${hit.max_score}` : ''}</b>
                    </span>
                )}
                <RagSimilarityChips hit={hit} />
                {hit.intent && hit.intent !== '*' && hit.intent !== 'unknown' && (
                    <span style={{ fontSize: 9.5, color: 'var(--ink-500)', background: 'var(--muted)', padding: '1px 6px', borderRadius: 4 }}>{hit.intent}</span>
                )}
                {hit.rater_type && (
                    <span title={hit.rater_source || ''} style={{ fontSize: 9.5, color: 'var(--ink-500)', background: 'var(--muted)', padding: '1px 6px', borderRadius: 4 }}>
                        {hit.rater_type}
                    </span>
                )}
            </div>
            <RagCardSection eyebrow="🔍 디버그 — 원본 hit 필드" body={debugSummary} tone="default" defaultOpen={false} />
            {hit.parsed_text && (
                <RagCardSection eyebrow="📄 STT 전체 원본 (상담 transcript)" body={stripSeparatorLines(hit.parsed_text)} tone="info" defaultOpen={false} previewChars={240} />
            )}
            {idxBody && <RagCardSection eyebrow="🔍 색인 요약 (BM25/KNN 매칭 대상)" body={idxBody} tone="info" defaultOpen={false} previewChars={200} />}
            {segBody && <RagCardSection eyebrow="근거 발화" body={stripSeparatorLines(segBody)} tone="default" defaultOpen={false} />}
            {noteBody && <RagCardSection eyebrow={source === 'golden_set' ? '이유 · 검수자 코멘트' : '검수자 코멘트'} body={stripSeparatorLines(noteBody)} tone="default" defaultOpen />}
            {Array.isArray(hit.rationale_tags) && hit.rationale_tags.length > 0 && (
                <div style={{ marginTop: 5, display: 'flex', flexWrap: 'wrap', gap: 3 }}>
                    {hit.rationale_tags.map((t, i) => (
                        <span key={i} style={{ fontSize: 9, padding: '1px 5px', borderRadius: 3, background: 'var(--primary-soft-flat)', color: 'var(--primary)' }}>
                            {t}
                        </span>
                    ))}
                </div>
            )}
        </div>
    );
}

const RAG_BUCKET_META = {
    full: { label: '🟢 full · 만점 사례', color: 'var(--success)', order: 0 },
    partial: { label: '🟡 partial · 부분점수 사례', color: 'var(--warning)', order: 1 },
    zero: { label: '🔴 zero · 0점 사례', color: 'var(--destructive)', order: 2 },
    unevaluable: { label: '⚫ unevaluable · 평가 불가', color: 'var(--ink-500)', order: 3 },
    unknown: { label: '🏷 메타 분류 없음', color: 'var(--ink-500)', order: 9 },
};

/** 한 항목(item_number)의 hits 를 버킷 그룹 → 카드로. defaultOpen=false(접힘). */
function RagItemGroup({ entry, defaultOpen = false }) {
    const [open, setOpen] = useState(defaultOpen);
    const hits = Array.isArray(entry.hits) ? entry.hits : [];
    const sorted = [...hits].sort((a, b) => {
        const ba = RAG_BUCKET_META[a.score_bucket]?.order ?? 99;
        const bb = RAG_BUCKET_META[b.score_bucket]?.order ?? 99;
        if (ba !== bb) return ba - bb;
        const ra = a.cohere_rerank_score ?? -Infinity;
        const rb = b.cohere_rerank_score ?? -Infinity;
        if (ra !== rb) return rb - ra;
        return (b.cosine_score ?? -Infinity) - (a.cosine_score ?? -Infinity);
    });
    const groups = (() => {
        const map = new Map();
        for (const h of sorted) {
            const k = h.score_bucket || 'unknown';
            if (!map.has(k)) map.set(k, []);
            map.get(k).push(h);
        }
        return Array.from(map.entries())
            .sort(([a], [b]) => (RAG_BUCKET_META[a]?.order ?? 99) - (RAG_BUCKET_META[b]?.order ?? 99))
            .map(([bucket, bhits]) => ({ bucket, ...(RAG_BUCKET_META[bucket] || { label: `❓ ${bucket}`, color: 'var(--ink-500)' }), hits: bhits }));
    })();
    const total = hits.length;
    return (
        <div className="bg-white border border-[var(--border)] rounded-xl overflow-hidden">
            <button
                type="button"
                onClick={() => setOpen((o) => !o)}
                className="w-full flex items-center justify-between gap-2 px-4 py-3 text-left hover:bg-[var(--background-soft)] cursor-pointer"
            >
                <span className="flex items-center gap-2 min-w-0">
                    <ChevronDown size={15} className={`shrink-0 text-[var(--ink-400)] transition-transform ${open ? '' : '-rotate-90'}`} />
                    <span className="font-semibold text-[var(--ink-900)] text-[13px]">🌟 #{entry.item_number}</span>
                    {entry.item_name && <span className="text-[var(--ink-500)] text-[12.5px] truncate">{entry.item_name}</span>}
                    {entry.intent && entry.intent !== '*' && (
                        <span className="text-[10.5px] text-[var(--ink-500)] bg-[var(--muted)] px-1.5 py-0.5 rounded">{entry.intent}</span>
                    )}
                </span>
                <span className="flex items-center gap-2 shrink-0">
                    {total > 0 ? (
                        <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-semibold bg-[var(--primary-soft)] text-[var(--primary)]">총 {total}건</span>
                    ) : (
                        <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-semibold bg-[var(--muted)] text-[var(--ink-500)]">조회됨 · 0건</span>
                    )}
                    <span className="text-[10.5px] text-[var(--ink-500)] font-mono">{fmtRagTime(entry.ts)}</span>
                </span>
            </button>
            {open && total > 0 && (
                <div className="px-4 pb-4 pt-1 border-t border-[var(--muted)]">
                    {entry.fewshot_query && (
                        <div style={{ marginBottom: 8, padding: '8px 10px', background: 'var(--warning-soft)', borderLeft: '3px solid var(--warning)', borderRadius: 4 }}>
                            <div style={{ fontSize: 9.5, fontWeight: 800, color: 'var(--warning)', letterSpacing: '0.05em', marginBottom: 4, textTransform: 'uppercase' }}>
                                검색어 · sub-agent fewshot
                            </div>
                            <div style={{ fontSize: 11, color: 'var(--warning)', lineHeight: 1.55, whiteSpace: 'pre-wrap', wordBreak: 'break-word', maxHeight: 200, overflowY: 'auto', background: 'rgba(255,255,255,0.6)', padding: '6px 8px', borderRadius: 3 }}>
                                {entry.fewshot_query}
                            </div>
                        </div>
                    )}
                    {groups.map((g) => (
                        <div key={g.bucket} style={{ marginBottom: 12 }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '8px 0 6px 0', paddingBottom: 4, borderBottom: `2px solid ${g.color}`, fontSize: 12, fontWeight: 700, color: g.color }}>
                                <span>{g.label}</span>
                                <span style={{ fontSize: 10, fontWeight: 500, color: 'var(--ink-500)' }}>· {g.hits.length}건</span>
                            </div>
                            {g.hits.map((h, i) => (
                                <RagGoldenCard hit={h} key={h.example_id || i} />
                            ))}
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}

function RagContentCell({ entry }) {
    if (entry.kind === 'forbidden') {
        const matches = Array.isArray(entry.matches) ? entry.matches : [];
        if (matches.length === 0)
            return (
                <span className="inline-flex items-center gap-1 text-[var(--ink-500)]">
                    <span className="text-[11px] font-medium">조회됨</span>
                    <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold bg-[var(--muted)] text-[var(--ink-700)]">0건</span>
                </span>
            );
        return (
            <ul className="space-y-0.5">
                {matches.map((m, i) => (
                    <li key={i} className="text-[12px] text-[var(--ink-700)]">
                        <span className="font-semibold text-[var(--destructive)]">{m.rule_ref || m.term || '—'}</span>
                        {m.verdict && <span className="text-[var(--ink-500)]"> · {m.verdict}</span>}
                        {m.quote && <span className="text-[var(--ink-500)]"> — “{m.quote}”</span>}
                    </li>
                ))}
            </ul>
        );
    }
    const hits = Array.isArray(entry.hits) ? entry.hits : [];
    if (hits.length === 0)
        return (
            <span className="inline-flex items-center gap-1 text-[var(--ink-500)]">
                <span className="text-[11px] font-medium">조회됨</span>
                <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold bg-[var(--primary-soft)] text-[var(--primary)]">0건</span>
            </span>
        );
    return (
        <ul className="space-y-0.5">
            {hits.map((h, i) => (
                <li key={i} className="text-[12px] text-[var(--ink-700)]">
                    <span className="font-semibold text-[var(--primary)]">{h.example_id || '—'}</span>
                    {(h.score !== null && h.score !== undefined) && (
                        <span className="text-[var(--ink-500)]"> ({h.score})</span>
                    )}
                    {h.summary && <span className="text-[var(--ink-500)]"> — {h.summary}</span>}
                </li>
            ))}
        </ul>
    );
}

/* ── LLM 스킬 단계 메타 (통합 피드 스킬 행 칩 + 상세 렌더에서 사용) ────────── */
const SKILL_STAGE_META = {
    collect: { label: '수집', cls: 'bg-[var(--primary-soft)] text-[var(--primary)]' },
    generate: { label: '생성', cls: 'bg-[var(--warning-soft)] text-[var(--warning)]' },
    memory: { label: '메모리', cls: 'bg-[var(--cat-service-soft)] text-[var(--cat-service)]' },
    activate: { label: '활성화', cls: 'bg-[var(--primary-soft)] text-[var(--primary)]' },
    apply: { label: '평가 적용', cls: 'bg-[var(--cat-policy-soft)] text-[var(--cat-policy)]' },
    done: { label: '완료', cls: 'bg-[var(--success-soft)] text-[var(--success)]' },
    error: { label: '오류', cls: 'bg-[var(--destructive-soft)] text-[var(--destructive)]' },
};

/* 메모리 행 펼침 상세 — /api/skill-memory 요약(항목별 정정 이력·패턴·journal·효과) 렌더. */
function MemorySnapshot({ state }) {
    if (!state || state.loading) {
        return (
            <div className="flex items-center gap-2 text-[12px] text-[var(--ink-500)]">
                <Loader2 className="h-4 w-4 animate-spin" /> 메모리 조회 중…
            </div>
        );
    }
    if (state.error) return <p className="text-[12px] text-[var(--destructive)]">{state.error}</p>;
    const d = state.data || {};
    const items = Array.isArray(d.items) ? d.items : [];
    if (!items.length) {
        return <div className="text-[12px] text-[var(--ink-500)]">저장된 메모리가 없습니다. (memory_mode 학습이 아직 없거나 케이스 미유입)</div>;
    }
    return (
        <>
            <div className="text-[11px] font-semibold text-[var(--ink-500)] uppercase tracking-wide mb-2">
                에이전트 메모리 — 현재 DB(qa_skill_memory) 상태{d.updated_at ? ` · ${fmtTime(d.updated_at)} 갱신` : ''} · {d.rubric_id || ''}
            </div>
            <div className="space-y-2">
                {items.map((it) => (
                    <div key={it.item_number} className="bg-white border border-[var(--border)] rounded-lg px-3 py-2">
                        <div className="flex flex-wrap items-center gap-2 text-[12px]">
                            <span className="font-semibold text-[var(--ink-900)]">{it.item_name || `#${it.item_number}`}</span>
                            {it.item_name && <span className="text-[11px] text-[var(--ink-400)]">#{it.item_number}</span>}
                            <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold bg-[var(--muted)] text-[var(--ink-700)]">정정 {it.case_count}건</span>
                            <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-[var(--primary-soft)] text-[var(--primary)]">높음 {it.dir_high}</span>
                            <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-[var(--warning-soft)] text-[var(--warning)]">낮음 {it.dir_low}</span>
                            {it.contested > 0 && (
                                <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold bg-[var(--destructive-soft)] text-[var(--destructive)]">모순 의심 {it.contested}건</span>
                            )}
                            {it.last_learned?.version_id && (
                                <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-mono bg-[var(--muted)] text-[var(--ink-500)]">마지막 학습 {it.last_learned.version_id}</span>
                            )}
                        </div>
                        {Array.isArray(it.patterns) && it.patterns.length > 0 && (
                            <div className="mt-1.5 flex flex-wrap items-center gap-1">
                                <span className="text-[11px] text-[var(--ink-400)]">패턴</span>
                                {it.patterns.map((p, i) => (
                                    <span key={i} className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-[var(--cat-policy-soft)] text-[var(--cat-policy)]">
                                        {p.label}{p.direction ? `(${p.direction})` : ''} {p.count}건
                                    </span>
                                ))}
                            </div>
                        )}
                        {Array.isArray(it.cases) && it.cases.length > 0 && (
                            <div className="mt-1.5 space-y-1 max-h-[200px] overflow-auto">
                                {it.cases.map((c, i) => (
                                    <div key={i} className="text-[11.5px] text-[var(--ink-700)] bg-[var(--background-soft)] border border-[var(--border)] rounded-md px-2.5 py-1.5">
                                        <span className="font-mono text-[var(--ink-900)]">콜 {c.consultation_id || '—'}</span>
                                        <span className={`ml-1.5 font-semibold ${String(c.direction).trim() === '높음' ? 'text-[var(--primary)]' : 'text-[var(--warning)]'}`}>{c.direction}</span>
                                        {c.ai_score != null && <span className="ml-1.5 text-[var(--ink-400)]">AI {c.ai_score}/{c.max_score ?? '—'}</span>}
                                        {c.call_at && <span className="ml-1.5 text-[var(--ink-400)]">{c.call_at}</span>}
                                        {c.evidence && <div className="mt-0.5 font-mono text-[11px] whitespace-pre-wrap break-all">{c.evidence}</div>}
                                        {c.review_reason && <div className="mt-0.5 text-[11px] text-[var(--ink-500)]">검수 사유: {c.review_reason}</div>}
                                    </div>
                                ))}
                            </div>
                        )}
                        {Array.isArray(it.journal) && it.journal.length > 0 && (
                            <div className="mt-1.5 space-y-0.5">
                                <span className="text-[11px] text-[var(--ink-400)]">학습 기록</span>
                                {it.journal.map((j, i) => (
                                    <div key={i} className="text-[11px] text-[var(--ink-500)]">
                                        <span className="font-mono text-[var(--ink-700)]">{j.version_id}</span> · {fmtTime(j.at)} — {j.note}
                                    </div>
                                ))}
                            </div>
                        )}
                        {it.effect && Object.keys(it.effect).length > 0 && (
                            <div className="mt-1.5 flex flex-wrap items-center gap-1">
                                <span className="text-[11px] text-[var(--ink-400)]">버전별 정정 발생(효과)</span>
                                {Object.entries(it.effect).map(([vid, e2]) => (
                                    <span key={vid} className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-mono bg-[var(--muted)] text-[var(--ink-500)]">
                                        {vid}: 높음 {e2?.['높음'] ?? 0} · 낮음 {e2?.['낮음'] ?? 0}
                                    </span>
                                ))}
                            </div>
                        )}
                    </div>
                ))}
            </div>
        </>
    );
}

/* ── 페이지 컨테이너 + 서브탭 ────────────────────────────── */
// RAG·사전 / LLM 스킬 전용 탭 제거(2026-07-08) — 백엔드 활동은 사용자 활동 피드에
// 시간순 통합(행 클릭 토글 상세). 데이터 API 는 관리자 전용(requireAdmin).
const TABS = [
    { id: 'audit', label: '사용자 활동 (Audit)', icon: ListChecks },
    { id: 'app', label: '서버 로그 (App)', icon: Terminal },
];

const Logs = () => {
    const [activeTab, setActiveTab] = useState('audit');

    return (
        <div className="w-full">
            <Header
                title="실시간 로그"
                subtitle={
                    activeTab === 'audit'
                        ? `사용자 활동 audit + 백엔드 활동(RAG 조회 · LLM 스킬) 통합 — ${POLL_INTERVAL_MS / 1000}초마다 자동 갱신. 백엔드 행은 클릭하면 상세가 펼쳐집니다.`
                        : `서버 application 로그 — 오늘 ${APP_LOG_LIMIT}줄을 ${POLL_INTERVAL_MS / 1000}초마다 자동 갱신 (파일 보관 3일).`
                }
                actions={null}
            />

            <div className="flex items-center gap-1.5 mb-4">
                {TABS.map((t) => {
                    const Icon = t.icon;
                    const active = activeTab === t.id;
                    return (
                        <button
                            key={t.id}
                            onClick={() => setActiveTab(t.id)}
                            className={`inline-flex items-center gap-1.5 h-[34px] px-3.5 rounded-full text-[12.5px] font-semibold cursor-pointer transition-colors ${
                                active
                                    ? 'bg-[var(--primary)] text-white shadow-sm'
                                    : 'bg-white border border-[var(--border)] text-[var(--ink-700)] hover:bg-[var(--muted)]'
                            }`}
                        >
                            <Icon size={13} />
                            {t.label}
                        </button>
                    );
                })}
            </div>

            <div className="space-y-3">
                {activeTab === 'audit' ? <AuditPanel /> : <AppPanel />}
            </div>
        </div>
    );
};

export default Logs;
