import React, { useMemo } from 'react';
import { Shield, AlertTriangle, BarChart3 } from 'lucide-react';
import {
    CONSUMER_AI_CATEGORIES,
    CONSUMER_FIT_THRESHOLD,
    fitBandFor,
} from '../../constants';

/**
 * 소비자보호부 우측 — 금칙어 + 12 카테고리 적합도.
 *
 * - ai_analysis_target='X' 콜은 금칙어/12 카테고리 영역을 비활성(회색 + 가림막) 처리.
 * - 12 카테고리: 카테고리에 의미(긍정/부정/위험) 라벨 부여 금지 — 점수 농도만 차별화.
 *
 * props:
 *   meta: { ai_analysis_target }
 *   keywords: [{ keyword_id, level, major_category, sub_category, keyword, line_no, line_text }]
 *   categories: [{ category_no, major_category, sub_category, score }]
 *   onJumpToTurn?: (lineNo) => void
 */

function densityClasses(density) {
    // 단일 색상(블루)의 농도 차이만. 카테고리에 의미 부여 금지.
    switch (density) {
        case 'strong':
            return { bar: 'bg-[var(--primary)]', label: 'text-[var(--primary)]' };
        case 'medium':
            return { bar: 'bg-[var(--primary)]/80', label: 'text-[var(--primary)]' };
        case 'soft':
            return { bar: 'bg-[var(--primary)]/40', label: 'text-[var(--ink-700)]' };
        case 'mute':
        default:
            return { bar: 'bg-[var(--ink-300)]', label: 'text-[var(--ink-500)]' };
    }
}

function KeywordsCard({ keywords, disabled, onJumpToTurn }) {
    const list = Array.isArray(keywords) ? keywords : [];
    return (
        <div
            className={`bg-white rounded-xl border border-[var(--border)] shadow-[0_1px_2px_rgba(16,24,40,0.04)] overflow-hidden flex flex-col h-[280px] shrink-0 ${
                disabled ? 'opacity-60' : ''
            }`}
        >
            <div className="px-5 py-3.5 border-b border-[var(--muted)] bg-[var(--background-soft)] flex justify-between items-center">
                <h3 className="text-[14px] font-semibold text-[var(--ink-900)] tracking-tight flex items-center gap-2.5">
                    <AlertTriangle size={16} className="text-[var(--ink-700)]" />
                    금칙어 감지
                </h3>
                <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-medium bg-[var(--muted)] text-[var(--ink-700)] tabular-nums">{list.length}건</span>
            </div>
            <div className="flex-1 overflow-y-auto p-3 space-y-2 bg-[var(--muted)]/30">
                {disabled ? (
                    <div className="h-full flex flex-col items-center justify-center text-[11px] text-[var(--ink-500)] gap-1">
                        <Shield size={20} strokeWidth={1.5} />
                        <p>분석대상이 아닌 콜입니다.</p>
                    </div>
                ) : (
                    list.map((k) => {
                        const lvl = String(k.level || '');
                        const lvlNum = lvl.match(/Level\s*([0-9])/i)?.[1] || '';
                        const lvlTone =
                            lvlNum === '1'
                                ? 'bg-[var(--destructive-soft)] text-[var(--destructive)]'
                                : lvlNum === '2'
                                  ? 'bg-[var(--warning-soft)] text-[var(--warning)]'
                                  : 'bg-[var(--primary-soft)] text-[var(--primary)]';
                        const canJump = Number.isFinite(Number(k.line_no)) && typeof onJumpToTurn === 'function';
                        const Wrapper = canJump ? 'button' : 'div';
                        const wrapperProps = canJump
                            ? {
                                  type: 'button',
                                  onClick: () => onJumpToTurn(Number(k.line_no)),
                                  title: `STT #${k.line_no} 으로 이동`,
                              }
                            : {};
                        return (
                            <Wrapper
                                key={k.keyword_id ?? `${k.line_no}_${k.keyword}`}
                                {...wrapperProps}
                                className={`bg-white rounded-lg border border-[var(--border)] p-2.5 flex flex-col gap-1.5 shadow-sm text-left w-full transition-colors ${
                                    canJump ? 'cursor-pointer hover:bg-[var(--primary)]/5 hover:border-[var(--primary)]/30' : ''
                                }`}
                            >
                                <div className="flex items-center gap-2 flex-wrap">
                                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded ${lvlTone}`}>
                                        {lvl || 'Level -'}
                                    </span>
                                    <span className="text-[10px] font-bold text-[var(--ink-700)]">
                                        {k.major_category || '-'} · {k.sub_category || '-'}
                                    </span>
                                </div>
                                <div className="flex items-center gap-2">
                                    <span className="text-[12px] font-extrabold text-[var(--ink-900)]">「{k.keyword}」</span>
                                    {Number.isFinite(Number(k.line_no)) && (
                                        <span className="text-[10px] font-bold text-[var(--primary)] ml-auto">
                                            turn #{k.line_no}
                                        </span>
                                    )}
                                </div>
                                {k.line_text && (
                                    <p className="text-[11px] text-[var(--ink-700)] leading-relaxed line-clamp-2">{k.line_text}</p>
                                )}
                            </Wrapper>
                        );
                    })
                )}
            </div>
        </div>
    );
}

function AiCategoriesCard({ categories, disabled }) {
    // category_no 1~12 채워서 정렬
    const byNo = useMemo(() => {
        const m = new Map();
        for (const c of categories || []) m.set(Number(c.category_no), c);
        return m;
    }, [categories]);

    const rows = CONSUMER_AI_CATEGORIES.map((def) => {
        const persisted = byNo.get(def.category_no) || {};
        const score = Number(persisted.score);
        return {
            ...def,
            score: Number.isFinite(score) ? Math.max(0, Math.min(100, score)) : 0,
        };
    });

    const aboveThreshold = rows.filter((r) => r.score >= CONSUMER_FIT_THRESHOLD);

    return (
        <div
            className={`bg-white rounded-xl border border-[var(--border)] shadow-[0_1px_2px_rgba(16,24,40,0.04)] overflow-hidden flex flex-col flex-1 min-h-0 ${
                disabled ? 'opacity-60' : ''
            }`}
        >
            <div className="px-5 py-3.5 border-b border-[var(--muted)] bg-[var(--background-soft)] flex justify-between items-center">
                <h3 className="text-[14px] font-semibold text-[var(--ink-900)] tracking-tight flex items-center gap-2.5">
                    <BarChart3 size={16} className="text-[var(--ink-700)]" />
                    AI 유형분류 적합도 (12)
                </h3>
                <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-medium bg-[var(--muted)] text-[var(--ink-700)] tabular-nums">
                    {CONSUMER_FIT_THRESHOLD}+ {aboveThreshold.length}건
                </span>
            </div>

            <div className="flex-1 overflow-y-auto p-3 space-y-3">
                {disabled && (
                    <div className="px-3 py-2 bg-[var(--muted)] rounded-lg text-[11px] text-[var(--ink-500)] flex items-center gap-2">
                        <Shield size={14} />
                        분석대상이 아닌 콜이라 적합도가 의미를 갖지 않습니다 (참고용 점수).
                    </div>
                )}

                {/* 60+ 요약 카드 */}
                {!disabled && aboveThreshold.length > 0 && (
                    <div className="grid grid-cols-1 gap-2 mb-3">
                        {aboveThreshold
                            .slice()
                            .sort((a, b) => b.score - a.score)
                            .map((r) => {
                                const band = fitBandFor(r.score);
                                const tone = densityClasses(band.density);
                                return (
                                    <div
                                        key={r.category_no}
                                        className="flex items-center gap-2 px-3 py-2 bg-[var(--primary-soft)]/60 border border-[var(--primary)] rounded-lg"
                                    >
                                        <span className="text-[11px] font-mono font-bold text-[var(--primary)]">
                                            #{r.category_no}
                                        </span>
                                        <span className="text-[12px] font-bold text-[var(--ink-900)] flex-1 truncate">
                                            {r.major_category} · {r.sub_category}
                                        </span>
                                        <span className={`text-[14px] font-extrabold ${tone.label}`}>
                                            {Math.round(r.score)}
                                        </span>
                                    </div>
                                );
                            })}
                    </div>
                )}

                {/* 12 막대 그래프 (전부) */}
                <div className="space-y-2.5">
                    {rows.map((r) => {
                        const band = fitBandFor(r.score);
                        const tone = densityClasses(band.density);
                        const widthPct = Math.max(0, Math.min(100, r.score));
                        return (
                            <div key={r.category_no}>
                                <div className="flex items-center justify-between mb-1">
                                    <span className="text-[12px] text-[var(--ink-700)] font-semibold truncate pr-2">
                                        <span className="font-mono text-[var(--ink-500)] mr-1">#{r.category_no}</span>
                                        {r.sub_category}
                                    </span>
                                    <span className={`text-[13px] font-bold ${tone.label}`}>
                                        {Math.round(r.score)}
                                    </span>
                                </div>
                                <div className="h-2 bg-[var(--muted)] rounded-full overflow-hidden">
                                    <div
                                        className={`h-full ${tone.bar} transition-all`}
                                        style={{ width: `${widthPct}%` }}
                                    />
                                </div>
                            </div>
                        );
                    })}
                </div>
            </div>
        </div>
    );
}

function ConsumerAnalysisPanel({ meta, keywords, categories, onJumpToTurn }) {
    const isX = String(meta?.ai_analysis_target || '').toUpperCase() === 'X';
    const list = Array.isArray(keywords) ? keywords : [];
    return (
        <div className="flex flex-col gap-4 w-full h-full lg:h-[884px] min-h-0">
            {list.length > 0 && (
                <KeywordsCard keywords={list} disabled={isX} onJumpToTurn={onJumpToTurn} />
            )}
            <AiCategoriesCard categories={categories} disabled={isX} />
        </div>
    );
}

export default ConsumerAnalysisPanel;
