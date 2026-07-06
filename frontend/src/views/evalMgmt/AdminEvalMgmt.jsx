// 관리자/슈퍼관리자 — 평가 관리 (디자인 프로토타입 etc/pages-admin.jsx 의 AdminEvalMgmt 외 포팅)
// 평가 목록·필터·승인(AdminResults) + 코칭 배정(CoachingPanel/Carousel/MiniCard/DetailModal/CreateModal)
import React, { useState, useEffect } from 'react';
import { Icon, PageHead, PeriodPicker, Modal, Gauge, StatusPill, ScoreBreakdown, Avatar, ChannelChip, ColumnFilter, defaultPeriod, openInWindow, openCallDetail } from './ui';
import { DIMENSIONS, scoreClass, fmtNum, TUTOR_CATEGORIES, TUTOR_SCENARIOS, COUNSELORS, scenById, catMeta } from './mockData';
import { fetchCalls, fetchAgents, fetchCoaching, createCoaching, deleteCoaching, archiveCoaching, fetchCoachingHistory, fetchAgentCalls } from '../../services/api';
import { formatDateTime } from '../../utils/formatters';
import { DEFAULT_TOTAL_MAX } from '../../constants';
import * as XLSX from 'xlsx';

// 점수 구간(우수/보통/코칭) 임계값은 활성 브랜드 만점(콜 total_max 최대값) 기준 90%/75% 로
// AdminResults 내부에서 동적 산출. 사용자 생성 평가 트랙(임의 만점)도 자동 반영 — 고정 80 폴백 제거.

// /api/calls(실데이터) 한 행 → 평가목록 행 모양으로 변환.
//   평가 ID 개념이 없으므로 상담번호(UID)를 사용. 채널은 io_divi(I/O) → inbound/outbound.
//   코칭/항목별 점수·요약은 백엔드 미존재 → 비움(이번 범위는 목록만).
const AV_POOL = ['av-1', 'av-2', 'av-3', 'av-4', 'av-5', 'av-6'];
// 검수 4단계(pending/in_review/review_done/approved) → 평가목록 UI 상태(pending/reviewed/completed).
//   approved(최종승인)만 '완료'. review_done(검토요청)·in_review(검수중)은 '검수중'으로 묶음. 레거시 completed→완료.
const REVIEW_TO_STATUS = {
    pending: 'pending',
    in_review: 'reviewed',
    review_done: 'reviewed',
    admin_revised: 'reviewed',
    objection: 'reviewed',
    approved: 'completed',
    completed: 'completed',
};
function hashAv(key) {
    const s = String(key || '');
    let h = 0;
    for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
    return AV_POOL[h % AV_POOL.length];
}
function adaptCall(c) {
    const dt = String(c.call_datetime || '');
    const score = Math.round(Number(c.total_score ?? c.ai_score ?? 0));
    return {
        id: c.qa_id,
        sessionId: c.uid || c.qa_id,                 // 상담번호(ICS UID)
        counselor: c.agent_code || '',
        name: c.agent_name || c.agent_code || '미지정',
        avId: hashAv(c.agent_code || c.qa_id),
        callDatetime: c.call_datetime || null,       // 원본 상담일시(평가리스트와 동일 포맷 표시용)
        date: dt.slice(0, 10),
        time: dt.slice(11, 16),
        duration: c.duration_sec ? `${Math.floor(c.duration_sec / 60)}:${String(c.duration_sec % 60).padStart(2, '0')}` : '-',
        channel: c.channel || null,                  // 'inbound' | 'outbound' | null
        team: c.department || '-',
        category: c.consultation_type || '-',
        score,
        total_max: Number(c.total_max) > 0 ? Number(c.total_max) : null,
        scores: {},
        status: REVIEW_TO_STATUS[c.review_status] || 'pending',
        reviewStatus: c.review_status || 'pending',   // 원본 상태값(승인 버튼 게이트용)
        reviewRound: Number(c.review_round ?? 0),     // N차 검토 표시용
        reviewer: null,
        summary: '',
        selfReview: null,
        approved: c.review_status === 'approved' || c.review_status === 'completed',
    };
}

// ─────────────────────────────────────────────────────
// 코칭 우선순위 / 프리셋 상수
// ─────────────────────────────────────────────────────
const COACH_PRIORITY = {
    high: { label: '우선순위 높음', accent: 'var(--primary)', soft: 'var(--primary-soft)', flat: 'var(--primary-soft-flat)' },
    mid: { label: '이번달 목표', accent: '#c67d12', soft: '#fdf2e3', flat: '#f6e2c4' },
};

const COACH_PRESETS = {
    emotion: { title: '감정 컨트롤 · 회복 응대', priority: 'high', icon: 'heart-pulse', scenarios: ['S18', 'S20'], items: ['강한 클레임 상황 시뮬레이션 3회 진행', '공감·인정 표현 스크립트 10종 숙지', '감정 라벨링 후 재진술 연습'] },
    followup: { title: '후속 안내 · 클로징 강화', priority: 'mid', icon: 'phone-forwarded', scenarios: ['S2', 'S8'], items: ['클로징 체크리스트 적용 (추가문의·재안내·인사)', '모범 마무리 통화 5건 청취'] },
    lead: { title: '두괄식 결론 전달', priority: 'mid', icon: 'list-ordered', scenarios: ['S1', 'S3'], items: ['결론–근거–안내 3단 구조 템플릿 학습', '모범 통화 5건 청취 후 셀프 리뷰'] },
    needs: { title: '니즈 파악 · 복창', priority: 'high', icon: 'list-checks', scenarios: ['S24', 'S27'], items: ['핵심 복창 체크포인트 셀프 점검 루틴', '니즈 정리 질문 5종 숙지'] },
    polite: { title: '정중한 표현 · 어법', priority: 'mid', icon: 'message-circle', scenarios: ['S15', 'S19'], items: ['단정적 거절 대신 대안 제시 화법 연습', '정중 표현 스크립트 숙지'] },
};

// ─────────────────────────────────────────────────────
// 평가 관리 — 평가 결과 + 코칭 배정을 한 화면에서
// ─────────────────────────────────────────────────────
export default function AdminEvalMgmt() {
    // 코칭 배정 — coaching_assignments(DB, org 스코프) 실연동. 관리자끼리 공유되며 상담사 본인화면(/api/coaching/mine)과 연결.
    const [coaching, setCoaching] = useState([]);
    const [results, setResults] = useState(null); // null=로딩, []=없음
    const [agents, setAgents] = useState([]);     // 실제 상담사(코칭 대상/멤버 소스)

    const reloadCoaching = async () => {
        try {
            const data = await fetchCoaching();
            return Array.isArray(data) ? data : [];
        } catch (e) {
            console.error('코칭 목록 로딩 실패:', e);
            return [];
        }
    };

    // 평가목록 재조회 — 삭제 등 변경 후 서버 기준으로 갱신(초기 로딩 effect 와 동일 매핑).
    const reloadCalls = async () => {
        try {
            const data = await fetchCalls();
            setResults((Array.isArray(data) ? data : []).map(adaptCall));
        } catch (e) {
            console.error('평가목록 로딩 실패:', e);
            setResults([]);
        }
    };

    useEffect(() => {
        let cancelled = false;
        (async () => {
            try {
                const data = await fetchCalls(); // 실 상담콜(qa_calls)
                if (!cancelled) setResults((Array.isArray(data) ? data : []).map(adaptCall));
            } catch (e) {
                console.error('평가목록 로딩 실패:', e);
                if (!cancelled) setResults([]);
            }
        })();
        (async () => {
            try {
                const data = await fetchAgents(); // 실제 상담사(admin_users + qa_calls)
                // Avatar 색상용 av 부여(실DB엔 없음) — id 기반 해시.
                if (!cancelled) setAgents((Array.isArray(data) ? data : []).map((a) => ({ ...a, av: hashAv(a.id || a.user_id) })));
            } catch (e) {
                console.error('상담사 목록 로딩 실패:', e);
                if (!cancelled) setAgents([]);
            }
        })();
        (async () => {
            const list = await reloadCoaching(); // 조직 전체 코칭(관리자 공유)
            if (!cancelled) setCoaching(list);
        })();
        return () => { cancelled = true; };
    }, []);

    // DB 코칭은 모두 '배정됨'(assigned) 상태 — 생성=배정이므로 '배정 취소'는 해당 배정을 삭제 처리.
    const assign = () => {};
    const unassign = (key) => removeItem(key);
    const removeItem = async (key) => {
        const row = coaching.find((g) => g.key === key);
        const id = row?.id ?? key;
        setCoaching((list) => list.filter((g) => g.key !== key)); // 낙관적 제거
        try {
            await deleteCoaching(id);
        } catch (e) {
            console.error('코칭 삭제 실패:', e);
            setCoaching(await reloadCoaching()); // 실패 시 서버 상태로 복구
        }
    };
    // 전원 학습완료 카드 정리(X) — 보드에서만 숨김(아카이브). 코칭 이력엔 그대로 유지.
    const archiveItem = async (key) => {
        const row = coaching.find((g) => g.key === key);
        const id = row?.id ?? key;
        setCoaching((list) => list.filter((g) => g.key !== key)); // 낙관적 제거
        try {
            await archiveCoaching(id);
        } catch (e) {
            console.error('코칭 정리(아카이브) 실패:', e);
            setCoaching(await reloadCoaching()); // 실패 시 서버 상태로 복구
        }
    };
    const addCoaching = async (entry) => {
        try {
            await createCoaching(entry); // DB 저장(POST /api/coaching)
        } catch (e) {
            console.error('코칭 생성 실패:', e);
            alert('코칭 배정 저장에 실패했습니다.');
        }
        setCoaching(await reloadCoaching()); // 서버 기준으로 갱신(관리자 공유 일관성)
    };

    return (
        <div>
            <PageHead eyebrow="관리자 · 평가 관리" title="평가 관리" sub="조직 전체 평가 데이터를 분석하고, 취약 상담사에게 코칭을 배정합니다." />
            {/* 상단 '코칭 배정' 중복 버튼 제거 — 아래 코칭 패널의 '새 코칭 배정' 버튼으로 일원화 */}

            <AdminResults
                embedded
                results={results || []}
                loading={results === null}
                onReload={reloadCalls}
                beforeList={<CoachingPanel coaching={coaching} agents={agents} onAssign={assign} onUnassign={unassign} onRemove={removeItem} onArchive={archiveItem} onNew={() => openCoachingWindow({ agents, onCreate: addCoaching })} />}
            />
        </div>
    );
}

// 코칭 배정 섹션 — 요약 카드 리스트 (클릭 시 상세 모달)
function CoachingPanel({ coaching, agents = [], onAssign, onUnassign, onRemove, onArchive, onNew }) {
    const [openKey, setOpenKey] = useState(null);
    // 코칭 members 는 숫자 user_id(coaching_assignments.members) — agents 의 user_id 로 매칭(agents.id 는 agent_code 라 불일치).
    const memberObjs = (ids) => ids.map((id) => agents.find((c) => c.user_id === id)).filter(Boolean);

    // 진행 중인 코칭 — 학습 완료(allDone) 카드는 항상 맨 뒤로(미완료 먼저, 완료 나중). 그 외 순서는 유지.
    const active = coaching.filter((g) => g.assigned).sort((a, b) => (a.allDone ? 1 : 0) - (b.allDone ? 1 : 0));
    const pending = coaching.filter((g) => !g.assigned);
    const openItem = coaching.find((g) => g.key === openKey) || null;

    return (
        <div className="panel" style={{ marginTop: 22, marginBottom: 24 }}>
            <div className="panel-head">
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <div style={{ width: 24, height: 24, borderRadius: 6, background: 'var(--primary-soft)', color: 'var(--primary)', display: 'grid', placeItems: 'center' }}>
                        <Icon name="graduation-cap" size={13} />
                    </div>
                    <h3>코칭 배정</h3>
                    <span className="muted-text" style={{ fontSize: 12 }}>· 진행 {active.length} · 배정 대기 {pending.length}</span>
                </div>
                <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8 }}>
                    <button className="btn-mini" onClick={() => openCoachingHistoryWindow()}>
                        <Icon name="history" size={11} />코칭 이력
                    </button>
                    <button className="btn-mini primary" onClick={onNew}>
                        <Icon name="plus" size={11} />새 코칭 배정
                    </button>
                </div>
            </div>
            <div className="panel-body" style={{ display: 'grid', gap: 18 }}>
                {active.length > 0 && (
                    <CoachingCarousel label={<>진행 중인 코칭 · {active.length}</>} items={active} memberObjs={memberObjs} onOpen={setOpenKey} onArchive={onArchive} />
                )}
                {pending.length > 0 && (
                    <CoachingCarousel
                        label={
                            <>
                                <Icon name="sparkles" size={11} style={{ color: 'var(--ink-400)' }} /> 추천 교육 그룹 · 배정 대기 {pending.length}
                            </>
                        }
                        items={pending}
                        memberObjs={memberObjs}
                        onOpen={setOpenKey}
                    />
                )}
                {active.length === 0 && pending.length === 0 && (
                    <div style={{ padding: '32px 20px', textAlign: 'center' }}>
                        <div className="muted-text" style={{ fontSize: 12.5 }}>아직 코칭이 없습니다. "새 코칭 배정"으로 추가하세요.</div>
                    </div>
                )}
            </div>

            {openItem && (
                <CoachingDetailModal
                    g={openItem}
                    members={memberObjs(openItem.members)}
                    onClose={() => setOpenKey(null)}
                    onAssign={onAssign}
                    onUnassign={(k) => {
                        if (typeof window !== 'undefined' && !window.confirm('이 코칭 배정을 취소할까요? 배정이 삭제됩니다.')) return;
                        onUnassign(k);
                        setOpenKey(null);
                    }}
                    onRemove={(k) => {
                        onRemove(k);
                        setOpenKey(null);
                    }}
                />
            )}
        </div>
    );
}

// 코칭 이력 — 상담사별 누적 코칭 기록 + 점수 개선폭 (실데이터: /api/coaching/history).
// row: { id, counselorId, counselorName, team, area, date, by, channel, scenarios, scoreBefore, scoreAfter, hasAfter }
const HISTORY_PAGE_SIZE = 10;

function CoachingHistory({ rows }) {
    const [openId, setOpenId] = useState(null);
    const [page, setPage] = useState(0);
    if (!rows.length) return null;
    const fmtScore = (v) => (v == null ? '–' : v);

    const groups = {};
    rows.forEach((r) => { (groups[r.counselorId] = groups[r.counselorId] || []).push(r); });
    const list = Object.entries(groups).map(([cid, hs]) => {
        const sorted = [...hs].sort((a, b) => String(b.date).localeCompare(String(a.date)));
        const byDateAsc = [...hs].sort((a, b) => String(a.date).localeCompare(String(b.date)));
        const areaCount = hs.reduce((m, h) => { m[h.area] = (m[h.area] || 0) + 1; return m; }, {});
        const mainArea = Object.entries(areaCount).sort((a, b) => b[1] - a[1])[0];
        // 점수 변화: 가장 이른 코칭의 배정전 평균 → 가장 늦은 코칭의 배정후 평균(있는 값만).
        const firstScore = byDateAsc.find((h) => h.scoreBefore != null)?.scoreBefore ?? null;
        const lastScore = sorted.find((h) => h.scoreAfter != null)?.scoreAfter ?? null;
        const gain = (firstScore != null && lastScore != null) ? lastScore - firstScore : null;
        const ongoing = hs.some((h) => !h.hasAfter);   // 배정 후 콜 없음 = 효과측정 전(진행 중)
        const name = hs[0].counselorName || String(cid);
        const team = hs[0].team || '-';
        return { cid, name, team, hs: sorted, count: hs.length, mainArea: mainArea[0], mainAreaN: mainArea[1], firstScore, lastScore, gain, ongoing };
    }).sort((a, b) => b.count - a.count);

    // 상담사 카드 10개 단위 페이지네이션 — 목록이 줄어 현재 페이지가 비면 마지막 페이지로 보정.
    const totalPages = Math.max(1, Math.ceil(list.length / HISTORY_PAGE_SIZE));
    const curPage = Math.min(page, totalPages - 1);
    const pageList = list.slice(curPage * HISTORY_PAGE_SIZE, (curPage + 1) * HISTORY_PAGE_SIZE);

    return (
        <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
                <span className="muted-text" style={{ fontSize: 11 }}>상담사를 누르면 받은 코칭 내역이 펼쳐집니다 · 점수는 배정 전/후 평가 평균</span>
            </div>

            <div style={{ display: 'grid', gap: 10 }}>
                {pageList.map((g) => {
                    const open = openId === g.cid;
                    return (
                        <div key={g.cid} style={{ border: '1px solid var(--border)', borderRadius: 12, background: 'white', overflow: 'hidden' }}>
                            <button
                                onClick={() => setOpenId(open ? null : g.cid)}
                                style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 14, padding: '14px 16px', background: open ? 'var(--background-soft)' : 'white', border: 0, cursor: 'pointer', fontFamily: 'inherit', textAlign: 'left' }}
                            >
                                <Avatar id={hashAv(g.cid)} name={g.name} />
                                <div style={{ minWidth: 0, width: 150 }}>
                                    <div style={{ fontSize: 13.5, fontWeight: 700, color: 'var(--ink-900)' }}>{g.name}</div>
                                    <div className="muted-text" style={{ fontSize: 11, marginTop: 1 }}>{g.team} · 코칭 {g.count}회</div>
                                </div>
                                <div style={{ flex: 1, minWidth: 0 }}>
                                    <div className="muted-text" style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.04em', marginBottom: 3 }}>주 문제 영역</div>
                                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                                        <span style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--ink-900)' }}>{g.mainArea}</span>
                                        {g.mainAreaN > 1 && (
                                            <span className="pill" style={{ background: '#fff3e0', color: '#b27a14', fontSize: 9.5, fontWeight: 700 }}>
                                                <Icon name="repeat" size={9} />×{g.mainAreaN}
                                            </span>
                                        )}
                                    </span>
                                </div>
                                <div style={{ flexShrink: 0, textAlign: 'right' }}>
                                    <div className="muted-text" style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.04em', marginBottom: 3 }}>점수 변화</div>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, justifyContent: 'flex-end' }}>
                                        <span className="mono" style={{ fontSize: 11.5, color: 'var(--ink-400)' }}>{fmtScore(g.firstScore)}</span>
                                        <Icon name="arrow-right" size={11} style={{ color: 'var(--ink-300)' }} />
                                        <span className="mono" style={{ fontSize: 13, fontWeight: 700, color: 'var(--ink-900)' }}>{fmtScore(g.lastScore)}</span>
                                        {g.gain != null && (
                                            <span className="pill" style={{ background: g.gain > 0 ? '#e8f6ed' : 'var(--muted)', color: g.gain > 0 ? '#2f9759' : 'var(--ink-500)', fontSize: 10, fontWeight: 700 }}>
                                                <Icon name={g.gain > 0 ? 'trending-up' : g.gain < 0 ? 'trending-down' : 'minus'} size={9} />{g.gain > 0 ? `+${g.gain}` : g.gain}
                                            </span>
                                        )}
                                    </div>
                                </div>
                                {g.ongoing && (
                                    <span className="pill" style={{ background: 'var(--primary-soft)', color: 'var(--primary)', fontSize: 10, fontWeight: 700, flexShrink: 0 }}>진행 중</span>
                                )}
                                <Icon name={open ? 'chevron-up' : 'chevron-down'} size={16} style={{ color: 'var(--ink-400)', flexShrink: 0 }} />
                            </button>

                            {open && (
                                <div style={{ borderTop: '1px solid var(--border)', padding: '6px 16px 12px' }}>
                                    {g.hs.map((h, i) => {
                                        const gain = (h.scoreBefore != null && h.scoreAfter != null) ? h.scoreAfter - h.scoreBefore : null;
                                        return (
                                            <div key={h.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '11px 0', borderBottom: i < g.hs.length - 1 ? '1px dashed var(--border)' : 'none' }}>
                                                <div style={{ width: 30, height: 30, borderRadius: 9, background: 'var(--background)', display: 'grid', placeItems: 'center', color: 'var(--primary)', flexShrink: 0 }}>
                                                    <Icon name="graduation-cap" size={15} />
                                                </div>
                                                <div style={{ flex: 1, minWidth: 0 }}>
                                                    <div style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--ink-900)' }}>{h.area}</div>
                                                    <div className="muted-text" style={{ fontSize: 10.5, marginTop: 1 }}>{h.date} · {h.by} 배정 · {h.channel === 'chat' ? '채팅' : '전화'}</div>
                                                </div>
                                                {h.done == null ? (
                                                    <span className="pill" style={{ background: 'var(--primary-soft)', color: 'var(--primary)', fontSize: 10, fontWeight: 700, flexShrink: 0 }}>
                                                        <Icon name="list-checks" size={9} />시나리오 {h.scenarios}개
                                                    </span>
                                                ) : (() => {
                                                    const allDone = h.scenarios > 0 && h.done >= h.scenarios;
                                                    return (
                                                        <span className="pill" style={{ background: allDone ? '#e8f6ed' : 'var(--primary-soft)', color: allDone ? '#2f9759' : 'var(--primary)', fontSize: 10, fontWeight: 700, flexShrink: 0 }}>
                                                            <Icon name={allDone ? 'check' : 'loader'} size={9} />{h.done}/{h.scenarios} {allDone ? '완료' : '진행'}
                                                        </span>
                                                    );
                                                })()}
                                                <div style={{ display: 'flex', alignItems: 'center', gap: 5, flexShrink: 0, width: 110, justifyContent: 'flex-end' }}>
                                                    <span className="mono" style={{ fontSize: 11, color: 'var(--ink-400)' }}>{fmtScore(h.scoreBefore)}</span>
                                                    <Icon name="arrow-right" size={10} style={{ color: 'var(--ink-300)' }} />
                                                    <span className="mono" style={{ fontSize: 12, fontWeight: 700, color: 'var(--ink-900)' }}>{h.hasAfter ? h.scoreAfter : '측정 전'}</span>
                                                    {gain != null && gain > 0 && <span className="mono" style={{ fontSize: 10.5, fontWeight: 700, color: '#2f9759' }}>+{gain}</span>}
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>
                            )}
                        </div>
                    );
                })}
            </div>

            {totalPages > 1 && (
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, marginTop: 16 }}>
                    <button
                        className="btn-mini"
                        disabled={curPage === 0}
                        onClick={() => { setPage(curPage - 1); setOpenId(null); }}
                        style={{ opacity: curPage === 0 ? 0.45 : 1 }}
                    >
                        <Icon name="chevron-left" size={12} />
                    </button>
                    {Array.from({ length: totalPages }, (_, i) => (
                        <button
                            key={i}
                            className={`btn-mini ${i === curPage ? 'primary' : ''}`}
                            onClick={() => { setPage(i); setOpenId(null); }}
                            style={{ minWidth: 30, justifyContent: 'center' }}
                        >
                            {i + 1}
                        </button>
                    ))}
                    <button
                        className="btn-mini"
                        disabled={curPage === totalPages - 1}
                        onClick={() => { setPage(curPage + 1); setOpenId(null); }}
                        style={{ opacity: curPage === totalPages - 1 ? 0.45 : 1 }}
                    >
                        <Icon name="chevron-right" size={12} />
                    </button>
                </div>
            )}
        </div>
    );
}

// 좌우 이전/다음 버튼으로 그룹을 넘겨 보는 캐러셀
function CoachingCarousel({ label, items, memberObjs, onOpen, onArchive }) {
    const ref = React.useRef(null);
    const [atStart, setAtStart] = useState(true);
    const [atEnd, setAtEnd] = useState(false);

    const update = () => {
        const el = ref.current;
        if (!el) return;
        setAtStart(el.scrollLeft <= 2);
        setAtEnd(el.scrollLeft + el.clientWidth >= el.scrollWidth - 2);
    };
    React.useEffect(() => {
        update();
    }, [items.length]);
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
            style={{ flexShrink: 0, alignSelf: 'center', width: 32, height: 32, borderRadius: '50%', display: 'grid', placeItems: 'center', background: 'white', border: '1px solid var(--border)', boxShadow: 'var(--shadow-sm)', color: disabled ? 'var(--ink-300)' : 'var(--ink-700)', cursor: disabled ? 'default' : 'pointer', opacity: disabled ? 0.5 : 1, transition: 'border-color var(--t-base), color var(--t-base)' }}
        >
            <Icon name={dir < 0 ? 'chevron-left' : 'chevron-right'} size={16} />
        </button>
    );

    return (
        <div style={{ minWidth: 0 }}>
            <div className="eyebrow" style={{ fontSize: 10.5, display: 'inline-flex', alignItems: 'center', gap: 6, marginBottom: 10 }}>{label}</div>
            <div style={{ display: 'flex', alignItems: 'stretch', gap: 10, minWidth: 0 }}>
                {canScroll && sideBtn(-1, atStart)}
                <div ref={ref} className="no-scrollbar" onScroll={update} style={{ flex: 1, minWidth: 0, display: 'flex', gap: 12, overflowX: canScroll ? 'auto' : 'visible', scrollSnapType: 'x mandatory', paddingBottom: 2 }}>
                    {items.map((g) => (
                        <div key={g.key} style={{ flex: '0 0 calc((100% - 24px) / 3)', minWidth: 0, scrollSnapAlign: 'start' }}>
                            <CoachingMiniCard g={g} members={memberObjs(g.members)} onOpen={() => onOpen(g.key)} onArchive={onArchive} />
                        </div>
                    ))}
                </div>
                {canScroll && sideBtn(1, atEnd)}
            </div>
        </div>
    );
}

// 요약 카드 — 제목 · 상태 · 대상 인원만, 클릭 시 상세
function CoachingMiniCard({ g, members, onOpen, onArchive }) {
    const p = COACH_PRIORITY[g.priority] || COACH_PRIORITY.mid;
    const shown = members.slice(0, 4);
    const measurable = g.membersDone != null && g.membersTotal > 0;  // 튜터 완료 조회 가능(진행률 표시 가능)
    const pct = measurable ? Math.round((g.membersDone / g.membersTotal) * 100) : 0;
    // 시나리오 칩 — 카드는 약 2줄(최대 4칩)까지만, 초과분은 "… 외 N건". 전체는 카드 클릭(상세)에서 확인.
    const allScen = Array.isArray(g.scenarios) ? g.scenarios : [];
    const MAX_CHIPS = 4;
    const scenOverflow = allScen.length > MAX_CHIPS ? allScen.length - (MAX_CHIPS - 1) : 0;
    const visibleScen = scenOverflow ? allScen.slice(0, MAX_CHIPS - 1) : allScen;
    return (
        <button
            onClick={onOpen}
            className="hover-lift"
            style={{ width: '100%', height: '100%', boxSizing: 'border-box', textAlign: 'left', cursor: 'pointer', fontFamily: 'inherit', border: '1px solid var(--border)', borderRadius: 14, padding: '14px 16px', background: 'white', borderTop: `3px solid ${p.accent}`, display: 'flex', flexDirection: 'column', gap: 12 }}
        >
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <div style={{ width: 34, height: 34, borderRadius: 10, background: p.soft, color: p.accent, display: 'grid', placeItems: 'center', flexShrink: 0 }}>
                    <Icon name={g.icon} size={16} />
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13.5, fontWeight: 700, color: 'var(--ink-900)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{g.title}</div>
                    <div style={{ marginTop: 3 }}>
                        {g.allDone ? (
                            <span className="pill green" style={{ fontSize: 9.5 }}>
                                <Icon name="check" size={9} />학습 완료
                            </span>
                        ) : measurable ? (
                            <span className="pill" style={{ background: 'var(--muted)', color: 'var(--ink-600)', fontSize: 9.5, fontWeight: 700 }}>
                                <Icon name="loader" size={9} />{g.membersDone}/{g.membersTotal}명 완료
                            </span>
                        ) : g.assigned ? (
                            <span className="pill green" style={{ fontSize: 9.5 }}>
                                <Icon name="check" size={9} />{g.status || '배정됨'}
                            </span>
                        ) : (
                            <span className="pill" style={{ background: p.soft, color: p.accent, fontSize: 9.5, fontWeight: 700 }}>{p.label}</span>
                        )}
                    </div>
                </div>
                {/* 전원 학습완료 시에만 'X'로 보드에서 정리(아카이브) — 코칭 이력엔 유지. 나머지는 상세 진입 화살표. */}
                {g.allDone ? (
                    <span
                        role="button"
                        tabIndex={0}
                        onClick={(e) => { e.stopPropagation(); onArchive?.(g.key); }}
                        title="완료된 코칭을 보드에서 정리합니다 (코칭 이력엔 유지됩니다)"
                        style={{ flexShrink: 0, width: 24, height: 24, borderRadius: 7, display: 'grid', placeItems: 'center', color: 'var(--ink-400)', cursor: 'pointer' }}
                    >
                        <Icon name="x" size={14} />
                    </span>
                ) : (
                    <Icon name="chevron-right" size={16} style={{ color: 'var(--ink-400)', flexShrink: 0 }} />
                )}
            </div>
            {measurable && (
                <div style={{ height: 4, borderRadius: 999, background: 'var(--muted)', overflow: 'hidden' }}>
                    <div style={{ height: '100%', width: `${pct}%`, background: g.allDone ? '#12B76A' : 'var(--primary)', borderRadius: 999, transition: 'width var(--t-base)' }} />
                </div>
            )}
            {allScen.length > 0 && (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
                    {visibleScen.map((code) => {
                        const s = TUTOR_SCENARIOS.find((x) => x.code === code) || { code, title: code };
                        return (
                            <span key={code} className="pill" style={{ background: 'var(--background-soft)', color: 'var(--ink-600)', fontSize: 10, fontWeight: 600, border: '1px solid var(--border)', maxWidth: '47%' }}>
                                <Icon name="sparkles" size={9} style={{ color: 'var(--ink-400)', flexShrink: 0 }} />
                                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.title}</span>
                            </span>
                        );
                    })}
                    {scenOverflow > 0 && (
                        <span className="pill" style={{ background: 'transparent', color: 'var(--ink-400)', fontSize: 10, fontWeight: 600, border: 'none' }}>… 외 {scenOverflow}건</span>
                    )}
                </div>
            )}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, paddingTop: 11, marginTop: 'auto', borderTop: '1px solid var(--border)' }}>
                <div style={{ display: 'flex' }}>
                    {shown.map((m, i) => (
                        <span key={m.id} style={{ marginLeft: i === 0 ? 0 : -8, borderRadius: '50%', boxShadow: '0 0 0 2px white', display: 'inline-flex' }}>
                            <Avatar id={m.av} name={m.name} />
                        </span>
                    ))}
                </div>
                <span className="muted-text" style={{ fontSize: 11.5 }}>{g.targetType === 'individual' ? '개인' : '그룹'} · {members.length}명</span>
                <span className="muted-text" style={{ fontSize: 11, marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                    <Icon name="list-checks" size={11} />{g.items.length}
                </span>
            </div>
        </button>
    );
}

// 코칭 상세 모달
function CoachingDetailModal({ g, members, onClose, onAssign, onUnassign, onRemove }) {
    const p = COACH_PRIORITY[g.priority] || COACH_PRIORITY.mid;
    return (
        <Modal
            title={g.title}
            onClose={onClose}
            foot={
                <>
                    {!g.assigned && (
                        <button className="btn-mini" onClick={() => onRemove(g.key)}>
                            <Icon name="trash-2" size={11} />삭제
                        </button>
                    )}
                    <button className="btn-mini" onClick={onClose}>닫기</button>
                    {g.assigned ? (
                        <button className="btn-mini" onClick={() => onUnassign(g.key)}>
                            <Icon name="x" size={11} />배정 취소
                        </button>
                    ) : (
                        <button className="btn-mini primary" onClick={() => onAssign(g.key)}>
                            <Icon name="send" size={11} />{members.length}명에게 배정
                        </button>
                    )}
                </>
            }
        >
            <div style={{ display: 'grid', gap: 18 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    <div style={{ width: 44, height: 44, borderRadius: 12, background: p.soft, color: p.accent, display: 'grid', placeItems: 'center', flexShrink: 0 }}>
                        <Icon name={g.icon} size={21} />
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                            {g.assigned ? (
                                <span className="pill green" style={{ fontSize: 10.5 }}>
                                    <Icon name="check" size={9} />{g.status || '배정됨'}
                                </span>
                            ) : (
                                <span className="pill" style={{ background: p.soft, color: p.accent, fontSize: 10.5, fontWeight: 700 }}>{p.label}</span>
                            )}
                            <span className="pill" style={{ background: 'var(--muted)', color: 'var(--ink-500)', fontSize: 10.5, fontWeight: 700 }}>{g.targetType === 'individual' ? '개인' : '그룹'} {members.length}명</span>
                        </div>
                        <div className="muted-text" style={{ fontSize: 12, marginTop: 6, lineHeight: 1.5 }}>{g.assigned && g.assignedBy ? `${g.assignedBy} 배정 · ${g.assignedAt}` : g.reason}</div>
                    </div>
                </div>

                <div className="field">
                    <span className="field-label">대상 상담사 · {members.length}명</span>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                        {members.map((m) => (
                            <div key={m.id} style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '9px 11px', border: '1px solid var(--border)', borderRadius: 10 }}>
                                <Avatar id={m.av} name={m.name} />
                                <div style={{ flex: 1, minWidth: 0 }}>
                                    <div style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--ink-900)' }}>{m.name}</div>
                                    <div className="muted-text" style={{ fontSize: 10.5 }}>{m.team}</div>
                                </div>
                                <span className={`score-chip ${scoreClass(m.score)}`} style={{ fontSize: 10.5 }}>{m.score != null ? m.score.toFixed(1) : '-'}</span>
                            </div>
                        ))}
                    </div>
                </div>

                {/* 배정 근거 — 멤버별 문제 콜(관리자는 전원 열람). 근거 없는 배정은 섹션 미노출. */}
                {Array.isArray(g.reasons) && g.reasons.length > 0 && (
                    <div className="field">
                        <span className="field-label">배정 근거 · 문제 콜 {g.reasons.length}건</span>
                        <div style={{ display: 'grid', gap: 8 }}>
                            {members.map((m) => {
                                const rs = g.reasons.filter((r) => r.memberUserId === m.user_id);
                                if (!rs.length) return null;
                                return (
                                    <div key={m.user_id} style={{ border: '1px solid var(--border)', borderRadius: 10, padding: '10px 12px' }}>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                                            <Avatar id={m.av} name={m.name} />
                                            <span style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--ink-900)' }}>{m.name}</span>
                                            <span className="muted-text" style={{ fontSize: 11 }}>· 콜 {rs.length}건</span>
                                        </div>
                                        <div style={{ display: 'grid', gap: 4 }}>
                                            {rs.map((r) => (
                                                <div
                                                    key={r.callId}
                                                    onClick={() => openCallDetail(r.callId)}
                                                    title="상담 QA 분석 상세 보기"
                                                    style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '6px 8px', background: 'var(--background-soft)', borderRadius: 8, cursor: 'pointer' }}
                                                >
                                                    <span style={{ fontSize: 12, color: 'var(--ink-700)', whiteSpace: 'nowrap' }}>{String(r.date || '').slice(0, 16).replace('T', ' ')}</span>
                                                    {r.channel && <ChannelChip channel={r.channel} />}
                                                    {r.callNo && <span className="mono muted-text" style={{ fontSize: 10.5, whiteSpace: 'nowrap' }}>#{r.callNo}</span>}
                                                    <span style={{ flex: 1 }} />
                                                    <span className={`score-chip ${scoreClass(r.score)}`} style={{ fontSize: 10.5, flexShrink: 0 }}>{r.score != null ? Number(r.score).toFixed(1) : '-'}</span>
                                                    <Icon name="external-link" size={12} style={{ color: 'var(--ink-400)', flexShrink: 0 }} />
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                )}

                <div className="field">
                    <span className="field-label">개선 액션 아이템 · {g.items.length}</span>
                    <div style={{ display: 'grid', gap: 8 }}>
                        {g.items.map((it, i) => (
                            <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 9, padding: '10px 12px', background: 'var(--background-soft)', borderRadius: 9 }}>
                                <div style={{ width: 18, height: 18, borderRadius: 5, border: `1.5px solid ${p.accent}`, color: p.accent, display: 'grid', placeItems: 'center', flexShrink: 0, marginTop: 1 }}>
                                    <Icon name="check" size={11} />
                                </div>
                                <span style={{ fontSize: 12.5, color: 'var(--ink-700)', lineHeight: 1.45 }}>{it}</span>
                            </div>
                        ))}
                    </div>
                </div>

                <div className="field">
                    <span className="field-label">Tutor 시나리오 · {(g.scenarios || []).length}개</span>
                    <div style={{ display: 'grid', gap: 6 }}>
                        {(g.scenarios || []).map((code) => {
                            const s = scenById(code);
                            if (!s) return null;
                            const cm = catMeta(s.cat);
                            return (
                                <div key={code} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', border: `1px solid ${p.flat}`, background: p.soft, borderRadius: 10 }}>
                                    <span className="mono" style={{ fontSize: 11, fontWeight: 700, color: p.accent, width: 28, flexShrink: 0 }}>{s.code}</span>
                                    <span style={{ flex: 1, fontSize: 13, fontWeight: 600, color: 'var(--ink-900)' }}>{s.title}</span>
                                    <span className="pill" style={{ background: 'white', color: cm.color, fontSize: 10, fontWeight: 700, border: `1px solid ${cm.color}33` }}>{cm.label}</span>
                                    <span className="muted-text" style={{ fontSize: 10.5, display: 'inline-flex', alignItems: 'center', gap: 3 }}>
                                        <Icon name="message-square" size={10} />{s.faq}
                                    </span>
                                </div>
                            );
                        })}
                        {(g.scenarios || []).length === 0 && <span className="muted-text" style={{ fontSize: 12 }}>연결된 시나리오가 없습니다.</span>}
                    </div>
                </div>
            </div>
        </Modal>
    );
}

// 코칭 만들기 모달
// 새 코칭 배정 폼을 새창으로.
function openCoachingWindow(opts) {
    openInWindow({
        name: 'coaching-form', title: '새 코칭 배정', width: 760, height: 880,
        render: (close) => (
            <CoachingCreateModal
                windowed
                agents={opts.agents || []}
                onClose={close}
                onCreate={(entry) => Promise.resolve(opts.onCreate?.(entry)).finally(close)}
            />
        ),
    });
}

// 상담사별 코칭 이력을 새창으로.
function openCoachingHistoryWindow() {
    openInWindow({
        name: 'coaching-history', title: '상담사별 코칭 이력', width: 960, height: 820,
        render: (close) => <CoachingHistoryModal windowed onClose={close} />,
    });
}

// 코칭 이력 모달 — 자체적으로 실데이터(/api/coaching/history) 로드 후 표시(새창 마운트 대응).
function CoachingHistoryModal({ onClose, windowed = false }) {
    const [rows, setRows] = useState(null);   // null=로딩
    useEffect(() => {
        let cancelled = false;
        (async () => {
            try {
                const data = await fetchCoachingHistory();
                if (!cancelled) setRows(Array.isArray(data) ? data : []);
            } catch (e) {
                console.error('코칭 이력 로딩 실패:', e);
                if (!cancelled) setRows([]);
            }
        })();
        return () => { cancelled = true; };
    }, []);
    return (
        <Modal title="상담사별 코칭 이력" width={920} windowed={windowed} onClose={onClose}>
            {rows === null ? (
                <div className="muted-text" style={{ padding: '40px 20px', textAlign: 'center', fontSize: 12.5 }}>불러오는 중…</div>
            ) : rows.length === 0 ? (
                <div className="muted-text" style={{ padding: '40px 20px', textAlign: 'center', fontSize: 12.5 }}>아직 코칭 이력이 없습니다.</div>
            ) : (
                <CoachingHistory rows={rows} />
            )}
        </Modal>
    );
}

// 배정 근거용 — 한 상담사의 콜 이력 피커. 저점수 우선 정렬 · 인/아웃 필터 · 기간(기본 이번 달) · 15개씩 페이징 · lazy(펼칠 때만 로드).
function MemberCallPicker({ agentId, picks, onToggleCall }) {
    const LIMIT = 15;
    const [period, setPeriod] = useState(() => defaultPeriod('month'));  // 기본: 이번 달(날짜 수정 가능)
    const [io, setIo] = useState('');           // '' 전체 | 'I' 인바운드 | 'O' 아웃바운드
    const [page, setPage] = useState(1);
    const [data, setData] = useState({ items: [], total: 0 });
    const [loading, setLoading] = useState(false);

    const ymd = (d) => (d ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` : '');

    // 필터 바뀌면 1페이지로.
    useEffect(() => { setPage(1); }, [agentId, io, period]);

    useEffect(() => {
        let cancelled = false;
        setLoading(true);
        fetchAgentCalls(agentId, { from: ymd(period.start), to: ymd(period.end), io, sort: 'score', page, limit: LIMIT })
            .then((res) => { if (!cancelled) setData({ items: res.items || [], total: res.total || 0 }); })
            .catch(() => { if (!cancelled) setData({ items: [], total: 0 }); })
            .finally(() => { if (!cancelled) setLoading(false); });
        return () => { cancelled = true; };
    }, [agentId, io, period, page]);

    const pages = Math.max(1, Math.ceil((data.total || 0) / LIMIT));

    return (
        <div style={{ display: 'grid', gap: 10 }}>
            {/* 필터: 기간 + 채널(인/아웃) */}
            <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8 }}>
                <PeriodPicker value={period} onChange={setPeriod} />
                <div className="seg">
                    {[['', '전체'], ['I', '인바운드'], ['O', '아웃바운드']].map(([k, lbl]) => (
                        <button key={k || 'all'} className={`seg-btn ${io === k ? 'active' : ''}`} onClick={() => setIo(k)}>{lbl}</button>
                    ))}
                </div>
                <span className="muted-text" style={{ fontSize: 11, marginLeft: 'auto' }}>저점수 우선 · {data.total}건</span>
            </div>

            {/* 콜 목록(스크롤) */}
            <div style={{ border: '1px solid var(--border)', borderRadius: 10, maxHeight: 220, overflowY: 'auto', display: 'grid', gap: 2, padding: 6, background: 'white' }}>
                {loading && <div className="muted-text" style={{ fontSize: 12, padding: '14px 6px', textAlign: 'center' }}>불러오는 중…</div>}
                {!loading && data.items.length === 0 && <div className="muted-text" style={{ fontSize: 12, padding: '14px 6px', textAlign: 'center' }}>해당 기간의 평가된 콜이 없습니다.</div>}
                {!loading && data.items.map((c) => {
                    const on = !!picks[c.id];
                    return (
                        <div
                            key={c.id}
                            style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 8px', border: on ? '1px solid var(--primary)' : '1px solid transparent', borderRadius: 8, background: on ? 'var(--primary-soft)' : 'transparent' }}
                        >
                            {/* 체크(선택) 영역 */}
                            <div onClick={() => onToggleCall(c)} style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer' }}>
                                <div style={{ width: 17, height: 17, borderRadius: 5, flexShrink: 0, border: on ? 'none' : '1.5px solid var(--border-strong)', background: on ? 'var(--primary)' : 'transparent', color: 'white', display: 'grid', placeItems: 'center' }}>
                                    {on && <Icon name="check" size={12} />}
                                </div>
                                <span style={{ fontSize: 12, color: 'var(--ink-700)', whiteSpace: 'nowrap' }}>{String(c.date || '').slice(0, 16).replace('T', ' ')}</span>
                                {c.channel && <ChannelChip channel={c.channel} />}
                                {c.callNo && <span className="mono muted-text" style={{ fontSize: 10.5, whiteSpace: 'nowrap' }}>#{c.callNo}</span>}
                                <span style={{ flex: 1 }} />
                                <span className={`score-chip ${scoreClass(c.score)}`} style={{ fontSize: 10.5, flexShrink: 0 }}>{c.score != null ? Number(c.score).toFixed(1) : '-'}</span>
                            </div>
                            {/* 상담 QA 분석 상세(새 탭) */}
                            <button className="icon-btn" title="상담 QA 분석 상세 보기" onClick={() => openCallDetail(c.id)} style={{ flexShrink: 0, width: 26, height: 26 }}>
                                <Icon name="external-link" size={13} />
                            </button>
                        </div>
                    );
                })}
            </div>

            {/* 페이지네이션 */}
            {pages > 1 && (
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 12 }}>
                    <button className="icon-btn" disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))} title="이전"><Icon name="chevron-left" size={14} /></button>
                    <span className="muted-text" style={{ fontSize: 11.5 }}>{page} / {pages}</span>
                    <button className="icon-btn" disabled={page >= pages} onClick={() => setPage((p) => Math.min(pages, p + 1))} title="다음"><Icon name="chevron-right" size={14} /></button>
                </div>
            )}
        </div>
    );
}

function CoachingCreateModal({ agents = [], onClose, onCreate, windowed = false }) {
    const [targetType, setTargetType] = useState('group');
    const [channel, setChannel] = useState('call');   // 학습 채널 — 'call'(전화) | 'chat'(채팅). Tutor 딥링크 mode 로 전달.
    const [selected, setSelected] = useState([]);
    const [focus, setFocus] = useState('');
    const [items, setItems] = useState([]);
    const [scenarios, setScenarios] = useState([]);
    const [scenCat, setScenCat] = useState('order');
    // 배정 근거(선택) — { [memberId]: { picks: {callId: callObj}, note } }. 상담사별 개별.
    const [reasonSel, setReasonSel] = useState({});
    const [openMember, setOpenMember] = useState(null);  // 한 번에 한 명만 펼침

    // 대상에서 빠진 상담사의 근거는 정리, 펼침도 동기화(단일 선택이면 자동 펼침).
    useEffect(() => {
        setReasonSel((m) => {
            const next = {};
            for (const id of selected) if (m[id]) next[id] = m[id];
            return Object.keys(next).length === Object.keys(m).length ? m : next;
        });
        setOpenMember((o) => {
            if (selected.length === 1) return selected[0];
            if (o != null && !selected.includes(o)) return null;
            return o;
        });
    }, [selected]);

    const toggleReasonCall = (mid, call) => setReasonSel((m) => {
        const cur = m[mid] || { picks: {} };
        const picks = { ...cur.picks };
        if (picks[call.id]) delete picks[call.id]; else picks[call.id] = call;
        return { ...m, [mid]: { picks } };
    });

    // 집중 영역은 편집 가능 — 프리셋에서 시드 후 추가/이름수정/삭제.
    const [areas, setAreas] = useState(() => Object.entries(COACH_PRESETS).map(([k, p]) => ({ key: k, ...p })));
    const [editingAreas, setEditingAreas] = useState(false);

    const pickFocus = (key) => {
        setFocus(key);
        const p = areas.find((a) => a.key === key);
        if (p) {
            setItems([...p.items]);
            setScenarios([...(p.scenarios || [])]);
        }
    };
    const setAreaTitle = (key, title) => setAreas((arr) => arr.map((a) => (a.key === key ? { ...a, title } : a)));
    const addArea = () => {
        const key = 'fa-' + Date.now();
        setAreas((arr) => [...arr, { key, title: '', priority: 'mid', icon: 'target', scenarios: [], items: [] }]);
    };
    const removeArea = (key) => {
        setAreas((arr) => arr.filter((a) => a.key !== key));
        if (focus === key) {
            setFocus('');
            setItems([]);
            setScenarios([]);
        }
    };
    const toggleScenario = (code) => setScenarios((arr) => (arr.includes(code) ? arr.filter((c) => c !== code) : [...arr, code]));

    const toggleMember = (id) => {
        setSelected((s) => {
            if (targetType === 'individual') return s.includes(id) ? [] : [id];
            return s.includes(id) ? s.filter((x) => x !== id) : [...s, id];
        });
    };
    const setItem = (i, val) => setItems((arr) => arr.map((x, idx) => (idx === i ? val : x)));
    const addItemRow = () => setItems((arr) => [...arr, '']);
    const removeItemRow = (i) => setItems((arr) => arr.filter((_, idx) => idx !== i));

    const canSave = selected.length > 0 && focus && items.filter((x) => x.trim()).length > 0;
    const submit = () => {
        if (!canSave) return;
        const p = areas.find((a) => a.key === focus);
        // 배정 근거(선택) — 콜을 1건 이상 고른 상담사만 전송.
        const reasons = Object.entries(reasonSel)
            .map(([mid, v]) => ({ memberId: Number(mid), callIds: Object.keys(v.picks || {}) }))
            .filter((r) => r.callIds.length > 0);
        onCreate({
            key: 'c-' + Date.now(),
            title: p.title,
            priority: p.priority,
            icon: p.icon,
            reason: '관리자가 직접 배정한 코칭입니다.',
            criteria: '직접 선택',
            items: items.filter((x) => x.trim()),
            scenarios: scenarios.length ? scenarios : (p.scenarios || []),
            members: selected,
            targetType,
            channel,
            reasons,
            assigned: true,
            assignedBy: '관리자',
            assignedAt: formatDateTime(new Date()).slice(0, 10),
            status: '배정됨',
        });
    };

    return (
        <Modal
            title="코칭 배정"
            onClose={onClose}
            width={680}
            windowed={windowed}
            foot={
                <>
                    <button className="btn-mini" onClick={onClose}>취소</button>
                    <button className="btn-mini primary" disabled={!canSave} onClick={submit}>
                        <Icon name="send" size={11} />배정하기
                    </button>
                </>
            }
        >
            <div style={{ display: 'grid', gap: 20, minWidth: 0 }}>
                {/* 대상 유형 + 채널 (나란히) */}
                <div className="field" style={{ minWidth: 0 }}>
                    <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-start', gap: 32 }}>
                        <div style={{ minWidth: 0 }}>
                            <span className="field-label">대상 유형</span>
                            <div className="seg" style={{ alignSelf: 'flex-start' }}>
                                <button className={`seg-btn ${targetType === 'group' ? 'active' : ''}`} onClick={() => setTargetType('group')}>그룹</button>
                                <button
                                    className={`seg-btn ${targetType === 'individual' ? 'active' : ''}`}
                                    onClick={() => {
                                        setTargetType('individual');
                                        setSelected((s) => s.slice(0, 1));
                                    }}
                                >
                                    개인
                                </button>
                            </div>
                        </div>
                        <div style={{ minWidth: 0 }}>
                            <span className="field-label">채널</span>
                            <div className="seg" style={{ alignSelf: 'flex-start' }}>
                                <button className={`seg-btn ${channel === 'call' ? 'active' : ''}`} onClick={() => setChannel('call')}>전화</button>
                                <button className={`seg-btn ${channel === 'chat' ? 'active' : ''}`} onClick={() => setChannel('chat')}>채팅</button>
                            </div>
                        </div>
                    </div>
                    <span className="field-hint">
                        {targetType === 'group' ? '여러 상담사를 한 코칭으로 묶어 배정합니다.' : '한 명에게 개별 배정합니다.'}
                        {' · '}
                        {channel === 'chat' ? '채팅(텍스트) 시나리오로 학습합니다.' : '전화(통화) 시나리오로 학습합니다.'}
                    </span>
                </div>

                {/* 대상 상담사 (실DB) */}
                <div className="field">
                    <span className="field-label">대상 상담사 {selected.length > 0 && <span style={{ color: 'var(--primary)' }}>· {selected.length}명</span>}</span>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, minWidth: 0 }}>
                        {agents.length === 0 && (
                            <div className="muted-text" style={{ fontSize: 12, gridColumn: '1 / -1', padding: '10px 2px' }}>연동된 상담사가 없습니다.</div>
                        )}
                        {agents.map((c) => {
                            const on = selected.includes(c.user_id);
                            return (
                                <button
                                    key={c.user_id}
                                    onClick={() => toggleMember(c.user_id)}
                                    style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '9px 11px', cursor: 'pointer', fontFamily: 'inherit', textAlign: 'left', minWidth: 0, border: on ? '1px solid var(--primary)' : '1px solid var(--border)', borderRadius: 10, background: on ? 'var(--primary-soft)' : 'white', transition: 'all var(--t-base)' }}
                                >
                                    <Avatar id={c.av} name={c.name} />
                                    <div style={{ flex: 1, minWidth: 0 }}>
                                        <div style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--ink-900)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{c.name}</div>
                                        <div className="muted-text" style={{ fontSize: 10.5, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{c.team}</div>
                                    </div>
                                    <span className={`score-chip ${scoreClass(c.score)}`} style={{ fontSize: 10.5, flexShrink: 0 }}>{c.score != null ? c.score.toFixed(1) : '-'}</span>
                                    {on && <Icon name="check-circle" size={15} style={{ color: 'var(--primary)', flexShrink: 0 }} />}
                                </button>
                            );
                        })}
                    </div>
                </div>

                {/* 배정 근거 (선택) — 상담사별 문제 콜. 그룹이라도 근거는 본인만 열람. */}
                {selected.length > 0 && (
                    <div className="field">
                        <span className="field-label">배정 근거 <span className="muted-text" style={{ fontWeight: 600 }}>(선택)</span></span>
                        <span className="field-hint" style={{ marginBottom: 8 }}>상담사별로 문제였던 콜을 선택하세요. 그룹이라도 근거 콜은 해당 상담사 본인만 볼 수 있습니다.</span>
                        <div style={{ display: 'grid', gap: 8 }}>
                            {selected.map((mid) => {
                                const a = agents.find((x) => x.user_id === mid);
                                const sel = reasonSel[mid] || { picks: {} };
                                const n = Object.keys(sel.picks).length;
                                const open = openMember === mid;
                                return (
                                    <div key={mid} style={{ border: '1px solid var(--border)', borderRadius: 10, overflow: 'hidden' }}>
                                        <button
                                            onClick={() => setOpenMember(open ? null : mid)}
                                            style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 9, padding: '9px 11px', cursor: 'pointer', fontFamily: 'inherit', background: open ? 'var(--background-soft)' : 'white', border: 'none', textAlign: 'left' }}
                                        >
                                            <Avatar id={a?.av} name={a?.name || String(mid)} />
                                            <span style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--ink-900)' }}>{a?.name || `상담사 ${mid}`}</span>
                                            {n > 0
                                                ? <span className="pill" style={{ background: 'var(--primary-soft)', color: 'var(--primary)', fontSize: 10.5, fontWeight: 700 }}>근거 {n}건</span>
                                                : <span className="muted-text" style={{ fontSize: 11 }}>근거 없음</span>}
                                            <span style={{ flex: 1 }} />
                                            <Icon name={open ? 'chevron-up' : 'chevron-down'} size={16} style={{ color: 'var(--ink-400)' }} />
                                        </button>
                                        {open && (
                                            <div style={{ padding: '10px 11px', borderTop: '1px solid var(--border)' }}>
                                                <MemberCallPicker
                                                    agentId={mid}
                                                    picks={sel.picks}
                                                    onToggleCall={(c) => toggleReasonCall(mid, c)}
                                                />
                                            </div>
                                        )}
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                )}

                {/* 집중 영역 (편집 가능) */}
                <div className="field">
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span className="field-label" style={{ marginBottom: 0 }}>집중 영역</span>
                        <button
                            className="icon-btn"
                            onClick={() => setEditingAreas((v) => !v)}
                            title={editingAreas ? '편집 완료' : '집중 영역 편집'}
                            style={{ width: 26, height: 26, color: editingAreas ? 'var(--primary)' : 'var(--ink-400)' }}
                        >
                            <Icon name={editingAreas ? 'check' : 'pencil'} size={13} />
                        </button>
                        {editingAreas && <span className="muted-text" style={{ fontSize: 11 }}>이름 수정 · 삭제 · 추가</span>}
                    </div>

                    {editingAreas ? (
                        <div style={{ display: 'grid', gap: 8, marginTop: 8 }}>
                            {areas.map((a) => (
                                <div key={a.key} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                    <Icon name={a.icon} size={14} style={{ color: 'var(--ink-400)', flexShrink: 0 }} />
                                    <input className="text-input" value={a.title} onChange={(e) => setAreaTitle(a.key, e.target.value)} style={{ flex: 1 }} placeholder="집중 영역 이름" />
                                    <button className="icon-btn" onClick={() => removeArea(a.key)} title="삭제"><Icon name="trash-2" size={13} /></button>
                                </div>
                            ))}
                            <button className="btn-mini" style={{ alignSelf: 'flex-start' }} onClick={addArea}><Icon name="plus" size={11} />영역 추가</button>
                        </div>
                    ) : (
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 8 }}>
                            {areas.filter((a) => a.title.trim()).map((a) => {
                                const on = focus === a.key;
                                return (
                                    <button
                                        key={a.key}
                                        onClick={() => pickFocus(a.key)}
                                        style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '8px 12px', cursor: 'pointer', fontFamily: 'inherit', border: on ? '1px solid var(--primary)' : '1px solid var(--border)', borderRadius: 9, background: on ? 'var(--primary-soft)' : 'white', color: on ? 'var(--primary)' : 'var(--ink-700)', fontSize: 12.5, fontWeight: 600, transition: 'all var(--t-base)' }}
                                    >
                                        <Icon name={a.icon} size={13} />{a.title}
                                    </button>
                                );
                            })}
                        </div>
                    )}
                    {!editingAreas && <span className="field-hint">영역을 선택하면 액션 아이템과 Tutor 시나리오가 자동으로 채워집니다. 자유롭게 수정하세요.</span>}
                </div>

                {/* 개선 액션 아이템 */}
                {focus && (
                    <div className="field">
                        <span className="field-label">개선 액션 아이템</span>
                        <div style={{ display: 'grid', gap: 8 }}>
                            {items.map((it, i) => (
                                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                    <Icon name="check" size={13} style={{ color: 'var(--primary)', flexShrink: 0 }} />
                                    <input className="text-input" value={it} onChange={(e) => setItem(i, e.target.value)} style={{ flex: 1 }} placeholder="액션 아이템 입력" />
                                    <button className="icon-btn" onClick={() => removeItemRow(i)} title="삭제">
                                        <Icon name="x" size={13} />
                                    </button>
                                </div>
                            ))}
                            <button className="btn-mini" style={{ alignSelf: 'flex-start' }} onClick={addItemRow}>
                                <Icon name="plus" size={11} />아이템 추가
                            </button>
                        </div>
                    </div>
                )}

                {/* Tutor 시나리오 (FAQ) */}
                {focus && (
                    <div className="field">
                        <span className="field-label">
                            Tutor 시나리오 {scenarios.length > 0 && <span style={{ color: 'var(--primary)' }}>· {scenarios.length}개 선택</span>}
                        </span>
                        <span className="field-hint" style={{ marginBottom: 8 }}>연결할 문의 유형 시나리오(FAQ)를 선택하세요. Tutor는 코스가 아닌 시나리오 단위로 학습됩니다.</span>

                        {/* 선택된 시나리오 칩 */}
                        {scenarios.length > 0 && (
                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 10 }}>
                                {scenarios.map((code) => {
                                    const s = scenById(code);
                                    if (!s) return null;
                                    return (
                                        <span key={code} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '4px 6px 4px 10px', background: 'var(--primary-soft)', border: '1px solid var(--primary-soft-flat)', borderRadius: 9999 }}>
                                            <span className="mono" style={{ fontSize: 10, fontWeight: 700, color: 'var(--primary)' }}>{s.code}</span>
                                            <span style={{ fontSize: 11.5, fontWeight: 600, color: 'var(--ink-900)' }}>{s.title}</span>
                                            <button className="icon-btn" onClick={() => toggleScenario(code)} title="제외" style={{ width: 18, height: 18 }}><Icon name="x" size={11} /></button>
                                        </span>
                                    );
                                })}
                            </div>
                        )}

                        {/* 카테고리 탭 + 시나리오 목록 */}
                        <div style={{ border: '1px solid var(--border)', borderRadius: 12, overflow: 'hidden' }}>
                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, padding: 8, background: 'var(--background-soft)', borderBottom: '1px solid var(--border)' }}>
                                {TUTOR_CATEGORIES.map((c) => {
                                    const on = scenCat === c.key;
                                    const n = TUTOR_SCENARIOS.filter((s) => s.cat === c.key).length;
                                    return (
                                        <button
                                            key={c.key}
                                            onClick={() => setScenCat(c.key)}
                                            style={{ flexShrink: 0, padding: '6px 11px', borderRadius: 7, border: 'none', cursor: 'pointer', fontFamily: 'inherit', background: on ? 'white' : 'transparent', color: on ? 'var(--ink-900)' : 'var(--ink-500)', fontSize: 12, fontWeight: on ? 700 : 600, boxShadow: on ? 'var(--shadow-xs)' : 'none', display: 'inline-flex', alignItems: 'center', gap: 6, whiteSpace: 'nowrap' }}
                                        >
                                            <span style={{ width: 7, height: 7, borderRadius: '50%', background: c.color }}></span>
                                            {c.label}<span className="muted-text" style={{ fontSize: 10.5 }}>{n}</span>
                                        </button>
                                    );
                                })}
                            </div>
                            <div style={{ maxHeight: 200, overflowY: 'auto', padding: 8, display: 'grid', gap: 4 }}>
                                {TUTOR_SCENARIOS.filter((s) => s.cat === scenCat).map((s) => {
                                    const on = scenarios.includes(s.code);
                                    return (
                                        <button
                                            key={s.code}
                                            onClick={() => toggleScenario(s.code)}
                                            style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px', cursor: 'pointer', fontFamily: 'inherit', textAlign: 'left', border: on ? '1px solid var(--primary)' : '1px solid transparent', borderRadius: 8, background: on ? 'var(--primary-soft)' : 'transparent', transition: 'all var(--t-base)' }}
                                        >
                                            <span className="mono" style={{ fontSize: 10.5, fontWeight: 700, color: on ? 'var(--primary)' : 'var(--ink-400)', width: 28, flexShrink: 0 }}>{s.code}</span>
                                            <span style={{ flex: 1, fontSize: 12.5, fontWeight: 600, color: 'var(--ink-900)' }}>{s.title}</span>
                                            <span className="muted-text" style={{ fontSize: 10.5, display: 'inline-flex', alignItems: 'center', gap: 3 }}>
                                                <Icon name="message-square" size={10} />FAQ {s.faq}
                                            </span>
                                            <div style={{ width: 18, height: 18, borderRadius: 5, flexShrink: 0, border: on ? 'none' : '1.5px solid var(--border-strong)', background: on ? 'var(--primary)' : 'transparent', color: 'white', display: 'grid', placeItems: 'center' }}>
                                                {on && <Icon name="check" size={12} />}
                                            </div>
                                        </button>
                                    );
                                })}
                            </div>
                        </div>
                    </div>
                )}
            </div>
        </Modal>
    );
}

// ─────────────────────────────────────────────────────
// Admin 평가 결과 — 조직 전체 평가 데이터 관리
// ─────────────────────────────────────────────────────
// 평가목록 체크박스 선택 보존 키 — 상세(#/detail) 왕복 시 컴포넌트가 언마운트돼도 유지.
// sessionStorage(탭 단위, 탭 닫으면 자동 해제). 쿠키/localStorage 대신 SPA 내 화면 전환 보존용.
function AdminResults({ embedded, beforeList, results = [], loading = false, onReload }) {
    const [period, setPeriod] = useState(defaultPeriod('7d'));
    const [channel, setChannel] = useState('all');
    const [team, setTeam] = useState('all');
    const [approval, setApproval] = useState('all');
    const [approvedIds, setApprovedIds] = useState(() => new Set());
    const [scoreRange, setScoreRange] = useState('all');
    const [sort, setSort] = useState({ key: 'date', dir: 'desc' });
    const [drawerId, setDrawerId] = useState(null);
    const [colFilters, setColFilters] = useState({});  // 헤더 엑셀식 필터: 컬럼키 → 제외 Set
    const [dlOpen, setDlOpen] = useState(false);        // Download(내보내기) 형식 선택 팝업

    // 실데이터 로드 후 최종승인 상태(review_status='completed') 시드.
    useEffect(() => {
        setApprovedIds(new Set(results.filter((r) => r.approved).map((r) => r.id)));
    }, [results]);

    // 행 클릭 → 기존 평가리스트의 실제 "상세 QA 분석" 화면(#/detail/{qa_id}, Detail.jsx)으로 이동.
    // 앱 전체가 단일 해시라우팅 SPA 라, hash 만 바꾸면 App 이 Detail 로 전환한다.
    const openDetail = (qaId) => {
        if (typeof window !== 'undefined') window.location.hash = `#/detail/${encodeURIComponent(qaId)}`;
    };

    // 부서 필터 — 실제 결과의 부서(qa_calls.department) distinct. (하드코딩 팀 제거)
    const TEAMS = React.useMemo(
        () => [...new Set(results.map((r) => r.team).filter((t) => t && t !== '-'))].sort(),
        [results]
    );

    // 점수 구간 임계값 — 활성 브랜드 만점(콜 total_max 최대값) 기준 90%/75%. 사용자 생성 트랙 임의 만점 자동 반영.
    const SCORE_MAX = React.useMemo(() => {
        const maxes = (results || []).map((r) => Number(r.total_max)).filter((n) => Number.isFinite(n) && n > 0);
        if (maxes.length) return Math.max(...maxes);
        return Number(DEFAULT_TOTAL_MAX) > 0 ? Number(DEFAULT_TOTAL_MAX) : 100;
    }, [results]);
    const SCORE_HIGH = Math.round(SCORE_MAX * 0.9);
    const SCORE_LOW = Math.round(SCORE_MAX * 0.75);

    // 헤더 엑셀식 컬럼 필터 — 현재 결과에 존재하는 값만 목록에. (상단 필터바와 AND 결합)
    const admColVal = {
        channel: (r) => r.channel || '',
        team: (r) => r.team || '-',
        category: (r) => r.category || '-',
        score: (r) => String(r.score),
        approval: (r) => (approvedIds.has(r.id) ? 'approved' : 'pending'),
    };
    const admColLabel = {
        channel: (v) => (v === 'inbound' ? '인바운드' : v === 'outbound' ? '아웃바운드' : '-'),
        team: (v) => v || '-',
        category: (v) => v || '-',
        score: (v) => v,
        approval: (v) => (v === 'approved' ? '승인 완료' : '미승인'),
    };
    const ADM_FILTER_COLS = ['channel', 'team', 'category', 'score', 'approval'];
    const admColOpts = React.useMemo(() => {
        const out = {};
        for (const c of ADM_FILTER_COLS) {
            const seen = new Set();
            for (const r of results) seen.add(admColVal[c](r));
            const arr = [...seen];
            if (c === 'score') arr.sort((a, b) => Number(b) - Number(a));
            else arr.sort((a, b) => String(admColLabel[c](a)).localeCompare(String(admColLabel[c](b)), 'ko'));
            out[c] = arr.map((v) => ({ value: v, label: admColLabel[c](v) }));
        }
        return out;
    }, [results, approvedIds]);  // eslint-disable-line react-hooks/exhaustive-deps
    const setAdmCol = (c, ex) => setColFilters((f) => ({ ...f, [c]: ex }));
    const passCol = (c, v) => { const ex = colFilters[c]; return !ex || ex.size === 0 || !ex.has(v); };

    const filtered = results.filter((r) => {
        if (!passCol('channel', admColVal.channel(r))) return false;
        if (!passCol('team', admColVal.team(r))) return false;
        if (!passCol('category', admColVal.category(r))) return false;
        if (!passCol('score', admColVal.score(r))) return false;
        if (!passCol('approval', admColVal.approval(r))) return false;
        if (channel !== 'all' && r.channel !== channel) return false;
        if (team !== 'all' && r.team !== team) return false;
        if (approval === 'approved' && !approvedIds.has(r.id)) return false;
        if (approval === 'pending' && approvedIds.has(r.id)) return false;
        if (scoreRange === 'high' && r.score < SCORE_HIGH) return false;
        if (scoreRange === 'mid' && (r.score < SCORE_LOW || r.score >= SCORE_HIGH)) return false;
        if (scoreRange === 'low' && r.score >= SCORE_LOW) return false;
        return true;
    })
        .slice()
        .sort((a, b) => {
            let cmp = 0;
            if (sort.key === 'date') cmp = (a.date + a.time).localeCompare(b.date + b.time);
            if (sort.key === 'score') cmp = a.score - b.score;
            if (sort.key === 'name') cmp = a.name.localeCompare(b.name);
            return sort.dir === 'asc' ? cmp : -cmp;
        });


    const avgScore = filtered.length ? Math.round((filtered.reduce((s, r) => s + r.score, 0) / filtered.length) * 10) / 10 : 0;
    const excellent = filtered.filter((r) => r.score >= SCORE_HIGH).length;
    const coachingCnt = filtered.filter((r) => r.score < SCORE_LOW).length;

    const sortBy = (key) => {
        if (sort.key === key) setSort({ key, dir: sort.dir === 'asc' ? 'desc' : 'asc' });
        else setSort({ key, dir: 'desc' });
    };
    const SortIcon = ({ k }) =>
        sort.key !== k ? (
            <Icon name="chevrons-up-down" size={11} style={{ opacity: 0.4 }} />
        ) : sort.dir === 'asc' ? (
            <Icon name="chevron-up" size={11} />
        ) : (
            <Icon name="chevron-down" size={11} />
        );

    const drawerItem = drawerId ? results.find((r) => r.id === drawerId) : null;
    const COLS = '96px 108px 168px 88px 84px 1fr 64px 112px 104px 30px';

    // 평가목록 내보내기 — 현재 필터된 목록을 CSV/Excel 로 저장(형식 선택 팝업). 화면 컬럼과 동일.
    const buildExportRows = () => filtered.map((r) => ({
        '상담일시': r.callDatetime ? formatDateTime(r.callDatetime) : `${r.date} ${r.time}`,
        '상담번호': r.sessionId,
        '상담사': r.name,
        '상담사코드': r.counselor || '',
        '채널': r.channel,
        '부서': r.team,
        '카테고리': r.category,
        '점수': r.score,
        '승인': approvedIds.has(r.id) ? '승인' : '대기',
    }));
    const exportDownload = (fmt) => {
        setDlOpen(false);
        const rows = buildExportRows();
        if (!rows.length) { alert('내보낼 데이터가 없습니다.'); return; }
        const now = new Date();
        const p = (n) => String(n).padStart(2, '0');
        const fname = `평가목록_${now.getFullYear()}${p(now.getMonth() + 1)}${p(now.getDate())}_${p(now.getHours())}${p(now.getMinutes())}`;
        if (fmt === 'csv') {
            const headers = Object.keys(rows[0]);
            const esc = (v) => { const s = String(v ?? ''); return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
            const csv = [headers.join(','), ...rows.map((row) => headers.map((h) => esc(row[h])).join(','))].join('\r\n');
            const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });  // BOM: Excel 한글 정합
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url; a.download = `${fname}.csv`; a.click();
            URL.revokeObjectURL(url);
        } else {
            const ws = XLSX.utils.json_to_sheet(rows);
            const wb = XLSX.utils.book_new();
            XLSX.utils.book_append_sheet(wb, ws, '평가목록');
            XLSX.writeFile(wb, `${fname}.xlsx`);
        }
    };

    return (
        <div>
            {embedded ? (
                <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 8, marginBottom: 18 }}>
                    <PeriodPicker value={period} onChange={setPeriod} />
                </div>
            ) : (
                <PageHead eyebrow="관리자 · 평가 결과" title="조직 전체 평가 데이터" sub="모든 채널·부서·상담사의 평가를 검색, 필터링, 분석합니다.">
                    <PeriodPicker value={period} onChange={setPeriod} />
                    <button className="btn-mini">
                        <Icon name="users" />코치 배정
                    </button>
                </PageHead>
            )}

            {/* KPIs */}
            <div className="grid grid-4" style={{ marginBottom: 18 }}>
                <div className="kpi accent-navy">
                    <span className="eyebrow">
                        <Icon name="clipboard-check" />전체 평가
                    </span>
                    <div className="value">
                        {fmtNum(filtered.length)}<span className="unit">건</span>
                    </div>
                    <div className="foot">필터 적용 · 총 {results.length}건 중</div>
                </div>
                <div className="kpi">
                    <span className="eyebrow">
                        <Icon name="award" />평균 점수
                    </span>
                    <div className="value">
                        {avgScore}<span className="unit">점</span>
                    </div>
                    <span className="delta up">
                        <Icon name="trending-up" />+1.8점
                    </span>
                </div>
                <div className="kpi">
                    <span className="eyebrow" style={{ color: '#2f9759' }}>
                        <Icon name="trophy" />우수 ({SCORE_HIGH}+)
                    </span>
                    <div className="value" style={{ color: '#2f9759' }}>
                        {excellent}<span className="unit">건</span>
                    </div>
                    <div className="foot">{filtered.length ? Math.round((excellent / filtered.length) * 100) : 0}%</div>
                </div>
                <div className="kpi">
                    <span className="eyebrow" style={{ color: 'var(--destructive)' }}>
                        <Icon name="alert-triangle" />코칭 필요 ({SCORE_LOW} 미만)
                    </span>
                    <div className="value" style={{ color: 'var(--destructive)' }}>
                        {coachingCnt}<span className="unit">건</span>
                    </div>
                    <div className="foot">강사 배정 권장</div>
                </div>
            </div>

            {/* Filter bar */}
            <div className="panel" style={{ marginBottom: 0, padding: '12px 16px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span className="eyebrow" style={{ fontSize: 10.5 }}>채널</span>
                        <div className="seg">
                            <button className={`seg-btn ${channel === 'all' ? 'active' : ''}`} onClick={() => setChannel('all')}>전체</button>
                            <button className={`seg-btn ${channel === 'inbound' ? 'active' : ''}`} onClick={() => setChannel('inbound')}>인바운드</button>
                            <button className={`seg-btn ${channel === 'outbound' ? 'active' : ''}`} onClick={() => setChannel('outbound')}>아웃바운드</button>
                        </div>
                    </div>

                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span className="eyebrow" style={{ fontSize: 10.5 }}>부서</span>
                        <div className="seg">
                            <button className={`seg-btn ${team === 'all' ? 'active' : ''}`} onClick={() => setTeam('all')}>전체</button>
                            {TEAMS.map((t) => (
                                <button key={t} className={`seg-btn ${team === t ? 'active' : ''}`} onClick={() => setTeam(t)}>{t}</button>
                            ))}
                        </div>
                    </div>

                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span className="eyebrow" style={{ fontSize: 10.5 }}>승인</span>
                        <div className="seg">
                            <button className={`seg-btn ${approval === 'all' ? 'active' : ''}`} onClick={() => setApproval('all')}>전체</button>
                            <button className={`seg-btn ${approval === 'pending' ? 'active' : ''}`} onClick={() => setApproval('pending')}>승인 대기</button>
                            <button className={`seg-btn ${approval === 'approved' ? 'active' : ''}`} onClick={() => setApproval('approved')}>승인 완료</button>
                        </div>
                    </div>

                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span className="eyebrow" style={{ fontSize: 10.5 }}>점수</span>
                        <div className="seg">
                            <button className={`seg-btn ${scoreRange === 'all' ? 'active' : ''}`} onClick={() => setScoreRange('all')}>전체</button>
                            <button className={`seg-btn ${scoreRange === 'high' ? 'active' : ''}`} onClick={() => setScoreRange('high')}>우수 {SCORE_HIGH}+</button>
                            <button className={`seg-btn ${scoreRange === 'mid' ? 'active' : ''}`} onClick={() => setScoreRange('mid')}>보통 {SCORE_LOW}-{SCORE_HIGH - 1}</button>
                            <button className={`seg-btn ${scoreRange === 'low' ? 'active' : ''}`} onClick={() => setScoreRange('low')}>코칭 &lt;{SCORE_LOW}</button>
                        </div>
                    </div>
                </div>
            </div>

            {/* 코칭 배정 (평가 목록 바로 위) */}
            {beforeList}

            {/* Results table */}
            <div className="panel">
                <div className="panel-head">
                    <h3>평가 목록</h3>
                    <div className="sub" style={{ marginLeft: 12 }}>{filtered.length}건 표시 중</div>
                    <div style={{ marginLeft: 'auto', position: 'relative' }}>
                        <button className="btn-mini" onClick={() => setDlOpen((v) => !v)}>
                            <Icon name="download" />Download
                        </button>
                        {dlOpen && (
                            <>
                                <div onClick={() => setDlOpen(false)} style={{ position: 'fixed', inset: 0, zIndex: 40 }} />
                                <div className="panel" style={{ position: 'absolute', right: 0, top: 'calc(100% + 6px)', zIndex: 50, padding: 4, minWidth: 172, boxShadow: '0 10px 28px rgba(16,24,40,0.16)' }}>
                                    <div style={{ padding: '6px 10px 4px', fontSize: 11.5, color: 'var(--ink-500)', fontWeight: 700 }}>파일 형식 선택</div>
                                    <button className="btn-mini" style={{ width: '100%', justifyContent: 'flex-start', border: 0, background: 'transparent' }} onClick={() => exportDownload('excel')}>
                                        <Icon name="download" />Excel (.xlsx)
                                    </button>
                                    <button className="btn-mini" style={{ width: '100%', justifyContent: 'flex-start', border: 0, background: 'transparent' }} onClick={() => exportDownload('csv')}>
                                        <Icon name="download" />CSV (.csv)
                                    </button>
                                </div>
                            </>
                        )}
                    </div>
                </div>
                <div>
                    <div className="tbl-head tc" style={{ gridTemplateColumns: COLS, borderTop: 0, overflow: 'visible' }}>
                        <div style={{ cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 4 }} onClick={() => sortBy('date')}>
                            상담일시 <SortIcon k="date" />
                        </div>
                        <div>상담번호</div>
                        <div style={{ cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 4 }} onClick={() => sortBy('name')}>
                            상담사 <SortIcon k="name" />
                        </div>
                        <div><ColumnFilter title="채널" options={admColOpts.channel} excluded={colFilters.channel} onChange={(ex) => setAdmCol('channel', ex)} /></div>
                        <div><ColumnFilter title="부서" options={admColOpts.team} excluded={colFilters.team} onChange={(ex) => setAdmCol('team', ex)} /></div>
                        <div><ColumnFilter title="카테고리" options={admColOpts.category} excluded={colFilters.category} onChange={(ex) => setAdmCol('category', ex)} /></div>
                        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                            <ColumnFilter title="점수" options={admColOpts.score} excluded={colFilters.score} onChange={(ex) => setAdmCol('score', ex)} />
                            <span style={{ cursor: 'pointer', display: 'inline-flex' }} onClick={() => sortBy('score')}><SortIcon k="score" /></span>
                        </div>
                        <div>수기검토</div>
                        <div><ColumnFilter title="승인" options={admColOpts.approval} excluded={colFilters.approval} onChange={(ex) => setAdmCol('approval', ex)} align="right" /></div>
                        <div></div>
                    </div>
                    <div style={{ maxHeight: 430, overflowY: 'auto' }}>
                        {filtered.map((r) => {
                            return (
                                <div key={r.id} className="tbl-row clickable tc" onClick={() => openDetail(r.id)} style={{ gridTemplateColumns: COLS }}>
                                    {(() => {
                                        const full = r.callDatetime ? formatDateTime(r.callDatetime) : `${r.date} ${r.time}`;
                                        const [d, t] = full.split(' ');
                                        return (
                                            <div style={{ lineHeight: 1.35 }}>
                                                <div style={{ fontSize: 12, color: '#475467' }}>{d}</div>
                                                <div style={{ fontSize: 11, color: '#98A2B3' }}>{t || ''}</div>
                                            </div>
                                        );
                                    })()}
                                    <div className="mono" style={{ fontSize: 11, color: 'var(--ink-500)', fontWeight: 600, lineHeight: 1.3, wordBreak: 'break-all' }} title={r.sessionId}>{r.sessionId}</div>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                                        <Avatar id={r.avId} name={r.name} />
                                        <div style={{ minWidth: 0 }}>
                                            <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink-900)' }}>{r.name}</div>
                                            <div className="muted-text mono" style={{ fontSize: 10.5, marginTop: 2 }}>{r.counselor || '—'}</div>
                                        </div>
                                    </div>
                                    <div>
                                        <ChannelChip channel={r.channel} />
                                    </div>
                                    <div className="muted-text" style={{ fontSize: 12 }}>{r.team}</div>
                                    <div className="muted-text" style={{ fontSize: 12, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.category}</div>
                                    <div>
                                        <span className={`score-chip ${scoreClass(r.score)}`}>{r.score}</span>
                                    </div>
                                    <div>
                                        {/* N차 검토 — 상담사가 검토 제출한 횟수(review_round). 0이면 미검토. */}
                                        {r.reviewRound > 0 ? (
                                            <span className="pill" style={{ background: 'var(--primary-soft)', color: 'var(--primary)', fontSize: 10.5, fontWeight: 700 }} title={`상담사 검토 ${r.reviewRound}회`}>
                                                <Icon name="user-check" size={10} />{r.reviewRound}차 검토
                                            </span>
                                        ) : (
                                            <span className="muted-text" style={{ fontSize: 11.5, color: 'var(--ink-400)' }}>미검토</span>
                                        )}
                                    </div>
                                    <div onClick={(e) => e.stopPropagation()}>
                                        {/* 검수상태 — 6단계 배지(읽기 전용). 승인/반려/이의제기 등 액션은 상세화면에서. */}
                                        {(() => {
                                            const RS = {
                                                pending: { label: '대기', bg: 'var(--muted)', ink: 'var(--ink-500)', dot: 'var(--ink-400)' },
                                                in_review: { label: '검수중', bg: '#E4E7EC', ink: '#344054', dot: '#475467' },
                                                review_done: { label: '검토요청', bg: 'var(--primary-soft)', ink: 'var(--primary)', dot: 'var(--primary)' },
                                                admin_revised: { label: '반려', bg: '#FFFAEB', ink: '#B54708', dot: '#F79009' },
                                                objection: { label: '이의제기', bg: '#FEF3F2', ink: '#B42318', dot: '#D92D20' },
                                                approved: { label: '확정', bg: '#ECFDF3', ink: '#067647', dot: '#12B76A' },
                                            };
                                            const k = r.reviewStatus === 'completed' ? 'approved' : (r.reviewStatus || 'pending');
                                            const m = RS[k] || RS.pending;
                                            return (
                                                <span className="pill" style={{ background: m.bg, color: m.ink, fontSize: 10.5, fontWeight: 700, whiteSpace: 'nowrap' }}>
                                                    <span style={{ width: 6, height: 6, borderRadius: '50%', background: m.dot, display: 'inline-block' }} />{m.label}
                                                </span>
                                            );
                                        })()}
                                    </div>
                                    <div style={{ display: 'grid', placeItems: 'center', color: 'var(--ink-400)' }}>
                                        <Icon name="chevron-right" size={14} />
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                    {filtered.length === 0 && (
                        <div className="empty" style={{ padding: 60 }}>
                            <div className="ico">
                                <Icon name={loading ? 'loader' : 'search-x'} />
                            </div>
                            <h3>{loading ? '불러오는 중…' : '결과 없음'}</h3>
                            <p>{loading ? '실제 상담 데이터를 가져오고 있습니다.' : '다른 필터를 시도해보세요.'}</p>
                        </div>
                    )}
                    {filtered.length > 0 && (
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 18px', borderTop: '1px solid var(--border)' }}>
                            <span className="muted-text" style={{ fontSize: 12 }}>1-{filtered.length} 표시 · 총 {filtered.length}건</span>
                            <div style={{ display: 'flex', gap: 4 }}>
                                <button className="btn-mini" disabled>
                                    <Icon name="chevron-left" />이전
                                </button>
                                <button className="btn-mini" style={{ background: 'var(--primary-soft)', color: 'var(--primary)', borderColor: 'var(--primary-soft-flat)' }}>1</button>
                                <button className="btn-mini" disabled>
                                    다음<Icon name="chevron-right" />
                                </button>
                            </div>
                        </div>
                    )}
                </div>
            </div>

            {/* Detail drawer */}
            {drawerItem && (
                <Modal
                    title={`${drawerItem.name} · ${drawerItem.category}`}
                    onClose={() => setDrawerId(null)}
                    foot={
                        <>
                            <button className="btn-mini" onClick={() => setDrawerId(null)}>닫기</button>
                            <button className="btn-mini">
                                <Icon name="user-plus" />강사 배정
                            </button>
                            <button className="btn-mini primary">
                                <Icon name="external-link" />상세 페이지
                            </button>
                        </>
                    }
                >
                    <div style={{ display: 'grid', gap: 14 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 18, padding: '14px 16px', background: 'var(--background)', borderRadius: 12 }}>
                            <Gauge value={drawerItem.score} label="AI 평가" size={100} />
                            <div style={{ flex: 1 }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6, flexWrap: 'wrap' }}>
                                    <span className="mono" style={{ fontSize: 11, fontWeight: 700, color: 'var(--ink-400)' }}>{drawerItem.id}</span>
                                    <StatusPill status={drawerItem.status} />
                                    <ChannelChip channel={drawerItem.channel} />
                                </div>
                                <div className="muted-text" style={{ fontSize: 12.5 }}>{drawerItem.team} · {drawerItem.date} {drawerItem.time} · {drawerItem.duration}</div>
                                <div style={{ fontSize: 13, color: 'var(--ink-700)', lineHeight: 1.55, marginTop: 8 }}>{drawerItem.summary}</div>
                            </div>
                        </div>

                        <div>
                            <div className="eyebrow" style={{ marginBottom: 10 }}>항목별 점수 (14개)</div>
                            <div style={{ maxHeight: 280, overflowY: 'auto', paddingRight: 6 }}>
                                <ScoreBreakdown scores={drawerItem.scores} dimensions={DIMENSIONS} />
                            </div>
                        </div>
                    </div>
                </Modal>
            )}
        </div>
    );
}
