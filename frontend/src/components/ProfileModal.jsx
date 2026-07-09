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
// - forceChange=true 인 경우 닫기 버튼 비활성 + 비밀번호 변경이 완료될 때까지 모달이 유지된다.
//
// onSaved(updatedUser) — 저장 직후 상위 (App.jsx) 가 currentUser 캐시를 갱신할 수 있도록 전달.
//
// 비밀번호 정책은 services/api.js PASSWORD_POLICY_RE 와 동일 (서버 userProfile.mjs 와도 정합).

function getInitial(name) {
    const src = String(name || '').trim();
    if (!src) return '?';
    return /[가-힣]/.test(src) ? src.slice(0, 1) : src.slice(0, 1).toUpperCase();
}

export default function ProfileModal({ currentUser, forceChange = false, onClose, onSaved }) {
    const [draftName, setDraftName] = useState(currentUser?.display_name || '');
    const [currentPw, setCurrentPw] = useState('');
    const [newPw, setNewPw] = useState('');
    const [confirmPw, setConfirmPw] = useState('');
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState(null);

    useEffect(() => {
        setDraftName(currentUser?.display_name || '');
    }, [currentUser]);

    const wantsPasswordChange = Boolean(currentPw || newPw || confirmPw) || forceChange;
    const newPwValid = !wantsPasswordChange || PASSWORD_POLICY_RE.test(newPw);
    const confirmOk = !wantsPasswordChange || (newPw && newPw === confirmPw);
    const nameOk = draftName.trim().length >= 1 && draftName.trim().length <= 50;
    const nameChanged = draftName.trim() !== (currentUser?.display_name || '').trim();
    const hasAnyChange = forceChange ? wantsPasswordChange : (nameChanged || wantsPasswordChange);
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
            onSaved?.({
                display_name: updated?.display_name,
                must_change_password: updated?.must_change_password,
            });
            // 비밀번호 변경 입력 초기화
            setCurrentPw('');
            setNewPw('');
            setConfirmPw('');
            if (!forceChange) onClose?.();
            else if (!updated?.must_change_password) onClose?.();
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
                if (forceChange) return;
                if (e.target === e.currentTarget) onClose?.();
            }}
        >
            <div className="w-full max-w-md bg-white rounded-2xl shadow-xl overflow-hidden">
                <div className="px-6 pt-5 pb-3 flex items-center justify-between border-b border-[#E4E7EC]">
                    <h3 className="text-base font-bold text-[#101828]">
                        {forceChange ? '비밀번호 변경 (초기 비밀번호)' : '내 프로필'}
                    </h3>
                    {!forceChange && (
                        <button
                            onClick={onClose}
                            className="w-7 h-7 grid place-items-center rounded-md text-[#667085] hover:bg-[#F2F4F7] cursor-pointer"
                        >
                            <X size={14} />
                        </button>
                    )}
                </div>

                {forceChange && (
                    <div className="px-6 pt-4">
                        <div className="rounded-xl bg-[#FFF7E6] border border-[#FCD9A6] px-3.5 py-2.5 text-[12px] text-[#92400E] leading-relaxed">
                            보안을 위해 새 비밀번호로 변경해야 다음 작업을 계속할 수 있습니다.
                        </div>
                    </div>
                )}

                <div className="px-6 py-5 space-y-5">
                    {!forceChange && (
                        <div className="flex items-center gap-4">
                            <div className="w-[72px] h-[72px] rounded-full bg-[#055AAF] text-white grid place-items-center font-bold text-2xl shrink-0">
                                {getInitial(currentUser?.display_name || currentUser?.login_id)}
                            </div>
                            <div className="flex-1 min-w-0">
                                <div className="text-[13px] font-semibold text-[#101828]">{currentUser?.display_name}</div>
                                <div className="text-[11.5px] text-[#667085] font-mono mt-0.5">{currentUser?.login_id}</div>
                            </div>
                        </div>
                    )}

                    {!forceChange && (
                        <div>
                            <label className="block text-[11.5px] font-semibold text-[#667085] mb-1.5 uppercase tracking-wide">
                                이름
                            </label>
                            <input
                                type="text"
                                value={draftName}
                                onChange={(e) => setDraftName(e.target.value)}
                                maxLength={50}
                                className="w-full h-[40px] px-3 rounded-xl border border-[#E4E7EC] bg-white text-sm outline-none focus:border-[#055AAF]"
                            />
                        </div>
                    )}

                    <div className="space-y-3">
                        <div className="flex items-center justify-between">
                            <span className="text-[11.5px] font-semibold text-[#667085] uppercase tracking-wide">
                                비밀번호 {forceChange ? '변경' : '변경 (선택)'}
                            </span>
                        </div>
                        <p className="text-[11.5px] text-[#667085] leading-relaxed">
                            {PASSWORD_POLICY_HINT}
                        </p>
                        <div>
                            <label className="block text-[11px] font-semibold text-[#667085] mb-1">현재 비밀번호</label>
                            <input
                                type="password"
                                value={currentPw}
                                onChange={(e) => setCurrentPw(e.target.value)}
                                autoComplete="current-password"
                                className="w-full h-[38px] px-3 rounded-xl border border-[#E4E7EC] bg-white text-sm outline-none focus:border-[#055AAF]"
                            />
                        </div>
                        <div>
                            <label className="block text-[11px] font-semibold text-[#667085] mb-1">새 비밀번호</label>
                            <input
                                type="password"
                                value={newPw}
                                onChange={(e) => setNewPw(e.target.value)}
                                autoComplete="new-password"
                                className={`w-full h-[38px] px-3 rounded-xl border bg-white text-sm outline-none focus:border-[#055AAF] ${
                                    wantsPasswordChange && newPw && !newPwValid ? 'border-[#FDA29B]' : 'border-[#E4E7EC]'
                                }`}
                            />
                            {wantsPasswordChange && newPw && !newPwValid && (
                                <p className="text-[11px] text-[#B42318] mt-1">규칙에 맞지 않습니다.</p>
                            )}
                        </div>
                        <div>
                            <label className="block text-[11px] font-semibold text-[#667085] mb-1">새 비밀번호 확인</label>
                            <input
                                type="password"
                                value={confirmPw}
                                onChange={(e) => setConfirmPw(e.target.value)}
                                autoComplete="new-password"
                                className={`w-full h-[38px] px-3 rounded-xl border bg-white text-sm outline-none focus:border-[#055AAF] ${
                                    wantsPasswordChange && confirmPw && !confirmOk ? 'border-[#FDA29B]' : 'border-[#E4E7EC]'
                                }`}
                            />
                            {wantsPasswordChange && confirmPw && !confirmOk && (
                                <p className="text-[11px] text-[#B42318] mt-1">새 비밀번호가 일치하지 않습니다.</p>
                            )}
                        </div>
                    </div>

                    {error && <p className="text-[12px] text-[#B42318]">{error}</p>}
                </div>

                <div className="px-6 pb-5 flex gap-2 justify-end">
                    {!forceChange && (
                        <button
                            type="button"
                            onClick={onClose}
                            className="h-[38px] px-5 rounded-xl border border-[#E4E7EC] bg-white text-[13px] font-semibold text-[#101828] hover:bg-[#F2F4F7] cursor-pointer"
                        >
                            취소
                        </button>
                    )}
                    <button
                        type="button"
                        onClick={onSave}
                        disabled={!canSave}
                        className="h-[38px] px-5 rounded-xl bg-[#055AAF] text-white text-[13px] font-semibold hover:bg-[#1E70E0] shadow-sm disabled:opacity-50 cursor-pointer"
                    >
                        {saving ? <Loader2 size={14} className="animate-spin inline" /> : '저장'}
                    </button>
                </div>
            </div>
        </div>
    );
}
