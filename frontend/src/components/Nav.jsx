import React from 'react';
import { Clock3, ShieldCheck, Shield, Headset, Home, ChevronRight, PanelLeftClose, PanelLeftOpen } from 'lucide-react';
import NotificationBell from './NotificationBell';
import OrgSwitcher from './OrgSwitcher';
/* SAMPLE_UPLOAD_FEATURE */ import SampleUploadModal from './SampleUploadModal';

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
    'eval-items': '평가항목 관리',
    skills: 'AI 스킬 관리',
    'admin-batch': 'AI 평가 배치관리',
    users: '사용자 관리',
    brands: '브랜드 관리',
    stats: '전체 통계',
    notifications: '알림',
    logs: '실시간 로그',
    settings: '시스템 설정',
};

// 시스템 설정 하위화면 key → 라벨 (Settings.jsx SECTION_META 와 정합). 상단바 브레드크럼 2단계 표시용.
const SETTINGS_SECTION_LABELS = {
    batch: 'AI 평가 배치 관리',
    users: '사용자 관리',
    brands: '브랜드 관리',
    logs: '실시간 로그',
    profile: '프로필',
    notify: '알림 설정',
    about: '정보·약관',
};

// 탭 → 표시 라벨. eval-mgmt 는 역할별, detail 은 페이지명.
function tabLabelOf(tab, role) {
    if (tab === 'eval-mgmt') return role === 'agent' ? '내 평가 결과' : '상담사 QA관리';
    if (tab === 'detail') return '상담 QA 분석 결과';
    return TAB_LABELS[tab] || '';
}

// 현재 위치 브레드크럼. 상세(detail)는 "어디서 진입했는지(detailOrigin)"를 부모로 두고
// 그 탭으로 복귀 가능 — 평가 리스트에서 왔으면 평가 리스트, 상담사 평가관리에서 왔으면 그쪽.
function buildCrumbs(activeTab, role, detailOrigin, onNavTab, settingsSection) {
    if (!activeTab) return [];
    if (activeTab === 'detail') {
        const origin = detailOrigin || 'dashboard';
        return [
            { label: tabLabelOf(origin, role), onClick: () => onNavTab && onNavTab(origin) },
            { label: '상담 QA 분석 결과' },
        ];
    }
    // 시스템 설정: '시스템 설정 > 하위화면'. 하위화면에 있을 때 상위 '시스템 설정' 클릭 시 허브로 복귀.
    if (activeTab === 'settings') {
        const crumbs = [{
            label: '시스템 설정',
            onClick: settingsSection ? () => onNavTab && onNavTab('settings') : undefined,
        }];
        const subLabel = settingsSection ? SETTINGS_SECTION_LABELS[settingsSection] : '';
        if (subLabel) crumbs.push({ label: subLabel });
        return crumbs;
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

const Nav = ({ onHomeClick, onLogout, onProfileClick, remainingMs, isDev, user, activeTab, detailOrigin, settingsSection, onNavTab, onSampleUploaded, onToggleSidebar, sidebarCollapsed }) => {
    const roleMeta = user?.role ? ROLE_META[user.role] : null;
    const displayName = user?.display_name || user?.login_id || '';
    const crumbs = buildCrumbs(activeTab, user?.role, detailOrigin, onNavTab, settingsSection);
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

                {user && onToggleSidebar && (
                    <button
                        type="button"
                        onClick={onToggleSidebar}
                        className="app-nav-sidebar-toggle"
                        aria-label={sidebarCollapsed ? '사이드바 펼치기' : '사이드바 접기'}
                        aria-pressed={!sidebarCollapsed}
                        title={sidebarCollapsed ? '사이드바 펼치기' : '사이드바 접기'}
                    >
                        {sidebarCollapsed ? <PanelLeftOpen size={18} /> : <PanelLeftClose size={18} />}
                    </button>
                )}

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
                        {/* SAMPLE_UPLOAD_FEATURE — 평가 리스트(평가 업로드)에서만 노출 */}
                        {user && activeTab === 'dashboard' && (
                            <SampleUploadModal onUploaded={onSampleUploaded} />
                        )}
                        {user && <OrgSwitcher />}
                        {user && <NotificationBell />}
                        {user && (
                            <button
                                type="button"
                                onClick={onProfileClick}
                                className="app-nav-user app-nav-user-button"
                                title={onProfileClick ? '내 프로필 열기' : (user.login_id || '')}
                            >
                                <span className="app-nav-user-avatar">{initialsOf(user)}</span>
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
