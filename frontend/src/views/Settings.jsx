// 설정 허브 (SettingsHub) — 운영·계정 설정을 한 곳에서. 카드 그리드(그룹: 운영/관리자/시스템/계정),
// 운영 그룹에 배치 관리(이동) + KSQI(토글) 동거, 타일 클릭 시 하위 화면 진입(뒤로가기). 알림·배치는 실제 뷰(Notifications/BatchManage) 재사용,
// 프로필·알림설정·보안·정보는 mock(백엔드 연동 전). 시안: etc/pages-shared.jsx SettingsPage 이식.
import React, { useState, useEffect } from 'react';
import { Icon, PageHead } from './evalMgmt/ui';
import BatchManage from './evalMgmt/BatchManage';
import Users from './Users';
import Brands from './Brands';
import Logs from './Logs';
import { fetchNotificationPrefs, updateNotificationPrefs, updateMe, fetchMe, updateBrand, fetchRagBackend, saveRagBackend, fetchLlmModel, saveLlmModel, PASSWORD_POLICY_HINT, PASSWORD_POLICY_RE } from '../services/api';

// RAG 벡터 백엔드 표시명 — 파이프라인 `QA_OPENSEARCH_MODE` 값과 1:1.
// 2026-09-04 — 임베딩 모델은 스토어와 짝이다: AOSS = Titan V2(Bedrock) · 로컬 OpenSearch = Harrier 0.6b(H200).
//   별도 임베딩 선택기는 두지 않는다(사용자 지시 "로컬 opensearch 선택하면 무조건 해리엇 임베딩 모델 사용").
const RAG_BACKEND_LABEL = { aoss: 'AOSS · Titan', local: '로컬 OpenSearch · Harrier' };
const RAG_EMBED_LABEL = { titan: 'Titan Embed V2 (Bedrock)', harrier: 'Harrier 0.6b (H200)', jaccard: 'Jaccard(벡터 없음)' };

const ROLE_LABEL = { super_admin: '슈퍼관리자', admin: '관리자', agent: '상담사' };

// 작동 표시등 — 초록=작동중 · 빨강=응답 없음 · 회색=확인 안 됨 (2026-09-07).
//   "설정돼 있다"와 "실제로 돈다"는 다르다. 백엔드가 내려가도 설정값은 그대로 남으므로
//   색이 없으면 사용자가 구분할 수 없다.
//   ★ overflow:visible 필수 — .settings-tile-desc 는 nowrap+overflow:hidden 이라 점의
//     발광 링(box-shadow 3px)이 잘린다(실측). 이 줄은 짧아 ellipsis 가 필요 없다.
const LAMP = {
    ok: { color: '#16a34a', text: '작동중', glow: '0 0 0 3px rgba(22,163,74,0.18)' },
    down: { color: '#dc2626', text: '응답 없음', glow: '0 0 0 3px rgba(220,38,38,0.16)' },
    unknown: { color: 'var(--ink-300)', text: '확인 안 됨', glow: 'none' },
};

function StatusLamp({ health = 'unknown', suffix = '', title = '', testId }) {
    const s = LAMP[health] || LAMP.unknown;
    return (
        <span
            className="settings-tile-desc"
            data-testid={testId}
            style={{
                marginTop: 4, display: 'inline-flex', alignItems: 'center',
                gap: 6, overflow: 'visible', paddingLeft: 3,
            }}
        >
            <span
                aria-hidden="true"
                style={{
                    width: 8, height: 8, borderRadius: '50%',
                    background: s.color, flexShrink: 0, boxShadow: s.glow,
                }}
            />
            <span title={title}>{s.text}{suffix}</span>
        </span>
    );
}

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
            // 서버 사유를 그대로 보인다 — 종전 고정 문구는 원인(예: 400 "수정 항목이 없습니다")을 가렸다(0902).
            const reason = e && e.message ? String(e.message) : '';
            alert(`KSQI 토글 저장에 실패했습니다.${reason ? `\n서버 응답: ${reason}` : ''}\n슈퍼관리자 권한·브랜드 선택을 확인해 주세요.`);
        } finally {
            setKsqiSaving(false);
        }
    };

    // RAG 벡터 백엔드(AOSS ↔ 로컬 OpenSearch) — 2026-09-03 실험용 전환 카드(관리자).
    //   파이프라인 GET/PUT /api/rag/backend 중계. 브랜드 무관한 **파이프라인 프로세스 전역** 상태라
    //   브랜드 선택과 무관하게 동작하고, 파이프라인이 재기동되면 env 기본값(운영 aoss)으로 돌아간다.
    //   전환 실패(새 백엔드 연결 불가)는 파이프라인이 이전 모드로 되돌리고 사유를 주므로 그대로 보인다.
    const [rag, setRag] = useState(null); // null=로딩 · { ok, mode, endpoint, reachable, golden_docs, cluster, message }
    const [ragSaving, setRagSaving] = useState(false);
    const loadRag = async () => {
        try {
            const r = await fetchRagBackend();
            setRag(r || { ok: false, mode: null });
        } catch (e) {
            setRag({ ok: false, mode: null, message: e?.message || String(e) });
        }
    };
    useEffect(() => { if (isAdmin && !section) loadRag(); }, [isAdmin, section]); // eslint-disable-line react-hooks/exhaustive-deps
    const switchRag = async (mode) => {
        if (ragSaving || !mode || rag?.mode === mode) return;
        setRagSaving(true);
        try {
            await saveRagBackend(mode);
            // 같은 이유로 병합하지 않고 전체를 다시 읽는다(위 switchLlm 주석 참조).
            await loadRag();
        } catch (e) {
            // 파이프라인이 되돌린 사유(예: "local 백엔드에 연결할 수 없어 aoss 로 되돌렸습니다: …")를 그대로.
            const reason = e && e.message ? String(e.message) : '';
            alert(`RAG 백엔드 전환에 실패했습니다.${reason ? `\n서버 응답: ${reason}` : ''}`);
            await loadRag(); // 실제 상태로 재동기
        } finally {
            setRagSaving(false);
        }
    };

    // 평가 모델(OpenAI) — 2026-09-07. 파이프라인 GET/PUT /api/llm/model 중계.
    //   RAG 백엔드 카드와 같은 성격: 브랜드 무관한 **파이프라인 프로세스 전역** 상태이고,
    //   파이프라인이 재기동되면 env 기본값(gpt-5.6-luna)으로 돌아간다. DB 에 저장하지 않는다.
    //   선택 목록은 파이프라인이 주는 selectable 을 그린다 — 화면에 모델명을 박아두면
    //   파이프라인 목록과 갈렸을 때 고를 수 없는 값이 보인다(전환 시 400).
    const [llm, setLlm] = useState(null); // null=로딩 · { ok, model, selectable[], source, backend, message }
    const [llmSaving, setLlmSaving] = useState(false);
    const loadLlm = async () => {
        try {
            const r = await fetchLlmModel();
            setLlm(r || { ok: false, model: null, selectable: [] });
        } catch (e) {
            setLlm({ ok: false, model: null, selectable: [], message: e?.message || String(e) });
        }
    };
    useEffect(() => { if (isAdmin && !section) loadLlm(); }, [isAdmin, section]); // eslint-disable-line react-hooks/exhaustive-deps
    const switchLlm = async (model) => {
        if (llmSaving || !model || llm?.model === model) return;
        setLlmSaving(true);
        try {
            await saveLlmModel(model);
            // ★ 2026-09-07 부분 응답을 기존 상태에 **병합하지 않는다.**
            //   전환 응답에는 backend·mismatch·entries 가 없어서, 병합하면 옛 mismatch(true)와
            //   옛 backend 가 새 모델명과 섞여 "설정된 gpt-5.6-luna 가 해당 포트에 없습니다"
            //   처럼 실제와 다른 경고가 뜬다(실측). 전환 후엔 전체를 다시 읽는다.
            await loadLlm();
        } catch (e) {
            // 파이프라인이 되돌린 사유(예: "gpt-5.4-mini 호출에 실패해 gpt-5.6-luna 로 되돌렸습니다")를 그대로.
            const reason = e && e.message ? String(e.message) : '';
            alert(`평가 모델 전환에 실패했습니다.${reason ? `\n서버 응답: ${reason}` : ''}`);
            await loadLlm(); // 실제 상태로 재동기
        } finally {
            setLlmSaving(false);
        }
    };

    // ★ 2026-09-07 작동 표시등 주기 갱신 — 램프가 "지금" 상태여야 의미가 있다.
    //   60초 주기. 그리고 **탭이 보이지 않으면 건너뛴다** — 이 조회는 파이프라인이 모델을
    //   실제로 1회 호출(probe)하므로, 설정 화면을 열어둔 채 방치하면 과금 호출이 계속 나간다.
    //   설정 하위화면(section)에 들어가 있으면 카드가 안 보이므로 역시 돌지 않는다.
    useEffect(() => {
        if (!isAdmin || section) return undefined;
        const tick = () => {
            if (typeof document !== 'undefined' && document.hidden) return;
            loadLlm();
            loadRag();
        };
        const id = setInterval(tick, 60_000);
        // 탭으로 돌아오면 즉시 한 번 — 60초를 기다리며 낡은 램프를 보여주지 않는다.
        const onVis = () => { if (!document.hidden) tick(); };
        document.addEventListener('visibilitychange', onVis);
        return () => { clearInterval(id); document.removeEventListener('visibilitychange', onVis); };
    }, [isAdmin, section]); // eslint-disable-line react-hooks/exhaustive-deps

    // 허브 카드(그룹별)
    const GROUPS = [
        {
            title: '운영', show: isAdmin, items: [
                { key: 'batch', icon: 'filter', label: 'AI 평가 배치 관리', desc: '조건별 평가 대상 필터링·스케줄', accent: 'primary' },
                // KSQI 토글 — 선택 브랜드의 KSQI on/off(super_admin). 저장 위치는 trustguard.tenant_settings.
                //   켜면 'KSQI 관리/평가' 탭이 열린다. 평가 파이프라인이 이 값을 읽어 KSQI 노드를 실행하는
                //   연동은 미구현(qaPipelineIngest.getOrgKsqiSttEnabled 가 false 고정) — 기준정의 준비 후 붙일 단계다.
                ...(isSuper ? [{ key: 'ksqi', type: 'toggle', icon: 'award', label: 'KSQI 평가', desc: '이 브랜드에 KSQI 관리·평가 탭 노출', accent: 'primary' }] : []),
                // RAG 벡터 백엔드 전환 카드 — 골든셋·정책·KMS 검색이 읽는 벡터 스토어를 AOSS/로컬 중 고른다(실험용).
                // ★ 2026-09-07 desc 없음 (사용자 지시 "버튼만 있으면 되는데 무슨 설명이 있고 그래").
                //   선택지 자체가 무엇을 고르는지 말해주므로 설명문은 잡음이다.
                { key: 'ragBackend', type: 'ragBackend', icon: 'database', label: 'RAG 벡터 백엔드', desc: '', accent: 'primary' },
                // 평가 모델 카드 — AI 평가가 쓰는 LLM 을 고른다(파이프라인 전역, 재기동 시 기본값 복원).
                { key: 'llmModel', type: 'llmModel', icon: 'cpu', label: '평가 모델', desc: '', accent: 'primary' },
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
                                it.type === 'ragBackend' ? (
                                    // RAG 백엔드 카드 — 세그먼트(AOSS / 로컬 OpenSearch) + 현재 상태 한 줄.
                                    //   ragSaving 중 잠금. 파이프라인 불통이면 '알 수 없음' 으로 표시하되 버튼은 남긴다.
                                    <div key={it.key} className="settings-toggle-card" data-testid="rag-backend-card">
                                        <span className="settings-tile-icon accent-primary-icon"><Icon name={it.icon} size={20} /></span>
                                        <span className="settings-tile-body">
                                            <span className="settings-tile-label">{it.label}</span>
                                            {it.desc ? <span className="settings-tile-desc">{it.desc}</span> : null}
                                            {/* ★ 2026-09-07 표시 간소화 (사용자 지시 "그냥 담백하게 선택지만 해둬").
                                                엔드포인트 호스트명·골든 건수·임베딩 probe_ms 를 뺐다 — 선택에 쓰이지
                                                않는 값이고, probe 가 0ms 로 찍히면 오히려 고장처럼 보인다.
                                                현재 선택은 아래 버튼 강조로 이미 드러난다.
                                                남긴 것은 **연결 불가**와 **재임베딩 필요** 뿐이다 — 둘은 표시가 아니라
                                                검색이 무의미한 상태를 알리는 경고다(지우면 조용히 틀린 결과가 나간다). */}
                                            {/* 작동 표시등 — 스토어 연결 + 임베딩 호출 둘 다 살아야 초록.
                                                검색은 둘 중 하나만 죽어도 무의미하므로 하나로 합쳐 보인다. */}
                                            <StatusLamp
                                                testId="rag-backend-status"
                                                health={(() => {
                                                    if (rag === null || !rag.mode) return 'unknown';
                                                    const emb = rag.embedding || {};
                                                    if (rag.reachable === false || emb.reachable === false) return 'down';
                                                    if (rag.reachable === true) return 'ok';
                                                    return 'unknown';
                                                })()}
                                                suffix={
                                                    rag === null
                                                        ? ''
                                                        : !rag.mode
                                                            ? (rag.message ? ` (${rag.message})` : '')
                                                            : ` · ${RAG_BACKEND_LABEL[rag.mode] || rag.mode}`
                                                }
                                                title={(rag && (rag.error || (rag.embedding && rag.embedding.error))) || ''}
                                            />
                                            {rag && rag.mode && rag.embedding
                                                && rag.index_embedding_backend && rag.embedding.backend
                                                && rag.index_embedding_backend !== rag.embedding.backend ? (
                                                <span className="settings-tile-desc" data-testid="rag-embed-status" style={{ marginTop: 2 }}>
                                                    {`⚠ 인덱스 벡터는 ${RAG_EMBED_LABEL[rag.index_embedding_backend] || rag.index_embedding_backend} — 재임베딩 필요`}
                                                </span>
                                            ) : null}
                                        </span>
                                        <span style={{ display: 'inline-flex', gap: 4, marginLeft: 'auto', flexShrink: 0 }} role="radiogroup" aria-label="RAG 벡터 백엔드">
                                            {['aoss', 'local'].map((m) => (
                                                <button
                                                    key={m}
                                                    type="button"
                                                    role="radio"
                                                    aria-checked={rag?.mode === m}
                                                    data-testid={`rag-backend-${m}`}
                                                    className={`btn-mini ${rag?.mode === m ? 'primary' : ''}`}
                                                    disabled={ragSaving || rag === null}
                                                    onClick={() => switchRag(m)}
                                                    title={m === 'local' ? '로컬 OpenSearch(127.0.0.1:9200) + Harrier 0.6b 임베딩(H200) — 실험용' : 'AWS OpenSearch Serverless + Titan Embed V2 — 기본'}
                                                >
                                                    {ragSaving && rag?.mode !== m
                                                        ? '전환 중…'
                                                        : RAG_BACKEND_LABEL[m] + (rag?.default === m ? ' (default)' : '')}
                                                </button>
                                            ))}
                                        </span>
                                    </div>
                                ) : it.type === 'llmModel' ? (
                                    // 평가 모델 카드 — 선택지는 파이프라인이 주는 selectable 을 그린다.
                                    //   llmSaving 중 잠금(전환에 실제 모델 호출 1회가 포함된다).
                                    //   파이프라인 불통이면 '알 수 없음' 으로 표시하고 버튼은 감춘다 —
                                    //   목록을 못 받은 상태에서 임의 값을 보내면 전환이 400 으로 떨어진다.
                                    <div key={it.key} className="settings-toggle-card" data-testid="llm-model-card">
                                        <span className="settings-tile-icon accent-primary-icon"><Icon name={it.icon} size={20} /></span>
                                        <span className="settings-tile-body">
                                            <span className="settings-tile-label">{it.label}</span>
                                            {it.desc ? <span className="settings-tile-desc">{it.desc}</span> : null}
                                            {/* 담백하게 — 현재 선택은 버튼 강조로 드러나므로 상태줄은
                                                경고와 백엔드 표시만 남긴다. */}
                                            {/* ★ 작동 표시등 — 파이프라인이 실제로 그 모델을 1회 호출한 결과.
                                                초록=작동중 · 빨강=응답 없음 · 회색=확인 안 됨.
                                                "설정돼 있다"와 "실제로 돈다"는 다르다 — 모델이 내려가 있어도
                                                설정값은 그대로 남으므로, 색이 없으면 사용자는 구분할 수 없다. */}
                                            <StatusLamp
                                                testId="llm-model-status"
                                                health={llm === null ? 'unknown' : llm.health || 'unknown'}
                                                suffix={
                                                    llm === null
                                                        ? ''
                                                        : (llm.health === 'ok' && Number.isFinite(llm.health_ms) ? ` · ${llm.health_ms}ms` : '')
                                                          + ` · ${llm.backend || '?'}`
                                                }
                                                title={(llm && llm.health_error) || ''}
                                            />
                                            {/* ★ 설정된 모델이 그 포트에 실제로 없으면 평가가 전부 404 다.
                                                (2026-09-07 실측: .env 는 Qwen3.8-27B, :8000 은 Qwen3.6-35B-A3B 서빙)
                                                조용히 두면 "서버가 안 떴다" 로 오독되므로 반드시 드러낸다. */}
                                            {llm && llm.mismatch ? (
                                                <span className="settings-tile-desc" data-testid="llm-model-mismatch" style={{ marginTop: 2 }}>
                                                    {`⚠ 설정된 ${llm.model} 이(가) 해당 포트에 없습니다`}
                                                    {Array.isArray(llm.served) && llm.served.length > 0
                                                        ? ` — 현재 서빙: ${llm.served.join(', ')}`
                                                        : ' — 포트 응답 없음'}
                                                </span>
                                            ) : null}
                                        </span>
                                        {/* ★ 2026-09-07 세그먼트 버튼 → 드롭다운.
                                            버튼은 'AOSS'처럼 짧은 라벨 2개용으로 만든 컨트롤이다. 모델명은
                                            `DiffusionGemma-26B-A4B-it` 처럼 길고 개수도 4개라, 버튼으로 두면
                                            카드 폭을 넘겨 줄바꿈되며 카드 높이가 들쭉날쭉해진다(그리드 정렬 깨짐).
                                            select 는 길이·개수와 무관하게 한 줄이라 모델이 늘어도 안 깨진다.
                                            ★ 내려간 모델도 **고를 수 있게 남긴다** (사용자 지시 "지금은 내려가있는데
                                              해야돼"). 필요할 때만 올리는 운용이라 살아있는 것만 보이면 미리
                                              골라둘 수 없다. 전환은 실호출로 확인하므로 내려간 걸 고르면 사유가
                                              뜨고 이전 설정으로 되돌아간다. */}
                                        {llm && Array.isArray(llm.selectable) && llm.selectable.length > 0 ? (
                                            <select
                                                aria-label="평가 모델"
                                                data-testid="llm-model-select"
                                                value={llm.model || ''}
                                                disabled={llmSaving}
                                                onChange={(e) => switchLlm(e.target.value)}
                                                style={{
                                                    marginLeft: 'auto',
                                                    flexShrink: 0,
                                                    maxWidth: 260,
                                                    fontSize: 12,
                                                    fontFamily: 'inherit',
                                                    padding: '5px 8px',
                                                    borderRadius: 8,
                                                    border: '1px solid var(--border)',
                                                    background: '#fff',
                                                    color: 'var(--ink-900)',
                                                }}
                                            >
                                                {llm.selectable.includes(llm.model) ? null : (
                                                    // 현재 모델이 목록에 없으면(잘못된 env 등) 빈 선택을 만들지 않는다.
                                                    <option value={llm.model || ''}>{llm.model || '(알 수 없음)'}</option>
                                                )}
                                                {llm.selectable.map((m) => {
                                                    const ent = (llm.entries || []).find((e) => e.model === m);
                                                    const down = ent ? ent.available === false : false;
                                                    return (
                                                        <option key={m} value={m}>
                                                            {m
                                                                + (llm.default === m ? ' (default)' : '')
                                                                + (down ? ' (내려감)' : '')
                                                                + (ent && ent.backend ? ` · ${ent.backend}` : '')}
                                                        </option>
                                                    );
                                                })}
                                            </select>
                                        ) : null}
                                        {llmSaving ? (
                                            <span className="settings-tile-desc" style={{ flexShrink: 0 }}>전환 중…</span>
                                        ) : null}
                                    </div>
                                ) : it.type === 'toggle' ? (
                                    // 토글 카드(KSQI) — 이동 대신 즉시 on/off. 이동 타일과 같은 그리드에 나란히.
                                    <div key={it.key} className="settings-toggle-card">
                                        <span className="settings-tile-icon accent-primary-icon"><Icon name={it.icon} size={20} /></span>
                                        <span className="settings-tile-body">
                                            <span className="settings-tile-label">{it.label}</span>
                                            {it.desc ? <span className="settings-tile-desc">{it.desc}</span> : null}
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
                                            {it.desc ? <span className="settings-tile-desc">{it.desc}</span> : null}
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
