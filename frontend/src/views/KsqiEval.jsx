import React, { useState, useEffect, useMemo } from 'react';
import { ArrowLeft, Gauge } from 'lucide-react';
import Dashboard from './Dashboard';
import { fetchEvaluations } from '../services/api';
import { formatDateTime, formatDuration } from '../utils/formatters';
import KsqiEvalSection from '../components/Detail/KsqiEvalSection';
import ReviewStatusBadge, { deriveReviewStatus } from '../components/ReviewStatusBadge';

// KSQI 평가 — 브랜드 루브릭(체크리스트·펜타곤·검수흐름)과 완전 분리된 독립 워크스페이스 뷰.
// 목록은 '평가 리스트'(Dashboard)를 그대로 재사용해 동일 필터 바(기간·상담사·항목버전·직무·부서·
// 검수상태·수기평가·항목)를 제공하되, 행 클릭 시 브랜드 상세 대신 'KSQI 상세'를 연다.
// KSQI 상세 = 상담 정보 헤더 + KSQI 평가표만(수기평가·펜타곤·관리자 코멘트·상세 체크리스트 없음).

export default function KsqiEval({ calls = [], activeBrandId, isLoading = false }) {
    const [selectedQaId, setSelectedQaId] = useState(null);
    const [evaluation, setEvaluation] = useState(null);
    const [detailLoading, setDetailLoading] = useState(false);

    // 브랜드 전환 시 선택 초기화(PageContainer key 로 리마운트되지만 방어적으로).
    useEffect(() => {
        setSelectedQaId(null);
    }, [activeBrandId]);

    // 상세 KSQI 로딩 — 선택된 콜의 evaluation.ksqi_report.
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

            {/* KSQI 평가표 */}
            <div className="bg-white rounded-[14px] border border-[#E4E7EC] shadow-[0_1px_2px_rgba(16,24,40,0.04)] overflow-hidden">
                {detailLoading ? (
                    <div className="flex flex-col items-center justify-center py-24">
                        <div className="w-10 h-10 border-4 border-[#055AAF]/20 border-t-[#055AAF] rounded-full animate-spin"></div>
                        <p className="mt-4 font-semibold text-[#667085] text-[13px]">KSQI 평가 결과를 불러오는 중입니다...</p>
                    </div>
                ) : evaluation?.ksqi_report ? (
                    <KsqiEvalSection report={evaluation.ksqi_report} />
                ) : (
                    <div className="flex flex-col items-center justify-center py-24 text-[#98A2B3]">
                        <Gauge size={40} strokeWidth={1.5} className="opacity-60" />
                        <p className="mt-3 text-[13px]">이 콜에는 KSQI 평가 결과가 없습니다.</p>
                        <p className="mt-1 text-[11.5px]">KSQI 토글을 켠 뒤 채점된 콜만 결과가 표시됩니다.</p>
                    </div>
                )}
            </div>
        </div>
    );
}
