// 관리자/슈퍼관리자 — 평가 관리 (디자인 프로토타입 etc/pages-admin.jsx 의 AdminEvalMgmt 외 포팅)
// 평가 목록·필터·승인(AdminResults) + 코칭 배정(CoachingPanel/Carousel/MiniCard/DetailModal/CreateModal)
import React, { useState, useEffect } from 'react';
import { Icon, PageHead, PeriodPicker, Modal, Gauge, StatusPill, ScoreBreakdown, Avatar, ChannelChip, defaultPeriod } from './ui';
import { DIMENSIONS, COUNSELORS, COACHING_GROUPS, scoreClass, fmtNum } from './mockData';
import { fetchCalls } from '../../services/api';

// /api/calls(실데이터) 한 행 → 평가목록 행 모양으로 변환.
//   평가 ID 개념이 없으므로 상담번호(UID)를 사용. 채널은 io_divi(I/O) → inbound/outbound.
//   코칭/항목별 점수·요약은 백엔드 미존재 → 비움(이번 범위는 목록만).
const AV_POOL = ['av-1', 'av-2', 'av-3', 'av-4', 'av-5', 'av-6'];
const REVIEW_TO_STATUS = { completed: 'completed', in_review: 'reviewed', pending: 'pending' };
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
        date: dt.slice(0, 10),
        time: dt.slice(11, 16),
        duration: c.duration_sec ? `${Math.floor(c.duration_sec / 60)}:${String(c.duration_sec % 60).padStart(2, '0')}` : '-',
        channel: c.channel || null,                  // 'inbound' | 'outbound' | null
        team: c.department || '-',
        category: c.consultation_type || '-',
        score,
        scores: {},
        status: REVIEW_TO_STATUS[c.review_status] || 'pending',
        reviewer: null,
        summary: '',
        selfReview: null,
        approved: c.review_status === 'completed',
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
    emotion: { title: '감정 컨트롤 · 회복 응대', priority: 'high', icon: 'heart-pulse', tutor: '클레임 응대 시뮬레이션', items: ['강한 클레임 상황 시뮬레이션 3회 진행', '공감·인정 표현 스크립트 10종 숙지', '감정 라벨링 후 재진술 연습'] },
    followup: { title: '후속 안내 · 클로징 강화', priority: 'mid', icon: 'phone-forwarded', tutor: '클로징 커뮤니케이션 코스', items: ['클로징 체크리스트 적용 (추가문의·재안내·인사)', '모범 마무리 통화 5건 청취'] },
    lead: { title: '두괄식 결론 전달', priority: 'mid', icon: 'list-ordered', tutor: '두괄식 커뮤니케이션 코스', items: ['결론–근거–안내 3단 구조 템플릿 학습', '모범 통화 5건 청취 후 셀프 리뷰'] },
    needs: { title: '니즈 파악 · 복창', priority: 'high', icon: 'list-checks', tutor: '니즈 파악 집중 코스', items: ['핵심 복창 체크포인트 셀프 점검 루틴', '니즈 정리 질문 5종 숙지'] },
    polite: { title: '정중한 표현 · 어법', priority: 'mid', icon: 'message-circle', tutor: '응대 화법 코스', items: ['단정적 거절 대신 대안 제시 화법 연습', '정중 표현 스크립트 숙지'] },
};

// ─────────────────────────────────────────────────────
// 평가 관리 — 평가 결과 + 코칭 배정을 한 화면에서
// ─────────────────────────────────────────────────────
export default function AdminEvalMgmt() {
    const [coaching, setCoaching] = useState(() => COACHING_GROUPS.map((g) => ({ ...g })));
    const [modalOpen, setModalOpen] = useState(false);
    const [results, setResults] = useState(null); // null=로딩, []=없음

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
        return () => { cancelled = true; };
    }, []);

    const assign = (key) =>
        setCoaching((list) => list.map((g) => (g.key === key ? { ...g, assigned: true, assignedBy: '이수정', assignedAt: '2026-05-26', status: '배정됨' } : g)));
    const unassign = (key) =>
        setCoaching((list) => list.map((g) => (g.key === key ? { ...g, assigned: false, assignedBy: null, assignedAt: null, status: null } : g)));
    const removeItem = (key) => setCoaching((list) => list.filter((g) => g.key !== key));
    const addCoaching = (entry) => setCoaching((list) => [{ ...entry }, ...list]);

    return (
        <div>
            <PageHead eyebrow="관리자 · 평가 관리" title="평가 관리" sub="조직 전체 평가 데이터를 분석하고, 취약 상담사에게 코칭을 배정합니다.">
                <button className="btn-mini primary" onClick={() => setModalOpen(true)}>
                    <Icon name="plus" />코칭 배정
                </button>
            </PageHead>

            <AdminResults
                embedded
                results={results || []}
                loading={results === null}
                beforeList={<CoachingPanel coaching={coaching} onAssign={assign} onUnassign={unassign} onRemove={removeItem} onNew={() => setModalOpen(true)} />}
            />

            {modalOpen && (
                <CoachingCreateModal
                    onClose={() => setModalOpen(false)}
                    onCreate={(entry) => {
                        addCoaching(entry);
                        setModalOpen(false);
                    }}
                />
            )}
        </div>
    );
}

// 코칭 배정 섹션 — 요약 카드 리스트 (클릭 시 상세 모달)
function CoachingPanel({ coaching, onAssign, onUnassign, onRemove, onNew }) {
    const [openKey, setOpenKey] = useState(null);
    const memberObjs = (ids) => ids.map((id) => COUNSELORS.find((c) => c.id === id)).filter(Boolean);
    const active = coaching.filter((g) => g.assigned);
    const pending = coaching.filter((g) => !g.assigned);
    const openItem = coaching.find((g) => g.key === openKey) || null;

    return (
        <div className="panel" style={{ marginTop: 22 }}>
            <div className="panel-head">
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <div style={{ width: 24, height: 24, borderRadius: 6, background: 'var(--primary-soft)', color: 'var(--primary)', display: 'grid', placeItems: 'center' }}>
                        <Icon name="graduation-cap" size={13} />
                    </div>
                    <h3>코칭 배정</h3>
                    <span className="muted-text" style={{ fontSize: 12 }}>· 진행 {active.length} · 배정 대기 {pending.length}</span>
                </div>
                <button className="btn-mini primary" style={{ marginLeft: 'auto' }} onClick={onNew}>
                    <Icon name="plus" size={11} />새 코칭 배정
                </button>
            </div>
            <div className="panel-body" style={{ display: 'grid', gap: 18 }}>
                {active.length > 0 && (
                    <CoachingCarousel label={<>진행 중인 코칭 · {active.length}</>} items={active} memberObjs={memberObjs} onOpen={setOpenKey} />
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
                    onUnassign={onUnassign}
                    onRemove={(k) => {
                        onRemove(k);
                        setOpenKey(null);
                    }}
                />
            )}
        </div>
    );
}

// 좌우 이전/다음 버튼으로 그룹을 넘겨 보는 캐러셀
function CoachingCarousel({ label, items, memberObjs, onOpen }) {
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
        <div>
            <div className="eyebrow" style={{ fontSize: 10.5, display: 'inline-flex', alignItems: 'center', gap: 6, marginBottom: 10 }}>{label}</div>
            <div style={{ display: 'flex', alignItems: 'stretch', gap: 10 }}>
                {canScroll && sideBtn(-1, atStart)}
                <div ref={ref} className="no-scrollbar" onScroll={update} style={{ flex: 1, minWidth: 0, display: 'flex', gap: 12, overflowX: canScroll ? 'auto' : 'visible', scrollSnapType: 'x mandatory', paddingBottom: 2 }}>
                    {items.map((g) => (
                        <div key={g.key} style={{ flex: '0 0 calc((100% - 24px) / 3)', minWidth: 0, scrollSnapAlign: 'start' }}>
                            <CoachingMiniCard g={g} members={memberObjs(g.members)} onOpen={() => onOpen(g.key)} />
                        </div>
                    ))}
                </div>
                {canScroll && sideBtn(1, atEnd)}
            </div>
        </div>
    );
}

// 요약 카드 — 제목 · 상태 · 대상 인원만, 클릭 시 상세
function CoachingMiniCard({ g, members, onOpen }) {
    const p = COACH_PRIORITY[g.priority] || COACH_PRIORITY.mid;
    const shown = members.slice(0, 4);
    return (
        <button
            onClick={onOpen}
            className="hover-lift"
            style={{ width: '100%', boxSizing: 'border-box', textAlign: 'left', cursor: 'pointer', fontFamily: 'inherit', border: '1px solid var(--border)', borderRadius: 14, padding: '14px 16px', background: 'white', borderTop: `3px solid ${p.accent}`, display: 'flex', flexDirection: 'column', gap: 12 }}
        >
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <div style={{ width: 34, height: 34, borderRadius: 10, background: p.soft, color: p.accent, display: 'grid', placeItems: 'center', flexShrink: 0 }}>
                    <Icon name={g.icon} size={16} />
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13.5, fontWeight: 700, color: 'var(--ink-900)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{g.title}</div>
                    <div style={{ marginTop: 3 }}>
                        {g.assigned ? (
                            <span className="pill green" style={{ fontSize: 9.5 }}>
                                <Icon name="check" size={9} />{g.status || '배정됨'}
                            </span>
                        ) : (
                            <span className="pill" style={{ background: p.soft, color: p.accent, fontSize: 9.5, fontWeight: 700 }}>{p.label}</span>
                        )}
                    </div>
                </div>
                <Icon name="chevron-right" size={16} style={{ color: 'var(--ink-400)', flexShrink: 0 }} />
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, paddingTop: 11, borderTop: '1px solid var(--border)' }}>
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
                                <span className={`score-chip ${scoreClass(m.score)}`} style={{ fontSize: 10.5 }}>{m.score.toFixed(1)}</span>
                            </div>
                        ))}
                    </div>
                </div>

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
                    <span className="field-label">Tutor 코스</span>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '11px 13px', border: `1px solid ${p.flat}`, background: p.soft, borderRadius: 10 }}>
                        <Icon name="sparkles" size={15} style={{ color: p.accent }} />
                        <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink-900)' }}>{g.tutor}</span>
                    </div>
                </div>
            </div>
        </Modal>
    );
}

// 코칭 만들기 모달
function CoachingCreateModal({ onClose, onCreate }) {
    const [targetType, setTargetType] = useState('group');
    const [selected, setSelected] = useState([]);
    const [focus, setFocus] = useState('');
    const [items, setItems] = useState([]);
    const [tutor, setTutor] = useState('');

    const pickFocus = (key) => {
        setFocus(key);
        const p = COACH_PRESETS[key];
        if (p) {
            setItems([...p.items]);
            setTutor(p.tutor);
        }
    };
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
        const p = COACH_PRESETS[focus];
        onCreate({
            key: 'c-' + Date.now(),
            title: p.title,
            priority: p.priority,
            icon: p.icon,
            reason: '관리자가 직접 배정한 코칭입니다.',
            criteria: '직접 선택',
            items: items.filter((x) => x.trim()),
            tutor: tutor.trim() || p.tutor,
            members: selected,
            targetType,
            assigned: true,
            assignedBy: '이수정',
            assignedAt: '2026-05-26',
            status: '배정됨',
        });
    };

    return (
        <Modal
            title="코칭 배정"
            onClose={onClose}
            foot={
                <>
                    <button className="btn-mini" onClick={onClose}>취소</button>
                    <button className="btn-mini primary" disabled={!canSave} onClick={submit}>
                        <Icon name="send" size={11} />배정하기
                    </button>
                </>
            }
        >
            <div style={{ display: 'grid', gap: 20 }}>
                <div className="field">
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
                    <span className="field-hint">{targetType === 'group' ? '여러 상담사를 한 코칭으로 묶어 배정합니다.' : '한 명에게 개별 배정합니다.'}</span>
                </div>

                <div className="field">
                    <span className="field-label">대상 상담사 {selected.length > 0 && <span style={{ color: 'var(--primary)' }}>· {selected.length}명</span>}</span>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                        {COUNSELORS.map((c) => {
                            const on = selected.includes(c.id);
                            return (
                                <button
                                    key={c.id}
                                    onClick={() => toggleMember(c.id)}
                                    style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '9px 11px', cursor: 'pointer', fontFamily: 'inherit', textAlign: 'left', border: on ? '1px solid var(--primary)' : '1px solid var(--border)', borderRadius: 10, background: on ? 'var(--primary-soft)' : 'white', transition: 'all var(--t-base)' }}
                                >
                                    <Avatar id={c.av} name={c.name} />
                                    <div style={{ flex: 1, minWidth: 0 }}>
                                        <div style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--ink-900)' }}>{c.name}</div>
                                        <div className="muted-text" style={{ fontSize: 10.5 }}>{c.team}</div>
                                    </div>
                                    <span className={`score-chip ${scoreClass(c.score)}`} style={{ fontSize: 10.5 }}>{c.score.toFixed(1)}</span>
                                    {on && <Icon name="check-circle" size={15} style={{ color: 'var(--primary)' }} />}
                                </button>
                            );
                        })}
                    </div>
                </div>

                <div className="field">
                    <span className="field-label">집중 영역</span>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                        {Object.entries(COACH_PRESETS).map(([k, p]) => {
                            const on = focus === k;
                            return (
                                <button
                                    key={k}
                                    onClick={() => pickFocus(k)}
                                    style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '8px 12px', cursor: 'pointer', fontFamily: 'inherit', border: on ? '1px solid var(--primary)' : '1px solid var(--border)', borderRadius: 9, background: on ? 'var(--primary-soft)' : 'white', color: on ? 'var(--primary)' : 'var(--ink-700)', fontSize: 12.5, fontWeight: 600, transition: 'all var(--t-base)' }}
                                >
                                    <Icon name={p.icon} size={13} />{p.title}
                                </button>
                            );
                        })}
                    </div>
                    <span className="field-hint">영역을 선택하면 액션 아이템과 Tutor 코스가 자동으로 채워집니다. 자유롭게 수정하세요.</span>
                </div>

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

                {focus && (
                    <div className="field">
                        <span className="field-label">Tutor 코스</span>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            <Icon name="sparkles" size={14} style={{ color: 'var(--primary)' }} />
                            <input className="text-input" value={tutor} onChange={(e) => setTutor(e.target.value)} style={{ flex: 1 }} placeholder="연결할 Tutor 코스" />
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
function AdminResults({ embedded, beforeList, results = [], loading = false }) {
    const [period, setPeriod] = useState(defaultPeriod('7d'));
    const [channel, setChannel] = useState('all');
    const [team, setTeam] = useState('all');
    const [approval, setApproval] = useState('all');
    const [approvedIds, setApprovedIds] = useState(() => new Set());
    const [scoreRange, setScoreRange] = useState('all');
    const [search, setSearch] = useState('');
    const [selected, setSelected] = useState(new Set());
    const [sort, setSort] = useState({ key: 'date', dir: 'desc' });
    const [drawerId, setDrawerId] = useState(null);

    // 실데이터 로드 후 최종승인 상태(review_status='completed') 시드.
    useEffect(() => {
        setApprovedIds(new Set(results.filter((r) => r.approved).map((r) => r.id)));
    }, [results]);

    // 행 클릭 → 기존 평가리스트의 실제 "상세 QA 분석" 화면(#/detail/{qa_id}, Detail.jsx)으로 이동.
    // 앱 전체가 단일 해시라우팅 SPA 라, hash 만 바꾸면 App 이 Detail 로 전환한다.
    const openDetail = (qaId) => {
        if (typeof window !== 'undefined') window.location.hash = `#/detail/${encodeURIComponent(qaId)}`;
    };

    const TEAMS = ['강남 1팀', '강남 2팀'];

    const filtered = results.filter((r) => {
        if (channel !== 'all' && r.channel !== channel) return false;
        if (team !== 'all' && r.team !== team) return false;
        if (approval === 'approved' && !approvedIds.has(r.id)) return false;
        if (approval === 'pending' && approvedIds.has(r.id)) return false;
        if (scoreRange === 'high' && r.score < 90) return false;
        if (scoreRange === 'mid' && (r.score < 75 || r.score >= 90)) return false;
        if (scoreRange === 'low' && r.score >= 75) return false;
        if (search) {
            const q = search.toLowerCase();
            if (!`${r.name} ${r.sessionId} ${r.category} ${r.team} ${r.id}`.toLowerCase().includes(q)) return false;
        }
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

    const toggle = (id) => {
        const next = new Set(selected);
        next.has(id) ? next.delete(id) : next.add(id);
        setSelected(next);
    };
    const approve = (id) =>
        setApprovedIds((s) => {
            const n = new Set(s);
            n.add(id);
            return n;
        });
    const approveSelected = () =>
        setApprovedIds((s) => {
            const n = new Set(s);
            selected.forEach((id) => n.add(id));
            return n;
        });
    const toggleAll = () => {
        if (selected.size === filtered.length) setSelected(new Set());
        else setSelected(new Set(filtered.map((r) => r.id)));
    };

    const avgScore = filtered.length ? Math.round((filtered.reduce((s, r) => s + r.score, 0) / filtered.length) * 10) / 10 : 0;
    const excellent = filtered.filter((r) => r.score >= 90).length;
    const coachingCnt = filtered.filter((r) => r.score < 75).length;

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
    const COLS = '36px 104px 84px 1.2fr 88px 84px 1fr 64px 112px 104px 30px';

    return (
        <div>
            {embedded ? (
                <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 8, marginBottom: 18 }}>
                    <PeriodPicker value={period} onChange={setPeriod} />
                    <button className="btn-mini">
                        <Icon name="download" />CSV
                    </button>
                </div>
            ) : (
                <PageHead eyebrow="관리자 · 평가 결과" title="조직 전체 평가 데이터" sub="모든 채널·부서·상담사의 평가를 검색, 필터링, 분석합니다.">
                    <PeriodPicker value={period} onChange={setPeriod} />
                    <button className="btn-mini">
                        <Icon name="download" />CSV
                    </button>
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
                        <Icon name="trophy" />우수 (90+)
                    </span>
                    <div className="value" style={{ color: '#2f9759' }}>
                        {excellent}<span className="unit">건</span>
                    </div>
                    <div className="foot">{filtered.length ? Math.round((excellent / filtered.length) * 100) : 0}%</div>
                </div>
                <div className="kpi">
                    <span className="eyebrow" style={{ color: 'var(--destructive)' }}>
                        <Icon name="alert-triangle" />코칭 필요 (75 미만)
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
                            <button className={`seg-btn ${scoreRange === 'high' ? 'active' : ''}`} onClick={() => setScoreRange('high')}>우수 90+</button>
                            <button className={`seg-btn ${scoreRange === 'mid' ? 'active' : ''}`} onClick={() => setScoreRange('mid')}>보통 75-89</button>
                            <button className={`seg-btn ${scoreRange === 'low' ? 'active' : ''}`} onClick={() => setScoreRange('low')}>코칭 &lt;75</button>
                        </div>
                    </div>
                </div>
            </div>

            {/* 검색 + 필터 초기화 */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, margin: '12px 2px 16px' }}>
                <div style={{ position: 'relative', width: 340, maxWidth: '60%' }}>
                    <Icon name="search" size={14} style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--ink-400)', pointerEvents: 'none' }} />
                    <input type="text" className="text-input" placeholder="평가 ID·상담사·세션 검색" value={search} onChange={(e) => setSearch(e.target.value)} style={{ width: '100%', paddingLeft: 34 }} />
                </div>
                <button
                    className="btn-mini"
                    style={{ marginLeft: 'auto' }}
                    onClick={() => {
                        setChannel('all');
                        setTeam('all');
                        setApproval('all');
                        setScoreRange('all');
                        setSearch('');
                    }}
                >
                    <Icon name="x" />필터 초기화
                </button>
            </div>

            {/* Bulk action toolbar */}
            {selected.size > 0 && (
                <div className="panel" style={{ marginBottom: 14, padding: '12px 18px', background: 'var(--brand-navy)', color: 'white', border: 'none', display: 'flex', alignItems: 'center', gap: 12 }}>
                    <span style={{ fontSize: 13.5, fontWeight: 600 }}>
                        <span className="mono" style={{ fontSize: 16, fontWeight: 800, marginRight: 4 }}>{selected.size}</span>건 선택됨
                    </span>
                    <button className="btn-mini" onClick={approveSelected} style={{ background: 'rgba(255,255,255,0.16)', borderColor: 'rgba(255,255,255,0.3)', color: 'white' }}>
                        <Icon name="check" />선택 승인
                    </button>
                    <button className="btn-mini" style={{ background: 'rgba(255,255,255,0.12)', borderColor: 'rgba(255,255,255,0.22)', color: 'white' }}>
                        <Icon name="user-plus" />코치 배정
                    </button>
                    <button className="btn-mini" style={{ background: 'rgba(255,255,255,0.12)', borderColor: 'rgba(255,255,255,0.22)', color: 'white' }}>
                        <Icon name="play" />재평가
                    </button>
                    <button className="btn-mini" style={{ background: 'rgba(255,255,255,0.12)', borderColor: 'rgba(255,255,255,0.22)', color: 'white' }}>
                        <Icon name="download" />CSV 내보내기
                    </button>
                    <button className="btn-mini" style={{ background: 'rgba(255,255,255,0.12)', borderColor: 'rgba(255,255,255,0.22)', color: 'white' }}>
                        <Icon name="trash-2" />삭제
                    </button>
                    <button onClick={() => setSelected(new Set())} style={{ marginLeft: 'auto', background: 'transparent', border: 0, color: 'rgba(255,255,255,0.7)', fontSize: 12.5, cursor: 'pointer', fontFamily: 'inherit' }}>
                        선택 해제
                    </button>
                </div>
            )}

            {/* 코칭 배정 (평가 목록 바로 위) */}
            {beforeList}

            {/* Results table */}
            <div className="panel">
                <div className="panel-head">
                    <h3>평가 목록</h3>
                    <div className="sub" style={{ marginLeft: 12 }}>{filtered.length}건 표시 중</div>
                </div>
                <div>
                    <div className="tbl-head" style={{ gridTemplateColumns: COLS, borderTop: 0 }}>
                        <div style={{ display: 'grid', placeItems: 'center' }}>
                            <input type="checkbox" checked={filtered.length > 0 && selected.size === filtered.length} onChange={toggleAll} style={{ cursor: 'pointer' }} />
                        </div>
                        <div style={{ cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 4 }} onClick={() => sortBy('date')}>
                            일시 <SortIcon k="date" />
                        </div>
                        <div>상담번호</div>
                        <div style={{ cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 4 }} onClick={() => sortBy('name')}>
                            상담사 <SortIcon k="name" />
                        </div>
                        <div>채널</div>
                        <div>부서</div>
                        <div>카테고리</div>
                        <div style={{ textAlign: 'right', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 4, justifySelf: 'end' }} onClick={() => sortBy('score')}>
                            점수 <SortIcon k="score" />
                        </div>
                        <div>수기검토</div>
                        <div>최종승인</div>
                        <div></div>
                    </div>
                    <div style={{ maxHeight: 430, overflowY: 'auto' }}>
                        {filtered.map((r) => {
                            const approved = approvedIds.has(r.id);
                            return (
                                <div key={r.id} className="tbl-row clickable" onClick={() => openDetail(r.id)} style={{ gridTemplateColumns: COLS, background: selected.has(r.id) ? 'var(--primary-soft)' : undefined }}>
                                    <div style={{ display: 'grid', placeItems: 'center' }} onClick={(e) => e.stopPropagation()}>
                                        <input type="checkbox" checked={selected.has(r.id)} onChange={() => toggle(r.id)} style={{ cursor: 'pointer' }} />
                                    </div>
                                    <div>
                                        <div className="mono" style={{ fontSize: 12, fontWeight: 600 }}>{r.date.slice(5)}</div>
                                        <div className="muted-text mono" style={{ fontSize: 10.5, marginTop: 2 }}>{r.time}</div>
                                    </div>
                                    <div className="mono" style={{ fontSize: 11.5, color: 'var(--ink-500)', fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title={r.sessionId}>{r.sessionId}</div>
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
                                    <div style={{ textAlign: 'right' }}>
                                        <span className={`score-chip ${scoreClass(r.score)}`}>{r.score}</span>
                                    </div>
                                    <div>
                                        {r.selfReview ? (
                                            <span className="pill" style={{ background: 'var(--primary-soft)', color: 'var(--primary)', fontSize: 10.5, fontWeight: 700 }} title={`${r.selfReview.by} · ${r.selfReview.date}`}>
                                                <Icon name="user-check" size={10} />상담사 검토
                                            </span>
                                        ) : (
                                            <span className="muted-text" style={{ fontSize: 11.5, color: 'var(--ink-400)' }}>미검토</span>
                                        )}
                                    </div>
                                    <div onClick={(e) => e.stopPropagation()}>
                                        {approved ? (
                                            <span className="pill green" style={{ fontSize: 10.5, fontWeight: 700 }}>
                                                <Icon name="check-circle" size={10} />승인 완료
                                            </span>
                                        ) : (
                                            <button className="btn-mini primary" onClick={() => approve(r.id)} style={{ height: 26, padding: '0 9px' }}>
                                                <Icon name="check" size={11} />승인
                                            </button>
                                        )}
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
