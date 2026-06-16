import React from 'react';
import { Home, Building2, Users, Terminal, Bell, Bot, BarChart3 } from 'lucide-react';
import { PRODUCT_NAME } from '../branding';
import BrandSelector from './BrandSelector';

// 권한 체계(05 튜터 / 08 Meta_Summary 동일 3단계):
//   상담사(agent)      : 워크스페이스(홈)만 — 조직/시스템 미노출
//   관리자(admin)      : 워크스페이스 + 사용자 관리 + 시스템(AI 평가항목·알림)
//   슈퍼관리자(super)  : 위 전부 + 브랜드 관리 + 실시간 로그
// AI 평가항목 관리 · 알림: admin / super_admin 공통, 시스템 그룹에 노출.
// 실시간 로그: super_admin 전용.
const AGENT_NAV_GROUPS = [
    {
        section: '워크스페이스',
        items: [{ label: '홈', tab: 'dashboard', Icon: Home }],
    },
];

const ADMIN_NAV_GROUPS = [
    {
        section: '워크스페이스',
        items: [
            { label: '홈', tab: 'dashboard', Icon: Home },
            { label: '전체 통계', tab: 'stats', Icon: BarChart3 },
        ],
    },
    {
        section: '조직',
        items: [{ label: '사용자 관리', tab: 'users', Icon: Users }],
    },
    {
        section: '시스템',
        items: [
            { label: 'AI 평가항목 관리', tab: 'eval-items', Icon: Bot },
            { label: '알림', tab: 'notifications', Icon: Bell },
        ],
    },
];

const SUPER_ADMIN_NAV_GROUPS = [
    {
        section: '워크스페이스',
        items: [
            { label: '홈', tab: 'dashboard', Icon: Home },
            { label: '전체 통계', tab: 'stats', Icon: BarChart3 },
        ],
    },
    {
        section: '조직',
        items: [
            { label: '사용자 관리', tab: 'users', Icon: Users },
            { label: '브랜드 관리', tab: 'brands', Icon: Building2 },
        ],
    },
    {
        section: '시스템',
        items: [
            { label: 'AI 평가항목 관리', tab: 'eval-items', Icon: Bot },
            { label: '알림', tab: 'notifications', Icon: Bell },
            { label: '실시간 로그', tab: 'logs', Icon: Terminal },
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
}) => {
    const navGroups =
        role === 'super_admin'
            ? SUPER_ADMIN_NAV_GROUPS
            : role === 'admin'
              ? ADMIN_NAV_GROUPS
              : AGENT_NAV_GROUPS; // agent(상담사) 및 그 외 — 워크스페이스(홈)만
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
