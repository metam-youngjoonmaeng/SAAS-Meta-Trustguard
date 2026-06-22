import React, { useState, useMemo, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import Header from '../components/Header';
import { PRODUCT_NAME } from '../branding';
import { getBrandConfig } from '../constants';
import {
    fetchGoldenCasesByItem, removeGoldenSet,
    fetchEvalItemDefs, saveEvalItemDef, createEvalItemDef, fetchEvalItemHistory,
    fetchPentagonAxes, savePentagonAxis, createPentagonAxis,
} from '../services/api';
import {
    Plus,
    ChevronRight,
    Save,
    Info,
    Sparkles,
    Star,
    Edit3,
    Trash2,
    X,
    History,
    CheckCircle2,
    AlertTriangle,
} from 'lucide-react';

// ============================================================
// AI 평가항목 관리
//
// 좌측: 체크리스트 / Pentagon 2섹션. 헤더 ✏️ 는 선택 항목 편집,
//       리스트 하단 [+ 새 항목] dashed 박스가 신규 추가 진입점.
// 우측: 선택 항목 미리보기 + [편집하기] (평가 기준·프롬프트).
//
// 영속화:
//  - eval_item_defs (category/item/criterion/prompt_template/pentagon_axis/
//    scoring_type/max_score/is_active + 버전 메타)
//  - pentagon_axes (label/description/prompt_template/is_active + 버전 메타)
//  - 행이 없으면 brandConfig (constants.js) 기본값으로 fallback.
//  - 모든 변경은 eval_item_change_log / pentagon_axis_change_log 에 기록.
// ============================================================

// 브랜드별 Pentagon 5축 키 (구성용) — constants.js 의 radarLabels 사용
const PENTAGON_MOCK_DESC = {
    '인사·본인확인':    '통화 도입부의 인사·소속·본인 확인 절차 품질',
    '응대 화법·음성':   '발화 속도·어조·언어 표현의 적절성',
    '경청·공감 응대':   '회원의 상황·감정에 대한 경청·공감·호응 수준',
    '업무 정확도':      '요청·약속 건의 정확한 처리 여부',
    '사후 처리':        '통화 종료 후 이력 등록·후속 처리 품질',
    '오프닝 및 목적 안내': '통화 도입부의 인사·소속·통화 목적 안내 품질',
    '설명 명확성':      '상품·서비스 설명의 명확성과 이해 용이성',
    '준수·고지 품질':   '법정·필수 안내 사항 이행 및 컴플라이언스 수준',
    '대화·경청 품질':   '고객 발화에 대한 경청·반응·재확인 품질',
    '발화 안정성':      '발음·속도·억양 등 발화 안정성 종합',
};

const EvalItems = ({ activeBrandId }) => {
    const brandConfig = useMemo(() => getBrandConfig(activeBrandId), [activeBrandId]);
    const items = brandConfig.checklistTemplate;
    const axes = brandConfig.radarLabels;
    const departments = brandConfig.departments || [];

    const [selection, setSelection] = useState({ kind: 'item', idx: 0 });
    const [modal, setModal] = useState(null);
    // modal = null | { type: 'new-item' } | { type: 'edit-item', item } | { type: 'edit-axis', axis, idx }

    // 백엔드 평가 루브릭 동기화 결과 토스트. '기본' 부서 저장 응답의 rubric_sync 필드 소비.
    // rubric_sync 부재(undefined)면 토스트 미표시 — 저장 자체 성공/실패와 무관(additive).
    const [rubricSyncToast, setRubricSyncToast] = useState(null);
    const handleRubricSync = useCallback((rubricSync) => {
        if (!rubricSync) return;
        if (rubricSync.ok) {
            const warns = Array.isArray(rubricSync.warnings) ? rubricSync.warnings.filter(Boolean) : [];
            setRubricSyncToast({
                tone: 'success',
                message: '백엔드 평가 루브릭에 반영됨',
                detail: warns.length ? warns.join(' · ') : '',
            });
        } else {
            setRubricSyncToast({
                tone: 'error',
                message: '저장됨 — 백엔드 동기화 실패(다음 저장/평가 시 재시도)',
                detail: rubricSync.error || '',
            });
        }
    }, []);
    useEffect(() => {
        if (!rubricSyncToast) return undefined;
        const t = window.setTimeout(() => setRubricSyncToast(null), 5000);
        return () => window.clearTimeout(t);
    }, [rubricSyncToast]);

    // 평가항목 정의(criterion + prompt_template + 메타)는 (org_id, department, order_no, version) 키로 DB 에 저장.
    // 체크리스트는 '기본' 스코프 한정으로 fetch — KSQI(department='KSQI') 등 동일 org_id 의
    // 타 부서 행이 order_no 1~9 로 섞여 들어와 미리보기 오염·편집 시 cross-scope 오변경되는 것을 차단.
    // 한 번 fetch 해서 order_no → def 매핑으로 보관. 신규 항목 추가/편집 시 갱신.
    const [evalDefsByOrderNo, setEvalDefsByOrderNo] = useState({});
    const [defsReloadKey, setDefsReloadKey] = useState(0);
    useEffect(() => {
        let cancelled = false;
        fetchEvalItemDefs({ department: '기본' })
            .then((res) => {
                if (cancelled) return;
                const list = Array.isArray(res?.items) ? res.items : [];
                const map = {};
                for (const d of list) map[d.order_no] = d;
                setEvalDefsByOrderNo(map);
            })
            .catch(() => { if (!cancelled) setEvalDefsByOrderNo({}); });
        return () => { cancelled = true; };
    }, [activeBrandId, defsReloadKey]);

    const upsertEvalDef = (def) => {
        setEvalDefsByOrderNo((prev) => ({ ...prev, [def.order_no]: def }));
    };
    const reloadDefs = () => setDefsReloadKey((k) => k + 1);

    // Pentagon 축 정의 — 행이 있으면 SSOT, 없으면 brandConfig.radarLabels fallback.
    const [pentagonAxesByNo, setPentagonAxesByNo] = useState({});
    const [axesReloadKey, setAxesReloadKey] = useState(0);
    useEffect(() => {
        let cancelled = false;
        fetchPentagonAxes()
            .then((res) => {
                if (cancelled) return;
                const list = Array.isArray(res?.axes) ? res.axes : [];
                const map = {};
                for (const a of list) map[a.axis_no] = a;
                setPentagonAxesByNo(map);
            })
            .catch(() => { if (!cancelled) setPentagonAxesByNo({}); });
        return () => { cancelled = true; };
    }, [activeBrandId, axesReloadKey]);
    const reloadAxes = () => setAxesReloadKey((k) => k + 1);

    // brandConfig.radarLabels 와 DB pentagon_axes 를 머지. DB 행 있으면 라벨 override.
    const effectiveAxes = useMemo(() => {
        return axes.map((label, idx) => {
            const dbAxis = pentagonAxesByNo[idx + 1];
            return dbAxis?.label || label;
        });
    }, [axes, pentagonAxesByNo]);

    const selectedItem = selection.kind === 'item' ? items[selection.idx] : null;
    const selectedAxis = selection.kind === 'axis'
        ? { label: effectiveAxes[selection.idx], idx: selection.idx, dbAxis: pentagonAxesByNo[selection.idx + 1] || null }
        : null;

    return (
        <div className="pb-10 w-full">
            <Header
                title={`${PRODUCT_NAME} · AI 평가항목 관리`}
                subtitle="체크리스트 항목과 Pentagon 5축의 라벨·기준·프롬프트를 한 곳에서 관리합니다."
                actions={
                    <button
                        type="button"
                        onClick={() => setModal({ type: 'history' })}
                        className="flex items-center gap-2 px-5 py-2 bg-white border border-[#D0D5DD] rounded-lg text-sm font-semibold text-[#344054] hover:bg-[#F9FAFB] shadow-sm transition-all"
                    >
                        <History size={15} />
                        변경 이력
                    </button>
                }
            />

            <div
                className="grid gap-5"
                style={{
                    gridTemplateColumns: '320px minmax(0, 1fr)',
                    height: 'calc(100vh - 220px)',
                    minHeight: 600,
                }}
            >
                {/* ── 좌측 ── */}
                <div className="bg-white border border-[#E4E7EC] rounded-xl shadow-[0_1px_2px_rgba(16,24,40,0.04)] flex flex-col overflow-hidden">
                    {/* 섹션 1: 체크리스트 */}
                    {/* 체크리스트는 남는 공간을 모두 차지하고(많으면 내부 스크롤),
                        Pentagon 은 내용 높이에 맞춰(5축+추가 항상 노출, 스크롤 없음). */}
                    <div className="flex flex-col min-h-0" style={{ flex: '1 1 0%' }}>
                        <SectionHeader
                            title="체크리스트 평가항목"
                            count={`${items.length}개`}
                            onEdit={() => selectedItem && setModal({ type: 'edit-item', item: selectedItem })}
                            editDisabled={!selectedItem}
                            editTitle={selectedItem ? `${selectedItem.item} 편집` : '편집할 항목을 먼저 선택하세요'}
                        />
                        <div className="flex-1 overflow-y-auto p-2 min-h-0">
                            {items.map((it, idx) => {
                                const on = selection.kind === 'item' && selection.idx === idx;
                                return (
                                    <ItemRow
                                        key={`item-${idx}`}
                                        orderNo={it.order_no}
                                        category={it.category}
                                        label={it.item}
                                        selected={on}
                                        onSelect={() => setSelection({ kind: 'item', idx })}
                                        onEdit={() => setModal({ type: 'edit-item', item: it })}
                                    />
                                );
                            })}
                            <AddBox
                                label="새 평가항목 추가"
                                onClick={() => setModal({ type: 'new-item' })}
                            />
                        </div>
                    </div>

                    {/* 섹션 2: Pentagon — 내용 높이에 맞춰 고정(축이 적어도 스크롤 없이 전부 노출) */}
                    <div className="flex flex-col shrink-0 border-t-[6px] border-[#F2F4F7]" style={{ flex: '0 0 auto' }}>
                        <SectionHeader
                            title="Pentagon 평가항목"
                            count={`${effectiveAxes.length}축`}
                            onEdit={() => selectedAxis && setModal({ type: 'edit-axis', label: selectedAxis.label, idx: selectedAxis.idx, dbAxis: selectedAxis.dbAxis })}
                            editDisabled={!selectedAxis}
                            editTitle={selectedAxis ? `${selectedAxis.label} 편집` : '편집할 축을 먼저 선택하세요'}
                        />
                        <div className="p-2">
                            {effectiveAxes.map((label, idx) => {
                                const on = selection.kind === 'axis' && selection.idx === idx;
                                return (
                                    <AxisRow
                                        key={`axis-${idx}`}
                                        axisNo={idx + 1}
                                        label={label}
                                        selected={on}
                                        onSelect={() => setSelection({ kind: 'axis', idx })}
                                        onEdit={() => setModal({ type: 'edit-axis', label, idx, dbAxis: pentagonAxesByNo[idx + 1] || null })}
                                    />
                                );
                            })}
                            <AddBox
                                label="새 Pentagon 축 추가"
                                onClick={() => setModal({ type: 'new-axis' })}
                            />
                        </div>
                    </div>

                </div>

                {/* ── 우측: 선택 항목 미리보기 ── */}
                {selectedItem ? (
                    <ItemPreview
                        item={selectedItem}
                        activeBrandId={activeBrandId}
                        def={evalDefsByOrderNo[selectedItem.order_no]}
                        onEdit={() => setModal({ type: 'edit-prompt', item: selectedItem })}
                    />
                ) : selectedAxis ? (
                    <AxisPreview
                        axisNo={selectedAxis.idx + 1}
                        label={selectedAxis.label}
                        dbAxis={selectedAxis.dbAxis}
                        onEdit={() => setModal({ type: 'edit-axis', label: selectedAxis.label, idx: selectedAxis.idx, dbAxis: selectedAxis.dbAxis })}
                    />
                ) : (
                    <div className="bg-white border border-[#E4E7EC] rounded-xl flex items-center justify-center text-[13px] text-[#667085]">
                        좌측에서 항목을 선택하세요
                    </div>
                )}
            </div>

            {/* ── 모달 ── */}
            {modal?.type === 'new-item' && (
                <ItemModal
                    mode="new"
                    axes={effectiveAxes}
                    departments={departments}
                    onSaved={() => { reloadDefs(); }}
                    onRubricSync={handleRubricSync}
                    onClose={() => setModal(null)}
                />
            )}
            {modal?.type === 'edit-item' && (
                <ItemModal
                    mode="edit"
                    item={modal.item}
                    existingDef={evalDefsByOrderNo[modal.item.order_no]}
                    axes={effectiveAxes}
                    departments={departments}
                    onSaved={(def) => { if (def) upsertEvalDef(def); else reloadDefs(); }}
                    onRubricSync={handleRubricSync}
                    onClose={() => setModal(null)}
                />
            )}
            {modal?.type === 'edit-prompt' && (
                <PromptEditModal
                    item={modal.item}
                    existingDef={evalDefsByOrderNo[modal.item.order_no]}
                    onSaved={upsertEvalDef}
                    onRubricSync={handleRubricSync}
                    onClose={() => setModal(null)}
                />
            )}
            {modal?.type === 'new-axis' && (
                <AxisModal
                    mode="new"
                    nextAxisNo={effectiveAxes.length + 1}
                    onSaved={() => { reloadAxes(); }}
                    onClose={() => setModal(null)}
                />
            )}
            {modal?.type === 'edit-axis' && (
                <AxisModal
                    mode="edit"
                    axisNo={modal.idx + 1}
                    label={modal.label}
                    dbAxis={modal.dbAxis}
                    onSaved={() => { reloadAxes(); }}
                    onClose={() => setModal(null)}
                />
            )}
            {modal?.type === 'history' && (
                <HistoryModal departments={departments} onClose={() => setModal(null)} />
            )}

            {/* 백엔드 평가 루브릭 동기화 토스트 — 우하단 고정. rubric_sync.ok 에 따라 성공/실패 톤. */}
            {rubricSyncToast && (
                <div className="fixed bottom-6 right-6 z-[120] max-w-[360px] animate-fade-in">
                    <div
                        className={`flex items-start gap-2.5 px-4 py-3 rounded-xl shadow-lg border text-[12.5px] ${
                            rubricSyncToast.tone === 'success'
                                ? 'bg-[#ECFDF3] border-[#A6F4C5] text-[#067647]'
                                : 'bg-[#FFFBFA] border-[#FDA29B] text-[#B42318]'
                        }`}
                    >
                        {rubricSyncToast.tone === 'success' ? (
                            <CheckCircle2 size={16} className="mt-0.5 shrink-0" />
                        ) : (
                            <AlertTriangle size={16} className="mt-0.5 shrink-0" />
                        )}
                        <div className="flex-1 min-w-0">
                            <div className="font-semibold">{rubricSyncToast.message}</div>
                            {rubricSyncToast.detail && (
                                <div className="mt-0.5 text-[11.5px] opacity-80 break-words">{rubricSyncToast.detail}</div>
                            )}
                        </div>
                        <button
                            type="button"
                            onClick={() => setRubricSyncToast(null)}
                            className="shrink-0 text-current opacity-60 hover:opacity-100"
                            aria-label="닫기"
                        >
                            <X size={14} />
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
};

/* ── 좌측 섹션 헤더 ───────────────────────────────────────────── */

function SectionHeader({ title, count, onEdit, editDisabled, editTitle, extra }) {
    // 헤더 버튼은 "선택 항목 편집" 고정. 추가는 리스트 하단 AddBox 에서 진입.
    // extra: 편집 버튼 우측 부가 액션 슬롯 (예: KSQI 섹션 접기 토글).
    return (
        <div className="px-5 py-3 border-b border-[#F2F4F7] bg-[#FAFBFC] flex items-center gap-2">
            <h3 className="text-[13px] font-bold text-[#101828] tracking-tight">{title}</h3>
            <span className="text-[11.5px] text-[#667085] font-medium">{count}</span>
            <button
                type="button"
                onClick={editDisabled ? undefined : onEdit}
                disabled={editDisabled}
                title={editTitle}
                className={`ml-auto w-7 h-7 grid place-items-center rounded-md transition-colors ${
                    editDisabled
                        ? 'text-[#D0D5DD] cursor-not-allowed'
                        : 'text-[#055AAF] hover:bg-[#EEF4FB] hover:text-[#1E70E0] cursor-pointer'
                }`}
            >
                <Edit3 size={14} strokeWidth={2.2} />
            </button>
            {extra || null}
        </div>
    );
}

/* ── 리스트 하단 추가 박스 ──────────────────────────────────── */

function AddBox({ label, onClick }) {
    return (
        <button
            type="button"
            onClick={onClick}
            className="w-full mt-1.5 mb-1 flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-lg border border-dashed border-[#D0D5DD] bg-white text-[12.5px] font-semibold text-[#667085] hover:border-[#055AAF] hover:text-[#055AAF] hover:bg-[#F7FAFD] transition-colors cursor-pointer"
        >
            <Plus size={13} strokeWidth={2.5} />
            {label}
        </button>
    );
}

/* ── 좌측 리스트 행 ───────────────────────────────────────────── */

function ItemRow({ orderNo, category, label, selected, onSelect, onEdit, inactive = false }) {
    return (
        <div
            onClick={onSelect}
            className={`group relative flex items-center gap-2 px-3 py-2.5 rounded-lg mb-0.5 transition-colors cursor-pointer ${
                selected ? 'bg-[#EEF4FB]' : 'hover:bg-[#F9FAFB]'
            }`}
        >
            <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5 mb-0.5">
                    <span className="text-[10px] font-bold text-[#98A2B3] tabular-nums">#{String(orderNo).padStart(2, '0')}</span>
                    <span className="text-[10px] font-semibold text-[#667085] truncate">{category}</span>
                    {inactive && (
                        <span className="text-[9px] font-bold px-1 py-0.5 rounded bg-[#F2F4F7] text-[#98A2B3]">비활성</span>
                    )}
                </div>
                <div className={`text-[12.5px] font-bold truncate ${
                    inactive ? 'text-[#98A2B3]' : selected ? 'text-[#055AAF]' : 'text-[#101828]'
                }`}>
                    {label}
                </div>
            </div>
            <button
                type="button"
                onClick={(e) => {
                    e.stopPropagation();
                    onEdit();
                }}
                title="편집"
                className="w-6 h-6 grid place-items-center rounded-md text-[#98A2B3] hover:bg-white hover:text-[#055AAF] hover:shadow-sm transition-all cursor-pointer"
            >
                <ChevronRight size={14} />
            </button>
        </div>
    );
}

function AxisRow({ axisNo, label, selected, onSelect, onEdit }) {
    const numChar = ['①', '②', '③', '④', '⑤'][axisNo - 1];
    return (
        <div
            onClick={onSelect}
            className={`group relative flex items-center gap-2 px-3 py-2.5 rounded-lg mb-0.5 transition-colors cursor-pointer ${
                selected ? 'bg-[#EEF4FB]' : 'hover:bg-[#F9FAFB]'
            }`}
        >
            <span className={`text-[14px] font-bold tabular-nums ${selected ? 'text-[#055AAF]' : 'text-[#98A2B3]'}`}>{numChar}</span>
            <div className={`flex-1 text-[12.5px] font-bold truncate ${selected ? 'text-[#055AAF]' : 'text-[#101828]'}`}>
                {label}
            </div>
            <button
                type="button"
                onClick={(e) => {
                    e.stopPropagation();
                    onEdit();
                }}
                title="편집"
                className="w-6 h-6 grid place-items-center rounded-md text-[#98A2B3] hover:bg-white hover:text-[#055AAF] hover:shadow-sm transition-all cursor-pointer"
            >
                <ChevronRight size={14} />
            </button>
        </div>
    );
}

/* ── 우측 미리보기 ────────────────────────────────────────────── */

function ItemPreview({ item, activeBrandId, def, onEdit }) {
    const maxPoints = parsePoints(item.validation_time);
    const [tab, setTab] = useState('overview'); // 'overview' | 'golden'
    const [goldenCases, setGoldenCases] = useState([]);
    const [goldenLoading, setGoldenLoading] = useState(false);
    const [goldenError, setGoldenError] = useState(null);

    // 골든셋은 DB 연동(api.fetchGoldenCasesByItem). Mock 데이터 절대 사용 금지.
    useEffect(() => {
        let cancelled = false;
        setGoldenLoading(true);
        setGoldenError(null);
        fetchGoldenCasesByItem({
            orderNo: item.order_no,
            category: item.category,
            item: item.item,
        })
            .then((res) => {
                if (cancelled) return;
                setGoldenCases(Array.isArray(res?.entries) ? res.entries : []);
            })
            .catch((err) => {
                if (cancelled) return;
                setGoldenCases([]);
                setGoldenError(err?.message || '골든셋 사례를 불러오지 못했습니다.');
            })
            .finally(() => {
                if (cancelled) return;
                setGoldenLoading(false);
            });
        return () => { cancelled = true; };
    }, [item.order_no, item.category, item.item, activeBrandId]);

    // 항목 바뀌면 탭 기본값(개요)으로 복귀
    useEffect(() => { setTab('overview'); }, [item.order_no]);

    return (
        <div className="bg-white border border-[#E4E7EC] rounded-xl shadow-[0_1px_2px_rgba(16,24,40,0.04)] flex flex-col overflow-hidden">
            <div className="px-5 py-3.5 border-b border-[#F2F4F7] bg-[#FAFBFC] flex items-center gap-3">
                <h3 className="text-[14px] font-bold text-[#101828] tracking-tight truncate">{def?.item || item.item}</h3>
                <span className="text-[11.5px] text-[#667085]">{def?.category || item.category}</span>
                {(def?.is_active ?? true) ? (
                    <span className="text-[10.5px] font-bold px-1.5 py-0.5 rounded bg-[#E8F6ED] text-[#2F9759]">활성</span>
                ) : (
                    <span className="text-[10.5px] font-bold px-1.5 py-0.5 rounded bg-[#F2F4F7] text-[#667085]">비활성</span>
                )}
                <button
                    type="button"
                    onClick={onEdit}
                    className="ml-auto h-[32px] px-3.5 rounded-full bg-[#055AAF] text-white text-[12px] font-semibold hover:bg-[#1E70E0] shadow-sm inline-flex items-center gap-1.5 cursor-pointer"
                >
                    <Edit3 size={12} />편집하기
                </button>
            </div>

            <div className="px-5 py-2.5 bg-[#FAFBFC] border-b border-[#F2F4F7] flex items-center gap-3 flex-wrap text-[12px] text-[#667085]">
                <MetaPair label="채점 방식" value={def?.scoring_type === 'yes_no' ? 'Y/N' : '점수제'} />
                <MetaDivider />
                <MetaPair label="만점" value={def?.scoring_type === 'yes_no' ? '1점' : `${def?.max_score ?? maxPoints}점`} />
                <MetaDivider />
                <MetaPair label="순서" value={`#${String(item.order_no).padStart(2, '0')}`} />
                <MetaDivider />
                <MetaPair label="Pentagon" value={def?.pentagon_axis || '매핑 없음'} />
            </div>

            {/* 탭 */}
            <div className="flex px-5 border-b border-[#E4E7EC]">
                <PreviewTab
                    active={tab === 'overview'}
                    onClick={() => setTab('overview')}
                    label="개요"
                />
                <PreviewTab
                    active={tab === 'golden'}
                    onClick={() => setTab('golden')}
                    label="골든셋 사례"
                    count={goldenLoading ? null : goldenCases.length}
                />
            </div>

            <div className="flex-1 overflow-y-auto p-5 min-h-0">
                {tab === 'overview' ? (
                    <div className="flex flex-col gap-5 h-full min-h-0">
                        <PreviewSection title="평가 기준">
                            {def?.criterion ? (
                                <div className="text-[13px] text-[#475467] leading-relaxed whitespace-pre-wrap">{def.criterion}</div>
                            ) : (
                                <div className="text-[13px] text-[#98A2B3] italic leading-relaxed">
                                    아직 설정된 평가 기준이 없습니다. 우상단 편집하기에서 입력하세요.
                                </div>
                            )}
                        </PreviewSection>

                        <div className="flex flex-col flex-1 min-h-0">
                            <div className="text-[10.5px] font-bold text-[#98A2B3] tracking-[0.06em] uppercase mb-2">평가 프롬프트</div>
                            <pre className="flex-1 min-h-0 text-[12px] font-mono text-[#475467] leading-relaxed whitespace-pre-wrap bg-[#FAFBFC] border border-[#E4E7EC] rounded-lg p-3 overflow-auto">{def?.prompt_template ? def.prompt_template : `당신은 콜센터 상담 품질을 평가하는 AI입니다.
아래 상담 전사를 읽고 "${item.item}" 항목을 평가하세요.

평가 기준:
• (이 항목에 적용할 세부 기준을 입력하세요)

출력 형식:
{
  "score": <0-${maxPoints}>,
  "reasoning": "<2-3문장 근거>"
}`}</pre>
                        </div>
                    </div>
                ) : (
                    <GoldenSetPreview
                        cases={goldenCases}
                        loading={goldenLoading}
                        error={goldenError}
                        onDelete={async (c) => {
                            await removeGoldenSet(c.qa_id, c.order_no);
                            setGoldenCases((prev) => prev.filter((x) =>
                                (x.golden_id ?? `${x.qa_id}-${x.order_no}`) !==
                                (c.golden_id ?? `${c.qa_id}-${c.order_no}`)
                            ));
                        }}
                    />
                )}
            </div>
        </div>
    );
}

function PreviewTab({ active, onClick, label, count }) {
    return (
        <button
            type="button"
            onClick={onClick}
            className={`relative py-3 mr-6 text-[13px] inline-flex items-center gap-2 transition-colors border-b-2 -mb-px cursor-pointer ${
                active
                    ? 'text-[#055AAF] font-bold border-[#055AAF]'
                    : 'text-[#667085] font-semibold border-transparent hover:text-[#101828]'
            }`}
        >
            <span>{label}</span>
            {count !== undefined && count !== null && (
                <span
                    className={`tabular-nums px-1.5 py-0.5 rounded-full text-[10.5px] font-bold min-w-[18px] text-center ${
                        active ? 'bg-[#EEF4FB] text-[#055AAF]' : 'bg-[#F2F4F7] text-[#667085]'
                    }`}
                >
                    {count}
                </span>
            )}
        </button>
    );
}

function AxisPreview({ axisNo, label, dbAxis, onEdit }) {
    const numChar = ['①', '②', '③', '④', '⑤', '⑥', '⑦', '⑧', '⑨', '⑩'][axisNo - 1] || `#${axisNo}`;
    // 설명: DB 행이 있으면 그 값, 없으면 정적 mock desc fallback.
    const desc = dbAxis?.description || PENTAGON_MOCK_DESC[label] || '(이 축이 측정하는 영역에 대한 설명을 입력하세요)';
    const isActive = dbAxis?.is_active ?? true;
    return (
        <div className="bg-white border border-[#E4E7EC] rounded-xl shadow-[0_1px_2px_rgba(16,24,40,0.04)] flex flex-col overflow-hidden">
            <div className="px-5 py-3.5 border-b border-[#F2F4F7] bg-[#FAFBFC] flex items-center gap-3">
                <span className="text-[18px] font-bold text-[#055AAF] tabular-nums">{numChar}</span>
                <h3 className="text-[14px] font-bold text-[#101828] tracking-tight truncate">{label}</h3>
                {isActive ? (
                    <span className="text-[10.5px] font-bold px-1.5 py-0.5 rounded bg-[#E8F6ED] text-[#2F9759]">활성</span>
                ) : (
                    <span className="text-[10.5px] font-bold px-1.5 py-0.5 rounded bg-[#F2F4F7] text-[#667085]">비활성</span>
                )}
                <button
                    type="button"
                    onClick={onEdit}
                    className="ml-auto h-[32px] px-3.5 rounded-full bg-[#055AAF] text-white text-[12px] font-semibold hover:bg-[#1E70E0] shadow-sm inline-flex items-center gap-1.5 cursor-pointer"
                >
                    <Edit3 size={12} />편집하기
                </button>
            </div>

            <div className="px-5 py-2.5 bg-[#FAFBFC] border-b border-[#F2F4F7] flex items-center gap-3 flex-wrap text-[12px] text-[#667085]">
                <MetaPair label="축 번호" value={`${numChar} (${axisNo})`} />
                <MetaDivider />
                <MetaPair label="등급 척도" value="우수 / 보통 / 주의 / 실패" />
                {dbAxis?.version && (<><MetaDivider /><MetaPair label="버전" value={`v${dbAxis.version}`} /></>)}
            </div>

            <div className="flex-1 overflow-y-auto p-5 space-y-5">
                <PreviewSection title="설명">
                    <div className="text-[13px] text-[#475467] leading-relaxed">{desc}</div>
                </PreviewSection>

                <PreviewSection title="평가 프롬프트">
                    <div className="text-[12px] text-[#055AAF] bg-[#EEF4FB] border border-[#BFD4F2] rounded-md px-3 py-2 mb-2.5 inline-flex items-start gap-2">
                        <Info size={12} className="mt-0.5 shrink-0" />
                        <span>이 축의 종합 등급·요약을 생성하는 메타 프롬프트입니다. 개별 항목 채점은 체크리스트 항목에서 설정합니다.</span>
                    </div>
                    <pre className="text-[12px] font-mono text-[#475467] leading-relaxed whitespace-pre-wrap bg-[#FAFBFC] border border-[#E4E7EC] rounded-lg p-3">{`이 축에 매핑된 체크리스트 결과와 상담 전사를 바탕으로
"${label}" 영역의 종합 등급·분석·요약을 생성하세요.

출력 형식:
{
  "rating": "<우수|보통|주의|실패>",
  "analysis": "<3-5문장 종합 분석>",
  "summary": "<1-2문장 요약>"
}`}</pre>
                </PreviewSection>
            </div>
        </div>
    );
}

function PreviewSection({ title, children }) {
    return (
        <div>
            <div className="text-[10.5px] font-bold text-[#98A2B3] tracking-[0.06em] uppercase mb-2">{title}</div>
            {children}
        </div>
    );
}

function MetaPair({ label, value }) {
    return (
        <span className="inline-flex items-center gap-1.5">
            <span className="text-[#98A2B3] font-semibold">{label}</span>
            <span className="text-[#344054] font-semibold">{value}</span>
        </span>
    );
}

function MetaDivider() {
    return <span className="w-px h-3 bg-[#E4E7EC]" />;
}

function formatGoldenAddedAt(value) {
    if (!value) return '';
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return '';
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    const hh = String(d.getHours()).padStart(2, '0');
    const mi = String(d.getMinutes()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd} ${hh}:${mi}`;
}

function GoldenSetPreview({ cases, loading, error, onDelete }) {
    const [confirmTarget, setConfirmTarget] = useState(null);
    const [deleting, setDeleting] = useState(false);
    const [deleteError, setDeleteError] = useState(null);

    if (loading) {
        return (
            <div className="py-8 px-6 text-center rounded-xl border border-dashed border-[#E4E7EC] bg-[#FAFBFC]">
                <div className="text-[12.5px] text-[#667085]">불러오는 중…</div>
            </div>
        );
    }
    if (error) {
        return (
            <div className="py-8 px-6 text-center rounded-xl border border-dashed border-[#FDA29B] bg-[#FFFBFA]">
                <div className="text-[12.5px] text-[#B42318]">{error}</div>
            </div>
        );
    }
    if (!cases || cases.length === 0) {
        return (
            <div className="py-8 px-6 text-center rounded-xl border border-dashed border-[#E4E7EC] bg-[#FAFBFC]">
                <Star size={18} className="text-[#98A2B3] mx-auto mb-2" />
                <div className="text-[12.5px] text-[#667085]">등록된 사례가 없습니다</div>
            </div>
        );
    }
    return (
        <>
            <div className="grid gap-2.5">
                {cases.map((c) => (
                    <div
                        key={c.golden_id ?? `${c.qa_id}-${c.order_no}`}
                        className="grid gap-4 p-4 rounded-xl bg-white border border-[#E4E7EC]"
                        style={{ gridTemplateColumns: '1fr 140px' }}
                    >
                        <div className="min-w-0">
                            <div className="text-[10px] font-bold text-[#98A2B3] tracking-[0.06em] uppercase mb-1.5">발화 내용</div>
                            <div
                                className="px-3 py-2.5 text-[12.5px] text-[#475467] italic leading-relaxed rounded-r-lg mb-2.5"
                                style={{ background: '#FAFBFC', borderLeft: '3px solid #D0D5DD' }}
                            >
                                "{c.agent_utterance}"
                            </div>
                            <div className="text-[10px] font-bold text-[#98A2B3] tracking-[0.06em] uppercase mb-1 inline-flex items-center gap-1">
                                <Sparkles size={10} />AI 평가 사유
                            </div>
                            <div className="text-[12.5px] text-[#475467] leading-relaxed">{c.reason_text}</div>
                            {(c.display_name || c.login_id || c.created_at) && (
                                <div className="mt-2.5 pt-2 border-t border-[#F2F4F7] text-[10.5px] text-[#98A2B3]">
                                    {(c.display_name || c.login_id || '알 수 없음')}
                                    {c.created_at && (
                                        <span className="ml-1.5 tabular-nums">· {formatGoldenAddedAt(c.created_at)}</span>
                                    )}
                                    <span className="ml-1">추가</span>
                                </div>
                            )}
                        </div>
                        <div className="flex flex-col gap-2 self-start">
                            <div className="flex flex-col gap-0.5 px-3 py-2 rounded-lg bg-[#F9FAFB] border border-[#E4E7EC]">
                                <div className="text-[9.5px] font-bold text-center text-[#667085] inline-flex items-center justify-center gap-1">
                                    <Star size={9} className="text-[#98A2B3]" />평가 일치
                                </div>
                                <div className="text-center font-mono text-[16px] font-bold text-[#344054] tabular-nums">
                                    {c.score}
                                </div>
                            </div>
                            <button
                                type="button"
                                onClick={() => { setDeleteError(null); setConfirmTarget(c); }}
                                className="inline-flex items-center justify-center gap-1 h-[28px] px-3 rounded-lg border border-red-200 bg-white text-[12px] font-semibold text-red-600 hover:bg-red-50 cursor-pointer"
                            >
                                <Trash2 size={11} /> 삭제
                            </button>
                        </div>
                    </div>
                ))}
            </div>

            {confirmTarget && (
                <ModalShell title="골든셋 사례 삭제" onClose={() => !deleting && setConfirmTarget(null)} widthClass="max-w-[440px]">
                    <div className="px-6 py-5 space-y-3">
                        <div className="text-[13px] text-[#344054] leading-relaxed">
                            한번 삭제한 골든셋은 <span className="font-bold text-[#D92D20]">복구할 수 없습니다</span>.<br />
                            정말 삭제하시겠습니까?
                        </div>
                        <div
                            className="px-3 py-2.5 text-[12px] text-[#475467] italic leading-relaxed rounded-r-lg truncate"
                            style={{ background: '#FAFBFC', borderLeft: '3px solid #D0D5DD' }}
                            title={confirmTarget.agent_utterance}
                        >
                            "{confirmTarget.agent_utterance}"
                        </div>
                        {deleteError && (
                            <div className="text-[12px] text-[#B42318]">{deleteError}</div>
                        )}
                    </div>
                    <ModalFooter
                        onCancel={() => !deleting && setConfirmTarget(null)}
                        primaryLabel={deleting ? '삭제 중…' : '삭제'}
                        primaryTone="danger"
                        onPrimary={async () => {
                            if (deleting) return;
                            setDeleting(true);
                            setDeleteError(null);
                            try {
                                await onDelete(confirmTarget);
                                setConfirmTarget(null);
                            } catch (err) {
                                setDeleteError(err?.message || '삭제에 실패했습니다.');
                            } finally {
                                setDeleting(false);
                            }
                        }}
                    />
                </ModalShell>
            )}
        </>
    );
}

/* ── 변경 이력 ─────────────────────────────────────────────── */

const CHANGE_TYPE_LABEL = {
    create:                  '항목 생성',
    new_version:             '새 버전 발행 (의미 변경)',
    deactivate:              '항목 비활성화',
    reactivate:              '항목 재활성화',
    item_rename:             '항목명/대분류 변경',
    pentagon_axis_update:    'Pentagon 매핑 변경',
    scoring_update:          '채점 방식/만점 변경',
    criterion_prompt_update: '평가 기준 + 프롬프트 수정',
    prompt_update:           '평가 프롬프트 수정',
    criterion_update:        '평가 기준 수정',
};

const FIELD_LABEL = {
    category:        '대분류',
    item:            '항목명',
    criterion:       '평가 기준',
    prompt_template: '평가 프롬프트',
    pentagon_axis:   'Pentagon 매핑',
    scoring_type:    '채점 방식',
    max_score:       '만점',
    is_active:       '활성 여부',
    version:         '버전',
};

function formatChangedAt(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function HistoryModal({ departments = [], onClose }) {
    const [deptFilter, setDeptFilter] = useState('');       // '' = 전체 부서
    const [typeFilter, setTypeFilter] = useState('');       // '' = 전체 변경 종류
    const [entries, setEntries] = useState([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);
    const [expanded, setExpanded] = useState(null);

    useEffect(() => {
        let cancelled = false;
        setLoading(true);
        setError(null);
        fetchEvalItemHistory({
            department: deptFilter || undefined,
            changeType: typeFilter || undefined,
            limit: 300,
        })
            .then((res) => {
                if (cancelled) return;
                setEntries(Array.isArray(res?.entries) ? res.entries : []);
            })
            .catch((err) => {
                if (cancelled) return;
                setEntries([]);
                setError(err?.message || '변경 이력을 불러오지 못했습니다.');
            })
            .finally(() => {
                if (cancelled) return;
                setLoading(false);
            });
        return () => { cancelled = true; };
    }, [deptFilter, typeFilter]);

    // 같은 (department, order_no) 의 직전(더 과거) 변경 timestamp 찾기 — diff 의 "이전 시점" 표시용
    const prevChangeByEntry = useMemo(() => {
        const map = new Map();
        const sortedAsc = [...entries].sort(
            (a, b) => new Date(a.changed_at) - new Date(b.changed_at)
        );
        const lastByKey = new Map(); // key → 직전 changed_at
        for (const e of sortedAsc) {
            const key = `${e.department}#${e.order_no}`;
            const prev = lastByKey.get(key) || null;
            map.set(e.id, prev);
            lastByKey.set(key, e.changed_at);
        }
        return map;
    }, [entries]);

    return (
        <ModalShell title="평가항목 변경 이력" onClose={onClose} widthClass="max-w-[920px]">
            {/* 필터 바 */}
            <div className="px-6 py-3 border-b border-[#F2F4F7] bg-[#FAFBFC] flex items-center gap-2 flex-wrap text-[12px]">
                <span className="text-[10.5px] font-bold text-[#667085] tracking-[0.06em] uppercase mr-1">부서</span>
                <button type="button" onClick={() => setDeptFilter('')} className={chipBtn(deptFilter === '')}>전체</button>
                {departments.map((d) => (
                    <button key={d} type="button" onClick={() => setDeptFilter(d)} className={chipBtn(deptFilter === d)}>{d}</button>
                ))}
                <span className="w-px h-4 bg-[#E4E7EC] mx-1.5" />
                <span className="text-[10.5px] font-bold text-[#667085] tracking-[0.06em] uppercase mr-1">변경 종류</span>
                <select
                    value={typeFilter}
                    onChange={(e) => setTypeFilter(e.target.value)}
                    className="h-[30px] px-2 rounded-md border border-[#E4E7EC] bg-white text-[12px] cursor-pointer"
                >
                    <option value="">전체</option>
                    {Object.entries(CHANGE_TYPE_LABEL).map(([k, label]) => (
                        <option key={k} value={k}>{label}</option>
                    ))}
                </select>
            </div>

            <div className="px-6 py-5 overflow-y-auto" style={{ maxHeight: 'calc(90vh - 140px)' }}>
                {loading ? (
                    <div className="py-8 px-6 text-center rounded-xl border border-dashed border-[#E4E7EC] bg-[#FAFBFC]">
                        <div className="text-[12.5px] text-[#667085]">불러오는 중…</div>
                    </div>
                ) : error ? (
                    <div className="py-8 px-6 text-center rounded-xl border border-dashed border-[#FDA29B] bg-[#FFFBFA]">
                        <div className="text-[12.5px] text-[#B42318]">{error}</div>
                    </div>
                ) : entries.length === 0 ? (
                    <div className="py-12 px-6 text-center rounded-xl border border-dashed border-[#E4E7EC] bg-[#FAFBFC]">
                        <Info size={20} className="text-[#98A2B3] mx-auto mb-2" />
                        <div className="text-[12.5px] text-[#667085]">변경 이력이 없습니다</div>
                    </div>
                ) : (
                    <div className="grid gap-2.5">
                        {entries.map((entry) => {
                            const isOpen = expanded === entry.id;
                            const label = CHANGE_TYPE_LABEL[entry.change_type] || entry.change_type;
                            const actorLabel = entry.display_name || entry.login_id || '시스템';
                            const beforeAt = prevChangeByEntry.get(entry.id);
                            const beforeAtStr = beforeAt ? formatChangedAt(beforeAt) : null;
                            const afterAt = formatChangedAt(entry.changed_at);
                            const fields = collectChangedFields(entry.before_json, entry.after_json);
                            const itemLabel = entry.item_name || `(항목 #${entry.order_no})`;
                            const categoryLabel = entry.category_name || '';
                            return (
                                <div key={entry.id} className="rounded-xl bg-white border border-[#E4E7EC]">
                                    <button
                                        type="button"
                                        onClick={() => setExpanded(isOpen ? null : entry.id)}
                                        className="w-full px-4 py-3 flex items-center gap-3 text-left cursor-pointer hover:bg-[#FAFBFC] rounded-xl"
                                    >
                                        <ChevronRight
                                            size={14}
                                            className={`text-[#98A2B3] transition-transform shrink-0 ${isOpen ? 'rotate-90' : ''}`}
                                        />
                                        <div className="min-w-0 flex-1">
                                            <div className="flex items-center gap-2 flex-wrap">
                                                <span className="text-[12.5px] font-bold text-[#101828] truncate">{itemLabel}</span>
                                                {categoryLabel && (
                                                    <span className="text-[10.5px] text-[#667085]">{categoryLabel}</span>
                                                )}
                                                <span className="text-[10.5px] font-bold px-1.5 py-0.5 rounded bg-[#F2F4F7] text-[#475467]">{entry.department}</span>
                                                <span className="text-[10.5px] font-bold px-1.5 py-0.5 rounded bg-[#EEF4FB] text-[#055AAF]">{label}</span>
                                                {entry.version !== null && entry.version !== undefined && (
                                                    <span className="text-[10.5px] text-[#98A2B3]">v{entry.version}</span>
                                                )}
                                            </div>
                                            <div className="text-[11px] text-[#667085] mt-0.5">
                                                {afterAt} · {actorLabel}
                                            </div>
                                        </div>
                                    </button>
                                    {isOpen && (
                                        <div className="px-4 pb-4">
                                            {fields.length === 0 ? (
                                                <div className="text-[11.5px] italic text-[#98A2B3] px-3 py-2">
                                                    변경된 필드가 기록되지 않았습니다.
                                                </div>
                                            ) : (
                                                fields.map((f) => (
                                                    <div key={f.key} className="grid gap-0 rounded-lg border border-[#E4E7EC] overflow-hidden mb-2.5 last:mb-0" style={{ gridTemplateColumns: '1fr 1fr' }}>
                                                        <div className="px-3 py-2 bg-[#FAFBFC] border-r border-[#E4E7EC] text-[10.5px] font-bold text-[#667085] tracking-[0.06em] uppercase">
                                                            {f.label} · 이전 {beforeAtStr ? `(~ ${beforeAtStr})` : ''}
                                                        </div>
                                                        <div className="px-3 py-2 bg-[#EEF4FB] text-[10.5px] font-bold text-[#055AAF] tracking-[0.06em] uppercase">
                                                            {f.label} · 현재 ({afterAt}~)
                                                        </div>
                                                        <div className="px-3 py-2.5 text-[12px] text-[#475467] leading-relaxed whitespace-pre-wrap border-r border-[#E4E7EC] bg-white">
                                                            <DiffText value={f.before} other={f.after} mode="before" />
                                                        </div>
                                                        <div className="px-3 py-2.5 text-[12px] text-[#101828] leading-relaxed whitespace-pre-wrap bg-white">
                                                            <DiffText value={f.after} other={f.before} mode="after" />
                                                        </div>
                                                    </div>
                                                ))
                                            )}
                                        </div>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                )}
            </div>
        </ModalShell>
    );
}

function collectChangedFields(beforeJson, afterJson) {
    const before = beforeJson || {};
    const after = afterJson || {};
    const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
    return Array.from(keys)
        .filter((k) => FIELD_LABEL[k])
        .map((k) => ({ key: k, label: FIELD_LABEL[k], before: before[k], after: after[k] }));
}

// 단어 단위 diff(LCS) — 공백/개행 토큰을 보존해 원문 서식 유지.
function diffTokenize(s) {
    return String(s ?? '').split(/(\s+)/).filter((t) => t.length > 0);
}
// 초대형 입력용 줄 단위 폴백 — 토큰² 폭주 방지.
function diffOpsByLine(aStr, bStr) {
    const a = String(aStr ?? '').split(/(\n)/).filter((t) => t.length > 0);
    const b = String(bStr ?? '').split(/(\n)/).filter((t) => t.length > 0);
    const n = a.length, m = b.length;
    const dp = Array.from({ length: n + 1 }, () => new Int32Array(m + 1));
    for (let i = n - 1; i >= 0; i--) {
        for (let j = m - 1; j >= 0; j--) {
            dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
        }
    }
    const ops = [];
    let i = 0, j = 0;
    while (i < n && j < m) {
        if (a[i] === b[j]) { ops.push({ t: 'eq', v: a[i] }); i++; j++; }
        else if (dp[i + 1][j] >= dp[i][j + 1]) { ops.push({ t: 'del', v: a[i] }); i++; }
        else { ops.push({ t: 'ins', v: b[j] }); j++; }
    }
    while (i < n) { ops.push({ t: 'del', v: a[i] }); i++; }
    while (j < m) { ops.push({ t: 'ins', v: b[j] }); j++; }
    return ops;
}
function diffOps(aStr, bStr) {
    const a = diffTokenize(aStr);
    const b = diffTokenize(bStr);
    const n = a.length, m = b.length;
    // 성능 가드: 매우 큰 입력(약 3000토큰² 초과)만 줄 단위로 폴백 — 일반 프롬프트는 단어 단위 diff.
    if (n * m > 9000000) {
        return diffOpsByLine(aStr, bStr);
    }
    const dp = Array.from({ length: n + 1 }, () => new Int32Array(m + 1));
    for (let i = n - 1; i >= 0; i--) {
        for (let j = m - 1; j >= 0; j--) {
            dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
        }
    }
    const ops = [];
    let i = 0, j = 0;
    while (i < n && j < m) {
        if (a[i] === b[j]) { ops.push({ t: 'eq', v: a[i] }); i++; j++; }
        else if (dp[i + 1][j] >= dp[i][j + 1]) { ops.push({ t: 'del', v: a[i] }); i++; }
        else { ops.push({ t: 'ins', v: b[j] }); j++; }
    }
    while (i < n) { ops.push({ t: 'del', v: a[i] }); i++; }
    while (j < m) { ops.push({ t: 'ins', v: b[j] }); j++; }
    return ops;
}

// 변경 강조 텍스트. mode='before' → 삭제분 빨강, mode='after' → 추가분 초록. 반대편 변경분은 숨김.
function DiffText({ value, other, mode }) {
    const cur = value === null || value === undefined ? '' : String(value);
    if (cur === '') return <span className="italic text-[#98A2B3]">(없음)</span>;
    const oth = other === null || other === undefined ? '' : String(other);
    const before = mode === 'before' ? cur : oth;
    const after = mode === 'before' ? oth : cur;
    const ops = diffOps(before, after);
    return (
        <>
            {ops.map((op, idx) => {
                if (op.t === 'eq') return <span key={idx}>{op.v}</span>;
                if (mode === 'before' && op.t === 'del') {
                    return <mark key={idx} className="bg-[#FEE4E2] text-[#B42318] rounded-[3px] px-0.5">{op.v}</mark>;
                }
                if (mode === 'after' && op.t === 'ins') {
                    return <mark key={idx} className="bg-[#DCFAE6] text-[#067647] rounded-[3px] px-0.5">{op.v}</mark>;
                }
                return null; // before 칸의 ins / after 칸의 del 은 숨김
            })}
        </>
    );
}

/* ── 체크리스트 항목 모달 (신규 / 편집) ───────────────────────── */

function ItemModal({ mode, item, existingDef, axes, departments = [], onSaved, onRubricSync, onClose }) {
    const isEdit = mode === 'edit';
    // 편집 모드 초기값: DB existingDef 가 우선, 없으면 brandConfig 기반 (item.validation_time 등).
    const [category, setCategory] = useState(existingDef?.category ?? item?.category ?? '');
    const [name, setName] = useState(existingDef?.item ?? item?.item ?? '');
    const [scoringType, setScoringType] = useState(existingDef?.scoring_type || 'numeric');
    const [maxScore, setMaxScore] = useState(
        existingDef?.max_score != null
            ? String(existingDef.max_score)
            : (item ? String(parsePoints(item.validation_time)) : '5')
    );
    const [pentagonAxis, setPentagonAxis] = useState(existingDef?.pentagon_axis ?? '');
    const [isActive, setIsActive] = useState(existingDef?.is_active ?? true);
    const [selectedDepts, setSelectedDepts] = useState([]);
    const [saving, setSaving] = useState(false);
    const [saveError, setSaveError] = useState(null);

    const allDeptsSelected = departments.length > 0 && selectedDepts.length === departments.length;
    const toggleDept = (dept) => {
        setSelectedDepts((prev) =>
            prev.includes(dept) ? prev.filter((d) => d !== dept) : [...prev, dept]
        );
    };
    const toggleAll = () => {
        setSelectedDepts(allDeptsSelected ? [] : [...departments]);
    };

    return (
        <ModalShell title={isEdit ? '평가항목 편집' : '새 평가항목 추가'} onClose={onClose} widthClass="max-w-[560px]">
            <div className="px-6 py-5 space-y-4">
                <FormGroup label="대분류" required>
                    <input
                        type="text"
                        value={category}
                        onChange={(e) => setCategory(e.target.value)}
                        placeholder="예) 친절도"
                        className="form-input-pretty"
                    />
                </FormGroup>

                <FormGroup label="중분류 / 항목명" required>
                    <input
                        type="text"
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        placeholder="예) 첫인사"
                        className="form-input-pretty"
                    />
                </FormGroup>

                {!isEdit && (
                    <FormGroup label="적용 부서" required>
                        <div className="flex flex-wrap gap-1.5">
                            {departments.length === 0 ? (
                                <div className="text-[12.5px] text-[#98A2B3] italic">
                                    이 브랜드에 등록된 부서가 없습니다.
                                </div>
                            ) : (
                                <>
                                    <button
                                        type="button"
                                        onClick={toggleAll}
                                        className={chipBtn(allDeptsSelected)}
                                    >
                                        전체
                                    </button>
                                    {departments.map((dept) => (
                                        <button
                                            key={dept}
                                            type="button"
                                            onClick={() => toggleDept(dept)}
                                            className={chipBtn(selectedDepts.includes(dept))}
                                        >
                                            {dept}
                                        </button>
                                    ))}
                                </>
                            )}
                        </div>
                        <div className="mt-1.5 text-[11px] text-[#98A2B3]">
                            여러 부서를 선택하면 부서별로 별도 row 가 발행됩니다. 부서·직무 자체의 추가/삭제는 별도 탭에서 관리합니다.
                        </div>
                    </FormGroup>
                )}

                <FormGroup label="채점 방식" required>
                    <div className="flex gap-2">
                        <button
                            type="button"
                            onClick={() => setScoringType('numeric')}
                            className={pillBtn(scoringType === 'numeric')}
                        >
                            점수제
                        </button>
                        <button
                            type="button"
                            onClick={() => setScoringType('yes_no')}
                            className={pillBtn(scoringType === 'yes_no')}
                        >
                            Y/N
                        </button>
                    </div>
                </FormGroup>

                {scoringType === 'numeric' ? (
                    <FormGroup label="만점">
                        <div className="flex items-center gap-2">
                            <input
                                type="number"
                                min="1"
                                value={maxScore}
                                onChange={(e) => setMaxScore(e.target.value)}
                                className="form-input-pretty"
                                style={{ width: 120 }}
                            />
                            <span className="text-[13px] text-[#667085]">점</span>
                        </div>
                    </FormGroup>
                ) : (
                    <FormGroup label="만점">
                        <div className="text-[12.5px] text-[#667085] bg-[#F2F4F7] rounded-lg px-3 py-2.5">
                            충족=1점 / 미충족=0점 (자동)
                        </div>
                    </FormGroup>
                )}

                <FormGroup label="Pentagon 매핑">
                    <select
                        value={pentagonAxis}
                        onChange={(e) => setPentagonAxis(e.target.value)}
                        className="form-input-pretty"
                    >
                        <option value="">매핑 없음 (총점에만 반영)</option>
                        {axes.map((label, idx) => (
                            <option key={label} value={label}>
                                {['①','②','③','④','⑤'][idx]} {label}
                            </option>
                        ))}
                    </select>
                </FormGroup>

                {isEdit && (
                    <FormGroup label="활성 상태">
                        <div className="flex gap-2">
                            <button
                                type="button"
                                onClick={() => setIsActive(true)}
                                className={pillBtn(isActive)}
                            >
                                활성
                            </button>
                            <button
                                type="button"
                                onClick={() => setIsActive(false)}
                                className={pillBtn(!isActive)}
                            >
                                비활성
                            </button>
                        </div>
                    </FormGroup>
                )}

                {saveError && (
                    <div className="text-[12px] text-[#B42318]">{saveError}</div>
                )}
            </div>

            <ModalFooter
                onCancel={() => !saving && onClose()}
                primaryLabel={saving ? '저장 중…' : (isEdit ? '저장' : '추가')}
                onPrimary={async () => {
                    if (saving) return;
                    if (!category.trim() || !name.trim()) {
                        setSaveError('대분류와 항목명은 필수입니다.');
                        return;
                    }
                    if (!isEdit && selectedDepts.length === 0) {
                        setSaveError('적용 부서를 1개 이상 선택해 주세요.');
                        return;
                    }
                    const maxScoreNum = scoringType === 'numeric' ? Number(maxScore) : null;
                    if (scoringType === 'numeric' && (!Number.isFinite(maxScoreNum) || maxScoreNum <= 0)) {
                        setSaveError('만점은 1 이상의 숫자여야 합니다.');
                        return;
                    }
                    setSaving(true);
                    setSaveError(null);
                    try {
                        if (isEdit) {
                            // 편집: 기존 criterion/prompt_template 은 PromptEditModal 소관이라 그대로 유지.
                            const res = await saveEvalItemDef(item.order_no, {
                                category: category.trim(),
                                item: name.trim(),
                                criterion: existingDef?.criterion ?? null,
                                prompt_template: existingDef?.prompt_template ?? null,
                                pentagon_axis: pentagonAxis || null,
                                scoring_type: scoringType,
                                max_score: maxScoreNum,
                                is_active: isActive,
                                department: existingDef?.department || item.department,
                                is_meaning_change: false,
                            });
                            onSaved?.(res?.item);
                            onRubricSync?.(res?.rubric_sync);
                        } else {
                            const res = await createEvalItemDef({
                                category: category.trim(),
                                item: name.trim(),
                                pentagon_axis: pentagonAxis || null,
                                scoring_type: scoringType,
                                max_score: maxScoreNum,
                                is_active: isActive,
                                departments: selectedDepts,
                            });
                            onSaved?.(null); // 신규 — order_no 가 바뀌므로 전체 reload 요청
                            onRubricSync?.(res?.rubric_sync);
                        }
                        onClose();
                    } catch (err) {
                        setSaveError(err?.message || '저장에 실패했습니다.');
                    } finally {
                        setSaving(false);
                    }
                }}
                extraLeft={
                    isEdit && (
                        <button
                            type="button"
                            onClick={() => {
                                // 삭제는 별도 PR (deactivate 패턴) — 본 PR 범위 밖.
                                window.alert('삭제 기능은 별도 작업 예정입니다. "비활성" 으로 설정하세요.');
                            }}
                            disabled={saving}
                            className="h-[38px] px-4 rounded-xl border border-[#FCA5A5] bg-white text-[13px] font-semibold text-[#D92D20] hover:bg-red-50 inline-flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
                        >
                            <Trash2 size={12} />삭제
                        </button>
                    )
                }
            />
        </ModalShell>
    );
}

/* ── 평가 기준 + 프롬프트 편집 모달 (미리보기 패널 편집하기 진입점) ───────── */

function PromptEditModal({ item, existingDef, onSaved, onRubricSync, onClose }) {
    const maxPoints = parsePoints(item.validation_time);
    const defaultPrompt = `당신은 콜센터 상담 품질을 평가하는 AI입니다.
아래 상담 전사를 읽고 "${item.item}" 항목을 평가하세요.

평가 기준:
• (이 항목에 적용할 세부 기준을 입력하세요)

출력 형식:
{
  "score": <0-${maxPoints}>,
  "reasoning": "<2-3문장 근거>"
}`;
    const [criterion, setCriterion] = useState(existingDef?.criterion ?? '');
    const [prompt, setPrompt] = useState(existingDef?.prompt_template ?? defaultPrompt);
    // 평가 기준·프롬프트 수정은 항상 in-place — 항목 자체가 바뀌는 게 아니라 설명을 다듬는 영역이라
    // 버전 발행 대상이 아님. 의미 변경(=항목명/대분류 자체 변경)은 ItemModal 의 mode='edit' 에서 다룸.
    // 모든 수정은 eval_item_change_log 에 row 가 적재되어 우측 패널 "변경 이력" 탭에서 조회됨.
    const [saving, setSaving] = useState(false);
    const [saveError, setSaveError] = useState(null);

    return (
        <ModalShell title={`${item.item} — 평가 기준 / 프롬프트 편집`} onClose={onClose} widthClass="max-w-[640px]">
            <div className="px-6 py-5 space-y-4">
                <FormGroup label="평가 기준">
                    <textarea
                        value={criterion}
                        onChange={(e) => setCriterion(e.target.value)}
                        rows={3}
                        placeholder="이 항목을 평가할 때 적용할 세부 기준을 입력하세요 (예: 인사말, 소속, 성명을 정확하게 시행)"
                        className="form-textarea-pretty"
                    />
                </FormGroup>

                <FormGroup label="평가 프롬프트">
                    <textarea
                        value={prompt}
                        onChange={(e) => setPrompt(e.target.value)}
                        rows={12}
                        className="form-textarea-pretty font-mono text-[12px]"
                    />
                </FormGroup>

                {saveError && (
                    <div className="text-[12px] text-[#B42318]">{saveError}</div>
                )}
            </div>

            <ModalFooter
                onCancel={() => !saving && onClose()}
                primaryLabel={saving ? '저장 중…' : '저장'}
                onPrimary={async () => {
                    if (saving) return;
                    setSaving(true);
                    setSaveError(null);
                    try {
                        const res = await saveEvalItemDef(item.order_no, {
                            category: item.category,
                            item: item.item,
                            criterion: criterion.trim() ? criterion : null,
                            prompt_template: prompt.trim() ? prompt : null,
                            department: item.department,
                            is_meaning_change: false,
                        });
                        if (res?.item && onSaved) onSaved(res.item);
                        onRubricSync?.(res?.rubric_sync);
                        onClose();
                    } catch (err) {
                        setSaveError(err?.message || '저장에 실패했습니다.');
                    } finally {
                        setSaving(false);
                    }
                }}
            />
        </ModalShell>
    );
}

/* ── Pentagon 축 모달 (신규 / 편집) ────────────────────────────── */

function AxisModal({ mode, axisNo, nextAxisNo, label, dbAxis, onSaved, onClose }) {
    const isEdit = mode === 'edit';
    const effectiveNo = isEdit ? axisNo : nextAxisNo;
    const numCharBox = ['①','②','③','④','⑤','⑥','⑦','⑧','⑨','⑩'];
    const numChar = numCharBox[effectiveNo - 1] || `#${effectiveNo}`;

    // 편집 모드: dbAxis 가 있으면 DB 값, 없으면 brandConfig label + 정적 mock desc 로 시드.
    const [labelDraft, setLabelDraft] = useState(dbAxis?.label ?? label ?? '');
    const [description, setDescription] = useState(
        dbAxis?.description ?? (isEdit ? (PENTAGON_MOCK_DESC[label] || '') : '')
    );
    const [isActive, setIsActive] = useState(dbAxis?.is_active ?? true);
    const [saving, setSaving] = useState(false);
    const [saveError, setSaveError] = useState(null);

    const title = isEdit ? `Pentagon 축 편집 — ${numChar}` : `Pentagon 축 추가 — ${numChar}`;

    return (
        <ModalShell title={title} onClose={onClose} widthClass="max-w-[560px]">
            <div className="px-6 py-5 space-y-4">
                <FormGroup label="축 번호">
                    <div className="text-[13px] font-semibold text-[#475467] flex items-center gap-2">
                        <span className="text-[18px] font-bold text-[#055AAF]">{numChar}</span>
                        <span className="text-[#667085]">{isEdit ? `축 (${effectiveNo})` : `신규 축 #${effectiveNo}`}</span>
                    </div>
                </FormGroup>

                <FormGroup label="항목명 (라벨)" required>
                    <input
                        type="text"
                        value={labelDraft}
                        onChange={(e) => setLabelDraft(e.target.value)}
                        placeholder={isEdit ? '' : '예) 발화 안정성'}
                        className="form-input-pretty"
                    />
                </FormGroup>

                <FormGroup label="설명">
                    <textarea
                        value={description}
                        onChange={(e) => setDescription(e.target.value)}
                        rows={3}
                        placeholder="이 축이 측정하는 영역을 한두 문장으로 설명하세요"
                        className="form-textarea-pretty"
                    />
                </FormGroup>

                {isEdit && (
                    <FormGroup label="활성 상태">
                        <div className="flex gap-2">
                            <button type="button" onClick={() => setIsActive(true)} className={pillBtn(isActive)}>활성</button>
                            <button type="button" onClick={() => setIsActive(false)} className={pillBtn(!isActive)}>비활성</button>
                        </div>
                    </FormGroup>
                )}

                {saveError && (
                    <div className="text-[12px] text-[#B42318]">{saveError}</div>
                )}
            </div>

            <ModalFooter
                onCancel={() => !saving && onClose()}
                primaryLabel={saving ? '저장 중…' : (isEdit ? '저장' : '추가')}
                onPrimary={async () => {
                    if (saving) return;
                    if (!labelDraft.trim()) {
                        setSaveError('축 라벨은 필수입니다.');
                        return;
                    }
                    setSaving(true);
                    setSaveError(null);
                    try {
                        if (isEdit) {
                            await savePentagonAxis(effectiveNo, {
                                label: labelDraft.trim(),
                                description: description.trim() || null,
                                is_active: isActive,
                            });
                        } else {
                            await createPentagonAxis({
                                label: labelDraft.trim(),
                                description: description.trim() || null,
                                is_active: isActive,
                            });
                        }
                        onSaved?.();
                        onClose();
                    } catch (err) {
                        setSaveError(err?.message || '저장에 실패했습니다.');
                    } finally {
                        setSaving(false);
                    }
                }}
                extraLeft={
                    isEdit && (
                        <button
                            type="button"
                            onClick={() => {
                                window.alert('삭제 기능은 별도 작업 예정입니다. "비활성" 으로 설정하세요.');
                            }}
                            disabled={saving}
                            className="h-[38px] px-4 rounded-xl border border-[#FCA5A5] bg-white text-[13px] font-semibold text-[#D92D20] hover:bg-red-50 inline-flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
                        >
                            <Trash2 size={12} />삭제
                        </button>
                    )
                }
            />
        </ModalShell>
    );
}

/* ── 공용 모달 셸/푸터 ────────────────────────────────────────── */

function ModalShell({ title, onClose, widthClass = 'max-w-md', children }) {
    // document.body 로 포털 — 상위 레이아웃(transform/overflow 등)에 갇히지 않고 전체 화면을 덮는다.
    if (typeof document === 'undefined') return null;
    return createPortal(
        <div
            className="fixed inset-0 z-[1000] flex items-center justify-center px-4"
            style={{ background: 'rgba(15,23,42,0.4)' }}
            onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
        >
            <div className={`w-full ${widthClass} bg-white rounded-2xl shadow-xl overflow-hidden max-h-[90vh] flex flex-col`}>
                <div className="px-6 pt-5 pb-3 flex items-center justify-between border-b border-[#E4E7EC] shrink-0">
                    <h3 className="text-base font-bold text-[#101828]">{title}</h3>
                    <button
                        onClick={onClose}
                        className="w-7 h-7 grid place-items-center rounded-md text-[#667085] hover:bg-[#F2F4F7] cursor-pointer"
                    >
                        <X size={14} />
                    </button>
                </div>
                <div className="overflow-y-auto flex-1">{children}</div>
            </div>
        </div>,
        document.body
    );
}

function ModalFooter({ onCancel, onPrimary, primaryLabel, extraLeft, primaryTone = 'primary' }) {
    const isDanger = primaryTone === 'danger';
    const primaryClass = isDanger
        ? 'h-[38px] px-5 rounded-xl bg-[#D92D20] text-white text-[13px] font-semibold hover:bg-[#B42318] shadow-sm inline-flex items-center gap-1.5 cursor-pointer'
        : 'h-[38px] px-5 rounded-xl bg-[#055AAF] text-white text-[13px] font-semibold hover:bg-[#1E70E0] shadow-sm inline-flex items-center gap-1.5 cursor-pointer';
    return (
        <div className="px-6 pb-5 pt-3 border-t border-[#F2F4F7] bg-[#FAFBFC] flex items-center justify-between shrink-0">
            <div>{extraLeft}</div>
            <div className="flex gap-2">
                <button
                    type="button"
                    onClick={onCancel}
                    className="h-[38px] px-5 rounded-xl border border-[#E4E7EC] bg-white text-[13px] font-semibold text-[#101828] hover:bg-[#F2F4F7] cursor-pointer"
                >
                    취소
                </button>
                <button
                    type="button"
                    onClick={onPrimary}
                    className={primaryClass}
                >
                    {isDanger ? <Trash2 size={12} /> : <Save size={12} />}{primaryLabel}
                </button>
            </div>
        </div>
    );
}

function FormGroup({ label, required, children }) {
    return (
        <div>
            <label className="block text-[11.5px] font-semibold text-[#667085] mb-1.5 uppercase tracking-wide">
                {label} {required && <span className="text-[#D92D20]">*</span>}
            </label>
            {children}
        </div>
    );
}

/* ── 유틸 ─────────────────────────────────────────────────────── */

function pillBtn(active) {
    return `flex-1 h-[38px] rounded-xl border text-[13px] font-semibold cursor-pointer ${
        active
            ? 'bg-blue-50 border-blue-200 text-blue-700'
            : 'bg-white border-[#E4E7EC] text-[#667085] hover:bg-[#F2F4F7]'
    }`;
}

function chipBtn(active) {
    return `h-[30px] px-3 rounded-full border text-[12px] font-semibold cursor-pointer transition-colors ${
        active
            ? 'bg-[#055AAF] border-[#055AAF] text-white hover:bg-[#1E70E0]'
            : 'bg-white border-[#E4E7EC] text-[#667085] hover:bg-[#F2F4F7] hover:border-[#D0D5DD]'
    }`;
}

function parsePoints(validationTime) {
    if (!validationTime) return 5;
    const m = String(validationTime).match(/(\d+)/);
    return m ? Number(m[1]) : 5;
}

export default EvalItems;
