import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
    Award, ClipboardCheck, Users, AlertTriangle, TrendingUp, TrendingDown,
    Building2, ArrowUpRight, ArrowDownRight, Minus, ChevronRight, BarChart3,
} from 'lucide-react';
import Header from '../components/Header';
import { fetchStats } from '../services/api';

/* ── primary 단색 명도 램프(밝음→어두움) — 값→색 시퀀셜 인코딩용 5단계.
   DS "단일 primary" 원칙을 지키면서도 점수대별 명암 구분을 표현한다(color-mix). ── */
const PRIMARY_RAMP = [
    'color-mix(in srgb, var(--primary) 24%, white)',
    'color-mix(in srgb, var(--primary) 46%, white)',
    'color-mix(in srgb, var(--primary) 70%, white)',
    'var(--primary)',
    'color-mix(in srgb, var(--primary) 78%, black)',
];

/* ── 브랜드 블루 시퀀셜 스케일 (점수대 → 색) — 점수 높을수록 진함. ───────────────── */
const BLUE_SCALE = [
    { min: 90, fill: PRIMARY_RAMP[4], track: '#dbe4f7', ink: PRIMARY_RAMP[4] },
    { min: 80, fill: PRIMARY_RAMP[3], track: 'var(--primary-soft-flat)', ink: 'var(--primary)' },
    { min: 70, fill: PRIMARY_RAMP[2], track: '#e2ecfd', ink: 'var(--primary)' },
    { min: 60, fill: PRIMARY_RAMP[1], track: '#e8f1fe', ink: 'var(--primary)' },
    { min: 0,  fill: PRIMARY_RAMP[0], track: 'var(--primary-soft-flat)', ink: 'var(--ink-500)' },
];
const blueFor = (v) => BLUE_SCALE.find((s) => v >= s.min) || BLUE_SCALE[BLUE_SCALE.length - 1];
const fmtNum = (n) => Number(n || 0).toLocaleString('ko-KR');
const KO_DOW = ['일', '월', '화', '수', '목', '금', '토'];

/* 숫자 카운트업(easeOutCubic) — 값 변경 시 재애니메이션 */
function useCountUp(target, duration = 750) {
    const [val, setVal] = useState(0);
    const fromRef = useRef(0);
    const rafRef = useRef(null);
    useEffect(() => {
        const from = fromRef.current;
        const start = performance.now();
        cancelAnimationFrame(rafRef.current);
        const tick = (now) => {
            const t = Math.min(1, (now - start) / duration);
            const eased = 1 - Math.pow(1 - t, 3);
            setVal(from + (target - from) * eased);
            if (t < 1) rafRef.current = requestAnimationFrame(tick);
            else fromRef.current = target;
        };
        rafRef.current = requestAnimationFrame(tick);
        return () => cancelAnimationFrame(rafRef.current);
    }, [target, duration]);
    return val;
}

/* 반원 게이지(브랜드 블루). value 0~100 */
function SemiGauge({ value, fill, track }) {
    const v = useCountUp(value);
    return (
        <div className="relative w-full max-w-[150px] mx-auto">
            <svg viewBox="0 0 120 70" className="w-full block">
                <path d="M10 60 A50 50 0 0 1 110 60" fill="none" stroke={track} strokeWidth="11" strokeLinecap="round" pathLength="100" />
                <path d="M10 60 A50 50 0 0 1 110 60" fill="none" stroke={fill} strokeWidth="11" strokeLinecap="round"
                      pathLength="100" strokeDasharray="100" strokeDashoffset={100 - v} />
            </svg>
            <div className="absolute left-0 right-0 bottom-0 text-center">
                <span className="text-[26px] font-extrabold text-[var(--ink-900)] tracking-tight tabular-nums leading-none">{Math.round(v)}</span>
                <span className="text-[13px] font-bold text-[var(--ink-500)]">%</span>
            </div>
        </div>
    );
}

function GaugeCard({ dim, index }) {
    const s = blueFor(dim.avg ?? 0);
    const weak = (dim.avg ?? 0) < 70;
    return (
        <div className="reveal-up bg-white border border-[var(--border)] rounded-[14px] px-[14px] pt-4 pb-3 transition-shadow hover:shadow-md hover:border-[var(--border-strong)]"
             style={{ animationDelay: `${index * 35}ms` }}>
            <div className="flex items-center justify-center gap-1.5 mb-2 min-h-[18px]">
                <span className="text-[13px] font-bold text-[var(--ink-900)]">{dim.item}</span>
                {weak && <span className="text-[9.5px] font-bold text-[var(--primary)] bg-[var(--primary-soft-flat)] rounded px-1.5 py-px">주의</span>}
            </div>
            <SemiGauge value={dim.avg ?? 0} fill={s.fill} track={s.track} />
        </div>
    );
}

function TeamAvg({ value, active }) {
    const v = useCountUp(value || 0);
    return (
        <span className={`text-[28px] font-extrabold tracking-tight tabular-nums ${active ? 'text-[var(--primary)]' : 'text-[var(--ink-900)]'}`}>
            {v.toFixed(1)}
        </span>
    );
}

const SEG = [
    { key: 'day', label: '오늘' },
    { key: 'week', label: '이번주' },
    { key: 'month', label: '이번달' },
];

function avatarColor(name) {
    // 이름 해시 → 색(카테고리형). 흰 글자가 얹히므로 어두운 편의 DS 카테고리 토큰만 사용.
    const palette = ['var(--primary)', 'var(--cat-account)', 'var(--cat-policy)', 'var(--cat-payment)', 'var(--cat-tech)'];
    let h = 0;
    for (let i = 0; i < (name || '').length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
    return palette[h % palette.length];
}

export default function Stats({ activeBrandId, role }) {
    const [period, setPeriod] = useState('week');
    const [department, setDepartment] = useState(null); // null = 전체
    const [data, setData] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);

    useEffect(() => {
        let alive = true;
        setLoading(true);
        setError(null);
        fetchStats({ period, department })
            .then((d) => { if (alive) setData(d); })
            .catch((e) => { if (alive) setError(e.message || '통계를 불러오지 못했습니다.'); })
            .finally(() => { if (alive) setLoading(false); });
        return () => { alive = false; };
    }, [period, department, activeBrandId]);

    // 부서 카드: 전체(집계) + 각 부서. 전체는 departments 가중평균으로 합성.
    const cards = useMemo(() => {
        const depts = data?.departments || [];
        const totalCount = depts.reduce((a, d) => a + (d.count || 0), 0);
        const wAvg = totalCount > 0
            ? depts.reduce((a, d) => a + (d.avg || 0) * (d.count || 0), 0) / totalCount
            : null;
        const all = {
            key: null,
            label: '전체',
            avg: wAvg != null ? Number(wAvg.toFixed(1)) : null,
            count: totalCount,
            agent_count: depts.reduce((a, d) => a + (d.agent_count || 0), 0),
            coaching: depts.reduce((a, d) => a + (d.coaching || 0), 0),
        };
        return [all, ...depts.map((d) => ({ key: d.department, label: d.department, ...d }))];
    }, [data]);

    const kpi = data?.kpi || { avg: null, count: 0, agent_count: 0, coaching: 0, delta: null };
    const items = data?.items || [];
    const weak = data?.weak || [];
    const daily = data?.daily || [];
    const ranking = data?.ranking || [];
    const activeLabel = department || '전체';
    const dailyMax = Math.max(1, ...daily.map((d) => d.avg || 0));

    return (
        <div className="pb-10 w-full">
            <Header
                title="조직 평가 대시보드"
                subtitle="기간별 · 부서별 · 항목별 평가 결과를 비교 분석합니다."
                actions={
                    <div className="flex bg-[var(--muted)] rounded-lg p-0.5">
                        {SEG.map((s) => (
                            <button key={s.key} onClick={() => setPeriod(s.key)}
                                className={`px-3.5 py-1.5 text-[13px] font-semibold rounded-md transition-all ${
                                    period === s.key ? 'bg-white text-[var(--primary)] shadow-sm' : 'text-[var(--ink-500)]'}`}>
                                {s.label}
                            </button>
                        ))}
                    </div>
                }
            />

            {error && (
                <div className="bg-[var(--destructive-soft)] border border-[var(--destructive-soft)] text-[var(--destructive)] rounded-lg px-4 py-3 text-sm mb-6">{error}</div>
            )}
            {loading && !data && (
                <div className="flex flex-col items-center justify-center py-40 text-[var(--ink-500)]">
                    <div className="w-10 h-10 border-4 border-[var(--primary)]/20 border-t-[var(--primary)] rounded-full animate-spin" />
                    <p className="mt-4 font-semibold text-[13px]">통계 집계 중…</p>
                </div>
            )}

            {data && (
                <>
                    {data.anchor && (
                        <div className="text-[11.5px] text-[var(--ink-500)] mb-3">
                            기준일 {data.anchor} · 최근 {data.period_days}일 {department ? `· ${department}` : ''}
                        </div>
                    )}

                    {/* 부서 선택 카드 (필터 + 비교) */}
                    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3.5 mb-[22px]">
                        {cards.map((c) => {
                            const on = (department || null) === (c.key || null);
                            return (
                                <button key={c.label} onClick={() => setDepartment(c.key)}
                                    className={`text-left rounded-[14px] px-[18px] py-4 transition-all hover:-translate-y-0.5 hover:shadow-md ${
                                        on ? 'border border-[var(--primary)] bg-[var(--primary-soft-flat)] ring-[3px] ring-[var(--primary)]/25' : 'border border-[var(--border)] bg-white'}`}>
                                    <div className="flex items-center gap-1.5 mb-2.5">
                                        {c.key === null ? <Building2 size={14} className={on ? 'text-[var(--primary)]' : 'text-[var(--ink-400)]'} />
                                            : <Users size={14} className={on ? 'text-[var(--primary)]' : 'text-[var(--ink-400)]'} />}
                                        <span className={`text-[13.5px] font-bold ${on ? 'text-[var(--primary)]' : 'text-[var(--ink-900)]'}`}>{c.label}</span>
                                        <span className="text-[11px] text-[var(--ink-500)] ml-auto">{c.agent_count}명</span>
                                    </div>
                                    <div className="flex items-baseline gap-2">
                                        <TeamAvg value={c.avg} active={on} />
                                        <span className="text-[12px] text-[var(--ink-500)]">점</span>
                                    </div>
                                    <div className="text-[11.5px] text-[var(--ink-500)] mt-1">평가 {fmtNum(c.count)}건 · 코칭 {c.coaching}명</div>
                                </button>
                            );
                        })}
                    </div>

                    {/* KPI */}
                    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3.5 mb-[22px]">
                        <KpiCard accent icon={Award} label={`${activeLabel} 평균`}
                            value={kpi.avg ?? '–'} unit="점"
                            footNode={kpi.delta != null
                                ? <span className={`inline-flex items-center gap-1 text-[12px] font-semibold ${kpi.delta >= 0 ? 'text-[var(--primary)]' : 'text-[var(--destructive)]'}`}>
                                    {kpi.delta >= 0 ? <TrendingUp size={13} /> : <TrendingDown size={13} />}
                                    {kpi.delta >= 0 ? '+' : ''}{kpi.delta}점 vs 직전
                                  </span>
                                : <span className="text-[12px] text-[var(--ink-500)]">직전 비교 없음</span>} />
                        <KpiCard icon={ClipboardCheck} label="평가 완료" value={fmtNum(kpi.count)} unit="건"
                            foot="검수 대상 평가 콜" />
                        <KpiCard icon={Users} label="상담사" value={kpi.agent_count} unit="명"
                            foot="콜이 연결된 상담사 수" />
                        <KpiCard icon={AlertTriangle} label="코칭 대상" value={kpi.coaching} unit="명"
                            valueColor="text-[var(--destructive)]" foot="80점 미만 · 코칭 필요" />
                    </div>

                    {/* 항목별 평균 게이지 */}
                    <Panel title="항목별 평균 점수" sub={`${activeLabel} · ${items.length}개 평가항목`}
                        right={
                            <div className="flex items-center gap-2.5">
                                <span className="text-[11px] text-[var(--ink-500)]">낮음</span>
                                <div className="flex gap-[3px]">
                                    {PRIMARY_RAMP.map((c, i) => (
                                        <span key={i} className="w-4 h-2 rounded-sm" style={{ background: c }} />
                                    ))}
                                </div>
                                <span className="text-[11px] text-[var(--ink-500)]">높음</span>
                            </div>
                        }>
                        {items.length === 0 ? <Empty /> : (
                            <div className="grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-5 gap-3">
                                {items.map((d, i) => <GaugeCard key={`${d.order_no}-${d.item}`} dim={d} index={i} />)}
                            </div>
                        )}
                    </Panel>

                    {/* 일별 추이 + 개선 필요 항목 */}
                    <div className="grid grid-cols-1 lg:grid-cols-[1.6fr_1fr] gap-[22px] mb-[22px] items-start">
                        <Panel title="일별 평균 점수" sub={`최근 ${data.period_days}일 · ${activeLabel}`}
                            right={<div className="flex items-center gap-1.5"><span className="text-[22px] font-extrabold tracking-tight tabular-nums">{kpi.avg ?? '–'}</span><span className="text-[var(--ink-400)] text-[13px]">/ 100</span></div>}>
                            {daily.length === 0 ? <Empty /> : (
                                <div>
                                    <div className="flex items-end gap-2 h-[180px]">
                                        {daily.map((d, i) => {
                                            const s = blueFor(d.avg || 0);
                                            return (
                                                <div key={i} className="flex-1 flex flex-col items-center justify-end h-full" title={`${d.date}: ${d.avg} (${d.count}건)`}>
                                                    <span className="text-[10px] font-bold text-[var(--ink-700)] mb-1 tabular-nums">{Math.round(d.avg)}</span>
                                                    <div className="w-full rounded-t-md transition-all" style={{ height: `${Math.max(6, (d.avg / dailyMax) * 100)}%`, background: s.fill }} />
                                                </div>
                                            );
                                        })}
                                    </div>
                                    <div className="flex gap-2 mt-2">
                                        {daily.map((d, i) => (
                                            <span key={i} className="flex-1 text-center text-[10.5px] text-[var(--ink-500)] tabular-nums">
                                                {KO_DOW[new Date(d.date).getDay()]}
                                            </span>
                                        ))}
                                    </div>
                                </div>
                            )}
                        </Panel>

                        <Panel title="개선 필요 항목" sub="하위 5개">
                            {weak.length === 0 ? <Empty /> : (
                                <div className="grid gap-3">
                                    {weak.map((d) => {
                                        const s = blueFor(d.avg || 0);
                                        return (
                                            <div key={`${d.order_no}-${d.item}`}>
                                                <div className="flex justify-between mb-1.5">
                                                    <span className="text-[13px] text-[var(--ink-700)]">{d.item}</span>
                                                    <span className="text-[13px] font-bold tabular-nums" style={{ color: s.ink }}>{d.avg}</span>
                                                </div>
                                                <div className="h-2 rounded-full bg-[var(--muted)] overflow-hidden">
                                                    <div className="h-full rounded-full" style={{ width: `${d.avg}%`, background: s.fill }} />
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>
                            )}
                        </Panel>
                    </div>

                    {/* 상담사 랭킹 */}
                    <Panel title="상담사 랭킹" sub={`${activeLabel} · 점수 기준 정렬`}>
                        {ranking.length === 0 ? <Empty /> : (
                            <div className="overflow-x-auto">
                                <div className="grid items-center gap-2 px-1 py-2 text-[11px] font-semibold text-[var(--ink-500)] border-b border-[var(--muted)]"
                                     style={{ gridTemplateColumns: '40px 1.4fr 1fr 90px 110px' }}>
                                    <div>#</div><div>상담사</div><div>역할</div><div>건수</div><div>평균 점수</div>
                                </div>
                                {ranking.map((c, idx) => {
                                    const s = blueFor(c.avg || 0);
                                    return (
                                        <div key={`${c.agent_user_id ?? c.agent_code ?? 'none'}-${idx}`}
                                             className="grid items-center gap-2 px-1 py-2.5 border-b border-[var(--background)] hover:bg-[var(--primary)]/[0.03] transition-colors"
                                             style={{ gridTemplateColumns: '40px 1.4fr 1fr 90px 110px' }}>
                                            <div className={`font-bold tabular-nums text-[13px] ${idx < 3 ? 'text-[var(--primary)]' : 'text-[var(--ink-500)]'}`}>{idx + 1}</div>
                                            <div className="flex items-center gap-2.5 min-w-0">
                                                {c.unassigned
                                                    ? <span className="w-8 h-8 rounded-full bg-[var(--muted)] text-[var(--ink-500)] grid place-items-center text-[12px] font-bold shrink-0">?</span>
                                                    : <span className="w-8 h-8 rounded-full grid place-items-center text-white text-[12px] font-bold shrink-0" style={{ background: avatarColor(c.name) }}>{(c.name || '?').slice(0, 1)}</span>}
                                                <div className="min-w-0">
                                                    <div className={`text-[13.5px] font-semibold truncate ${c.unassigned ? 'text-[var(--ink-500)] italic' : 'text-[var(--ink-900)]'}`}>{c.name}</div>
                                                    {c.agent_code && <div className="text-[11px] text-[var(--ink-500)] tabular-nums truncate">{c.agent_code}</div>}
                                                </div>
                                            </div>
                                            <div className="text-[12px] text-[var(--ink-500)]">{roleLabel(c.role)}</div>
                                            <div className="text-[13px] tabular-nums text-[var(--ink-700)]">{fmtNum(c.count)}</div>
                                            <div className="flex items-center gap-2">
                                                <span className="text-[12px] font-bold tabular-nums px-2 py-0.5 rounded-md" style={{ background: s.track, color: s.ink }}>
                                                    {c.avg != null ? c.avg.toFixed(1) : '–'}
                                                </span>
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        )}
                    </Panel>
                </>
            )}
        </div>
    );
}

function roleLabel(role) {
    if (role === 'super_admin') return '슈퍼관리자';
    if (role === 'admin') return '관리자';
    if (role === 'agent') return '상담사';
    return '–';
}

function KpiCard({ icon: Icon, label, value, unit, foot, footNode, accent, valueColor }) {
    return (
        <div className={`bg-white rounded-xl border p-4 ${accent ? 'border-[var(--primary)]/30 bg-gradient-to-b from-[var(--primary)]/[0.03] to-transparent' : 'border-[var(--border)]'}`}>
            <span className="inline-flex items-center gap-1.5 text-[12px] font-semibold text-[var(--ink-500)]">
                <Icon size={13} className="text-[var(--ink-400)]" />{label}
            </span>
            <div className={`text-[30px] font-bold leading-none tracking-tight tabular-nums mt-2 ${valueColor || 'text-[var(--ink-900)]'}`}>
                {value}{unit && <span className="text-[14px] font-semibold text-[var(--ink-500)] ml-1">{unit}</span>}
            </div>
            <div className="mt-2 min-h-[18px]">{footNode || <span className="text-[12px] text-[var(--ink-500)]">{foot}</span>}</div>
        </div>
    );
}

function Panel({ title, sub, right, children }) {
    return (
        <div className="bg-white rounded-xl border border-[var(--border)] shadow-[0_1px_2px_rgba(16,24,40,0.04)] mb-[22px]">
            <div className="flex items-center px-5 py-3.5 border-b border-[var(--muted)]">
                <h3 className="text-[15px] font-bold text-[var(--ink-900)]">{title}</h3>
                {sub && <div className="text-[12px] text-[var(--ink-500)] ml-3">{sub}</div>}
                {right && <div className="ml-auto">{right}</div>}
            </div>
            <div className="p-5">{children}</div>
        </div>
    );
}

function Empty() {
    return (
        <div className="py-12 text-center text-[var(--ink-500)] text-[13px] flex flex-col items-center gap-2">
            <BarChart3 size={28} className="text-[var(--ink-300)]" />
            기간 내 데이터가 없습니다.
        </div>
    );
}
