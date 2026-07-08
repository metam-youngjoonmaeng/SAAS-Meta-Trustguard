// 설정 허브 (SettingsHub) — 운영·계정 설정을 한 곳에서. 카드 그리드(그룹: 운영/관리자/시스템/계정),
// 운영 그룹에 배치 관리(이동) + KSQI(토글) 동거, 타일 클릭 시 하위 화면 진입(뒤로가기). 알림·배치는 실제 뷰(Notifications/BatchManage) 재사용,
// 프로필·알림설정·보안·정보는 mock(백엔드 연동 전). 시안: etc/pages-shared.jsx SettingsPage 이식.
import React, { useState, useEffect } from 'react';
import { Icon, PageHead, Avatar } from './evalMgmt/ui';
import BatchManage from './evalMgmt/BatchManage';
import Users from './Users';
import Brands from './Brands';
import Logs from './Logs';
import { fetchNotificationPrefs, updateNotificationPrefs } from '../services/api';

const ROLE_LABEL = { super_admin: '슈퍼관리자', admin: '관리자', agent: '상담사' };

// 작은 스위치 — KSQI 카드와 동일 마크업(.ks-switch/.ks-knob) 재사용.
function Toggle({ checked, onChange }) {
    return (
        <button
            type="button"
            role="switch"
            aria-checked={checked}
            onClick={() => onChange(!checked)}
            className={`ks-switch ${checked ? 'on' : ''}`}
        >
            <span className="ks-knob" />
        </button>
    );
}

function SettingRow({ label, desc, children }) {
    return (
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div style={{ flex: 1 }}>
                <div style={{ fontSize: 13.5, fontWeight: 600 }}>{label}</div>
                <div className="muted-text" style={{ fontSize: 11.5, marginTop: 2 }}>{desc}</div>
            </div>
            {children}
        </div>
    );
}

// 초록 상태 배지(연결됨/현재/활성) — .pill 변형 의존 없이 인라인.
function GreenPill({ children }) {
    return (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 10.5, fontWeight: 700, color: '#067647', background: '#ECFDF3', border: '1px solid #ABEFC6', padding: '2px 8px', borderRadius: 9999, whiteSpace: 'nowrap' }}>
            <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#12B76A', display: 'inline-block' }} />
            {children}
        </span>
    );
}

export default function Settings({ role = 'agent', user, initialSection = null, onSectionChange, currentUserId, activeBrandId, onBrandsChanged }) {
    // 하위화면(section)은 해시로 딥링크. App 이 initialSection 으로 주입하고, 변경 시 onSectionChange 로 해시 갱신.
    const [section, setSection] = useState(initialSection || null);
    useEffect(() => { setSection(initialSection || null); }, [initialSection]);
    const go = (key) => { const k = key || null; setSection(k); if (onSectionChange) onSectionChange(k); };
    const isAdmin = role === 'admin' || role === 'super_admin';
    const u = user || {};
    const roleLabel = ROLE_LABEL[role] || '사용자';
    const org = u.org || u.brand_name || u.brandName || '메타엠';

    const [ksqi, setKsqi] = useState(() => {
        try { return localStorage.getItem('ksqi_enabled') === '1'; } catch { return false; }
    });
    const toggleKsqi = () => {
        const next = !ksqi;
        setKsqi(next);
        try { localStorage.setItem('ksqi_enabled', next ? '1' : '0'); } catch { /* noop */ }
        try { window.dispatchEvent(new Event('ksqi-change')); } catch { /* noop */ }
    };

    // 허브 카드(그룹별)
    const GROUPS = [
        {
            title: '운영', show: isAdmin, items: [
                { key: 'batch', icon: 'filter', label: 'AI 평가 배치 관리', desc: '조건별 평가 대상 필터링·스케줄', accent: 'primary' },
                // KSQI 는 이동(navigate) 대신 토글 카드 — 운영 그룹에 함께 노출(별도 '평가 기능' 그룹 폐지).
                { key: 'ksqi', type: 'toggle', icon: 'award', label: 'KSQI 평가', desc: '평가 리스트에 KSQI 리스트 활성화', accent: 'primary' },
            ],
        },
        {
            title: '관리자', show: isAdmin, items: [
                { key: 'users', icon: 'users', label: '사용자 관리', desc: '상담사·관리자 계정 · 권한', accent: 'primary' },
                ...(role === 'super_admin'
                    ? [{ key: 'brands', icon: 'building-2', label: '브랜드 관리', desc: '브랜드·도메인·평가 콘텐츠', accent: 'primary' }]
                    : []),
            ],
        },
        {
            // 실시간 로그 — 사이드바 최상위 탭에서 시스템 설정 하위로 이동(super_admin 전용).
            title: '시스템', show: role === 'super_admin', items: [
                { key: 'logs', icon: 'terminal', label: '실시간 로그', desc: '사용자 활동·백엔드(RAG·스킬)·서버 로그 실시간 관측', accent: 'primary' },
            ],
        },
        {
            title: '계정', show: true, items: [
                { key: 'profile', icon: 'user', label: '프로필', desc: '이름·연락처·프로필 사진', accent: 'ink' },
                { key: 'notify', icon: 'bell-ring', label: '알림 설정', desc: '유형별 알림 수신 켜기/끄기', accent: 'ink' },
                { key: 'security', icon: 'lock', label: '보안', desc: '비밀번호·2단계 인증·세션', accent: 'ink' },
                { key: 'about', icon: 'info', label: '정보·약관', desc: '버전·이용약관·개인정보처리', accent: 'ink' },
            ],
        },
    ];

    const SECTION_META = {
        batch: { label: 'AI 평가 배치 관리', icon: 'filter' },
        users: { label: '사용자 관리', icon: 'users' },
        brands: { label: '브랜드 관리', icon: 'building-2' },
        logs: { label: '실시간 로그', icon: 'terminal' },
        profile: { label: '프로필', icon: 'user' },
        notify: { label: '알림 설정', icon: 'bell-ring' },
        security: { label: '보안', icon: 'lock' },
        about: { label: '정보·약관', icon: 'info' },
    };

    // 하위 화면
    if (section) {
        const meta = SECTION_META[section] || {};
        // 자체 헤더 보유 뷰(배치·사용자·브랜드·실시간 로그)는 settings-section-head 생략.
        const selfTitled = section === 'batch' || section === 'users' || section === 'brands' || section === 'logs';
        const NoPerm = ({ need }) => (
            <div className="panel" style={{ padding: 32, textAlign: 'center' }}>
                <p className="muted-text">{need} 권한이 필요합니다.</p>
            </div>
        );
        return (
            <div>
                <button className="settings-back" onClick={() => go(null)}>
                    <Icon name="chevron-left" size={15} />시스템 설정
                </button>
                {!selfTitled && (
                    <div className="settings-section-head">
                        <div className="settings-section-icon"><Icon name={meta.icon} size={17} /></div>
                        <h2>{meta.label}</h2>
                    </div>
                )}

                {section === 'batch' && <BatchManage role={role} />}
                {section === 'users' && (isAdmin
                    ? <Users role={role} currentUserId={currentUserId} activeBrandId={activeBrandId} />
                    : <NoPerm need="관리자" />)}
                {section === 'brands' && (role === 'super_admin'
                    ? <Brands onBrandsChanged={onBrandsChanged} />
                    : <NoPerm need="슈퍼관리자" />)}
                {section === 'logs' && (role === 'super_admin'
                    ? <Logs />
                    : <NoPerm need="슈퍼관리자" />)}
                {section === 'profile' && <SettingsProfile roleLabel={roleLabel} org={org} user={u} />}
                {section === 'notify' && <SettingsNotify />}
                {section === 'security' && <SettingsSecurity />}
                {section === 'about' && <SettingsAbout />}
            </div>
        );
    }

    // 허브 랜딩
    return (
        <div>
            <PageHead title="시스템 설정" sub="운영·계정과 관련된 설정을 한 곳에서 관리합니다." />

            <div className="settings-hub">
                {GROUPS.filter((g) => g.show).map((g) => (
                    <div key={g.title} className="settings-hub-group">
                        <div className="settings-hub-group-title">{g.title}</div>
                        <div className="settings-hub-grid">
                            {g.items.map((it) => (
                                it.type === 'toggle' ? (
                                    // 토글 카드(KSQI) — 이동 대신 즉시 on/off. 이동 타일과 같은 그리드에 나란히.
                                    <div key={it.key} className="settings-toggle-card">
                                        <span className="settings-tile-icon accent-primary-icon"><Icon name={it.icon} size={20} /></span>
                                        <span className="settings-tile-body">
                                            <span className="settings-tile-label">{it.label}</span>
                                            <span className="settings-tile-desc">{it.desc}</span>
                                        </span>
                                        <button type="button" role="switch" aria-checked={ksqi} onClick={toggleKsqi} className={`ks-switch ${ksqi ? 'on' : ''}`}>
                                            <span className="ks-knob" />
                                        </button>
                                    </div>
                                ) : (
                                    <button key={it.key} className={`settings-tile accent-${it.accent}`} onClick={() => go(it.key)}>
                                        <span className="settings-tile-icon">
                                            <Icon name={it.icon} size={20} />
                                            {it.badge != null && <span className="settings-tile-badge">{it.badge}</span>}
                                        </span>
                                        <span className="settings-tile-body">
                                            <span className="settings-tile-label">{it.label}</span>
                                            <span className="settings-tile-desc">{it.desc}</span>
                                        </span>
                                        <Icon name="chevron-right" size={16} className="settings-tile-arrow" />
                                    </button>
                                )
                            ))}
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
}

// ── 하위: 프로필(mock) ──
function SettingsProfile({ roleLabel, org, user }) {
    const [name, setName] = useState(user.name || '홍길동');
    const [email, setEmail] = useState(user.email || 'user@metam.co.kr');
    const [phone, setPhone] = useState('010-2849-1284');
    const [bio, setBio] = useState('콜센터 QA · 평가 운영 담당');

    return (
        <div className="grid grid-stat-l" style={{ alignItems: 'start' }}>
            <div className="col-flex">
                <div className="panel">
                    <div className="panel-head"><h3>기본 정보</h3></div>
                    <div className="panel-body" style={{ display: 'grid', gap: 16 }}>
                        <div className="grid grid-2" style={{ gap: 14 }}>
                            <div className="field">
                                <span className="field-label">이름</span>
                                <input className="text-input" value={name} onChange={(e) => setName(e.target.value)} />
                            </div>
                            <div className="field">
                                <span className="field-label">이메일</span>
                                <input className="text-input" value={email} onChange={(e) => setEmail(e.target.value)} />
                            </div>
                        </div>
                        <div className="grid grid-2" style={{ gap: 14 }}>
                            <div className="field">
                                <span className="field-label">전화번호</span>
                                <input className="text-input" value={phone} onChange={(e) => setPhone(e.target.value)} />
                            </div>
                            <div className="field">
                                <span className="field-label">소속</span>
                                <input className="text-input" value={org} disabled />
                            </div>
                        </div>
                        <div className="field">
                            <span className="field-label">자기 소개</span>
                            <textarea className="textarea" rows="3" value={bio} onChange={(e) => setBio(e.target.value)} />
                        </div>
                    </div>
                </div>

                <div className="panel">
                    <div className="panel-head"><h3>환경 설정</h3></div>
                    <div className="panel-body" style={{ display: 'grid', gap: 14 }}>
                        <SettingRow label="언어" desc="UI 및 알림 메시지 언어">
                            <select className="text-input" style={{ width: 200, height: 36 }} defaultValue="ko">
                                <option value="ko">한국어</option>
                                <option value="en">English</option>
                            </select>
                        </SettingRow>
                        <SettingRow label="시간대" desc="평가 일시·통계 기준">
                            <select className="text-input" style={{ width: 200, height: 36 }} defaultValue="kst">
                                <option value="kst">한국 표준시 (UTC+9)</option>
                                <option value="utc">UTC</option>
                            </select>
                        </SettingRow>
                        <SettingRow label="시작 페이지" desc="로그인 직후 표시할 화면">
                            <select className="text-input" style={{ width: 200, height: 36 }} defaultValue="dashboard">
                                <option value="dashboard">평가 리스트</option>
                                <option value="eval-mgmt">상담사 QA관리</option>
                                <option value="stats">전체 통계</option>
                            </select>
                        </SettingRow>
                    </div>
                </div>
            </div>

            <div className="col-flex">
                <div className="panel">
                    <div className="panel-head"><h3>프로필</h3></div>
                    <div className="panel-body" style={{ display: 'flex', alignItems: 'center', gap: 18 }}>
                        <Avatar id="settings-me" name={name} size="lg" />
                        <div className="muted-text" style={{ fontSize: 12 }}>프로필 이미지는 이름 이니셜로 자동 표시됩니다.</div>
                    </div>
                </div>

                <div className="panel">
                    <div className="panel-head"><h3>계정 요약</h3></div>
                    <div className="panel-body" style={{ display: 'grid', gap: 12 }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}>
                            <span className="muted-text">역할</span>
                            <span style={{ fontWeight: 600 }}>{roleLabel}</span>
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}>
                            <span className="muted-text">가입일</span>
                            <span className="mono">2025-01-12</span>
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}>
                            <span className="muted-text">마지막 로그인</span>
                            <span className="mono">2026-05-26 09:21</span>
                        </div>
                        <div className="divider" />
                        <button className="btn-mini" style={{ color: 'var(--destructive)', borderColor: '#fecaca' }}>
                            <Icon name="log-out" />로그아웃
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}

// ── 하위: 알림 설정(mock) ──
// 알림 수신 유형 — 서버 발행 type(server/index.js createNotification) 과 1:1 매핑. 그룹 토글은 묶인 유형 전체 on/off.
const NOTIFY_GROUPS = [
    {
        key: 'review',
        label: '평가 검수·확정 알림',
        desc: '내 평가의 검수 결과·최종 확정·강제 확정·재이의',
        types: ['review_revised', 'review_approved', 'review_edited', 'review_acknowledged', 'review_reobjected'],
    },
    {
        key: 'coaching',
        label: '코칭 알림',
        desc: '코칭 배정·완료 알림',
        types: ['coaching_assigned', 'coaching_completed'],
    },
];

// 알림 수신 on/off — 실연동(GET/PUT /api/notifications/prefs). prefs={ "<type>": false } (미기재=수신 on).
function SettingsNotify() {
    const [prefs, setPrefs] = useState(null); // null=로딩
    const [saving, setSaving] = useState(false);

    useEffect(() => {
        let alive = true;
        fetchNotificationPrefs()
            .then((r) => { if (alive) setPrefs(r?.prefs || {}); })
            .catch(() => { if (alive) setPrefs({}); });
        return () => { alive = false; };
    }, []);

    const isOn = (g) => g.types.some((t) => (prefs || {})[t] !== false);

    const toggleGroup = async (g) => {
        if (!prefs) return;
        const next = !isOn(g);
        const updated = { ...prefs };
        g.types.forEach((t) => { updated[t] = next; });
        const prev = prefs;
        setPrefs(updated); // 낙관적 반영
        setSaving(true);
        try {
            await updateNotificationPrefs(updated);
        } catch (e) {
            setPrefs(prev); // 실패 롤백
            alert('알림 설정 저장에 실패했어요. 다시 시도해 주세요.');
        } finally {
            setSaving(false);
        }
    };

    return (
        <div className="panel">
            <div className="panel-head">
                <h3>알림 수신</h3>
                <div className="sub" style={{ marginLeft: 12 }}>받을 알림 유형을 켜고 끕니다</div>
                {saving && <span className="muted-text" style={{ marginLeft: 'auto', fontSize: 11.5 }}>저장 중…</span>}
            </div>
            <div className="panel-body" style={{ display: 'grid', gap: 0 }}>
                {prefs === null ? (
                    <div className="muted-text" style={{ fontSize: 12.5, padding: '8px 2px' }}>불러오는 중…</div>
                ) : (
                    NOTIFY_GROUPS.map((g, i) => (
                        <div key={g.key} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '14px 2px', borderTop: i > 0 ? '1px solid var(--border)' : 'none' }}>
                            <div style={{ flex: 1 }}>
                                <div style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--ink-900)' }}>{g.label}</div>
                                <div className="muted-text" style={{ fontSize: 11.5, marginTop: 2 }}>{g.desc}</div>
                            </div>
                            <Toggle checked={isOn(g)} onChange={() => toggleGroup(g)} />
                        </div>
                    ))
                )}
                <div className="muted-text" style={{ fontSize: 11.5, lineHeight: 1.5, marginTop: 12 }}>
                    끈 유형은 상단 알림센터(벨)에도 새로 쌓이지 않습니다. 이메일·푸시 등 외부 채널 발송은 준비 중이에요.
                </div>
            </div>
        </div>
    );
}

// ── 하위: 보안(mock) ──
function SettingsSecurity() {
    const [twoFA, setTwoFA] = useState(true);
    const sessions = [
        { device: 'MacBook Pro · Chrome', loc: '서울 · 강남', when: '지금 활성', current: true },
        { device: 'iPhone 15 · Safari', loc: '서울 · 강남', when: '2시간 전' },
        { device: 'Windows · Edge', loc: '서울 · 송파', when: '어제 17:20' },
    ];

    return (
        <div className="grid grid-stat-l" style={{ alignItems: 'start' }}>
            <div className="col-flex">
                <div className="panel">
                    <div className="panel-head"><h3>비밀번호</h3></div>
                    <div className="panel-body" style={{ display: 'grid', gap: 12, maxWidth: 480 }}>
                        <div className="field">
                            <span className="field-label">현재 비밀번호</span>
                            <input type="password" className="text-input" placeholder="••••••••" />
                        </div>
                        <div className="field">
                            <span className="field-label">새 비밀번호</span>
                            <input type="password" className="text-input" />
                            <span className="field-hint">최소 10자 · 대소문자·숫자·특수문자 포함</span>
                        </div>
                        <div className="field">
                            <span className="field-label">새 비밀번호 확인</span>
                            <input type="password" className="text-input" />
                        </div>
                        <button className="btn-mini primary" style={{ alignSelf: 'flex-start', marginTop: 4 }}>
                            <Icon name="key-round" />비밀번호 변경
                        </button>
                    </div>
                </div>

                <div className="panel">
                    <div className="panel-head"><h3>활성 세션</h3></div>
                    <div className="panel-body" style={{ display: 'grid', gap: 8 }}>
                        {sessions.map((s, i) => (
                            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 14px', border: '1px solid var(--border)', borderRadius: 10 }}>
                                <div style={{ width: 36, height: 36, borderRadius: 9, background: s.current ? 'var(--primary-soft)' : 'var(--muted)', color: s.current ? 'var(--primary)' : 'var(--ink-500)', display: 'grid', placeItems: 'center' }}>
                                    <Icon name={/iPhone/.test(s.device) ? 'smartphone' : 'monitor'} size={15} />
                                </div>
                                <div style={{ flex: 1 }}>
                                    <div style={{ fontSize: 13, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 6 }}>
                                        {s.device} {s.current && <GreenPill>현재</GreenPill>}
                                    </div>
                                    <div className="muted-text" style={{ fontSize: 11.5, marginTop: 2 }}>{s.loc} · {s.when}</div>
                                </div>
                                {!s.current && <button className="btn-mini">종료</button>}
                            </div>
                        ))}
                        <button className="btn-mini" style={{ color: 'var(--destructive)', borderColor: '#fecaca', alignSelf: 'flex-start', marginTop: 4 }}>
                            <Icon name="log-out" />모든 다른 기기 로그아웃
                        </button>
                    </div>
                </div>
            </div>

            <div className="col-flex">
                <div className="panel">
                    <div className="panel-head"><h3>2단계 인증</h3></div>
                    <div className="panel-body">
                        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
                            <div style={{ width: 40, height: 40, borderRadius: 10, background: twoFA ? '#e8f6ed' : 'var(--muted)', color: twoFA ? '#2f9759' : 'var(--ink-500)', display: 'grid', placeItems: 'center' }}>
                                <Icon name="shield-check" size={18} />
                            </div>
                            <div style={{ flex: 1 }}>
                                <div style={{ fontSize: 13.5, fontWeight: 700 }}>2단계 인증</div>
                                <div className="muted-text" style={{ fontSize: 11.5 }}>OTP 앱 (Authy)</div>
                            </div>
                            <Toggle checked={twoFA} onChange={setTwoFA} />
                        </div>
                        <div className="muted-text" style={{ fontSize: 12, lineHeight: 1.5 }}>
                            로그인 시 OTP 코드를 추가로 입력합니다. 백업 코드를 다운로드하여 안전한 곳에 보관하세요.
                        </div>
                        <button className="btn-mini" style={{ marginTop: 12 }}><Icon name="download" />백업 코드 다운로드</button>
                    </div>
                </div>

                <div className="panel">
                    <div className="panel-head"><h3>API 토큰</h3></div>
                    <div className="panel-body">
                        <div className="muted-text" style={{ fontSize: 12, marginBottom: 12, lineHeight: 1.55 }}>
                            외부 시스템 연동을 위한 API 토큰을 발급·관리합니다.
                        </div>
                        <div style={{ display: 'grid', gap: 6 }}>
                            <div style={{ padding: '10px 12px', border: '1px solid var(--border)', borderRadius: 8, display: 'flex', alignItems: 'center', gap: 8 }}>
                                <Icon name="key" size={13} style={{ color: 'var(--ink-400)' }} />
                                <span className="mono" style={{ fontSize: 11.5 }}>mtm_••••••••8421</span>
                                <span style={{ marginLeft: 'auto' }}><GreenPill>활성</GreenPill></span>
                            </div>
                        </div>
                        <button className="btn-mini primary" style={{ marginTop: 12 }}><Icon name="plus" />새 토큰 발급</button>
                    </div>
                </div>
            </div>
        </div>
    );
}

// ── 하위: 정보·약관(mock) ──
function SettingsAbout() {
    const policies = [
        { ico: 'file-text', label: '서비스 이용약관', meta: '2026.04.01 개정' },
        { ico: 'shield-check', label: '개인정보 처리방침', meta: '2026.04.01 개정' },
        { ico: 'lock', label: '데이터 처리 정책 (DPA)', meta: '2025.11.20' },
        { ico: 'cookie', label: '쿠키 정책', meta: '2025.09.10' },
    ];
    const oss = [
        ['React 18.3', 'MIT'], ['Next.js 15', 'MIT'], ['Tailwind CSS v4', 'MIT'],
        ['Pretendard Variable', 'OFL'], ['Lucide Icons', 'ISC'], ['FastAPI · SQLModel', 'MIT'],
    ];

    return (
        <div className="grid grid-stat-l" style={{ alignItems: 'start' }}>
            <div className="col-flex">
                <div className="panel">
                    <div className="panel-head"><h3>제품 정보</h3></div>
                    <div className="panel-body" style={{ display: 'grid', gap: 14 }}>
                        <div>
                            <div style={{ fontSize: 16, fontWeight: 800, color: 'var(--ink-900)' }}>Meta Trustguard</div>
                            <div className="muted-text mono" style={{ fontSize: 11.5, marginTop: 2 }}>버전 2.4.1 · 2026.05.22 빌드</div>
                        </div>
                        <div className="divider" />
                        <div style={{ display: 'grid', gap: 8, fontSize: 13 }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                                <span className="muted-text">개발사</span><span style={{ fontWeight: 600 }}>메타엠(주)</span>
                            </div>
                            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                                <span className="muted-text">사업자등록번호</span><span className="mono">123-45-67890</span>
                            </div>
                            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                                <span className="muted-text">고객지원</span><span className="mono">support@metam.co.kr</span>
                            </div>
                        </div>
                    </div>
                </div>

                <div className="panel">
                    <div className="panel-head"><h3>약관 및 정책</h3></div>
                    <div>
                        {policies.map((it) => (
                            <div key={it.label} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 20px', borderBottom: '1px solid var(--border)', cursor: 'pointer' }}>
                                <Icon name={it.ico} size={14} style={{ color: 'var(--ink-400)' }} />
                                <span style={{ fontSize: 13, fontWeight: 600, flex: 1 }}>{it.label}</span>
                                <span className="muted-text" style={{ fontSize: 11.5 }}>{it.meta}</span>
                                <Icon name="external-link" size={12} style={{ color: 'var(--ink-400)' }} />
                            </div>
                        ))}
                    </div>
                </div>
            </div>

            <div className="panel">
                <div className="panel-head"><h3>오픈소스 및 크레딧</h3></div>
                <div className="panel-body">
                    <div className="muted-text" style={{ fontSize: 12, lineHeight: 1.6, marginBottom: 14 }}>
                        Meta Trustguard는 다음 오픈소스 프로젝트를 사용합니다.
                    </div>
                    <div style={{ display: 'grid', gap: 6 }}>
                        {oss.map(([name, license]) => (
                            <div key={name} style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderBottom: '1px dashed var(--border)', fontSize: 12.5 }}>
                                <span style={{ color: 'var(--ink-700)' }}>{name}</span>
                                <span className="mono muted-text">{license}</span>
                            </div>
                        ))}
                    </div>
                </div>
            </div>
        </div>
    );
}
