import React, { useMemo } from 'react';
import { Home, Bot, BarChart3, ClipboardCheck, Star, ListChecks, Settings, Gauge } from 'lucide-react';
import { PRODUCT_NAME } from '../branding';
import BrandSelector from './BrandSelector';

// 권한 체계(05 튜터 / 08 Meta_Summary 동일 3단계):
//   상담사(agent)      : 워크스페이스(홈)만 — 운영관리/시스템 미노출
//   관리자(admin)      : 워크스페이스 + 운영관리(평가) + 시스템(설정)
//   슈퍼관리자(super)  : 위 전부
// 운영관리: 평가 콘텐츠 운영(상담사 QA관리·평가항목·AI 스킬)만. admin / super_admin 공통.
// 사용자·브랜드 관리 + 실시간 로그(super_admin)는 시스템 설정(Settings) 하위화면으로 이동(사이드바 미노출).
const AGENT_NAV_GROUPS = [
    {
        section: '워크스페이스',
        items: [
            { label: '평가 리스트', tab: 'dashboard', Icon: Home },
            { label: '내 평가 결과', tab: 'eval-mgmt', Icon: Star },
            { label: '시스템 설정', tab: 'settings', Icon: Settings },
        ],
    },
];

const ADMIN_NAV_GROUPS = [
    {
        section: '워크스페이스',
        items: [
            { label: '평가 리스트', tab: 'dashboard', Icon: Home },
            { label: '전체 통계', tab: 'stats', Icon: BarChart3 },
        ],
    },
    {
        section: '운영관리',
        items: [
            { label: '상담사 QA관리', tab: 'eval-mgmt', Icon: ClipboardCheck },
            { label: '평가항목 관리', tab: 'eval-items', Icon: ListChecks },
            { label: 'AI 스킬 관리', tab: 'skills', Icon: Bot },
        ],
    },
    {
        section: '시스템',
        items: [
            { label: '시스템 설정', tab: 'settings', Icon: Settings },
        ],
    },
];

const SUPER_ADMIN_NAV_GROUPS = [
    {
        section: '워크스페이스',
        items: [
            { label: '평가 리스트', tab: 'dashboard', Icon: Home },
            { label: '전체 통계', tab: 'stats', Icon: BarChart3 },
        ],
    },
    {
        section: '운영관리',
        items: [
            { label: '상담사 QA관리', tab: 'eval-mgmt', Icon: ClipboardCheck },
            { label: '평가항목 관리', tab: 'eval-items', Icon: ListChecks },
            { label: 'AI 스킬 관리', tab: 'skills', Icon: Bot },
        ],
    },
    {
        section: '시스템',
        items: [
            // 실시간 로그는 시스템 설정 하위화면으로 이동(#/admin/settings/logs). 최상위 탭 미노출.
            { label: '시스템 설정', tab: 'settings', Icon: Settings },
        ],
    },
];

const Sidebar = ({
    activeTab,
    role,
    brands = [],
    selectedBrandId,
    onBrandChange,
    onTabClick,
    ksqiEnabled = false,
}) => {
    const baseGroups =
        role === 'super_admin'
            ? SUPER_ADMIN_NAV_GROUPS
            : role === 'admin'
              ? ADMIN_NAV_GROUPS
              : AGENT_NAV_GROUPS; // agent(상담사) 및 그 외 — 워크스페이스(홈)만
    // KSQI 평가 탭 — 브랜드 ksqi_stt_enabled=true 인 admin/super_admin 워크스페이스에만 주입
    // (평가 리스트·전체 통계와 같은 섹션). KSQI 관리 카탈로그는 딥링크(#/admin/ksqi-mgmt)로만 유지.
    const navGroups = useMemo(() => {
        if (!ksqiEnabled || (role !== 'admin' && role !== 'super_admin')) return baseGroups;
        return baseGroups.map((g) =>
            g.section === '워크스페이스'
                ? { ...g, items: [...g.items, { label: 'KSQI 평가', tab: 'ksqi-eval', Icon: Gauge }] }
                : g
        );
    }, [baseGroups, ksqiEnabled, role]);
    // 모든 역할(상담사 포함)이 본인 소속 브랜드를 셀렉터에 표시.
    // 전환은 lockSingle(super_admin 외 잠금)으로 제어 — 상담사는 표시만, 전환 불가.
    const showSelector = brands.length > 0;

    return (
        <aside className="sidebar">
            {showSelector && (
                <div className="sidebar-brand-selector">
                    <BrandSelector
                        brands={brands}
                        value={selectedBrandId}
                        onChange={onBrandChange}
                        lockSingle={role !== 'super_admin'}
                    />
                </div>
            )}

            <nav className="sidebar-nav">
                {navGroups.map((group) => (
                    <div key={group.section} className="sidebar-nav-group">
                        <p className="sidebar-nav-section">{group.section}</p>
                        <ul>
                            {group.items.map((item) => {
                                const isActive = activeTab === item.tab;
                                return (
                                    <li key={item.tab}>
                                        <button
                                            type="button"
                                            onClick={() => onTabClick && onTabClick(item.tab)}
                                            className={`sidebar-nav-item${isActive ? ' is-active' : ''}`}
                                        >
                                            <item.Icon size={16} />
                                            <span>{item.label}</span>
                                        </button>
                                    </li>
                                );
                            })}
                        </ul>
                    </div>
                ))}
            </nav>

            <div className="sidebar-footer">
                <span className="sidebar-product-name">{PRODUCT_NAME}</span>
            </div>
        </aside>
    );
};

export default Sidebar;
