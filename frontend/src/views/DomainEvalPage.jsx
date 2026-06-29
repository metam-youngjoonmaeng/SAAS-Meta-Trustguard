import React, { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChevronLeft, ChevronRight, Edit3, Plus, X, Trash2, Save, Loader2 } from 'lucide-react';
import {
    fetchDomainEvalDefaults, createDomainEvalDefault, updateDomainEvalDefault, deleteDomainEvalDefault,
    fetchDomainPentagonDefaults, createDomainPentagonDefault, updateDomainPentagonDefault, deleteDomainPentagonDefault,
} from '../services/api';
import ScoreStepsEditor, { parseSteps, assembleSteps } from '../components/ScoreStepsEditor';

// 도메인(업종)별 기본 평가체계 편집 — AI QA 항목관리(EvalItems.jsx)와 동일한 2패널 UX.
// 좌측: 평가항목 리스트 + 펜타곤 축 리스트 / 우측: 선택 항목 미리보기·편집.
// 골든셋/버전관리/루브릭동기화는 제외(도메인 템플릿이라 불필요). 여기 활성 항목·축이
// "신규 브랜드 생성 시" 그 브랜드로 자동 복제된다(기존 브랜드 무영향).

const AXIS_CHAR = ['①', '②', '③', '④', '⑤', '⑥', '⑦', '⑧', '⑨', '⑩'];

/* ── 페이지 ──────────────────────────────────────────── */
export default function DomainEvalPage({ domain, onBack }) {
    const [items, setItems] = useState([]);
    const [axes, setAxes] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [selection, setSelection] = useState(null); // { kind:'item'|'axis', id }
    const [modal, setModal] = useState(null);

    async function load(keepSel) {
        setLoading(true);
        try {
            const [it, ax] = await Promise.all([
                fetchDomainEvalDefaults(domain.id),
                fetchDomainPentagonDefaults(domain.id),
            ]);
            setItems(it);
            setAxes(ax);
            setError(null);
            // 선택 유지(없으면 첫 항목).
            setSelection((prev) => {
                const sel = keepSel ? prev : null;
                if (sel) {
                    if (sel.kind === 'item' && it.some((x) => x.id === sel.id)) return sel;
                    if (sel.kind === 'axis' && ax.some((x) => x.id === sel.id)) return sel;
                }
                if (it.length) return { kind: 'item', id: it[0].id };
                if (ax.length) return { kind: 'axis', id: ax[0].id };
                return null;
            });
        } catch (e) {
            setError(e?.message || '로드 실패');
        } finally {
            setLoading(false);
        }
    }
    useEffect(() => { load(false); /* eslint-disable-next-line */ }, [domain.id]);

    const activeAxisLabels = useMemo(
        () => axes.filter((a) => a.is_active !== false).map((a) => a.label),
        [axes]
    );
    const selectedItem = selection?.kind === 'item' ? items.find((x) => x.id === selection.id) : null;
    const selectedAxis = selection?.kind === 'axis' ? axes.find((x) => x.id === selection.id) : null;

    return (
        <div className="pb-10 w-full">
            {/* 헤더 */}
            <div className="flex items-start gap-3 mb-5">
                <button onClick={onBack}
                    className="mt-0.5 inline-flex items-center gap-1 h-[34px] px-3 rounded-lg border border-[#E4E7EC] bg-white text-[13px] font-semibold text-[#101828] hover:bg-[#F2F4F7] cursor-pointer shrink-0">
                    <ChevronLeft size={15} /> 도메인 목록
                </button>
                <div>
                    <h1 className="text-[20px] font-bold text-[#101828] leading-tight tracking-tight">
                        {domain.name} <span className="text-[#667085] font-semibold">· 기본 평가체계</span>
                    </h1>
                    <p className="text-[12.5px] text-[#667085] mt-1 leading-snug">
                        이 도메인으로 <b>신규 브랜드를 생성</b>하면 아래 <b>활성</b> 평가항목·펜타곤 축이 그 브랜드로 자동 복제됩니다. (기존 브랜드에는 영향 없음)
                    </p>
                </div>
            </div>

            {error && <p className="text-sm text-[#D92D20] mb-3">{error}</p>}

            {loading ? (
                <div className="flex justify-center py-20"><Loader2 className="h-5 w-5 animate-spin text-[#667085]" /></div>
            ) : (
                <div className="grid gap-5" style={{ gridTemplateColumns: '320px minmax(0, 1fr)', height: 'calc(100vh - 240px)', minHeight: 560 }}>
                    {/* ── 좌측 ── */}
                    <div className="bg-white border border-[#E4E7EC] rounded-xl shadow-[0_1px_2px_rgba(16,24,40,0.04)] flex flex-col overflow-hidden">
                        {/* 평가항목 */}
                        <div className="flex flex-col min-h-0" style={{ flex: '1 1 0%' }}>
                            <SectionHeader
                                title="평가항목"
                                count={`활성 ${items.filter((i) => i.is_active !== false).length} · 전체 ${items.length}`}
                                onEdit={() => selectedItem && setModal({ type: 'edit-item', item: selectedItem })}
                                editDisabled={!selectedItem}
                                editTitle={selectedItem ? `${selectedItem.item} 편집` : '편집할 항목을 먼저 선택하세요'}
                            />
                            <div className="flex-1 overflow-y-auto p-2 min-h-0">
                                {items.map((it) => (
                                    <ItemRow
                                        key={it.id}
                                        orderNo={it.order_no}
                                        category={it.category}
                                        label={it.item}
                                        inactive={it.is_active === false}
                                        selected={selection?.kind === 'item' && selection.id === it.id}
                                        onSelect={() => setSelection({ kind: 'item', id: it.id })}
                                        onEdit={() => setModal({ type: 'edit-item', item: it })}
                                    />
                                ))}
                                <AddBox label="새 평가항목 추가" onClick={() => setModal({ type: 'new-item' })} />
                            </div>
                        </div>

                        {/* 펜타곤 축 */}
                        <div className="flex flex-col shrink-0 border-t-[6px] border-[#F2F4F7]" style={{ flex: '0 0 auto' }}>
                            <SectionHeader
                                title="Pentagon 평가항목"
                                count={`활성 ${axes.filter((a) => a.is_active !== false).length} · 전체 ${axes.length}`}
                                onEdit={() => selectedAxis && setModal({ type: 'edit-axis', axis: selectedAxis })}
                                editDisabled={!selectedAxis}
                                editTitle={selectedAxis ? `${selectedAxis.label} 편집` : '편집할 축을 먼저 선택하세요'}
                            />
                            <div className="p-2">
                                {axes.map((a, idx) => (
                                    <AxisRow
                                        key={a.id}
                                        numChar={AXIS_CHAR[idx] || `#${a.axis_no}`}
                                        label={a.label}
                                        inactive={a.is_active === false}
                                        selected={selection?.kind === 'axis' && selection.id === a.id}
                                        onSelect={() => setSelection({ kind: 'axis', id: a.id })}
                                        onEdit={() => setModal({ type: 'edit-axis', axis: a })}
                                    />
                                ))}
                                <AddBox label="새 Pentagon 축 추가" onClick={() => setModal({ type: 'new-axis' })} />
                            </div>
                        </div>
                    </div>

                    {/* ── 우측 미리보기 ── */}
                    {selectedItem ? (
                        <ItemPreview item={selectedItem} axisIndex={axes.findIndex((a) => a.label === selectedItem.pentagon_axis)}
                            onEdit={() => setModal({ type: 'edit-item', item: selectedItem })} />
                    ) : selectedAxis ? (
                        <AxisPreview axis={selectedAxis} numChar={AXIS_CHAR[axes.findIndex((a) => a.id === selectedAxis.id)] || `#${selectedAxis.axis_no}`}
                            onEdit={() => setModal({ type: 'edit-axis', axis: selectedAxis })} />
                    ) : (
                        <div className="bg-white border border-[#E4E7EC] rounded-xl flex items-center justify-center text-[13px] text-[#667085]">
                            좌측에서 항목을 선택하세요
                        </div>
                    )}
                </div>
            )}

            {/* ── 모달 ── */}
            {(modal?.type === 'new-item' || modal?.type === 'edit-item') && (
                <ItemModal
                    mode={modal.type === 'edit-item' ? 'edit' : 'new'}
                    item={modal.item}
                    axisLabels={activeAxisLabels}
                    domainId={domain.id}
                    onSaved={(savedId, kind) => { setModal(null); setSelection({ kind: kind || 'item', id: savedId }); load(true); }}
                    onDeleted={() => { setModal(null); setSelection(null); load(false); }}
                    onClose={() => setModal(null)}
                />
            )}
            {(modal?.type === 'new-axis' || modal?.type === 'edit-axis') && (
                <AxisModal
                    mode={modal.type === 'edit-axis' ? 'edit' : 'new'}
                    axis={modal.axis}
                    nextNo={axes.length + 1}
                    domainId={domain.id}
                    onSaved={(savedId) => { setModal(null); setSelection({ kind: 'axis', id: savedId }); load(true); }}
                    onDeleted={() => { setModal(null); setSelection(null); load(false); }}
                    onClose={() => setModal(null)}
                />
            )}
        </div>
    );
}

/* ── 좌측 섹션 헤더 / 행 / 추가박스 ──────────────────── */
function SectionHeader({ title, count, onEdit, editDisabled, editTitle }) {
    return (
        <div className="px-5 py-3 border-b border-[#F2F4F7] bg-[#FAFBFC] flex items-center gap-2">
            <h3 className="text-[13px] font-bold text-[#101828] tracking-tight">{title}</h3>
            <span className="text-[11.5px] text-[#667085] font-medium">{count}</span>
            <button type="button" onClick={editDisabled ? undefined : onEdit} disabled={editDisabled} title={editTitle}
                className={`ml-auto w-7 h-7 grid place-items-center rounded-md transition-colors ${
                    editDisabled ? 'text-[#D0D5DD] cursor-not-allowed' : 'text-[#055AAF] hover:bg-[#EEF4FB] hover:text-[#1E70E0] cursor-pointer'}`}>
                <Edit3 size={14} strokeWidth={2.2} />
            </button>
        </div>
    );
}

function AddBox({ label, onClick }) {
    return (
        <button type="button" onClick={onClick}
            className="w-full mt-1.5 mb-1 flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-lg border border-dashed border-[#D0D5DD] bg-white text-[12.5px] font-semibold text-[#667085] hover:border-[#055AAF] hover:text-[#055AAF] hover:bg-[#F7FAFD] transition-colors cursor-pointer">
            <Plus size={13} strokeWidth={2.5} />{label}
        </button>
    );
}

function ItemRow({ orderNo, category, label, selected, onSelect, onEdit, inactive }) {
    return (
        <div onClick={onSelect}
            className={`group relative flex items-center gap-2 px-3 py-2.5 rounded-lg mb-0.5 transition-colors cursor-pointer ${selected ? 'bg-[#EEF4FB]' : 'hover:bg-[#F9FAFB]'}`}>
            <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5 mb-0.5">
                    <span className="text-[10px] font-bold text-[#98A2B3] tabular-nums">#{String(orderNo).padStart(2, '0')}</span>
                    <span className="text-[10px] font-semibold text-[#667085] truncate">{category}</span>
                    {inactive && <span className="text-[9px] font-bold px-1 py-0.5 rounded bg-[#F2F4F7] text-[#98A2B3]">비활성</span>}
                </div>
                <div className={`text-[12.5px] font-bold truncate ${inactive ? 'text-[#98A2B3]' : selected ? 'text-[#055AAF]' : 'text-[#101828]'}`}>{label}</div>
            </div>
            <button type="button" onClick={(e) => { e.stopPropagation(); onEdit(); }} title="편집"
                className="w-6 h-6 grid place-items-center rounded-md text-[#98A2B3] hover:bg-white hover:text-[#055AAF] hover:shadow-sm transition-all cursor-pointer">
                <ChevronRight size={14} />
            </button>
        </div>
    );
}

function AxisRow({ numChar, label, selected, onSelect, onEdit, inactive }) {
    return (
        <div onClick={onSelect}
            className={`group relative flex items-center gap-2 px-3 py-2.5 rounded-lg mb-0.5 transition-colors cursor-pointer ${selected ? 'bg-[#EEF4FB]' : 'hover:bg-[#F9FAFB]'}`}>
            <span className={`text-[14px] font-bold tabular-nums ${selected ? 'text-[#055AAF]' : 'text-[#98A2B3]'}`}>{numChar}</span>
            <div className={`flex-1 text-[12.5px] font-bold truncate ${inactive ? 'text-[#98A2B3]' : selected ? 'text-[#055AAF]' : 'text-[#101828]'}`}>{label}</div>
            {inactive && <span className="text-[9px] font-bold px-1 py-0.5 rounded bg-[#F2F4F7] text-[#98A2B3]">비활성</span>}
            <button type="button" onClick={(e) => { e.stopPropagation(); onEdit(); }} title="편집"
                className="w-6 h-6 grid place-items-center rounded-md text-[#98A2B3] hover:bg-white hover:text-[#055AAF] hover:shadow-sm transition-all cursor-pointer">
                <ChevronRight size={14} />
            </button>
        </div>
    );
}

/* ── 우측 미리보기 ───────────────────────────────────── */
function ItemPreview({ item, axisIndex, onEdit }) {
    return (
        <div className="bg-white border border-[#E4E7EC] rounded-xl shadow-[0_1px_2px_rgba(16,24,40,0.04)] flex flex-col overflow-hidden">
            <div className="px-5 py-3.5 border-b border-[#F2F4F7] bg-[#FAFBFC] flex items-center gap-3">
                <h3 className="text-[14px] font-bold text-[#101828] tracking-tight truncate">{item.item}</h3>
                <span className="text-[11.5px] text-[#667085]">{item.category}</span>
                {item.is_active !== false
                    ? <span className="text-[10.5px] font-bold px-1.5 py-0.5 rounded bg-[#E8F6ED] text-[#2F9759]">활성</span>
                    : <span className="text-[10.5px] font-bold px-1.5 py-0.5 rounded bg-[#F2F4F7] text-[#667085]">비활성</span>}
                <button type="button" onClick={onEdit}
                    className="ml-auto h-[32px] px-3.5 rounded-full bg-[#055AAF] text-white text-[12px] font-semibold hover:bg-[#1E70E0] shadow-sm inline-flex items-center gap-1.5 cursor-pointer">
                    <Edit3 size={12} />편집하기
                </button>
            </div>

            <div className="px-5 py-2.5 bg-[#FAFBFC] border-b border-[#F2F4F7] flex items-center gap-3 flex-wrap text-[12px] text-[#667085]">
                <MetaPair label="채점 방식" value={item.scoring_type === 'yes_no' ? 'Y/N' : '점수제'} />
                <MetaDivider />
                <MetaPair label="만점" value={item.scoring_type === 'yes_no' ? 'Y/N' : `${item.max_score ?? '-'}점`} />
                <MetaDivider />
                <MetaPair label="순서" value={`#${String(item.order_no).padStart(2, '0')}`} />
                <MetaDivider />
                <MetaPair label="Pentagon" value={item.pentagon_axis ? `${axisIndex >= 0 ? (AXIS_CHAR[axisIndex] + ' ') : ''}${item.pentagon_axis}` : '매핑 없음'} />
            </div>

            <div className="flex-1 p-5 min-h-0 flex flex-col gap-5">
                <div className="flex-1 min-h-0 overflow-y-auto">
                    <PreviewSection title="항목 평가 설명">
                        {item.criterion
                            ? <div className="text-[13px] text-[#475467] leading-relaxed whitespace-pre-wrap">{item.criterion}</div>
                            : <div className="text-[13px] text-[#98A2B3] italic leading-relaxed">아직 설정된 평가 설명이 없습니다. 우상단 편집하기에서 입력하세요.</div>}
                    </PreviewSection>
                </div>
                <div className="flex flex-col shrink-0">
                    <div className="text-[10.5px] font-bold text-[#98A2B3] tracking-[0.06em] uppercase mb-2">점수 기준 {item.scoring_type !== 'yes_no' && `(만점 ${item.max_score ?? '-'}점)`}</div>
                    <pre className="min-h-[120px] max-h-[40vh] text-[12px] font-mono text-[#475467] leading-relaxed whitespace-pre-wrap bg-[#FAFBFC] border border-[#E4E7EC] rounded-lg p-3 overflow-auto">{item.prompt_template || `"${item.item}" 항목을 어떻게 평가할지 기준을 작성하세요.\n\n비워두면 신규 브랜드에도 빈 값으로 복제됩니다. (브랜드별로 추후 보완 가능)`}</pre>
                </div>
            </div>
        </div>
    );
}

function AxisPreview({ axis, numChar, onEdit }) {
    return (
        <div className="bg-white border border-[#E4E7EC] rounded-xl shadow-[0_1px_2px_rgba(16,24,40,0.04)] flex flex-col overflow-hidden">
            <div className="px-5 py-3.5 border-b border-[#F2F4F7] bg-[#FAFBFC] flex items-center gap-3">
                <span className="text-[18px] font-bold text-[#055AAF] tabular-nums">{numChar}</span>
                <h3 className="text-[14px] font-bold text-[#101828] tracking-tight truncate">{axis.label}</h3>
                {axis.is_active !== false
                    ? <span className="text-[10.5px] font-bold px-1.5 py-0.5 rounded bg-[#E8F6ED] text-[#2F9759]">활성</span>
                    : <span className="text-[10.5px] font-bold px-1.5 py-0.5 rounded bg-[#F2F4F7] text-[#667085]">비활성</span>}
                <button type="button" onClick={onEdit}
                    className="ml-auto h-[32px] px-3.5 rounded-full bg-[#055AAF] text-white text-[12px] font-semibold hover:bg-[#1E70E0] shadow-sm inline-flex items-center gap-1.5 cursor-pointer">
                    <Edit3 size={12} />편집하기
                </button>
            </div>

            <div className="px-5 py-2.5 bg-[#FAFBFC] border-b border-[#F2F4F7] flex items-center gap-3 flex-wrap text-[12px] text-[#667085]">
                <MetaPair label="축 번호" value={`${numChar} (${axis.axis_no})`} />
                <MetaDivider />
                <MetaPair label="등급 척도" value="우수 / 보통 / 주의 / 실패" />
            </div>

            <div className="flex-1 overflow-y-auto p-5 space-y-5">
                <PreviewSection title="설명">
                    {axis.description
                        ? <div className="text-[13px] text-[#475467] leading-relaxed whitespace-pre-wrap">{axis.description}</div>
                        : <div className="text-[13px] text-[#98A2B3] italic">이 축이 측정하는 영역에 대한 설명을 입력하세요.</div>}
                </PreviewSection>
                <PreviewSection title="평가 프롬프트">
                    <pre className="text-[12px] font-mono text-[#475467] leading-relaxed whitespace-pre-wrap bg-[#FAFBFC] border border-[#E4E7EC] rounded-lg p-3">{axis.prompt_template || `이 축에 매핑된 평가항목 결과와 상담 전사를 바탕으로\n"${axis.label}" 영역의 종합 등급·분석·요약을 생성하세요.`}</pre>
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
function MetaDivider() { return <span className="w-px h-3 bg-[#E4E7EC]" />; }

/* ── 평가항목 편집 모달 ──────────────────────────────── */
function ItemModal({ mode, item, axisLabels, domainId, onSaved, onDeleted, onClose }) {
    const isEdit = mode === 'edit';
    const [category, setCategory] = useState(item?.category ?? '');
    const [name, setName] = useState(item?.item ?? '');
    const [scoringType, setScoringType] = useState(item?.scoring_type === 'yes_no' ? 'yes_no' : 'numeric');
    const [maxScore, setMaxScore] = useState(item?.max_score != null ? String(item.max_score) : '10');
    const [pentagonAxis, setPentagonAxis] = useState(item?.pentagon_axis ?? '');
    const [criterion, setCriterion] = useState(item?.criterion ?? '');
    const [prompt, setPrompt] = useState(item?.prompt_template ?? '');          // Y/N 판정 기준(텍스트)
    const [steps, setSteps] = useState(() => parseSteps(item?.prompt_template)); // 점수제 점수 단계(행)
    const [isActive, setIsActive] = useState(item?.is_active ?? true);
    const [saving, setSaving] = useState(false);
    const [err, setErr] = useState(null);
    const isNumeric = scoringType !== 'yes_no';

    return (
        <ModalShell title={isEdit ? '평가항목 편집' : '새 평가항목 추가'} onClose={onClose} widthClass="max-w-[580px]">
            <div className="px-6 py-5 space-y-4">
                <div className="grid grid-cols-2 gap-4">
                    <FormGroup label="대분류" required>
                        <input value={category} onChange={(e) => setCategory(e.target.value)} placeholder="예) 기본응대" className="form-input-pretty" />
                    </FormGroup>
                    <FormGroup label="항목명" required>
                        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="예) 인사및도입" className="form-input-pretty" />
                    </FormGroup>
                </div>

                <FormGroup label="채점 방식" required>
                    <div className="flex gap-2">
                        <button type="button" onClick={() => setScoringType('numeric')} className={pillBtn(isNumeric)}>점수제</button>
                        <button type="button" onClick={() => { setScoringType('yes_no'); setPentagonAxis(''); }} className={pillBtn(!isNumeric)}>Y/N</button>
                    </div>
                </FormGroup>

                {isNumeric ? (
                    <FormGroup label="Pentagon 매핑">
                        <select value={pentagonAxis} onChange={(e) => setPentagonAxis(e.target.value)} className="form-input-pretty cursor-pointer">
                            <option value="">매핑 없음 (총점에만 반영)</option>
                            {axisLabels.map((label, i) => (
                                <option key={label} value={label}>{AXIS_CHAR[i] || ''} {label}</option>
                            ))}
                        </select>
                        {axisLabels.length === 0 && (
                            <div className="mt-1.5 text-[11px] text-[#98A2B3]">먼저 아래 Pentagon 축을 추가하면 여기서 매핑할 수 있습니다.</div>
                        )}
                    </FormGroup>
                ) : (
                    <FormGroup label="Pentagon 매핑">
                        <div className="text-[12px] text-[#98A2B3] bg-[#F2F4F7] rounded-lg px-3 py-2.5">Y/N(컴플라이언스 체크) 항목은 펜타곤에 반영되지 않습니다.</div>
                    </FormGroup>
                )}

                {/* 항목 평가 설명 = 무엇을·어떻게 평가하는지(설명 프롬프트). 점수 단계는 여기 쓰지 않음. */}
                <FormGroup label="항목 평가 설명">
                    <textarea value={criterion} onChange={(e) => setCriterion(e.target.value)} rows={8}
                        placeholder={`이 항목을 '무엇을·어떻게' 평가하는지 설명을 작성하세요. 예)\n[평가 대상] 상담 시작 시 표준 인사와 소속·성명을 밝혔는지\n[평가 기준] 표준 인사·소속·성명 안내로 상담을 적절히 시작했는가?\n[판정 주의] 인입 직후 고객이 바로 용건을 말한 경우 도입 멘트 비중을 낮게`}
                        className="form-textarea-pretty font-mono text-[12px]" />
                </FormGroup>

                {/* 점수 기준 = 만점 + 점수 단계(행 단위). 저장 시 표준 텍스트로 합쳐 prompt_template 보관 → 엔진이 척도 파싱. */}
                <FormGroup label="점수 기준">
                    {isNumeric ? (
                        <ScoreStepsEditor maxScore={maxScore} onMaxScore={setMaxScore} steps={steps} onSteps={setSteps} />
                    ) : (
                        <>
                            <div className="text-[12px] text-[#667085] bg-[#F2F4F7] rounded-lg px-3 py-2.5 leading-relaxed mb-2.5">충족 / 위반 으로만 판정합니다. 점수·총점·펜타곤에는 반영되지 않습니다.</div>
                            <textarea value={prompt} onChange={(e) => setPrompt(e.target.value)} rows={4}
                                placeholder="충족 / 위반 판정 기준 (선택, 비워두면 추후 작성)"
                                className="form-textarea-pretty font-mono text-[12px]" />
                        </>
                    )}
                </FormGroup>

                <FormGroup label="활성 상태">
                    <div className="flex gap-2">
                        <button type="button" onClick={() => setIsActive(true)} className={pillBtn(isActive)}>활성 (복제됨)</button>
                        <button type="button" onClick={() => setIsActive(false)} className={pillBtn(!isActive)}>비활성 (복제 제외)</button>
                    </div>
                </FormGroup>

                {err && <div className="text-[12px] text-[#B42318]">{err}</div>}
            </div>

            <ModalFooter
                onCancel={() => !saving && onClose()}
                primaryLabel={saving ? '저장 중…' : (isEdit ? '저장' : '추가')}
                onPrimary={async () => {
                    if (saving) return;
                    if (!category.trim()) { setErr('대분류는 필수입니다.'); return; }
                    if (!name.trim()) { setErr('항목명은 필수입니다.'); return; }
                    if (isNumeric && !(Number(maxScore) > 0)) { setErr('점수제는 만점 > 0 이 필요합니다.'); return; }
                    setSaving(true); setErr(null);
                    // 점수제: 점수 단계 행 → 표준 텍스트. Y/N: 텍스트 그대로.
                    const promptOut = isNumeric ? (assembleSteps(steps) || null) : (prompt.trim() || null);
                    const payload = {
                        category: category.trim(), item: name.trim(),
                        scoring_type: isNumeric ? 'numeric' : 'yes_no',
                        max_score: isNumeric ? Number(maxScore) : null,
                        pentagon_axis: pentagonAxis.trim() || null,
                        criterion: criterion.trim() || null,
                        prompt_template: promptOut,
                        is_active: isActive,
                    };
                    try {
                        const saved = isEdit
                            ? await updateDomainEvalDefault(item.id, payload)
                            : await createDomainEvalDefault(domainId, payload);
                        onSaved(saved?.id ?? item?.id, 'item');
                    } catch (e) { setErr(e?.message || '저장 실패'); setSaving(false); }
                }}
                extraLeft={isEdit && (
                    <DeleteBtn disabled={saving} onClick={async () => {
                        if (!confirm(`"${item.item}" 항목을 삭제하시겠습니까?`)) return;
                        setSaving(true);
                        try { await deleteDomainEvalDefault(item.id); onDeleted(); }
                        catch (e) { setErr(e?.message || '삭제 실패'); setSaving(false); }
                    }} />
                )}
            />
        </ModalShell>
    );
}

/* ── 펜타곤 축 편집 모달 ─────────────────────────────── */
function AxisModal({ mode, axis, nextNo, domainId, onSaved, onDeleted, onClose }) {
    const isEdit = mode === 'edit';
    const [label, setLabel] = useState(axis?.label ?? '');
    const [description, setDescription] = useState(axis?.description ?? '');
    const [prompt, setPrompt] = useState(axis?.prompt_template ?? '');
    const [isActive, setIsActive] = useState(axis?.is_active ?? true);
    const [saving, setSaving] = useState(false);
    const [err, setErr] = useState(null);
    const noChar = AXIS_CHAR[(isEdit ? axis.axis_no : nextNo) - 1] || `#${isEdit ? axis.axis_no : nextNo}`;

    return (
        <ModalShell title={`${isEdit ? 'Pentagon 축 편집' : 'Pentagon 축 추가'} — ${noChar}`} onClose={onClose} widthClass="max-w-[560px]">
            <div className="px-6 py-5 space-y-4">
                <FormGroup label="축 이름 (라벨)" required>
                    <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="예) 발화 안정성" className="form-input-pretty" />
                </FormGroup>
                <FormGroup label="설명">
                    <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={3}
                        placeholder="이 축이 측정하는 영역을 한두 문장으로 (선택)" className="form-textarea-pretty" />
                </FormGroup>
                <FormGroup label="평가 프롬프트">
                    <textarea value={prompt} onChange={(e) => setPrompt(e.target.value)} rows={3}
                        placeholder="축 종합 등급 산출용 프롬프트 (선택)" className="form-textarea-pretty font-mono text-[12px]" />
                </FormGroup>
                <FormGroup label="활성 상태">
                    <div className="flex gap-2">
                        <button type="button" onClick={() => setIsActive(true)} className={pillBtn(isActive)}>활성 (복제됨)</button>
                        <button type="button" onClick={() => setIsActive(false)} className={pillBtn(!isActive)}>비활성 (복제 제외)</button>
                    </div>
                </FormGroup>
                {err && <div className="text-[12px] text-[#B42318]">{err}</div>}
            </div>

            <ModalFooter
                onCancel={() => !saving && onClose()}
                primaryLabel={saving ? '저장 중…' : (isEdit ? '저장' : '추가')}
                onPrimary={async () => {
                    if (saving) return;
                    if (!label.trim()) { setErr('축 이름은 필수입니다.'); return; }
                    setSaving(true); setErr(null);
                    const payload = {
                        label: label.trim(),
                        description: description.trim() || null,
                        prompt_template: prompt.trim() || null,
                        is_active: isActive,
                    };
                    try {
                        const saved = isEdit
                            ? await updateDomainPentagonDefault(axis.id, payload)
                            : await createDomainPentagonDefault(domainId, payload);
                        onSaved(saved?.id ?? axis?.id);
                    } catch (e) { setErr(e?.message || '저장 실패'); setSaving(false); }
                }}
                extraLeft={isEdit && (
                    <DeleteBtn disabled={saving} onClick={async () => {
                        if (!confirm(`"${axis.label}" 축을 삭제하시겠습니까?`)) return;
                        setSaving(true);
                        try { await deleteDomainPentagonDefault(axis.id); onDeleted(); }
                        catch (e) { setErr(e?.message || '삭제 실패'); setSaving(false); }
                    }} />
                )}
            />
        </ModalShell>
    );
}

/* ── 공용 모달 셸/푸터/폼 ────────────────────────────── */
function ModalShell({ title, onClose, widthClass = 'max-w-md', children }) {
    if (typeof document === 'undefined') return null;
    return createPortal(
        <div className="fixed inset-0 z-[1000] flex items-center justify-center px-4" style={{ background: 'rgba(15,23,42,0.4)' }}
            onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
            <div className={`w-full ${widthClass} bg-white rounded-2xl shadow-xl overflow-hidden max-h-[90vh] flex flex-col`}>
                <div className="px-6 pt-5 pb-3 flex items-center justify-between border-b border-[#E4E7EC] shrink-0">
                    <h3 className="text-base font-bold text-[#101828]">{title}</h3>
                    <button onClick={onClose} className="w-7 h-7 grid place-items-center rounded-md text-[#667085] hover:bg-[#F2F4F7] cursor-pointer"><X size={14} /></button>
                </div>
                <div className="overflow-y-auto flex-1">{children}</div>
            </div>
        </div>,
        document.body
    );
}

function ModalFooter({ onCancel, onPrimary, primaryLabel, extraLeft }) {
    return (
        <div className="px-6 pb-5 pt-3 border-t border-[#F2F4F7] bg-[#FAFBFC] flex items-center justify-between shrink-0">
            <div>{extraLeft}</div>
            <div className="flex gap-2">
                <button type="button" onClick={onCancel}
                    className="h-[38px] px-5 rounded-xl border border-[#E4E7EC] bg-white text-[13px] font-semibold text-[#101828] hover:bg-[#F2F4F7] cursor-pointer">취소</button>
                <button type="button" onClick={onPrimary}
                    className="h-[38px] px-5 rounded-xl bg-[#055AAF] text-white text-[13px] font-semibold hover:bg-[#1E70E0] shadow-sm inline-flex items-center gap-1.5 cursor-pointer">
                    <Save size={12} />{primaryLabel}
                </button>
            </div>
        </div>
    );
}

function DeleteBtn({ onClick, disabled }) {
    return (
        <button type="button" onClick={onClick} disabled={disabled}
            className="h-[38px] px-4 rounded-xl border border-[#FCA5A5] bg-white text-[13px] font-semibold text-[#D92D20] hover:bg-red-50 inline-flex items-center gap-1.5 cursor-pointer disabled:opacity-50">
            <Trash2 size={12} />삭제
        </button>
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

function pillBtn(active) {
    return `flex-1 h-[38px] rounded-xl border text-[13px] font-semibold cursor-pointer ${
        active ? 'bg-blue-50 border-blue-200 text-blue-700' : 'bg-white border-[#E4E7EC] text-[#667085] hover:bg-[#F2F4F7]'}`;
}
