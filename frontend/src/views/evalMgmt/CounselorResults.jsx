// 상담사 — 내 평가 결과
// 실연동: 내 콜 평가 목록·점수·추이(/api/calls), 항목별 점수(/api/evaluations/:qaId),
//         강점·개선(항목 평균), 배정된 코칭(/api/coaching/mine).
//         감정·대화 품질(/api/me/ta-metrics): 부정발화·금칙어=03 tb_ta_rslt, 회복률=05 qa_call_recovery. (미연동 시 mock 폴백)
import React, { useState, useEffect, useMemo } from 'react';
import { Icon, Gauge, ChannelChip, ColumnFilter, PageHead, PeriodPicker, Donut, Modal, defaultPeriod, openInWindow, openCallDetail } from './ui';
import { scoreClass, TUTOR_SCENARIOS } from './mockData';
import { fetchCalls, fetchEvaluations, fetchMyCoaching, fetchMyTaMetrics, fetchMyTaMetricCalls, archiveMyCoaching, QA_ACTOR_STORAGE_KEY } from '../../services/api';
import { parseMaxPointsFromValidationTime } from '../../utils/rubricScore';
import { buildTutorLink } from '../../utils/coachingTutorLink';
import { ReviewStatusBadge } from '../../components';

// 회복률 코멘트 기준: 이 값(%) 이상이면 칭찬, 미만이면 분발 멘트. (운영 중 조절 가능)
const RECOVERY_PRAISE_MIN = 30;

// 본인 기준 전 시나리오 완료 여부(정렬·X 노출용).
function coachingAllDone(g) {
    const sc = Array.isArray(g.scenarios) ? g.scenarios : [];
    const done = Array.isArray(g.completed) ? g.completed : [];
    return sc.length > 0 && sc.every((c) => done.includes(c));
}

// 배정 코칭 — 관리자(AdminEvalMgmt)와 동일한 가로 캐러셀(3개씩, 좌우 화살표). 컴팩트 카드로 공간 절약.
function CoachingCarousel({ items, onArchive }) {
    const ref = React.useRef(null);
    const [atStart, setAtStart] = useState(true);
    const [atEnd, setAtEnd] = useState(false);
    const update = () => {
        const el = ref.current;
        if (!el) return;
        setAtStart(el.scrollLeft <= 2);
        setAtEnd(el.scrollLeft + el.clientWidth >= el.scrollWidth - 2);
    };
    React.useEffect(() => { update(); }, [items.length]);
    const page = (dir) => {
        const el = ref.current;
        if (!el) return;
        el.scrollBy({ left: dir * el.clientWidth * 0.92, behavior: 'smooth' });
        setTimeout(update, 320);
    };
    const canScroll = items.length > 3;
    const sideBtn = (dir, disabled) => (
        <button
            onClick={() => page(dir)}
            disabled={disabled}
            aria-label={dir < 0 ? '이전' : '다음'}
            style={{ flexShrink: 0, alignSelf: 'center', width: 32, height: 32, borderRadius: '50%', display: 'grid', placeItems: 'center', background: 'white', border: '1px solid var(--border)', boxShadow: 'var(--shadow-sm)', color: disabled ? 'var(--ink-300)' : 'var(--ink-700)', cursor: disabled ? 'default' : 'pointer', opacity: disabled ? 0.5 : 1 }}
        >
            <Icon name={dir < 0 ? 'chevron-left' : 'chevron-right'} size={16} />
        </button>
    );
    return (
        <div style={{ minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'stretch', gap: 10, minWidth: 0 }}>
                {canScroll && sideBtn(-1, atStart)}
                <div ref={ref} className="no-scrollbar" onScroll={update} style={{ flex: 1, minWidth: 0, display: 'flex', gap: 12, overflowX: canScroll ? 'auto' : 'visible', scrollSnapType: 'x mandatory', paddingBottom: 2 }}>
                    {items.map((g) => (
                        <div key={g.key} style={{ flex: '0 0 calc((100% - 24px) / 3)', minWidth: 0, scrollSnapAlign: 'start' }}>
                            <CounselorCoachingCard g={g} onArchive={onArchive} />
                        </div>
                    ))}
                </div>
                {canScroll && sideBtn(1, atEnd)}
            </div>
        </div>
    );
}

// 상담사용 컴팩트 코칭 카드 — 진행률 + 시나리오(2줄, 외 N건) + 학습 시작. 액션아이템 체크리스트는 공간상 제외(상세는 코칭 이력).
function CounselorCoachingCard({ g, onArchive }) {
    const high = g.priority === 'high';
    const accent = high ? 'var(--primary)' : '#c67d12';
    const soft = high ? 'var(--primary-soft)' : '#fdf2e3';
    const isChat = g.channel === 'chat';
    const myDone = Array.isArray(g.completed) ? g.completed : [];
    const scenarios = Array.isArray(g.scenarios) ? g.scenarios : [];
    const totalScen = scenarios.length;
    const doneCount = scenarios.filter((c) => myDone.includes(c)).length;
    const allDone = totalScen > 0 && doneCount === totalScen;
    const started = doneCount > 0;
    const pct = totalScen ? Math.round((doneCount / totalScen) * 100) : 0;
    const tutorLink = buildTutorLink(g);
    const startLearning = () => {
        if (!tutorLink) { alert('튜터 학습 앱 주소가 설정되지 않았습니다. 관리자에게 문의하세요.'); return; }
        // 새 탭/팝업 대신 현재 탭에서 튜터로 이동(외부 새 창 미오픈). 복귀는 브라우저 뒤로가기.
        if (typeof window !== 'undefined') window.location.assign(tutorLink);
    };
    const MAX_CHIPS = 4;
    const overflow = scenarios.length > MAX_CHIPS ? scenarios.length - (MAX_CHIPS - 1) : 0;
    const visible = overflow ? scenarios.slice(0, MAX_CHIPS - 1) : scenarios;
    return (
        <div style={{ height: '100%', boxSizing: 'border-box', border: '1px solid var(--border)', borderRadius: 14, padding: '14px 16px', background: 'white', borderTop: `3px solid ${accent}`, display: 'flex', flexDirection: 'column', gap: 11 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <div style={{ width: 34, height: 34, borderRadius: 10, background: soft, color: accent, display: 'grid', placeItems: 'center', flexShrink: 0 }}>
                    <Icon name={g.icon || 'graduation-cap'} size={16} />
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13.5, fontWeight: 700, color: 'var(--ink-900)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{g.title}</div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginTop: 3, flexWrap: 'wrap' }}>
                        <span className="pill" style={{ background: allDone ? '#e8f6ed' : started ? soft : 'var(--muted)', color: allDone ? '#2f9759' : started ? accent : 'var(--ink-500)', fontSize: 9.5, fontWeight: 700 }}>
                            <Icon name={allDone ? 'check-circle' : started ? 'loader' : 'inbox'} size={9} />{allDone ? '완료' : started ? '진행 중' : '시작 전'}
                        </span>
                        <span className="pill" style={{ background: isChat ? '#eef6ee' : 'var(--primary-soft)', color: isChat ? '#3a7a3a' : 'var(--primary)', fontSize: 9.5, fontWeight: 700 }}>
                            <Icon name={isChat ? 'message-square' : 'phone'} size={9} />{isChat ? '채팅' : '전화'}
                        </span>
                    </div>
                </div>
                {/* 전 시나리오 완료 시에만 X로 내 보드에서 정리(코칭 이력엔 유지) — 관리자 카드와 동일. */}
                {allDone && (
                    <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); onArchive?.(g.id); }}
                        title="완료한 코칭을 내 목록에서 정리합니다 (코칭 이력엔 유지됩니다)"
                        style={{ flexShrink: 0, width: 24, height: 24, borderRadius: 7, display: 'grid', placeItems: 'center', color: 'var(--ink-400)', background: 'transparent', border: 'none', cursor: 'pointer' }}
                    >
                        <Icon name="x" size={14} />
                    </button>
                )}
            </div>
            <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 5 }}>
                    <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--ink-500)' }}>학습 진행률</span>
                    <span style={{ fontSize: 11, fontWeight: 700, color: allDone ? '#2f9759' : accent }}><span className="mono">{doneCount}</span><span className="muted-text" style={{ fontWeight: 600 }}> / {totalScen}</span></span>
                </div>
                <div className="mini-bar"><div style={{ width: `${pct}%`, background: allDone ? '#2f9759' : accent }}></div></div>
            </div>
            {totalScen > 0 && (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
                    {visible.map((code) => {
                        const s = TUTOR_SCENARIOS.find((x) => x.code === code) || { code, title: code };
                        const done = myDone.includes(code);
                        return (
                            <span key={code} className="pill" style={{ maxWidth: '47%', background: done ? '#f1f8f4' : 'var(--background-soft)', color: done ? 'var(--ink-400)' : 'var(--ink-600)', fontSize: 10, fontWeight: 600, border: `1px solid ${done ? '#cfe9d9' : 'var(--border)'}` }}>
                                <Icon name={done ? 'check' : 'sparkles'} size={9} style={{ color: done ? '#2f9759' : 'var(--ink-400)', flexShrink: 0 }} />
                                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', textDecoration: done ? 'line-through' : 'none' }}>{s.title}</span>
                            </span>
                        );
                    })}
                    {overflow > 0 && <span className="pill" style={{ background: 'transparent', color: 'var(--ink-400)', fontSize: 10, fontWeight: 600, border: 'none' }}>… 외 {overflow}건</span>}
                </div>
            )}
            {/* 배정 근거 — 이 코칭이 배정된 계기가 된 "내 콜"(본인 것만 노출). 근거 없으면 미표시. */}
            {Array.isArray(g.reasons) && g.reasons.length > 0 && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', padding: '7px 9px', background: 'var(--background-soft)', borderRadius: 9 }}>
                    <span style={{ fontSize: 9.5, fontWeight: 700, color: 'var(--ink-400)', display: 'inline-flex', alignItems: 'center', gap: 3 }}>
                        <Icon name="flag" size={9} />배정 근거
                    </span>
                    {g.reasons.slice(0, 2).map((r) => (
                        <button
                            key={r.callId}
                            type="button"
                            className="pill"
                            onClick={() => openCallDetail(r.callId)}
                            title={`상담 QA 분석 상세 보기${r.callNo ? ` · #${r.callNo}` : ''}`}
                            style={{ background: 'white', border: '1px solid var(--border)', color: 'var(--ink-600)', fontSize: 9.5, fontWeight: 600, gap: 5, cursor: 'pointer' }}
                        >
                            {String(r.date || '').slice(0, 10)}
                            {r.callNo && <span className="mono muted-text" style={{ fontSize: 9 }}>#{r.callNo}</span>}
                            <b style={{ color: 'var(--ink-900)' }}>{r.score != null ? `${Number(r.score).toFixed(0)}점` : '-'}</b>
                            <Icon name="external-link" size={9} style={{ color: 'var(--ink-400)' }} />
                        </button>
                    ))}
                    {g.reasons.length > 2 && <span className="muted-text" style={{ fontSize: 9.5 }}>외 {g.reasons.length - 2}건</span>}
                </div>
            )}
            <div style={{ marginTop: 'auto', display: 'flex', alignItems: 'center', gap: 8, paddingTop: 11, borderTop: '1px solid var(--border)' }}>
                <span className="muted-text" style={{ fontSize: 11 }}>{allDone ? '모두 완료' : `남은 ${totalScen - doneCount}개`}</span>
                <button className="btn-mini primary" style={{ marginLeft: 'auto', flexShrink: 0, background: allDone ? '#2f9759' : undefined, borderColor: allDone ? '#2f9759' : undefined }} onClick={startLearning}>
                    <Icon name={allDone ? 'rotate-ccw' : 'play'} size={11} />{allDone ? '복습' : started ? '이어서' : '학습 시작'}
                </button>
            </div>
        </div>
    );
}

// 검수 4단계(qa_calls.review_status, 실데이터): 대기 → 검수중 → 검토요청 → 최종승인.
// (레거시 'completed' 는 최종승인으로 흡수.) — 서버 27_review_workflow.sql 와 동일 상태머신.
const REVIEW_STATUS_META = {
    pending:       { label: '대기',     cls: 'gray' },
    in_review:     { label: '검수중',   cls: 'blue' },
    review_done:   { label: '검토요청', cls: 'blue' },
    admin_revised: { label: '반려',     cls: 'amber' },
    objection:     { label: '이의제기', cls: 'red' },
    approved:      { label: '확정',     cls: 'green' },
};
const REVIEW_NEEDS_ME = new Set(['pending', 'in_review', 'admin_revised']);  // 상담사 본인 액션이 남은 단계(반려=동의/이의제기 선택)

function normReviewStatus(s) {
    const v = s === 'completed' ? 'approved' : s;
    return REVIEW_STATUS_META[v] ? v : 'pending';
}

// 검수상태 칩 — 앱 전역 공용 배지(ReviewStatusBadge)로 통일: 대기(회색)·검수중(파랑)·검토요청(파랑+체크)·승인(초록+체크).

// 최근 평가 테이블 컬럼 폭: 상담일시·상담사·상담번호·채널·부서·상담유형·점수·검수상태
const RECENT_COLS = '104px 88px 1.4fr 104px 0.9fr 0.9fr 58px 92px';

// 헤더 클릭 필터 대상 컬럼 + 값/라벨 추출기. (엑셀식 — 존재하는 값만 목록에)
const FILTER_COLS = ['channel', 'team', 'category', 'score', 'status'];
const COL_VALUE = {
    channel: (r) => r.channel || '',
    team: (r) => r.team || '-',
    category: (r) => r.category || '-',
    score: (r) => String(r.score),
    status: (r) => r.status,
};
const COL_LABEL = {
    channel: (v) => (v === 'inbound' ? '인바운드' : v === 'outbound' ? '아웃바운드' : '-'),
    team: (v) => v || '-',
    category: (v) => v || '-',
    score: (v) => v,
    status: (v) => REVIEW_STATUS_META[v]?.label || v,
};
function distinctColOptions(rows, col) {
    const seen = new Set();
    for (const r of rows) seen.add(COL_VALUE[col](r));
    const arr = [...seen];
    if (col === 'score') arr.sort((a, b) => Number(b) - Number(a));
    else arr.sort((a, b) => String(COL_LABEL[col](a)).localeCompare(String(COL_LABEL[col](b)), 'ko'));
    return arr.map((v) => ({ value: v, label: COL_LABEL[col](v) }));
}

// 로그인 actor(표시 이름) — App 이 localStorage 에 저장한 값.
function readActorName() {
    if (typeof window === 'undefined') return '상담사';
    try {
        const raw = window.localStorage.getItem(QA_ACTOR_STORAGE_KEY);
        const u = raw ? JSON.parse(raw) : null;
        return (u && (u.display_name || u.login_id)) || '상담사';
    } catch {
        return '상담사';
    }
}

// 실 콜(qa_calls) → 평가목록 행. (백엔드가 본인 콜만 내려줌)
// 관리자 평가목록과 동일 컬럼 체계: 상담사/상담번호/채널/부서/상담유형/검수상태 분리.
function adaptCall(c) {
    const dt = String(c.call_datetime || '');
    return {
        id: c.qa_id,
        sessionId: c.uid || c.qa_id,            // 상담번호(ICS UID)
        callDatetime: c.call_datetime || null,
        date: dt.slice(0, 10),
        time: dt.slice(11, 16),
        agentName: c.agent_name || c.agent_code || '',  // 상담사(본인)
        channel: c.channel || null,             // inbound|outbound|null
        team: c.department || '-',              // 부서
        category: c.consultation_type || '-',   // 상담유형(카테고리) — 부서와 분리
        score: Math.round(Number(c.total_score ?? c.ai_score ?? 0)),
        status: normReviewStatus(c.review_status),  // 검수상태(4단계 실값)
    };
}

// /api/evaluations 응답 → 실제 평가 항목 배열 [{ key, label, pct, ai, max }].
// 항목명/배점은 콜마다 실제 루브릭(qa_evaluation_rows + qa_checklist_rows)을 그대로 사용한다.
// (고정 mock DIMENSIONS 에 라벨 매핑하면 이름이 달라 대부분 0 으로 표시되는 문제가 있어 직접 사용.)
function buildItemScores(evalData) {
    const rows = evalData?.evaluation_rows || [];
    const checklist = evalData?.checklist_rows || [];
    const maxByOrder = new Map();
    for (const k of checklist) maxByOrder.set(Number(k.order_no), parseMaxPointsFromValidationTime(k.validation_time));
    const out = [];
    for (const r of rows) {
        const order = Number(r.order_no);
        const label = String(r.item || '').trim();
        if (!label) continue;
        const max = maxByOrder.get(order) || 0;
        const ai = Number(r.ai_eval);
        const pct = max > 0 && Number.isFinite(ai) ? Math.max(0, Math.min(100, Math.round((100 * ai) / max))) : 0;
        out.push({ key: `ord-${order}`, label, pct, ai: Number.isFinite(ai) ? ai : 0, max });
    }
    return out;
}

// 항목별 점수 표 — 원점수(획득/만점) 표기 + 짧은 막대(이름 줄바꿈 허용으로 잘림 방지).
// 공용 ScoreBreakdown(%, 고정 DIMENSIONS)과 별개로 '내 평가결과' 전용 렌더러.
function ItemScoreBreakdown({ items }) {
    return (
        <div>
            {items.map((it) => {
                const cls = it.pct >= 90 ? '' : it.pct >= 80 ? 'mid' : 'low';
                return (
                    <div className="sb-row" key={it.key} style={{ gridTemplateColumns: '1fr 96px 60px' }}>
                        <div className="sb-name" style={{ whiteSpace: 'normal', lineHeight: 1.35 }}>{it.label}</div>
                        <div className={`sb-bar ${cls}`}><div style={{ width: `${it.pct}%` }}></div></div>
                        <div className="sb-val">{it.ai}<span style={{ color: 'var(--ink-400)', fontWeight: 600 }}>/{it.max}</span></div>
                    </div>
                );
            })}
        </div>
    );
}

// 최근 점수 추이 미니 차트 — 점별 점수 수치 + 첫/중간/끝 날짜(MM/DD) 표기(QA 피드백: 수치·날짜 없어 파악 곤란).
// 공용 Spark 는 라벨 미지원이라 이 화면 전용으로 대체. points = [{ score, date('YYYY-MM-DD') }] 시간 오름차순.
function TrendSpark({ points, color = 'var(--primary)', height = 92, width = 220 }) {
    const w = width;
    const h = height;
    const padX = 12, top = 16, bottom = 16;
    const scores = points.map((p) => p.score);
    const max = Math.max(...scores);
    const min = Math.min(...scores);
    const range = max - min || 1;
    const stepX = (w - padX * 2) / (points.length - 1);
    const xy = points.map((p, i) => [padX + i * stepX, top + (1 - (p.score - min) / range) * (h - top - bottom)]);
    const path = `M ${xy.map(([x, y]) => `${x},${y}`).join(' L ')}`;
    const area = `${path} L ${w - padX},${h - bottom + 6} L ${padX},${h - bottom + 6} Z`;
    // 날짜 라벨은 겹침 방지로 첫/끝(+5점 이상이면 중간)만.
    const dateIdx = new Set([0, points.length - 1, ...(points.length >= 5 ? [Math.floor((points.length - 1) / 2)] : [])]);
    const md = (d) => (d && d.length >= 10 ? `${d.slice(5, 7)}/${d.slice(8, 10)}` : '');
    return (
        <svg viewBox={`0 0 ${w} ${h}`} style={{ width: '100%', height: 'auto', display: 'block' }}>
            <defs>
                <linearGradient id="trendSparkFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={color} stopOpacity="0.18" />
                    <stop offset="100%" stopColor={color} stopOpacity="0" />
                </linearGradient>
            </defs>
            <path d={area} fill="url(#trendSparkFill)" />
            <path d={path} fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            {xy.map(([x, y], i) => (
                <g key={i}>
                    <circle cx={x} cy={y} r="2.6" fill="white" stroke={color} strokeWidth="1.6" />
                    <text x={x} y={y - 6} textAnchor="middle" style={{ fontSize: 9, fontWeight: 700, fill: 'var(--ink-700)' }}>{points[i].score}</text>
                    {dateIdx.has(i) && (
                        <text
                            x={x}
                            y={h - 3}
                            textAnchor={i === 0 ? 'start' : i === points.length - 1 ? 'end' : 'middle'}
                            style={{ fontSize: 8.5, fill: 'var(--ink-400)' }}
                        >
                            {md(points[i].date)}
                        </text>
                    )}
                </g>
            ))}
        </svg>
    );
}

// 감정·대화 품질 카드 (부정비율 / 회복률 / 금칙어) — 03 TA + 05 qa_call_recovery 실연동(미연동/무데이터 시 mock 폴백).
function QualityCard({ tone, icon, label, desc, ring, center, delta, footer, hero, onClick, actionLabel }) {
    const TONES = {
        primary: { color: 'var(--primary)', track: 'var(--primary-soft-flat)', soft: 'var(--primary-soft)', ink: 'var(--primary)' },
        warn: { color: '#e8a045', track: '#fde7cf', soft: '#fff3e0', ink: '#b27a14' },
        ok: { color: 'var(--ink-400)', track: 'var(--muted)', soft: 'var(--background-soft)', ink: 'var(--ink-500)' },
    };
    const c = TONES[tone];
    const clickable = typeof onClick === 'function';
    const [hover, setHover] = useState(false);
    return (
        <div
            onClick={clickable ? onClick : undefined}
            onMouseEnter={clickable ? () => setHover(true) : undefined}
            onMouseLeave={clickable ? () => setHover(false) : undefined}
            role={clickable ? 'button' : undefined}
            tabIndex={clickable ? 0 : undefined}
            onKeyDown={clickable ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick(); } } : undefined}
            style={{ padding: hero ? '22px 24px' : '20px', border: hero ? `1px solid ${c.color}` : '1px solid var(--border)', borderRadius: 16, background: hero ? `linear-gradient(135deg, ${c.soft}, white 65%)` : 'white', boxShadow: clickable && hover ? '0 6px 18px rgba(16,24,40,0.10)' : hero ? '0 0 0 3px var(--primary-ring)' : 'none', transform: clickable && hover ? 'translateY(-1px)' : 'none', transition: 'box-shadow .15s ease, transform .15s ease', cursor: clickable ? 'pointer' : 'default', display: 'flex', flexDirection: 'column', gap: 14 }}>
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
            {clickable && (
                <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 'auto', paddingTop: 2 }}>
                    <span style={{ fontSize: 11.5, fontWeight: 700, color: c.ink, display: 'inline-flex', alignItems: 'center', gap: 2, opacity: hover ? 1 : 0.75 }}>
                        {actionLabel || '자세히 보기'}
                        <Icon name="chevron-right" size={13} />
                    </span>
                </div>
            )}
        </div>
    );
}

// 감정 궤적 미니 — 구간별 감정을 색 점열로 압축(부정=빨강·중립=주황·긍정=초록). 회복률 드릴다운용.
const SENTI_COLOR = { 부정: '#e5484d', 중립: '#e8a045', 긍정: '#2f9759' };
function EmotionTrack({ sentiments = [], firstNegIdx = null }) {
    if (!Array.isArray(sentiments) || sentiments.length === 0) {
        return <span style={{ fontSize: 11, color: 'var(--ink-300)' }}>궤적 없음</span>;
    }
    return (
        <span style={{ display: 'inline-flex', gap: 3, alignItems: 'center' }}>
            {sentiments.map((s, i) => (
                <span
                    key={i}
                    title={`구간 ${i + 1}: ${s}`}
                    style={{
                        width: 10, height: 10, borderRadius: 3,
                        background: SENTI_COLOR[s] || 'var(--ink-300)',
                        boxShadow: firstNegIdx && i === firstNegIdx - 1 ? '0 0 0 2px var(--ink-900)' : 'none',
                    }}
                />
            ))}
        </span>
    );
}

// 드릴다운 팝업 — 카드별 '내 콜' 목록. kind=negative|recovery|forbidden.
const DRILL_META = {
    negative: { title: '부정 감정으로 분류된 콜', icon: 'frown' },
    recovery: { title: '부정 발생 콜 · 회복 여부', icon: 'heart-pulse' },
    forbidden: { title: '금칙어 언급 콜', icon: 'shield-check' },
};
function fmtCallTime(v) {
    if (!v) return '—';
    const d = new Date(v);
    if (Number.isNaN(d.getTime())) return String(v).slice(0, 16).replace('T', ' ');
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}
function QualityDrillModal({ kind, onClose }) {
    const [state, setState] = useState({ loading: true, calls: [], error: null });
    useEffect(() => {
        let cancel = false;
        setState({ loading: true, calls: [], error: null });
        fetchMyTaMetricCalls(kind)
            .then((d) => {
                if (cancel) return;
                if (d?.enabled === false) setState({ loading: false, calls: [], error: 'TA 분석이 연동되지 않았습니다.' });
                else setState({ loading: false, calls: Array.isArray(d?.calls) ? d.calls : [], error: null });
            })
            .catch(() => { if (!cancel) setState({ loading: false, calls: [], error: '콜 목록을 불러오지 못했습니다.' }); });
        return () => { cancel = true; };
    }, [kind]);
    const meta = DRILL_META[kind] || {};
    const { loading, calls, error } = state;

    // 표시=bare uid, 클릭=qa_id(ICS 전체형식) — 콜 상세는 qa_id 로 조회하므로 분리.
    const UidCell = ({ qaId, label }) => (
        <button
            className="mono"
            onClick={() => openCallDetail(qaId)}
            title={`${label} — 콜 상세 열기`}
            style={{ background: 'none', border: 0, padding: 0, cursor: 'pointer', color: 'var(--primary)', fontSize: 11.5, fontWeight: 700, textAlign: 'left', maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
        >
            {label}
        </button>
    );

    return (
        <Modal title={<span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}><Icon name={meta.icon} size={16} />{meta.title}{!loading && !error && <span className="pill blue" style={{ fontSize: 11, marginLeft: 4 }}>{calls.length}건</span>}</span>} onClose={onClose} width={760}>
            {loading ? (
                <div style={{ padding: '40px 0', textAlign: 'center', color: 'var(--ink-400)', fontSize: 13 }}>불러오는 중…</div>
            ) : error ? (
                <div style={{ padding: '40px 0', textAlign: 'center', color: 'var(--ink-400)', fontSize: 13 }}>{error}</div>
            ) : calls.length === 0 ? (
                <div style={{ padding: '40px 0', textAlign: 'center', color: 'var(--ink-400)', fontSize: 13 }}>해당하는 콜이 없습니다.</div>
            ) : (
                <div style={{ maxHeight: '58vh', overflowY: 'auto' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
                        <thead>
                            <tr style={{ borderBottom: '1px solid var(--border)', color: 'var(--ink-500)', fontSize: 11, fontWeight: 700, textAlign: 'left' }}>
                                <th style={{ padding: '8px 10px' }}>상담번호</th>
                                <th style={{ padding: '8px 10px', whiteSpace: 'nowrap' }}>일시</th>
                                <th style={{ padding: '8px 10px' }}>채널</th>
                                {kind === 'negative' && <th style={{ padding: '8px 10px' }}>대표 감정</th>}
                                {kind === 'recovery' && <th style={{ padding: '8px 10px' }}>회복</th>}
                                {kind === 'recovery' && <th style={{ padding: '8px 10px' }}>감정 궤적</th>}
                                {kind === 'recovery' && <th style={{ padding: '8px 10px' }}>시작 → 끝</th>}
                                {kind === 'forbidden' && <th style={{ padding: '8px 10px' }}>금칙어</th>}
                                {kind === 'forbidden' && <th style={{ padding: '8px 10px' }}>발화 인용</th>}
                            </tr>
                        </thead>
                        <tbody>
                            {calls.map((r, i) => (
                                <tr key={`${r.uid}-${i}`} style={{ borderBottom: '1px solid var(--border-soft)' }}>
                                    <td style={{ padding: '9px 10px', verticalAlign: 'top' }}><UidCell qaId={r.qa_id || r.uid} label={r.uid} /></td>
                                    <td style={{ padding: '9px 10px', verticalAlign: 'top', whiteSpace: 'nowrap', color: 'var(--ink-500)', fontSize: 11.5 }}>{fmtCallTime(r.cdate)}</td>
                                    <td style={{ padding: '9px 10px', verticalAlign: 'top', color: 'var(--ink-600)' }}>{r.channel || '—'}</td>
                                    {kind === 'negative' && (
                                        <td style={{ padding: '9px 10px', verticalAlign: 'top' }}>
                                            <span className="pill red" style={{ fontSize: 10.5, fontWeight: 700 }}><Icon name="frown" size={10} />{r.sentiment || '부정'}</span>
                                        </td>
                                    )}
                                    {kind === 'recovery' && (
                                        <td style={{ padding: '9px 10px', verticalAlign: 'top' }}>
                                            <span className={`pill ${r.recovered ? 'green' : 'red'}`} style={{ fontSize: 10.5, fontWeight: 700 }}>
                                                <Icon name={r.recovered ? 'smile' : 'frown'} size={10} />{r.recovered ? '회복' : '미회복'}
                                            </span>
                                        </td>
                                    )}
                                    {kind === 'recovery' && (
                                        <td style={{ padding: '9px 10px', verticalAlign: 'top' }}><EmotionTrack sentiments={r.trajectory} firstNegIdx={r.first_neg_idx} /></td>
                                    )}
                                    {kind === 'recovery' && (
                                        <td style={{ padding: '9px 10px', verticalAlign: 'top', fontSize: 11.5, color: 'var(--ink-600)', whiteSpace: 'nowrap' }}>
                                            부정 → {r.final_sentiment || '—'}
                                        </td>
                                    )}
                                    {kind === 'forbidden' && (
                                        <td style={{ padding: '9px 10px', verticalAlign: 'top' }}>
                                            <span style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                                                {(r.hits || []).map((h, j) => (
                                                    <span key={j} className="pill red" style={{ fontSize: 10.5, fontWeight: 700 }}>{h.word}</span>
                                                ))}
                                            </span>
                                        </td>
                                    )}
                                    {kind === 'forbidden' && (
                                        <td style={{ padding: '9px 10px', verticalAlign: 'top', color: 'var(--ink-600)', fontSize: 11.5, lineHeight: 1.5 }}>
                                            {(r.hits || [])[0]?.utterance
                                                ? <span style={{ fontStyle: 'italic' }}>“{(r.hits[0].utterance || '').slice(0, 90)}{(r.hits[0].utterance || '').length > 90 ? '…' : ''}”</span>
                                                : '—'}
                                        </td>
                                    )}
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}
        </Modal>
    );
}

export default function CounselorResults() {
    const [period, setPeriod] = useState(defaultPeriod('7d'));
    const [evals, setEvals] = useState(null);          // null=로딩
    const [selectedId, setSelectedId] = useState(null);
    const [breakdowns, setBreakdowns] = useState({});  // qa_id → { dimKey: pct }
    const [coaching, setCoaching] = useState([]);
    const [taMetrics, setTaMetrics] = useState(null);  // 03 TA 지표(부정/금칙어). null=로딩
    const [drillKind, setDrillKind] = useState(null);  // 감정품질 카드 드릴다운 팝업(negative|recovery|forbidden)
    const [onlyNeedsReview, setOnlyNeedsReview] = useState(false);  // '내 검수 필요'(대기·검수중)만
    const [colFilters, setColFilters] = useState({});  // 컬럼키 → 제외(excluded) Set
    const name = readActorName();

    // 본인 콜 목록 + 배정 코칭 로드
    useEffect(() => {
        let cancelled = false;
        (async () => {
            try {
                const data = await fetchCalls();
                if (cancelled) return;
                const list = (Array.isArray(data) ? data : []).map(adaptCall)
                    .sort((a, b) => String(b.callDatetime || '').localeCompare(String(a.callDatetime || '')));
                setEvals(list);
            } catch (e) {
                console.error('내 평가 목록 로딩 실패:', e);
                if (!cancelled) setEvals([]);
            }
        })();
        (async () => {
            try {
                const data = await fetchMyCoaching();
                if (!cancelled) setCoaching(Array.isArray(data) ? data : []);
            } catch (e) {
                console.error('배정 코칭 로딩 실패:', e);
                if (!cancelled) setCoaching([]);
            }
        })();
        (async () => {
            try {
                const data = await fetchMyTaMetrics();  // 부정발화·금칙어(03 tb_ta_rslt, 본인 콜 기준)
                if (!cancelled) setTaMetrics(data || { enabled: false });
            } catch (e) {
                console.error('TA 지표 로딩 실패:', e);
                if (!cancelled) setTaMetrics({ enabled: false });
            }
        })();
        return () => { cancelled = true; };
    }, []);

    // 완료 카드 'X' — 내 보드에서만 정리(멤버별 아카이브). 코칭 이력 팝업엔 계속 노출.
    const archiveCoachingCard = async (id) => {
        setCoaching((list) => list.map((g) => (g.id === id ? { ...g, memberArchived: true } : g)));
        try {
            await archiveMyCoaching(id);
        } catch (e) {
            console.error('코칭 정리 실패:', e);
            setCoaching((list) => list.map((g) => (g.id === id ? { ...g, memberArchived: false } : g))); // 실패 시 복구
        }
    };
    // 보드 표시용 — 본인이 치운 것 제외 + 완료(allDone) 카드는 항상 맨 뒤. (코칭 이력은 전체 coaching 사용)
    const boardCoaching = coaching
        .filter((g) => !g.memberArchived)
        .sort((a, b) => (coachingAllDone(a) ? 1 : 0) - (coachingAllDone(b) ? 1 : 0));

    // 각 평가의 항목별 점수 로드(강점·개선 집계 + 선택 상세). 최근 50건으로 제한.
    useEffect(() => {
        if (!evals || !evals.length) return undefined;
        let cancelled = false;
        (async () => {
            const ids = evals.slice(0, 50).map((e) => e.id);
            const pairs = await Promise.all(
                ids.map((id) => fetchEvaluations(id).then((d) => [id, buildItemScores(d)]).catch(() => [id, []]))
            );
            if (!cancelled) setBreakdowns(Object.fromEntries(pairs));
        })();
        return () => { cancelled = true; };
    }, [evals]);

    const myEvals = evals || [];
    const needsReviewCount = myEvals.filter((r) => REVIEW_NEEDS_ME.has(r.status)).length;  // 대기+검수중
    // 토글(대기·검수중) → 컬럼 헤더 필터(엑셀식) 순서로 적용.
    const afterToggle = onlyNeedsReview ? myEvals.filter((r) => REVIEW_NEEDS_ME.has(r.status)) : myEvals;
    const shownEvals = afterToggle.filter((r) =>
        FILTER_COLS.every((c) => {
            const ex = colFilters[c];
            return !ex || ex.size === 0 || !ex.has(COL_VALUE[c](r));
        })
    );
    const colOpts = useMemo(
        () => Object.fromEntries(FILTER_COLS.map((c) => [c, distinctColOptions(myEvals, c)])),
        [myEvals]
    );
    const setColFilter = (c, ex) => setColFilters((f) => ({ ...f, [c]: ex }));
    const loading = evals === null;
    const selected = myEvals.find((r) => r.id === selectedId) || null;
    const selectedItems = selected ? (breakdowns[selected.id] || []) : [];

    // 평균/추이 — 실 콜 점수.
    const scored = myEvals.filter((r) => Number.isFinite(r.score) && r.score > 0);
    const myAvg = scored.length ? Math.round((scored.reduce((a, r) => a + r.score, 0) / scored.length) * 10) / 10 : null;
    const bestScore = scored.length ? Math.max(...scored.map((r) => r.score)) : null;
    // 추이 차트용 — 최근 7건(시간 오름차순), 점수+날짜 동반(수치·날짜 라벨 표기).
    const myTrend = [...scored].reverse().slice(-7).map((r) => ({ score: r.score, date: r.date }));
    // 개인 성장 추세 — 최근 7일 vs 직전 7일 평균 점수 차(앵커=본인 최신 콜 시각, 과거 시드 데이터도 표시되게).
    // 비교 구간 중 한쪽이라도 콜이 없으면 null(표시 생략). 팀 내 순위 대신 노출(상담사 위축감 방지, 본인 추세 강조).
    const weekDelta = (() => {
        const dated = scored.filter((r) => r.callDatetime || r.date);
        if (!dated.length) return null;
        const ts = (r) => new Date(r.callDatetime || r.date).getTime();
        const valid = dated.filter((r) => Number.isFinite(ts(r)));
        if (!valid.length) return null;
        const anchor = Math.max(...valid.map(ts));
        const DAY = 24 * 3600 * 1000;
        const cur = valid.filter((r) => anchor - ts(r) < 7 * DAY);
        const prev = valid.filter((r) => { const d = anchor - ts(r); return d >= 7 * DAY && d < 14 * DAY; });
        if (!cur.length || !prev.length) return null;
        const avg = (a) => a.reduce((s, r) => s + r.score, 0) / a.length;
        return Math.round((avg(cur) - avg(prev)) * 10) / 10;
    })();

    // 항목별 평균(로드된 breakdown 집계) → 강점/개선. 실제 항목명(label) 기준으로 묶는다.
    const dimAverages = useMemo(() => {
        const byLabel = new Map();  // label → pct[]
        for (const items of Object.values(breakdowns)) {
            for (const it of (items || [])) {
                if (!byLabel.has(it.label)) byLabel.set(it.label, []);
                byLabel.get(it.label).push(it.pct);
            }
        }
        return [...byLabel.entries()].map(([label, vals]) => ({
            key: label,
            label,
            avg: vals.length ? Math.round(vals.reduce((a, b) => a + b, 0) / vals.length) : null,
        })).filter((d) => d.avg != null);
    }, [breakdowns]);
    const strengths = [...dimAverages].sort((a, b) => b.avg - a.avg).slice(0, 3);
    const weakness = [...dimAverages].sort((a, b) => a.avg - b.avg).slice(0, 2);

    const gradeLabel = myAvg == null ? '평가 없음' : myAvg >= 90 ? '우수 등급' : myAvg >= 80 ? '양호 등급' : '개선 필요';

    // 감정·대화 품질 — 03(Meta_Summary) 실연동(본인 콜 uid 기준). TA 미연동/무데이터 시 mock 폴백.
    //  - 부정발화·금칙어: 03 tb_ta_rslt 종합값.
    //  - 회복률(부정→긍정): 05 자체 기준("부정으로 안 끝남")으로 03 구간감정 분석 → qa_call_recovery.
    //    분모=부정 발생 통화, 분자=마지막 구간이 긍정/중립. 부정 통화 0건이면 recReal=false(해당 없음).
    const ta = taMetrics && taMetrics.enabled && taMetrics.total > 0 ? taMetrics : null;
    const recReal = Boolean(ta && ta.recovery_denom > 0);          // 회복률 실데이터 유효
    const recNoNeg = Boolean(ta && ta.recovery_denom === 0);       // TA 있으나 부정 통화 없음
    const quality = {
        negative: ta
            ? { ratio: ta.negative_rate ?? 0, total: ta.total, flagged: ta.negative_count, real: true }
            : { ratio: 11, delta: 3, total: 512, flagged: 56 },
        recovery: recReal
            ? { rate: ta.recovery_rate ?? 0, recovered: ta.recovery_count, total: ta.recovery_denom, real: true }
            : { rate: 82, delta: 6, recovered: 14, total: 17 },
        forbidden: ta
            ? { rate: ta.banned_rate ?? 0, count: ta.banned_count, total: ta.total, real: true }
            : { rate: 0.4, count: 2, total: 512, delta: 0 },
    };
    const taReal = Boolean(ta);

    return (
        <div>
            <PageHead eyebrow="상담원 · 내 평가 결과" title={`안녕하세요, ${name} 님`} sub="내 평가 결과를 확인하고, 코칭 의견을 참고해 다음 상담에 적용해보세요.">
                <PeriodPicker value={period} onChange={setPeriod} />
            </PageHead>

            {/* Hero */}
            <div className="panel" style={{ marginBottom: 22, padding: 28, display: 'flex', alignItems: 'center', gap: 28, background: 'linear-gradient(135deg, #f2f6ff, white)' }}>
                <Gauge value={myAvg == null ? 0 : Math.round(myAvg)} label="평균 점수" size={160} />
                <div style={{ flex: 1 }}>
                    <div className="eyebrow" style={{ marginBottom: 6 }}>This Week</div>
                    <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, marginBottom: 8 }}>
                        <span style={{ fontSize: 36, fontWeight: 800, letterSpacing: '-0.02em' }}>{gradeLabel}</span>
                        {/* 개인 성장 추세(실데이터) — 하락도 담담한 톤(gray)으로. 비교 데이터 없으면 미표시. */}
                        {weekDelta != null && (
                            <span className={`pill ${weekDelta >= 0 ? 'blue' : 'gray'}`}>
                                <Icon name={weekDelta >= 0 ? 'trending-up' : 'trending-down'} size={12} />
                                지난주 대비 {weekDelta >= 0 ? '+' : ''}{weekDelta}점
                            </span>
                        )}
                    </div>
                    <div className="muted-text" style={{ fontSize: 13.5, marginBottom: 16, maxWidth: 520, lineHeight: 1.55 }}>
                        {loading ? '평가 데이터를 불러오는 중…'
                            : myEvals.length === 0 ? '아직 평가된 통화가 없습니다. 응대한 콜이 평가되면 이곳에 표시됩니다.'
                                : strengths.length >= 2
                                    ? <>평가 {myEvals.length}건 기준, <strong style={{ color: 'var(--ink-700)' }}>{strengths[0].label}</strong>·<strong style={{ color: 'var(--ink-700)' }}>{strengths[1].label}</strong> 항목에서 강점을 보이고 있습니다.</>
                                    : <>평가 {myEvals.length}건이 집계되었습니다.</>}
                    </div>
                    <div style={{ display: 'flex', gap: 24 }}>
                        <div>
                            <div className="muted-text" style={{ fontSize: 11.5 }}>최고 점수</div>
                            <div className="mono" style={{ fontSize: 22, fontWeight: 800, color: 'var(--ink-900)' }}>{bestScore ?? '–'}</div>
                        </div>
                        {/* 개인 성장 추세(실계산) — 비교 데이터 없으면 '–'.
                            팀 내 순위는 비노출 결정(상담사 위축감 방지) — 서버 /api/me/rank 는 존치(재노출 대비). */}
                        <div>
                            <div className="muted-text" style={{ fontSize: 11.5 }}>지난주 대비</div>
                            <div className="mono" style={{ fontSize: 22, fontWeight: 800, color: weekDelta == null ? 'var(--ink-400)' : weekDelta >= 0 ? 'var(--primary)' : 'var(--ink-700)' }}>
                                {weekDelta == null ? '–' : `${weekDelta >= 0 ? '+' : ''}${weekDelta}`}
                                {weekDelta != null && <span style={{ fontSize: 14, color: 'var(--ink-500)', fontWeight: 600, marginLeft: 2 }}>점</span>}
                            </div>
                        </div>
                        <div>
                            <div className="muted-text" style={{ fontSize: 11.5 }}>평가 받은 통화</div>
                            <div className="mono" style={{ fontSize: 22, fontWeight: 800 }}>{myEvals.length}<span style={{ fontSize: 14, color: 'var(--ink-500)', fontWeight: 600, marginLeft: 2 }}>건</span></div>
                        </div>
                    </div>
                </div>
                <div style={{ width: 520 }}>
                    <div className="muted-text" style={{ fontSize: 11.5, marginBottom: 6 }}>최근 점수 추이</div>
                    {myTrend.length > 1 ? <TrendSpark points={myTrend} height={130} width={520} /> : <div className="muted-text" style={{ fontSize: 12 }}>추이 표시에 2건 이상 필요</div>}
                </div>
            </div>

            {/* 감정·대화 품질 (STT 감정분석 미연동 — 디자인 시안 샘플) */}
            <div className="panel" style={{ marginBottom: 22 }}>
                <div className="panel-head">
                    <h3>감정 · 대화 품질</h3>
                    <div className="sub" style={{ marginLeft: 12 }}>{taReal ? 'TA 분석 기반 · 내 통화 전체' : 'STT 발화 분석 기반 · 이번주'}</div>
                    <span className="pill blue" style={{ marginLeft: 'auto', fontSize: 10.5 }}>
                        <Icon name="audio-lines" size={10} />{taReal ? `${quality.negative.total}건 통화 분석` : '512개 발화 분석'}
                    </span>
                </div>
                <div className="panel-body">
                    <div className="grid" style={{ gridTemplateColumns: '1fr 1.25fr 1fr', gap: 14 }}>
                        <QualityCard
                            tone="warn"
                            icon="frown"
                            label="부정 발화 비율"
                            onClick={taReal && quality.negative.flagged > 0 ? () => setDrillKind('negative') : undefined}
                            actionLabel={`부정 콜 ${quality.negative.flagged}건 보기`}
                            ring={quality.negative.ratio}
                            center={{ main: `${quality.negative.ratio}%` }}
                            delta={taReal ? null : { dir: 'down', text: `${quality.negative.delta}%p`, good: true }}
                            desc={taReal
                                ? <>내 통화 <strong style={{ color: 'var(--ink-700)' }}>{quality.negative.total}</strong>건 중 <strong style={{ color: 'var(--ink-700)' }}>{quality.negative.flagged}</strong>건이 부정 감정으로 분류됐어요.</>
                                : <>전체 <strong style={{ color: 'var(--ink-700)' }}>{quality.negative.total}</strong>개 발화 중 <strong style={{ color: 'var(--ink-700)' }}>{quality.negative.flagged}</strong>건이 부정 감정으로 분류됐어요. 지난주보다 낮아졌습니다.</>}
                        />
                        <QualityCard
                            hero
                            tone="primary"
                            icon="heart-pulse"
                            label="회복률"
                            onClick={recReal && quality.recovery.total > 0 ? () => setDrillKind('recovery') : undefined}
                            actionLabel={`부정 발생 콜 ${quality.recovery.total}건`}
                            ring={recNoNeg ? 100 : quality.recovery.rate}
                            center={recNoNeg
                                ? { main: '–', sub: '부정 없음' }
                                : { main: `${quality.recovery.rate}%`, sub: '회복 성공' }}
                            delta={recReal
                                ? (quality.recovery.rate >= RECOVERY_PRAISE_MIN
                                    ? { dir: 'up', text: '양호', good: true }
                                    : { dir: 'down', text: '분발 필요', good: false })
                                : recNoNeg ? { dir: 'flat', text: '해당 없음', neutral: true } : { dir: 'flat', text: '샘플', neutral: true }}
                            desc={recReal
                                ? <>부정 감정이 나타난 통화를 중립·긍정으로 되돌린 비율이에요. {quality.recovery.rate >= RECOVERY_PRAISE_MIN
                                    ? '까다로운 응대를 잘 이끌어가고 있습니다.'
                                    : '회복이 더 필요해요. 배정된 코칭을 참고해 분발해봐요.'}</>
                                : recNoNeg
                                    ? <>분석된 내 통화 중 부정 감정으로 분류된 통화가 없어 회복률 산정 대상이 없습니다.</>
                                    : '부정 감정으로 시작한 고객을 중립·긍정으로 전환한 비율이에요. (샘플 — TA 연동 시 실데이터로 표시)'}
                            footer={recNoNeg ? null : (
                                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                    <span className="pill gray" style={{ fontSize: 11, fontWeight: 700 }}>
                                        <Icon name="frown" size={10} />부정 발생 {quality.recovery.total}건
                                    </span>
                                    <Icon name="arrow-right" size={13} style={{ color: 'var(--ink-400)' }} />
                                    <span className="pill blue" style={{ fontSize: 11, fontWeight: 700 }}>
                                        <Icon name="smile" size={10} />회복 {quality.recovery.recovered}건
                                    </span>
                                </div>
                            )}
                        />
                        <QualityCard
                            tone="ok"
                            icon="shield-check"
                            label="금칙어 언급률"
                            onClick={taReal && quality.forbidden.count > 0 ? () => setDrillKind('forbidden') : undefined}
                            actionLabel={`금칙어 콜 ${quality.forbidden.count}건 보기`}
                            ring={100 - quality.forbidden.rate}
                            center={{ main: `${quality.forbidden.count}건`, sub: quality.forbidden.rate <= 1 ? '양호' : '주의' }}
                            delta={taReal ? null : { dir: 'flat', text: '변동 없음', neutral: true }}
                            desc={taReal
                                ? <>내 통화 <strong style={{ color: 'var(--ink-700)' }}>{quality.forbidden.total}</strong>건 중 금칙어 언급은 <strong style={{ color: 'var(--ink-700)' }}>{quality.forbidden.rate}%</strong>({quality.forbidden.count}건)입니다.</>
                                : <>전체 발화 중 금칙어 언급은 <strong style={{ color: 'var(--ink-700)' }}>{quality.forbidden.rate}%</strong>({quality.forbidden.count}건)로, 사내 기준(1% 이하)을 충족합니다.</>}
                        />
                    </div>
                </div>
            </div>

            {drillKind && <QualityDrillModal kind={drillKind} onClose={() => setDrillKind(null)} />}

            {/* 배정된 코칭 플랜 */}
            <div className="panel" style={{ marginBottom: 22 }}>
                <div className="panel-head">
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <div style={{ width: 24, height: 24, borderRadius: 6, background: 'var(--primary-soft)', color: 'var(--primary)', display: 'grid', placeItems: 'center' }}>
                            <Icon name="graduation-cap" size={13} />
                        </div>
                        <h3>배정된 코칭 플랜</h3>
                        <span className="muted-text" style={{ fontSize: 12 }}>· 관리자가 직접 지정한 학습 커리큘럼</span>
                    </div>
                    <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8 }}>
                        {boardCoaching.length > 0 && (
                            <span className="pill blue" style={{ fontSize: 10.5 }}>
                                <Icon name="inbox" size={10} />{boardCoaching.length}건 진행 중
                            </span>
                        )}
                        <button
                            className="btn-mini"
                            onClick={() => openInWindow({
                                name: 'my-coaching-history', title: '코칭 이력', width: 880, height: 800,
                                render: (close) => <CounselorHistoryModal windowed coaching={coaching} onClose={close} />,
                            })}
                        >
                            <Icon name="history" size={11} />코칭 이력
                        </button>
                    </div>
                </div>
                <div className="panel-body">
                    {boardCoaching.length === 0 ? (
                        <div style={{ padding: '40px 20px', textAlign: 'center' }}>
                            <div style={{ width: 48, height: 48, borderRadius: 14, background: 'var(--background)', border: '1px solid var(--border)', display: 'grid', placeItems: 'center', color: 'var(--ink-400)', margin: '0 auto 14px' }}>
                                <Icon name="inbox" size={20} />
                            </div>
                            <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--ink-900)', marginBottom: 6 }}>{coaching.length === 0 ? '아직 배정된 코칭이 없습니다' : '진행 중인 코칭이 없습니다'}</div>
                            <div className="muted-text" style={{ fontSize: 12.5, lineHeight: 1.55, maxWidth: 360, margin: '0 auto' }}>{coaching.length === 0 ? '코치가 평가 결과를 검토한 뒤 맞춤 학습 커리큘럼을 배정하면 이곳에 표시됩니다.' : '완료한 코칭은 상단 "코칭 이력"에서 확인할 수 있습니다.'}</div>
                        </div>
                    ) : (
                        <CoachingCarousel items={boardCoaching} onArchive={archiveCoachingCard} />
                    )}
                </div>
            </div>

            {/* 강점 · 개선 */}
            <div className="grid" style={{ gridTemplateColumns: 'repeat(2, 1fr)', gap: 18, alignItems: 'start', marginBottom: 22 }}>
                <div className="panel">
                    <div className="panel-head">
                        <h3>나의 강점</h3>
                        <span className="muted-text" style={{ marginLeft: 'auto', fontSize: 11 }}>항목별 평균 기준</span>
                    </div>
                    <div className="panel-body" style={{ display: 'grid', gap: 16, alignContent: 'start' }}>
                        {strengths.length === 0 ? <div className="muted-text" style={{ fontSize: 12.5 }}>항목별 점수 데이터가 아직 없습니다.</div> : strengths.map((s) => (
                            <div key={s.key}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 7 }}>
                                    <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink-900)' }}>{s.label}</span>
                                    <span className="mono" style={{ marginLeft: 'auto', fontSize: 14, fontWeight: 800, color: 'var(--primary)' }}>{s.avg}</span>
                                </div>
                                <div className="mini-bar"><div style={{ width: `${s.avg}%`, background: 'var(--primary)' }}></div></div>
                            </div>
                        ))}
                    </div>
                </div>

                <div className="panel">
                    <div className="panel-head">
                        <h3>개선 포인트</h3>
                        <span className="pill" style={{ marginLeft: 'auto', fontSize: 10.5, background: '#fff3e0', color: '#b27a14' }}>
                            <Icon name="target" size={10} />집중 영역
                        </span>
                    </div>
                    <div className="panel-body" style={{ display: 'grid', gap: 16, alignContent: 'start' }}>
                        {weakness.length === 0 ? <div className="muted-text" style={{ fontSize: 12.5 }}>항목별 점수 데이터가 아직 없습니다.</div> : weakness.map((s) => {
                            const target = Math.min(100, s.avg + 6);
                            return (
                                <div key={s.key}>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 7 }}>
                                        <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink-900)' }}>{s.label}</span>
                                        <span className="muted-text" style={{ fontSize: 11 }}>현재 {s.avg} → 목표 {target}</span>
                                        <span className="mono" style={{ marginLeft: 'auto', fontSize: 14, fontWeight: 800, color: '#b27a14' }}>{s.avg}</span>
                                    </div>
                                    <div className="mini-bar"><div style={{ width: `${s.avg}%`, background: '#e8a045' }}></div></div>
                                </div>
                            );
                        })}
                    </div>
                </div>
            </div>

            {/* 최근 평가 */}
            <div className="panel" style={{ marginBottom: 22 }}>
                <div className="panel-head">
                    <h3>최근 평가</h3>
                    <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 12 }}>
                        <button
                            type="button"
                            onClick={() => setOnlyNeedsReview((v) => !v)}
                            className={`pill ${onlyNeedsReview ? 'blue' : 'gray'}`}
                            title="대기·검수중인 내 평가만 보기"
                            style={{ cursor: 'pointer', border: 0, fontSize: 11.5, fontWeight: 700, display: 'inline-flex', alignItems: 'center', gap: 6 }}
                        >
                            <Icon name={onlyNeedsReview ? 'toggle-right' : 'toggle-left'} size={14} />
                            내 검수 필요{needsReviewCount > 0 ? ` ${needsReviewCount}` : ''}
                        </button>
                        <span className="muted-text">{shownEvals.length}건</span>
                    </div>
                </div>
                <div>
                    <div className="tbl-head tc" style={{ gridTemplateColumns: RECENT_COLS, borderTop: 0, overflow: 'visible' }}>
                        <div>상담일시</div>
                        <div>상담사</div>
                        <div>상담번호</div>
                        <div><ColumnFilter title="채널" options={colOpts.channel} excluded={colFilters.channel} onChange={(ex) => setColFilter('channel', ex)} /></div>
                        <div><ColumnFilter title="부서" options={colOpts.team} excluded={colFilters.team} onChange={(ex) => setColFilter('team', ex)} /></div>
                        <div><ColumnFilter title="상담유형" options={colOpts.category} excluded={colFilters.category} onChange={(ex) => setColFilter('category', ex)} /></div>
                        <div><ColumnFilter title="점수" options={colOpts.score} excluded={colFilters.score} onChange={(ex) => setColFilter('score', ex)} /></div>
                        <div><ColumnFilter title="검수상태" options={colOpts.status} excluded={colFilters.status} onChange={(ex) => setColFilter('status', ex)} align="right" /></div>
                    </div>
                    <div style={{ maxHeight: 430, overflowY: 'auto' }}>
                        {loading ? (
                            <div className="tbl-row" style={{ gridTemplateColumns: '1fr' }}><div className="muted-text">불러오는 중…</div></div>
                        ) : shownEvals.length === 0 ? (
                            <div className="tbl-row" style={{ gridTemplateColumns: '1fr' }}><div className="muted-text">{myEvals.length === 0 ? '평가된 통화가 없습니다.' : onlyNeedsReview ? '대기·검수중인 평가가 없습니다.' : '조건에 맞는 평가가 없습니다.'}</div></div>
                        ) : shownEvals.map((r) => (
                            <div key={r.id} className="tbl-row clickable tc" onClick={() => setSelectedId(r.id)} style={{ gridTemplateColumns: RECENT_COLS, background: selected?.id === r.id ? 'var(--primary-soft)' : undefined }}>
                                <div style={{ lineHeight: 1.35 }}>
                                    <div style={{ fontSize: 12, color: '#475467' }}>{r.date || '-'}</div>
                                    <div style={{ fontSize: 11, color: '#98A2B3' }}>{r.time || ''}</div>
                                </div>
                                <div style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--ink-900)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.agentName || name}</div>
                                <div className="mono" style={{ fontSize: 11, color: 'var(--ink-500)', fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title={r.sessionId}>{r.sessionId}</div>
                                <div>{r.channel ? <ChannelChip channel={r.channel} /> : <span className="muted-text" style={{ fontSize: 11 }}>-</span>}</div>
                                <div className="muted-text" style={{ fontSize: 12, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.team}</div>
                                <div className="muted-text" style={{ fontSize: 12, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.category}</div>
                                <div><span className={`score-chip ${scoreClass(r.score)}`}>{r.score}</span></div>
                                <div><ReviewStatusBadge status={r.status} /></div>
                            </div>
                        ))}
                    </div>
                </div>
            </div>

            {/* 선택 평가 요약 — 팝업 (행 클릭 시) */}
            {selected && (
                <Modal
                    title="평가 요약"
                    width={760}
                    onClose={() => setSelectedId(null)}
                    foot={
                        <>
                            <button className="btn-mini" onClick={() => setSelectedId(null)}>닫기</button>
                            <button
                                className="btn-mini primary"
                                onClick={() => {
                                    if (typeof window !== 'undefined') window.location.hash = `#/detail/${encodeURIComponent(selected.id)}`;
                                }}
                            >
                                <Icon name="external-link" size={12} />상세보기
                            </button>
                        </>
                    }
                >
                    <div className="panel-head" style={{ padding: 0, border: 0, marginBottom: 18 }}>
                        <div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                                <span className="mono" style={{ fontSize: 11, color: 'var(--ink-400)', fontWeight: 700 }}>{selected.sessionId}</span>
                                <ReviewStatusBadge status={selected.status} />
                            </div>
                            <h3>{selected.team}{selected.category && selected.category !== '-' ? ` · ${selected.category}` : ''} · {selected.date} {selected.time}</h3>
                        </div>
                        <div style={{ marginLeft: 'auto' }}>
                            <span className={`score-chip ${scoreClass(selected.score)}`} style={{ fontSize: 30 }}>
                                {selected.score}<span className="max">/100</span>
                            </span>
                        </div>
                    </div>
                    {selectedItems.length === 0
                        ? <div className="muted-text" style={{ fontSize: 12.5 }}>항목별 점수를 불러오는 중이거나, 이 평가에 항목 점수가 없습니다.</div>
                        : <ItemScoreBreakdown items={selectedItems} />}
                </Modal>
            )}

        </div>
    );
}

// 코칭 이력 모달 — 새창 마운트 대응(props 로 coaching 전달). 완료수=튜터(02) 연동, 점수=배정 전/후 평균.
function CounselorHistoryModal({ coaching = [], onClose, windowed = false }) {
    return (
        <Modal title="코칭 이력" width={820} windowed={windowed} onClose={onClose}>
            {coaching.length === 0 ? (
                <div className="muted-text" style={{ padding: '40px 20px', textAlign: 'center', fontSize: 12.5 }}>아직 배정된 코칭이 없습니다.</div>
            ) : (
                <>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
                        <span className="muted-text" style={{ fontSize: 12 }}>
                            배정된 코칭 {coaching.length}회 · 완료 {coaching.filter((c) => (c.total || 0) > 0 && (c.done || 0) >= c.total).length}회
                        </span>
                        <span className="muted-text mono" style={{ marginLeft: 'auto', fontSize: 11 }}>
                            누적 시나리오 {coaching.reduce((a, c) => a + ((c.scenarios && c.scenarios.length) || 0), 0)}개
                        </span>
                    </div>
                    <LearningHistory rows={coaching} />
                </>
            )}
        </Modal>
    );
}

// 코칭 이력 — 본인 배정 코칭 타임라인(실데이터). 영역=코칭명, 완료수=튜터(02) 연동, 점수=배정 전/후 평균.
const LEARNING_PAGE_SIZE = 10;

function LearningHistory({ rows }) {
    const [page, setPage] = useState(0);
    const byArea = rows.reduce((m, r) => { const a = r.title || '코칭'; m[a] = (m[a] || 0) + 1; return m; }, {});
    const repeated = Object.entries(byArea).filter(([, n]) => n > 1).sort((a, b) => b[1] - a[1]);

    // 10건 단위 페이지네이션.
    const totalPages = Math.max(1, Math.ceil(rows.length / LEARNING_PAGE_SIZE));
    const curPage = Math.min(page, totalPages - 1);
    const pageRows = rows.slice(curPage * LEARNING_PAGE_SIZE, (curPage + 1) * LEARNING_PAGE_SIZE);

    return (
        <div>
            {repeated.length > 0 && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', padding: '12px 14px', background: 'var(--background-soft)', borderRadius: 10, marginBottom: 18 }}>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 11.5, fontWeight: 700, color: 'var(--ink-700)' }}>
                        <Icon name="repeat" size={12} style={{ color: 'var(--primary)' }} />자주 배정된 영역
                    </span>
                    {repeated.map(([area, n]) => (
                        <span key={area} className="pill" style={{ background: 'var(--primary-soft)', color: 'var(--primary)', fontSize: 11, fontWeight: 700 }}>
                            {area} <span className="mono">×{n}</span>
                        </span>
                    ))}
                    <span className="muted-text" style={{ fontSize: 11, marginLeft: 'auto' }}>반복이 잦은 영역은 꾸준히 보완이 필요한 부분이에요.</span>
                </div>
            )}

            <div style={{ position: 'relative' }}>
                <div style={{ position: 'absolute', left: 19, top: 8, bottom: 8, width: 2, background: 'var(--border)' }}></div>
                <div style={{ display: 'grid', gap: 4 }}>
                    {pageRows.map((h) => {
                        const total = (h.scenarios && h.scenarios.length) || h.total || 0;
                        const done = h.done || 0;
                        const allDone = total > 0 && done >= total;
                        const isChat = h.channel === 'chat';
                        // 효과측정: 배정 후 콜이 있어야 after 점수 존재(hasAfter). gain은 그때만 의미 있음.
                        const hasScore = h.hasAfter && h.scoreBefore != null && h.scoreAfter != null;
                        const gain = hasScore ? h.scoreAfter - h.scoreBefore : null;
                        return (
                            <div key={h.key || h.id} style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '10px 0' }}>
                                <div style={{ position: 'relative', zIndex: 1, width: 40, flexShrink: 0, display: 'grid', placeItems: 'center' }}>
                                    <div style={{ width: 34, height: 34, borderRadius: 10, background: 'white', border: '1px solid var(--border)', display: 'grid', placeItems: 'center', color: 'var(--primary)' }}>
                                        <Icon name="graduation-cap" size={16} />
                                    </div>
                                </div>
                                <div style={{ flex: 1, minWidth: 0 }}>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                                        <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--ink-900)' }}>{h.title || '코칭'}</span>
                                        {h.assignedAt && <span className="muted-text mono" style={{ fontSize: 11 }}>{h.assignedAt}</span>}
                                    </div>
                                    <div className="muted-text" style={{ fontSize: 11.5, marginTop: 2 }}>
                                        시나리오 {done}/{total} 완료 · {isChat ? '채팅' : '전화'} · {h.assignedBy || '관리자'} 코치
                                    </div>
                                </div>
                                <div style={{ flexShrink: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
                                    {hasScore ? (
                                        <>
                                            <span className="mono" style={{ fontSize: 12, color: 'var(--ink-400)' }}>{h.scoreBefore}</span>
                                            <Icon name="arrow-right" size={12} style={{ color: 'var(--ink-300)' }} />
                                            <span className="mono" style={{ fontSize: 13, fontWeight: 700, color: 'var(--ink-900)' }}>{h.scoreAfter}</span>
                                            <span className="pill" style={{ background: gain > 0 ? '#e8f6ed' : 'var(--muted)', color: gain > 0 ? '#2f9759' : 'var(--ink-500)', fontSize: 10.5, fontWeight: 700 }}>
                                                <Icon name="trending-up" size={10} />{gain > 0 ? `+${gain}` : gain}
                                            </span>
                                        </>
                                    ) : (
                                        <span className="pill" style={{ background: allDone ? '#e8f6ed' : 'var(--muted)', color: allDone ? '#2f9759' : 'var(--ink-500)', fontSize: 10.5, fontWeight: 700 }}>
                                            {allDone ? '완료' : '진행 중'}
                                        </span>
                                    )}
                                </div>
                            </div>
                        );
                    })}
                </div>
            </div>

            {totalPages > 1 && (
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, marginTop: 16 }}>
                    <button className="btn-mini" disabled={curPage === 0} onClick={() => setPage(curPage - 1)} style={{ opacity: curPage === 0 ? 0.45 : 1 }}>
                        <Icon name="chevron-left" size={12} />
                    </button>
                    {Array.from({ length: totalPages }, (_, i) => (
                        <button key={i} className={`btn-mini ${i === curPage ? 'primary' : ''}`} onClick={() => setPage(i)} style={{ minWidth: 30, justifyContent: 'center' }}>
                            {i + 1}
                        </button>
                    ))}
                    <button className="btn-mini" disabled={curPage === totalPages - 1} onClick={() => setPage(curPage + 1)} style={{ opacity: curPage === totalPages - 1 ? 0.45 : 1 }}>
                        <Icon name="chevron-right" size={12} />
                    </button>
                </div>
            )}
        </div>
    );
}
