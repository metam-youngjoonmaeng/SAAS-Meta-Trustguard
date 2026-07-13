// 평가 상세 화면 — KCC QA 레이아웃 (디자인 프로토타입 etc/pages-eval-detail.jsx 포팅)
// 메타데이터 스트립 · 체크리스트 테이블 · 펜타곤 다이어그램 · 관리자 코멘트
import React, { useState } from 'react';
import { Icon } from './ui';
import { CHECKLIST_GROUPS, PENTAGON_AXES, PENTAGON_SERIES, DETAIL_META, STT_TRANSCRIPT } from './mockData';

const GOLD = { base: '#c8951b', fill: '#f4c451', tint: '#fdf6e3', border: '#ebd58a', ink: '#7d5a00' };

export default function EvalDetailView({ item, onBack }) {
    const [series, setSeries] = useState('agent');
    const [comment, setComment] = useState('');
    const [savedComment, setSavedComment] = useState('');
    const [sttOpen, setSttOpen] = useState(false);

    const [manualJudgments, setManualJudgments] = useState({
        open: { judgment: '동일', goldSet: true },
        verify: { judgment: '동일', goldSet: true },
        close: { judgment: '동일', goldSet: false },
        voice: { judgment: '동일', goldSet: true },
        lang: { judgment: '동일', goldSet: false },
        rapport: { judgment: '낮음', goldSet: false },
        recover: { judgment: '높음', goldSet: false },
        'biz-acc': { judgment: '동일', goldSet: false },
        after: { judgment: '낮음', goldSet: false },
    });
    const setJudgment = (key, judgment) =>
        setManualJudgments((prev) => ({
            ...prev,
            [key]: { judgment, goldSet: judgment === '동일' ? prev[key]?.goldSet ?? false : false },
        }));
    const setGoldSet = (key, goldSet) =>
        setManualJudgments((prev) => ({
            ...prev,
            [key]: { ...(prev[key] || { judgment: '동일' }), goldSet },
        }));

    const counts = Object.values(manualJudgments).reduce(
        (acc, v) => {
            acc[v.judgment] = (acc[v.judgment] || 0) + 1;
            if (v.judgment === '동일' && v.goldSet) acc.gold = (acc.gold || 0) + 1;
            return acc;
        },
        { 동일: 0, 높음: 0, 낮음: 0, gold: 0 },
    );

    const flatRows = [];
    CHECKLIST_GROUPS.forEach((g) => {
        g.items.forEach((it, i) => {
            flatRows.push({ ...it, groupLabel: g.label, groupKey: g.key, isFirstInGroup: i === 0, groupSize: g.items.length });
        });
    });

    // 실제 선택된 평가 항목의 일부 메타데이터를 헤더에 반영
    const meta = item
        ? { ...DETAIL_META, callId: item.sessionId, agentName: item.name, agentId: item.counselor, team: item.team, datetime: `${item.date} ${item.time}`, duration: item.duration, aiScore: item.score }
        : DETAIL_META;

    return (
        <div className="kqa-detail">
            {/* Breadcrumb */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14, color: 'var(--ink-500)', fontSize: 13 }}>
                <button
                    onClick={onBack}
                    style={{ background: 'transparent', border: 0, color: 'var(--ink-500)', fontFamily: 'inherit', fontSize: 13, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 4 }}
                >
                    <Icon name="chevron-left" size={13} />목록
                </button>
                <span>·</span>
                <span>상담사 | 상담번호:</span>
                <span className="mono" style={{ color: 'var(--ink-700)', fontWeight: 600 }}>{meta.callId}</span>
            </div>

            <MetaTable meta={meta} />

            <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 360px', gap: 18, marginTop: 18, alignItems: 'start' }}>
                {/* Left — checklist */}
                <div className="panel">
                    <div style={{ display: 'flex', alignItems: 'center', padding: '16px 20px', borderBottom: '1px solid var(--border)' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, whiteSpace: 'nowrap' }}>
                            <Icon name="list-checks" size={15} style={{ color: 'var(--ink-500)' }} />
                            <span style={{ fontSize: 14.5, fontWeight: 700, color: 'var(--ink-900)' }}>상세 체크리스트</span>
                        </div>
                        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8, marginLeft: 14 }}>
                            {counts.gold > 0 && (
                                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '4px 10px', height: 24, borderRadius: 9999, background: '#fdf6e3', color: '#7d5a00', fontSize: 11.5, fontWeight: 700, border: '1px solid #ebd58a', whiteSpace: 'nowrap' }}>
                                    <Icon name="star" size={11} style={{ fill: '#f4c451', color: '#c8951b' }} />
                                    골드셋 {counts.gold}
                                </span>
                            )}
                        </div>
                        <button className={`btn-mini ${sttOpen ? 'primary' : ''}`} style={{ marginLeft: 'auto' }} onClick={() => setSttOpen(!sttOpen)}>
                            <Icon name="message-square" size={11} />STT 전사
                        </button>
                    </div>
                    <ChecklistTable rows={flatRows} manualJudgments={manualJudgments} setJudgment={setJudgment} setGoldSet={setGoldSet} />
                </div>

                {/* Right — STT OR Pentagon + comment */}
                <div className="col-flex">
                    {sttOpen ? (
                        <SttPanel onClose={() => setSttOpen(false)} />
                    ) : (
                        <>
                            <PentagonCard series={series} setSeries={setSeries} />
                            <CommentCard
                                value={comment}
                                onChange={setComment}
                                saved={savedComment}
                                onSave={() => setSavedComment(comment)}
                                onDelete={() => {
                                    setSavedComment('');
                                    setComment('');
                                }}
                            />
                        </>
                    )}
                </div>
            </div>
        </div>
    );
}

function MetaTable({ meta }) {
    const cols = [
        { label: 'UID', value: meta.uid, mono: true, w: 1.4 },
        { label: '상담번호', value: meta.callId, mono: true, w: 1.5 },
        { label: '상담일시', value: meta.datetime, mono: true, w: 1.4 },
        { label: '상담시간', value: meta.duration, w: 0.8 },
        { label: '부서', value: meta.team, w: 1 },
        { label: '직무', value: meta.job, w: 0.8 },
        { label: '상담사ID', value: meta.agentId, w: 0.7 },
        { label: '상담사명', value: meta.agentName, w: 0.7 },
        { label: '고객번호', value: meta.custId, w: 0.7 },
        { label: '고객등급', value: meta.custGrade, w: 0.7 },
        { label: 'AI평가', value: meta.aiScore, strong: true, w: 0.6 },
        { label: '수기', value: meta.manualEdited ? 'Y' : 'N', strong: true, color: meta.manualEdited ? 'var(--primary)' : 'var(--ink-500)', w: 0.5 },
    ];
    const tpl = cols.map((c) => `${c.w}fr`).join(' ');
    return (
        <div style={{ border: '1px solid var(--border)', borderRadius: 12, overflow: 'hidden', background: 'white' }}>
            <div style={{ display: 'grid', gridTemplateColumns: tpl, background: 'var(--background-soft)', borderBottom: '1px solid var(--border)' }}>
                {cols.map((c, i) => (
                    <div key={i} style={{ padding: '10px 10px', fontSize: 11.5, fontWeight: 700, color: 'var(--ink-500)', textAlign: 'center', borderRight: i < cols.length - 1 ? '1px solid var(--border)' : 'none', letterSpacing: '0.02em', whiteSpace: 'nowrap' }}>
                        {c.label}
                    </div>
                ))}
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: tpl }}>
                {cols.map((c, i) => (
                    <div key={i} style={{ padding: '14px 8px', fontSize: 12.5, fontWeight: c.strong ? 800 : 600, color: c.color || 'var(--ink-900)', textAlign: 'center', borderRight: i < cols.length - 1 ? '1px solid var(--border)' : 'none', fontFamily: c.mono ? 'var(--font-mono)' : 'var(--font-sans)', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title={String(c.value)}>
                        {c.value}
                    </div>
                ))}
            </div>
        </div>
    );
}

function ChecklistTable({ rows, manualJudgments, setJudgment, setGoldSet }) {
    const colTemplate = '56px 96px 1.5fr 1.7fr 64px 148px 64px 64px';
    const headers = ['구분', '평가항목', '평가 이유', '평가 발화', 'AI평가', '수기평가', '당월평균', '직무평균'];

    return (
        <div>
            <div style={{ display: 'grid', gridTemplateColumns: colTemplate, background: 'var(--background-soft)', borderBottom: '1px solid var(--border)', padding: '11px 0' }}>
                {headers.map((h, i) => (
                    <div key={i} style={{ padding: '0 12px', fontSize: 11.5, fontWeight: 700, color: 'var(--ink-500)', textAlign: i >= 4 ? 'center' : 'left', letterSpacing: '0.02em', whiteSpace: 'nowrap' }}>
                        {h}
                    </div>
                ))}
            </div>

            {rows.map((r, idx) => {
                const isNewGroup = r.isFirstInGroup;
                const isLastInGroup = idx === rows.length - 1 || rows[idx + 1]?.groupKey !== r.groupKey;
                const j = manualJudgments[r.key] || { judgment: '동일', goldSet: false };
                const isGold = j.judgment === '동일' && j.goldSet;

                return (
                    <div key={r.key} style={{ position: 'relative', display: 'grid', gridTemplateColumns: colTemplate, borderTop: isNewGroup && idx > 0 ? '1px solid var(--border)' : 'none', borderBottom: isLastInGroup ? '1px solid var(--border)' : '1px dashed var(--border)', alignItems: 'center', padding: '18px 0', minHeight: 68, transition: 'background var(--t-base)' }}>
                        {isGold && <span aria-hidden="true" style={{ position: 'absolute', left: 0, top: -1, bottom: -1, width: 3, background: '#c8951b', borderRadius: '0 2px 2px 0' }}></span>}
                        <div style={{ padding: '0 12px', fontSize: 13, fontWeight: 700, color: 'var(--ink-900)' }}>{isNewGroup ? r.groupLabel : ''}</div>
                        <div style={{ padding: '0 12px', fontSize: 13, fontWeight: 600, color: 'var(--ink-900)' }}>{r.label}</div>
                        <div style={{ padding: '0 12px', fontSize: 12.5, color: 'var(--ink-700)', lineHeight: 1.55 }}>{r.reason}</div>
                        <div style={{ padding: '0 12px', fontSize: 12.5, color: 'var(--ink-500)', lineHeight: 1.55, fontStyle: 'italic' }}>{r.utter}</div>
                        <div style={{ padding: '0 12px', textAlign: 'center' }}>
                            <span className="mono" style={{ fontSize: 13.5, fontWeight: 700, color: 'var(--ink-900)' }}>{r.ai}</span>
                        </div>
                        <div style={{ padding: '0 12px' }}>
                            <ManualJudgment judgment={j.judgment} goldSet={j.goldSet} onJudgment={(v) => setJudgment(r.key, v)} onGoldSet={(v) => setGoldSet(r.key, v)} />
                        </div>
                        <div style={{ padding: '0 12px', textAlign: 'center' }}>
                            <span className="mono" style={{ fontSize: 13, color: 'var(--ink-500)' }}>{r.monthAvg}%</span>
                        </div>
                        <div style={{ padding: '0 12px', textAlign: 'center' }}>
                            <span className="mono" style={{ fontSize: 13, color: 'var(--ink-500)' }}>{r.jobAvg}%</span>
                        </div>
                    </div>
                );
            })}
        </div>
    );
}

function ManualJudgment({ judgment, goldSet, onJudgment, onGoldSet }) {
    const STOPS = ['낮음', '동일', '높음'];
    const activeIndex = STOPS.indexOf(judgment);

    return (
        <div style={{ width: '100%', userSelect: 'none' }}>
            <div style={{ position: 'relative', height: 38, padding: '0 4px' }}>
                <div style={{ position: 'absolute', top: 0, left: 4, right: 4, display: 'flex', justifyContent: 'space-between' }}>
                    {STOPS.map((s, i) => {
                        const on = activeIndex === i;
                        return (
                            <button key={s} onClick={() => onJudgment(s)} style={{ background: 'transparent', border: 'none', padding: '0 2px', cursor: 'pointer', fontFamily: 'inherit', fontSize: 11, fontWeight: on ? 700 : 500, color: on ? 'var(--primary)' : 'var(--ink-500)', letterSpacing: '0.01em', transition: 'color var(--t-base)' }}>
                                {s}
                            </button>
                        );
                    })}
                </div>
                <div style={{ position: 'absolute', left: 12, right: 12, top: 28, height: 2, background: 'var(--border)', borderRadius: 1 }}></div>
                <div style={{ position: 'absolute', left: 4, right: 4, top: 22, display: 'flex', justifyContent: 'space-between' }}>
                    {STOPS.map((s, i) => {
                        const on = activeIndex === i;
                        return (
                            <button
                                key={s}
                                onClick={() => onJudgment(s)}
                                title={`AI평가보다 ${s === '동일' ? '동일하게' : s + '게'} 평가`}
                                style={{ width: on ? 14 : 10, height: on ? 14 : 10, borderRadius: '50%', background: on ? 'var(--primary)' : 'white', border: on ? '2px solid white' : '1.5px solid var(--border-strong)', boxShadow: on ? '0 0 0 1.5px var(--primary), 0 0 0 4px var(--primary-ring)' : 'none', cursor: 'pointer', padding: 0, transition: 'all var(--t-base)', outline: 'none' }}
                                onMouseEnter={(e) => {
                                    if (!on) {
                                        e.currentTarget.style.borderColor = 'var(--primary)';
                                        e.currentTarget.style.transform = 'scale(1.2)';
                                    }
                                }}
                                onMouseLeave={(e) => {
                                    if (!on) {
                                        e.currentTarget.style.borderColor = 'var(--border-strong)';
                                        e.currentTarget.style.transform = 'scale(1)';
                                    }
                                }}
                            ></button>
                        );
                    })}
                </div>
            </div>

            <div style={{ minHeight: 22, display: 'flex', justifyContent: 'center', marginTop: 2 }}>
                {judgment === '동일' && (
                    <button
                        onClick={() => onGoldSet(!goldSet)}
                        title={goldSet ? '골드셋에서 제외' : '골드셋으로 등록'}
                        style={{ background: 'transparent', border: 'none', padding: '2px 6px', cursor: 'pointer', fontFamily: 'inherit', fontSize: 11, fontWeight: goldSet ? 700 : 600, color: goldSet ? GOLD.ink : 'var(--ink-500)', display: 'inline-flex', alignItems: 'center', gap: 4, whiteSpace: 'nowrap', letterSpacing: '0.01em', transition: 'color var(--t-base)' }}
                        onMouseEnter={(e) => {
                            if (!goldSet) e.currentTarget.style.color = 'var(--ink-700)';
                        }}
                        onMouseLeave={(e) => {
                            if (!goldSet) e.currentTarget.style.color = 'var(--ink-500)';
                        }}
                    >
                        <Icon name="star" size={11} style={{ fill: goldSet ? GOLD.fill : 'transparent', color: goldSet ? GOLD.base : 'var(--ink-400)', transition: 'fill var(--t-base), color var(--t-base)' }} />
                        {goldSet ? '골드셋' : '골드셋 등록'}
                    </button>
                )}
            </div>
        </div>
    );
}

function PentagonCard({ series, setSeries }) {
    return (
        <div className="panel">
            <div style={{ padding: '16px 20px', display: 'flex', alignItems: 'center', gap: 8, borderBottom: '1px solid var(--border)', whiteSpace: 'nowrap' }}>
                <Icon name="bar-chart-2" size={15} style={{ color: 'var(--ink-500)' }} />
                <span style={{ fontSize: 14.5, fontWeight: 700, color: 'var(--ink-900)' }}>Pentagon Diagram</span>
            </div>
            <div style={{ padding: '28px 16px 16px' }}>
                <PentagonChart activeSeries={series} />
            </div>
            <div style={{ display: 'flex', justifyContent: 'center', gap: 6, padding: '0 20px 18px', flexWrap: 'wrap' }}>
                {[
                    { k: 'all', label: '전체평균', color: 'var(--ink-500)', style: 'outline' },
                    { k: 'job', label: '직무평균', color: 'var(--cat-account)', style: 'outline-blue' },
                    { k: 'agent', label: '상담사', color: 'var(--cat-account)', style: 'solid' },
                ].map((s) => {
                    const on = series === s.k;
                    return (
                        <button
                            key={s.k}
                            onClick={() => setSeries(s.k)}
                            style={{ padding: '6px 12px', height: 30, borderRadius: 9999, border: s.style === 'outline' ? '1.5px solid var(--border-strong)' : s.style === 'outline-blue' ? '1.5px dashed var(--cat-account)' : '1.5px solid var(--cat-account)', background: on ? (s.style === 'solid' ? 'var(--cat-account)' : s.style === 'outline-blue' ? 'var(--background)' : 'var(--background-soft)') : 'white', color: on ? (s.style === 'solid' ? 'white' : 'var(--cat-account)') : 'var(--ink-500)', fontFamily: 'inherit', fontSize: 11.5, fontWeight: 600, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 5, transition: 'all var(--t-base)', whiteSpace: 'nowrap' }}
                        >
                            <span style={{ width: 7, height: 7, borderRadius: '50%', background: s.style === 'solid' ? (on ? 'white' : 'var(--cat-account)') : s.style === 'outline-blue' ? 'var(--cat-account)' : 'transparent', border: s.style === 'outline' ? '1.5px solid var(--ink-400)' : 'none' }}></span>
                            <span>{s.label}</span>
                        </button>
                    );
                })}
            </div>
        </div>
    );
}

function PentagonChart({ activeSeries }) {
    const size = 360;
    const cx = size / 2;
    const cy = size / 2 + 6;
    const radius = 118;
    const axes = PENTAGON_AXES.length;
    const angle = (i) => -Math.PI / 2 + i * ((2 * Math.PI) / axes);

    const point = (val, i, r = radius) => {
        const v = val / 100;
        const a = angle(i);
        return [cx + Math.cos(a) * r * v, cy + Math.sin(a) * r * v];
    };

    const rings = [0.2, 0.4, 0.6, 0.8, 1.0];

    return (
        <svg width="100%" viewBox={`-30 -16 ${size + 70} ${size + 60}`} style={{ display: 'block', overflow: 'visible' }}>
            {rings.map((rPct, ri) => (
                <polygon key={ri} points={PENTAGON_AXES.map((_, i) => point(100 * rPct, i).join(',')).join(' ')} fill={ri === rings.length - 1 ? 'rgba(238, 242, 250, 0.4)' : 'none'} stroke="var(--border)" strokeWidth="1" />
            ))}
            {PENTAGON_AXES.map((_, i) => {
                const [x, y] = point(100, i);
                return <line key={i} x1={cx} y1={cy} x2={x} y2={y} stroke="var(--border)" strokeWidth="1" />;
            })}

            {activeSeries !== 'job' && (
                <polygon points={PENTAGON_SERIES.job.map((v, i) => point(v, i).join(',')).join(' ')} fill="rgba(58, 114, 226, 0.06)" stroke="var(--cat-account)" strokeWidth="1.5" strokeDasharray="4 3" strokeLinejoin="round" opacity="0.55" />
            )}

            {activeSeries === 'all' && (
                <polygon points={PENTAGON_SERIES.all.map((v, i) => point(v, i).join(',')).join(' ')} fill="rgba(28, 36, 64, 0.08)" stroke="var(--ink-700)" strokeWidth="2" strokeLinejoin="round" />
            )}
            {activeSeries === 'job' && (
                <polygon points={PENTAGON_SERIES.job.map((v, i) => point(v, i).join(',')).join(' ')} fill="rgba(58, 114, 226, 0.16)" stroke="var(--cat-account)" strokeWidth="2" strokeDasharray="6 4" strokeLinejoin="round" />
            )}
            {activeSeries === 'agent' && (
                <>
                    <polygon points={PENTAGON_SERIES.agent.map((v, i) => point(v, i).join(',')).join(' ')} fill="rgba(58, 114, 226, 0.18)" stroke="var(--cat-account)" strokeWidth="2" strokeLinejoin="round" />
                    {PENTAGON_SERIES.agent.map((v, i) => {
                        const [x, y] = point(v, i);
                        return <circle key={i} cx={x} cy={y} r="3.5" fill="var(--cat-account)" stroke="white" strokeWidth="1.5" />;
                    })}
                </>
            )}

            {PENTAGON_AXES.map((ax, i) => {
                const [x, y] = point(100, i, radius + 22);
                const a = angle(i);
                let anchor = 'middle';
                if (Math.cos(a) > 0.3) anchor = 'start';
                else if (Math.cos(a) < -0.3) anchor = 'end';
                return (
                    <text key={ax.key} x={x} y={y} fill="var(--ink-700)" fontSize="14" fontWeight="700" textAnchor={anchor} dominantBaseline="middle" style={{ fontFamily: 'var(--font-sans)' }}>
                        {ax.label}
                    </text>
                );
            })}
        </svg>
    );
}

function CommentCard({ value, onChange, saved, onSave, onDelete }) {
    return (
        <div className="panel">
            <div style={{ padding: '16px 20px', display: 'flex', alignItems: 'center', gap: 8, borderBottom: '1px solid var(--border)', whiteSpace: 'nowrap' }}>
                <Icon name="message-square" size={15} style={{ color: 'var(--ink-500)' }} />
                <span style={{ fontSize: 14.5, fontWeight: 700, color: 'var(--ink-900)' }}>관리자 코멘트</span>
            </div>
            <div style={{ padding: '20px' }}>
                {saved ? (
                    <div style={{ padding: '12px 14px', background: 'var(--background)', borderRadius: 10, fontSize: 13, color: 'var(--ink-700)', lineHeight: 1.55, marginBottom: 14 }}>{saved}</div>
                ) : (
                    <div style={{ padding: '60px 12px', textAlign: 'center', color: 'var(--ink-500)', fontSize: 13 }}>등록된 코멘트가 없습니다.</div>
                )}

                <textarea
                    value={value}
                    onChange={(e) => onChange(e.target.value)}
                    placeholder="상담사 코칭을 위한 코멘트를 입력하세요..."
                    rows="4"
                    style={{ width: '100%', padding: '12px 14px', border: '1px solid var(--border)', borderRadius: 10, fontSize: 13, lineHeight: 1.55, fontFamily: 'var(--font-sans)', resize: 'vertical', outline: 'none', background: 'white', transition: 'border-color var(--t-base), box-shadow var(--t-base)' }}
                    onFocus={(e) => {
                        e.target.style.borderColor = 'var(--primary)';
                        e.target.style.boxShadow = '0 0 0 3px var(--primary-ring)';
                    }}
                    onBlur={(e) => {
                        e.target.style.borderColor = 'var(--border)';
                        e.target.style.boxShadow = 'none';
                    }}
                />

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8, marginTop: 12 }}>
                    <button onClick={onSave} style={{ height: 38, borderRadius: 9, background: 'white', border: '1px solid var(--border)', color: 'var(--ink-900)', fontWeight: 600, fontSize: 13, fontFamily: 'inherit', cursor: 'pointer' }}>저장</button>
                    <button onClick={onSave} disabled={!saved} style={{ height: 38, borderRadius: 9, background: 'white', border: '1px solid var(--border)', color: saved ? 'var(--ink-900)' : 'var(--ink-400)', fontWeight: 600, fontSize: 13, fontFamily: 'inherit', cursor: saved ? 'pointer' : 'not-allowed' }}>수정</button>
                    <button onClick={onDelete} disabled={!saved} style={{ height: 38, borderRadius: 9, background: 'white', border: '1px solid var(--border)', color: saved ? 'var(--destructive)' : 'var(--ink-400)', fontWeight: 600, fontSize: 13, fontFamily: 'inherit', cursor: saved ? 'pointer' : 'not-allowed' }}>삭제</button>
                </div>
            </div>
        </div>
    );
}

function SttPanel({ onClose }) {
    return (
        <div className="panel" style={{ position: 'sticky', top: 18 }}>
            <div style={{ padding: '16px 20px', display: 'flex', alignItems: 'center', gap: 8, borderBottom: '1px solid var(--border)' }}>
                <Icon name="message-square" size={15} style={{ color: 'var(--ink-500)' }} />
                <span style={{ fontSize: 14.5, fontWeight: 700, color: 'var(--ink-900)' }}>STT 전사</span>
                <span className="muted-text mono" style={{ marginLeft: 8, fontSize: 11 }}>{STT_TRANSCRIPT.length}턴</span>
                <button className="icon-btn" style={{ width: 28, height: 28, marginLeft: 'auto' }} onClick={onClose}>
                    <Icon name="x" size={13} />
                </button>
            </div>

            <div style={{ padding: '18px 20px', maxHeight: 'calc(100vh - 220px)', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 14 }}>
                {STT_TRANSCRIPT.map((t, i) => (
                    <SttBubble key={i} {...t} />
                ))}
            </div>

            <div style={{ padding: '12px 20px', borderTop: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 8, background: 'var(--background-soft)' }}>
                <button className="btn-mini" style={{ height: 28 }}>
                    <Icon name="play" size={11} />음성 재생
                </button>
                <button className="btn-mini" style={{ height: 28 }}>
                    <Icon name="copy" size={11} />복사
                </button>
                <button className="btn-mini" style={{ height: 28, marginLeft: 'auto' }}>
                    <Icon name="download" size={11} />다운로드
                </button>
            </div>
        </div>
    );
}

function SttBubble({ who, time, text }) {
    const isAgent = who === '상담사';
    return (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: isAgent ? 'flex-start' : 'flex-end' }}>
            <div style={{ fontSize: 11, color: 'var(--ink-500)', fontWeight: 600, marginBottom: 4, padding: '0 4px', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                <span>{who}</span>
                <span style={{ color: 'var(--ink-300)' }}>·</span>
                <span className="mono" style={{ fontSize: 10.5, color: 'var(--ink-500)' }}>{time}</span>
            </div>
            <div style={{ maxWidth: '85%', padding: '10px 14px', borderRadius: isAgent ? '14px 14px 14px 4px' : '14px 14px 4px 14px', background: isAgent ? 'var(--background)' : 'var(--cat-account)', color: isAgent ? 'var(--ink-900)' : 'white', fontSize: 13, lineHeight: 1.5, border: isAgent ? '1px solid var(--border)' : 'none', wordBreak: 'keep-all', overflowWrap: 'break-word' }}>
                {text}
            </div>
        </div>
    );
}
