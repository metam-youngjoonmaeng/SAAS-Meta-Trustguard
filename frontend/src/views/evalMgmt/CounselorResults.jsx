// 상담사 — 내 평가 결과 (디자인 프로토타입 etc/pages-counselor.jsx 포팅)
// 내 점수·추이, 감정·대화 품질, 배정된 코칭 플랜, 평가 이력
import React, { useState } from 'react';
import { Icon, Gauge, Spark, Heatmap, StatusPill, ScoreBreakdown, PageHead, PeriodPicker, Donut, defaultPeriod } from './ui';
import { EVAL_RESULTS, DIMENSIONS, DIM_GROUPS, COACHING_GROUPS, HEAT_DATA, scoreClass } from './mockData';

// 감정·대화 품질 카드 (부정비율 / 회복률 / 금칙어)
function QualityCard({ tone, icon, label, desc, ring, center, delta, footer, hero }) {
    const TONES = {
        primary: { color: 'var(--primary)', track: 'var(--primary-soft-flat)', soft: 'var(--primary-soft)', ink: 'var(--primary)' },
        warn: { color: '#e8a045', track: '#fde7cf', soft: '#fff3e0', ink: '#b27a14' },
        ok: { color: 'var(--ink-400)', track: 'var(--muted)', soft: 'var(--background-soft)', ink: 'var(--ink-500)' },
    };
    const c = TONES[tone];
    return (
        <div style={{ padding: hero ? '22px 24px' : '20px', border: hero ? `1px solid ${c.color}` : '1px solid var(--border)', borderRadius: 16, background: hero ? `linear-gradient(135deg, ${c.soft}, white 65%)` : 'white', boxShadow: hero ? '0 0 0 3px var(--primary-ring)' : 'none', display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
                <div style={{ width: 28, height: 28, borderRadius: 8, background: c.soft, color: c.color, display: 'grid', placeItems: 'center' }}>
                    <Icon name={icon} size={15} />
                </div>
                <span style={{ fontSize: 13.5, fontWeight: 700, color: 'var(--ink-900)' }}>{label}</span>
                {delta && (
                    <span className={`pill ${delta.good ? 'green' : delta.neutral ? 'gray' : 'red'}`} style={{ fontSize: 10.5, marginLeft: 'auto' }}>
                        <Icon name={delta.dir === 'up' ? 'arrow-up-right' : delta.dir === 'down' ? 'arrow-down-right' : 'minus'} size={10} />
                        {delta.text}
                    </span>
                )}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 18 }}>
                <Donut value={ring} color={c.color} track={c.track} size={hero ? 104 : 88} stroke={hero ? 10 : 8}>
                    <div>
                        <div className="mono" style={{ fontSize: hero ? 26 : 22, fontWeight: 800, color: 'var(--ink-900)', letterSpacing: '-0.02em', lineHeight: 1 }}>{center.main}</div>
                        {center.sub && <div style={{ fontSize: 10, fontWeight: 700, color: c.ink, marginTop: 3 }}>{center.sub}</div>}
                    </div>
                </Donut>
                <div style={{ flex: 1, minWidth: 0 }}>
                    <div className="muted-text" style={{ fontSize: 12, lineHeight: 1.5, marginBottom: footer ? 10 : 0 }}>{desc}</div>
                    {footer}
                </div>
            </div>
        </div>
    );
}

export default function CounselorResults() {
    const [selectedId, setSelectedId] = useState('EVAL-2026-0510');
    const [period, setPeriod] = useState(defaultPeriod('7d'));

    // 본인(김민서 — A20419) 평가만 필터
    const myEvals = EVAL_RESULTS.filter((r) => r.counselor === 'A20419');
    const selected = myEvals.find((r) => r.id === selectedId) || myEvals[0];

    const quality = {
        negative: { ratio: 11, delta: 3, total: 512, flagged: 56 },
        recovery: { rate: 82, delta: 6, recovered: 14, total: 17 },
        forbidden: { rate: 0.4, count: 2, total: 512, delta: 0 },
    };

    const dimColor = (g) => DIM_GROUPS.find((x) => x.key === g);
    const dimAverages = DIMENSIONS.map((d) => {
        const vals = myEvals.map((e) => e.scores[d.key] || 0);
        const avg = vals.length ? Math.round(vals.reduce((a, b) => a + b, 0) / vals.length) : 0;
        const g = dimColor(d.group);
        return { ...d, avg, groupColor: g.color, groupLabel: g.label };
    });
    const strengths = [...dimAverages].sort((a, b) => b.avg - a.avg).slice(0, 3);
    const weakness = [...dimAverages].sort((a, b) => a.avg - b.avg).slice(0, 2);

    const myTrend = [86, 88, 87, 91, 89, 92, 95];
    const myAvg = 91.2;

    // 배정된 코칭 플랜 — 코치가 본인(A20419)에게 배정한 것만
    const assignedCurricula = COACHING_GROUPS.filter((g) => g.assigned && g.members.includes('A20419'));

    return (
        <div>
            <PageHead eyebrow="상담원 · 내 평가 결과" title="안녕하세요, 김민서 님" sub="이번 주 평가 결과를 확인하고, 코칭 의견을 참고해 다음 상담에 적용해보세요.">
                <PeriodPicker value={period} onChange={setPeriod} />
            </PageHead>

            {/* Hero */}
            <div className="panel" style={{ marginBottom: 22, padding: 28, display: 'flex', alignItems: 'center', gap: 28, background: 'linear-gradient(135deg, #f2f6ff, white)' }}>
                <Gauge value={Math.round(myAvg)} label="이번주 평균" size={160} />
                <div style={{ flex: 1 }}>
                    <div className="eyebrow" style={{ marginBottom: 6 }}>This Week</div>
                    <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, marginBottom: 8 }}>
                        <span style={{ fontSize: 36, fontWeight: 800, letterSpacing: '-0.02em' }}>우수 등급</span>
                        <span className="pill blue">
                            <Icon name="trending-up" size={12} />+3.2점 vs 지난주
                        </span>
                    </div>
                    <div className="muted-text" style={{ fontSize: 13.5, marginBottom: 16, maxWidth: 520, lineHeight: 1.55 }}>
                        평가 {myEvals.length}건 모두 안정적이며, <strong style={{ color: 'var(--ink-700)' }}>{strengths[0].label}</strong>·<strong style={{ color: 'var(--ink-700)' }}>{strengths[1].label}</strong> 항목에서 우수한 일관성을 보이고 있습니다.
                    </div>
                    <div style={{ display: 'flex', gap: 24 }}>
                        <div>
                            <div className="muted-text" style={{ fontSize: 11.5 }}>최고 점수</div>
                            <div className="mono" style={{ fontSize: 22, fontWeight: 800, color: 'var(--ink-900)' }}>95</div>
                        </div>
                        <div>
                            <div className="muted-text" style={{ fontSize: 11.5 }}>팀 내 순위</div>
                            <div className="mono" style={{ fontSize: 22, fontWeight: 800 }}>1<span style={{ fontSize: 14, color: 'var(--ink-500)', fontWeight: 600, marginLeft: 2 }}>위 / 6명</span></div>
                        </div>
                        <div>
                            <div className="muted-text" style={{ fontSize: 11.5 }}>평가 받은 통화</div>
                            <div className="mono" style={{ fontSize: 22, fontWeight: 800 }}>4<span style={{ fontSize: 14, color: 'var(--ink-500)', fontWeight: 600, marginLeft: 2 }}>건</span></div>
                        </div>
                    </div>
                </div>
                <div style={{ width: 220 }}>
                    <div className="muted-text" style={{ fontSize: 11.5, marginBottom: 6 }}>최근 7일 추이</div>
                    <Spark data={myTrend} color="var(--primary)" height={80} />
                </div>
            </div>

            {/* 감정·대화 품질 */}
            <div className="panel" style={{ marginBottom: 22 }}>
                <div className="panel-head">
                    <h3>감정 · 대화 품질</h3>
                    <div className="sub" style={{ marginLeft: 12 }}>STT 발화 분석 기반 · 이번주</div>
                    <span className="pill blue" style={{ marginLeft: 'auto', fontSize: 10.5 }}>
                        <Icon name="audio-lines" size={10} />512개 발화 분석
                    </span>
                </div>
                <div className="panel-body">
                    <div className="grid" style={{ gridTemplateColumns: '1fr 1.25fr 1fr', gap: 14 }}>
                        <QualityCard
                            tone="warn"
                            icon="frown"
                            label="부정 발화 비율"
                            ring={quality.negative.ratio}
                            center={{ main: `${quality.negative.ratio}%` }}
                            delta={{ dir: 'down', text: `${quality.negative.delta}%p`, good: true }}
                            desc={<>전체 <strong style={{ color: 'var(--ink-700)' }}>{quality.negative.total}</strong>개 발화 중 <strong style={{ color: 'var(--ink-700)' }}>{quality.negative.flagged}</strong>건이 부정 감정으로 분류됐어요. 지난주보다 낮아졌습니다.</>}
                        />
                        <QualityCard
                            hero
                            tone="primary"
                            icon="heart-pulse"
                            label="회복률"
                            ring={quality.recovery.rate}
                            center={{ main: `${quality.recovery.rate}%`, sub: '회복 성공' }}
                            delta={{ dir: 'up', text: `${quality.recovery.delta}%p`, good: true }}
                            desc="부정 감정으로 시작한 고객을 중립·긍정으로 전환한 비율이에요. 까다로운 응대를 잘 이끌어가고 있습니다."
                            footer={
                                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                    <span className="pill gray" style={{ fontSize: 11, fontWeight: 700 }}>
                                        <Icon name="frown" size={10} />부정 시작 {quality.recovery.total}건
                                    </span>
                                    <Icon name="arrow-right" size={13} style={{ color: 'var(--ink-400)' }} />
                                    <span className="pill blue" style={{ fontSize: 11, fontWeight: 700 }}>
                                        <Icon name="smile" size={10} />회복 {quality.recovery.recovered}건
                                    </span>
                                </div>
                            }
                        />
                        <QualityCard
                            tone="ok"
                            icon="shield-check"
                            label="금칙어 언급률"
                            ring={100 - quality.forbidden.rate}
                            center={{ main: `${quality.forbidden.count}건`, sub: '양호' }}
                            delta={{ dir: 'flat', text: '변동 없음', neutral: true }}
                            desc={<>전체 발화 중 금칙어 언급은 <strong style={{ color: 'var(--ink-700)' }}>{quality.forbidden.rate}%</strong>({quality.forbidden.count}건)로, 사내 기준(1% 이하)을 충족합니다.</>}
                        />
                    </div>
                </div>
            </div>

            {/* 강점 · 개선 · 활동 */}
            <div className="grid" style={{ gridTemplateColumns: 'repeat(3, 1fr)', gap: 18, alignItems: 'stretch', marginBottom: 22 }}>
                <div className="panel">
                    <div className="panel-head">
                        <h3>나의 강점</h3>
                        <span className="pill blue" style={{ marginLeft: 'auto', fontSize: 10.5 }}>
                            <Icon name="trending-up" size={10} />상위 10%
                        </span>
                    </div>
                    <div className="panel-body" style={{ display: 'grid', gap: 16, alignContent: 'start' }}>
                        {strengths.map((s) => (
                            <div key={s.key}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 7 }}>
                                    <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink-900)' }}>{s.label}</span>
                                    <span className="muted-text" style={{ fontSize: 11 }}>{s.groupLabel}</span>
                                    <span className="mono" style={{ marginLeft: 'auto', fontSize: 14, fontWeight: 800, color: 'var(--primary)' }}>{s.avg}</span>
                                </div>
                                <div className="mini-bar">
                                    <div style={{ width: `${s.avg}%`, background: 'var(--primary)' }}></div>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>

                <div className="panel">
                    <div className="panel-head">
                        <h3>개선 포인트</h3>
                        <span className="pill" style={{ marginLeft: 'auto', fontSize: 10.5, background: '#fff3e0', color: '#b27a14' }}>
                            <Icon name="target" size={10} />이번달 목표
                        </span>
                    </div>
                    <div className="panel-body" style={{ display: 'grid', gap: 16, alignContent: 'start' }}>
                        {weakness.map((s) => {
                            const target = Math.min(100, s.avg + 6);
                            return (
                                <div key={s.key}>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 7 }}>
                                        <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink-900)' }}>{s.label}</span>
                                        <span className="muted-text" style={{ fontSize: 11 }}>현재 {s.avg} → 목표 {target}</span>
                                        <span className="mono" style={{ marginLeft: 'auto', fontSize: 14, fontWeight: 800, color: '#b27a14' }}>{s.avg}</span>
                                    </div>
                                    <div className="mini-bar">
                                        <div style={{ width: `${s.avg}%`, background: '#e8a045' }}></div>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                </div>

                <div className="panel">
                    <div className="panel-head">
                        <h3>이번 주 활동</h3>
                        <span className="muted-text mono" style={{ marginLeft: 'auto', fontSize: 11 }}>총 184건</span>
                    </div>
                    <div className="panel-body">
                        <Heatmap data={HEAT_DATA} />
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 12, fontSize: 11 }}>
                            <span className="muted-text">적음</span>
                            {[1, 2, 3, 4, 5].map((lv) => (
                                <div key={lv} className={`heat-cell lv${lv}`} style={{ width: 12, height: 12, aspectRatio: 'unset' }}></div>
                            ))}
                            <span className="muted-text">많음</span>
                        </div>
                    </div>
                </div>
            </div>

            {/* 최근 평가 */}
            <div className="panel" style={{ marginBottom: 22 }}>
                <div className="panel-head">
                    <h3>최근 평가</h3>
                    <span className="muted-text" style={{ marginLeft: 'auto' }}>{myEvals.length}건</span>
                </div>
                <div>
                    <div className="tbl-head" style={{ gridTemplateColumns: '120px 1.4fr 1.4fr 100px 90px', borderTop: 0 }}>
                        <div>날짜</div>
                        <div>상담 유형</div>
                        <div>코치 코멘트</div>
                        <div>길이</div>
                        <div>점수</div>
                    </div>
                    {myEvals.map((r) => (
                        <div key={r.id} className="tbl-row clickable" onClick={() => setSelectedId(r.id)} style={{ gridTemplateColumns: '120px 1.4fr 1.4fr 100px 90px', background: selected?.id === r.id ? 'var(--primary-soft)' : undefined }}>
                            <div>
                                <div style={{ fontSize: 13, fontWeight: 600 }}>{r.date.slice(5)}</div>
                                <div className="muted-text mono" style={{ fontSize: 11, marginTop: 2 }}>{r.time}</div>
                            </div>
                            <div>
                                <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink-900)' }}>{r.category}</div>
                                <div className="muted-text mono" style={{ fontSize: 11, marginTop: 2 }}>{r.sessionId}</div>
                            </div>
                            <div className="muted-text" style={{ fontSize: 12, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                {r.reviewer ? `${r.reviewer} 코치` : <span style={{ color: 'var(--ink-400)' }}>—</span>}
                            </div>
                            <div className="mono" style={{ fontSize: 12 }}>{r.duration}</div>
                            <div>
                                <span className={`score-chip ${scoreClass(r.score)}`}>{r.score}</span>
                            </div>
                        </div>
                    ))}
                </div>
            </div>

            {/* 선택 평가 상세 */}
            {selected && (
                <div className="panel" style={{ marginBottom: 22 }}>
                    <div className="panel-head">
                        <div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                                <span className="mono" style={{ fontSize: 11, color: 'var(--ink-400)', fontWeight: 700 }}>{selected.sessionId}</span>
                                <StatusPill status={selected.status} />
                            </div>
                            <h3>{selected.category} · {selected.date} {selected.time}</h3>
                        </div>
                        <div style={{ marginLeft: 'auto' }}>
                            <span className={`score-chip ${scoreClass(selected.score)}`} style={{ fontSize: 30 }}>
                                {selected.score}<span className="max">/100</span>
                            </span>
                        </div>
                    </div>
                    <div className="panel-body">
                        <ScoreBreakdown scores={selected.scores} dimensions={DIMENSIONS} />
                    </div>
                    {selected.reviewer && (
                        <div style={{ padding: '14px 20px 20px', borderTop: '1px solid var(--border)' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                                <Icon name="message-square-quote" size={14} style={{ color: 'var(--primary)' }} />
                                <span style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--ink-700)' }}>코치 코멘트</span>
                                <span className="muted-text">· {selected.reviewer}</span>
                            </div>
                            <div style={{ padding: '12px 14px', background: 'var(--background)', borderRadius: 10, fontSize: 13.5, color: 'var(--ink-700)', lineHeight: 1.55 }}>{selected.summary}</div>
                        </div>
                    )}
                </div>
            )}

            {/* 배정된 코칭 플랜 */}
            <div className="panel" style={{ marginTop: 22 }}>
                <div className="panel-head">
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <div style={{ width: 24, height: 24, borderRadius: 6, background: 'var(--primary-soft)', color: 'var(--primary)', display: 'grid', placeItems: 'center' }}>
                            <Icon name="graduation-cap" size={13} />
                        </div>
                        <h3>배정된 코칭 플랜</h3>
                        <span className="muted-text" style={{ fontSize: 12 }}>· 코치가 직접 지정한 학습 커리큘럼</span>
                    </div>
                    {assignedCurricula.length > 0 && (
                        <span className="pill blue" style={{ marginLeft: 'auto', fontSize: 10.5 }}>
                            <Icon name="inbox" size={10} />{assignedCurricula.length}건 배정됨
                        </span>
                    )}
                </div>
                <div className="panel-body">
                    {assignedCurricula.length === 0 ? (
                        <div style={{ padding: '40px 20px', textAlign: 'center' }}>
                            <div style={{ width: 48, height: 48, borderRadius: 14, background: 'var(--background)', border: '1px solid var(--border)', display: 'grid', placeItems: 'center', color: 'var(--ink-400)', margin: '0 auto 14px' }}>
                                <Icon name="inbox" size={20} />
                            </div>
                            <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--ink-900)', marginBottom: 6 }}>아직 배정된 코칭이 없습니다</div>
                            <div className="muted-text" style={{ fontSize: 12.5, lineHeight: 1.55, maxWidth: 360, margin: '0 auto' }}>코치가 평가 결과를 검토한 뒤 맞춤 학습 커리큘럼을 배정하면 이곳에 표시됩니다.</div>
                        </div>
                    ) : (
                        <div className="grid" style={{ gridTemplateColumns: '1fr 1fr', gap: 14 }}>
                            {assignedCurricula.map((g) => {
                                const high = g.priority === 'high';
                                const accent = high ? 'var(--primary)' : '#c67d12';
                                const soft = high ? 'var(--primary-soft)' : '#fdf2e3';
                                const inProgress = g.status === '진행 중';
                                return (
                                    <div key={g.key} style={{ border: '1px solid var(--border)', borderRadius: 14, padding: '18px 18px 16px', background: 'white', display: 'flex', flexDirection: 'column', borderTop: `3px solid ${accent}` }}>
                                        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, marginBottom: 12 }}>
                                            <div style={{ width: 40, height: 40, borderRadius: 11, background: soft, color: accent, display: 'grid', placeItems: 'center', flexShrink: 0 }}>
                                                <Icon name={g.icon} size={19} />
                                            </div>
                                            <div style={{ flex: 1, minWidth: 0 }}>
                                                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 3, flexWrap: 'wrap' }}>
                                                    <span style={{ fontSize: 14.5, fontWeight: 700, color: 'var(--ink-900)' }}>{g.title}</span>
                                                    <span className="pill" style={{ background: inProgress ? soft : 'var(--muted)', color: inProgress ? accent : 'var(--ink-500)', fontSize: 10, fontWeight: 700 }}>
                                                        <Icon name={inProgress ? 'loader' : 'inbox'} size={9} />{g.status}
                                                    </span>
                                                </div>
                                                <div className="muted-text" style={{ fontSize: 11.5 }}>
                                                    <Icon name="user" size={10} style={{ verticalAlign: '-1px', marginRight: 3 }} />
                                                    {g.assignedBy} 코치 배정 · {g.assignedAt}
                                                </div>
                                            </div>
                                        </div>

                                        <div style={{ display: 'grid', gap: 8, marginBottom: 16 }}>
                                            {g.items.map((it, i) => (
                                                <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 9 }}>
                                                    <div style={{ width: 18, height: 18, borderRadius: 5, border: `1.5px solid ${accent}`, color: accent, display: 'grid', placeItems: 'center', flexShrink: 0, marginTop: 1 }}>
                                                        <Icon name="check" size={11} />
                                                    </div>
                                                    <span style={{ fontSize: 12.5, color: 'var(--ink-700)', lineHeight: 1.45 }}>{it}</span>
                                                </div>
                                            ))}
                                        </div>

                                        <div style={{ marginTop: 'auto', display: 'flex', alignItems: 'center', gap: 10, paddingTop: 14, borderTop: '1px solid var(--border)' }}>
                                            <Icon name="sparkles" size={13} style={{ color: accent }} />
                                            <span style={{ fontSize: 12, color: 'var(--ink-500)' }}>Tutor 코스</span>
                                            <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--ink-900)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{g.tutor}</span>
                                            <button className="btn-mini primary" style={{ marginLeft: 'auto', flexShrink: 0 }}>
                                                <Icon name="play" size={11} />{inProgress ? '이어서 학습' : '학습 시작'}
                                            </button>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
