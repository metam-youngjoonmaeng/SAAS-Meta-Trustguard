import React from 'react';
import { Clock3, ShieldCheck, Shield, Headset } from 'lucide-react';
import NotificationBell from './NotificationBell';

// 원본: 01-AI-Tutor-dev/frontend/components/nav.tsx
// 사이즈/위치 동일: h-60px, 좌측 패딩 22px, 로고 h-22px, 워드마크 fontFamily=Moneygraphy Rounded, fontSize 14.5
// 탭은 미정의 — middle 영역은 비워두고 우측에 사용자 정보·세션 타이머·로그아웃만 표시

function formatRemainingTime(ms) {
    const safeMs = Math.max(0, Number(ms) || 0);
    const totalSeconds = Math.floor(safeMs / 1000);
    const hh = Math.floor(totalSeconds / 3600);
    const mm = Math.floor((totalSeconds % 3600) / 60);
    const ss = totalSeconds % 60;
    const pad = (n) => String(n).padStart(2, '0');
    return `${pad(hh)}:${pad(mm)}:${pad(ss)}`;
}

const ROLE_META = {
    super_admin: { label: '최고관리자', Icon: ShieldCheck, variant: 'super' },
    admin:       { label: '관리자',     Icon: Shield,      variant: 'admin' },
    agent:       { label: '상담사',     Icon: Headset,     variant: 'agent' },
};

function initialsOf(user) {
    if (!user) return '?';
    const src = String(user.display_name || user.login_id || '').trim();
    if (!src) return '?';
    // 한글: 첫 글자, 영문: 단어 최대 2개의 첫 글자
    const isHangul = /[가-힣]/.test(src);
    if (isHangul) return src.slice(0, 1);
    const parts = src.split(/\s+/).filter(Boolean);
    if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
    return src.slice(0, 2).toUpperCase();
}

const Nav = ({ onHomeClick, onLogout, onProfileClick, remainingMs, isDev, user }) => {
    const roleMeta = user?.role ? ROLE_META[user.role] : null;
    const displayName = user?.display_name || user?.login_id || '';
    const avatarUrl = user?.profile_image_url;
    return (
        <nav className="app-nav">
            <div className="app-nav-inner">
                <button
                    type="button"
                    onClick={onHomeClick}
                    className="app-nav-brand"
                    aria-label="홈으로 이동"
                >
                    <img src="/metam_logo.png" alt="메타엠 로고" className="app-nav-logo" />
                    <span className="app-nav-wordmark">Meta-Trustguard</span>
                    {isDev && <span className="app-nav-dev-badge">DEV</span>}
                </button>

                <div className="app-nav-body">
                    {/* 탭 영역 — 미정의 (원본 동일 구조 유지, 추후 NavLink 추가 위치) */}
                    <div className="app-nav-right">
                        {user && <NotificationBell />}
                        {user && (
                            <button
                                type="button"
                                onClick={onProfileClick}
                                className="app-nav-user app-nav-user-button"
                                title={onProfileClick ? '내 프로필 열기' : (user.login_id || '')}
                            >
                                {avatarUrl ? (
                                    <img src={avatarUrl} alt="" className="app-nav-user-avatar app-nav-user-avatar-image" />
                                ) : (
                                    <span className="app-nav-user-avatar">{initialsOf(user)}</span>
                                )}
                                <span className="app-nav-user-name">{displayName}</span>
                                {roleMeta && (
                                    <span className={`app-nav-user-role app-nav-user-role-${roleMeta.variant}`}>
                                        <roleMeta.Icon size={11} />
                                        {roleMeta.label}
                                    </span>
                                )}
                            </button>
                        )}
                        {remainingMs != null && (
                            <div className="app-nav-timer">
                                <Clock3 size={14} />
                                <span>{formatRemainingTime(remainingMs)}</span>
                            </div>
                        )}
                        {onLogout && (
                            <button type="button" onClick={onLogout} className="app-nav-logout">
                                로그아웃
                            </button>
                        )}
                    </div>
                </div>
            </div>
        </nav>
    );
};

export default Nav;
