// 전역 알림 벨 + 슬라이드 패널(알림 센터).
// 03(Meta-Summary) 알림센터 디자인을 차용하되, 데이터는 05 백엔드(수신자별 영구 알림)에서 가져온다.
//   현재 알림 = 안읽음(read=false), 지난 알림 = 읽음. 카드 클릭 시 읽음 처리 + 상세 이동.
import React, { useEffect, useMemo, useState, useCallback } from 'react';
import { Bell, X, Trash2, CheckCircle2, Pencil, ClipboardCheck, GraduationCap, Award, Undo2, Sparkles } from 'lucide-react';
import {
    fetchNotifications,
    fetchUnreadCount,
    markNotificationRead,
    deleteNotification,
    deleteAllNotifications,
    fetchMyCoaching,
} from '../services/api';
import { buildTutorLink } from '../utils/coachingTutorLink';
import { openCallDetail, Modal, Icon } from '../views/evalMgmt/ui';
import { scenById, catMeta, scoreClass } from '../views/evalMgmt/mockData';

// 알림 타입 → 배지/아이콘.
const TYPE_META = {
    review_approved: { label: '승인', cls: 'bg-[#ECFDF3] text-[#067647] border-[#ABEFC6]', Icon: CheckCircle2 },
    review_edited: { label: '수정 반영', cls: 'bg-[#FFFAEB] text-[#B54708] border-[#FEDF89]', Icon: Pencil },
    review_submitted: { label: '검토요청', cls: 'bg-[#EEF4FB] text-[#055AAF] border-[#BFD4F2]', Icon: ClipboardCheck },
    review_revised: { label: '반려', cls: 'bg-[#FFFAEB] text-[#B54708] border-[#FEDF89]', Icon: Pencil },
    review_acknowledged: { label: '동의', cls: 'bg-[#ECFDF3] text-[#067647] border-[#ABEFC6]', Icon: CheckCircle2 },
    review_reobjected: { label: '이의제기', cls: 'bg-[#FEF3F2] text-[#B42318] border-[#FECDCA]', Icon: Undo2 },
    coaching_assigned: { label: '코칭 배정', cls: 'bg-[#F4F3FF] text-[#5925DC] border-[#D9D6FE]', Icon: GraduationCap },
    coaching_completed: { label: '코칭 완료', cls: 'bg-[#ECFDF3] text-[#067647] border-[#ABEFC6]', Icon: Award },
    golden_learn_completed: { label: '학습 완료', cls: 'bg-[#ECFDF3] text-[#067647] border-[#ABEFC6]', Icon: Sparkles },
    golden_learn_failed: { label: '학습 실패', cls: 'bg-[#FEF3F2] text-[#B42318] border-[#FECDCA]', Icon: Sparkles },
};
const metaOf = (t) => TYPE_META[t] || { label: '알림', cls: 'bg-[#F2F4F7] text-[#667085] border-[#E4E7EC]', Icon: Bell };

// 알림 → 이동할 해시. qa_call=상세, coaching=평가/코칭 화면(eval-mgmt; 역할별로 적합 화면 렌더).
function hashFor(n) {
    if (n.resource_type === 'qa_call' && n.resource_id) return `#/detail/${encodeURIComponent(n.resource_id)}`;
    if (n.resource_type === 'coaching') return '#/eval-mgmt';
    if (n.resource_type === 'golden_learn') return '#/admin/batch';
    return null;
}

function fmtTime(ts) {
    if (!ts) return '';
    const d = new Date(ts);
    if (Number.isNaN(d.getTime())) return '';
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

// 새로 배정된 코칭 플랜 팝업 — 코칭 배정 알림 클릭 시. 내 평가결과로 튕기지 않고
// 무엇을 새로 받았는지(집중영역·시나리오·액션·배정 근거) 바로 보여준다.
// 앱 공용 Modal + 디자인 토큰(.field/.pill/var(--...))로 코칭 상세 모달과 톤 통일.
function CoachingPlanModal({ coaching, onClose }) {
    const g = coaching || {};
    const isChat = g.channel === 'chat';
    const scenarios = Array.isArray(g.scenarios) ? g.scenarios : [];
    const items = Array.isArray(g.items) ? g.items : [];
    const reasons = Array.isArray(g.reasons) ? g.reasons : [];
    const link = buildTutorLink(g);
    const startLearning = () => {
        if (!link) { alert('튜터 학습 앱 주소가 설정되지 않았습니다. 관리자에게 문의하세요.'); return; }
        if (typeof window !== 'undefined') window.open(link, '_blank', 'noopener');
    };
    return (
        <Modal
            title={g.title || '새로 배정된 코칭'}
            onClose={onClose}
            width={560}
            foot={
                <>
                    <button className="btn-mini" onClick={onClose}>닫기</button>
                    <button className="btn-mini primary" onClick={startLearning}>
                        <Icon name="graduation-cap" size={11} />학습 시작
                    </button>
                </>
            }
        >
            <div style={{ display: 'grid', gap: 18 }}>
                {/* 헤더 요약 */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    <div style={{ width: 44, height: 44, borderRadius: 12, background: 'var(--primary-soft)', color: 'var(--primary)', display: 'grid', placeItems: 'center', flexShrink: 0 }}>
                        <Icon name="graduation-cap" size={21} />
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                            <span className="pill" style={{ background: 'var(--primary-soft)', color: 'var(--primary)', fontSize: 10.5, fontWeight: 700 }}>새 코칭</span>
                            <span className="pill" style={{ background: isChat ? '#eef6ee' : 'var(--primary-soft)', color: isChat ? '#3a7a3a' : 'var(--primary)', fontSize: 10.5, fontWeight: 700 }}>
                                <Icon name={isChat ? 'message-square' : 'phone'} size={9} />{isChat ? '채팅' : '전화'}
                            </span>
                        </div>
                        <div className="muted-text" style={{ fontSize: 12, marginTop: 6 }}>{g.assignedBy ? `${g.assignedBy} 배정` : '관리자 배정'}{g.assignedAt ? ` · ${g.assignedAt}` : ''}</div>
                    </div>
                </div>

                {items.length > 0 && (
                    <div className="field">
                        <span className="field-label">개선 액션 아이템 · {items.length}</span>
                        <div style={{ display: 'grid', gap: 8 }}>
                            {items.map((it, i) => (
                                <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 9, padding: '10px 12px', background: 'var(--background-soft)', borderRadius: 9 }}>
                                    <div style={{ width: 18, height: 18, borderRadius: 5, border: '1.5px solid var(--primary)', color: 'var(--primary)', display: 'grid', placeItems: 'center', flexShrink: 0, marginTop: 1 }}>
                                        <Icon name="check" size={11} />
                                    </div>
                                    <span style={{ fontSize: 12.5, color: 'var(--ink-700)', lineHeight: 1.45 }}>{it}</span>
                                </div>
                            ))}
                        </div>
                    </div>
                )}

                {scenarios.length > 0 && (
                    <div className="field">
                        <span className="field-label">Tutor 시나리오 · {scenarios.length}개</span>
                        <div style={{ display: 'grid', gap: 6 }}>
                            {scenarios.map((code) => {
                                const s = scenById(code);
                                const cm = s ? catMeta(s.cat) : null;
                                return (
                                    <div key={code} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', border: '1px solid var(--border)', background: 'var(--primary-soft)', borderRadius: 10 }}>
                                        <span className="mono" style={{ fontSize: 11, fontWeight: 700, color: 'var(--primary)', width: 28, flexShrink: 0 }}>{s ? s.code : code}</span>
                                        <span style={{ flex: 1, fontSize: 13, fontWeight: 600, color: 'var(--ink-900)' }}>{s ? s.title : code}</span>
                                        {cm && <span className="pill" style={{ background: 'white', color: cm.color, fontSize: 10, fontWeight: 700, border: `1px solid ${cm.color}33` }}>{cm.label}</span>}
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                )}

                {reasons.length > 0 && (
                    <div className="field">
                        <span className="field-label">배정 근거 · 내 콜 {reasons.length}건</span>
                        <div style={{ display: 'grid', gap: 6 }}>
                            {reasons.map((r) => (
                                <div
                                    key={r.callId}
                                    onClick={() => openCallDetail(r.callId)}
                                    title="상담 QA 분석 상세 보기"
                                    style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px', background: 'var(--background-soft)', borderRadius: 8, cursor: 'pointer' }}
                                >
                                    <span style={{ fontSize: 12, color: 'var(--ink-700)', whiteSpace: 'nowrap' }}>{String(r.date || '').slice(0, 16).replace('T', ' ')}</span>
                                    {r.callNo && <span className="mono muted-text" style={{ fontSize: 10.5, whiteSpace: 'nowrap' }}>#{r.callNo}</span>}
                                    <span style={{ flex: 1 }} />
                                    <span className={`score-chip ${scoreClass(r.score)}`} style={{ fontSize: 10.5, flexShrink: 0 }}>{r.score != null ? Number(r.score).toFixed(1) : '-'}</span>
                                    <Icon name="external-link" size={12} style={{ color: 'var(--ink-400)', flexShrink: 0 }} />
                                </div>
                            ))}
                        </div>
                    </div>
                )}
            </div>
        </Modal>
    );
}

export default function NotificationBell() {
    const [open, setOpen] = useState(false);
    const [items, setItems] = useState([]);
    const [unread, setUnread] = useState(0);
    const [tab, setTab] = useState('current'); // current | past
    const [plan, setPlan] = useState(null); // 코칭 배정 알림 클릭 시 표시할 코칭 플랜

    const load = useCallback(async () => {
        try {
            const data = await fetchNotifications('all');
            setItems(Array.isArray(data) ? data : []);
        } catch {
            setItems([]);
        }
    }, []);

    const refreshCount = useCallback(async () => {
        try {
            const r = await fetchUnreadCount();
            setUnread(Number(r?.count) || 0);
        } catch {
            /* noop */
        }
    }, []);

    // 안읽음 카운트 폴링(45s) — 캐시 친화적 간격.
    useEffect(() => {
        refreshCount();
        const t = setInterval(refreshCount, 45000);
        return () => clearInterval(t);
    }, [refreshCount]);

    // 패널 열 때 목록 로드.
    useEffect(() => {
        if (open) load();
    }, [open, load]);

    const current = useMemo(() => items.filter((n) => !n.read), [items]);
    const past = useMemo(() => items.filter((n) => n.read), [items]);
    const visible = tab === 'current' ? current : past;

    const goTo = async (n) => {
        if (!n.read) {
            setItems((list) => list.map((x) => (x.id === n.id ? { ...x, read: true } : x)));
            setUnread((c) => Math.max(0, c - 1));
            markNotificationRead(n.id).catch(() => {});
        }
        setOpen(false);
        // 코칭 배정 알림 → 내 평가결과로 튕기지 않고, 새로 받은 코칭 플랜을 팝업으로.
        if (n.type === 'coaching_assigned' && n.resource_id) {
            try {
                const mine = await fetchMyCoaching();
                const g = (Array.isArray(mine) ? mine : []).find((c) => String(c.id) === String(n.resource_id));
                if (g) { setPlan(g); return; }
            } catch {
                /* 조회 실패 시 아래 기본 이동으로 폴백 */
            }
        }
        const hash = hashFor(n);
        if (hash && typeof window !== 'undefined') window.location.hash = hash;
    };

    const remove = async (e, id) => {
        e.stopPropagation();
        const target = items.find((x) => x.id === id);
        setItems((list) => list.filter((x) => x.id !== id));
        if (target && !target.read) setUnread((c) => Math.max(0, c - 1));
        deleteNotification(id).catch(() => {});
    };

    const clearAll = async () => {
        setItems([]);
        setUnread(0);
        deleteAllNotifications().catch(() => {});
    };

    return (
        <>
            <button
                type="button"
                onClick={() => setOpen(true)}
                className="relative inline-flex items-center justify-center w-9 h-9 rounded-lg text-[#475467] hover:bg-[#F2F4F7] transition-colors"
                title="알림"
                aria-label="알림 센터 열기"
            >
                <Bell size={18} />
                {unread > 0 && (
                    <span className="absolute -top-0.5 -right-0.5 min-w-[16px] h-[16px] px-1 rounded-full bg-[#F04438] text-white text-[10px] font-bold leading-[16px] text-center">
                        {unread > 99 ? '99+' : unread}
                    </span>
                )}
            </button>

            {open && (
                <div className="fixed inset-0 z-[200]" onClick={() => setOpen(false)}>
                    <div className="absolute inset-0 bg-black/20" />
                    <div
                        className="absolute top-0 right-0 h-full w-[400px] max-w-[92vw] bg-white shadow-2xl flex flex-col"
                        onClick={(e) => e.stopPropagation()}
                    >
                        {/* 헤더 */}
                        <div className="flex items-center gap-2 px-5 py-4 border-b border-[#E4E7EC]">
                            <Bell size={18} className="text-[#055AAF]" />
                            <h2 className="text-[15px] font-bold text-[#101828]">알림 센터</h2>
                            <button
                                type="button"
                                onClick={clearAll}
                                className="ml-auto inline-flex items-center gap-1 px-2.5 py-1 rounded-md border border-[#E4E7EC] text-[12px] text-[#667085] hover:bg-[#F9FAFB]"
                            >
                                <Trash2 size={12} />전체 삭제
                            </button>
                            <button type="button" onClick={() => setOpen(false)} className="p-1 text-[#98A2B3] hover:text-[#475467]">
                                <X size={18} />
                            </button>
                        </div>

                        {/* 탭 */}
                        <div className="flex gap-1 p-2 bg-[#F9FAFB] border-b border-[#E4E7EC]">
                            {[
                                { k: 'current', label: `현재 알림 (${current.length})` },
                                { k: 'past', label: `지난 알림 (${past.length})` },
                            ].map((t) => (
                                <button
                                    key={t.k}
                                    onClick={() => setTab(t.k)}
                                    className={`flex-1 py-1.5 rounded-md text-[12.5px] font-semibold transition-colors ${
                                        tab === t.k ? 'bg-[#055AAF] text-white' : 'text-[#667085] hover:bg-[#EEF2F7]'
                                    }`}
                                >
                                    {t.label}
                                </button>
                            ))}
                        </div>

                        {/* 목록 */}
                        <div className="flex-1 overflow-y-auto p-3 space-y-2">
                            {visible.length === 0 ? (
                                <div className="flex flex-col items-center justify-center text-center py-16 text-[#98A2B3]">
                                    <Bell size={28} className="mb-3 opacity-50" />
                                    <div className="text-[13px]">{tab === 'current' ? '새 알림이 없습니다' : '지난 알림이 없습니다'}</div>
                                </div>
                            ) : (
                                visible.map((n) => {
                                    const m = metaOf(n.type);
                                    return (
                                        <div
                                            key={n.id}
                                            onClick={() => goTo(n)}
                                            className={`group relative rounded-xl border p-3 cursor-pointer transition-colors ${
                                                n.read ? 'bg-white border-[#EEF2F7] hover:bg-[#FAFBFC]' : 'bg-[#FFFCF5] border-[#FEDF89] hover:bg-[#FFF8E8]'
                                            }`}
                                        >
                                            <div className="flex items-center gap-2 mb-1 pr-6">
                                                <m.Icon size={14} className="text-[#475467] shrink-0" />
                                                <span className="text-[13px] font-bold text-[#101828] truncate">{n.title}</span>
                                                <span className={`shrink-0 text-[10px] font-semibold px-1.5 py-0.5 rounded-full border ${m.cls}`}>{m.label}</span>
                                            </div>
                                            {n.body && <div className="text-[12px] text-[#475467] leading-relaxed mb-1 pr-2">{n.body}</div>}
                                            <div className="flex items-center gap-2 text-[11px] text-[#98A2B3]">
                                                <span>{fmtTime(n.created_at)}</span>
                                                {n.resource_type === 'qa_call' && <span>· 클릭 시 상세로 이동</span>}
                                                {n.resource_type === 'coaching' && <span>· 클릭 시 {n.type === 'coaching_assigned' ? '코칭 플랜 보기' : '코칭으로 이동'}</span>}
                                                {n.resource_type === 'golden_learn' && <span>· 클릭 시 골든셋 배치로 이동</span>}
                                            </div>
                                            <button
                                                type="button"
                                                onClick={(e) => remove(e, n.id)}
                                                className="absolute top-2 right-2 p-1 text-[#C0C6D0] opacity-0 group-hover:opacity-100 hover:text-[#475467] transition-opacity"
                                                title="삭제"
                                            >
                                                <X size={14} />
                                            </button>
                                        </div>
                                    );
                                })
                            )}
                        </div>
                    </div>
                </div>
            )}

            {plan && <CoachingPlanModal coaching={plan} onClose={() => setPlan(null)} />}
        </>
    );
}
