import React from 'react';
import { Gauge, MessageSquare } from 'lucide-react';

// KSQI 평가 — 브랜드 루브릭(단일 100점 축)과 별개로 병렬 실행되는 독립 평가 축.
// 두 영역(A 서비스품질 / B 공감) 각각 100점 환산 + 우수/미달 판정. 순수 표시 전용(read-only).
// 데이터 계약: evaluation.ksqi_report — { area_a, area_b, overall, items[12], summary }.
// 항목 표 컬럼: 구분(영역·대분류+소계) / 평가항목 / 평가 이유 / 평가 발화 / AI평가.
// 평가 발화 클릭 시 onQuoteClick(quote) 로 STT 전사 해당 턴으로 이동(상세 체크리스트와 동일 UX).

// 항목번호 → 대분류(구분). 원본 KSQI STT 평가표 기준. 리포트 item 에 category 가 없으면(구버전) 이 맵으로 파생.
const KSQI_CATEGORY_BY_NUMBER = {
    4: '맞이인사',
    5: '상담태도',
    6: '업무처리',
    7: '업무처리',
    8: '종료태도',
    10: '맞이인사',
    11: '맞이인사',
    12: '상담태도',
    14: '상담태도',
    15: '상담태도',
    16: '업무처리',
    17: '종료태도',
};
// 대분류 표시 순서(양 영역 공통) — 원본 평가표 배열 순.
const CATEGORY_ORDER = ['맞이인사', '상담태도', '업무처리', '종료태도'];

const categoryOf = (item) =>
    item?.category || KSQI_CATEGORY_BY_NUMBER[Number(item?.item_number)] || '기타';

// scaled(0~100 환산, 소수 1자리 float) 안전 포맷.
const fmtScaled = (v) =>
    typeof v === 'number' && Number.isFinite(v) ? v.toFixed(1) : v == null ? '-' : String(v);

// 영역 우수/미달 배지 — 우수=그린(승인 톤), 미달=중성 회색. (디자인 시스템 기존 토큰 재사용)
function areaBadgeClass(excellent) {
    return excellent
        ? 'bg-[#ECFDF3] text-[#067647] border-[#ABEFC6]'
        : 'bg-[#F2F4F7] text-[#667085] border-[#E4E7EC]';
}

// 항목 판정 라벨/톤: na → 해당없음(트리거 부재로 만점), defect → 결함(감점), else → 만점.
function itemVerdict(item) {
    if (item?.na === true) {
        return { label: '해당없음(만점)', cls: 'bg-[#F2F4F7] text-[#667085] border-[#E4E7EC]' };
    }
    if (item?.defect === true) {
        return { label: '결함', cls: 'bg-[#FFFAEB] text-[#B54708] border-[#FEDF89]' };
    }
    return { label: '만점', cls: 'bg-[#ECFDF3] text-[#067647] border-[#ABEFC6]' };
}

function AreaCard({ label, area }) {
    if (!area) return null;
    const excellent = area.excellent === true;
    const grade = area.grade || (excellent ? '우수' : '미달');
    return (
        <div className="bg-white rounded-[10px] border border-[#E4E7EC] px-4 py-3">
            <div className="flex items-center justify-between gap-2 mb-1.5">
                <span className="text-[12px] font-semibold text-[#344054]">{label}</span>
                <span
                    className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10.5px] font-semibold border whitespace-nowrap ${areaBadgeClass(
                        excellent
                    )}`}
                >
                    {grade}
                </span>
            </div>
            <div className="flex items-baseline gap-2 flex-wrap">
                <span className="text-[22px] font-bold text-[#101828] tabular-nums leading-none">
                    {fmtScaled(area.scaled)}
                    <span className="text-[13px] font-semibold text-[#667085] ml-0.5">점</span>
                </span>
                <span className="text-[11.5px] text-[#98A2B3] tabular-nums">
                    원점수 {area.raw ?? '-'}/{area.max ?? '-'}
                </span>
            </div>
        </div>
    );
}

// 영역(A/B) → 대분류별 그룹 + 소계 구성.
function buildAreaGroups(items) {
    const areas = ['A', 'B'];
    return areas
        .map((area) => {
            const areaItems = items.filter((it) => String(it?.area).toUpperCase() === area);
            if (!areaItems.length) return null;
            const catNames = [
                ...CATEGORY_ORDER,
                ...[...new Set(areaItems.map(categoryOf))].filter((c) => !CATEGORY_ORDER.includes(c)),
            ];
            const cats = [];
            catNames.forEach((catName) => {
                const catItems = areaItems
                    .filter((it) => categoryOf(it) === catName)
                    .sort((a, b) => (Number(a?.item_number) || 0) - (Number(b?.item_number) || 0));
                if (!catItems.length) return;
                const raw = catItems.reduce((s, it) => s + (Number(it?.score) || 0), 0);
                const max = catItems.reduce((s, it) => s + (Number(it?.max_score) || 0), 0);
                cats.push({ catName, items: catItems, raw, max });
            });
            return { area, cats };
        })
        .filter(Boolean);
}

// 평가 발화 셀 — 근거 인용을 발화별로 클릭 가능하게 렌더. 클릭 시 onQuoteClick(quote).
function EvidenceCell({ evidence, onQuoteClick }) {
    if (!evidence.length) return <span className="text-[#98A2B3]">-</span>;
    const clickable = typeof onQuoteClick === 'function';
    return (
        <div className="flex flex-col gap-1 group/utt">
            {evidence.map((ev, qi) => {
                const quote = ev?.quote ?? '';
                return (
                    <span
                        key={qi}
                        onClick={clickable && quote ? (e) => onQuoteClick(quote, e) : undefined}
                        className={`flex items-start gap-1.5 rounded px-0.5 transition-colors ${
                            clickable && quote
                                ? 'cursor-pointer hover:bg-[#F2F4F7] hover:text-[#055AAF]'
                                : ''
                        }`}
                    >
                        <span className="shrink-0 mt-0.5 text-[10px] font-bold text-[#667085] bg-[#F2F4F7] rounded px-1 py-px tabular-nums">
                            {qi + 1}
                        </span>
                        <span className="text-[#475467]">
                            {ev?.speaker && <span className="text-[#98A2B3] mr-1">{ev.speaker}:</span>}
                            <span className="italic">"{quote}"</span>
                        </span>
                    </span>
                );
            })}
            {clickable && (
                <span className="text-[10.5px] text-[#98A2B3] opacity-0 group-hover/utt:opacity-100 transition-opacity flex items-center gap-1 mt-0.5">
                    <MessageSquare size={10} /> 클릭하여 상담 텍스트 확인
                </span>
            )}
        </div>
    );
}

/**
 * KSQI 평가 섹션 — 영역(A/B) 요약 카드 + 대분류(구분)별 항목표.
 * props:
 *   report: { area_a, area_b, overall, items[], summary } | null
 *   onQuoteClick?: (quote: string, e: MouseEvent) => void  — 평가 발화 클릭 시 STT 전사 팝오버(클릭 위치 앵커) 열기(선택).
 * report 가 없으면(null/undefined) 아무것도 렌더하지 않음 → 비-KSQI 브랜드에서 완전 무영향.
 */
export default function KsqiEvalSection({ report, onQuoteClick }) {
    if (!report) return null;

    const items = Array.isArray(report.items) ? report.items : [];
    const areaGroups = buildAreaGroups(items);

    const th =
        'bg-[#FAFBFC] border-b border-[#F2F4F7] px-2.5 py-2.5 text-[11px] font-semibold text-[#667085]';

    return (
        <section className="border-t border-[#EAECF0] bg-[#FAFBFC] px-5 py-4">
            {/* 섹션 헤더 — 제목 + 별개 축 안내 캡션 + (선택) 요약 라인 */}
            <div className="mb-3">
                <div className="flex items-center gap-2 flex-wrap">
                    <Gauge size={15} className="text-[#475467] shrink-0" />
                    <h4 className="text-[13.5px] font-semibold text-[#101828] tracking-tight">KSQI 평가</h4>
                    <span className="text-[11px] text-[#98A2B3]">
                        서비스 품질·공감 (브랜드 평가와 별개 축)
                    </span>
                </div>
                {report.summary && (
                    <p className="mt-1 text-[11px] text-[#667085] leading-relaxed">{report.summary}</p>
                )}
            </div>

            {/* 두 영역 요약 카드 — 좁은 화면에서 세로 스택 */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-4">
                <AreaCard label="A 서비스품질" area={report.area_a} />
                <AreaCard label="B 공감" area={report.area_b} />
            </div>

            {/* 항목 표 — 구분(영역·대분류) / 평가항목 / 평가 이유 / 평가 발화 / AI평가 */}
            <div className="rounded-[10px] border border-[#E4E7EC] bg-white overflow-x-auto">
                <table className="w-full min-w-[720px] text-left border-collapse">
                    <thead>
                        <tr>
                            <th className={`${th} w-28`}>구분</th>
                            <th className={`${th} w-32`}>평가항목</th>
                            <th className={`${th} w-48`}>평가 이유</th>
                            <th className={`${th} w-56`}>평가 발화</th>
                            <th className={`${th} w-24 text-center`}>AI평가</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-[#F2F4F7]">
                        {areaGroups.length === 0 ? (
                            <tr>
                                <td
                                    colSpan={5}
                                    className="px-2.5 py-6 text-center text-[12px] text-[#98A2B3]"
                                >
                                    KSQI 평가 항목이 없습니다.
                                </td>
                            </tr>
                        ) : (
                            areaGroups.map((g) =>
                                g.cats.map((c) => (
                                    <React.Fragment key={`${g.area}-${c.catName}`}>
                                        {c.items.map((item, i) => {
                                            const verdict = itemVerdict(item);
                                            const evidence = Array.isArray(item?.evidence) ? item.evidence : [];
                                            return (
                                                <tr
                                                    key={item?.item_number ?? `${c.catName}-${i}`}
                                                    className="hover:bg-[#FAFBFC] transition-colors align-top"
                                                >
                                                    {/* 구분 — 영역(A/B) 배지 + 대분류 + 소계 (연속 항목 rowSpan 병합) */}
                                                    {i === 0 && (
                                                        <td
                                                            rowSpan={c.items.length}
                                                            className="px-2.5 py-2.5 align-top border-r border-[#EEF2F7] bg-[#FBFCFD]"
                                                        >
                                                            <div className="flex flex-col gap-1">
                                                                <span className="inline-flex items-center gap-1.5">
                                                                    <span className="inline-flex items-center justify-center w-5 h-5 rounded text-[10px] font-bold text-[#475467] bg-[#EAECF0]">
                                                                        {g.area}
                                                                    </span>
                                                                    <span className="text-[12px] font-bold text-[#344054]">
                                                                        {c.catName}
                                                                    </span>
                                                                </span>
                                                                <span className="text-[10.5px] font-semibold text-[#667085] tabular-nums pl-0.5">
                                                                    소계 {c.raw}/{c.max}
                                                                </span>
                                                            </div>
                                                        </td>
                                                    )}
                                                    {/* 평가항목 */}
                                                    <td className="px-2.5 py-2.5 align-top text-[12.5px] font-medium text-[#101828] leading-snug">
                                                        {item?.item_name || '-'}
                                                    </td>
                                                    {/* 평가 이유 */}
                                                    <td className="px-2.5 py-2.5 align-top text-[11px] text-[#475467] leading-relaxed">
                                                        {item?.rationale ? (
                                                            item.rationale
                                                        ) : (
                                                            <span className="text-[#98A2B3]">-</span>
                                                        )}
                                                    </td>
                                                    {/* 평가 발화 (클릭 → STT 전사 이동) */}
                                                    <td className="px-2.5 py-2.5 align-top text-[11px] leading-relaxed">
                                                        <EvidenceCell evidence={evidence} onQuoteClick={onQuoteClick} />
                                                    </td>
                                                    {/* AI평가 — 점수 + 판정 배지 통합 */}
                                                    <td className="px-2.5 py-2.5 text-center align-top">
                                                        <div className="flex flex-col items-center gap-1">
                                                            <span className="text-[12.5px] font-semibold text-[#101828] tabular-nums">
                                                                {item?.score ?? '-'}
                                                                <span className="text-[#98A2B3] font-normal">
                                                                    /{item?.max_score ?? '-'}
                                                                </span>
                                                            </span>
                                                            <span
                                                                className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold border whitespace-nowrap ${verdict.cls}`}
                                                            >
                                                                {verdict.label}
                                                            </span>
                                                        </div>
                                                    </td>
                                                </tr>
                                            );
                                        })}
                                    </React.Fragment>
                                ))
                            )
                        )}
                    </tbody>
                </table>
            </div>
        </section>
    );
}
