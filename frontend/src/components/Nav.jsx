import React from 'react';
import { Clock, Home, ChevronRight } from 'lucide-react';
import NotificationBell from './NotificationBell';
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
    // ics-3.0 top-header 시계와 동일한 표기(HH시 MM분 SS초). 값은 세션 남은시간 카운트다운.
    return `${pad(hh)}시 ${pad(mm)}분 ${pad(ss)}초`;
}

// 탭 → 라벨 (사이드바와 동일). 상단바 브레드크럼 표시용.
const TAB_LABELS = {
    dashboard: '평가 리스트',
    'ksqi-eval': 'KSQI 평가',
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

const Nav = ({ onHomeClick, onLogout, remainingMs, isDev, user, activeTab, detailOrigin, settingsSection, onNavTab, onSampleUploaded }) => {
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
                    {/* ics-3.0 top-header 와 동일한 "MetaM" 워드마크 */}
                    <span className="app-nav-wordmark">
                        <span style={{ color: '#525252' }}>Meta</span>
                        <span style={{ color: 'var(--primary)' }}>M</span>
                    </span>
                    {isDev && <span className="app-nav-dev-badge">DEV</span>}
                </button>

                <div className="app-nav-body">
                    {/* 현재 위치 브레드크럼 (좌측) */}
                    {user && crumbs.length > 0 && (
                        <nav className="flex items-center gap-1.5 text-[13px] min-w-0" aria-label="현재 위치">
                            <button
                                type="button"
                                onClick={onHomeClick}
                                className="flex items-center text-[var(--ink-500)] hover:text-[var(--primary)] transition-colors shrink-0"
                                aria-label="평가 리스트(홈)"
                            >
                                <Home size={15} />
                            </button>
                            {crumbs.map((c, i) => (
                                <React.Fragment key={i}>
                                    <ChevronRight size={13} className="text-[var(--ink-300)] shrink-0" />
                                    {c.onClick ? (
                                        <button
                                            type="button"
                                            onClick={c.onClick}
                                            className="text-[var(--ink-500)] hover:text-[var(--primary)] font-medium transition-colors truncate"
                                        >
                                            {c.label}
                                        </button>
                                    ) : (
                                        <span className={`truncate ${i === crumbs.length - 1 ? 'text-[var(--ink-900)] font-semibold' : 'text-[var(--ink-500)]'}`}>
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
                        {/* 소속 조직 전환(OrgSwitcher) 은 0902 사용자 지시로 비노출 — 브랜드 전환은 사이드바 BrandSelector 로 통일 */}
                        {user && <NotificationBell />}
                        {remainingMs != null && (
                            <div className="app-nav-timer">
                                <Clock size={14} />
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
