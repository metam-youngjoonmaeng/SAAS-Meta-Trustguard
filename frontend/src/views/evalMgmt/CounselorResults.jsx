// 상담사 — 내 평가 결과
// 실연동: 내 콜 평가 목록·점수·추이(/api/calls), 항목별 점수(/api/evaluations/:qaId),
//         강점·개선(항목 평균), 배정된 코칭(/api/coaching/mine).
//         감정·대화 품질(/api/me/ta-metrics): 부정발화·금칙어=03 tb_ta_rslt, 회복률=05 qa_call_recovery. (미연동 시 mock 폴백)
import React, { useState, useEffect, useMemo } from 'react';
import { Icon, Gauge, Spark, ChannelChip, ColumnFilter, PageHead, PeriodPicker, Donut, Modal, defaultPeriod } from './ui';
import { scoreClass, LEARNING_HISTORY } from './mockData';
import { fetchCalls, fetchEvaluations, fetchMyCoaching, fetchMyTaMetrics, QA_ACTOR_STORAGE_KEY } from '../../services/api';
import { parseMaxPointsFromValidationTime } from '../../utils/rubricScore';

// 회복률 코멘트 기준: 이 값(%) 이상이면 칭찬, 미만이면 분발 멘트. (운영 중 조절 가능)
const RECOVERY_PRAISE_MIN = 30;

// 배정 코칭 "학습 시작" → 튜터(02-AI-Tutor-ICS) 학습 앱 deep-link. NEXT_PUBLIC_ 이라 빌드 시점 인라인.
const TUTOR_APP_URL = (typeof process !== 'undefined' && process.env.NEXT_PUBLIC_TUTOR_APP_URL) || '';

// 로그인 actor 원본(localStorage). { login_id, auth_source('ics'|'manual'), display_name, ... }
function readActor() {
    if (typeof window === 'undefined') return null;
    try {
        const raw = window.localStorage.getItem(QA_ACTOR_STORAGE_KEY);
        return raw ? JSON.parse(raw) : null;
    } catch {
        return null;
    }
}

// 배정 코칭 → 튜터 deep-link. 튜터(02 page.tsx)가 from=coaching 으로 코칭모드 진입:
//   scenarios=<slug,slug>(자동선택) · mode=call|chat(전화/채팅 프리셋) · since=ISO(배정 이후 완료만 인정) · from=coaching(배너 표시 트리거)
//   userId=userCd@projCd → ICS 로그인 사용자는 튜터가 /auth/ics-sso 자동로그인(로그인창 없음).
function buildTutorLink(g) {
    if (!TUTOR_APP_URL) return null;
    const params = new URLSearchParams();
    const codes = (g.scenarios || []).filter(Boolean).slice(0, 3);
    if (codes.length) params.set('scenarios', codes.join(','));
    params.set('mode', g.channel === 'chat' ? 'chat' : 'call');
    if (g.assignedAtIso) params.set('since', g.assignedAtIso);
    params.set('from', 'coaching');
    const actor = readActor();
    if (actor && actor.auth_source === 'ics' && actor.login_id) {
        params.set('userId', String(actor.login_id));
    }
    return `${TUTOR_APP_URL.replace(/\/+$/, '')}/?${params.toString()}`;
}

// 검수 4단계(qa_calls.review_status, 실데이터): 대기 → 검수중 → 검토요청 → 최종승인.
// (레거시 'completed' 는 최종승인으로 흡수.) — 서버 27_review_workflow.sql 와 동일 상태머신.
const REVIEW_STATUS_META = {
    pending:     { label: '대기',     cls: 'gray' },
    in_review:   { label: '검수중',   cls: 'blue' },
    review_done: { label: '검토요청', cls: 'yellow' },
    approved:    { label: '최종승인', cls: 'green' },
};
const REVIEW_NEEDS_ME = new Set(['pending', 'in_review']);  // 상담사 본인 액션이 남은 단계

function normReviewStatus(s) {
    const v = s === 'completed' ? 'approved' : s;
    return REVIEW_STATUS_META[v] ? v : 'pending';
}

// 검수상태 칩 — 4단계 라벨/색.
function ReviewPill({ status }) {
    const m = REVIEW_STATUS_META[status] || REVIEW_STATUS_META.pending;
    return <span className={`pill ${m.cls}`}><span className="dot"></span>{m.label}</span>;
}

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

// 감정·대화 품질 카드 (부정비율 / 회복률 / 금칙어) — 03 TA + 05 qa_call_recovery 실연동(미연동/무데이터 시 mock 폴백).
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
    const [period, setPeriod] = useState(defaultPeriod('7d'));
    const [evals, setEvals] = useState(null);          // null=로딩
    const [selectedId, setSelectedId] = useState(null);
    const [breakdowns, setBreakdowns] = useState({});  // qa_id → { dimKey: pct }
    const [coaching, setCoaching] = useState([]);
    const [taMetrics, setTaMetrics] = useState(null);  // 03 TA 지표(부정/금칙어). null=로딩
    const [onlyNeedsReview, setOnlyNeedsReview] = useState(false);  // '내 검수 필요'(대기·검수중)만
    const [colFilters, setColFilters] = useState({});  // 컬럼키 → 제외(excluded) Set
    const [learningHistOpen, setLearningHistOpen] = useState(false);  // 학습 이력 팝업
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
    const myTrend = [...scored].reverse().map((r) => r.score).slice(-7);

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
                        <span className="pill blue"><Icon name="trending-up" size={12} />+3.2점 vs 지난주</span>
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
                        <div>
                            <div className="muted-text" style={{ fontSize: 11.5 }}>팀 내 순위</div>
                            <div className="mono" style={{ fontSize: 22, fontWeight: 800 }}>1<span style={{ fontSize: 14, color: 'var(--ink-500)', fontWeight: 600, marginLeft: 2 }}>위 / 6명</span></div>
                        </div>
                        <div>
                            <div className="muted-text" style={{ fontSize: 11.5 }}>평가 받은 통화</div>
                            <div className="mono" style={{ fontSize: 22, fontWeight: 800 }}>{myEvals.length}<span style={{ fontSize: 14, color: 'var(--ink-500)', fontWeight: 600, marginLeft: 2 }}>건</span></div>
                        </div>
                    </div>
                </div>
                <div style={{ width: 220 }}>
                    <div className="muted-text" style={{ fontSize: 11.5, marginBottom: 6 }}>최근 점수 추이</div>
                    {myTrend.length > 1 ? <Spark data={myTrend} color="var(--primary)" height={80} /> : <div className="muted-text" style={{ fontSize: 12 }}>추이 표시에 2건 이상 필요</div>}
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

            {/* 배정된 코칭 플랜 */}
            <div className="panel" style={{ marginBottom: 22 }}>
                <div className="panel-head">
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <div style={{ width: 24, height: 24, borderRadius: 6, background: 'var(--primary-soft)', color: 'var(--primary)', display: 'grid', placeItems: 'center' }}>
                            <Icon name="graduation-cap" size={13} />
                        </div>
                        <h3>배정된 코칭 플랜</h3>
                        <span className="muted-text" style={{ fontSize: 12 }}>· 코치가 직접 지정한 학습 커리큘럼</span>
                    </div>
                    <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8 }}>
                        {coaching.length > 0 && (
                            <span className="pill blue" style={{ fontSize: 10.5 }}>
                                <Icon name="inbox" size={10} />{coaching.length}건 배정됨
                            </span>
                        )}
                        <button className="btn-mini" onClick={() => setLearningHistOpen(true)}>
                            <Icon name="history" size={11} />코칭 이력
                        </button>
                    </div>
                </div>
                <div className="panel-body">
                    {coaching.length === 0 ? (
                        <div style={{ padding: '40px 20px', textAlign: 'center' }}>
                            <div style={{ width: 48, height: 48, borderRadius: 14, background: 'var(--background)', border: '1px solid var(--border)', display: 'grid', placeItems: 'center', color: 'var(--ink-400)', margin: '0 auto 14px' }}>
                                <Icon name="inbox" size={20} />
                            </div>
                            <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--ink-900)', marginBottom: 6 }}>아직 배정된 코칭이 없습니다</div>
                            <div className="muted-text" style={{ fontSize: 12.5, lineHeight: 1.55, maxWidth: 360, margin: '0 auto' }}>코치가 평가 결과를 검토한 뒤 맞춤 학습 커리큘럼을 배정하면 이곳에 표시됩니다.</div>
                        </div>
                    ) : (
                        <div className="grid" style={{ gridTemplateColumns: '1fr 1fr', gap: 14 }}>
                            {coaching.map((g) => {
                                const high = g.priority === 'high';
                                const accent = high ? 'var(--primary)' : '#c67d12';
                                const soft = high ? 'var(--primary-soft)' : '#fdf2e3';
                                const inProgress = g.status === '진행 중';
                                const tutorLabel = g.tutor || ((g.scenarios && g.scenarios.length) ? `시나리오 ${g.scenarios.length}개 연결` : '연결 시나리오 없음');
                                const isChat = g.channel === 'chat';
                                const tutorLink = buildTutorLink(g);
                                const startLearning = () => {
                                    if (!tutorLink) {
                                        alert('튜터 학습 앱 주소가 설정되지 않았습니다. 관리자에게 문의하세요.');
                                        return;
                                    }
                                    if (typeof window !== 'undefined') window.open(tutorLink, '_blank', 'noopener');
                                };
                                return (
                                    <div key={g.key} style={{ border: '1px solid var(--border)', borderRadius: 14, padding: '18px 18px 16px', background: 'white', display: 'flex', flexDirection: 'column', borderTop: `3px solid ${accent}` }}>
                                        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, marginBottom: 12 }}>
                                            <div style={{ width: 40, height: 40, borderRadius: 11, background: soft, color: accent, display: 'grid', placeItems: 'center', flexShrink: 0 }}>
                                                <Icon name={g.icon || 'graduation-cap'} size={19} />
                                            </div>
                                            <div style={{ flex: 1, minWidth: 0 }}>
                                                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 3, flexWrap: 'wrap' }}>
                                                    <span style={{ fontSize: 14.5, fontWeight: 700, color: 'var(--ink-900)' }}>{g.title}</span>
                                                    <span className="pill" style={{ background: soft, color: accent, fontSize: 10, fontWeight: 700 }}>
                                                        <Icon name="inbox" size={9} />{g.status || '배정됨'}
                                                    </span>
                                                </div>
                                                <div className="muted-text" style={{ fontSize: 11.5 }}>
                                                    <Icon name="user" size={10} style={{ verticalAlign: '-1px', marginRight: 3 }} />
                                                    {g.assignedBy || '관리자'} 배정{g.assignedAt ? ` · ${g.assignedAt}` : ''}
                                                </div>
                                            </div>
                                        </div>

                                        {Array.isArray(g.items) && g.items.length > 0 && (
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
                                        )}

                                        <div style={{ marginTop: 'auto', display: 'flex', alignItems: 'center', gap: 10, paddingTop: 14, borderTop: '1px solid var(--border)' }}>
                                            <span className="pill" style={{ background: isChat ? '#eef6ee' : 'var(--primary-soft)', color: isChat ? '#3a7a3a' : 'var(--primary)', fontSize: 10.5, fontWeight: 700, flexShrink: 0 }}>
                                                <Icon name={isChat ? 'message-square' : 'phone'} size={10} />{isChat ? '채팅 학습' : '전화 학습'}
                                            </span>
                                            <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--ink-900)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', minWidth: 0 }}>{tutorLabel}</span>
                                            <button className="btn-mini primary" style={{ marginLeft: 'auto', flexShrink: 0 }} onClick={startLearning}>
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
                                <div><ReviewPill status={r.status} /></div>
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
                                <ReviewPill status={selected.status} />
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

            {/* 학습 이력 — 팝업 (코칭 이력 버튼으로 열림). 학습 누적기록은 현재 mock(LEARNING_HISTORY). */}
            {learningHistOpen && (
                <Modal title="학습 이력" width={820} onClose={() => setLearningHistOpen(false)}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
                        <span className="muted-text" style={{ fontSize: 12 }}>지금까지 완료한 코칭 {LEARNING_HISTORY.length}회</span>
                        <span className="muted-text mono" style={{ marginLeft: 'auto', fontSize: 11 }}>
                            누적 {LEARNING_HISTORY.reduce((a, h) => a + h.minutes, 0)}분 · 시나리오 {LEARNING_HISTORY.reduce((a, h) => a + h.scenarios, 0)}개
                        </span>
                    </div>
                    <LearningHistory rows={LEARNING_HISTORY} />
                </Modal>
            )}
        </div>
    );
}

// 학습 이력 — 타임라인 + 반복 학습 영역 요약 (현재 mock 데이터 기반)
function LearningHistory({ rows }) {
    const byArea = rows.reduce((m, r) => { m[r.area] = (m[r.area] || 0) + 1; return m; }, {});
    const repeated = Object.entries(byArea).filter(([, n]) => n > 1).sort((a, b) => b[1] - a[1]);

    return (
        <div>
            {repeated.length > 0 && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', padding: '12px 14px', background: 'var(--background-soft)', borderRadius: 10, marginBottom: 18 }}>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 11.5, fontWeight: 700, color: 'var(--ink-700)' }}>
                        <Icon name="repeat" size={12} style={{ color: 'var(--primary)' }} />자주 학습한 영역
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
                    {rows.map((h) => {
                        const gain = h.scoreAfter - h.scoreBefore;
                        return (
                            <div key={h.id} style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '10px 0' }}>
                                <div style={{ position: 'relative', zIndex: 1, width: 40, flexShrink: 0, display: 'grid', placeItems: 'center' }}>
                                    <div style={{ width: 34, height: 34, borderRadius: 10, background: 'white', border: '1px solid var(--border)', display: 'grid', placeItems: 'center', color: 'var(--primary)' }}>
                                        <Icon name={h.icon} size={16} />
                                    </div>
                                </div>
                                <div style={{ flex: 1, minWidth: 0 }}>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                                        <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--ink-900)' }}>{h.area}</span>
                                        <span className="muted-text mono" style={{ fontSize: 11 }}>{h.date}</span>
                                    </div>
                                    <div className="muted-text" style={{ fontSize: 11.5, marginTop: 2 }}>
                                        시나리오 {h.scenarios}개 · FAQ {h.faq}문항 · {h.minutes}분 · {h.by} 코치
                                    </div>
                                </div>
                                <div style={{ flexShrink: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
                                    <span className="mono" style={{ fontSize: 12, color: 'var(--ink-400)' }}>{h.scoreBefore}</span>
                                    <Icon name="arrow-right" size={12} style={{ color: 'var(--ink-300)' }} />
                                    <span className="mono" style={{ fontSize: 13, fontWeight: 700, color: 'var(--ink-900)' }}>{h.scoreAfter}</span>
                                    <span className="pill" style={{ background: gain > 0 ? '#e8f6ed' : 'var(--muted)', color: gain > 0 ? '#2f9759' : 'var(--ink-500)', fontSize: 10.5, fontWeight: 700 }}>
                                        <Icon name="trending-up" size={10} />+{gain}
                                    </span>
                                </div>
                            </div>
                        );
                    })}
                </div>
            </div>
        </div>
    );
}
