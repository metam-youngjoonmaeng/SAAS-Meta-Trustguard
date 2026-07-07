import { Plus, X, Sparkles, Undo2 } from 'lucide-react';

// 점수 기준 구조화 입력기 — 만점 + 점수 단계(행 단위, 추가/삭제).
//   행: [단계 점수] [그 점수의 조건 설명] [삭제]
// 저장은 기존 텍스트 포맷("점수 단계: 10 / 5 / 3" + "- 10점: …" 불릿)으로 합쳐 prompt_template 에 보관
//   → 엔진(parseStepsFromPromptLoose)이 그대로 채점 척도를 파싱(무회귀). 브랜드·도메인 편집기 공용.

const BULLET_RE = /^\s*-\s*([\d.]+)\s*점\s*[:：]\s*(.*)$/;

// prompt_template(텍스트) → 점수 단계 행 배열 [{score, desc}]
export function parseSteps(promptTemplate) {
    const text = String(promptTemplate || '');
    const rows = [];
    // CRLF/CR 도 안전하게 분할(\r 잔류 시 BULLET_RE 의 $ 앵커가 어긋나 일부 단계만 잡히는 버그 방지).
    for (const line of text.split(/\r?\n/)) {
        const m = line.match(BULLET_RE);
        if (m) rows.push({ score: m[1], desc: (m[2] || '').trim() });
    }
    if (rows.length) return rows;
    // 불릿이 없으면 "점수 단계: a / b / c" 헤더만이라도 점수로 환원(설명 빈칸)
    const hdr = text.match(/점수\s*단계\s*[:：]\s*(.+)/);
    if (hdr) {
        return hdr[1]
            .split('/')
            .map((s) => ({ score: s.replace(/[^\d.]/g, '').trim(), desc: '' }))
            .filter((s) => s.score);
    }
    return [];
}

// 저장 차단 규칙 — 최고 단계 점수 ≠ 만점 이면 true(불일치). 단계가 없으면 false.
export function stepsMaxMismatch(maxScore, steps) {
    const nums = (steps || []).map((s) => Number(s.score)).filter((n) => Number.isFinite(n));
    if (!nums.length) return false;
    const max = Math.max(...nums);
    return Number(maxScore) > 0 && max !== Number(maxScore);
}

// 점수 단계 행 배열 → prompt_template 텍스트(엔진 파싱용 표준 포맷)
export function assembleSteps(steps) {
    const valid = (steps || []).filter((s) => String(s.score).trim() !== '');
    if (!valid.length) return '';
    const header = '점수 단계: ' + valid.map((s) => String(s.score).trim()).join(' / ');
    const bullets = valid
        .map((s) => `- ${String(s.score).trim()}점: ${String(s.desc || '').trim()}`)
        .join('\n');
    return `${header}\n${bullets}`;
}

// aiOriginals: { "<점수>": "교체 전 기존 문구" } — AI 프롬프트 다듬기 적용으로 AI 문구가 행에 들어간 뒤,
//   해당 행에 AI 마커(✦)를 붙이고 아래에 "기존: <원문>" + [되돌리기]를 노출(원문 복귀 시 자동 소멸).
export default function ScoreStepsEditor({ maxScore, onMaxScore, steps, onSteps, error = false, aiOriginals = null }) {
    const setRow = (i, patch) => onSteps(steps.map((s, idx) => (idx === i ? { ...s, ...patch } : s)));
    const addRow = () => {
        // 첫 행이면 만점을 기본 점수로 채워 만점-단계 일치를 유도
        const seed = steps.length === 0 && Number(maxScore) > 0 ? String(maxScore) : '';
        onSteps([...steps, { score: seed, desc: '' }]);
    };
    const removeRow = (i) => onSteps(steps.filter((_, idx) => idx !== i));

    const numericScores = steps.map((s) => Number(s.score)).filter((n) => Number.isFinite(n));
    const topScore = numericScores.length ? Math.max(...numericScores) : null;
    const mismatch = stepsMaxMismatch(maxScore, steps);
    // 저장 시도(error) + 실제 불일치일 때만 빨간 테두리. 고치면(불일치 해소) 자동으로 사라짐.
    const showRed = error && mismatch;
    const redStyle = showRed ? { borderColor: '#F04438', boxShadow: '0 0 0 3px rgba(240,68,56,0.10)' } : null;

    return (
        <div className="space-y-3.5">
            {/* AI 교체 연출 — 흰색에서 핵심컬러 소프트(var(--primary-tint))로 천천히 페이드인한 뒤 영구 유지 + 아이콘 팝 + 기존 줄 페이드 */}
            <style>{`
                @keyframes aiFillSweep { 0% { background-color: #FFFFFF; border-color: #E4E7EC; } 100% { background-color: var(--primary-tint); border-color: var(--primary-soft-border); } }
                @keyframes aiIconPop { 0% { transform: translateY(-50%) scale(0) rotate(-30deg); opacity: 0; } 60% { transform: translateY(-50%) scale(1.3) rotate(8deg); opacity: 1; } 100% { transform: translateY(-50%) scale(1) rotate(0deg); opacity: 1; } }
                @keyframes aiFadeSlide { from { opacity: 0; transform: translateY(-3px); } to { opacity: 1; transform: none; } }
                .ai-filled-input { animation: aiFillSweep 2.4s ease-in-out; }
                .ai-filled-icon { animation: aiIconPop .5s ease-out; }
                .ai-orig-line { animation: aiFadeSlide .45s ease-out; }
            `}</style>
            {/* 만점 */}
            <div className="flex items-center gap-2">
                <span className="text-[13px] font-medium text-[#344054] w-10">만점</span>
                <input
                    type="number"
                    min="1"
                    value={maxScore}
                    onChange={(e) => onMaxScore(e.target.value)}
                    placeholder="예) 10"
                    className="form-input-pretty text-center"
                    style={{ width: 96, ...(redStyle || {}) }}
                />
                <span className="text-[13px] text-[#667085]">점</span>
            </div>

            {/* 점수 단계 */}
            <div>
                <div className="flex items-center justify-between mb-2">
                    <span className="text-[12.5px] font-semibold text-[#344054]">점수 단계</span>
                    <button
                        type="button"
                        onClick={addRow}
                        className="inline-flex items-center gap-1 h-7 px-2.5 rounded-lg border border-[#BFD4F2] bg-[#EEF4FB] text-[#055AAF] text-[12px] font-semibold hover:bg-[#E1EDFB] cursor-pointer"
                    >
                        <Plus size={13} /> 단계 추가
                    </button>
                </div>

                {steps.length === 0 ? (
                    <div className="text-[12px] text-[#98A2B3] italic bg-[#FAFBFC] border border-dashed border-[#E4E7EC] rounded-lg px-3 py-3 text-center">
                        “단계 추가”를 눌러 점수 단계를 만드세요. (예: 10점 · 5점 · 0점)
                    </div>
                ) : (
                    <div className="space-y-2">
                        {/* 헤더 라벨 */}
                        <div className="flex items-center gap-2 px-0.5 text-[11px] font-semibold text-[#98A2B3] tracking-[0.02em]">
                            <span style={{ width: 92 }} className="shrink-0">단계 점수</span>
                            <span className="flex-1">이 점수를 주는 조건 · 설명</span>
                            <span style={{ width: 32 }} className="shrink-0" />
                        </div>
                        {steps.map((s, i) => {
                            // AI 교체 행 — 원문 맵에 해당 점수가 있고 현재 문구가 원문과 다르면
                            // AI 마커 + "기존:" 참고/되돌리기 노출(되돌리면 원문 일치 → 자동 소멸).
                            const orig = aiOriginals && Object.prototype.hasOwnProperty.call(aiOriginals, String(Number(s.score)))
                                ? String(aiOriginals[String(Number(s.score))] ?? '')
                                : null;
                            const aiReplaced = orig !== null && orig.trim() !== String(s.desc || '').trim();
                            return (
                                <div key={i}>
                                    <div className="flex items-center gap-2">
                                        <div className="relative shrink-0" style={{ width: 92 }}>
                                            <input
                                                type="number"
                                                min="0"
                                                value={s.score}
                                                onChange={(e) => setRow(i, { score: e.target.value })}
                                                placeholder="점수"
                                                className="form-input-pretty text-center pr-6"
                                                style={redStyle || undefined}
                                            />
                                            <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[11px] text-[#98A2B3] pointer-events-none">점</span>
                                        </div>
                                        <div className="relative flex-1">
                                            <input
                                                type="text"
                                                value={s.desc}
                                                onChange={(e) => setRow(i, { desc: e.target.value })}
                                                placeholder="예) 인사 + 소속·성명 + 도입 멘트 모두 양호"
                                                className={`form-input-pretty w-full ${aiReplaced ? 'ai-filled-input' : ''}`}
                                                style={
                                                    aiReplaced
                                                        ? { paddingLeft: 30, backgroundColor: 'var(--primary-tint)', borderColor: 'var(--primary-soft-border)' }
                                                        : undefined
                                                }
                                            />
                                            {aiReplaced && (
                                                <Sparkles
                                                    size={13}
                                                    className="ai-filled-icon absolute left-2.5 top-1/2 -translate-y-1/2 text-primary pointer-events-none"
                                                    title="AI 가 작성한 문구"
                                                />
                                            )}
                                        </div>
                                        <button
                                            type="button"
                                            onClick={() => removeRow(i)}
                                            title="이 단계 삭제"
                                            className="shrink-0 w-8 h-8 inline-flex items-center justify-center rounded-lg text-[#98A2B3] hover:text-[#D92D20] hover:bg-red-50 cursor-pointer"
                                        >
                                            <X size={15} />
                                        </button>
                                    </div>
                                    {aiReplaced && (
                                        <div className="ai-orig-line mt-1 ml-[100px] mr-10 flex items-start gap-2">
                                            <span className="text-[11px] text-[#98A2B3] leading-relaxed flex-1">
                                                기존: {orig.trim() || '(빈 조건)'}
                                            </span>
                                            <button
                                                type="button"
                                                onClick={() => setRow(i, { desc: orig })}
                                                title="기존 문구로 되돌리기"
                                                className="shrink-0 inline-flex items-center gap-1 h-6 px-2 rounded-md border border-[#E4E7EC] bg-white text-[#475467] text-[11px] font-semibold hover:bg-[#F2F4F7] cursor-pointer"
                                            >
                                                <Undo2 size={11} /> 되돌리기
                                            </button>
                                        </div>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                )}

                {mismatch && (
                    showRed ? (
                        <div className="mt-2 text-[11.5px] font-medium text-[#B42318] bg-[#FEF3F2] border border-[#FDA29B] rounded-md px-2.5 py-1.5">
                            ✕ 최고 단계 점수({topScore}점)와 만점({maxScore}점)이 일치해야 저장할 수 있습니다.
                        </div>
                    ) : (
                        <div className="mt-2 text-[11.5px] text-[#B54708] bg-[#FFFAEB] border border-[#FEDF89] rounded-md px-2.5 py-1.5">
                            ⚠ 최고 단계 점수({topScore}점)와 만점({maxScore}점)이 다릅니다. 일치시켜 주세요.
                        </div>
                    )
                )}
            </div>
        </div>
    );
}
