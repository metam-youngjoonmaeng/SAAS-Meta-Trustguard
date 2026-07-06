import React, { useState, useEffect, useCallback, useRef } from 'react';
import Dashboard from './views/Dashboard';
import Detail from './views/Detail';
import Brands from './views/Brands';
import Users from './views/Users';
import Logs from './views/Logs';
import Notifications from './views/Notifications';
import EvalItemsHub from './views/EvalItemsHub';
import Stats from './views/Stats';
import EvalMgmt from './views/EvalMgmt';
import BatchManage from './views/evalMgmt/BatchManage';
import SkillPromptManage from './views/SkillPromptManage';
import Sidebar from './components/Sidebar';
import Nav from './components/Nav';
import ProfileModal from './components/ProfileModal';
import PageContainer from './components/PageContainer';
import {
    fetchCalls,
    fetchOrganizations,
    login as loginWithDb,
    icsSso as icsSsoLogin,
    logout as logoutOnDb,
    syncStoredActor,
    QA_ACTIVE_BRAND_KEY,
} from './services/api';
import { PRODUCT_NAME, PLATFORM_TITLE } from './branding';

const AUTH_STORAGE_KEY = 'qa_dashboard_auth';
const AUTH_EXPIRES_AT_KEY = 'qa_dashboard_auth_expires_at';
const QA_ACTOR_STORAGE_KEY = 'qa_dashboard_actor';
const SESSION_TIMEOUT_MS = 2 * 60 * 60 * 1000; // 2 hours
const DASHBOARD_HASH = '#/dashboard';
const BRANDS_HASH = '#/admin/brands';
const USERS_HASH = '#/admin/users';
const LOGS_HASH = '#/admin/logs';
const NOTIFICATIONS_HASH = '#/admin/notifications';
const EVAL_ITEMS_HASH = '#/admin/eval-items';
const STATS_HASH = '#/admin/stats';
const EVAL_MGMT_HASH = '#/eval-mgmt';
const BATCH_HASH = '#/admin/batch';
const SKILL_PROMPTS_HASH = '#/admin/skill-prompts';

function parseRouteFromHash() {
    if (typeof window === 'undefined') {
        return { tab: 'dashboard', qaId: null };
    }
    const raw = String(window.location.hash || '').trim();
    const detailPrefix = '#/detail/';
    if (raw.startsWith(detailPrefix)) {
        const qaId = decodeURIComponent(raw.slice(detailPrefix.length));
        if (qaId) {
            return { tab: 'detail', qaId };
        }
    }
    if (raw === '#/admin/brands') {
        return { tab: 'brands', qaId: null };
    }
    if (raw === '#/admin/users') {
        return { tab: 'users', qaId: null };
    }
    if (raw === '#/admin/logs') {
        return { tab: 'logs', qaId: null };
    }
    if (raw === '#/admin/notifications') {
        return { tab: 'notifications', qaId: null };
    }
    if (raw === '#/admin/eval-items') {
        return { tab: 'eval-items', qaId: null };
    }
    if (raw === '#/admin/stats') {
        return { tab: 'stats', qaId: null };
    }
    if (raw === '#/eval-mgmt') {
        return { tab: 'eval-mgmt', qaId: null };
    }
    if (raw === '#/admin/batch') {
        return { tab: 'admin-batch', qaId: null };
    }
    if (raw === '#/admin/skill-prompts') {
        return { tab: 'skill-prompts', qaId: null };
    }
    return { tab: 'dashboard', qaId: null };
}

function navigateHash(nextHash) {
    if (typeof window === 'undefined') return;
    if (window.location.hash === nextHash) return;
    window.location.hash = nextHash;
}

// ICS 임베드 창 마커 — sessionStorage(탭 단위): 새로고침엔 유지, 탭/창 닫으면 소멸 (05/08 동일).
//   직접 접속(파라미터 없음)에서 ICS 세션이 남아있어도 이 마커가 없으면(다른 탭/창닫음) 로그인으로 보낸다.
const ICS_EMBED_KEY = 'qa_dashboard_ics_embed';
function markIcsEmbed() {
    try { window.sessionStorage.setItem(ICS_EMBED_KEY, '1'); } catch { /* noop */ }
}
function isIcsEmbed() {
    try { return window.sessionStorage.getItem(ICS_EMBED_KEY) === '1'; } catch { return false; }
}
function clearIcsEmbed() {
    try { window.sessionStorage.removeItem(ICS_EMBED_KEY); } catch { /* noop */ }
}

// 저장된 actor 의 출처(auth_source) 조회 — 'ics' | 'manual' | null.
function storedAuthSource() {
    if (typeof window === 'undefined') return null;
    try {
        const raw = window.localStorage.getItem(QA_ACTOR_STORAGE_KEY);
        return raw ? (JSON.parse(raw)?.auth_source ?? null) : null;
    } catch { return null; }
}

// ICS 메뉴 진입(?userId)인지.
function hasIcsSsoParam() {
    if (typeof window === 'undefined') return false;
    return new URLSearchParams(window.location.search).has('userId');
}

function readStoredSession() {
    if (typeof window === 'undefined') {
        return { isAuthenticated: false, expiresAt: null };
    }
    const authFlag = window.localStorage.getItem(AUTH_STORAGE_KEY) === 'true';
    const rawExpires = window.localStorage.getItem(AUTH_EXPIRES_AT_KEY);
    const expiresAt = rawExpires ? Number(rawExpires) : null;
    const validExpiry = Number.isFinite(expiresAt) && expiresAt > Date.now();

    if (authFlag && validExpiry) {
        return { isAuthenticated: true, expiresAt };
    }

    // Remove stale session values.
    window.localStorage.removeItem(AUTH_STORAGE_KEY);
    window.localStorage.removeItem(AUTH_EXPIRES_AT_KEY);
    window.localStorage.removeItem(QA_ACTOR_STORAGE_KEY);
    return { isAuthenticated: false, expiresAt: null };
}

function LoginScreen({ onLogin }) {
    const [id, setId] = useState('');
    const [password, setPassword] = useState('');
    const [error, setError] = useState('');
    const [isSubmitting, setIsSubmitting] = useState(false);

    const handleSubmit = async (e) => {
        e.preventDefault();
        setIsSubmitting(true);
        const ok = await onLogin(id, password);
        setIsSubmitting(false);
        if (!ok) {
            setError('아이디 또는 비밀번호가 올바르지 않습니다.');
            return;
        }
        setError('');
    };

    return (
        <div className="min-h-screen bg-[#eff6ff] flex items-center justify-center px-4">
            <div className="w-full max-w-lg bg-white border border-[#E4E7EC] rounded-2xl shadow-md p-8">
                <p className="text-xs font-bold uppercase tracking-wide text-[#055AAF]">{PRODUCT_NAME}</p>
                <h1 className="text-lg font-extrabold text-[#101828] mt-1 leading-snug whitespace-pre-line">{PLATFORM_TITLE}</h1>
                <p className="text-sm text-[#667085] mt-3">관리자 계정으로 로그인하세요.</p>

                <form className="mt-6 space-y-4" onSubmit={handleSubmit}>
                    <div>
                        <label className="block text-xs font-bold text-[#667085] mb-1">ID</label>
                        <input
                            type="text"
                            value={id}
                            onChange={(e) => setId(e.target.value)}
                            placeholder="아이디를 입력하세요"
                            className="w-full px-3 py-2 bg-[#F9FAFB] border border-[#D0D5DD] rounded-lg text-sm outline-none focus:ring-2 focus:ring-[#055AAF]/20 focus:border-[#055AAF]"
                        />
                    </div>
                    <div>
                        <label className="block text-xs font-bold text-[#667085] mb-1">PW</label>
                        <input
                            type="password"
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                            placeholder="비밀번호를 입력하세요"
                            className="w-full px-3 py-2 bg-[#F9FAFB] border border-[#D0D5DD] rounded-lg text-sm outline-none focus:ring-2 focus:ring-[#055AAF]/20 focus:border-[#055AAF]"
                        />
                    </div>

                    {error ? <p className="text-xs text-[#D92D20]">{error}</p> : null}

                    <button
                        type="submit"
                        disabled={isSubmitting}
                        className="w-full py-2.5 bg-[#055AAF] text-white rounded-lg text-sm font-bold hover:bg-[#1E70E0] transition-colors disabled:opacity-70"
                    >
                        {isSubmitting ? '로그인 중...' : '로그인'}
                    </button>
                </form>

            </div>
        </div>
    );
}

function App() {
    const initialRoute = parseRouteFromHash();
    const initialSession = readStoredSession();
    const _ssoParam = hasIcsSsoParam();
    // 직접 접속(파라미터 없음)인데 남은 세션이 ICS 임베드 세션이고 이 탭의 마커도 없으면(다른 탭/창닫음/직접접속) 재사용 안 함.
    const _staleIcsDirect = !_ssoParam && storedAuthSource() === 'ics' && !isIcsEmbed();
    // ICS 진입(?userId) 또는 stale-ICS 직접접속이면 저장세션을 신뢰하지 않고 SSO/로그인으로.
    const [ssoRunning, setSsoRunning] = useState(_ssoParam);
    const [isAuthenticated, setIsAuthenticated] = useState(
        _ssoParam || _staleIcsDirect ? false : initialSession.isAuthenticated
    );
    const [sessionExpiresAt, setSessionExpiresAt] = useState(initialSession.expiresAt);
    const [remainingMs, setRemainingMs] = useState(() => {
        if (!initialSession.expiresAt) return 0;
        return Math.max(0, initialSession.expiresAt - Date.now());
    });
    const [activeTab, setActiveTab] = useState(initialRoute.tab);
    const [selectedQaId, setSelectedQaId] = useState(initialRoute.qaId);
    const [calls, setCalls] = useState([]);
    const [isLoading, setIsLoading] = useState(true);
    const [currentUser, setCurrentUser] = useState(() => {
        if (typeof window === 'undefined') return null;
        try {
            const raw = window.localStorage.getItem(QA_ACTOR_STORAGE_KEY);
            return raw ? JSON.parse(raw) : null;
        } catch {
            return null;
        }
    });
    const [brands, setBrands] = useState([]);
    const [selectedBrandId, setSelectedBrandId] = useState(() => {
        if (typeof window === 'undefined') return null;
        const raw = window.localStorage.getItem(QA_ACTIVE_BRAND_KEY);
        return raw ? Number(raw) : null;
    });
    const [profileModalOpen, setProfileModalOpen] = useState(false);

    const clearSession = async () => {
        // 서버에 로그아웃 통보 (test1 샌드박스 계정인 경우 세션 변경분 휘발 처리).
        // 로컬 actor 정보는 클리어 전에 미리 읽어 둔다.
        let actorLoginId = '';
        try {
            const raw = window.localStorage.getItem(QA_ACTOR_STORAGE_KEY);
            if (raw) actorLoginId = String(JSON.parse(raw)?.login_id || '').trim();
        } catch {
            actorLoginId = '';
        }
        if (actorLoginId) {
            try {
                await logoutOnDb(actorLoginId);
            } catch (err) {
                console.error('로그아웃 처리 중 오류:', err);
            }
        }
        setIsAuthenticated(false);
        setSessionExpiresAt(null);
        setRemainingMs(0);
        setCurrentUser(null);
        setBrands([]);
        setSelectedBrandId(null);
        navigateHash(DASHBOARD_HASH);
        window.localStorage.removeItem(AUTH_STORAGE_KEY);
        window.localStorage.removeItem(AUTH_EXPIRES_AT_KEY);
        window.localStorage.removeItem(QA_ACTOR_STORAGE_KEY);
        window.localStorage.removeItem(QA_ACTIVE_BRAND_KEY);
        // 샌드박스 복원 후 calls 목록을 갱신해서 UI를 baseline 상태로 리셋.
        try {
            const data = await fetchCalls();
            setCalls(data);
        } catch (err) {
            console.error('로그아웃 후 데이터 갱신 오류:', err);
        }
    };

    useEffect(() => {
        async function loadCalls() {
            try {
                const data = await fetchCalls();
                setCalls(data);
            } catch (error) {
                console.error("데이터 로딩 오류:", error);
            } finally {
                setIsLoading(false);
            }
        }
        loadCalls();
    }, []);

    useEffect(() => {
        // api.js 가 401 받으면 qa:auth-required 발행 → 로컬 인증 상태 즉시 끊고 로그인 화면 복귀.
        const onAuthRequired = () => {
            setIsAuthenticated(false);
            setSessionExpiresAt(null);
            setRemainingMs(0);
            setCalls([]);
            setCurrentUser(null);
            setBrands([]);
        };
        window.addEventListener('qa:auth-required', onAuthRequired);
        return () => window.removeEventListener('qa:auth-required', onAuthRequired);
    }, []);

    // ICS 메뉴 진입(?userId) → SSO 자동 로그인 / 직접 접속 → 일반 로그인 (05/08 app-shell 동일 게이팅).
    useEffect(() => {
        const params = new URLSearchParams(window.location.search);
        const userId = params.get('userId');

        if (userId) {
            // 기존/만료 세션 잔존 방지 — ICS 신원으로 강제 재인증.
            window.localStorage.removeItem(AUTH_STORAGE_KEY);
            window.localStorage.removeItem(AUTH_EXPIRES_AT_KEY);
            window.localStorage.removeItem(QA_ACTOR_STORAGE_KEY);
            // 식별자를 주소창/히스토리에 남기지 않도록 즉시 제거.
            ['userId', 'userPw', 'authCd', 'authNm'].forEach((k) => params.delete(k));
            const clean = window.location.pathname + (params.toString() ? `?${params}` : '') + (window.location.hash || '');
            window.history.replaceState(null, '', clean);

            (async () => {
                try {
                    const data = await icsSsoLogin(userId);
                    const expiresAt = Date.now() + SESSION_TIMEOUT_MS;
                    const user = { ...data.user, auth_source: 'ics' };
                    window.localStorage.setItem(AUTH_STORAGE_KEY, 'true');
                    window.localStorage.setItem(AUTH_EXPIRES_AT_KEY, String(expiresAt));
                    window.localStorage.setItem(QA_ACTOR_STORAGE_KEY, JSON.stringify(user));
                    markIcsEmbed(); // 이 탭은 새로고침해도 세션 유지, 탭 닫으면 소멸.
                    setCurrentUser(user);
                    setSessionExpiresAt(expiresAt);
                    setRemainingMs(SESSION_TIMEOUT_MS);
                    setIsAuthenticated(true);
                    if (user.org_id) {
                        setSelectedBrandId(user.org_id);
                        window.localStorage.setItem(QA_ACTIVE_BRAND_KEY, String(user.org_id));
                    }
                    try { setCalls(await fetchCalls()); } catch { /* noop */ }
                } catch (err) {
                    console.error('ICS SSO 실패:', err);
                    clearIcsEmbed();
                    setIsAuthenticated(false);
                    setCurrentUser(null);
                } finally {
                    setSsoRunning(false);
                }
            })();
            return;
        }

        // 직접 접속: 남은 세션이 stale ICS 세션이면 비우고 일반 로그인 화면으로.
        if (_staleIcsDirect) {
            clearIcsEmbed();
            window.localStorage.removeItem(AUTH_STORAGE_KEY);
            window.localStorage.removeItem(AUTH_EXPIRES_AT_KEY);
            window.localStorage.removeItem(QA_ACTOR_STORAGE_KEY);
            setCurrentUser(null);
            setIsAuthenticated(false);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // 로그인 후 브랜드 목록 로드 + 활성 브랜드 ID 보정
    useEffect(() => {
        if (!isAuthenticated || !currentUser) return;
        let cancelled = false;
        (async () => {
            // 비-super_admin(관리자/상담사)은 서버가 세션 org 로 데이터를 강제 스코프하므로
            // 활성 브랜드도 본인 소속으로 고정. (잔존 QA_ACTIVE_BRAND_KEY 가 다른 브랜드를
            // 가리키면 "데이터=본인 브랜드, 평가체계 컬럼=다른 브랜드" 불일치가 나던 문제 방지.
            // 상담사는 아래 /api/admin/organizations 가 403 이라 목록 기반 보정도 불가능.)
            const pinned = currentUser.role !== 'super_admin' && currentUser.org_id != null
                ? Number(currentUser.org_id)
                : null;
            let brandSettled = false; // 이 effect 에서 활성 브랜드를 새로 확정했는지 — 확정 시 콜 재조회 필요.
            if (pinned != null && pinned !== selectedBrandId) {
                setSelectedBrandId(pinned);
                window.localStorage.setItem(QA_ACTIVE_BRAND_KEY, String(pinned));
                brandSettled = true;
            }
            try {
                const list = await fetchOrganizations();
                if (cancelled) return;
                setBrands(list);
                if (pinned == null) { // 본인 소속 고정 대상은 목록 기반 보정 생략
                    const validIds = new Set(list.map((b) => b.id));
                    let nextId = selectedBrandId;
                    if (!nextId || !validIds.has(nextId)) {
                        nextId = currentUser.org_id && validIds.has(currentUser.org_id)
                            ? currentUser.org_id
                            : (list[0]?.id ?? null);
                    }
                    if (nextId !== selectedBrandId) {
                        setSelectedBrandId(nextId);
                        if (nextId != null) {
                            window.localStorage.setItem(QA_ACTIVE_BRAND_KEY, String(nextId));
                        } else {
                            window.localStorage.removeItem(QA_ACTIVE_BRAND_KEY);
                        }
                        brandSettled = true;
                    }
                }
            } catch (err) {
                // 상담사(agent)는 조직 목록 API 권한이 없어 여기로 옴 — 고정값(pinned)으로 이미 정합.
                console.error('브랜드 목록 로딩 오류:', err);
            }
            // 활성 브랜드가 이 effect 에서 확정/변경됐으면 콜 목록 재조회 — 로그인 직후 브랜드
            // 미확정 상태로 불러온 전체(전 브랜드) 콜이 화면에 남는 문제 방지(super_admin 포함).
            // (사이드바 수동 전환은 handleBrandChange 가 자체 재조회하므로 여기선 자동 확정 경로만 커버)
            if (!cancelled && brandSettled) {
                try { await refreshCalls(); } catch { /* 실패 시 기존 목록 유지 */ }
            }
        })();
        return () => {
            cancelled = true;
        };
    }, [isAuthenticated, currentUser]);

    useEffect(() => {
        const applyRoute = () => {
            const route = parseRouteFromHash();
            setActiveTab(route.tab);
            setSelectedQaId(route.qaId);
        };

        if (!window.location.hash) {
            window.history.replaceState(null, '', DASHBOARD_HASH);
        }
        applyRoute();
        window.addEventListener('hashchange', applyRoute);
        return () => window.removeEventListener('hashchange', applyRoute);
    }, []);

    // 상세(detail) 진입 시 직전 탭을 기억 — 브레드크럼 부모 / "목록으로" 복귀 대상.
    // (평가 리스트에서 왔으면 dashboard, 상담사 평가관리에서 왔으면 eval-mgmt …)
    const detailOriginRef = useRef('dashboard');
    useEffect(() => {
        if (activeTab !== 'detail') detailOriginRef.current = activeTab;
    }, [activeTab]);
    const detailOrigin = activeTab === 'detail' ? detailOriginRef.current : null;

    useEffect(() => {
        if (!isAuthenticated || !sessionExpiresAt) return;

        const tick = () => {
            const next = sessionExpiresAt - Date.now();
            if (next <= 0) {
                clearSession();
                return;
            }
            setRemainingMs(next);
        };

        tick();
        const timerId = window.setInterval(tick, 1000);
        return () => window.clearInterval(timerId);
    }, [isAuthenticated, sessionExpiresAt]);

    const handleOpenDetail = (qaId) => {
        navigateHash(`#/detail/${encodeURIComponent(qaId)}`);
    };

    const refreshCalls = useCallback(async () => {
        try {
            const data = await fetchCalls();
            setCalls(data);
        } catch (error) {
            console.error('통화 목록 새로고침 오류:', error);
        }
    }, []);

    // 브랜드 추가/수정/활성토글 직후 사이드바 선택기·관리 목록이 새로고침 없이 반영되도록
    // App 의 canonical brands state 를 재로드 (Brands.jsx 로컬 state 와 분리돼 있던 문제 보정).
    const refreshBrands = useCallback(async () => {
        try {
            const data = await fetchOrganizations();
            setBrands(data);
        } catch (error) {
            console.error('브랜드 목록 새로고침 오류:', error);
        }
    }, []);

    const handleBackToDashboard = () => {
        navigateHash(DASHBOARD_HASH);
    };

    const handleLogin = async (id, password) => {
        try {
            const data = await loginWithDb(id, password);
            const expiresAt = Date.now() + SESSION_TIMEOUT_MS;
            setIsAuthenticated(true);
            setSessionExpiresAt(expiresAt);
            setRemainingMs(SESSION_TIMEOUT_MS);
            window.localStorage.setItem(AUTH_STORAGE_KEY, 'true');
            window.localStorage.setItem(AUTH_EXPIRES_AT_KEY, String(expiresAt));
            if (data?.user) {
                const user = { ...data.user, auth_source: 'manual' }; // 직접 로그인 — ICS 세션과 구분.
                clearIcsEmbed();
                window.localStorage.setItem(QA_ACTOR_STORAGE_KEY, JSON.stringify(user));
                setCurrentUser(user);
                if (user.org_id) {
                    setSelectedBrandId(user.org_id);
                    window.localStorage.setItem(QA_ACTIVE_BRAND_KEY, String(user.org_id));
                }
            }
            // 신규 session_token 으로 calls 즉시 재조회 — 마운트 useEffect 는 비로그인 401 로 끝나 있음.
            await refreshCalls();
            return true;
        } catch (error) {
            console.error('로그인 실패:', error);
            return false;
        }
    };

    const handleLogout = async () => {
        await clearSession();
    };

    // 프로필 모달이 저장됐을 때 currentUser 캐시 + localStorage 동기화.
    const handleProfileSaved = (patch) => {
        if (!patch) return;
        setCurrentUser((prev) => (prev ? { ...prev, ...patch } : prev));
        syncStoredActor(patch);
    };

    // 첫 로그인 시 must_change_password=true 면 ProfileModal 을 강제 노출.
    // ICS 세션은 비번 개념이 없으므로 강제 변경 팝업을 띄우지 않는다.
    const forceChangePassword = currentUser?.auth_source !== 'ics' && Boolean(currentUser?.must_change_password);

    const handleSidebarTabClick = (tab) => {
        if (tab === 'dashboard') navigateHash(DASHBOARD_HASH);
        else if (tab === 'brands') navigateHash(BRANDS_HASH);
        else if (tab === 'users') navigateHash(USERS_HASH);
        else if (tab === 'logs') navigateHash(LOGS_HASH);
        else if (tab === 'notifications') navigateHash(NOTIFICATIONS_HASH);
        else if (tab === 'eval-items') navigateHash(EVAL_ITEMS_HASH);
        else if (tab === 'stats') navigateHash(STATS_HASH);
        else if (tab === 'eval-mgmt') navigateHash(EVAL_MGMT_HASH);
        else if (tab === 'admin-batch') navigateHash(BATCH_HASH);
        else if (tab === 'skill-prompts') navigateHash(SKILL_PROMPTS_HASH);
    };

    // 상세에서 "목록으로" / 브레드크럼 부모 클릭 → 진입했던 탭으로 복귀(없으면 평가 리스트).
    const handleBackFromDetail = () => handleSidebarTabClick(detailOriginRef.current || 'dashboard');

    const handleBrandChange = useCallback(
        async (brandId) => {
            if (brandId === selectedBrandId) return;
            setSelectedBrandId(brandId);
            window.localStorage.setItem(QA_ACTIVE_BRAND_KEY, String(brandId));
            // 상세 탭에 머무른 채 브랜드를 바꾸면 다른 브랜드의 qa_id 를 그대로 들고 가게 됨 → Dashboard 로 복귀.
            if (activeTab === 'detail') {
                navigateHash(DASHBOARD_HASH);
            }
            await refreshCalls();
        },
        [selectedBrandId, refreshCalls, activeTab],
    );

    // ICS SSO 처리 중 — 앱/로그인 화면 대신 로더(스테일 세션 깜빡임 방지, 05/08 동일).
    if (ssoRunning) {
        return (
            <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#667085', fontSize: 14 }}>
                로그인 중…
            </div>
        );
    }

    if (!isAuthenticated) {
        return <LoginScreen onLogin={handleLogin} />;
    }

    return (
        <div className="app-shell">
            <Nav
                onHomeClick={handleBackToDashboard}
                onLogout={currentUser?.auth_source === 'ics' ? undefined : handleLogout}
                onProfileClick={() => setProfileModalOpen(true)}
                remainingMs={remainingMs}
                isDev={process.env.NODE_ENV !== 'production' || Boolean(process.env.NEXT_PUBLIC_DEV_BADGE)}
                user={currentUser}
                activeTab={activeTab}
                detailOrigin={detailOrigin}
                onNavTab={handleSidebarTabClick}
                onSampleUploaded={refreshCalls}
            />
            <div className="app-shell-body">
                <Sidebar
                    activeTab={activeTab}
                    role={currentUser?.role}
                    brands={brands}
                    selectedBrandId={selectedBrandId}
                    onBrandChange={handleBrandChange}
                    onTabClick={handleSidebarTabClick}
                />
                <main className="app-shell-main">
                {/* key 에 활성 브랜드 포함 — 브랜드 전환 시 현재 탭 전체 리마운트로 자체 fetch 뷰
                    (상담사 평가관리·배치·사용자 등)도 새 브랜드 데이터로 즉시 재조회. 이전 브랜드의
                    필터/선택 상태가 남지 않는 효과 겸함. (새로고침해야 반영되던 문제 fix) */}
                <PageContainer key={`${activeTab}:${selectedBrandId ?? 'all'}`}>
                {activeTab === 'dashboard' && (
                    <Dashboard
                        calls={calls}
                        isLoading={isLoading}
                        onOpenDetail={handleOpenDetail}
                        activeBrandId={selectedBrandId}
                    />
                )}
                {activeTab === 'detail' && (
                    <Detail
                        qaId={selectedQaId}
                        onBack={handleBackFromDetail}
                        calls={calls}
                        onEvaluationsSaved={refreshCalls}
                        activeBrandId={selectedBrandId}
                        role={currentUser?.role}
                    />
                )}
                {activeTab === 'eval-mgmt' && <EvalMgmt role={currentUser?.role} />}
                {activeTab === 'brands' && currentUser?.role === 'super_admin' && <Brands onBrandsChanged={refreshBrands} />}
                {activeTab === 'brands' && currentUser?.role !== 'super_admin' && (
                    <div className="bg-white border border-[#E4E7EC] rounded-xl p-8 text-center">
                        <p className="text-sm text-[#667085]">super_admin 권한이 필요합니다.</p>
                    </div>
                )}
                {activeTab === 'users' && (currentUser?.role === 'admin' || currentUser?.role === 'super_admin') && (
                    <Users
                        role={currentUser?.role}
                        currentUserId={currentUser?.user_id}
                        activeBrandId={selectedBrandId}
                    />
                )}
                {activeTab === 'users' && !(currentUser?.role === 'admin' || currentUser?.role === 'super_admin') && (
                    <div className="bg-white border border-[#E4E7EC] rounded-xl p-8 text-center">
                        <p className="text-sm text-[#667085]">admin 권한이 필요합니다.</p>
                    </div>
                )}
                {activeTab === 'logs' && currentUser?.role === 'super_admin' && <Logs />}
                {activeTab === 'logs' && currentUser?.role !== 'super_admin' && (
                    <div className="bg-white border border-[#E4E7EC] rounded-xl p-8 text-center">
                        <p className="text-sm text-[#667085]">super_admin 권한이 필요합니다.</p>
                    </div>
                )}
                {activeTab === 'notifications' && (currentUser?.role === 'admin' || currentUser?.role === 'super_admin') && (
                    <Notifications />
                )}
                {activeTab === 'notifications' && !(currentUser?.role === 'admin' || currentUser?.role === 'super_admin') && (
                    <div className="bg-white border border-[#E4E7EC] rounded-xl p-8 text-center">
                        <p className="text-sm text-[#667085]">admin 권한이 필요합니다.</p>
                    </div>
                )}
                {activeTab === 'eval-items' && (currentUser?.role === 'admin' || currentUser?.role === 'super_admin') && (
                    <EvalItemsHub activeBrandId={selectedBrandId} />
                )}
                {activeTab === 'eval-items' && !(currentUser?.role === 'admin' || currentUser?.role === 'super_admin') && (
                    <div className="bg-white border border-[#E4E7EC] rounded-xl p-8 text-center">
                        <p className="text-sm text-[#667085]">admin 권한이 필요합니다.</p>
                    </div>
                )}
                {activeTab === 'admin-batch' && (currentUser?.role === 'admin' || currentUser?.role === 'super_admin') && (
                    <div className="w-full"><div className="tg-eval"><BatchManage role={currentUser?.role} /></div></div>
                )}
                {activeTab === 'admin-batch' && !(currentUser?.role === 'admin' || currentUser?.role === 'super_admin') && (
                    <div className="bg-white border border-[#E4E7EC] rounded-xl p-8 text-center">
                        <p className="text-sm text-[#667085]">admin 권한이 필요합니다.</p>
                    </div>
                )}
                {activeTab === 'skill-prompts' && (currentUser?.role === 'admin' || currentUser?.role === 'super_admin') && (
                    <div className="w-full"><div className="tg-eval"><SkillPromptManage /></div></div>
                )}
                {activeTab === 'skill-prompts' && !(currentUser?.role === 'admin' || currentUser?.role === 'super_admin') && (
                    <div className="bg-white border border-[#E4E7EC] rounded-xl p-8 text-center">
                        <p className="text-sm text-[#667085]">admin 권한이 필요합니다.</p>
                    </div>
                )}
                {activeTab === 'stats' && (currentUser?.role === 'admin' || currentUser?.role === 'super_admin') && (
                    <Stats activeBrandId={selectedBrandId} role={currentUser?.role} />
                )}
                {activeTab === 'stats' && !(currentUser?.role === 'admin' || currentUser?.role === 'super_admin') && (
                    <div className="bg-white border border-[#E4E7EC] rounded-xl p-8 text-center">
                        <p className="text-sm text-[#667085]">admin 권한이 필요합니다.</p>
                    </div>
                )}
                </PageContainer>
                </main>
            </div>
            {(profileModalOpen || forceChangePassword) && currentUser && (
                <ProfileModal
                    currentUser={currentUser}
                    forceChange={forceChangePassword}
                    onClose={() => setProfileModalOpen(false)}
                    onSaved={handleProfileSaved}
                />
            )}
        </div>
    );
}

export default App;
