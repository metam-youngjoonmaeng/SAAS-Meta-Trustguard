import { useState } from 'react';
import { createPortal } from 'react-dom';
import { Sparkles, X, RefreshCw, AlertTriangle, Check, Info } from 'lucide-react';
import { composeEvalPrompt } from '../services/api';

// AI 프롬프트 다듬기 — 평가항목 편집 모달(EvalItems/DomainEvalPage 공용) 항목 평가 설명용.
//   버튼 → 서버 /api/admin/eval-items/compose-prompt (파이프라인 Haiku 프록시) → 검토 모달.
//   검토 모달에서 생성본 직접 수정 + 단계 조건 행별 채택 후 [적용] — 폼 state 에만 반영,
//   DB 저장은 편집 모달의 기존 저장 버튼(이중 안전장치, 자동 저장 없음).
//
// props:
//   itemName/category/scoringType/maxScore/steps/criterion/ynDraft — 편집 폼 현재 상태(읽기)
//   onCriterion(text) / onSteps(rows) / onYnDraft(text) / onMaxScore(str) — 적용 시 폼 반영 콜백
//   steps 행 형식은 ScoreStepsEditor 와 동일: [{score, desc}]
//
// 만점 변경 제안(suggested_max_score): 초안의 점수 체계가 폼 만점과 모순되면 파이프라인이 새
//   만점 + 그 척도의 대체 단계를 제안 — 검토 모달의 "만점 변경" 체크 채택 시에만 만점·단계를
//   함께 교체(단계만 새 척도로 적용돼 만점≠최고단계 저장 차단에 걸리는 어긋남 방지).

export default function AiPromptCompose({
    itemName,
    category,
    scoringType,
    maxScore,
    steps,
    criterion,
    ynDraft,
    onCriterion,
    onSteps,
    onYnDraft,
    onMaxScore,
    onAiReplacedSteps,
}) {
    const [composing, setComposing] = useState(false);
    const [error, setError] = useState(null);
    const [result, setResult] = useState(null); // {criterion_text, step_conditions, yn_criteria, warnings, _nonce}
    const isYn = scoringType === 'yes_no';
    // 생성 모드(단계가 있을 때만 선택 노출) — 따르기(기본): 기존 점수 단계를 베이스로 설명만 작성(단계 불변).
    //   해제: 처음부터 전부 작성 — 설명 + 단계 구성까지 새로 제안(채택 시 기존 단계 교체).
    const hasStepRows = !isYn && (steps || []).some((s) => Number.isFinite(Number(s.score)));
    const [followSteps, setFollowSteps] = useState(true);

    const run = async () => {
        if (composing) return;
        if (!String(criterion || '').trim()) {
            setError('먼저 항목 평가 설명에 초안을 작성해 주세요. (대충 적어도 됩니다)');
            return;
        }
        setComposing(true);
        setError(null);
        try {
            const j = await composeEvalPrompt({
                item_name: itemName || '',
                category: category || '',
                scoring_type: isYn ? 'yes_no' : 'numeric',
                max_score: isYn ? null : Number(maxScore) > 0 ? Number(maxScore) : null,
                // "처음부터 작성" 모드는 단계를 비워 보내 신규 단계 제안을 유도(기존 단계는 채택 시에만 교체).
                steps: isYn || (hasStepRows && !followSteps)
                    ? []
                    : (steps || [])
                          .map((s) => ({ score: Number(s.score), condition: String(s.desc || '') }))
                          .filter((s) => Number.isFinite(s.score)),
                criterion_draft: criterion,
                yn_criteria_draft: isYn ? String(ynDraft || '') : '',
            });
            if (!j?.ok) throw new Error(j?.error || 'AI 생성에 실패했습니다.');
            setResult({ ...j, _nonce: Date.now() });
        } catch (e) {
            setError(e?.message || 'AI 생성에 실패했습니다.');
        } finally {
            setComposing(false);
        }
    };

    return (
        <>
            <div className="flex items-center justify-between mb-1.5">
                <span className="text-[11px] text-[#98A2B3]">초안을 적고 AI 로 다듬을 수 있습니다</span>
                <div className="flex items-center gap-1.5">
                    {/* 생성 모드 토글 — 단계가 있을 때만. 기본=따르기(단계 베이스 설명 작성, 단계 불변). */}
                    {hasStepRows && (
                        <label className="flex items-center gap-1 cursor-pointer select-none mr-0.5" title="체크: 기존 점수 단계를 베이스로 설명만 작성 (단계 유지) / 해제: 설명·단계 모두 처음부터 새로 제안">
                            <input
                                type="checkbox"
                                checked={followSteps}
                                onChange={(e) => setFollowSteps(e.target.checked)}
                                className="w-3.5 h-3.5 accent-[#6941C6] cursor-pointer"
                            />
                            <span className="text-[11.5px] font-medium text-[#475467]">점수 단계 따르기</span>
                        </label>
                    )}
                    {/* ⓘ 도움말 — hover 툴팁(group-hover). cursor-help + 아래로 펼침(우측 정렬). */}
                    <span className="relative group inline-flex items-center">
                        <Info size={14} className="text-[#98A2B3] group-hover:text-[#6941C6] cursor-help" />
                        <span className="pointer-events-none absolute right-0 top-full mt-1.5 w-[310px] z-50 hidden group-hover:block bg-[#101828] text-white text-[11.5px] leading-relaxed rounded-lg px-3 py-2.5 shadow-lg">
                            평가 기준을 대충 적어두고 버튼을 누르면, AI 가 평가에 바로 쓸 수 있도록 깔끔하게 정리해 줍니다.
                            <br />· 무엇을 보고 어떤 순서로 판정할지 읽기 쉬운 문장으로 다시 써 줍니다
                            <br />· 점수 단계 문구는 그대로 두고, AI 가 만든 정밀 판정 기준을 설명에 함께 담습니다
                            <br />· 설명에 &quot;30점 만점&quot;처럼 지금과 다른 만점을 적으면 만점 바꾸기도 제안합니다
                            <br />· 결과는 바로 저장되지 않아요 — 내용을 확인한 뒤 저장 버튼을 눌러야 반영됩니다
                        </span>
                    </span>
                    <button
                        type="button"
                        onClick={run}
                        disabled={composing}
                        className={`inline-flex items-center gap-1 h-7 px-2.5 rounded-lg border text-[12px] font-semibold ${
                            composing
                                ? 'border-[#E4E7EC] bg-[#F9FAFB] text-[#98A2B3] cursor-default'
                                : 'border-[#C7B8F5] bg-[#F6F3FF] text-[#6941C6] hover:bg-[#EFE9FE] cursor-pointer'
                        }`}
                    >
                        <Sparkles size={13} /> {composing ? 'AI 생성 중…' : 'AI 프롬프트 다듬기'}
                    </button>
                </div>
            </div>
            {error && <div className="mb-1.5 text-[11.5px] text-[#B42318]">{error}</div>}
            {result && (
                <ReviewModal
                    key={result._nonce}
                    original={criterion}
                    result={result}
                    isYn={isYn}
                    currentSteps={steps || []}
                    currentMax={maxScore}
                    fromScratch={hasStepRows && !followSteps}
                    busy={composing}
                    onRegenerate={run}
                    onClose={() => setResult(null)}
                    onApply={({ text, adoptedSteps, maxScoreChange, replaceSteps, ynText }) => {
                        onCriterion?.(text);
                        if (!isYn && maxScoreChange != null) onMaxScore?.(String(maxScoreChange));
                        if (!isYn && adoptedSteps.length) {
                            if (replaceSteps || !(steps || []).length) {
                                // 만점 변경 채택(새 척도)·처음부터 작성·단계 비었음 — 제안 단계로 전체 구성.
                                onSteps?.(adoptedSteps.map((r) => ({ score: String(r.score), desc: r.condition })));
                                onAiReplacedSteps?.(null); // 전체 교체 — 기존 참조 무의미
                            } else {
                                // 단계 따르기 — 점수는 그대로, AI 문구가 행에 먼저 들어가고 기존 문구는
                                // 에디터 아래 "기존:" 참고 + [되돌리기]로 보존(행별 원문 맵 전달).
                                const originals = {};
                                onSteps?.(
                                    steps.map((row) => {
                                        const hit = adoptedSteps.find((r) => Number(r.score) === Number(row.score));
                                        if (hit && String(hit.condition).trim() !== String(row.desc || '').trim()) {
                                            originals[String(Number(row.score))] = String(row.desc || '');
                                            return { ...row, desc: hit.condition };
                                        }
                                        return row;
                                    })
                                );
                                onAiReplacedSteps?.(Object.keys(originals).length ? originals : null);
                            }
                        }
                        if (isYn && ynText != null) onYnDraft?.(ynText);
                        setResult(null);
                    }}
                />
            )}
        </>
    );
}

/* ── 검토 모달 — 원본 vs 생성본(편집 가능) + 단계 조건 행별 채택 ── */

function ReviewModal({ original, result, isYn, currentSteps, currentMax, fromScratch = false, busy, onRegenerate, onClose, onApply }) {
    const [text, setText] = useState(result.criterion_text || '');
    const currentByScore = {};
    (currentSteps || []).forEach((s) => {
        const n = Number(s.score);
        if (Number.isFinite(n)) currentByScore[n] = String(s.desc || '');
    });
    // 만점 변경 제안 — 존재 시 단계 제안은 새 척도의 "대체 세트"라 행별 부분 채택이 아니라
    // 만점 변경 체크에 통째로 묶인다(일부만 적용하면 만점≠최고단계로 저장이 막히는 어긋남 방지).
    const suggestedMax = Number(result.suggested_max_score);
    const hasMaxChange = !isYn && Number.isFinite(suggestedMax) && suggestedMax > 0 && Number(currentMax) !== suggestedMax;
    const [maxChecked, setMaxChecked] = useState(true);
    const [stepRows, setStepRows] = useState(() =>
        (result.step_conditions || []).map((s) => {
            const score = Number(s.score);
            const condition = String(s.condition || '');
            const isNew = !(score in currentByScore);
            const isChanged = !isNew && (currentByScore[score] || '').trim() !== condition.trim();
            // 기본 채택 = 신규 제안 또는 문구가 실제로 바뀐 행(동일 문구는 채택 불필요).
            return { score, condition, checked: (isNew || isChanged) && !!condition.trim(), isNew, isChanged };
        })
    );
    const [ynChecked, setYnChecked] = useState(!!result.yn_criteria);
    const [ynText, setYnText] = useState(result.yn_criteria || '');
    const warnings = Array.isArray(result.warnings) ? result.warnings.filter(Boolean) : [];
    const edited = text !== (result.criterion_text || '');
    const stepsLocked = hasMaxChange; // 대체 세트 — 행별 선택 대신 전체 적용(만점 변경 채택 시)
    // 2-레이어 분리: 단계가 비어 있거나 만점 변경·"처음부터 작성" 모드면 제안 행이 실제 "점수 단계"가
    // 되고, 그 외("단계 따르기")에는 자연어 단계 문구를 그대로 두고 (A)(B)(C) 기준은
    // 적용 시 설명 끝 [점수 판정 기준] 섹션으로만 포함(LLM 평가 전용 레이어).
    const rowsBecomeSteps = stepsLocked || fromScratch || !(currentSteps || []).length;

    const setRow = (i, patch) => setStepRows((rows) => rows.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
    const confirmDiscard = (msg) => !edited || window.confirm(msg);

    if (typeof document === 'undefined') return null;
    return createPortal(
        <div className="fixed inset-0 z-[1100] flex items-center justify-center px-4" style={{ background: 'rgba(15,23,42,0.45)' }}>
            <div className="w-full max-w-[880px] bg-white rounded-2xl shadow-xl overflow-hidden max-h-[92vh] flex flex-col">
                <div className="px-6 pt-5 pb-3 flex items-center justify-between border-b border-[#E4E7EC] shrink-0">
                    <h3 className="text-base font-bold text-[#101828] inline-flex items-center gap-1.5">
                        <Sparkles size={15} className="text-[#6941C6]" /> AI 생성 결과 검토
                    </h3>
                    <button
                        type="button"
                        onClick={() => confirmDiscard('생성본에 직접 수정한 내용이 사라집니다. 닫을까요?') && onClose()}
                        className="w-7 h-7 grid place-items-center rounded-md text-[#667085] hover:bg-[#F2F4F7] cursor-pointer"
                    >
                        <X size={14} />
                    </button>
                </div>

                <div className="overflow-y-auto flex-1 px-6 py-5 space-y-4">
                    {warnings.length > 0 && (
                        <div className="bg-[#FFFAEB] border border-[#FEDF89] rounded-lg px-3 py-2.5 space-y-1">
                            {warnings.map((w, i) => (
                                <div key={i} className="flex items-start gap-1.5 text-[11.5px] text-[#B54708]">
                                    <AlertTriangle size={12} className="mt-0.5 shrink-0" /> <span>{w}</span>
                                </div>
                            ))}
                        </div>
                    )}

                    <div className="grid grid-cols-2 gap-4">
                        <div>
                            <div className="text-[11.5px] font-semibold text-[#667085] uppercase tracking-wide mb-1.5">현재 설명 (원본)</div>
                            <pre className="h-[320px] overflow-auto text-[12px] font-mono text-[#475467] leading-relaxed whitespace-pre-wrap bg-[#FAFBFC] border border-[#E4E7EC] rounded-lg p-3">
                                {original || '(비어 있음)'}
                            </pre>
                        </div>
                        <div>
                            <div className="text-[11.5px] font-semibold text-[#6941C6] uppercase tracking-wide mb-1.5">
                                AI 생성본 — 직접 수정 가능{edited && <span className="ml-1.5 text-[#B54708] normal-case">(수정됨)</span>}
                            </div>
                            <textarea
                                value={text}
                                onChange={(e) => setText(e.target.value)}
                                className="form-textarea-pretty font-mono text-[12px] h-[320px] resize-none"
                                style={{ height: 320 }}
                            />
                        </div>
                    </div>

                    {hasMaxChange && (
                        <div className="flex items-start gap-2 bg-[#F6F3FF] border border-[#C7B8F5] rounded-lg px-3 py-2.5">
                            <input
                                type="checkbox"
                                checked={maxChecked}
                                onChange={(e) => setMaxChecked(e.target.checked)}
                                className="shrink-0 w-4 h-4 mt-0.5 accent-[#6941C6] cursor-pointer"
                            />
                            <div>
                                <div className="text-[12.5px] font-semibold text-[#6941C6]">
                                    만점 변경 제안: {Number(currentMax) > 0 ? `${Number(currentMax)}점` : '(미설정)'} → {suggestedMax}점
                                </div>
                                <div className="text-[11.5px] text-[#667085] mt-0.5">
                                    초안의 점수 체계에 맞춰 만점과 아래 단계를 함께 교체합니다. 체크를 해제하면 만점·단계는 그대로 두고 설명만 적용됩니다.
                                </div>
                            </div>
                        </div>
                    )}

                    {!isYn && stepRows.length > 0 && (
                        <div>
                            <div className="text-[11.5px] font-semibold text-[#667085] uppercase tracking-wide mb-1.5">
                                {stepsLocked
                                    ? `단계 구성 제안 — 만점 변경 채택 시 아래 단계로 전체 교체 (새 척도 ${suggestedMax}점 기준)`
                                    : fromScratch
                                      ? '단계 구성 제안 — 채택한 행으로 기존 점수 단계를 교체합니다'
                                      : rowsBecomeSteps
                                        ? '단계 구성 제안 — 채택할 행만 체크, 적용 시 점수 단계로 채워집니다'
                                        : '단계 조건 교체 — 적용 시 아래 문구가 점수 단계에 들어갑니다 (기존 문구는 편집 화면에서 되돌리기 가능)'}
                            </div>
                            <div className={hasMaxChange && !maxChecked ? 'opacity-45 pointer-events-none select-none' : ''}>
                            {/* 전체 교체 모드(만점 변경·처음부터 작성) — 기존 단계 구성을 참고로 병기. */}
                            {(stepsLocked || fromScratch) && (currentSteps || []).length > 0 && (
                                <div className="mb-2 bg-[#FAFBFC] border border-[#E4E7EC] rounded-lg px-3 py-2">
                                    <div className="text-[11px] font-semibold text-[#98A2B3] mb-1">기존 단계 (참고 — 채택 시 아래 제안으로 교체됩니다)</div>
                                    {(currentSteps || []).map((s, i) => (
                                        <div key={i} className="text-[11.5px] text-[#667085] leading-relaxed">
                                            <span className="font-semibold">{s.score}점</span> — {String(s.desc || '').trim() || '(조건 없음)'}
                                        </div>
                                    ))}
                                </div>
                            )}
                            <div className="space-y-2">
                                {stepRows.map((r, i) => (
                                    <div key={i}>
                                        <div className="flex items-center gap-2">
                                            {rowsBecomeSteps && !stepsLocked && (
                                                <input
                                                    type="checkbox"
                                                    checked={r.checked}
                                                    onChange={(e) => setRow(i, { checked: e.target.checked })}
                                                    className="shrink-0 w-4 h-4 accent-[#6941C6] cursor-pointer"
                                                />
                                            )}
                                            <span className="shrink-0 w-[52px] text-center text-[12px] font-bold text-[#344054] bg-[#F2F4F7] rounded-md py-1.5">
                                                {r.score}점
                                            </span>
                                            <input
                                                type="text"
                                                value={r.condition}
                                                onChange={(e) => setRow(i, { condition: e.target.value })}
                                                className="form-input-pretty flex-1 text-[12px]"
                                            />
                                            {rowsBecomeSteps && (
                                                <span
                                                    className={`shrink-0 w-[44px] text-center text-[10.5px] font-semibold rounded-full py-0.5 ${
                                                        r.isNew
                                                            ? 'bg-[#EFF8FF] text-[#175CD3]'
                                                            : r.isChanged
                                                              ? 'bg-[#FDF2FA] text-[#C11574]'
                                                              : 'bg-[#F2F4F7] text-[#98A2B3]'
                                                    }`}
                                                >
                                                    {r.isNew ? '신규' : r.isChanged ? '변경' : '동일'}
                                                </span>
                                            )}
                                        </div>
                                        {/* 단계 따르기 모드 — 교체될 기존 문구를 항상 병기("AI 가 이렇게 바꿨다" 비교). */}
                                        {!rowsBecomeSteps && (
                                            <div className="mt-1 ml-[60px] text-[11px] text-[#98A2B3] leading-relaxed">
                                                기존: {(currentByScore[r.score] || '').trim() || '(빈 조건)'}
                                            </div>
                                        )}
                                    </div>
                                ))}
                            </div>
                            </div>
                        </div>
                    )}

                    {isYn && ynText && (
                        <div>
                            <div className="text-[11.5px] font-semibold text-[#667085] uppercase tracking-wide mb-1.5">충족/위반 판정 기준 제안</div>
                            <div className="flex items-start gap-2">
                                <input
                                    type="checkbox"
                                    checked={ynChecked}
                                    onChange={(e) => setYnChecked(e.target.checked)}
                                    className="shrink-0 w-4 h-4 mt-2 accent-[#6941C6] cursor-pointer"
                                />
                                <textarea
                                    value={ynText}
                                    onChange={(e) => setYnText(e.target.value)}
                                    rows={4}
                                    className="form-textarea-pretty font-mono text-[12px] flex-1"
                                />
                            </div>
                        </div>
                    )}
                </div>

                <div className="px-6 pb-5 pt-3 border-t border-[#F2F4F7] bg-[#FAFBFC] flex items-center justify-between shrink-0">
                    <button
                        type="button"
                        disabled={busy}
                        onClick={() => {
                            if (busy) return;
                            if (!confirmDiscard('생성본에 직접 수정한 내용이 있습니다. 다시 생성하면 사라집니다. 계속할까요?')) return;
                            onRegenerate();
                        }}
                        className={`inline-flex items-center gap-1.5 h-[38px] px-4 rounded-xl border text-[13px] font-semibold ${
                            busy
                                ? 'border-[#E4E7EC] bg-[#F9FAFB] text-[#98A2B3] cursor-default'
                                : 'border-[#E4E7EC] bg-white text-[#475467] hover:bg-[#F2F4F7] cursor-pointer'
                        }`}
                    >
                        <RefreshCw size={13} className={busy ? 'animate-spin' : ''} /> {busy ? '다시 생성 중…' : '다시 생성'}
                    </button>
                    <div className="flex gap-2">
                        <button
                            type="button"
                            onClick={() => confirmDiscard('생성본에 직접 수정한 내용이 사라집니다. 닫을까요?') && onClose()}
                            className="h-[38px] px-5 rounded-xl border border-[#E4E7EC] bg-white text-[13px] font-semibold text-[#101828] hover:bg-[#F2F4F7] cursor-pointer"
                        >
                            취소
                        </button>
                        <button
                            type="button"
                            disabled={!text.trim() || busy}
                            onClick={() => {
                                const applyMax = hasMaxChange && maxChecked;
                                // 단계 따르기 포함 전 모드에서 AI 문구가 단계 행에 들어간다(점수는 불변).
                                // 단계 따르기 모드의 기존 문구는 에디터 "기존:" 참고 + 되돌리기로 보존.
                                const stepAdoption = !rowsBecomeSteps
                                    ? stepRows.filter((r) => r.condition.trim()).map((r) => ({ score: r.score, condition: r.condition.trim() }))
                                    : stepsLocked
                                      ? applyMax
                                          ? stepRows.map((r) => ({ score: r.score, condition: r.condition.trim() }))
                                          : []
                                      : stepRows.filter((r) => r.checked && r.condition.trim()).map((r) => ({ score: r.score, condition: r.condition.trim() }));
                                onApply({
                                    text: text.trim(),
                                    adoptedSteps: stepAdoption,
                                    maxScoreChange: applyMax ? suggestedMax : null,
                                    // 처음부터 작성 모드는 기존 단계를 채택 세트로 통째 교체.
                                    replaceSteps: applyMax || (fromScratch && stepAdoption.length > 0),
                                    ynText: isYn && ynChecked && ynText.trim() ? ynText.trim() : null,
                                });
                            }}
                            className={`h-[38px] px-5 rounded-xl text-[13px] font-semibold shadow-sm inline-flex items-center gap-1.5 ${
                                !text.trim() || busy
                                    ? 'bg-[#EAECF0] text-[#98A2B3] cursor-default'
                                    : 'bg-[#6941C6] text-white hover:bg-[#7F56D9] cursor-pointer'
                            }`}
                        >
                            <Check size={13} /> 이 내용으로 적용
                        </button>
                    </div>
                </div>
            </div>
        </div>,
        document.body
    );
}
