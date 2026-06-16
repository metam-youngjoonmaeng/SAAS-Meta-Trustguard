import React, { useMemo } from 'react';
import { Sparkles, Target, Award } from 'lucide-react';
import { CHECKLIST_KEYS } from '../constants';

// 카테고리별 평균 달성률을 계산해 가장 낮은 카테고리(보완 필요 항목)를 찾음
function weakestCategory(callsOfAgent) {
    const agg = {};
    for (const c of callsOfAgent) {
        const yn = c.checklist_yn_kor || {};
        for (const key of CHECKLIST_KEYS) {
            const v = yn[key];
            if (!v || !String(v).includes('/')) continue;
            const [a, b] = String(v).split('/').map((x) => parseInt(x, 10));
            if (!Number.isFinite(a) || !Number.isFinite(b) || b <= 0) continue;
            if (!agg[key]) agg[key] = { sum: 0, count: 0 };
            agg[key].sum += a / b;
            agg[key].count += 1;
        }
    }
    let worst = null;
    let worstRatio = Infinity;
    for (const [key, { sum, count }] of Object.entries(agg)) {
        const r = sum / count;
        if (r < worstRatio) {
            worstRatio = r;
            worst = key;
        }
    }
    return worst;
}

const CoachingActionPanel = ({ calls, department }) => {
    const data = useMemo(() => {
        if (!calls || calls.length === 0) {
            return { priority: [], best: null, teamAvg: 0, totalCandidates: 0 };
        }

        const byAgent = new Map();
        for (const c of calls) {
            const name = c.agent_name;
            if (!name) continue;
            if (!byAgent.has(name)) {
                byAgent.set(name, { name, role: c.role || '', calls: [], scores: [] });
            }
            const rec = byAgent.get(name);
            rec.calls.push(c);
            const s = Number(c.total_score);
            if (Number.isFinite(s)) rec.scores.push(s);
        }

        const agents = Array.from(byAgent.values())
            .filter((a) => a.scores.length > 0)
            .map((a) => ({
                name: a.name,
                role: a.role,
                count: a.calls.length,
                avg: Math.round(a.scores.reduce((p, n) => p + n, 0) / a.scores.length),
                weakest: department === '컬렉션관리부' ? weakestCategory(a.calls) : null,
            }))
            .sort((x, y) => x.avg - y.avg);

        if (agents.length === 0) {
            return { priority: [], best: null, teamAvg: 0, totalCandidates: 0 };
        }

        const teamAvg = Math.round(agents.reduce((p, a) => p + a.avg, 0) / agents.length);
        const priorityCount = Math.min(2, Math.max(0, agents.length - 1));
        const priority = agents.slice(0, priorityCount).map((a) => ({ ...a, diff: a.avg - teamAvg }));
        const best =
            agents.length >= 2
                ? { ...agents[agents.length - 1], diff: agents[agents.length - 1].avg - teamAvg }
                : null;

        return {
            priority,
            best,
            teamAvg,
            totalCandidates: priority.length + (best ? 1 : 0),
        };
    }, [calls, department]);

    return (
        <div className="bg-white rounded-xl border border-[#E4E7EC] shadow-[0_1px_2px_rgba(16,24,40,0.04)] overflow-hidden">
            <div className="px-5 py-4 border-b border-[#F2F4F7] flex items-center justify-between">
                <div className="flex items-center gap-2">
                    <Sparkles size={16} className="text-[#055AAF]" />
                    <h3 className="text-[14px] font-semibold text-[#101828]">코칭 액션 (AI 자동 추천)</h3>
                </div>
                {data.teamAvg > 0 && (
                    <span className="text-[12px] text-[#98A2B3] tabular-nums">팀 평균 {data.teamAvg}점</span>
                )}
            </div>

            {data.priority.length === 0 && !data.best ? (
                <div className="px-5 py-10 text-center text-[#98A2B3] text-[14px]">
                    분석 가능한 상담사 데이터가 없습니다.
                </div>
            ) : (
                <div className="divide-y divide-[#F2F4F7]">
                    {data.priority.map((a) => (
                        <div key={a.name} className="px-5 py-4">
                            <div className="flex items-start justify-between gap-3">
                                <div className="flex-1 min-w-0">
                                    <div className="flex items-center gap-2 mb-1.5">
                                        <Target size={14} className="text-[#B54708]" />
                                        <span className="text-[14px] font-semibold text-[#101828]">{a.name}</span>
                                        {a.role && <span className="text-[12px] text-[#667085]">· {a.role}</span>}
                                    </div>
                                    <div className="text-[13px] text-[#475467]">
                                        종합 <strong className="tabular-nums">{a.avg}점</strong>
                                        <span className="text-[#B54708] ml-1.5 tabular-nums">
                                            (팀 평균 {a.diff >= 0 ? '+' : ''}{a.diff})
                                        </span>
                                        <span className="text-[#98A2B3] ml-1.5 tabular-nums">· 콜 {a.count}건</span>
                                    </div>
                                    {a.weakest && (
                                        <div className="text-[12px] text-[#667085] mt-0.5">
                                            보완 필요 항목: <strong className="text-[#475467]">{a.weakest}</strong>
                                        </div>
                                    )}
                                </div>
                                <span className="shrink-0 inline-flex items-center px-2 py-0.5 rounded-full bg-[#FEF0C7] text-[#B54708] text-[11px] font-semibold">
                                    우선 코칭
                                </span>
                            </div>
                        </div>
                    ))}

                    {data.best && (
                        <div className="px-5 py-4">
                            <div className="flex items-start justify-between gap-3">
                                <div className="flex-1 min-w-0">
                                    <div className="flex items-center gap-2 mb-1.5">
                                        <Award size={14} className="text-[#067647]" />
                                        <span className="text-[14px] font-semibold text-[#101828]">{data.best.name}</span>
                                        {data.best.role && (
                                            <span className="text-[12px] text-[#667085]">· {data.best.role}</span>
                                        )}
                                    </div>
                                    <div className="text-[13px] text-[#475467]">
                                        종합 <strong className="tabular-nums">{data.best.avg}점</strong>
                                        <span className="text-[#067647] ml-1.5 tabular-nums">
                                            (팀 평균 +{data.best.diff})
                                        </span>
                                        <span className="text-[#98A2B3] ml-1.5 tabular-nums">· 콜 {data.best.count}건</span>
                                    </div>
                                    <div className="text-[12px] text-[#667085] mt-0.5">
                                        추천: 베스트 콜 → 신입 교육 콘텐츠
                                    </div>
                                </div>
                                <span className="shrink-0 inline-flex items-center px-2 py-0.5 rounded-full bg-[#DCFAE6] text-[#067647] text-[11px] font-semibold">
                                    베스트 콜 후보
                                </span>
                            </div>
                        </div>
                    )}

                    <div className="px-5 py-3 bg-[#FAFBFC] text-[12px] text-[#667085] flex items-center justify-between">
                        <span>
                            전체 코칭 대상 <strong className="text-[#101828] tabular-nums">{data.totalCandidates}명</strong>
                        </span>
                        <span className="text-[#98A2B3]">자동 리포트 → 익일 09:00 매니저 메일 발송 예약</span>
                    </div>
                </div>
            )}
        </div>
    );
};

export default CoachingActionPanel;
