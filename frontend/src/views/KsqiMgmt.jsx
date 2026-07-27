import React, { useEffect, useMemo, useState } from 'react';
import Header from '../components/Header';
import { fetchKsqiCatalog } from '../services/api';
import { Loader2, Info, Headphones, AlertTriangle } from 'lucide-react';

// ============================================================
// KSQI 관리 (읽기 전용)
//
// KSQI STT 평가표(17항목) 카탈로그를 조회해 표시한다. 편집 기능 없음 —
// 항목 정의는 파이프라인(v2/nodes/ksqi_stt/rules.py·prompts.py)이 SSOT 이고,
// 이 화면은 GET /api/ksqi-stt/catalog 결과를 그대로 보여준다.
//
// 항목 kind:
//  - "llm"  : STT 판정 대상 12항목 — criterion = 판정 프롬프트(CoT) 본문. (종류 태그 미표기)
//  - "auto" : 자동만점(X) 5항목 — STT 대상 아님. alt_channel 로 별도 평가.
//
// 좌측: 영역(A/B)별 항목 리스트. 우측: 선택 항목의 기준/프롬프트 미리보기.
// EvalItems 의 master-detail 스타일을 재사용(읽기 전용이라 편집 진입점 없음).
// ============================================================

// 영역 라벨/설명 — catalog item.area("A"|"B") 기준. (파이프라인 확정 라벨: A=서비스 품질 9항목 / B=공감 8항목)
const AREA_META = {
    A: { label: 'A영역', desc: '서비스 품질' },
    B: { label: 'B영역', desc: '공감' },
};

function areaLabel(area) {
    return AREA_META[area]?.label || (area ? `${area}영역` : '기타');
}

function KindBadge({ kind }) {
    // 자동만점(X) 항목만 배지로 구분한다. KSQI 는 조회 전용 카탈로그이므로
    // STT 판정(llm) 항목에는 별도의 종류 태그를 붙이지 않는다.
    if (kind === 'auto') {
        return (
            <span className="inline-flex items-center gap-1 text-[10px] font-bold px-1.5 py-0.5 rounded bg-[#F2F4F7] text-[#98A2B3]">
                <Headphones size={10} /> 자동만점
            </span>
        );
    }
    return null;
}

function ItemRow({ item, selected, onSelect }) {
    const isAuto = item.kind === 'auto';
    return (
        <div
            onClick={onSelect}
            className={`flex items-center gap-2 px-3 py-2.5 rounded-lg mb-0.5 transition-colors cursor-pointer ${
                selected ? 'bg-[#EEF4FB]' : 'hover:bg-[#F9FAFB]'
            }`}
        >
            <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5 mb-0.5">
                    <span className="text-[10px] font-bold text-[#98A2B3] tabular-nums">
                        #{String(item.number).padStart(2, '0')}
                    </span>
                    <span className="text-[10px] font-semibold text-[#667085] truncate">{item.category}</span>
                </div>
                <div className="flex items-center gap-1.5 min-w-0">
                    <span
                        className={`text-[12.5px] font-bold truncate ${
                            isAuto ? 'text-[#98A2B3]' : selected ? 'text-[#055AAF]' : 'text-[#101828]'
                        }`}
                    >
                        {item.name}
                    </span>
                </div>
            </div>
            <KindBadge kind={item.kind} />
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

function MetaDivider() {
    return <span className="w-px h-3 bg-[#E4E7EC]" />;
}

function ItemPreview({ item }) {
    const isAuto = item.kind === 'auto';
    return (
        <div className="bg-white border border-[#E4E7EC] rounded-xl shadow-[0_1px_2px_rgba(16,24,40,0.04)] flex flex-col overflow-hidden">
            <div className="px-5 py-3.5 border-b border-[#F2F4F7] bg-[#FAFBFC] flex items-center gap-3">
                <span className="text-[11px] font-bold text-[#98A2B3] tabular-nums">
                    #{String(item.number).padStart(2, '0')}
                </span>
                <h3 className="text-[14px] font-bold text-[#101828] tracking-tight truncate">{item.name}</h3>
                <KindBadge kind={item.kind} />
            </div>

            <div className="px-5 py-2.5 bg-[#FAFBFC] border-b border-[#F2F4F7] flex items-center gap-3 flex-wrap text-[12px] text-[#667085]">
                <MetaPair label="영역" value={areaLabel(item.area)} />
                <MetaDivider />
                <MetaPair label="대분류" value={item.category || '—'} />
                <MetaDivider />
                <MetaPair label="만점" value={`${item.max_score ?? 0}점`} />
                <MetaDivider />
                <MetaPair label="채점" value={isAuto ? '자동만점(이진)' : 'LLM 판정(이진)'} />
            </div>

            <div className="flex-1 overflow-y-auto p-5 min-h-0">
                {isAuto ? (
                    <div className="flex items-start gap-2.5 px-4 py-3.5 rounded-xl border border-dashed border-[#E4E7EC] bg-[#FAFBFC]">
                        <AlertTriangle size={16} className="mt-0.5 shrink-0 text-[#98A2B3]" />
                        <div className="min-w-0">
                            <div className="text-[12.5px] font-bold text-[#475467]">STT 평가 대상 아님</div>
                            <div className="text-[12px] text-[#667085] mt-0.5 leading-relaxed">
                                {item.criterion
                                    ? item.criterion
                                    : `대체 채널(${item.alt_channel || '별도 채널'})로 별도 평가되어 자동 만점 처리됩니다.`}
                            </div>
                        </div>
                    </div>
                ) : (
                    <div className="flex flex-col gap-2">
                        <div className="text-[10.5px] font-bold text-[#98A2B3] tracking-[0.06em] uppercase">
                            판정 기준 (프롬프트)
                        </div>
                        {item.criterion ? (
                            <pre className="text-[12px] font-mono text-[#475467] leading-relaxed whitespace-pre-wrap bg-[#FAFBFC] border border-[#E4E7EC] rounded-lg p-3 overflow-auto">
                                {item.criterion}
                            </pre>
                        ) : (
                            <div className="text-[13px] text-[#98A2B3] italic leading-relaxed">
                                등록된 판정 기준이 없습니다.
                            </div>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
}

const KsqiMgmt = ({ topOffset = 0, orgId = null }) => {
    const [catalog, setCatalog] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [selectedNumber, setSelectedNumber] = useState(null);

    useEffect(() => {
        let cancelled = false;
        setLoading(true);
        setError(null);
        // 활성 브랜드 지정 시 브랜드별 DB 정의(ksqi_item_defs) 기준 조회 — 브랜드 전환 시 재조회.
        fetchKsqiCatalog(orgId)
            .then((list) => {
                if (cancelled) return;
                const items = Array.isArray(list) ? [...list].sort((a, b) => (a.number ?? 0) - (b.number ?? 0)) : [];
                setCatalog(items);
                if (items.length) setSelectedNumber(items[0].number);
            })
            .catch((err) => {
                if (cancelled) return;
                setCatalog([]);
                setError(err?.message || 'KSQI 카탈로그를 불러오지 못했습니다.');
            })
            .finally(() => {
                if (!cancelled) setLoading(false);
            });
        return () => {
            cancelled = true;
        };
    }, [orgId]);

    // 영역(A/B) → 항목 그룹. 각 영역 내 number 오름차순.
    const grouped = useMemo(() => {
        const map = new Map();
        for (const it of catalog) {
            const key = it.area || '기타';
            if (!map.has(key)) map.set(key, []);
            map.get(key).push(it);
        }
        // A, B, 기타 순으로 정렬.
        return [...map.entries()].sort(([a], [b]) => String(a).localeCompare(String(b)));
    }, [catalog]);

    const selectedItem = useMemo(
        () => catalog.find((it) => it.number === selectedNumber) || null,
        [catalog, selectedNumber],
    );

    const autoCount = catalog.filter((it) => it.kind === 'auto').length;

    return (
        <div className="pb-10 w-full">
            <Header
                title="KSQI 관리"
                subtitle={
                    catalog.length
                        ? `KSQI STT 평가표 · 총 ${catalog.length}항목 (자동만점 ${autoCount}) · 읽기 전용`
                        : 'KSQI STT 평가표 항목을 조회합니다. 읽기 전용 — 항목 정의는 파이프라인에서 관리됩니다.'
                }
            />

            {loading ? (
                <div className="flex justify-center py-12">
                    <Loader2 className="h-5 w-5 animate-spin text-[#667085]" />
                </div>
            ) : error ? (
                <div className="py-10 px-6 text-center rounded-xl border border-dashed border-[#FDA29B] bg-[#FFFBFA]">
                    <AlertTriangle size={20} className="text-[#B42318] mx-auto mb-2" />
                    <div className="text-[12.5px] text-[#B42318]">{error}</div>
                </div>
            ) : catalog.length === 0 ? (
                <div className="py-12 px-6 text-center rounded-xl border border-dashed border-[#E4E7EC] bg-[#FAFBFC]">
                    <Info size={20} className="text-[#98A2B3] mx-auto mb-2" />
                    <div className="text-[12.5px] text-[#667085]">표시할 KSQI 항목이 없습니다.</div>
                </div>
            ) : (
                <div
                    className="grid gap-5"
                    style={{
                        gridTemplateColumns: '320px minmax(0, 1fr)',
                        height: `calc(100vh - ${220 + topOffset}px)`,
                        minHeight: 600,
                    }}
                >
                    {/* ── 좌측: 영역별 항목 리스트 ── */}
                    <div className="bg-white border border-[#E4E7EC] rounded-xl shadow-[0_1px_2px_rgba(16,24,40,0.04)] flex flex-col overflow-hidden">
                        <div className="flex-1 overflow-y-auto p-2 min-h-0">
                            {grouped.map(([area, items]) => (
                                <div key={area} className="mb-2 last:mb-0">
                                    <div className="px-3 pt-2 pb-1 flex items-center gap-1.5">
                                        <span className="text-[11px] font-bold text-[#101828] tracking-tight">
                                            {areaLabel(area)}
                                        </span>
                                        <span className="text-[10.5px] text-[#98A2B3] font-medium">{items.length}항목</span>
                                        {AREA_META[area]?.desc && (
                                            <span className="text-[10px] text-[#98A2B3] truncate">· {AREA_META[area].desc}</span>
                                        )}
                                    </div>
                                    {items.map((it) => (
                                        <ItemRow
                                            key={it.number}
                                            item={it}
                                            selected={selectedNumber === it.number}
                                            onSelect={() => setSelectedNumber(it.number)}
                                        />
                                    ))}
                                </div>
                            ))}
                        </div>
                    </div>

                    {/* ── 우측: 선택 항목 미리보기 ── */}
                    {selectedItem ? (
                        <ItemPreview item={selectedItem} />
                    ) : (
                        <div className="bg-white border border-[#E4E7EC] rounded-xl flex items-center justify-center text-[13px] text-[#667085]">
                            좌측에서 항목을 선택하세요
                        </div>
                    )}
                </div>
            )}
        </div>
    );
};

export default KsqiMgmt;
