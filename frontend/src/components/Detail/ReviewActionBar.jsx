// 검수 워크플로우 액션 바 — 새 설계(반려/이의제기 루프) 화면 이식.
//   스텝퍼(6단계) + 역할별 상태 메시지/액션 버튼 + 반려·이의제기 사유 팝업 + 검수 이력 타임라인.
//   내부 상태값(review_done=검토요청, admin_revised=반려, objection=이의제기, approved=확정)을 그대로 사용.
import React, { useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, CornerUpLeft, Flag, Send, RotateCcw, History, Info, Clock, CheckCircle2, X } from 'lucide-react';

// 토큰(전역 CSS var 미정의 → 디자인의 hex 로 직접 매핑, 팔레트는 동일).
const C = {
    primary: 'var(--primary)', primaryActive: '#044a93', primarySoft: 'var(--primary-soft-flat)', primaryBorder: 'var(--primary-soft-flat)',
    success: 'var(--success)', successSoft: 'var(--success-soft)', successBorder: 'var(--success-soft)', green: 'var(--success)', greenHover: '#0E9F5B',
    warnInk: 'var(--warning)', warnSoft: 'var(--warning-soft)', warnBorder: 'var(--warning-soft)', warnDot: 'var(--warning)',
    destr: 'var(--destructive)', destrInk: 'var(--destructive)', destrSoft: 'var(--destructive-soft)', destrBorder: 'var(--destructive-soft)',
    ink900: 'var(--ink-900)', ink700: 'var(--ink-700)', ink600: 'var(--ink-700)', ink500: 'var(--ink-500)', ink400: 'var(--ink-400)', ink300: 'var(--ink-300)',
    muted: 'var(--muted)', border: 'var(--border)', borderSoft: 'var(--muted)', borderStrong: 'var(--border-strong)', bgSoft: 'var(--background-soft)', bg: 'var(--background-soft)',
};

// 6단계 스텝퍼 + 상태→단계 매핑(internal status 기준).
const REVIEW_STEPS = ['AI 평가', '상담사 검토', '관리자 검토', '이의 / 동의', '관리자 재검토', '점수 확정'];
const STATUS_STAGE = { pending: 1, in_review: 1, review_done: 2, admin_revised: 3, objection: 4, approved: 5 };

const REJECT_REASONS = ['평가 기준 미적용', '발화 매칭 오류', '점수 산정 오류', '근거 불충분', '기타'];
const OBJECT_REASONS = ['AI 점수가 과도하게 낮음', '평가 근거에 동의 불가', '발화 인용 오류', '정상 응대였음', '기타'];

// 검수 이력: action → 라벨/색(타임라인 점).
const ACTION_META = {
    start: { label: '검수 시작', tone: 'ink' },
    submit: { label: '검토 제출', tone: 'primary' },
    reject: { label: '반려 — 재검토 요청', tone: 'warn' },
    reject_again: { label: '다시 반려', tone: 'warn' },
    object: { label: '이의제기', tone: 'danger' },
    agree: { label: '점수 동의 — 확정', tone: 'success' },
    approve: { label: '최종 승인', tone: 'success' },
    reapprove: { label: '재검토 후 승인', tone: 'success' },
    direct_approve: { label: '관리자 직접 확정', tone: 'success' },
    force_approve: { label: '관리자 강제 확정', tone: 'success' },
    cancel: { label: '확정 취소', tone: 'ink' },
};
const DOT = { ink: C.ink300, primary: C.primary, warn: C.warnDot, danger: C.destr, success: C.green };

function fmtTime(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '';
    const p = (n) => String(n).padStart(2, '0');
    return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

function wfBtn(label, kind, onClick, { icon: IconC, disabled } = {}) {
    const styles = {
        primary: { background: C.primary, color: 'white', border: `1px solid ${C.primary}` },
        success: { background: C.green, color: 'white', border: `1px solid ${C.green}` },
        ghost: { background: 'white', color: C.ink700, border: `1px solid ${C.borderStrong}` },
        warn: { background: 'white', color: C.warnInk, border: `1px solid ${C.warnBorder}` },
        danger: { background: 'white', color: C.destrInk, border: `1px solid ${C.destrBorder}` },
    }[kind];
    return (
        <button key={label} onClick={onClick} disabled={disabled}
            style={{ ...styles, padding: '8px 15px', borderRadius: 8, fontSize: 12.5, fontWeight: 700, cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? 0.5 : 1, fontFamily: 'inherit', whiteSpace: 'nowrap', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            {IconC && <IconC size={13} />}{label}
        </button>
    );
}

// 간단 모달(전역 Modal 없음) — document.body 포털로 상위 zoom/transform 에 갇히지 않게 전체 화면을 덮는다.
function Modal({ title, width = 480, onClose, children }) {
    if (typeof document === 'undefined') return null;
    return createPortal(
        <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 1000, background: 'rgba(16,24,40,0.45)', display: 'grid', placeItems: 'center', padding: 16 }}>
            <div onClick={(e) => e.stopPropagation()} style={{ width, maxWidth: '94vw', maxHeight: '88vh', overflowY: 'auto', background: 'white', borderRadius: 14, boxShadow: '0 20px 48px rgba(28,36,64,0.16)' }}>
                <div style={{ display: 'flex', alignItems: 'center', padding: '15px 20px', borderBottom: `1px solid ${C.border}` }}>
                    <span style={{ fontSize: 15, fontWeight: 700, color: C.ink900 }}>{title}</span>
                    <button onClick={onClose} style={{ marginLeft: 'auto', background: 'transparent', border: 'none', cursor: 'pointer', color: C.ink400, display: 'grid', placeItems: 'center', padding: 4 }}><X size={18} /></button>
                </div>
                <div style={{ padding: 20 }}>{children}</div>
            </div>
        </div>,
        document.body
    );
}

export default function ReviewActionBar({ status, role, isSaving, onChange, reviewEvents = [], revisedItems = [], progress = null }) {
    const isAdmin = role === 'admin' || role === 'super_admin';
    const isAgent = role === 'agent';
    const [mode, setMode] = useState(null); // null | 'reject' | 'object'
    const [histOpen, setHistOpen] = useState(false);
    const [reasonSel, setReasonSel] = useState('');
    const [reasonEtc, setReasonEtc] = useState('');

    const stage = STATUS_STAGE[status] ?? 0;
    const rounds = useMemo(() => reviewEvents.filter((e) => e.action === 'object').length, [reviewEvents]);

    // 타임라인: AI 평가 완료(합성) + 실제 이벤트.
    const trail = useMemo(() => {
        const head = [{ key: 'ai', label: 'AI 평가 완료', tone: 'ink', actor: 'AI', ts: null }];
        const rest = reviewEvents.map((e) => {
            const m = ACTION_META[e.action] || { label: e.action, tone: 'ink' };
            return { key: e.id, label: m.label, tone: m.tone, actor: e.actor_name || '—', ts: e.created_at, reason: e.reason };
        });
        return [...head, ...rest];
    }, [reviewEvents]);

    const openForm = (m) => { setMode(m); setReasonSel(''); setReasonEtc(''); };
    const reasonText = () => (reasonSel === '기타' ? reasonEtc.trim() : reasonSel);
    const submitReason = () => {
        const r = reasonText();
        if (!r) return;
        onChange(mode === 'reject' ? 'admin_revised' : 'objection', { reason: r, alertOnError: true });
        setMode(null);
    };

    const forceBtn = wfBtn(`강제 확정${rounds >= 2 ? ` (이의 ${rounds}회)` : ''}`, rounds >= 2 ? 'danger' : 'ghost',
        () => { if (window.confirm('상담사 동의 없이 강제로 점수를 확정합니다. 계속할까요?')) onChange('approved', { alertOnError: true }); });

    // 역할·상태 → 배너 톤/메시지/버튼.
    let body = null;
    if (isAdmin) {
        if (status === 'pending' || status === 'in_review') {
            body = { tone: 'mute', msg: status === 'in_review' ? '상담사가 검수를 진행 중입니다. 검토요청 제출을 기다리고 있습니다.' : '상담사 검토 대기 중입니다. 관리자가 직접 확정할 수도 있습니다.',
                buttons: wfBtn('관리자 직접 확정', 'primary', () => { if (window.confirm('상담사 검토 없이 바로 확정합니다. 계속할까요?')) onChange('approved', { alertOnError: true }); }, { icon: Check }) };
        } else if (status === 'review_done') {
            body = { tone: 'primary', msg: '상담사 검토 제출분입니다. 점수를 확인 후 확정하거나, 재검토가 필요하면 반려하세요.',
                buttons: [wfBtn('반려', 'warn', () => openForm('reject'), { icon: CornerUpLeft }), wfBtn('최종 승인', 'success', () => onChange('approved', { alertOnError: true }), { icon: Check })] };
        } else if (status === 'objection') {
            // 이의제기엔 '반려 ↔ 확정' 두 갈래만 — 강제 확정은 재검토 후 승인과 결과가 같아 제거(혼동 방지).
            body = { tone: 'danger', msg: `상담사가 이의제기했습니다${rounds > 1 ? ` (${rounds}회째)` : ''}. 재검토 후 승인하거나 다시 반려할 수 있습니다.`,
                buttons: [wfBtn('다시 반려', 'warn', () => openForm('reject'), { icon: CornerUpLeft }), wfBtn('재검토 후 승인', 'success', () => onChange('approved', { alertOnError: true }), { icon: Check })] };
        } else if (status === 'admin_revised') {
            body = { tone: 'warn', msg: '반려 처리됨 · 상담사의 동의 또는 이의제기를 기다리고 있습니다.', buttons: forceBtn };
        } else if (status === 'approved') {
            body = { tone: 'success', msg: '점수가 확정된 평가입니다.',
                buttons: wfBtn('확정 취소', 'ghost', () => { if (window.confirm('확정을 취소하고 검토요청 상태로 되돌립니다. 계속할까요?')) onChange('review_done', { alertOnError: true }); }, { icon: RotateCcw }) };
        }
    } else if (isAgent) {
        if (status === 'pending' || status === 'in_review') {
            // 수기평가 100% 완료해야 검토 제출 가능 — 미완료면 버튼 비활성 + 진행률 안내.
            const total = progress?.total ?? 0;
            const done = progress?.done ?? 0;
            const ready = total > 0 && done >= total;
            body = { tone: 'primary',
                msg: ready ? '수기평가를 모두 완료했습니다. 검토요청을 제출하면 관리자 검토로 넘어갑니다.'
                           : `수기평가를 모두 입력해야 검토 제출할 수 있습니다 (${done}/${total || '-'}).`,
                buttons: wfBtn(ready ? '검토 제출' : `검토 제출 (${done}/${total || '-'})`, 'primary',
                    () => { if (ready && window.confirm('검토요청을 제출하면 관리자 검토로 넘어갑니다. 제출할까요?')) onChange('review_done', { alertOnError: true }); },
                    { icon: Send, disabled: !ready }) };
        } else if (status === 'review_done') {
            body = { tone: 'primary', msg: '검토 제출 완료 · 관리자 검토 대기 중입니다.', buttons: null };
        } else if (status === 'admin_revised') {
            body = { tone: 'warn', msg: '관리자가 반려했습니다. 점수에 동의하거나 이의제기할 수 있습니다.',
                buttons: [wfBtn('이의제기', 'danger', () => openForm('object'), { icon: Flag }), wfBtn('점수 동의 (확정)', 'success', () => { if (window.confirm('점수에 동의하면 확정됩니다. 계속할까요?')) onChange('approved', { alertOnError: true }); }, { icon: Check })] };
        } else if (status === 'objection') {
            body = { tone: 'danger', msg: '이의제기 접수됨 · 관리자 재검토 대기 중입니다.', buttons: null };
        } else if (status === 'approved') {
            body = { tone: 'success', msg: '점수가 확정된 평가입니다.', buttons: null };
        }
    }
    if (!body) return null;

    const toneMap = {
        primary: { ink: C.primary, soft: C.primarySoft, Icon: Info },
        warn: { ink: C.warnInk, soft: C.warnSoft, Icon: CornerUpLeft },
        danger: { ink: C.destrInk, soft: C.destrSoft, Icon: Flag },
        success: { ink: C.success, soft: C.successSoft, Icon: CheckCircle2 },
        mute: { ink: C.ink600, soft: C.muted, Icon: Clock },
    };
    const tm = toneMap[body.tone] || toneMap.mute;
    const showRevised = isAgent && status === 'admin_revised' && revisedItems.length > 0;

    return (
        <div style={{ marginTop: 14, marginBottom: 16 }}>
            <div style={{ border: `1px solid ${C.border}`, borderRadius: 14, background: 'white', overflow: 'hidden' }}>
                {/* 스텝퍼 */}
                <div style={{ display: 'flex', alignItems: 'center', padding: '15px 20px', overflowX: 'auto' }}>
                    {REVIEW_STEPS.map((s, i) => {
                        const done = i < stage, active = i === stage;
                        return (
                            <React.Fragment key={s}>
                                {i > 0 && <div style={{ flex: 1, height: 2, minWidth: 16, background: i <= stage ? C.primary : C.border }} />}
                                <div style={{ display: 'flex', alignItems: 'center', gap: 7, whiteSpace: 'nowrap', flexShrink: 0 }}>
                                    <span style={{ width: 22, height: 22, borderRadius: '50%', display: 'grid', placeItems: 'center', flexShrink: 0,
                                        background: done ? C.primary : active ? C.primarySoft : C.muted, color: done ? 'white' : active ? C.primary : C.ink300,
                                        border: active ? `1.5px solid ${C.primary}` : 'none', fontSize: 11, fontWeight: 800 }}>
                                        {done ? <Check size={12} strokeWidth={3} /> : i + 1}
                                    </span>
                                    <span style={{ fontSize: 12.5, fontWeight: active ? 700 : 600, color: active || done ? C.ink900 : C.ink400 }}>{s}</span>
                                </div>
                            </React.Fragment>
                        );
                    })}
                </div>

                {/* 액션 행 */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap', padding: '13px 20px', borderTop: `1px solid ${C.borderSoft}`, background: C.bgSoft }}>
                    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, flex: 1, minWidth: 240 }}>
                        <span style={{ width: 26, height: 26, borderRadius: 8, background: tm.soft, color: tm.ink, display: 'grid', placeItems: 'center', flexShrink: 0 }}><tm.Icon size={14} /></span>
                        <div style={{ minWidth: 0 }}>
                            <span style={{ fontSize: 13, color: C.ink700, fontWeight: 500 }}>{body.msg}</span>
                            {showRevised && (
                                <ul style={{ margin: '6px 0 0', paddingLeft: 18, color: C.warnInk, fontSize: 12 }}>
                                    {revisedItems.map((it) => (
                                        <li key={it.order_no}>{it.item} <span style={{ fontFamily: 'var(--font-mono, monospace)' }}>{it.from}→{it.to}</span></li>
                                    ))}
                                </ul>
                            )}
                        </div>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
                        <button onClick={() => setHistOpen(true)}
                            style={{ background: 'white', border: `1px solid ${C.borderStrong}`, color: C.ink600, fontFamily: 'inherit', fontSize: 12, fontWeight: 600, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 6, padding: '7px 12px', borderRadius: 8, whiteSpace: 'nowrap' }}>
                            <History size={13} />검수 이력{reviewEvents.length ? ` ${reviewEvents.length}` : ''}
                        </button>
                        {body.buttons && (Array.isArray(body.buttons) ? body.buttons : [body.buttons]).map((b, i) => (
                            <span key={i} style={{ pointerEvents: isSaving ? 'none' : 'auto', opacity: isSaving ? 0.6 : 1 }}>{b}</span>
                        ))}
                    </div>
                </div>
            </div>

            {/* 사유 입력 팝업 */}
            {mode && (
                <Modal title={mode === 'reject' ? '반려 사유' : '이의제기 사유'} width={480} onClose={() => setMode(null)}>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                        <p style={{ fontSize: 12.5, color: C.ink500, margin: 0, lineHeight: 1.5 }}>
                            {mode === 'reject' ? '재검토가 필요한 사유를 선택하세요. 상담사에게 전달됩니다.' : '동의할 수 없는 사유를 선택하세요. 관리자에게 전달됩니다.'}
                        </p>
                        <select value={reasonSel} onChange={(e) => setReasonSel(e.target.value)}
                            style={{ height: 40, padding: '0 12px', borderRadius: 8, border: `1px solid ${C.borderStrong}`, background: 'white', fontSize: 13, fontFamily: 'inherit', color: C.ink900, cursor: 'pointer', width: '100%' }}>
                            <option value="">사유 선택…</option>
                            {(mode === 'reject' ? REJECT_REASONS : OBJECT_REASONS).map((r) => <option key={r} value={r}>{r}</option>)}
                        </select>
                        {reasonSel === '기타' && (
                            <textarea value={reasonEtc} onChange={(e) => setReasonEtc(e.target.value)} placeholder="사유를 직접 입력하세요" rows={3}
                                style={{ width: '100%', padding: '10px 12px', borderRadius: 8, border: `1px solid ${C.borderStrong}`, background: 'white', fontSize: 13, fontFamily: 'inherit', outline: 'none', resize: 'vertical', lineHeight: 1.5 }} />
                        )}
                        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 4 }}>
                            {wfBtn('취소', 'ghost', () => setMode(null))}
                            {wfBtn(mode === 'reject' ? '반려 제출' : '이의제기 제출', mode === 'reject' ? 'warn' : 'danger', submitReason, { disabled: !reasonText() })}
                        </div>
                    </div>
                </Modal>
            )}

            {/* 검수 이력 팝업 */}
            {histOpen && (
                <Modal title="검수 이력" width={520} onClose={() => setHistOpen(false)}>
                    <div style={{ display: 'flex', flexDirection: 'column' }}>
                        {trail.map((e, i) => {
                            const last = i === trail.length - 1;
                            return (
                                <div key={e.key} style={{ display: 'flex', gap: 12, alignItems: 'stretch' }}>
                                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', flexShrink: 0 }}>
                                        <span style={{ width: 10, height: 10, borderRadius: '50%', background: DOT[e.tone] || C.ink300, marginTop: 5 }} />
                                        {!last && <span style={{ flex: 1, width: 2, background: C.border, marginTop: 2 }} />}
                                    </div>
                                    <div style={{ flex: 1, minWidth: 0, paddingBottom: last ? 0 : 16 }}>
                                        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
                                            <span style={{ fontSize: 13, fontWeight: 700, color: C.ink900 }}>{e.label}</span>
                                            <span style={{ fontSize: 11.5, color: C.ink400 }}>{e.actor}{e.ts ? ` · ${fmtTime(e.ts)}` : ''}</span>
                                        </div>
                                        {e.reason && <div style={{ fontSize: 12.5, color: C.ink600, marginTop: 3 }}>사유: {e.reason}</div>}
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                </Modal>
            )}
        </div>
    );
}
