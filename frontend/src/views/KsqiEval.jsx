import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { ArrowLeft, Gauge, MessageSquare, ListCheck } from 'lucide-react';
import Dashboard from './Dashboard';
import { fetchEvaluations } from '../services/api';
import { formatDateTime, formatDuration } from '../utils/formatters';
import KsqiEvalSection from '../components/Detail/KsqiEvalSection';
import ReviewStatusBadge, { deriveReviewStatus } from '../components/ReviewStatusBadge';

// KSQI 평가 — 브랜드 루브릭(체크리스트·펜타곤·검수흐름)과 완전 분리된 독립 워크스페이스 뷰.
// 목록은 '평가 리스트'(Dashboard)를 그대로 재사용해 동일 필터 바(기간·상담사·항목버전·직무·부서·
// 검수상태·수기평가·항목)를 제공하되, 행 클릭 시 브랜드 상세 대신 'KSQI 상세'를 연다.
// KSQI 상세 = 상담 정보 헤더 + 2단(좌: STT 전사 상시 / 우: KSQI 평가표). 평가 발화 클릭 시 좌측 전사 해당 턴 하이라이트·스크롤.

export default function KsqiEval({ calls = [], activeBrandId, isLoading = false }) {
    const [selectedQaId, setSelectedQaId] = useState(null);
    const [evaluation, setEvaluation] = useState(null);
    const [detailLoading, setDetailLoading] = useState(false);
    // 좌측 STT 전사에서 하이라이트할 평가 발화(평가표의 발화 클릭 시 설정).
    const [highlightText, setHighlightText] = useState('');
    const scrollRef = useRef(null); // STT 전사 내부 스크롤 컨테이너(페이지 대신 여기만 스크롤)

    // 브랜드 전환 시 선택 초기화(PageContainer key 로 리마운트되지만 방어적으로).
    useEffect(() => {
        setSelectedQaId(null);
    }, [activeBrandId]);

    // 콜 전환 시 하이라이트 초기화.
    useEffect(() => {
        setHighlightText('');
    }, [selectedQaId]);

    // 상세 KSQI 로딩 — 선택된 콜의 evaluation.ksqi_report + conversation(전사).
    useEffect(() => {
        if (!selectedQaId) {
            setEvaluation(null);
            return undefined;
        }
        let cancelled = false;
        setDetailLoading(true);
        fetchEvaluations(selectedQaId)
            .then((e) => {
                if (!cancelled) setEvaluation(e);
            })
            .catch(() => {
                if (!cancelled) setEvaluation(null);
            })
            .finally(() => {
                if (!cancelled) setDetailLoading(false);
            });
        return () => {
            cancelled = true;
        };
    }, [selectedQaId]);

    const selectedCall = useMemo(
        () => calls.find((c) => c.qa_id === selectedQaId) || null,
        [calls, selectedQaId]
    );

    const conversationNodes = useMemo(
        () => (evaluation?.conversation || []).slice().sort((a, b) => (a.turn_no || 0) - (b.turn_no || 0)),
        [evaluation]
    );

    // 평가 발화 클릭 → 좌측 STT 전사의 해당 턴 하이라이트(스크롤은 아래 effect).
    const handleQuoteClick = useCallback((quote) => {
        setHighlightText(String(quote || ''));
    }, []);

    // 하이라이트 변경 시 좌측 STT 전사 해당 턴으로 스크롤 — 팝오버 내부 컨테이너만(페이지 이동 없음).
    useEffect(() => {
        if (!highlightText) return undefined;
        let cancelled = false;
        let retries = 0;
        const tryScroll = () => {
            if (cancelled) return;
            const container = scrollRef.current;
            const el = container?.querySelector('[data-ksqi-highlighted="true"]');
            if (container && el) {
                const cRect = container.getBoundingClientRect();
                const eRect = el.getBoundingClientRect();
                // 매칭 턴을 컨테이너 중앙에 — scrollIntoView 미사용(문서 스크롤 유발 방지).
                container.scrollTop += eRect.top - cRect.top - container.clientHeight / 2 + eRect.height / 2;
                return;
            }
            if (retries < 12) {
                retries += 1;
                setTimeout(tryScroll, 120);
            }
        };
        setTimeout(tryScroll, 60);
        return () => {
            cancelled = true;
        };
    }, [highlightText, conversationNodes]);

    // ────────────────────────────── 목록(평가 리스트 재사용) ──────────────────────────────
    if (!selectedQaId) {
        return (
            <div className="w-full">
                <div className="flex items-center gap-2 mb-4">
                    <Gauge size={18} className="text-[#475467] shrink-0" />
                    <h2 className="text-[16px] font-semibold text-[#101828] tracking-tight">KSQI 평가</h2>
                    <span className="text-[12px] text-[#98A2B3]">서비스 품질·공감 (브랜드 평가와 별개 축)</span>
                </div>
                <Dashboard
                    calls={calls}
                    isLoading={isLoading}
                    onOpenDetail={setSelectedQaId}
                    activeBrandId={activeBrandId}
                    ksqiMode
                />
            </div>
        );
    }

    // ────────────────────────────── KSQI 상세 ──────────────────────────────
    const call = selectedCall || {};
    // KSQI 뷰이므로 헤더 점수는 브랜드 AI평가가 아니라 KSQI 전체(raw/max)를 표시(목록 컬럼과 일관).
    const ksqiOverall =
        evaluation?.ksqi_report?.overall && evaluation.ksqi_report.overall.raw != null
            ? `${evaluation.ksqi_report.overall.raw} / ${evaluation.ksqi_report.overall.max ?? '-'}`
            : call.ksqi_overall_raw == null || call.ksqi_overall_max == null
              ? '-'
              : `${call.ksqi_overall_raw} / ${call.ksqi_overall_max}`;

    // 좌측 STT 전사 패널 — 상시 표시. 평가 발화(highlightText) 매칭 턴 하이라이트.
    const sttPanel = (
        <div className="bg-white rounded-[14px] border border-[#E4E7EC] shadow-[0_1px_2px_rgba(16,24,40,0.04)] flex flex-col overflow-hidden max-h-[calc(100vh-140px)] lg:sticky lg:top-4">
            <div className="px-4 py-3 border-b border-[#EAECF0] bg-[#F9FAFB] flex items-center gap-2.5 shrink-0">
                <MessageSquare size={16} className="text-[#475467]" />
                <h3 className="text-[14px] font-semibold text-[#101828] tracking-tight">STT 전사</h3>
                <span className="text-[11px] text-[#98A2B3]">평가 발화 클릭 시 해당 턴으로 이동</span>
            </div>
            <div ref={scrollRef} className="flex-1 min-h-0 overflow-y-auto p-4 space-y-3">
                {conversationNodes.map((n, i) => {
                    const isAgent = n.speaker === '상담사';
                    const normalizedNode = (n.text || '').replace(/\s+/g, '');
                    const targets = (highlightText || '')
                        .split('\n')
                        .map((t) => t.replace(/\s+/g, ''))
                        .filter(Boolean);
                    const reallyMatched =
                        isAgent &&
                        Boolean(normalizedNode) &&
                        targets.some((t) => {
                            if (normalizedNode === t) return true;
                            if (t.length >= 4 && normalizedNode.includes(t)) return true;
                            if (normalizedNode.length >= 6 && t.includes(normalizedNode)) return true;
                            const short = t.slice(0, 12);
                            if (short.length >= 6 && normalizedNode.includes(short)) return true;
                            return false;
                        });
                    return (
                        <div
                            key={i}
                            id={reallyMatched ? 'ksqi-highlighted-turn' : undefined}
                            data-ksqi-highlighted={reallyMatched ? 'true' : undefined}
                            className={`flex flex-col ${isAgent ? 'items-start' : 'items-end'} transition-all duration-500`}
                        >
                            <div className="text-[10px] text-[#98A2B3] mb-1 font-mono tabular-nums px-1">
                                {n.speaker}
                                {n.turn_no ? ` · ${n.turn_no}턴` : ''}
                            </div>
                            <div
                                className={`max-w-[88%] px-3 py-2 rounded-lg text-[13px] leading-relaxed transition-all ${
                                    reallyMatched
                                        ? 'bg-[#FFFAEB] text-[#B54708] ring-2 ring-[#FEDF89]'
                                        : isAgent
                                          ? 'bg-[#F2F4F7] text-[#101828]'
                                          : 'bg-[#055AAF] text-white'
                                }`}
                            >
                                {n.text}
                                {reallyMatched && (
                                    <div className="mt-1.5 text-[10px] font-semibold text-[#B54708] flex items-center gap-1">
                                        <ListCheck size={10} /> 평가 해당 발화
                                    </div>
                                )}
                            </div>
                        </div>
                    );
                })}
                {conversationNodes.length === 0 && (
                    <div className="py-20 text-center text-[#98A2B3] text-[13px]">녹취록 데이터가 없습니다.</div>
                )}
            </div>
        </div>
    );

    return (
        <div className="pb-10 w-full">
            <div className="flex items-start justify-between gap-4 mb-5">
                <div className="min-w-0">
                    <div className="flex items-center gap-2">
                        <Gauge size={16} className="text-[#475467] shrink-0" />
                        <h2 className="text-[15px] font-semibold text-[#101828] tracking-tight">KSQI 평가</h2>
                    </div>
                    <p className="mt-1 text-sm text-[#667085] truncate">
                        {`${call.agent_name || '-'} 상담사 | 상담번호: ${call.call_no || '-'}`}
                    </p>
                </div>
                <button
                    onClick={() => setSelectedQaId(null)}
                    className="shrink-0 px-4 py-2 border border-[#D0D5DD] rounded-lg text-sm font-semibold text-[#344054] hover:bg-gray-50 flex items-center gap-2"
                >
                    <ArrowLeft size={16} />
                    목록으로
                </button>
            </div>

            {/* 상담 정보 — 콜 메타 헤더 */}
            <div className="bg-white rounded-[14px] border border-[#E4E7EC] shadow-sm overflow-x-auto mb-6">
                <table className="w-full min-w-[1180px] border-collapse">
                    <thead>
                        <tr className="bg-[#F9FAFB] text-[10px] text-[#667085]">
                            <th className="px-2.5 py-1.5 text-center border-r border-[#EEF2F7]">상담번호</th>
                            <th className="px-2.5 py-1.5 text-center border-r border-[#EEF2F7]">상담일시</th>
                            <th className="px-2.5 py-1.5 text-center border-r border-[#EEF2F7]">상담시간</th>
                            <th className="px-2.5 py-1.5 text-center border-r border-[#EEF2F7]">부서</th>
                            <th className="px-2.5 py-1.5 text-center border-r border-[#EEF2F7]">직무</th>
                            <th className="px-2.5 py-1.5 text-center border-r border-[#EEF2F7]">상담사ID</th>
                            <th className="px-2.5 py-1.5 text-center border-r border-[#EEF2F7]">상담사명</th>
                            <th className="px-2.5 py-1.5 text-center border-r border-[#EEF2F7]">고객번호</th>
                            <th className="px-2.5 py-1.5 text-center border-r border-[#EEF2F7]">고객등급</th>
                            <th className="px-2.5 py-1.5 text-center border-r border-[#EEF2F7]">KSQI 전체</th>
                            <th className="px-2.5 py-1.5 text-center">검수상태</th>
                        </tr>
                    </thead>
                    <tbody>
                        <tr className="text-[11px] text-[#101828]">
                            <td className="px-2.5 py-1.5 text-center border-r border-[#EEF2F7]">{call.call_no || '-'}</td>
                            <td className="px-2.5 py-1.5 text-center border-r border-[#EEF2F7]">{formatDateTime(call.call_datetime)}</td>
                            <td className="px-2.5 py-1.5 text-center border-r border-[#EEF2F7]">{formatDuration(call.duration_sec)}</td>
                            <td className="px-2.5 py-1.5 text-center border-r border-[#EEF2F7]">{call.department || '-'}</td>
                            <td className="px-2.5 py-1.5 text-center border-r border-[#EEF2F7]">{call.role || '-'}</td>
                            <td className="px-2.5 py-1.5 text-center border-r border-[#EEF2F7]">{call.agent_id || '-'}</td>
                            <td className="px-2.5 py-1.5 text-center border-r border-[#EEF2F7]">{call.agent_name || '-'}</td>
                            <td className="px-2.5 py-1.5 text-center border-r border-[#EEF2F7]">{call.customer_no || '-'}</td>
                            <td className="px-2.5 py-1.5 text-center border-r border-[#EEF2F7]">{call.customer_grade || '-'}</td>
                            <td className="px-2.5 py-1.5 text-center border-r border-[#EEF2F7] font-semibold tabular-nums">{ksqiOverall}</td>
                            <td className="px-2.5 py-1.5 text-center">
                                <ReviewStatusBadge status={deriveReviewStatus(call)} />
                            </td>
                        </tr>
                    </tbody>
                </table>
            </div>

            {/* 2단: 좌 KSQI 평가표 / 우 STT 전사(상시) */}
            <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_minmax(0,360px)] gap-4 items-start">
                {/* 좌측 — KSQI 평가표 */}
                <div className="bg-white rounded-[14px] border border-[#E4E7EC] shadow-[0_1px_2px_rgba(16,24,40,0.04)] overflow-hidden min-w-0">
                    <div className="px-5 py-3 border-b border-[#EAECF0] bg-[#F9FAFB] flex items-center gap-2.5">
                        <Gauge size={16} className="text-[#475467]" />
                        <h3 className="text-[14px] font-semibold text-[#101828] tracking-tight">KSQI 평가표</h3>
                    </div>

                    {detailLoading ? (
                        <div className="flex flex-col items-center justify-center py-24">
                            <div className="w-10 h-10 border-4 border-[#055AAF]/20 border-t-[#055AAF] rounded-full animate-spin"></div>
                            <p className="mt-4 font-semibold text-[#667085] text-[13px]">KSQI 평가 결과를 불러오는 중입니다...</p>
                        </div>
                    ) : evaluation?.ksqi_report ? (
                        <KsqiEvalSection report={evaluation.ksqi_report} onQuoteClick={handleQuoteClick} />
                    ) : (
                        <div className="flex flex-col items-center justify-center py-24 text-[#98A2B3]">
                            <Gauge size={40} strokeWidth={1.5} className="opacity-60" />
                            <p className="mt-3 text-[13px]">이 콜에는 KSQI 평가 결과가 없습니다.</p>
                            <p className="mt-1 text-[11.5px]">KSQI 토글을 켠 뒤 채점된 콜만 결과가 표시됩니다.</p>
                        </div>
                    )}
                </div>

                {/* 우측 — STT 전사 */}
                {sttPanel}
            </div>
        </div>
    );
}
