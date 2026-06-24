import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Plus, Pencil, Trash2, X, Loader2, Check, ListChecks } from 'lucide-react';
import {
    fetchDomainEvalDefaults,
    createDomainEvalDefault,
    updateDomainEvalDefault,
    deleteDomainEvalDefault,
} from '../services/api';

// 도메인(업종)별 기본 평가항목 관리 모달.
// 여기서 저장한 항목들은 "신규 브랜드 생성 시" 그 브랜드의 평가항목(eval_item_defs)으로
// 자동 복제된다. 기존 브랜드에는 영향 없음(생성 시점에만 복제).

const EMPTY_DRAFT = {
    category: '',
    item: '',
    scoring_type: 'numeric',
    max_score: 5,
    pentagon_axis: '',
    criterion: '',
    prompt_template: '',
    is_active: true,
};

function ItemForm({ initial, onSave, onCancel, saving }) {
    const [draft, setDraft] = useState(initial);
    const set = (k, v) => setDraft((d) => ({ ...d, [k]: v }));
    const isNumeric = draft.scoring_type !== 'yes_no';
    const valid =
        draft.category.trim() &&
        draft.item.trim() &&
        (!isNumeric || Number(draft.max_score) > 0);

    return (
        <div className="border border-[#055AAF] rounded-xl p-4 bg-[#F8FAFF] space-y-3">
            <div className="grid grid-cols-2 gap-3">
                <div>
                    <label className="block text-[11px] font-semibold text-[#667085] mb-1 uppercase tracking-wide">
                        대분류 <span className="text-[#D92D20]">*</span>
                    </label>
                    <input
                        autoFocus
                        value={draft.category}
                        onChange={(e) => set('category', e.target.value)}
                        placeholder="예) 인사 예절"
                        className="w-full h-[36px] px-2.5 rounded-lg border border-[#E4E7EC] text-sm outline-none focus:border-[#055AAF]"
                    />
                </div>
                <div>
                    <label className="block text-[11px] font-semibold text-[#667085] mb-1 uppercase tracking-wide">
                        항목명 <span className="text-[#D92D20]">*</span>
                    </label>
                    <input
                        value={draft.item}
                        onChange={(e) => set('item', e.target.value)}
                        placeholder="예) 첫인사"
                        className="w-full h-[36px] px-2.5 rounded-lg border border-[#E4E7EC] text-sm outline-none focus:border-[#055AAF]"
                    />
                </div>
            </div>

            <div className="grid grid-cols-3 gap-3">
                <div>
                    <label className="block text-[11px] font-semibold text-[#667085] mb-1 uppercase tracking-wide">
                        채점 방식
                    </label>
                    <div className="flex gap-1.5">
                        {[
                            { v: 'numeric', l: '점수' },
                            { v: 'yes_no', l: 'Y/N' },
                        ].map(({ v, l }) => (
                            <button
                                key={v}
                                type="button"
                                onClick={() => set('scoring_type', v)}
                                className={`flex-1 h-[36px] rounded-lg border text-[12.5px] font-semibold cursor-pointer ${
                                    (draft.scoring_type === 'yes_no' ? 'yes_no' : 'numeric') === v
                                        ? 'bg-[#055AAF] border-[#055AAF] text-white'
                                        : 'bg-white border-[#E4E7EC] text-[#667085] hover:bg-[#F2F4F7]'
                                }`}
                            >
                                {l}
                            </button>
                        ))}
                    </div>
                </div>
                <div>
                    <label className="block text-[11px] font-semibold text-[#667085] mb-1 uppercase tracking-wide">
                        만점 {isNumeric && <span className="text-[#D92D20]">*</span>}
                    </label>
                    <input
                        type="number"
                        min={1}
                        disabled={!isNumeric}
                        value={isNumeric ? draft.max_score : ''}
                        onChange={(e) => set('max_score', e.target.value === '' ? '' : Number(e.target.value))}
                        placeholder={isNumeric ? '예) 5' : 'Y/N'}
                        className="w-full h-[36px] px-2.5 rounded-lg border border-[#E4E7EC] text-sm outline-none focus:border-[#055AAF] disabled:bg-[#F2F4F7] disabled:text-[#98A2B3]"
                    />
                </div>
                <div>
                    <label className="block text-[11px] font-semibold text-[#667085] mb-1 uppercase tracking-wide">
                        펜타곤 축 <span className="text-[10px] font-normal normal-case">(선택)</span>
                    </label>
                    <input
                        value={draft.pentagon_axis}
                        onChange={(e) => set('pentagon_axis', e.target.value)}
                        placeholder="예) 친절도"
                        className="w-full h-[36px] px-2.5 rounded-lg border border-[#E4E7EC] text-sm outline-none focus:border-[#055AAF]"
                    />
                </div>
            </div>

            <div>
                <label className="block text-[11px] font-semibold text-[#667085] mb-1 uppercase tracking-wide">
                    평가 기준 <span className="text-[10px] font-normal normal-case">(선택)</span>
                </label>
                <textarea
                    value={draft.criterion}
                    onChange={(e) => set('criterion', e.target.value)}
                    rows={2}
                    placeholder="이 항목을 어떤 기준으로 평가하는지"
                    className="w-full px-2.5 py-2 rounded-lg border border-[#E4E7EC] text-sm outline-none focus:border-[#055AAF] resize-y"
                />
            </div>

            <div>
                <label className="block text-[11px] font-semibold text-[#667085] mb-1 uppercase tracking-wide">
                    AI 프롬프트 <span className="text-[10px] font-normal normal-case">(선택)</span>
                </label>
                <textarea
                    value={draft.prompt_template}
                    onChange={(e) => set('prompt_template', e.target.value)}
                    rows={2}
                    placeholder="AI 평가에 사용할 프롬프트 (비워두면 추후 작성)"
                    className="w-full px-2.5 py-2 rounded-lg border border-[#E4E7EC] text-sm outline-none focus:border-[#055AAF] resize-y"
                />
            </div>

            <div className="flex items-center justify-between pt-1">
                <button
                    type="button"
                    onClick={() => set('is_active', !draft.is_active)}
                    className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11.5px] font-semibold cursor-pointer ${
                        draft.is_active
                            ? 'bg-green-50 text-green-700'
                            : 'bg-gray-100 text-gray-500'
                    }`}
                >
                    <span className={`w-1.5 h-1.5 rounded-full ${draft.is_active ? 'bg-green-500' : 'bg-gray-400'}`} />
                    {draft.is_active ? '활성 (복제됨)' : '비활성 (복제 제외)'}
                </button>
                <div className="flex gap-2">
                    <button
                        type="button"
                        onClick={onCancel}
                        className="h-[34px] px-4 rounded-lg border border-[#E4E7EC] bg-white text-[12.5px] font-semibold text-[#101828] hover:bg-[#F2F4F7] cursor-pointer"
                    >
                        취소
                    </button>
                    <button
                        type="button"
                        onClick={() => onSave(draft)}
                        disabled={!valid || saving}
                        className="h-[34px] px-4 rounded-lg bg-[#055AAF] text-white text-[12.5px] font-semibold hover:bg-[#1E70E0] disabled:opacity-50 cursor-pointer"
                    >
                        {saving ? <Loader2 size={13} className="animate-spin inline" /> : '저장'}
                    </button>
                </div>
            </div>
        </div>
    );
}

export default function DomainEvalItemsModal({ domain, onClose }) {
    const [items, setItems] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [editing, setEditing] = useState(null); // null | 'new' | itemId
    const [saving, setSaving] = useState(false);

    async function load() {
        setLoading(true);
        try {
            const data = await fetchDomainEvalDefaults(domain.id);
            setItems(data);
            setError(null);
        } catch (e) {
            setError(e?.message || '로드 실패');
        } finally {
            setLoading(false);
        }
    }

    useEffect(() => {
        load();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [domain.id]);

    function toPayload(draft) {
        const isNumeric = draft.scoring_type !== 'yes_no';
        return {
            category: draft.category.trim(),
            item: draft.item.trim(),
            scoring_type: isNumeric ? 'numeric' : 'yes_no',
            max_score: isNumeric ? Number(draft.max_score) : null,
            pentagon_axis: draft.pentagon_axis.trim() || null,
            criterion: draft.criterion.trim() || null,
            prompt_template: draft.prompt_template.trim() || null,
            is_active: draft.is_active !== false,
        };
    }

    async function handleCreate(draft) {
        setSaving(true);
        try {
            await createDomainEvalDefault(domain.id, toPayload(draft));
            setEditing(null);
            await load();
        } catch (e) {
            alert(e?.message || '추가 실패');
        } finally {
            setSaving(false);
        }
    }

    async function handleUpdate(itemId, draft) {
        setSaving(true);
        try {
            await updateDomainEvalDefault(itemId, toPayload(draft));
            setEditing(null);
            await load();
        } catch (e) {
            alert(e?.message || '수정 실패');
        } finally {
            setSaving(false);
        }
    }

    async function handleDelete(it) {
        if (!confirm(`"${it.item}" 항목을 삭제하시겠습니까?`)) return;
        try {
            await deleteDomainEvalDefault(it.id);
            setItems((prev) => prev.filter((x) => x.id !== it.id));
        } catch (e) {
            alert(e?.message || '삭제 실패');
        }
    }

    if (typeof document === 'undefined') return null;
    // document.body 포털 — 본문 컨테이너에 갇히지 않고 화면 전체를 덮는다(사이드바·상단바 포함).
    return createPortal(
        <div
            className="fixed inset-0 z-[110] flex items-center justify-center px-4"
            style={{ background: 'rgba(15,23,42,0.45)' }}
            onClick={(e) => {
                if (e.target === e.currentTarget) onClose();
            }}
        >
            <div className="w-full max-w-3xl bg-white rounded-2xl shadow-xl overflow-hidden max-h-[90vh] flex flex-col">
                <div className="px-6 pt-5 pb-4 flex items-start justify-between border-b border-[#E4E7EC]">
                    <div className="flex items-start gap-3">
                        <div className="w-9 h-9 rounded-lg grid place-items-center bg-blue-50 text-blue-600 shrink-0">
                            <ListChecks size={17} />
                        </div>
                        <div>
                            <h3 className="text-base font-bold text-[#101828]">
                                {domain.name} · 기본 평가항목
                            </h3>
                            <p className="text-[12px] text-[#667085] mt-0.5 leading-snug">
                                이 도메인으로 <b>신규 브랜드를 생성</b>하면 아래 활성 항목들이 그 브랜드의
                                평가항목으로 자동 복제됩니다. (기존 브랜드에는 영향 없음)
                            </p>
                        </div>
                    </div>
                    <button
                        onClick={onClose}
                        className="w-7 h-7 grid place-items-center rounded-md text-[#667085] hover:bg-[#F2F4F7] cursor-pointer shrink-0"
                    >
                        <X size={15} />
                    </button>
                </div>

                <div className="px-6 py-4 overflow-y-auto space-y-3">
                    {error && <p className="text-sm text-[#D92D20]">{error}</p>}

                    {loading ? (
                        <div className="flex justify-center py-10">
                            <Loader2 className="h-5 w-5 animate-spin text-[#667085]" />
                        </div>
                    ) : (
                        <>
                            <div className="bg-white border border-[#E4E7EC] rounded-xl overflow-hidden">
                                <table className="w-full text-sm">
                                    <thead>
                                        <tr className="border-b border-[#E4E7EC] bg-[#F9FAFB]">
                                            <th className="px-3 py-2.5 text-left text-[11px] font-semibold text-[#667085] uppercase tracking-wider w-[44px]">#</th>
                                            <th className="px-3 py-2.5 text-left text-[11px] font-semibold text-[#667085] uppercase tracking-wider">대분류</th>
                                            <th className="px-3 py-2.5 text-left text-[11px] font-semibold text-[#667085] uppercase tracking-wider">항목</th>
                                            <th className="px-3 py-2.5 text-left text-[11px] font-semibold text-[#667085] uppercase tracking-wider w-[90px]">배점</th>
                                            <th className="px-3 py-2.5 text-center text-[11px] font-semibold text-[#667085] uppercase tracking-wider w-[64px]">활성</th>
                                            <th className="px-3 py-2.5 text-right text-[11px] font-semibold text-[#667085] uppercase tracking-wider w-[88px]">액션</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-[#E4E7EC]">
                                        {items.length === 0 && editing !== 'new' && (
                                            <tr>
                                                <td colSpan={6} className="px-3 py-8 text-center text-[13px] text-[#667085]">
                                                    아직 등록된 기본 평가항목이 없습니다. <br />
                                                    아래 <b>항목 추가</b>로 이 도메인의 디폴트를 만들어 주세요.
                                                </td>
                                            </tr>
                                        )}
                                        {items.map((it) =>
                                            editing === it.id ? (
                                                <tr key={it.id}>
                                                    <td colSpan={6} className="px-3 py-3 bg-[#F8FAFF]">
                                                        <ItemForm
                                                            initial={{
                                                                category: it.category || '',
                                                                item: it.item || '',
                                                                scoring_type: it.scoring_type === 'yes_no' ? 'yes_no' : 'numeric',
                                                                max_score: it.max_score ?? 5,
                                                                pentagon_axis: it.pentagon_axis || '',
                                                                criterion: it.criterion || '',
                                                                prompt_template: it.prompt_template || '',
                                                                is_active: it.is_active !== false,
                                                            }}
                                                            onSave={(d) => handleUpdate(it.id, d)}
                                                            onCancel={() => setEditing(null)}
                                                            saving={saving}
                                                        />
                                                    </td>
                                                </tr>
                                            ) : (
                                                <tr key={it.id} className="hover:bg-[#F9FAFB]">
                                                    <td className="px-3 py-2.5 text-[12.5px] text-[#667085] tabular-nums">{it.order_no}</td>
                                                    <td className="px-3 py-2.5 text-[13px] text-[#475467]">{it.category}</td>
                                                    <td className="px-3 py-2.5 text-[13px] font-medium text-[#101828]">{it.item}</td>
                                                    <td className="px-3 py-2.5">
                                                        {it.scoring_type === 'yes_no' ? (
                                                            <span className="inline-flex items-center px-2 py-0.5 rounded-md text-[11px] font-semibold bg-[#EEF4FF] text-[#3538CD]">Y/N</span>
                                                        ) : (
                                                            <span className="text-[12.5px] text-[#101828] tabular-nums font-semibold">{it.max_score}점</span>
                                                        )}
                                                    </td>
                                                    <td className="px-3 py-2.5 text-center">
                                                        {it.is_active !== false ? (
                                                            <span className="inline-block w-1.5 h-1.5 rounded-full bg-green-500" title="활성 (복제됨)" />
                                                        ) : (
                                                            <span className="inline-block w-1.5 h-1.5 rounded-full bg-gray-300" title="비활성 (복제 제외)" />
                                                        )}
                                                    </td>
                                                    <td className="px-3 py-2.5 text-right">
                                                        <div className="inline-flex items-center gap-1">
                                                            <button
                                                                onClick={() => setEditing(it.id)}
                                                                className="p-1.5 rounded-md text-[#667085] hover:text-[#101828] hover:bg-[#F2F4F7] cursor-pointer"
                                                                title="편집"
                                                            >
                                                                <Pencil size={13} />
                                                            </button>
                                                            <button
                                                                onClick={() => handleDelete(it)}
                                                                className="p-1.5 rounded-md text-[#667085] hover:text-[#D92D20] hover:bg-red-50 cursor-pointer"
                                                                title="삭제"
                                                            >
                                                                <Trash2 size={13} />
                                                            </button>
                                                        </div>
                                                    </td>
                                                </tr>
                                            )
                                        )}
                                    </tbody>
                                </table>
                            </div>

                            {editing === 'new' ? (
                                <ItemForm
                                    initial={EMPTY_DRAFT}
                                    onSave={handleCreate}
                                    onCancel={() => setEditing(null)}
                                    saving={saving}
                                />
                            ) : (
                                <button
                                    onClick={() => setEditing('new')}
                                    className="inline-flex items-center gap-1.5 h-[36px] px-4 rounded-lg border border-[#E4E7EC] bg-white text-[13px] font-semibold text-[#101828] hover:bg-[#F2F4F7] cursor-pointer"
                                >
                                    <Plus size={14} /> 항목 추가
                                </button>
                            )}
                        </>
                    )}
                </div>

                <div className="px-6 py-3.5 border-t border-[#E4E7EC] bg-[#F9FAFB] flex items-center justify-between">
                    <span className="text-[12px] text-[#667085]">
                        활성 {items.filter((i) => i.is_active !== false).length}개 · 전체 {items.length}개
                    </span>
                    <button
                        onClick={onClose}
                        className="inline-flex items-center gap-1.5 h-[34px] px-5 rounded-lg bg-[#101828] text-white text-[12.5px] font-semibold hover:bg-[#1D2939] cursor-pointer"
                    >
                        <Check size={14} /> 완료
                    </button>
                </div>
            </div>
        </div>,
        document.body
    );
}
