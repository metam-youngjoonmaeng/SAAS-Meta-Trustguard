import React, { useMemo } from 'react';
import { ListCheck, MessageSquare, ChevronDown } from 'lucide-react';
import {
    CONSUMER_CHECKLIST,
    CONSUMER_MAJOR_CATEGORIES,
    CONSUMER_MAJOR_MAX,
    CONSUMER_TOTAL_MAX,
} from '../../constants';

// 대분류 구분 칸은 디자인 시스템 중성 톤으로 통일.
// 방향성 색상(긍정/부정/위험) 부여 금지 — rowSpan 그룹핑과 항목명으로 충분히 구분됨.
const CATEGORY_NEUTRAL = 'bg-[#F2F4F7] text-[#344054]';

/**
 * 소비자보호부 좌측 — 20개 평가항목 Y/N 표.
 * 컬럼: 구분(major_category, rowSpan 그룹핑) / 평가항목(item_text, hover 시 criterion+sub_no 툴팁) /
 *       Y·N / 평가 발화 / 평가 이유(detail_text — 위반 행에만 노출).
 * 위반(N) 행은 앰버 톤으로 강조. 평가발화는 Y/N 무관하게 전 행에 노출 — 컬렉션관리부 검열표와 일관.
 *
 * props:
 *   rows: [{ item_no, major_category, sub_no, criterion, item_text, yn, detail_text,
 *            evidence_line_no, evidence_text }, ...]
 *   onChangeYn: (item_no, nextYn) => void   (선택사항 — 미전달 시 read-only)
 *   onChangeDetail: (item_no, nextDetail) => void
 *   onJumpToTurn: (line_no) => void         (평가발화 클릭 시 STT 해당 turn 으로 점프)
 */
function ConsumerEvalTable({ rows, onChangeYn, onChangeDetail, saveStatus, onShowStt, onJumpToTurn }) {
    const rowsByItemNo = useMemo(() => {
        const m = new Map();
        for (const r of rows || []) m.set(Number(r.item_no), r);
        return m;
    }, [rows]);

    // 대분류별 위반 수 / 만점 집계
    const summary = useMemo(() => {
        const stats = {};
        for (const cat of CONSUMER_MAJOR_CATEGORIES) {
            stats[cat] = { violations: 0, max: CONSUMER_MAJOR_MAX[cat] || 0 };
        }
        let totalViolations = 0;
        for (const r of rows || []) {
            if (String(r.yn).toUpperCase() === 'N') {
                const cat = r.major_category;
                if (stats[cat]) stats[cat].violations += 1;
                totalViolations += 1;
            }
        }
        return { stats, totalViolations };
    }, [rows]);

    const earnedTotal = Math.max(0, CONSUMER_TOTAL_MAX - summary.totalViolations);
    const editable = typeof onChangeYn === 'function';

    return (
        <div className="bg-white rounded-xl border border-[#E4E7EC] shadow-[0_1px_2px_rgba(16,24,40,0.04)] flex flex-col h-full min-h-0 w-full overflow-hidden">
            <div className="px-5 py-3.5 border-b border-[#F2F4F7] bg-[#FAFBFC] flex justify-between items-center">
                <div className="flex items-center gap-2.5 min-w-0">
                    <ListCheck size={16} className="text-[#475467] shrink-0" />
                    <h3 className="text-[14px] font-semibold text-[#101828] tracking-tight shrink-0">상세 체크리스트</h3>
                    {saveStatus === 'saving' && (
                        <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-medium bg-[#F2F4F7] text-[#667085] truncate">
                            <span className="w-1.5 h-1.5 rounded-full bg-[#98A2B3] animate-pulse" />
                            저장 중
                        </span>
                    )}
                    {saveStatus === 'saved' && (
                        <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-medium bg-[#F2F4F7] text-[#475467] truncate">
                            <span className="w-1.5 h-1.5 rounded-full bg-[#12B76A]" />
                            저장됨
                        </span>
                    )}
                    {saveStatus === 'error' && (
                        <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-medium bg-[#FFFAEB] text-[#B54708] truncate">
                            <span className="w-1.5 h-1.5 rounded-full bg-[#B54708]" />
                            저장 실패
                        </span>
                    )}
                </div>
                <div className="flex items-center gap-2 text-[11px] font-medium">
                    <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-[#F2F4F7] text-[#475467] tabular-nums">
                        합계 <strong className="text-[#101828] font-semibold">{earnedTotal}</strong>/{CONSUMER_TOTAL_MAX}
                    </span>
                    <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-[#F2F4F7] text-[#475467] tabular-nums">
                        미충족 <strong className="text-[#101828] font-semibold">{summary.totalViolations}</strong>건
                    </span>
                    {typeof onShowStt === 'function' && (
                        <button
                            type="button"
                            onClick={onShowStt}
                            className="ml-1 px-3 py-1.5 rounded-lg text-[11px] font-semibold text-[#475467] hover:bg-[#F9FAFB] border border-[#E4E7EC] inline-flex items-center gap-1.5 transition-colors"
                        >
                            <MessageSquare size={13} />
                            STT전사
                        </button>
                    )}
                </div>
            </div>

            <div className="flex-1 min-h-0 p-0 overflow-auto">
                <table className="w-full text-left min-w-[820px]">
                    <thead>
                        <tr>
                            <th className="sticky top-0 z-10 bg-[#FAFBFC] border-b border-[#F2F4F7] px-3 py-2.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-[#98A2B3] w-[100px]">구분</th>
                            <th className="sticky top-0 z-10 bg-[#FAFBFC] border-b border-[#F2F4F7] px-3 py-2.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-[#98A2B3] w-[240px]">평가항목</th>
                            <th className="sticky top-0 z-10 bg-[#FAFBFC] border-b border-[#F2F4F7] px-3 py-2.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-[#98A2B3] w-14 text-center">Y / N</th>
                            <th className="sticky top-0 z-10 bg-[#FAFBFC] border-b border-[#F2F4F7] px-4 py-2.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-[#98A2B3] w-64">평가 발화</th>
                            <th className="sticky top-0 z-10 bg-[#FAFBFC] border-b border-[#F2F4F7] px-4 py-2.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-[#98A2B3] w-56">평가 이유</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                        {(() => {
                            const rendered = [];
                            const seenCat = new Set();
                            for (const c of CONSUMER_CHECKLIST) {
                                const r = rowsByItemNo.get(c.item_no) || {};
                                const yn = String(r.yn || '').toUpperCase();
                                const isViolation = yn === 'N';
                                const showCategory = !seenCat.has(c.major_category);
                                if (showCategory) seenCat.add(c.major_category);
                                const catRowsCount = CONSUMER_CHECKLIST.filter(
                                    (x) => x.major_category === c.major_category
                                ).length;
                                const catTone = CATEGORY_NEUTRAL;
                                const catSummary = summary.stats[c.major_category] || { violations: 0, max: 0 };
                                rendered.push(
                                    <tr
                                        key={c.item_no}
                                        className={`text-xs ${
                                            isViolation ? 'bg-amber-50/40' : 'hover:bg-gray-50/30'
                                        } transition-colors`}
                                    >
                                        {showCategory && (
                                            <td
                                                rowSpan={catRowsCount}
                                                className={`px-3 py-3 text-center font-black text-[11px] border-r border-gray-100 align-middle leading-tight ${catTone}`}
                                            >
                                                <div>{c.major_category}</div>
                                                <div className="mt-1 text-[10px] font-bold opacity-80">
                                                    {Math.max(0, catSummary.max - catSummary.violations)}/{catSummary.max}
                                                </div>
                                            </td>
                                        )}
                                        <td
                                            className="px-3 py-3 text-left text-[#101828] leading-relaxed cursor-help"
                                            title={`${c.criterion} (#${c.major_category.charAt(0)}-${c.sub_no})`}
                                        >
                                            {c.item_text}
                                        </td>
                                        <td className="px-3 py-3 text-center">
                                            {editable ? (
                                                <div className="relative inline-block w-20">
                                                    <select
                                                        value={yn === 'Y' || yn === 'N' ? yn : ''}
                                                        onChange={(e) => onChangeYn(c.item_no, e.target.value)}
                                                        className={`w-full appearance-none rounded-lg px-3 py-1 text-[11px] font-bold cursor-pointer pr-7 outline-none border transition-all ${
                                                            isViolation
                                                                ? 'bg-amber-50 border-amber-300 text-amber-800'
                                                                : yn === 'Y'
                                                                  ? 'bg-blue-50 border-blue-200 text-[#055AAF]'
                                                                  : 'bg-white border-[#D0D5DD] text-[#344054]'
                                                        }`}
                                                    >
                                                        <option value="Y">Y</option>
                                                        <option value="N">N</option>
                                                    </select>
                                                    <div className="absolute inset-y-0 right-0 flex items-center pr-2 pointer-events-none text-[#667085]">
                                                        <ChevronDown size={12} />
                                                    </div>
                                                </div>
                                            ) : (
                                                <span
                                                    className={`min-w-[2.5rem] px-2 py-0.5 inline-flex items-center justify-center rounded-md text-[11px] font-bold ${
                                                        isViolation
                                                            ? 'bg-amber-50 text-amber-800'
                                                            : yn === 'Y'
                                                              ? 'bg-[#E3F0FF] text-[#055AAF]'
                                                              : 'bg-[#F2F4F7] text-[#98A2B3]'
                                                    }`}
                                                >
                                                    {yn || '-'}
                                                </span>
                                            )}
                                        </td>
                                        <td className="px-4 py-4 text-left text-xs leading-relaxed align-top">
                                            {r.evidence_text ? (
                                                <button
                                                    type="button"
                                                    onClick={() =>
                                                        typeof onJumpToTurn === 'function' &&
                                                        r.evidence_line_no != null &&
                                                        onJumpToTurn(r.evidence_line_no)
                                                    }
                                                    disabled={
                                                        typeof onJumpToTurn !== 'function' ||
                                                        r.evidence_line_no == null
                                                    }
                                                    className={`group w-full text-left flex gap-1.5 items-start rounded-md px-2 py-1 -mx-2 -my-1 transition-colors ${
                                                        typeof onJumpToTurn === 'function' && r.evidence_line_no != null
                                                            ? 'hover:bg-[#055AAF]/5 cursor-pointer'
                                                            : 'cursor-default'
                                                    }`}
                                                    title={
                                                        r.evidence_line_no != null
                                                            ? `STT #${r.evidence_line_no} 으로 이동`
                                                            : ''
                                                    }
                                                >
                                                    {r.evidence_line_no != null && (
                                                        <span
                                                            className={`shrink-0 mt-0.5 px-1.5 py-0.5 rounded text-[10px] font-mono font-bold ${
                                                                isViolation
                                                                    ? 'bg-amber-100 text-amber-800 group-hover:bg-amber-200'
                                                                    : 'bg-[#055AAF]/10 text-[#055AAF] group-hover:bg-[#055AAF]/15'
                                                            }`}
                                                        >
                                                            #{r.evidence_line_no}
                                                        </span>
                                                    )}
                                                    <span
                                                        className={`line-clamp-3 ${
                                                            isViolation
                                                                ? 'text-amber-900 group-hover:text-amber-950'
                                                                : 'text-[#101828] group-hover:text-[#055AAF]'
                                                        }`}
                                                    >
                                                        “{r.evidence_text}”
                                                    </span>
                                                </button>
                                            ) : (
                                                <span className="text-[#98A2B3]">-</span>
                                            )}
                                        </td>
                                        <td className="px-4 py-4 text-left text-xs text-[#475467] leading-relaxed align-top">
                                            {editable && isViolation ? (
                                                <textarea
                                                    rows={2}
                                                    value={r.detail_text || ''}
                                                    onChange={(e) => onChangeDetail?.(c.item_no, e.target.value)}
                                                    placeholder="위반 사유를 입력하세요"
                                                    className="w-full p-0 bg-transparent border-0 text-xs text-[#475467] leading-relaxed outline-none focus:ring-0 resize-none"
                                                />
                                            ) : isViolation ? (
                                                <div className="flex gap-1.5 items-start">
                                                    <MessageSquare size={11} className="text-amber-600 mt-0.5 shrink-0" />
                                                    <span>{r.detail_text || '-'}</span>
                                                </div>
                                            ) : (
                                                <span className="text-[#98A2B3]">-</span>
                                            )}
                                        </td>
                                    </tr>
                                );
                            }
                            return rendered;
                        })()}
                    </tbody>
                </table>
            </div>
        </div>
    );
}

export default ConsumerEvalTable;
