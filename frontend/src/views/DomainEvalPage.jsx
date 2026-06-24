import React, { useEffect, useState } from 'react';
import {
    Plus, Pencil, Trash2, Loader2, ChevronLeft, ListChecks, Radar,
} from 'lucide-react';
import {
    fetchDomainEvalDefaults, createDomainEvalDefault, updateDomainEvalDefault, deleteDomainEvalDefault,
    fetchDomainPentagonDefaults, createDomainPentagonDefault, updateDomainPentagonDefault, deleteDomainPentagonDefault,
} from '../services/api';

// 도메인(업종)별 기본 평가체계 편집 — 평가항목 + 펜타곤 축 두 섹션을 한 페이지에서 관리.
// 여기 활성 항목/축이 "신규 브랜드 생성 시" 그 브랜드로 자동 복제된다(기존 브랜드 무영향).
// AI QA 항목관리(EvalItems.jsx)와 동일한 운영 개념, 단 도메인 템플릿이라 버전관리는 없음.

const AXIS_NUM = ['①', '②', '③', '④', '⑤', '⑥', '⑦', '⑧'];

const EMPTY_ITEM = {
    category: '', item: '', scoring_type: 'numeric', max_score: 10,
    pentagon_axis: '', criterion: '', prompt_template: '', is_active: true,
};
const EMPTY_AXIS = { label: '', description: '', prompt_template: '', is_active: true };

/* ── 평가항목 폼 ─────────────────────────────────────── */
function ItemForm({ initial, axisLabels, onSave, onCancel, saving }) {
    const [d, setD] = useState(initial);
    const set = (k, v) => setD((p) => ({ ...p, [k]: v }));
    const isNumeric = d.scoring_type !== 'yes_no';
    const valid = d.category.trim() && d.item.trim() && (!isNumeric || Number(d.max_score) > 0);

    return (
        <div className="border border-[#055AAF] rounded-xl p-4 bg-[#F8FAFF] space-y-3">
            <div className="grid grid-cols-2 gap-3">
                <Field label="대분류" required>
                    <input autoFocus value={d.category} onChange={(e) => set('category', e.target.value)}
                        placeholder="예) 기본응대" className={inputCls} />
                </Field>
                <Field label="항목명" required>
                    <input value={d.item} onChange={(e) => set('item', e.target.value)}
                        placeholder="예) 인사및도입" className={inputCls} />
                </Field>
            </div>
            <div className="grid grid-cols-3 gap-3">
                <Field label="채점 방식">
                    <div className="flex gap-1.5">
                        {[{ v: 'numeric', l: '점수' }, { v: 'yes_no', l: 'Y/N' }].map(({ v, l }) => (
                            <button key={v} type="button" onClick={() => set('scoring_type', v)}
                                className={`flex-1 h-[36px] rounded-lg border text-[12.5px] font-semibold cursor-pointer ${
                                    (d.scoring_type === 'yes_no' ? 'yes_no' : 'numeric') === v
                                        ? 'bg-[#055AAF] border-[#055AAF] text-white'
                                        : 'bg-white border-[#E4E7EC] text-[#667085] hover:bg-[#F2F4F7]'}`}>
                                {l}
                            </button>
                        ))}
                    </div>
                </Field>
                <Field label={`만점${isNumeric ? ' *' : ''}`}>
                    <input type="number" min={1} disabled={!isNumeric}
                        value={isNumeric ? d.max_score : ''}
                        onChange={(e) => set('max_score', e.target.value === '' ? '' : Number(e.target.value))}
                        placeholder={isNumeric ? '예) 10' : 'Y/N'}
                        className={`${inputCls} disabled:bg-[#F2F4F7] disabled:text-[#98A2B3]`} />
                </Field>
                <Field label="펜타곤 매핑">
                    <select value={d.pentagon_axis} onChange={(e) => set('pentagon_axis', e.target.value)}
                        className={`${inputCls} cursor-pointer`}>
                        <option value="">매핑 없음 (총점만)</option>
                        {axisLabels.map((label, i) => (
                            <option key={label} value={label}>{AXIS_NUM[i] || ''} {label}</option>
                        ))}
                    </select>
                </Field>
            </div>
            <Field label="평가 기준 (선택)">
                <textarea value={d.criterion} onChange={(e) => set('criterion', e.target.value)} rows={2}
                    placeholder="이 항목을 어떤 기준으로 평가하는지" className={`${inputCls} py-2 resize-y h-auto`} />
            </Field>
            <Field label="AI 프롬프트 (선택)">
                <textarea value={d.prompt_template} onChange={(e) => set('prompt_template', e.target.value)} rows={2}
                    placeholder="AI 평가에 사용할 프롬프트 (비워두면 추후 작성)" className={`${inputCls} py-2 resize-y h-auto`} />
            </Field>
            <FormFooter active={d.is_active} onToggle={() => set('is_active', !d.is_active)}
                onCancel={onCancel} onSave={() => onSave(d)} canSave={valid} saving={saving} />
        </div>
    );
}

/* ── 펜타곤 축 폼 ─────────────────────────────────────── */
function AxisForm({ initial, onSave, onCancel, saving }) {
    const [d, setD] = useState(initial);
    const set = (k, v) => setD((p) => ({ ...p, [k]: v }));
    const valid = d.label.trim();
    return (
        <div className="border border-[#055AAF] rounded-xl p-4 bg-[#F8FAFF] space-y-3">
            <Field label="축 이름" required>
                <input autoFocus value={d.label} onChange={(e) => set('label', e.target.value)}
                    placeholder="예) 응대 화법·음성" className={inputCls} />
            </Field>
            <Field label="설명 (선택)">
                <textarea value={d.description} onChange={(e) => set('description', e.target.value)} rows={2}
                    placeholder="이 축이 무엇을 측정하는지" className={`${inputCls} py-2 resize-y h-auto`} />
            </Field>
            <Field label="AI 프롬프트 (선택)">
                <textarea value={d.prompt_template} onChange={(e) => set('prompt_template', e.target.value)} rows={2}
                    placeholder="축 점수 산출용 프롬프트" className={`${inputCls} py-2 resize-y h-auto`} />
            </Field>
            <FormFooter active={d.is_active} onToggle={() => set('is_active', !d.is_active)}
                onCancel={onCancel} onSave={() => onSave(d)} canSave={valid} saving={saving} />
        </div>
    );
}

/* ── 공통 소품 ───────────────────────────────────────── */
const inputCls = 'w-full h-[36px] px-2.5 rounded-lg border border-[#E4E7EC] text-sm outline-none focus:border-[#055AAF]';

function Field({ label, required, children }) {
    return (
        <div>
            <label className="block text-[11px] font-semibold text-[#667085] mb-1 uppercase tracking-wide">
                {label} {required && <span className="text-[#D92D20]">*</span>}
            </label>
            {children}
        </div>
    );
}

function FormFooter({ active, onToggle, onCancel, onSave, canSave, saving }) {
    return (
        <div className="flex items-center justify-between pt-1">
            <button type="button" onClick={onToggle}
                className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11.5px] font-semibold cursor-pointer ${
                    active ? 'bg-green-50 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                <span className={`w-1.5 h-1.5 rounded-full ${active ? 'bg-green-500' : 'bg-gray-400'}`} />
                {active ? '활성 (복제됨)' : '비활성 (복제 제외)'}
            </button>
            <div className="flex gap-2">
                <button type="button" onClick={onCancel}
                    className="h-[34px] px-4 rounded-lg border border-[#E4E7EC] bg-white text-[12.5px] font-semibold text-[#101828] hover:bg-[#F2F4F7] cursor-pointer">
                    취소
                </button>
                <button type="button" onClick={onSave} disabled={!canSave || saving}
                    className="h-[34px] px-4 rounded-lg bg-[#055AAF] text-white text-[12.5px] font-semibold hover:bg-[#1E70E0] disabled:opacity-50 cursor-pointer">
                    {saving ? <Loader2 size={13} className="animate-spin inline" /> : '저장'}
                </button>
            </div>
        </div>
    );
}

function SectionCard({ icon: Icon, title, count, children }) {
    return (
        <div className="bg-white border border-[#E4E7EC] rounded-xl overflow-hidden">
            <div className="flex items-center gap-2 px-4 py-3 border-b border-[#E4E7EC] bg-[#F9FAFB]">
                <Icon size={15} className="text-[#055AAF]" />
                <span className="text-[13px] font-bold text-[#101828]">{title}</span>
                <span className="text-[11.5px] text-[#667085]">{count}</span>
            </div>
            <div className="p-4 space-y-3">{children}</div>
        </div>
    );
}

/* ── 페이지 ──────────────────────────────────────────── */
export default function DomainEvalPage({ domain, onBack }) {
    const [items, setItems] = useState([]);
    const [axes, setAxes] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [editItem, setEditItem] = useState(null); // null | 'new' | id
    const [editAxis, setEditAxis] = useState(null);
    const [savingItem, setSavingItem] = useState(false);
    const [savingAxis, setSavingAxis] = useState(false);

    async function load() {
        setLoading(true);
        try {
            const [it, ax] = await Promise.all([
                fetchDomainEvalDefaults(domain.id),
                fetchDomainPentagonDefaults(domain.id),
            ]);
            setItems(it);
            setAxes(ax);
            setError(null);
        } catch (e) {
            setError(e?.message || '로드 실패');
        } finally {
            setLoading(false);
        }
    }
    useEffect(() => { load(); /* eslint-disable-next-line */ }, [domain.id]);

    const activeAxisLabels = axes.filter((a) => a.is_active !== false).map((a) => a.label);

    function itemPayload(d) {
        const isNumeric = d.scoring_type !== 'yes_no';
        return {
            category: d.category.trim(), item: d.item.trim(),
            scoring_type: isNumeric ? 'numeric' : 'yes_no',
            max_score: isNumeric ? Number(d.max_score) : null,
            pentagon_axis: d.pentagon_axis.trim() || null,
            criterion: d.criterion.trim() || null,
            prompt_template: d.prompt_template.trim() || null,
            is_active: d.is_active !== false,
        };
    }
    function axisPayload(d) {
        return {
            label: d.label.trim(),
            description: d.description.trim() || null,
            prompt_template: d.prompt_template.trim() || null,
            is_active: d.is_active !== false,
        };
    }

    async function saveItem(d, id) {
        setSavingItem(true);
        try {
            if (id === 'new') await createDomainEvalDefault(domain.id, itemPayload(d));
            else await updateDomainEvalDefault(id, itemPayload(d));
            setEditItem(null);
            await load();
        } catch (e) { alert(e?.message || '저장 실패'); }
        finally { setSavingItem(false); }
    }
    async function delItem(it) {
        if (!confirm(`"${it.item}" 항목을 삭제하시겠습니까?`)) return;
        try { await deleteDomainEvalDefault(it.id); setItems((p) => p.filter((x) => x.id !== it.id)); }
        catch (e) { alert(e?.message || '삭제 실패'); }
    }
    async function saveAxis(d, id) {
        setSavingAxis(true);
        try {
            if (id === 'new') await createDomainPentagonDefault(domain.id, axisPayload(d));
            else await updateDomainPentagonDefault(id, axisPayload(d));
            setEditAxis(null);
            await load();
        } catch (e) { alert(e?.message || '저장 실패'); }
        finally { setSavingAxis(false); }
    }
    async function delAxis(a) {
        if (!confirm(`"${a.label}" 축을 삭제하시겠습니까?`)) return;
        try { await deleteDomainPentagonDefault(a.id); setAxes((p) => p.filter((x) => x.id !== a.id)); }
        catch (e) { alert(e?.message || '삭제 실패'); }
    }

    return (
        <div className="w-full space-y-[14px]">
            {/* 헤더 */}
            <div className="flex items-start gap-3">
                <button onClick={onBack}
                    className="mt-0.5 inline-flex items-center gap-1 h-[34px] px-3 rounded-lg border border-[#E4E7EC] bg-white text-[13px] font-semibold text-[#101828] hover:bg-[#F2F4F7] cursor-pointer shrink-0">
                    <ChevronLeft size={15} /> 도메인 목록
                </button>
                <div>
                    <h1 className="text-[20px] font-bold text-[#101828] leading-tight">
                        {domain.name} <span className="text-[#667085] font-semibold">· 기본 평가체계</span>
                    </h1>
                    <p className="text-[12.5px] text-[#667085] mt-1 leading-snug">
                        이 도메인으로 <b>신규 브랜드를 생성</b>하면 아래 <b>활성</b> 평가항목·펜타곤 축이 그 브랜드로 자동 복제됩니다.
                        (기존 브랜드에는 영향 없음)
                    </p>
                </div>
            </div>

            {error && <p className="text-sm text-[#D92D20]">{error}</p>}

            {loading ? (
                <div className="flex justify-center py-16"><Loader2 className="h-5 w-5 animate-spin text-[#667085]" /></div>
            ) : (
                <>
                    {/* 평가항목 */}
                    <SectionCard icon={ListChecks} title="평가항목"
                        count={`활성 ${items.filter((i) => i.is_active !== false).length} · 전체 ${items.length}`}>
                        <div className="bg-white border border-[#E4E7EC] rounded-xl overflow-hidden">
                            <table className="w-full text-sm">
                                <thead>
                                    <tr className="border-b border-[#E4E7EC] bg-[#F9FAFB]">
                                        <Th w="44px">#</Th><Th>대분류</Th><Th>항목</Th>
                                        <Th w="86px">배점</Th><Th>펜타곤축</Th>
                                        <Th w="60px" center>활성</Th><Th w="84px" right>액션</Th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-[#E4E7EC]">
                                    {items.length === 0 && editItem !== 'new' && (
                                        <tr><td colSpan={7} className="px-3 py-7 text-center text-[13px] text-[#667085]">
                                            등록된 평가항목이 없습니다. 아래 <b>항목 추가</b>로 만들어 주세요.
                                        </td></tr>
                                    )}
                                    {items.map((it) => editItem === it.id ? (
                                        <tr key={it.id}><td colSpan={7} className="px-3 py-3 bg-[#F8FAFF]">
                                            <ItemForm
                                                initial={{
                                                    category: it.category || '', item: it.item || '',
                                                    scoring_type: it.scoring_type === 'yes_no' ? 'yes_no' : 'numeric',
                                                    max_score: it.max_score ?? 10,
                                                    pentagon_axis: it.pentagon_axis || '',
                                                    criterion: it.criterion || '', prompt_template: it.prompt_template || '',
                                                    is_active: it.is_active !== false,
                                                }}
                                                axisLabels={activeAxisLabels}
                                                onSave={(d) => saveItem(d, it.id)} onCancel={() => setEditItem(null)} saving={savingItem} />
                                        </td></tr>
                                    ) : (
                                        <tr key={it.id} className="hover:bg-[#F9FAFB]">
                                            <Td className="text-[#667085] tabular-nums">{it.order_no}</Td>
                                            <Td className="text-[#475467]">{it.category}</Td>
                                            <Td className="font-medium text-[#101828]">{it.item}</Td>
                                            <Td>{it.scoring_type === 'yes_no'
                                                ? <span className="inline-flex px-2 py-0.5 rounded-md text-[11px] font-semibold bg-[#EEF4FF] text-[#3538CD]">Y/N</span>
                                                : <span className="text-[12.5px] font-semibold text-[#101828] tabular-nums">{it.max_score}점</span>}</Td>
                                            <Td className="text-[12px] text-[#667085]">{it.pentagon_axis || <span className="text-[#C4C9D2]">—</span>}</Td>
                                            <Td center>{it.is_active !== false
                                                ? <Dot color="bg-green-500" title="활성" /> : <Dot color="bg-gray-300" title="비활성" />}</Td>
                                            <Td right><RowActions onEdit={() => setEditItem(it.id)} onDelete={() => delItem(it)} /></Td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                        {editItem === 'new'
                            ? <ItemForm initial={EMPTY_ITEM} axisLabels={activeAxisLabels}
                                onSave={(d) => saveItem(d, 'new')} onCancel={() => setEditItem(null)} saving={savingItem} />
                            : <AddBtn label="항목 추가" onClick={() => setEditItem('new')} />}
                    </SectionCard>

                    {/* 펜타곤 축 */}
                    <SectionCard icon={Radar} title="펜타곤(레이더) 축"
                        count={`활성 ${axes.filter((a) => a.is_active !== false).length} · 전체 ${axes.length}`}>
                        <div className="bg-white border border-[#E4E7EC] rounded-xl overflow-hidden">
                            <table className="w-full text-sm">
                                <thead>
                                    <tr className="border-b border-[#E4E7EC] bg-[#F9FAFB]">
                                        <Th w="44px">#</Th><Th>축 이름</Th><Th>설명</Th>
                                        <Th w="60px" center>활성</Th><Th w="84px" right>액션</Th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-[#E4E7EC]">
                                    {axes.length === 0 && editAxis !== 'new' && (
                                        <tr><td colSpan={5} className="px-3 py-7 text-center text-[13px] text-[#667085]">
                                            등록된 펜타곤 축이 없습니다. 아래 <b>축 추가</b>로 만들어 주세요. (보통 5축)
                                        </td></tr>
                                    )}
                                    {axes.map((a, idx) => editAxis === a.id ? (
                                        <tr key={a.id}><td colSpan={5} className="px-3 py-3 bg-[#F8FAFF]">
                                            <AxisForm
                                                initial={{
                                                    label: a.label || '', description: a.description || '',
                                                    prompt_template: a.prompt_template || '', is_active: a.is_active !== false,
                                                }}
                                                onSave={(d) => saveAxis(d, a.id)} onCancel={() => setEditAxis(null)} saving={savingAxis} />
                                        </td></tr>
                                    ) : (
                                        <tr key={a.id} className="hover:bg-[#F9FAFB]">
                                            <Td className="text-[#667085] tabular-nums">{AXIS_NUM[idx] || a.axis_no}</Td>
                                            <Td className="font-medium text-[#101828]">{a.label}</Td>
                                            <Td className="text-[12px] text-[#667085] truncate max-w-[420px]">{a.description || <span className="text-[#C4C9D2]">—</span>}</Td>
                                            <Td center>{a.is_active !== false
                                                ? <Dot color="bg-green-500" title="활성" /> : <Dot color="bg-gray-300" title="비활성" />}</Td>
                                            <Td right><RowActions onEdit={() => setEditAxis(a.id)} onDelete={() => delAxis(a)} /></Td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                        {editAxis === 'new'
                            ? <AxisForm initial={EMPTY_AXIS} onSave={(d) => saveAxis(d, 'new')} onCancel={() => setEditAxis(null)} saving={savingAxis} />
                            : <AddBtn label="축 추가" onClick={() => setEditAxis('new')} />}
                    </SectionCard>
                </>
            )}
        </div>
    );
}

/* ── 테이블 소품 ─────────────────────────────────────── */
function Th({ children, w, center, right }) {
    return (
        <th style={w ? { width: w } : undefined}
            className={`px-3 py-2.5 text-[11px] font-semibold text-[#667085] uppercase tracking-wider ${center ? 'text-center' : right ? 'text-right' : 'text-left'}`}>
            {children}
        </th>
    );
}
function Td({ children, className = '', center, right }) {
    return <td className={`px-3 py-2.5 text-[13px] ${center ? 'text-center' : right ? 'text-right' : ''} ${className}`}>{children}</td>;
}
function Dot({ color, title }) {
    return <span className={`inline-block w-1.5 h-1.5 rounded-full ${color}`} title={title} />;
}
function RowActions({ onEdit, onDelete }) {
    return (
        <div className="inline-flex items-center gap-1">
            <button onClick={onEdit} className="p-1.5 rounded-md text-[#667085] hover:text-[#101828] hover:bg-[#F2F4F7] cursor-pointer" title="편집"><Pencil size={13} /></button>
            <button onClick={onDelete} className="p-1.5 rounded-md text-[#667085] hover:text-[#D92D20] hover:bg-red-50 cursor-pointer" title="삭제"><Trash2 size={13} /></button>
        </div>
    );
}
function AddBtn({ label, onClick }) {
    return (
        <button onClick={onClick}
            className="inline-flex items-center gap-1.5 h-[36px] px-4 rounded-lg border border-[#E4E7EC] bg-white text-[13px] font-semibold text-[#101828] hover:bg-[#F2F4F7] cursor-pointer">
            <Plus size={14} /> {label}
        </button>
    );
}
