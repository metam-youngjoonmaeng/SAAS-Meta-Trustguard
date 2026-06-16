import React, { useMemo } from 'react';
import { Flag, FileX } from 'lucide-react';
import { CHECKLIST_KEYS } from '../constants';
import { formatTime } from '../utils/formatters';

// 컬렉션관리부: 카테고리 달성률이 가장 낮은 항목을 콜의 대표 이슈로 환산
function deriveCollectionIssue(call) {
    const yn = call.checklist_yn_kor || {};
    let worstKey = null;
    let worstA = 0;
    let worstB = 0;
    let worstRatio = Infinity;
    for (const key of CHECKLIST_KEYS) {
        const v = yn[key];
        if (!v || !String(v).includes('/')) continue;
        const [a, b] = String(v).split('/').map((x) => parseInt(x, 10));
        if (!Number.isFinite(a) || !Number.isFinite(b) || b <= 0) continue;
        const r = a / b;
        if (r < worstRatio) {
            worstRatio = r;
            worstKey = key;
            worstA = a;
            worstB = b;
        }
    }
    if (!worstKey || worstRatio >= 0.8) return null;
    return { label: `${worstKey} 미충족`, scoreText: `${worstA}/${worstB}` };
}

function deriveConsumerIssue(call) {
    const v = Number(call.consumer_violations);
    if (!Number.isFinite(v) || v <= 0) return null;
    return { label: `소비자보호 미충족 ${v}건`, scoreText: `${v}건` };
}

const AutoFlagPanel = ({ calls, department, onOpenDetail }) => {
    const flags = useMemo(() => {
        if (!calls || calls.length === 0) return [];

        const out = [];
        for (const c of calls) {
            const issue =
                department === '컬렉션관리부' ? deriveCollectionIssue(c) : deriveConsumerIssue(c);
            if (!issue) continue;
            out.push({ call: c, ...issue });
        }
        out.sort((a, b) => {
            const ta = new Date(a.call.call_datetime || 0).getTime();
            const tb = new Date(b.call.call_datetime || 0).getTime();
            return tb - ta;
        });
        return out.slice(0, 5);
    }, [calls, department]);

    return (
        <div className="bg-white rounded-xl border border-[#E4E7EC] shadow-[0_1px_2px_rgba(16,24,40,0.04)] overflow-hidden">
            <div className="px-5 py-4 border-b border-[#F2F4F7] flex items-center justify-between">
                <div className="flex items-center gap-2">
                    <Flag size={16} className="text-[#B54708]" />
                    <h3 className="text-[14px] font-semibold text-[#101828]">자동 플래그 (오늘 배치)</h3>
                </div>
                <span className="text-[12px] text-[#98A2B3] tabular-nums">{flags.length}건</span>
            </div>

            {flags.length === 0 ? (
                <div className="px-5 py-10 text-center">
                    <div className="flex flex-col items-center gap-2 text-[#98A2B3]">
                        <FileX size={32} strokeWidth={1.5} className="opacity-60" />
                        <p className="text-[13px]">플래그된 콜이 없습니다.</p>
                    </div>
                </div>
            ) : (
                <div className="overflow-x-auto">
                    <table className="w-full text-left">
                        <thead>
                            <tr className="bg-[#FAFBFC]">
                                <th className="px-4 py-2 text-[12px] font-semibold text-[#667085] border-b border-[#F2F4F7]">평가 시각</th>
                                <th className="px-4 py-2 text-[12px] font-semibold text-[#667085] border-b border-[#F2F4F7]">상담사</th>
                                <th className="px-4 py-2 text-[12px] font-semibold text-[#667085] border-b border-[#F2F4F7]">이슈</th>
                                <th className="px-4 py-2 text-[12px] font-semibold text-[#667085] border-b border-[#F2F4F7] text-right">점수</th>
                                <th className="px-4 py-2 text-[12px] font-semibold text-[#667085] border-b border-[#F2F4F7] text-center">처리</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-[#F2F4F7]">
                            {flags.map(({ call, label, scoreText }) => (
                                <tr
                                    key={call.qa_id}
                                    className="hover:bg-[#FAFBFC] transition-colors cursor-pointer"
                                    onClick={() => onOpenDetail && onOpenDetail(call.qa_id)}
                                >
                                    <td className="px-4 py-2.5 text-[13px] text-[#475467] whitespace-nowrap tabular-nums">
                                        {formatTime(call.call_datetime)}
                                    </td>
                                    <td className="px-4 py-2.5 whitespace-nowrap">
                                        <div className="text-[13px] text-[#475467]">{call.agent_name || '-'}</div>
                                        <div className="text-[11px] text-[#98A2B3] font-mono">{call.call_no || ''}</div>
                                    </td>
                                    <td className="px-4 py-2.5 text-[13px] text-[#475467]">{label}</td>
                                    <td className="px-4 py-2.5 text-[13px] text-right text-[#475467] tabular-nums whitespace-nowrap">
                                        {scoreText}
                                    </td>
                                    <td className="px-4 py-2.5 text-center">
                                        <span className="inline-flex items-center px-2 py-0.5 rounded-full bg-[#F2F4F7] text-[#475467] text-[11px] font-semibold">
                                            검토 필요
                                        </span>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}
        </div>
    );
};

export default AutoFlagPanel;
