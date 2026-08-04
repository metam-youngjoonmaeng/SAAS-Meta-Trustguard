// 설정 허브 (SettingsHub) — 운영·계정 설정을 한 곳에서. 카드 그리드(그룹: 운영/관리자/시스템/계정),
// 운영 그룹에 배치 관리(이동) + KSQI(토글) 동거, 타일 클릭 시 하위 화면 진입(뒤로가기). 알림·배치는 실제 뷰(Notifications/BatchManage) 재사용,
// 프로필·알림설정·보안·정보는 mock(백엔드 연동 전). 시안: etc/pages-shared.jsx SettingsPage 이식.
import React, { useState, useEffect } from 'react';
import { Icon, PageHead } from './evalMgmt/ui';
import BatchManage from './evalMgmt/BatchManage';
import Users from './Users';
import Brands from './Brands';
import Logs from './Logs';
import { fetchNotificationPrefs, updateNotificationPrefs, updateMe, fetchMe, updateBrand, PASSWORD_POLICY_HINT, PASSWORD_POLICY_RE } from '../services/api';

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

export default function Settings({ role = 'agent', user, initialSection = null, onSectionChange, currentUserId, activeBrandId, activeBrandKsqiEnabled = false, onBrandsChanged }) {
    // 하위화면(section)은 해시로 딥링크. App 이 initialSection 으로 주입하고, 변경 시 onSectionChange 로 해시 갱신.
    const [section, setSection] = useState(initialSection || null);
    useEffect(() => { setSection(initialSection || null); }, [initialSection]);
    const go = (key) => { const k = key || null; setSection(k); if (onSectionChange) onSectionChange(k); };
    const isAdmin = role === 'admin' || role === 'super_admin';
    const isSuper = role === 'super_admin';
    const u = user || {};
    const roleLabel = ROLE_LABEL[role] || '사용자';
    const org = u.org || u.brand_name || u.brandName || '메타엠';

    // KSQI 토글 — 선택 브랜드(activeBrandId)의 ksqi_stt_enabled. 켜면 그 브랜드 평가 시 KSQI 노드
    // 병렬 실행 + 'KSQI 관리' 탭 노출(App 이 selectedBrand.ksqi_stt_enabled 로 게이트). super_admin 전용.
    const [ksqi, setKsqi] = useState(Boolean(activeBrandKsqiEnabled));
    const [ksqiSaving, setKsqiSaving] = useState(false);
    useEffect(() => { setKsqi(Boolean(activeBrandKsqiEnabled)); }, [activeBrandKsqiEnabled, activeBrandId]);
    const toggleKsqi = async () => {
        if (!activeBrandId || ksqiSaving) return;
        const next = !ksqi;
        setKsqi(next); // 낙관적 반영
        setKsqiSaving(true);
        try {
            await updateBrand(activeBrandId, { ksqi_stt_enabled: next });
            if (onBrandsChanged) await onBrandsChanged(); // App.brands 재조회 → 탭 게이트·토글 값 동기
        } catch (e) {
            setKsqi(!next); // 실패 롤백
            alert('KSQI 토글 저장에 실패했습니다. 슈퍼관리자 권한·브랜드 선택을 확인해 주세요.');
        } finally {
            setKsqiSaving(false);
        }
    };

    // 허브 카드(그룹별)
    const GROUPS = [
        {
            title: '운영', show: isAdmin, items: [
                { key: 'batch', icon: 'filter', label: 'AI 평가 배치 관리', desc: '조건별 평가 대상 필터링·스케줄', accent: 'primary' },
                // KSQI 토글 — 선택 브랜드의 KSQI on/off(super_admin). 저장 위치는 trustguard.tenant_settings.
                //   켜면 'KSQI 관리/평가' 탭이 열린다. 평가 파이프라인이 이 값을 읽어 KSQI 노드를 실행하는
                //   연동은 미구현(qaPipelineIngest.getOrgKsqiSttEnabled 가 false 고정) — 기준정의 준비 후 붙일 단계다.
                ...(isSuper ? [{ key: 'ksqi', type: 'toggle', icon: 'award', label: 'KSQI 평가', desc: '이 브랜드에 KSQI 관리·평가 탭 노출', accent: 'primary' }] : []),
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
                { key: 'profile', icon: 'user', label: '프로필', desc: '이름·연락처·비밀번호 변경', accent: 'ink' },
                { key: 'notify', icon: 'bell-ring', label: '알림 설정', desc: '유형별 알림 수신 켜기/끄기', accent: 'ink' },
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
                                        <button type="button" role="switch" aria-checked={ksqi} disabled={!activeBrandId || ksqiSaving} onClick={toggleKsqi} className={`ks-switch ${ksqi ? 'on' : ''}`} title={activeBrandId ? '' : '브랜드를 먼저 선택하세요'}>
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
// 프로필 기본 정보 — 실 사용자 DB 연동(GET /api/me). 전부 읽기 전용(개인정보 확인용).
//   · 이름/이메일/소속/부서: 표시만. 변경은 관리자(사용자 관리)에서. 값 없으면 빈칸.
//   · 본인 셀프 편집은 비밀번호 변경(SettingsPassword)만.
function SettingsProfile() {
    const [me, setMe] = useState(null); // null=로딩

    useEffect(() => {
        let alive = true;
        fetchMe()
            .then((r) => { if (alive) setMe(r || {}); })
            .catch(() => { if (alive) setMe({}); });
        return () => { alive = false; };
    }, []);

    const name = me?.display_name || '';
    const email = me?.email || '';
    const org = me?.org_name || '';
    const dept = me?.department || '';

    return (
        <div>
            <div className="col-flex">
                <div className="panel">
                    <div className="panel-head"><h3>기본 정보</h3></div>
                    <div className="panel-body" style={{ display: 'grid', gap: 16 }}>
                        <div className="grid grid-2" style={{ gap: 14 }}>
                            <div className="field">
                                <span className="field-label">이름</span>
                                <div className="field-static">{name}</div>
                            </div>
                            <div className="field">
                                <span className="field-label">이메일</span>
                                <div className="field-static">{email}</div>
                            </div>
                        </div>
                        <div className="grid grid-2" style={{ gap: 14 }}>
                            <div className="field">
                                <span className="field-label">소속</span>
                                <div className="field-static">{org}</div>
                            </div>
                            <div className="field">
                                <span className="field-label">부서</span>
                                <div className="field-static">{dept}</div>
                            </div>
                        </div>
                        <div className="muted-text" style={{ fontSize: 11.5 }}>
                            개인정보 변경이 필요하면 관리자에게 문의하세요.
                        </div>
                    </div>
                </div>

                {/* 비밀번호 변경 — 보안탭 폐지로 프로필 하위로 이동(실연동 PATCH /api/me). */}
                <SettingsPassword />
            </div>
        </div>
    );
}

// ── 프로필 하위: 비밀번호 변경(실연동) ──
// 본인 셀프 편집(PATCH /api/me — updateMe). 현재 비밀번호 확인 + 정책(PASSWORD_POLICY_RE) 검증.
// (구 '보안' 탭에서 유일하게 쓰이던 기능 → 보안 탭 폐지하며 프로필로 이동)
function SettingsPassword() {
    const [currentPw, setCurrentPw] = useState('');
    const [newPw, setNewPw] = useState('');
    const [confirmPw, setConfirmPw] = useState('');
    const [saving, setSaving] = useState(false);
    const [msg, setMsg] = useState(null); // { ok, text }

    const newPwValid = PASSWORD_POLICY_RE.test(newPw);
    const confirmOk = Boolean(newPw) && newPw === confirmPw;
    const canSubmit = Boolean(currentPw) && newPwValid && confirmOk && !saving;

    const submit = async () => {
        if (!canSubmit) return;
        setSaving(true);
        setMsg(null);
        try {
            await updateMe({ current_password: currentPw, new_password: newPw });
            setCurrentPw(''); setNewPw(''); setConfirmPw('');
            setMsg({ ok: true, text: '비밀번호가 변경되었습니다.' });
        } catch (e) {
            setMsg({ ok: false, text: e?.message || '비밀번호 변경에 실패했습니다.' });
        } finally {
            setSaving(false);
        }
    };

    return (
        <div className="panel">
            <div className="panel-head"><h3>비밀번호 변경</h3></div>
            <div className="panel-body" style={{ display: 'grid', gap: 12, maxWidth: 480 }}>
                <div className="field">
                    <span className="field-label">현재 비밀번호</span>
                    <input type="password" className="text-input" autoComplete="current-password" placeholder="••••••••"
                        value={currentPw} onChange={(e) => setCurrentPw(e.target.value)} />
                </div>
                <div className="field">
                    <span className="field-label">새 비밀번호</span>
                    <input type="password" className="text-input" autoComplete="new-password"
                        value={newPw} onChange={(e) => setNewPw(e.target.value)} />
                    <span className="field-hint">{PASSWORD_POLICY_HINT}</span>
                    {newPw && !newPwValid && (
                        <span className="field-hint" style={{ color: 'var(--destructive)' }}>비밀번호 정책을 확인해주세요.</span>
                    )}
                </div>
                <div className="field">
                    <span className="field-label">새 비밀번호 확인</span>
                    <input type="password" className="text-input" autoComplete="new-password"
                        value={confirmPw} onChange={(e) => setConfirmPw(e.target.value)} />
                    {confirmPw && !confirmOk && (
                        <span className="field-hint" style={{ color: 'var(--destructive)' }}>새 비밀번호와 일치하지 않습니다.</span>
                    )}
                </div>
                {msg && (
                    <div style={{ fontSize: 12, fontWeight: 600, color: msg.ok ? '#067647' : 'var(--destructive)' }}>{msg.text}</div>
                )}
                <button className="btn-mini primary" style={{ alignSelf: 'flex-start', marginTop: 4 }} onClick={submit} disabled={!canSubmit}>
                    <Icon name="key-round" />{saving ? '변경 중…' : '비밀번호 변경'}
                </button>
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
