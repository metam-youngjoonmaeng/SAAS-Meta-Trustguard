import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
    Plus, Pencil, Trash2, Loader2, X, ShieldCheck, MoreVertical,
    Upload, ChevronDown, Search, Users as UsersIcon, Activity, UserMinus, ShieldAlert,
    KeyRound, Building2,
} from 'lucide-react';
import Header from '../components/Header';
import {
    fetchUsers, createUser, updateUser, deleteUser, resetUserPassword,
    fetchOrganizations, fetchAuditLogs,
    fetchUserMemberships, addUserMembership, removeUserMembership,
} from '../services/api';
import { getBrandConfig } from '../constants';

// 소속 브랜드(org_id)별 팀(부서) 후보 목록. constants.js BRAND_CONFIG 와 연동.
// 현재 값(legacy 자유텍스트 포함)이 목록에 없으면 유실 방지를 위해 맨 앞에 추가.
function deptOptionsFor(orgId, current) {
    const base = getBrandConfig(orgId).departments || [];
    const cur = String(current || '').trim();
    return cur && !base.includes(cur) ? [cur, ...base] : base;
}
const FLD_SELECT = 'w-full h-[40px] px-3 rounded-xl border border-[var(--border)] bg-white text-sm outline-none focus:border-[var(--primary)] disabled:bg-[var(--muted)] disabled:text-[var(--ink-500)] cursor-pointer';

// ── 색 팔레트 (원본 BrandsSection AVATAR_PALETTE 동일) ────────────
const AVATAR_PALETTE = [
    { bg: 'var(--primary-soft-flat)', fg: 'var(--primary)' },
    { bg: 'var(--success-soft)', fg: 'var(--success)' },
    { bg: 'var(--warning-soft)', fg: 'var(--warning)' },
    { bg: 'var(--destructive-soft)', fg: 'var(--destructive)' },
    { bg: '#ede9fe', fg: '#6d28d9' },
    { bg: '#cffafe', fg: '#0e7490' },
    { bg: '#fce7f3', fg: '#be185d' },
    { bg: 'var(--background)', fg: 'var(--ink-700)' },
];

function avatarPalette(name, id) {
    const seed =
        typeof id === 'number'
            ? id
            : String(name || '').split('').reduce((a, c) => a + c.charCodeAt(0), 0);
    return AVATAR_PALETTE[seed % AVATAR_PALETTE.length];
}

function Avatar({ name, id, size = 36, imageUrl }) {
    const { bg, fg } = avatarPalette(name, id);
    const initial = (name || '?').charAt(0);
    if (imageUrl) {
        return (
            <img
                src={imageUrl}
                alt={name || ''}
                style={{
                    width: size,
                    height: size,
                    borderRadius: '50%',
                    objectFit: 'cover',
                    flexShrink: 0,
                }}
            />
        );
    }
    return (
        <div
            style={{
                width: size,
                height: size,
                borderRadius: '50%',
                background: bg,
                color: fg,
                display: 'grid',
                placeItems: 'center',
                fontSize: Math.round(size * 0.42),
                fontWeight: 700,
                flexShrink: 0,
            }}
        >
            {initial}
        </div>
    );
}

// ── 시간 포맷 ────────────────────────────────────────────────
function fmtDateTime(iso) {
    if (!iso) return '—';
    return new Date(iso).toLocaleString('ko-KR', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
    });
}

function relativeTime(iso) {
    if (!iso) return null;
    const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
    if (mins < 1) return '방금 전';
    if (mins < 60) return `${mins}분 전`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}시간 전`;
    const days = Math.floor(hrs / 24);
    return days < 7 ? `${days}일 전` : fmtDateTime(iso);
}

// ── 통계 카드 ────────────────────────────────────────────────
function StatCard({ icon: Icon, tone, label, value, sub }) {
    return (
        <div className="bg-white border border-[var(--border)] rounded-2xl px-5 py-4">
            <div className="flex items-center gap-2.5 mb-2">
                <div
                    className={`w-7 h-7 rounded-full grid place-items-center ${tone}`}
                    style={{ flexShrink: 0 }}
                >
                    <Icon size={14} />
                </div>
                <span className="text-[12px] font-semibold text-[var(--ink-700)]">{label}</span>
            </div>
            <div className="text-[28px] font-bold text-[var(--ink-900)] leading-none tabular-nums">
                {Number(value || 0).toLocaleString('ko-KR')}
            </div>
            {sub && <div className="text-[11.5px] text-[var(--ink-500)] mt-2">{sub}</div>}
        </div>
    );
}

// ── 역할 칩 ──────────────────────────────────────────────────
function RoleChip({ role }) {
    if (role === 'super_admin') {
        return (
            <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-[var(--cat-policy)]">
                <ShieldCheck size={11} strokeWidth={2.5} />
                최고관리자
            </span>
        );
    }
    return (
        <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-[var(--primary)]">
            <ShieldCheck size={11} strokeWidth={2.5} />
            관리자
        </span>
    );
}

// ── 3-dot 메뉴 ──────────────────────────────────────────────
// 메뉴는 createPortal 로 body 에 렌더 — 테이블 래퍼의 overflow-hidden 에
// 잘리지 않도록 fixed 좌표로 버튼에 앵커링한다.
const ROW_MENU_WIDTH = 140;
const ROW_MENU_HEIGHT_EST = 130;

function RowMenu({ onEdit, onResetPw, onManageOrgs, onDelete, disabled }) {
    const [open, setOpen] = useState(false);
    const [coords, setCoords] = useState({ top: 0, left: 0 });
    const btnRef = useRef(null);
    const menuRef = useRef(null);

    const positionMenu = () => {
        const btn = btnRef.current;
        if (!btn) return;
        const r = btn.getBoundingClientRect();
        const spaceBelow = window.innerHeight - r.bottom;
        const openUp = spaceBelow < ROW_MENU_HEIGHT_EST + 16;
        setCoords({
            top: openUp ? r.top - ROW_MENU_HEIGHT_EST - 4 : r.bottom + 4,
            left: Math.max(8, r.right - ROW_MENU_WIDTH),
        });
    };

    useEffect(() => {
        if (!open) return;
        positionMenu();
        const onClickOutside = (e) => {
            const t = e.target;
            if (btnRef.current?.contains(t) || menuRef.current?.contains(t)) return;
            setOpen(false);
        };
        const onKey = (e) => {
            if (e.key === 'Escape') setOpen(false);
        };
        const onReposition = () => positionMenu();
        document.addEventListener('mousedown', onClickOutside);
        document.addEventListener('keydown', onKey);
        window.addEventListener('resize', onReposition);
        window.addEventListener('scroll', onReposition, true);
        return () => {
            document.removeEventListener('mousedown', onClickOutside);
            document.removeEventListener('keydown', onKey);
            window.removeEventListener('resize', onReposition);
            window.removeEventListener('scroll', onReposition, true);
        };
    }, [open]);

    if (disabled) {
        return (
            <button
                type="button"
                disabled
                className="w-7 h-7 grid place-items-center rounded-md text-[var(--ink-300)] cursor-not-allowed"
            >
                <MoreVertical size={14} />
            </button>
        );
    }

    return (
        <>
            <button
                ref={btnRef}
                type="button"
                onClick={() => setOpen((v) => !v)}
                className="w-7 h-7 grid place-items-center rounded-md text-[var(--ink-500)] hover:bg-[var(--muted)] cursor-pointer"
            >
                <MoreVertical size={14} />
            </button>
            {open && createPortal(
                <div
                    ref={menuRef}
                    className="fixed z-[120] w-[140px] bg-white border border-[var(--border)] rounded-lg shadow-lg py-1"
                    style={{
                        top: coords.top,
                        left: coords.left,
                        boxShadow: '0 12px 32px rgba(15,23,42,0.12)',
                    }}
                >
                    <button
                        onClick={() => {
                            setOpen(false);
                            onEdit();
                        }}
                        className="w-full flex items-center gap-2 px-3 py-2 text-[12.5px] text-[var(--ink-900)] hover:bg-[var(--background-soft)] cursor-pointer"
                    >
                        <Pencil size={12} /> 편집
                    </button>
                    <button
                        onClick={() => {
                            setOpen(false);
                            onResetPw();
                        }}
                        className="w-full flex items-center gap-2 px-3 py-2 text-[12.5px] text-[var(--ink-900)] hover:bg-[var(--background-soft)] cursor-pointer"
                    >
                        <KeyRound size={12} /> 비번 재설정
                    </button>
                    {onManageOrgs && (
                        <button
                            onClick={() => {
                                setOpen(false);
                                onManageOrgs();
                            }}
                            className="w-full flex items-center gap-2 px-3 py-2 text-[12.5px] text-[var(--ink-900)] hover:bg-[var(--background-soft)] cursor-pointer"
                        >
                            <Building2 size={12} /> 소속 관리
                        </button>
                    )}
                    <div className="my-1 border-t border-[var(--border)]" />
                    <button
                        onClick={() => {
                            setOpen(false);
                            onDelete();
                        }}
                        className="w-full flex items-center gap-2 px-3 py-2 text-[12.5px] text-[var(--destructive)] hover:bg-[var(--destructive-soft)] cursor-pointer"
                    >
                        <Trash2 size={12} /> 삭제
                    </button>
                </div>,
                document.body
            )}
        </>
    );
}

// ── 사용자 모달 (생성/편집) ─────────────────────────────────
// 비밀번호 입력 필드는 의도적으로 제거됨 — 신규 계정은 서버가 초기 비밀번호를 자동 부여하고
// 본인이 ProfileModal 에서 직접 변경한다.
// "비번 재설정"은 별도 confirm 흐름(handleResetPw)에서 처리.
// 라벨 + 입력 래퍼 (2열 그리드 셀)
function Fld({ label, required, children }) {
    return (
        <div>
            <label className="block text-[11.5px] font-semibold text-[var(--ink-500)] mb-1.5 uppercase tracking-wide">
                {label} {required && <span className="text-[var(--destructive)]">*</span>}
            </label>
            {children}
        </div>
    );
}
const FLD_INPUT = 'w-full h-[40px] px-3 rounded-xl border border-[var(--border)] bg-white text-sm outline-none focus:border-[var(--primary)] disabled:bg-[var(--muted)] disabled:text-[var(--ink-500)]';

function UserModal({ initial, brands, isSuperAdmin, onSave, onClose, saving }) {
    const isEdit = Boolean(initial.user_id);
    const [draft, setDraft] = useState({
        login_id: initial.login_id || '',
        display_name: initial.display_name || '',
        email: initial.email || '',
        role: initial.role || 'admin',
        org_id: initial.org_id ?? (brands[0]?.id ?? null),
        department: initial.department || '',
        is_active: initial.is_active !== 0 && initial.is_active !== false,
        hire_date: initial.hire_date || '',
        leave_date: initial.leave_date || '',
        extension: initial.extension || '',
        dup_login_yn: initial.dup_login_yn === 'Y' ? 'Y' : 'N',
    });
    const set = (k, v) => setDraft((d) => ({ ...d, [k]: v }));
    const ROLES = [
        { key: 'super_admin', label: '슈퍼관리자', on: 'bg-[var(--cat-policy-soft)] border-[var(--cat-policy)] text-[var(--cat-policy)]' },
        { key: 'admin', label: '관리자', on: 'bg-[var(--primary-soft)] border-[var(--primary)] text-[var(--primary)]' },
        { key: 'agent', label: '상담사', on: 'bg-[var(--cat-service-soft)] border-[var(--cat-service)] text-[var(--cat-service)]' },
    ];

    return createPortal(
        <div
            className="fixed inset-0 z-[1000] flex items-center justify-center px-4"
            style={{ background: 'rgba(15,23,42,0.4)' }}
            onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
        >
            <div className="w-full max-w-2xl bg-white rounded-2xl shadow-xl overflow-hidden max-h-[92vh] flex flex-col">
                <div className="px-6 pt-5 pb-3 flex items-center justify-between border-b border-[var(--border)] shrink-0">
                    <h3 className="text-base font-bold text-[var(--ink-900)]">{isEdit ? '사용자 정보' : '새 사용자'}</h3>
                    <button onClick={onClose} className="w-7 h-7 grid place-items-center rounded-md text-[var(--ink-500)] hover:bg-[var(--muted)] cursor-pointer">
                        <X size={14} />
                    </button>
                </div>

                <div className="px-6 py-5 overflow-y-auto">
                    <div className="grid grid-cols-2 gap-x-5 gap-y-4">
                        <Fld label="이름" required>
                            <input type="text" value={draft.display_name} onChange={(e) => set('display_name', e.target.value)} className={FLD_INPUT} />
                        </Fld>
                        <Fld label="사용자 ID" required>
                            <input type="text" value={draft.login_id} onChange={(e) => set('login_id', e.target.value)} disabled={isEdit} className={FLD_INPUT} />
                        </Fld>

                        {isEdit && (
                            <Fld label="이메일">
                                <input type="text" value={draft.email} disabled className={FLD_INPUT} />
                            </Fld>
                        )}
                        <Fld label="팀(부서)">
                            <select value={draft.department || ''} onChange={(e) => set('department', e.target.value)} className={FLD_SELECT}>
                                <option value="">미지정</option>
                                {deptOptionsFor(draft.org_id, draft.department).map((d) => (
                                    <option key={d} value={d}>{d}</option>
                                ))}
                            </select>
                        </Fld>

                        <Fld label="사용자 권한" required>
                            <div className="flex gap-1.5">
                                {ROLES.map((r) => (
                                    <button key={r.key} type="button" onClick={() => set('role', r.key)}
                                        className={`flex-1 h-[40px] rounded-xl border text-[12.5px] font-semibold cursor-pointer ${draft.role === r.key ? r.on : 'bg-white border-[var(--border)] text-[var(--ink-500)] hover:bg-[var(--muted)]'}`}>
                                        {r.label}
                                    </button>
                                ))}
                            </div>
                        </Fld>
                        <Fld label="계정상태" required>
                            <div className="flex gap-2">
                                {[true, false].map((v) => (
                                    <button key={String(v)} type="button" onClick={() => set('is_active', v)}
                                        className={`flex-1 h-[40px] rounded-xl border text-[13px] font-semibold cursor-pointer ${draft.is_active === v ? (v ? 'bg-[var(--success-soft)] border-[var(--success)] text-[var(--success)]' : 'bg-[var(--warning-soft)] border-[var(--warning)] text-[var(--warning)]') : 'bg-white border-[var(--border)] text-[var(--ink-500)] hover:bg-[var(--muted)]'}`}>
                                        {v ? '활성' : '비활성'}
                                    </button>
                                ))}
                            </div>
                        </Fld>

                        {isEdit && (
                            <>
                                <Fld label="입사일자" required>
                                    <input type="date" value={draft.hire_date || ''} onChange={(e) => set('hire_date', e.target.value)} className={FLD_INPUT} />
                                </Fld>
                                <Fld label="퇴사일자">
                                    <input type="date" value={draft.leave_date || ''} onChange={(e) => set('leave_date', e.target.value)} className={FLD_INPUT} />
                                </Fld>

                                <Fld label="내선번호">
                                    <input type="text" value={draft.extension || ''} onChange={(e) => set('extension', e.target.value)} placeholder="예) 5012" className={FLD_INPUT} />
                                </Fld>
                                <Fld label="중복로그인여부" required>
                                    <div className="flex gap-2">
                                        {['Y', 'N'].map((v) => (
                                            <button key={v} type="button" onClick={() => set('dup_login_yn', v)}
                                                className={`flex-1 h-[40px] rounded-xl border text-[13px] font-semibold cursor-pointer ${draft.dup_login_yn === v ? (v === 'Y' ? 'bg-[var(--primary-soft)] border-[var(--primary)] text-[var(--primary)]' : 'bg-[var(--muted)] border-[var(--border-strong)] text-[var(--ink-700)]') : 'bg-white border-[var(--border)] text-[var(--ink-500)] hover:bg-[var(--muted)]'}`}>
                                                {v === 'Y' ? '허용 (Y)' : '불가 (N)'}
                                            </button>
                                        ))}
                                    </div>
                                </Fld>
                            </>
                        )}

                        <div className="col-span-2">
                            <Fld label="소속 브랜드">
                                <select value={draft.org_id ?? ''} onChange={(e) => {
                                        const nextOrg = e.target.value === '' ? null : Number(e.target.value);
                                        setDraft((d) => {
                                            const opts = getBrandConfig(nextOrg).departments || [];
                                            // 브랜드 변경 시, 새 브랜드에 없는 부서는 비움(타 브랜드 부서 유입 방지).
                                            return { ...d, org_id: nextOrg, department: opts.includes(d.department) ? d.department : '' };
                                        });
                                    }}
                                    disabled={!isSuperAdmin} className={FLD_INPUT}>
                                    <option value="">미지정</option>
                                    {brands.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                                </select>
                            </Fld>
                        </div>
                    </div>

                    {!isEdit && (
                        <div className="mt-4 rounded-xl bg-[var(--primary-soft-flat)] border border-[var(--primary-soft-border)] px-3.5 py-2.5 text-[12px] text-[var(--primary)] leading-relaxed">
                            <strong className="font-bold">초기 비밀번호가 자동 발급됩니다.</strong>{' '}
                            계정 생성 직후 안내되며, 사용자가 첫 로그인 시 본인이 직접 변경하도록 강제됩니다.
                            (입사일·내선 등 인사정보는 생성 후 편집에서 입력)
                        </div>
                    )}
                </div>

                <div className="px-6 pb-5 pt-3 flex gap-2 justify-end border-t border-[var(--muted)] shrink-0">
                    <button type="button" onClick={onClose} className="h-[38px] px-5 rounded-xl border border-[var(--border)] bg-white text-[13px] font-semibold text-[var(--ink-900)] hover:bg-[var(--muted)] cursor-pointer">취소</button>
                    <button type="button" onClick={() => onSave(draft)}
                        disabled={!draft.login_id.trim() || !draft.display_name.trim() || saving}
                        className="h-[38px] px-5 rounded-xl bg-[var(--primary)] text-white text-[13px] font-semibold hover:bg-[var(--primary)] shadow-sm disabled:opacity-50 cursor-pointer">
                        {saving ? <Loader2 size={14} className="animate-spin inline" /> : '저장'}
                    </button>
                </div>
            </div>
        </div>,
        document.body
    );
}

// ── 일괄 수정 모달 ───────────────────────────────────────────
// 선택한 N명에 대해 역할/부서/소속 브랜드/상태를 한 번에 변경.
// 각 필드는 "변경 안 함" 상태가 기본. 활성화한 필드만 PATCH 페이로드에 포함됨.
// 본인 사용자가 선택에 포함되어 있고 역할/상태를 바꾸려는 경우, 자기 자신은 자동 제외하고 경고 노출
// (자가 비활성화/권한 박탈로 인한 락아웃 방지).
function BulkEditModal({ targets, currentUserId, brands, onSave, onClose, saving }) {
    const [enable, setEnable] = useState({ role: false, department: false, org_id: false, is_active: false });
    const [draft, setDraft] = useState({
        role: 'admin',
        department: '',
        org_id: brands[0]?.id ?? null,
        is_active: true,
    });
    const set = (k, v) => setDraft((d) => ({ ...d, [k]: v }));
    const toggle = (k) => setEnable((e) => ({ ...e, [k]: !e[k] }));

    const selfIncluded = targets.some((u) => u.user_id === currentUserId);
    const affectsSelfRiskyFields = enable.role || enable.is_active;
    const willExcludeSelf = selfIncluded && affectsSelfRiskyFields;
    const effectiveCount = willExcludeSelf ? targets.length - 1 : targets.length;
    const anyEnabled = enable.role || enable.department || enable.org_id || enable.is_active;

    return (
        <div
            className="fixed inset-0 z-[100] flex items-center justify-center px-4"
            style={{ background: 'rgba(15,23,42,0.4)' }}
            onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
        >
            <div className="w-full max-w-md bg-white rounded-2xl shadow-xl overflow-hidden">
                <div className="px-6 pt-5 pb-3 flex items-center justify-between border-b border-[var(--border)]">
                    <h3 className="text-base font-bold text-[var(--ink-900)]">
                        선택한 사용자 일괄 수정
                    </h3>
                    <button
                        onClick={onClose}
                        className="w-7 h-7 grid place-items-center rounded-md text-[var(--ink-500)] hover:bg-[var(--muted)] cursor-pointer"
                    >
                        <X size={14} />
                    </button>
                </div>

                <div className="px-6 py-5 space-y-4">
                    <div className="rounded-xl bg-[var(--primary-soft-flat)] border border-[var(--primary-soft-border)] px-3.5 py-2.5 text-[12px] text-[var(--primary)] leading-relaxed">
                        <strong className="font-bold">{targets.length}명</strong>을 한 번에 수정합니다.
                        변경할 항목만 체크하세요 — 체크하지 않은 항목은 기존 값이 유지됩니다.
                    </div>

                    <BulkField
                        enabled={enable.role}
                        onToggle={() => toggle('role')}
                        label="역할"
                    >
                        <div className="flex gap-2">
                            {['admin', 'super_admin'].map((r) => (
                                <button
                                    key={r}
                                    type="button"
                                    disabled={!enable.role}
                                    onClick={() => set('role', r)}
                                    className={`flex-1 h-[38px] rounded-xl border text-[13px] font-semibold cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed ${
                                        draft.role === r
                                            ? r === 'super_admin'
                                                ? 'bg-[var(--cat-policy-soft)] border-[var(--cat-policy)] text-[var(--cat-policy)]'
                                                : 'bg-[var(--primary-soft)] border-[var(--primary)] text-[var(--primary)]'
                                            : 'bg-white border-[var(--border)] text-[var(--ink-500)] hover:bg-[var(--muted)]'
                                    }`}
                                >
                                    {r === 'super_admin' ? '최고관리자' : '관리자'}
                                </button>
                            ))}
                        </div>
                    </BulkField>

                    <BulkField
                        enabled={enable.department}
                        onToggle={() => toggle('department')}
                        label="부서"
                    >
                        <select
                            value={draft.department || ''}
                            disabled={!enable.department}
                            onChange={(e) => set('department', e.target.value)}
                            className="w-full h-[40px] px-3 rounded-xl border border-[var(--border)] bg-white text-sm outline-none focus:border-[var(--primary)] disabled:bg-[var(--muted)] disabled:text-[var(--ink-400)] cursor-pointer disabled:cursor-not-allowed"
                        >
                            <option value="">미지정</option>
                            {deptOptionsFor(draft.org_id, draft.department).map((d) => (
                                <option key={d} value={d}>{d}</option>
                            ))}
                        </select>
                    </BulkField>

                    <BulkField
                        enabled={enable.org_id}
                        onToggle={() => toggle('org_id')}
                        label="소속 브랜드"
                    >
                        <select
                            value={draft.org_id ?? ''}
                            disabled={!enable.org_id}
                            onChange={(e) => {
                                const nextOrg = e.target.value === '' ? null : Number(e.target.value);
                                setDraft((d) => {
                                    const opts = getBrandConfig(nextOrg).departments || [];
                                    return { ...d, org_id: nextOrg, department: opts.includes(d.department) ? d.department : '' };
                                });
                            }}
                            className="w-full h-[40px] px-3 rounded-xl border border-[var(--border)] bg-white text-sm outline-none focus:border-[var(--primary)] disabled:bg-[var(--muted)]"
                        >
                            <option value="">미지정</option>
                            {brands.map((b) => (
                                <option key={b.id} value={b.id}>
                                    {b.name}
                                </option>
                            ))}
                        </select>
                    </BulkField>

                    <BulkField
                        enabled={enable.is_active}
                        onToggle={() => toggle('is_active')}
                        label="상태"
                    >
                        <div className="flex gap-2">
                            {[true, false].map((v) => (
                                <button
                                    key={String(v)}
                                    type="button"
                                    disabled={!enable.is_active}
                                    onClick={() => set('is_active', v)}
                                    className={`flex-1 h-[38px] rounded-xl border text-[13px] font-semibold cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed ${
                                        draft.is_active === v
                                            ? v
                                                ? 'bg-[var(--success-soft)] border-[var(--success)] text-[var(--success)]'
                                                : 'bg-[var(--warning-soft)] border-[var(--warning)] text-[var(--warning)]'
                                            : 'bg-white border-[var(--border)] text-[var(--ink-500)] hover:bg-[var(--muted)]'
                                    }`}
                                >
                                    {v ? '활성' : '비활성'}
                                </button>
                            ))}
                        </div>
                    </BulkField>

                    {willExcludeSelf && (
                        <div className="rounded-xl bg-[var(--warning-soft)] border border-[var(--warning)] px-3.5 py-2.5 text-[12px] text-[var(--warning)] leading-relaxed">
                            <strong className="font-bold">본인 계정은 제외됩니다.</strong>{' '}
                            역할/상태 일괄 변경에서 본인을 변경하면 락아웃 위험이 있어 자동으로 빠집니다.
                            본인 계정을 변경하려면 사용자 편집을 사용하세요.
                        </div>
                    )}
                </div>

                <div className="px-6 pb-5 flex gap-2 justify-end items-center">
                    {anyEnabled && (
                        <span className="mr-auto text-[12px] text-[var(--ink-500)]">
                            대상 <strong className="text-[var(--ink-900)] font-bold">{effectiveCount}명</strong>
                        </span>
                    )}
                    <button
                        type="button"
                        onClick={onClose}
                        className="h-[38px] px-5 rounded-xl border border-[var(--border)] bg-white text-[13px] font-semibold text-[var(--ink-900)] hover:bg-[var(--muted)] cursor-pointer"
                    >
                        취소
                    </button>
                    <button
                        type="button"
                        onClick={() => onSave({ enable, draft })}
                        disabled={!anyEnabled || effectiveCount === 0 || saving}
                        className="h-[38px] px-5 rounded-xl bg-[var(--primary)] text-white text-[13px] font-semibold hover:bg-[var(--primary)] shadow-sm disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
                    >
                        {saving ? <Loader2 size={14} className="animate-spin inline" /> : '적용'}
                    </button>
                </div>
            </div>
        </div>
    );
}

function BulkField({ enabled, onToggle, label, children }) {
    return (
        <div>
            <label className="flex items-center gap-2 mb-1.5 cursor-pointer select-none">
                <input
                    type="checkbox"
                    checked={enabled}
                    onChange={onToggle}
                    className="cursor-pointer"
                />
                <span className={`text-[11.5px] font-semibold uppercase tracking-wide ${enabled ? 'text-[var(--primary)]' : 'text-[var(--ink-500)]'}`}>
                    {label}
                </span>
                {!enabled && <span className="text-[11px] text-[var(--ink-500)] font-normal normal-case tracking-normal">변경 안 함</span>}
            </label>
            <div className={enabled ? '' : 'opacity-60'}>
                {children}
            </div>
        </div>
    );
}

// 초기 비밀번호 발급/재설정 안내 모달.
// 사용자 추가 직후 / "비번 재설정" 직후에 사용자에게 알려줄 초기 비밀번호를 노출.
function InitialPasswordModal({ user, initialPassword, onClose, mode }) {
    const [copied, setCopied] = useState(false);
    const copy = async () => {
        try {
            await navigator.clipboard.writeText(initialPassword);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
        } catch { /* ignore */ }
    };
    return (
        <div
            className="fixed inset-0 z-[110] flex items-center justify-center px-4"
            style={{ background: 'rgba(15,23,42,0.5)' }}
            onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
        >
            <div className="w-full max-w-sm bg-white rounded-2xl shadow-xl overflow-hidden">
                <div className="px-6 pt-5 pb-3 border-b border-[var(--border)]">
                    <h3 className="text-base font-bold text-[var(--ink-900)]">
                        {mode === 'reset' ? '비밀번호 재설정 완료' : '초기 비밀번호 발급'}
                    </h3>
                </div>
                <div className="px-6 py-5 space-y-3">
                    <p className="text-[13px] text-[var(--ink-700)] leading-relaxed">
                        <strong className="text-[var(--ink-900)]">{user?.display_name || user?.login_id}</strong> 님의
                        {mode === 'reset' ? ' 비밀번호가 초기화되었습니다.' : ' 계정이 생성되었습니다.'}
                        <br />사용자에게 아래 초기 비밀번호를 안전한 경로로 안내해 주세요.
                    </p>
                    <div className="flex items-center gap-2 p-3 rounded-xl bg-[var(--background-soft)] border border-[var(--border)]">
                        <code className="flex-1 font-mono text-[14px] font-bold text-[var(--ink-900)] tracking-wide">
                            {initialPassword}
                        </code>
                        <button
                            type="button"
                            onClick={copy}
                            className="h-[30px] px-3 rounded-lg border border-[var(--border)] bg-white text-[12px] font-semibold text-[var(--ink-700)] hover:bg-[var(--muted)] cursor-pointer"
                        >
                            {copied ? '복사됨' : '복사'}
                        </button>
                    </div>
                    <p className="text-[11.5px] text-[var(--ink-500)]">
                        사용자는 첫 로그인 시 새 비밀번호로 변경해야 합니다.
                    </p>
                </div>
                <div className="px-6 pb-5 flex justify-end">
                    <button
                        type="button"
                        onClick={onClose}
                        className="h-[36px] px-5 rounded-xl bg-[var(--primary)] text-white text-[13px] font-semibold hover:bg-[var(--primary)] cursor-pointer"
                    >
                        확인
                    </button>
                </div>
            </div>
        </div>
    );
}

// ── 로그인 이력 탭 ──────────────────────────────────────────
// ── 소속(다중 멤버십) 관리 모달 ─────────────────────────────
// 기존 유저를 여러 조직에 소속시킨다(= 내비 조직 전환의 대상 생성). super_admin 전용.
const ROLE_LABEL_M = { agent: '상담사', admin: '관리자', super_admin: '슈퍼관리자' };
function MembershipsModal({ user, brands, onClose, onChanged }) {
    const [rows, setRows] = useState(null);   // null=로딩
    const [busy, setBusy] = useState(false);
    const [err, setErr] = useState('');
    const [orgId, setOrgId] = useState('');
    const [role, setRole] = useState('agent');
    const [dept, setDept] = useState('');

    const load = () => {
        fetchUserMemberships(user.user_id)
            .then((d) => setRows(Array.isArray(d) ? d : []))
            .catch(() => { setRows([]); setErr('멤버십 목록을 불러오지 못했습니다.'); });
    };
    useEffect(load, [user.user_id]);

    const memberOrgIds = new Set((rows || []).map((r) => r.org_id));
    const availBrands = (brands || []).filter((b) => !memberOrgIds.has(b.id));

    const add = async () => {
        if (!orgId || busy) return;
        setBusy(true); setErr('');
        try {
            await addUserMembership(user.user_id, { org_id: Number(orgId), role, department: dept || null });
            setOrgId(''); setDept(''); setRole('agent');
            load(); onChanged && onChanged();
        } catch (e) { setErr(e?.message || '소속 추가에 실패했습니다.'); }
        finally { setBusy(false); }
    };
    const remove = async (tid) => {
        if (busy || !window.confirm('이 소속을 제거할까요?')) return;
        setBusy(true); setErr('');
        try { await removeUserMembership(user.user_id, tid); load(); onChanged && onChanged(); }
        catch (e) { setErr(e?.message || '소속 제거에 실패했습니다.'); }
        finally { setBusy(false); }
    };

    return createPortal(
        <div className="fixed inset-0 z-[130] flex items-center justify-center p-4" onClick={onClose}>
            <div className="absolute inset-0 bg-black/30" />
            <div className="relative bg-white rounded-2xl shadow-2xl w-[520px] max-w-[94vw] max-h-[88vh] flex flex-col overflow-hidden" onClick={(e) => e.stopPropagation()}>
                <div className="flex items-center gap-2 px-5 py-4 border-b border-[var(--border)]">
                    <Building2 size={16} className="text-[var(--primary)]" />
                    <h3 className="text-base font-bold text-[var(--ink-900)] truncate">소속 관리 · {user.display_name || user.login_id}</h3>
                    <button type="button" onClick={onClose} className="ml-auto p-1 text-[var(--ink-400)] hover:text-[var(--ink-700)]"><X size={18} /></button>
                </div>
                <div className="flex-1 overflow-y-auto p-5 space-y-4">
                    {err && <div className="text-[13px] text-[var(--destructive)]">{err}</div>}
                    <div className="space-y-2">
                        {rows === null && <div className="text-[13px] text-[var(--ink-400)]">불러오는 중…</div>}
                        {rows && rows.length === 0 && <div className="text-[13px] text-[var(--ink-400)]">소속이 없습니다.</div>}
                        {rows && rows.map((r) => (
                            <div key={r.trainee_id} className="flex items-center gap-3 px-3 py-2.5 rounded-xl border border-[var(--border)]">
                                <Building2 size={15} className="text-[var(--ink-500)] shrink-0" />
                                <div className="flex-1 min-w-0">
                                    <div className="text-[13px] font-semibold text-[var(--ink-900)] truncate">
                                        {r.org_name || `조직 ${r.org_id}`}
                                        {r.is_active_membership && <span className="ml-2 text-[10px] font-bold text-[var(--violet)]">현재 활성</span>}
                                    </div>
                                    <div className="text-[11px] text-[var(--ink-500)]">
                                        {ROLE_LABEL_M[r.role] || r.role}{r.department ? ` · ${r.department}` : ''}{r.status !== 'active' ? ` · ${r.status}` : ''}
                                    </div>
                                </div>
                                <button
                                    type="button"
                                    onClick={() => remove(r.trainee_id)}
                                    disabled={busy || (rows && rows.length <= 1)}
                                    title={rows && rows.length <= 1 ? '마지막 소속은 제거할 수 없습니다(계정 삭제를 사용하세요)' : '소속 제거'}
                                    className="p-1.5 rounded-md text-[var(--ink-400)] hover:text-[var(--destructive)] hover:bg-[var(--destructive-soft)] disabled:opacity-40 disabled:cursor-not-allowed shrink-0"
                                >
                                    <Trash2 size={14} />
                                </button>
                            </div>
                        ))}
                    </div>
                    <div className="border-t border-[var(--border)] pt-4">
                        <div className="text-[11px] font-bold uppercase tracking-wide text-[var(--ink-400)] mb-2">새 소속 추가</div>
                        {availBrands.length === 0 ? (
                            <div className="text-[13px] text-[var(--ink-400)]">추가할 수 있는 조직이 없습니다(모든 조직에 소속됨).</div>
                        ) : (
                            <>
                                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                                    <select value={orgId} onChange={(e) => { setOrgId(e.target.value); setDept(''); }} className={FLD_INPUT}>
                                        <option value="">조직 선택</option>
                                        {availBrands.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                                    </select>
                                    <select value={role} onChange={(e) => setRole(e.target.value)} className={FLD_INPUT}>
                                        <option value="agent">상담사</option>
                                        <option value="admin">관리자</option>
                                        <option value="super_admin">슈퍼관리자</option>
                                    </select>
                                    <select value={dept} onChange={(e) => setDept(e.target.value)} disabled={!orgId} className={FLD_INPUT}>
                                        <option value="">부서(선택)</option>
                                        {deptOptionsFor(Number(orgId), dept).map((d) => <option key={d} value={d}>{d}</option>)}
                                    </select>
                                </div>
                                <button type="button" onClick={add} disabled={busy || !orgId} className="mt-3 inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-[var(--primary)] text-white text-[13px] font-semibold hover:opacity-90 disabled:opacity-50">
                                    {busy ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}소속 추가
                                </button>
                            </>
                        )}
                    </div>
                </div>
                <div className="flex items-center px-5 py-4 border-t border-[var(--border)]">
                    <button type="button" onClick={onClose} className="ml-auto px-3.5 py-2 rounded-lg border border-[var(--border)] text-[13px] font-semibold text-[var(--ink-700)] hover:bg-[var(--background-soft)]">닫기</button>
                </div>
            </div>
        </div>,
        document.body
    );
}

function LoginHistoryTab() {
    const [rows, setRows] = useState([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        (async () => {
            try {
                const data = await fetchAuditLogs({ limit: 200, action: 'AUTH_LOGIN_SUCCESS' });
                setRows(data);
            } finally {
                setLoading(false);
            }
        })();
    }, []);

    if (loading) {
        return (
            <div className="flex justify-center py-12">
                <Loader2 className="h-5 w-5 animate-spin text-[var(--ink-500)]" />
            </div>
        );
    }

    return (
        <div className="bg-white border border-[var(--border)] rounded-xl overflow-hidden">
            <table className="w-full text-sm">
                <thead>
                    <tr className="border-b border-[var(--border)] bg-[var(--background-soft)]">
                        <th className="px-4 py-3 text-left text-[11.5px] font-semibold text-[var(--ink-500)] uppercase tracking-wider">로그인 시각</th>
                        <th className="px-4 py-3 text-left text-[11.5px] font-semibold text-[var(--ink-500)] uppercase tracking-wider">사용자</th>
                        <th className="px-4 py-3 text-left text-[11.5px] font-semibold text-[var(--ink-500)] uppercase tracking-wider">역할</th>
                        <th className="px-4 py-3 text-left text-[11.5px] font-semibold text-[var(--ink-500)] uppercase tracking-wider">IP</th>
                    </tr>
                </thead>
                <tbody className="divide-y divide-[var(--border)]">
                    {rows.length === 0 && (
                        <tr>
                            <td colSpan={4} className="px-4 py-10 text-center text-sm text-[var(--ink-500)]">로그인 이력이 없습니다</td>
                        </tr>
                    )}
                    {rows.map((r) => (
                        <tr key={r.audit_id} className="hover:bg-[var(--background-soft)]">
                            <td className="px-4 py-3 text-[12.5px] text-[var(--ink-900)] tabular-nums">{fmtDateTime(r.created_at)}</td>
                            <td className="px-4 py-3">
                                <div className="flex items-center gap-2.5">
                                    <Avatar name={r.display_name || r.login_id} id={r.user_id} size={28} />
                                    <div>
                                        <div className="text-[13px] font-semibold text-[var(--ink-900)]">{r.display_name || '—'}</div>
                                        <div className="text-[11.5px] text-[var(--ink-500)] font-mono">{r.login_id}</div>
                                    </div>
                                </div>
                            </td>
                            <td className="px-4 py-3"><RoleChip role={r.role} /></td>
                            <td className="px-4 py-3 text-[11.5px] text-[var(--ink-400)] tabular-nums">{r.client_ip || '—'}</td>
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    );
}

// ── 메인 ─────────────────────────────────────────────────────
const Users = ({ role, currentUserId, activeBrandId }) => {
    const isSuperAdmin = role === 'super_admin';
    const [items, setItems] = useState([]);
    const [brands, setBrands] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [tab, setTab] = useState('users'); // 'users' | 'history'
    const [search, setSearch] = useState('');
    const [statusFilter, setStatusFilter] = useState('all'); // all | active | inactive
    const [roleFilter, setRoleFilter] = useState('all'); // all | admin | super_admin
    const [sortBy, setSortBy] = useState('last_login'); // last_login | name | created
    const [modalState, setModalState] = useState({ open: false, target: null });
    const [orgModal, setOrgModal] = useState({ open: false, user: null });
    const [saving, setSaving] = useState(false);
    const [selected, setSelected] = useState(new Set());
    const [bulkOpen, setBulkOpen] = useState(false);
    const [bulkSaving, setBulkSaving] = useState(false);
    // 초기 비밀번호 안내 모달 — 사용자 생성/비번 재설정 직후 super_admin 에게 노출.
    const [initialPwInfo, setInitialPwInfo] = useState(null); // { user, initial_password, mode: 'create'|'reset' }

    async function load() {
        setLoading(true);
        try {
            // super_admin 은 활성 브랜드 컨텍스트에 맞춰 사용자 목록을 다시 받음.
            // admin 은 서버에서 자기 org_id 로 강제 필터되므로 brand_id 인자 무시됨.
            const [usersData, brandsData] = await Promise.all([
                fetchUsers(isSuperAdmin ? activeBrandId : undefined),
                fetchOrganizations(),
            ]);
            setItems(usersData);
            setBrands(brandsData);
            setError(null);
        } catch (e) {
            setError(e?.message || '로드 실패');
        } finally {
            setLoading(false);
        }
    }

    useEffect(() => {
        load();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [activeBrandId, isSuperAdmin]);

    async function handleSave(draft) {
        setSaving(true);
        try {
            if (modalState.target) {
                const body = {
                    display_name: draft.display_name,
                    role: draft.role,
                    is_active: draft.is_active,
                    org_id: draft.org_id,
                    department: draft.department.trim() || null,
                    hire_date: draft.hire_date ? String(draft.hire_date).trim() : null,
                    leave_date: draft.leave_date ? String(draft.leave_date).trim() : null,
                    extension: draft.extension ? String(draft.extension).trim() : null,
                    dup_login_yn: draft.dup_login_yn === 'Y' ? 'Y' : 'N',
                };
                const updated = await updateUser(modalState.target.user_id, body);
                setItems((prev) =>
                    prev.map((u) => (u.user_id === modalState.target.user_id ? { ...u, ...updated } : u)),
                );
                setModalState({ open: false, target: null });
            } else {
                const created = await createUser({
                    login_id: draft.login_id.trim(),
                    display_name: draft.display_name.trim(),
                    role: draft.role,
                    org_id: draft.org_id,
                    department: draft.department.trim() || null,
                });
                await load();
                setModalState({ open: false, target: null });
                if (created?.initial_password) {
                    setInitialPwInfo({ user: created, initial_password: created.initial_password, mode: 'create' });
                }
            }
        } catch (e) {
            setError(e?.message || '저장 실패');
        } finally {
            setSaving(false);
        }
    }

    async function handleResetPw(u) {
        const ok = window.confirm(
            `"${u.display_name}" (${u.login_id}) 의 비밀번호를 초기 비밀번호로 재설정합니다.\n` +
            `사용자는 다음 로그인 시 새 비밀번호로 변경해야 합니다. 계속하시겠습니까?`
        );
        if (!ok) return;
        try {
            const resp = await resetUserPassword(u.user_id);
            if (resp?.initial_password) {
                setInitialPwInfo({ user: resp.user || u, initial_password: resp.initial_password, mode: 'reset' });
            }
            // 재설정 결과 반영을 위해 목록 재조회.
            await load();
        } catch (e) {
            setError(e?.message || '비밀번호 재설정 실패');
        }
    }

    async function handleDelete(u) {
        if (!confirm(`"${u.display_name}" (${u.login_id}) 계정을 삭제하시겠습니까?\n이 작업은 되돌릴 수 없습니다.`)) return;
        try {
            await deleteUser(u.user_id);
            setItems((prev) => prev.filter((x) => x.user_id !== u.user_id));
        } catch (e) {
            setError(e?.message || '삭제 실패');
        }
    }

    async function handleBulkSave({ enable, draft }) {
        // 변경할 필드만 페이로드에 포함. 본인 락아웃 방지를 위해 역할/상태 변경 시 본인 제외.
        const body = {};
        if (enable.role) body.role = draft.role;
        if (enable.department) body.department = draft.department.trim() || null;
        if (enable.org_id) body.org_id = draft.org_id;
        if (enable.is_active) body.is_active = !!draft.is_active;
        if (Object.keys(body).length === 0) return;

        // 대상은 현재 필터에 보이는 선택 항목으로 한정 — 필터에 가려진 사용자가 의도치 않게 수정되지 않도록.
        const excludeSelf = enable.role || enable.is_active;
        const idsAll = visibleSelectedIds;
        const ids = excludeSelf ? idsAll.filter((id) => id !== currentUserId) : idsAll;
        if (ids.length === 0) {
            setError('수정 대상이 없습니다');
            return;
        }

        setBulkSaving(true);
        try {
            const results = await Promise.allSettled(ids.map((id) => updateUser(id, body)));
            const okUpdates = new Map();
            const failures = [];
            results.forEach((r, i) => {
                if (r.status === 'fulfilled') okUpdates.set(ids[i], r.value);
                else failures.push({ id: ids[i], msg: r.reason?.message || '실패' });
            });
            if (okUpdates.size > 0) {
                setItems((prev) =>
                    prev.map((u) => (okUpdates.has(u.user_id) ? { ...u, ...okUpdates.get(u.user_id) } : u)),
                );
                // 성공한 사용자는 선택에서 제거 — 실패분만 selected 에 남겨 재시도 가능.
                setSelected((prev) => {
                    const next = new Set(prev);
                    okUpdates.forEach((_, id) => next.delete(id));
                    return next;
                });
            }
            if (failures.length > 0) {
                // 부분 실패: 모달 유지, 실패 사유 표시. 사용자는 페이로드 조정 후 재시도 가능.
                setError(`일괄 수정 중 ${failures.length}건 실패 (${failures.slice(0, 3).map((f) => `#${f.id}`).join(', ')}${failures.length > 3 ? '…' : ''})`);
            } else {
                setError(null);
                setBulkOpen(false);
            }
        } finally {
            setBulkSaving(false);
        }
    }

    const filtered = useMemo(() => {
        let arr = items.slice();
        if (search) {
            const q = search.toLowerCase();
            arr = arr.filter(
                (u) =>
                    (u.login_id || '').toLowerCase().includes(q) ||
                    (u.display_name || '').toLowerCase().includes(q) ||
                    (u.department || '').toLowerCase().includes(q) ||
                    (u.org_name || '').toLowerCase().includes(q),
            );
        }
        if (statusFilter !== 'all') {
            const want = statusFilter === 'active';
            arr = arr.filter((u) => (u.is_active === 1 || u.is_active === true) === want);
        }
        if (roleFilter !== 'all') arr = arr.filter((u) => u.role === roleFilter);

        if (sortBy === 'name') arr.sort((a, b) => (a.display_name || '').localeCompare(b.display_name || '', 'ko-KR'));
        else
            arr.sort((a, b) => {
                const ta = a.last_login_at ? new Date(a.last_login_at).getTime() : 0;
                const tb = b.last_login_at ? new Date(b.last_login_at).getTime() : 0;
                return tb - ta;
            });
        return arr;
    }, [items, search, statusFilter, roleFilter, sortBy]);

    const totalUsers = items.length;
    const activeUsers = items.filter((u) => u.is_active === 1 || u.is_active === true).length;
    const inactiveUsers = totalUsers - activeUsers;
    const superAdmins = items.filter((u) => u.role === 'super_admin').length;
    const activeRate = totalUsers ? Math.round((activeUsers / totalUsers) * 100) : 0;
    const superRate = totalUsers ? Math.round((superAdmins / totalUsers) * 100) : 0;

    const allSelected = filtered.length > 0 && filtered.every((u) => selected.has(u.user_id));
    const toggleAll = () => {
        if (allSelected) setSelected(new Set());
        else setSelected(new Set(filtered.map((u) => u.user_id)));
    };
    const toggleOne = (id) => {
        const next = new Set(selected);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        setSelected(next);
    };

    // 일괄 수정 대상은 "현재 화면에 보이는(필터된)" 사용자 중 선택된 것만.
    // 검색·필터로 가려진 사용자가 selected 에 남아있어도 대상에 포함되지 않도록 명시적으로 좁힘.
    const visibleSelectedIds = useMemo(
        () => filtered.filter((u) => selected.has(u.user_id)).map((u) => u.user_id),
        [filtered, selected],
    );
    const hiddenSelectedCount = selected.size - visibleSelectedIds.length;

    return (
        <div className="w-full">
            <Header
                title="사용자 관리"
                subtitle="Meta-Trustguard 에 등록된 관리자 계정을 관리합니다."
                actions={null}
            />

            {loading ? (
                <div className="flex justify-center py-12">
                    <Loader2 className="h-5 w-5 animate-spin text-[var(--ink-500)]" />
                </div>
            ) : (
                <div className="space-y-4">
                    {/* 통계 4카드 */}
                    <div className="grid grid-cols-4 gap-3.5">
                        <StatCard icon={UsersIcon} tone="bg-[var(--primary-soft)] text-[var(--primary)]" label="총 사용자" value={totalUsers} sub={`등록된 전체 관리자`} />
                        <StatCard icon={Activity} tone="bg-[var(--success-soft)] text-[var(--success)]" label="활성 사용자" value={activeUsers} sub={`${activeRate}%의 사용자가 활성 상태`} />
                        <StatCard icon={UserMinus} tone="bg-[var(--warning-soft)] text-[var(--warning)]" label="비활성 사용자" value={inactiveUsers} sub={`비활성 처리된 계정`} />
                        <StatCard icon={ShieldAlert} tone="bg-[var(--cat-policy-soft)] text-[var(--cat-policy)]" label="최고관리자" value={superAdmins} sub={`전체의 ${superRate}%`} />
                    </div>

                    {/* 서브 탭 */}
                    <div className="flex items-center gap-2">
                        <button
                            onClick={() => setTab('users')}
                            className={`inline-flex items-center gap-1.5 h-[30px] px-3 rounded-full text-[12.5px] font-semibold transition-colors cursor-pointer ${
                                tab === 'users'
                                    ? 'bg-[var(--primary-soft-flat)] text-[var(--primary)]'
                                    : 'bg-white border border-[var(--border)] text-[var(--ink-500)] hover:bg-[var(--background-soft)]'
                            }`}
                        >
                            <UsersIcon size={12} />
                            사용자
                            <span className={`ml-0.5 inline-flex items-center justify-center min-w-[20px] h-[18px] px-1 rounded-full text-[10.5px] font-bold ${
                                tab === 'users' ? 'bg-[var(--primary)] text-white' : 'bg-[var(--muted)] text-[var(--ink-500)]'
                            }`}>
                                {totalUsers}
                            </span>
                        </button>
                        <button
                            onClick={() => setTab('history')}
                            className={`inline-flex items-center gap-1.5 h-[30px] px-3 rounded-full text-[12.5px] font-semibold transition-colors cursor-pointer ${
                                tab === 'history'
                                    ? 'bg-[var(--primary-soft-flat)] text-[var(--primary)]'
                                    : 'bg-white border border-[var(--border)] text-[var(--ink-500)] hover:bg-[var(--background-soft)]'
                            }`}
                        >
                            <KeyRound size={12} />
                            로그인 이력
                            <span className="ml-0.5 text-[var(--ink-400)]">—</span>
                        </button>
                    </div>

                    {error && <p className="text-sm text-[var(--destructive)]">{error}</p>}

                    {tab === 'users' ? (
                        <>
                            {/* 필터 / 액션 바 */}
                            <div className="flex items-center gap-2 flex-wrap">
                                <div className="relative">
                                    <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--ink-400)]" />
                                    <input
                                        type="text"
                                        placeholder="이름 · ID · 부서 검색"
                                        value={search}
                                        onChange={(e) => setSearch(e.target.value)}
                                        className="h-[36px] w-[280px] pl-8 pr-3 rounded-full border border-[var(--border)] bg-white text-[12.5px] outline-none focus:border-[var(--primary)]"
                                    />
                                </div>
                                <DropdownLabel label="상태" value={statusFilter} onChange={setStatusFilter}
                                    options={[
                                        { value: 'all', label: '전체' },
                                        { value: 'active', label: '활성' },
                                        { value: 'inactive', label: '비활성' },
                                    ]}
                                />
                                <DropdownLabel label="역할" value={roleFilter} onChange={setRoleFilter}
                                    options={[
                                        { value: 'all', label: '전체' },
                                        { value: 'admin', label: '관리자' },
                                        { value: 'super_admin', label: '최고관리자' },
                                    ]}
                                />
                                <DropdownLabel label="정렬" value={sortBy} onChange={setSortBy}
                                    options={[
                                        { value: 'last_login', label: '최근 로그인' },
                                        { value: 'name', label: '이름순' },
                                    ]}
                                />
                                <div className="ml-auto flex items-center gap-2">
                                    <button
                                        disabled
                                        title="추후 지원"
                                        className="inline-flex items-center gap-1.5 h-[36px] px-4 rounded-full border border-[var(--border)] bg-white text-[12.5px] font-semibold text-[var(--ink-500)] cursor-not-allowed"
                                    >
                                        <Upload size={12} /> CSV 업로드
                                    </button>
                                    {isSuperAdmin && (
                                        <button
                                            onClick={() => setModalState({ open: true, target: null })}
                                            className="inline-flex items-center gap-1.5 h-[36px] px-4 rounded-full bg-[var(--primary)] text-white text-[12.5px] font-semibold hover:bg-[var(--primary)] shadow-sm cursor-pointer"
                                        >
                                            <Plus size={13} /> 사용자 추가
                                        </button>
                                    )}
                                </div>
                            </div>

                            {/* 선택 액션바 — 선택 시에만 노출, super_admin 만 일괄 수정 가능.
                                현재 필터에 가려진 선택 항목이 있으면 사용자에게 명시. */}
                            {selected.size > 0 && (
                                <div className="flex items-center gap-3 px-4 py-2.5 rounded-xl bg-[var(--primary-soft-flat)] border border-[var(--primary-soft-border)]">
                                    <span className="text-[12.5px] text-[var(--primary)]">
                                        <strong className="font-bold">{visibleSelectedIds.length}명</strong> 선택됨
                                        {hiddenSelectedCount > 0 && (
                                            <span className="ml-1.5 text-[var(--ink-500)] font-normal">
                                                (필터로 가려진 {hiddenSelectedCount}명 제외)
                                            </span>
                                        )}
                                    </span>
                                    <div className="ml-auto flex items-center gap-2">
                                        {isSuperAdmin && (
                                            <button
                                                onClick={() => setBulkOpen(true)}
                                                disabled={visibleSelectedIds.length === 0}
                                                className="inline-flex items-center gap-1.5 h-[32px] px-3.5 rounded-full bg-[var(--primary)] text-white text-[12.5px] font-semibold hover:bg-[var(--primary)] shadow-sm cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                                            >
                                                <Pencil size={12} /> 일괄 수정
                                            </button>
                                        )}
                                        <button
                                            onClick={() => setSelected(new Set())}
                                            className="inline-flex items-center gap-1.5 h-[32px] px-3.5 rounded-full border border-[var(--primary-soft-border)] bg-white text-[12.5px] font-semibold text-[var(--primary)] hover:bg-[var(--primary-soft-flat)] cursor-pointer"
                                        >
                                            선택 해제
                                        </button>
                                    </div>
                                </div>
                            )}

                            {/* 테이블 */}
                            <div className="bg-white border border-[var(--border)] rounded-xl overflow-hidden">
                                <table className="w-full text-sm">
                                    <thead>
                                        <tr className="border-b border-[var(--border)]">
                                            <th className="px-4 py-3 w-[44px]">
                                                <input
                                                    type="checkbox"
                                                    checked={allSelected}
                                                    onChange={toggleAll}
                                                    className="cursor-pointer"
                                                />
                                            </th>
                                            <th className="px-4 py-3 text-left text-[11.5px] font-semibold text-[var(--ink-500)]">사용자</th>
                                            <th className="px-4 py-3 text-left text-[11.5px] font-semibold text-[var(--ink-500)]">부서</th>
                                            <th className="px-4 py-3 text-left text-[11.5px] font-semibold text-[var(--ink-500)]">상태</th>
                                            <th className="px-4 py-3 text-left text-[11.5px] font-semibold text-[var(--ink-500)]">마지막 로그인</th>
                                            <th className="px-4 py-3 text-right text-[11.5px] font-semibold text-[var(--ink-500)] pr-6">로그인</th>
                                            <th className="px-4 py-3 w-[48px]"></th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-[var(--border)]">
                                        {filtered.length === 0 && (
                                            <tr>
                                                <td colSpan={7} className="px-4 py-10 text-center text-sm text-[var(--ink-500)]">
                                                    {search || statusFilter !== 'all' || roleFilter !== 'all'
                                                        ? '검색 결과가 없습니다'
                                                        : '사용자가 없습니다'}
                                                </td>
                                            </tr>
                                        )}
                                        {filtered.map((u) => {
                                            const active = u.is_active === 1 || u.is_active === true;
                                            const isMe = u.user_id === currentUserId;
                                            const rel = relativeTime(u.last_login_at);
                                            const abs = u.last_login_at
                                                ? fmtDateTime(u.last_login_at)
                                                : '미접속';
                                            return (
                                                <tr
                                                    key={u.user_id}
                                                    className={`hover:bg-[var(--background-soft)] ${isSuperAdmin ? 'cursor-pointer' : ''}`}
                                                    onClick={isSuperAdmin ? () => setModalState({ open: true, target: u }) : undefined}
                                                >
                                                    <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                                                        <input
                                                            type="checkbox"
                                                            checked={selected.has(u.user_id)}
                                                            onChange={() => toggleOne(u.user_id)}
                                                            className="cursor-pointer"
                                                        />
                                                    </td>
                                                    <td className="px-4 py-3">
                                                        <div className="flex items-center gap-3">
                                                            <Avatar name={u.display_name} id={u.user_id} size={36} />
                                                            <div className="min-w-0">
                                                                <div className="flex items-center gap-2">
                                                                    <span className="text-[13px] font-semibold text-[var(--ink-900)]">{u.display_name}</span>
                                                                    <RoleChip role={u.role} />
                                                                </div>
                                                                <div className="text-[11.5px] text-[var(--ink-500)] font-mono mt-0.5 truncate">
                                                                    {u.login_id}
                                                                </div>
                                                            </div>
                                                        </div>
                                                    </td>
                                                    <td className="px-4 py-3 text-[12.5px] text-[var(--ink-700)]">
                                                        {u.department || '—'}
                                                    </td>
                                                    <td className="px-4 py-3">
                                                        <span className="inline-flex items-center gap-1.5 text-[12px] text-[var(--ink-700)]">
                                                            <span className={`w-1.5 h-1.5 rounded-full ${active ? 'bg-[var(--success)]' : 'bg-[var(--ink-500)]'}`} />
                                                            {active ? '활성' : '비활성'}
                                                        </span>
                                                    </td>
                                                    <td className="px-4 py-3">
                                                        {rel ? (
                                                            <>
                                                                <div className="text-[12.5px] font-semibold text-[var(--ink-900)]">{rel}</div>
                                                                <div className="text-[11px] text-[var(--ink-500)] mt-0.5 tabular-nums">{abs}</div>
                                                            </>
                                                        ) : (
                                                            <>
                                                                <div className="text-[12.5px] font-semibold text-[var(--ink-400)]">—</div>
                                                                <div className="text-[11px] text-[var(--ink-500)] mt-0.5 tabular-nums">{abs}</div>
                                                            </>
                                                        )}
                                                    </td>
                                                    <td className="px-4 py-3 text-right tabular-nums text-[13px] font-semibold text-[var(--ink-900)] pr-6">
                                                        {Number(u.login_count || 0).toLocaleString('ko-KR')}
                                                    </td>
                                                    <td className="px-4 py-3 text-right" onClick={(e) => e.stopPropagation()}>
                                                        <RowMenu
                                                            disabled={!isSuperAdmin}
                                                            onEdit={() => setModalState({ open: true, target: u })}
                                                            onResetPw={() => handleResetPw(u)}
                                                            onManageOrgs={() => setOrgModal({ open: true, user: u })}
                                                            onDelete={() => !isMe && handleDelete(u)}
                                                        />
                                                    </td>
                                                </tr>
                                            );
                                        })}
                                    </tbody>
                                </table>
                            </div>
                        </>
                    ) : (
                        <LoginHistoryTab />
                    )}
                </div>
            )}

            {modalState.open && (
                <UserModal
                    initial={
                        modalState.target
                            ? {
                                  user_id: modalState.target.user_id,
                                  login_id: modalState.target.login_id,
                                  display_name: modalState.target.display_name,
                                  email: modalState.target.email,
                                  role: modalState.target.role,
                                  org_id: modalState.target.org_id,
                                  department: modalState.target.department,
                                  is_active: modalState.target.is_active,
                                  hire_date: modalState.target.hire_date,
                                  leave_date: modalState.target.leave_date,
                                  extension: modalState.target.extension,
                                  dup_login_yn: modalState.target.dup_login_yn,
                              }
                            : {}
                    }
                    brands={brands}
                    isSuperAdmin={isSuperAdmin}
                    onSave={handleSave}
                    onClose={() => setModalState({ open: false, target: null })}
                    saving={saving}
                />
            )}

            {bulkOpen && (
                <BulkEditModal
                    targets={filtered.filter((u) => selected.has(u.user_id))}
                    currentUserId={currentUserId}
                    brands={brands}
                    onSave={handleBulkSave}
                    onClose={() => setBulkOpen(false)}
                    saving={bulkSaving}
                />
            )}

            {orgModal.open && orgModal.user && (
                <MembershipsModal
                    user={orgModal.user}
                    brands={brands}
                    onClose={() => setOrgModal({ open: false, user: null })}
                    onChanged={load}
                />
            )}

            {initialPwInfo && (
                <InitialPasswordModal
                    user={initialPwInfo.user}
                    initialPassword={initialPwInfo.initial_password}
                    mode={initialPwInfo.mode}
                    onClose={() => setInitialPwInfo(null)}
                />
            )}
        </div>
    );
};

function DropdownLabel({ label, value, onChange, options }) {
    return (
        <label className="inline-flex items-center h-[36px] pl-3 pr-2 rounded-full border border-[var(--border)] bg-white text-[12.5px] text-[var(--ink-700)] gap-1.5 cursor-pointer">
            <span className="text-[var(--ink-500)]">{label}:</span>
            <select
                value={value}
                onChange={(e) => onChange(e.target.value)}
                className="appearance-none bg-transparent outline-none font-semibold text-[var(--ink-900)] pr-4 cursor-pointer"
                style={{ backgroundImage: 'none' }}
            >
                {options.map((o) => (
                    <option key={o.value} value={o.value}>
                        {o.label}
                    </option>
                ))}
            </select>
            <ChevronDown size={12} className="text-[var(--ink-400)] -ml-3 pointer-events-none" />
        </label>
    );
}

export default Users;
