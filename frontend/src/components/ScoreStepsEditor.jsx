import { Plus, X } from 'lucide-react';

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

export default function ScoreStepsEditor({ maxScore, onMaxScore, steps, onSteps }) {
    const setRow = (i, patch) => onSteps(steps.map((s, idx) => (idx === i ? { ...s, ...patch } : s)));
    const addRow = () => {
        // 첫 행이면 만점을 기본 점수로 채워 만점-단계 일치를 유도
        const seed = steps.length === 0 && Number(maxScore) > 0 ? String(maxScore) : '';
        onSteps([...steps, { score: seed, desc: '' }]);
    };
    const removeRow = (i) => onSteps(steps.filter((_, idx) => idx !== i));

    const numericScores = steps.map((s) => Number(s.score)).filter((n) => Number.isFinite(n));
    const topScore = numericScores.length ? Math.max(...numericScores) : null;
    const mismatch = topScore != null && Number(maxScore) > 0 && topScore !== Number(maxScore);

    return (
        <div className="space-y-3.5">
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
                    style={{ width: 96 }}
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
                        {steps.map((s, i) => (
                            <div key={i} className="flex items-center gap-2">
                                <div className="relative shrink-0" style={{ width: 92 }}>
                                    <input
                                        type="number"
                                        min="0"
                                        value={s.score}
                                        onChange={(e) => setRow(i, { score: e.target.value })}
                                        placeholder="점수"
                                        className="form-input-pretty text-center pr-6"
                                    />
                                    <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[11px] text-[#98A2B3] pointer-events-none">점</span>
                                </div>
                                <input
                                    type="text"
                                    value={s.desc}
                                    onChange={(e) => setRow(i, { desc: e.target.value })}
                                    placeholder="예) 인사 + 소속·성명 + 도입 멘트 모두 양호"
                                    className="form-input-pretty flex-1"
                                />
                                <button
                                    type="button"
                                    onClick={() => removeRow(i)}
                                    title="이 단계 삭제"
                                    className="shrink-0 w-8 h-8 inline-flex items-center justify-center rounded-lg text-[#98A2B3] hover:text-[#D92D20] hover:bg-red-50 cursor-pointer"
                                >
                                    <X size={15} />
                                </button>
                            </div>
                        ))}
                    </div>
                )}

                {mismatch && (
                    <div className="mt-2 text-[11.5px] text-[#B54708] bg-[#FFFAEB] border border-[#FEDF89] rounded-md px-2.5 py-1.5">
                        ⚠ 최고 단계 점수({topScore}점)와 만점({maxScore}점)이 다릅니다. 보통 일치시킵니다.
                    </div>
                )}
            </div>
        </div>
    );
}
