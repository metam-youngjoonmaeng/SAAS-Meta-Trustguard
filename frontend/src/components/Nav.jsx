import React from 'react';
import { Clock3, ShieldCheck, Shield, Headset, Home, ChevronRight } from 'lucide-react';
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

// 탭 → 라벨 (사이드바와 동일). 상단바 브레드크럼 표시용.
const TAB_LABELS = {
    dashboard: '평가 리스트',
    'eval-items': 'AI QA 항목관리',
    users: '사용자 관리',
    brands: '브랜드 관리',
    stats: '전체 통계',
    notifications: '알림',
    logs: '실시간 로그',
};

// 탭 → 표시 라벨. eval-mgmt 는 역할별, detail 은 페이지명.
function tabLabelOf(tab, role) {
    if (tab === 'eval-mgmt') return role === 'agent' ? '내 평가 결과' : '상담사 평가관리';
    if (tab === 'detail') return '상담 QA 분석 결과';
    return TAB_LABELS[tab] || '';
}

// 현재 위치 브레드크럼. 상세(detail)는 "어디서 진입했는지(detailOrigin)"를 부모로 두고
// 그 탭으로 복귀 가능 — 평가 리스트에서 왔으면 평가 리스트, 상담사 평가관리에서 왔으면 그쪽.
function buildCrumbs(activeTab, role, detailOrigin, onNavTab) {
    if (!activeTab) return [];
    if (activeTab === 'detail') {
        const origin = detailOrigin || 'dashboard';
        return [
            { label: tabLabelOf(origin, role), onClick: () => onNavTab && onNavTab(origin) },
            { label: '상담 QA 분석 결과' },
        ];
    }
    const label = tabLabelOf(activeTab, role);
    return label ? [{ label }] : [];
}

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

const Nav = ({ onHomeClick, onLogout, onProfileClick, remainingMs, isDev, user, activeTab, detailOrigin, onNavTab }) => {
    const roleMeta = user?.role ? ROLE_META[user.role] : null;
    const displayName = user?.display_name || user?.login_id || '';
    const avatarUrl = user?.profile_image_url;
    const crumbs = buildCrumbs(activeTab, user?.role, detailOrigin, onNavTab);
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
                    {/* 현재 위치 브레드크럼 (좌측) */}
                    {user && crumbs.length > 0 && (
                        <nav className="flex items-center gap-1.5 text-[13px] min-w-0" aria-label="현재 위치">
                            <button
                                type="button"
                                onClick={onHomeClick}
                                className="flex items-center text-[#667085] hover:text-[#055AAF] transition-colors shrink-0"
                                aria-label="평가 리스트(홈)"
                            >
                                <Home size={15} />
                            </button>
                            {crumbs.map((c, i) => (
                                <React.Fragment key={i}>
                                    <ChevronRight size={13} className="text-[#D0D5DD] shrink-0" />
                                    {c.onClick ? (
                                        <button
                                            type="button"
                                            onClick={c.onClick}
                                            className="text-[#667085] hover:text-[#055AAF] font-medium transition-colors truncate"
                                        >
                                            {c.label}
                                        </button>
                                    ) : (
                                        <span className={`truncate ${i === crumbs.length - 1 ? 'text-[#101828] font-semibold' : 'text-[#667085]'}`}>
                                            {c.label}
                                        </span>
                                    )}
                                </React.Fragment>
                            ))}
                        </nav>
                    )}
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
