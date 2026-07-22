import React, { useEffect, useState } from 'react';
import { Loader2, X } from 'lucide-react';
import {
    PASSWORD_POLICY_HINT,
    PASSWORD_POLICY_RE,
    updateMe,
} from '../services/api';

// 본인 프로필 편집 모달.
// - 이름 / 비밀번호만 변경 가능 (로그인 ID·역할·소속은 super_admin 만). 프로필 사진 업로드 기능은 폐지.
// - 아바타는 이름 이니셜 원형으로만 표시(업로드 없음).
//
// onSaved(updatedUser) — 저장 직후 상위 (App.jsx) 가 currentUser 캐시를 갱신할 수 있도록 전달.
//
// 비밀번호 정책은 services/api.js PASSWORD_POLICY_RE 와 동일 (서버 userProfile.mjs 와도 정합).

function getInitial(name) {
    const src = String(name || '').trim();
    if (!src) return '?';
    return /[가-힣]/.test(src) ? src.slice(0, 1) : src.slice(0, 1).toUpperCase();
}

export default function ProfileModal({ currentUser, onClose, onSaved }) {
    const [draftName, setDraftName] = useState(currentUser?.display_name || '');
    const [currentPw, setCurrentPw] = useState('');
    const [newPw, setNewPw] = useState('');
    const [confirmPw, setConfirmPw] = useState('');
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState(null);

    useEffect(() => {
        setDraftName(currentUser?.display_name || '');
    }, [currentUser]);

    const wantsPasswordChange = Boolean(currentPw || newPw || confirmPw);
    const newPwValid = !wantsPasswordChange || PASSWORD_POLICY_RE.test(newPw);
    const confirmOk = !wantsPasswordChange || (newPw && newPw === confirmPw);
    const nameOk = draftName.trim().length >= 1 && draftName.trim().length <= 50;
    const nameChanged = draftName.trim() !== (currentUser?.display_name || '').trim();
    const hasAnyChange = nameChanged || wantsPasswordChange;
    const canSave = nameOk && newPwValid && confirmOk && hasAnyChange && !saving;

    const onSave = async () => {
        setSaving(true);
        setError(null);
        try {
            const patch = {};
            if (nameChanged) patch.display_name = draftName.trim();
            if (wantsPasswordChange) {
                patch.current_password = currentPw;
                patch.new_password = newPw;
            }
            const updated = await updateMe(patch);
            onSaved?.({ display_name: updated?.display_name });
            // 비밀번호 변경 입력 초기화
            setCurrentPw('');
            setNewPw('');
            setConfirmPw('');
            onClose?.();
        } catch (err) {
            setError(err?.message || '저장 실패');
        } finally {
            setSaving(false);
        }
    };

    return (
        <div
            className="fixed inset-0 z-[120] flex items-center justify-center px-4"
            style={{ background: 'rgba(15,23,42,0.5)' }}
            onClick={(e) => {
                if (e.target === e.currentTarget) onClose?.();
            }}
        >
            <div className="w-full max-w-md bg-white rounded-2xl shadow-xl overflow-hidden">
                <div className="px-6 pt-5 pb-3 flex items-center justify-between border-b border-[var(--border)]">
                    <h3 className="text-base font-bold text-[var(--ink-900)]">내 프로필</h3>
                    <button
                        onClick={onClose}
                        className="w-7 h-7 grid place-items-center rounded-md text-[var(--ink-500)] hover:bg-[var(--muted)] cursor-pointer"
                    >
                        <X size={14} />
                    </button>
                </div>

                <div className="px-6 py-5 space-y-5">
                    <div className="flex items-center gap-4">
                        <div className="w-[72px] h-[72px] rounded-full bg-[var(--primary)] text-white grid place-items-center font-bold text-2xl shrink-0">
                            {getInitial(currentUser?.display_name || currentUser?.login_id)}
                        </div>
                        <div className="flex-1 min-w-0">
                            <div className="text-[13px] font-semibold text-[var(--ink-900)]">{currentUser?.display_name}</div>
                            <div className="text-[11.5px] text-[var(--ink-500)] font-mono mt-0.5">{currentUser?.login_id}</div>
                        </div>
                    </div>

                    <div>
                        <label className="block text-[11.5px] font-semibold text-[var(--ink-500)] mb-1.5 uppercase tracking-wide">
                            이름
                        </label>
                        <input
                            type="text"
                            value={draftName}
                            onChange={(e) => setDraftName(e.target.value)}
                            maxLength={50}
                            className="w-full h-[40px] px-3 rounded-xl border border-[var(--border)] bg-white text-sm outline-none focus:border-[var(--primary)]"
                        />
                    </div>

                    <div className="space-y-3">
                        <div className="flex items-center justify-between">
                            <span className="text-[11.5px] font-semibold text-[var(--ink-500)] uppercase tracking-wide">
                                비밀번호 변경 (선택)
                            </span>
                        </div>
                        <p className="text-[11.5px] text-[var(--ink-500)] leading-relaxed">
                            {PASSWORD_POLICY_HINT}
                        </p>
                        <div>
                            <label className="block text-[11px] font-semibold text-[var(--ink-500)] mb-1">현재 비밀번호</label>
                            <input
                                type="password"
                                value={currentPw}
                                onChange={(e) => setCurrentPw(e.target.value)}
                                autoComplete="current-password"
                                className="w-full h-[38px] px-3 rounded-xl border border-[var(--border)] bg-white text-sm outline-none focus:border-[var(--primary)]"
                            />
                        </div>
                        <div>
                            <label className="block text-[11px] font-semibold text-[var(--ink-500)] mb-1">새 비밀번호</label>
                            <input
                                type="password"
                                value={newPw}
                                onChange={(e) => setNewPw(e.target.value)}
                                autoComplete="new-password"
                                className={`w-full h-[38px] px-3 rounded-xl border bg-white text-sm outline-none focus:border-[var(--primary)] ${
                                    wantsPasswordChange && newPw && !newPwValid ? 'border-[var(--destructive-soft)]' : 'border-[var(--border)]'
                                }`}
                            />
                            {wantsPasswordChange && newPw && !newPwValid && (
                                <p className="text-[11px] text-[var(--destructive)] mt-1">규칙에 맞지 않습니다.</p>
                            )}
                        </div>
                        <div>
                            <label className="block text-[11px] font-semibold text-[var(--ink-500)] mb-1">새 비밀번호 확인</label>
                            <input
                                type="password"
                                value={confirmPw}
                                onChange={(e) => setConfirmPw(e.target.value)}
                                autoComplete="new-password"
                                className={`w-full h-[38px] px-3 rounded-xl border bg-white text-sm outline-none focus:border-[var(--primary)] ${
                                    wantsPasswordChange && confirmPw && !confirmOk ? 'border-[var(--destructive-soft)]' : 'border-[var(--border)]'
                                }`}
                            />
                            {wantsPasswordChange && confirmPw && !confirmOk && (
                                <p className="text-[11px] text-[var(--destructive)] mt-1">새 비밀번호가 일치하지 않습니다.</p>
                            )}
                        </div>
                    </div>

                    {error && <p className="text-[12px] text-[var(--destructive)]">{error}</p>}
                </div>

                <div className="px-6 pb-5 flex gap-2 justify-end">
                    <button
                        type="button"
                        onClick={onClose}
                        className="h-[38px] px-5 rounded-xl border border-[var(--border)] bg-white text-[13px] font-semibold text-[var(--ink-900)] hover:bg-[var(--muted)] cursor-pointer"
                    >
                        취소
                    </button>
                    <button
                        type="button"
                        onClick={onSave}
                        disabled={!canSave}
                        className="h-[38px] px-5 rounded-xl bg-[var(--primary)] text-white text-[13px] font-semibold hover:bg-[var(--primary)] shadow-sm disabled:opacity-50 cursor-pointer"
                    >
                        {saving ? <Loader2 size={14} className="animate-spin inline" /> : '저장'}
                    </button>
                </div>
            </div>
        </div>
    );
}
