import React from 'react';
import { Star } from 'lucide-react';

const STOPS = ['낮음', '동일', '높음'];

const GOLD = {
    base: '#C8951B',
    fill: '#F4C451',
    ink: '#7D5A00',
};

const PRIMARY = '#055AAF';
const PRIMARY_RING = 'rgba(5, 90, 175, 0.18)';
const BORDER = '#E4E7EC';
const BORDER_STRONG = '#D0D5DD';
const INK_400 = '#98A2B3';

function ManualJudgmentCell({ judgment, goldSet, onJudgment, onGoldSet, canManageGold = true }) {
    const activeIndex = STOPS.indexOf(judgment);

    return (
        <div className="w-full select-none">
            <div className="relative h-[38px] px-1">
                <div className="absolute top-0 left-1 right-1 flex justify-between">
                    {STOPS.map((s, i) => {
                        const on = activeIndex === i;
                        return (
                            <button
                                key={s}
                                type="button"
                                onClick={() => onJudgment(s)}
                                className="bg-transparent border-0 px-0.5 cursor-pointer transition-colors"
                                style={{
                                    fontSize: 11,
                                    fontWeight: on ? 700 : 500,
                                    color: on ? PRIMARY : INK_400,
                                    letterSpacing: '0.01em',
                                }}
                            >
                                {s}
                            </button>
                        );
                    })}
                </div>

                <div
                    className="absolute"
                    style={{
                        left: 12,
                        right: 12,
                        top: 28,
                        height: 2,
                        background: BORDER,
                        borderRadius: 1,
                    }}
                />

                <div
                    className="absolute flex justify-between"
                    style={{ left: 4, right: 4, top: 22 }}
                >
                    {STOPS.map((s, i) => {
                        const on = activeIndex === i;
                        return (
                            <button
                                key={s}
                                type="button"
                                onClick={() => onJudgment(s)}
                                title={`AI평가보다 ${s === '동일' ? '동일하게' : s + '게'} 평가`}
                                className="cursor-pointer p-0 transition-all outline-none"
                                style={{
                                    width: on ? 14 : 10,
                                    height: on ? 14 : 10,
                                    borderRadius: '50%',
                                    background: on ? PRIMARY : 'white',
                                    border: on
                                        ? '2px solid white'
                                        : `1.5px solid ${BORDER_STRONG}`,
                                    boxShadow: on
                                        ? `0 0 0 1.5px ${PRIMARY}, 0 0 0 4px ${PRIMARY_RING}`
                                        : 'none',
                                }}
                                onMouseEnter={(e) => {
                                    if (!on) {
                                        e.currentTarget.style.borderColor = PRIMARY;
                                        e.currentTarget.style.transform = 'scale(1.2)';
                                    }
                                }}
                                onMouseLeave={(e) => {
                                    if (!on) {
                                        e.currentTarget.style.borderColor = BORDER_STRONG;
                                        e.currentTarget.style.transform = 'scale(1)';
                                    }
                                }}
                            />
                        );
                    })}
                </div>
            </div>

            <div className="min-h-[22px] flex justify-center mt-0.5">
                {/* 골드셋 등록/해제는 관리자만. 비관리자는 이미 골드셋인 경우 읽기전용 표시만. */}
                {judgment === '동일' && canManageGold && (
                    <button
                        type="button"
                        onClick={() => onGoldSet(!goldSet)}
                        title={goldSet ? '골드셋에서 제외' : '골드셋으로 등록'}
                        className="bg-transparent border-0 py-0.5 px-1.5 cursor-pointer inline-flex items-center gap-1 whitespace-nowrap transition-colors"
                        style={{
                            fontSize: 11,
                            fontWeight: goldSet ? 700 : 600,
                            color: goldSet ? GOLD.ink : INK_400,
                            letterSpacing: '0.01em',
                        }}
                    >
                        <Star
                            size={11}
                            style={{
                                fill: goldSet ? GOLD.fill : 'transparent',
                                color: goldSet ? GOLD.base : INK_400,
                            }}
                        />
                        {goldSet ? '골드셋' : '골드셋 등록'}
                    </button>
                )}
                {judgment === '동일' && !canManageGold && goldSet && (
                    <span
                        className="py-0.5 px-1.5 inline-flex items-center gap-1 whitespace-nowrap"
                        title="골드셋 (관리자만 변경 가능)"
                        style={{ fontSize: 11, fontWeight: 700, color: GOLD.ink, letterSpacing: '0.01em' }}
                    >
                        <Star size={11} style={{ fill: GOLD.fill, color: GOLD.base }} />
                        골드셋
                    </span>
                )}
            </div>
        </div>
    );
}

export default ManualJudgmentCell;
