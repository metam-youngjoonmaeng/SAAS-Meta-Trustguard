// AI 평가 배치 관리 (AI Evaluation Batch Filtering)
// AI QA가 평가한 콜 중 "특정 조건"에 해당하는 콜만 사람이 재청취·검토 대상으로 배치.
// 5개 검사 조건(on/off) + 공통 범위(통화시간·기간) + 배치 스케줄.
// 디자인 원본: etc/pages-batch.jsx (디자인 시스템은 evalMgmt 토큰 .tg-eval 스코프 재사용).
import React, { useState, useMemo, useEffect, useCallback } from 'react';
import { Icon, PageHead, Modal } from './ui';
import {
    fetchBatchConfig, saveBatchConfig, previewBatch, fetchBatchEvalItems,
    fetchBatchPrompt, saveBatchPrompt, rejudgeConfidence, fetchRejudgeStatus,
} from '../../services/api';

// 작은 입력 컨트롤 공통 스타일
const bInput = {
    height: 34, padding: '0 10px', background: 'white', border: '1px solid var(--border-strong)',
    borderRadius: 8, fontSize: 13, fontFamily: 'inherit', color: 'var(--ink-900)', outline: 'none',
    fontVariantNumeric: 'tabular-nums',
};

// 토글 스위치 — evalMgmt.css 의 .toggle/.track/.thumb 사용
function Toggle({ checked, onChange }) {
    return (
        <label className="toggle">
            <input type="checkbox" checked={checked} onChange={(e) => onChange?.(e.target.checked)} />
            <span className="track"></span>
            <span className="thumb"></span>
        </label>
    );
}

// 상대값/절대값 · 배치 주기 같은 세그먼트 버튼
function Segment({ value, onChange, options }) {
    return (
        <div style={{ display: 'inline-flex', background: 'var(--muted)', borderRadius: 8, padding: 2, gap: 2 }}>
            {options.map((o) => {
                const on = value === o.v;
                return (
                    <button
                        key={o.v}
                        type="button"
                        onClick={() => onChange(o.v)}
                        style={{
                            padding: '5px 11px', borderRadius: 6, border: 0, cursor: 'pointer', fontFamily: 'inherit',
                            fontSize: 12, fontWeight: 700, whiteSpace: 'nowrap',
                            background: on ? 'white' : 'transparent', color: on ? 'var(--primary)' : 'var(--ink-500)',
                            boxShadow: on ? 'var(--shadow-xs)' : 'none',
                        }}
                    >
                        {o.label}
                    </button>
                );
            })}
        </div>
    );
}

// 하위 규칙 행 — 체크 토글 + 라벨/설명 + 우측 컨트롤
function SubRule({ on, onToggle, label, desc, children, disabled, locked }) {
    const active = on || locked;
    return (
        <div
            style={{
                display: 'flex', alignItems: 'center', gap: 12, padding: '12px 14px',
                borderRadius: 10, background: active ? 'white' : 'transparent',
                border: `1px solid ${active ? 'var(--border)' : 'transparent'}`,
                opacity: disabled && !locked ? 0.5 : 1, transition: 'background .15s, border-color .15s',
            }}
        >
            {locked ? (
                <span
                    style={{
                        width: 20, height: 20, borderRadius: 6, flexShrink: 0, display: 'grid', placeItems: 'center',
                        background: 'var(--primary-soft-flat)', border: '1.5px solid var(--primary-soft-border)', color: 'var(--primary)',
                    }}
                >
                    <Icon name="lock" size={11} />
                </span>
            ) : (
                <button
                    type="button"
                    onClick={disabled ? undefined : onToggle}
                    style={{
                        width: 20, height: 20, borderRadius: 6, flexShrink: 0, cursor: disabled ? 'default' : 'pointer',
                        display: 'grid', placeItems: 'center', padding: 0,
                        background: on ? 'var(--primary)' : 'white',
                        border: `1.5px solid ${on ? 'var(--primary)' : 'var(--border-strong)'}`,
                        color: 'white', transition: 'background .12s, border-color .12s',
                    }}
                >
                    {on && <Icon name="check" size={13} />}
                </button>
            )}
            <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink-900)' }}>{label}</div>
                {desc && <div style={{ fontSize: 11.5, color: 'var(--ink-500)', marginTop: 2, lineHeight: 1.45 }}>{desc}</div>}
            </div>
            {locked && (
                <span style={{ fontSize: 10.5, fontWeight: 700, padding: '3px 9px', borderRadius: 9999, background: 'var(--primary-soft-flat)', color: 'var(--primary)', flexShrink: 0 }}>
                    필수
                </span>
            )}
            {children && <div style={{ flexShrink: 0, display: 'flex', alignItems: 'center', gap: 8 }}>{children}</div>}
        </div>
    );
}

// 검사 조건 카드 (마스터 토글 + 펼침 본문)
function FilterCard({ idx, icon, title, tag, desc, on, onToggle, est, children }) {
    return (
        <div
            style={{
                border: `1px solid ${on ? 'var(--primary-soft-border)' : 'var(--border)'}`,
                borderRadius: 14, background: 'white', overflow: 'hidden',
                transition: 'border-color .15s, box-shadow .15s',
                boxShadow: on ? '0 1px 3px rgba(37,99,235,0.06)' : 'none',
            }}
        >
            {/* 헤더 */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '16px 18px' }}>
                <span
                    style={{
                        width: 40, height: 40, borderRadius: 11, flexShrink: 0, display: 'grid', placeItems: 'center',
                        background: on ? 'var(--primary)' : 'var(--muted)', color: on ? 'white' : 'var(--ink-400)',
                        transition: 'background .15s, color .15s',
                    }}
                >
                    <Icon name={icon} size={19} />
                </span>
                <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                        <span style={{ fontSize: 11, fontWeight: 800, color: on ? 'var(--primary)' : 'var(--ink-300)', fontVariantNumeric: 'tabular-nums' }}>
                            {String(idx).padStart(2, '0')}
                        </span>
                        <span style={{ fontSize: 15, fontWeight: 700, color: 'var(--ink-900)' }}>{title}</span>
                        <span style={{ fontSize: 10.5, fontWeight: 700, padding: '2px 8px', borderRadius: 9999, background: 'var(--muted)', color: 'var(--ink-500)' }}>{tag}</span>
                    </div>
                    <div style={{ fontSize: 12, color: 'var(--ink-500)', marginTop: 3, lineHeight: 1.45 }}>{desc}</div>
                </div>
                {on && est != null && (
                    typeof est === 'number' ? (
                        <div style={{ textAlign: 'right', flexShrink: 0, marginRight: 4 }}>
                            <div style={{ fontSize: 17, fontWeight: 800, color: 'var(--primary)', fontVariantNumeric: 'tabular-nums', lineHeight: 1 }}>{est.toLocaleString()}</div>
                            <div style={{ fontSize: 10.5, color: 'var(--ink-400)', marginTop: 3 }}>예상 대상</div>
                        </div>
                    ) : (
                        <div style={{ textAlign: 'right', flexShrink: 0, marginRight: 4, maxWidth: 96 }}>
                            <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--ink-400)', lineHeight: 1.35 }}>{est}</div>
                        </div>
                    )
                )}
                <Toggle checked={on} onChange={onToggle} />
            </div>
            {/* 본문 */}
            {on && (
                <div style={{ borderTop: '1px solid var(--border-soft)', background: 'var(--background-soft)', padding: 14, display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {children}
                </div>
            )}
        </div>
    );
}

// 판정 기준 수정(연필) 버튼 — 서브룰 우측. 클릭 시 프롬프트 편집 모달 오픈(해당 섹션 포커스).
function PencilBtn({ onClick, title }) {
    return (
        <button
            type="button"
            onClick={onClick}
            title={title}
            style={{
                width: 28, height: 28, borderRadius: 8, display: 'grid', placeItems: 'center', cursor: 'pointer', padding: 0,
                background: 'transparent', border: 0, color: 'var(--ink-400)', transition: 'color .12s',
            }}
            onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--primary)'; }}
            onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--ink-400)'; }}
        >
            <Icon name="pencil" size={15} />
        </button>
    );
}

const taStyle = {
    width: '100%', minHeight: 132, padding: '10px 12px', background: 'white', border: '1px solid var(--border-strong)',
    borderRadius: 10, fontSize: 13, fontFamily: 'inherit', color: 'var(--ink-900)', outline: 'none', lineHeight: 1.6, resize: 'vertical',
    boxSizing: 'border-box',
};

// ② 판정 프롬프트 편집 — 두 정의문(불확실/모순)을 한 모달에서 편집. 저장 시 변경되면 재판정 트리거.
// focus='uncertain'|'contradiction' — 클릭한 섹션을 강조/자동포커스.
function PromptEditModal({ focus, onClose, onChanged }) {
    const isUnc = focus === 'uncertain';
    const critLabel = isUnc ? '불확실 표현' : '근거–점수 모순';
    const [loading, setLoading] = useState(true);
    const [u, setU] = useState('');   // 두 정의문 모두 로드 — 화면엔 focus 하나만 보이지만 저장 시 둘 다 전송(미편집분 보존).
    const [c, setC] = useState('');
    const [meta, setMeta] = useState(null);
    const [busy, setBusy] = useState(false);       // 저장(PUT) 진행 — 버튼/입력 잠금
    const [rejudging, setRejudging] = useState(false); // 기존 평가 재판정 — 백그라운드(닫아도 계속)
    const [status, setStatus] = useState(null); // 재판정 진행상황
    const [msg, setMsg] = useState(null);        // { type, text }

    useEffect(() => {
        let alive = true;
        fetchBatchPrompt()
            .then((r) => {
                if (!alive || !r?.ok) return;
                setU(r.uncertain_def || '');
                setC(r.contradiction_def || '');
                setMeta(r);
            })
            .catch(() => setMsg({ type: 'error', text: '프롬프트 조회 실패' }))
            .finally(() => { if (alive) setLoading(false); });
        return () => { alive = false; };
    }, []);

    const restoreDefaults = () => {
        if (!meta) return;
        if (isUnc) setU(meta.default_uncertain_def || '');
        else setC(meta.default_contradiction_def || '');
        setMsg({ type: 'info', text: '기본값으로 되돌렸습니다. 저장해야 적용됩니다.' });
    };

    const pollUntilDone = useCallback(async () => {
        // running 이 false 가 될 때까지 1.5s 간격 폴링.
        // eslint-disable-next-line no-constant-condition
        while (true) {
            await new Promise((r) => setTimeout(r, 1500));
            let s;
            try { s = await fetchRejudgeStatus(); } catch { return; }
            setStatus(s);
            if (!s.running) return s;
        }
    }, []);

    const handleSave = async () => {
        // 1) 저장(PUT) — 빠르고 블로킹. 끝나면 버튼 잠금 해제(닫기 가능).
        setBusy(true); setMsg(null); setStatus(null);
        let saved;
        try {
            saved = await saveBatchPrompt({ uncertain_def: u, contradiction_def: c });
        } catch (e) {
            setMsg({ type: 'error', text: '저장 실패: ' + (e?.message || '오류') });
            setBusy(false);
            return;
        }
        setBusy(false);
        if (saved.unchanged) { setMsg({ type: 'info', text: '변경 사항이 없습니다.' }); return; }
        onChanged?.();
        if (!meta?.judge_enabled) {
            setMsg({ type: 'warn', text: `저장 완료 (v${saved.version}). GEMINI_API_KEY 미설정 — 새 기준은 이후 평가부터 적용됩니다.` });
            return;
        }
        // 2) 기존 평가 재판정 — 백그라운드. 모달을 닫아도 서버에서 계속 진행된다.
        setMsg({ type: 'done', text: `저장 완료 (v${saved.version}). 기존 ${saved.stale_count}콜은 백그라운드에서 재판정 중 — 닫으셔도 됩니다.` });
        setRejudging(true);
        setStatus({ running: true, done: 0, total: saved.stale_count });
        try {
            await rejudgeConfidence();
            const fin = await pollUntilDone();
            const n = fin?.result?.done ?? fin?.done ?? saved.stale_count;
            setMsg({ type: 'done', text: `저장 완료 · 기존 ${n}콜 재판정 반영됨.` });
            onChanged?.();
        } catch (e) {
            setMsg({ type: 'warn', text: '저장은 완료됐지만 재판정 실패: ' + (e?.message || '오류') });
        } finally {
            setRejudging(false);
        }
    };

    const msgColor = msg?.type === 'error' ? 'var(--danger, #d04443)'
        : msg?.type === 'warn' ? 'var(--warning-ink, #b45309)'
        : msg?.type === 'done' ? 'var(--success-ink, #15803d)' : 'var(--primary)';

    return (
        <Modal
            title={`${critLabel} — 판정 기준 수정`}
            width={620}
            onClose={busy ? undefined : onClose}
            foot={
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%' }}>
                    <button
                        type="button" onClick={restoreDefaults} disabled={busy || loading}
                        style={{ background: 'white', border: '1px solid var(--border-strong)', color: 'var(--ink-600)', padding: '9px 14px', borderRadius: 9, fontWeight: 600, fontSize: 13, cursor: busy ? 'default' : 'pointer', fontFamily: 'inherit' }}
                    >
                        기본값 복원
                    </button>
                    <div style={{ flex: 1 }} />
                    <button
                        type="button" onClick={busy ? undefined : onClose} disabled={busy}
                        style={{ background: 'white', border: '1px solid var(--border-strong)', color: 'var(--ink-600)', padding: '9px 14px', borderRadius: 9, fontWeight: 600, fontSize: 13, cursor: busy ? 'default' : 'pointer', fontFamily: 'inherit' }}
                    >
                        닫기
                    </button>
                    <button
                        type="button" onClick={handleSave} disabled={busy || loading}
                        style={{ display: 'inline-flex', alignItems: 'center', gap: 7, background: 'var(--primary)', color: 'white', border: 0, padding: '9px 18px', borderRadius: 9, fontWeight: 700, fontSize: 13, cursor: busy || loading ? 'default' : 'pointer', fontFamily: 'inherit', opacity: busy || loading ? 0.6 : 1 }}
                    >
                        <Icon name="save" size={15} />{busy ? '저장 중…' : '저장'}
                    </button>
                </div>
            }
        >
            {loading ? (
                <div style={{ padding: 24, textAlign: 'center', color: 'var(--ink-400)', fontSize: 13 }}>불러오는 중…</div>
            ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                    <div style={{ fontSize: 12, color: 'var(--ink-500)', lineHeight: 1.55, background: 'var(--warning-soft)', border: '1px solid var(--warning-border)', borderRadius: 8, padding: '9px 12px' }}>
                        <Icon name="info" size={13} style={{ verticalAlign: '-2px', marginRight: 5, color: 'var(--warning-ink)' }} />
                        AI가 매긴 점수·근거를 LLM이 읽고 판정합니다. 출력 형식 같은 골격은 시스템이 고정하고, 아래 <strong>판단 기준</strong>만 수정합니다. 저장하면 새 기준이 적용되고, 기존 평가는 백그라운드에서 다시 판정됩니다.
                    </div>

                    <div style={{ padding: 14, borderRadius: 12, background: 'var(--background-soft)', border: '1px solid var(--border-soft)' }}>
                        <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--ink-900)', marginBottom: 6 }}>{critLabel}로 판정할 기준</div>
                        <div style={{ fontSize: 11.5, color: 'var(--ink-500)', marginBottom: 8, lineHeight: 1.5 }}>
                            {isUnc
                                ? '근거 문장이 단정하지 못하고 추측·인상에 기댄 경우를 무엇으로 볼지 적습니다.'
                                : '근거 내용과 부여된 점수의 방향이 어긋나는 경우를 무엇으로 볼지 적습니다.'}
                        </div>
                        <textarea
                            value={isUnc ? u : c}
                            onChange={(e) => (isUnc ? setU : setC)(e.target.value)}
                            disabled={busy} autoFocus style={{ ...taStyle, minHeight: 200 }}
                        />
                    </div>

                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 11.5, color: 'var(--ink-400)' }}>
                        <span>모델 {meta?.model || '—'}</span>
                        <span>·</span>
                        <span>현재 버전 v{meta?.version ?? 0}{meta?.is_default ? ' (기본값)' : ''}</span>
                        {!meta?.judge_enabled && <span style={{ color: 'var(--warning-ink)' }}>· 판정 키 미설정</span>}
                    </div>

                    {status && status.running && (
                        <div style={{ fontSize: 12.5, color: 'var(--primary)', display: 'flex', alignItems: 'center', gap: 8 }}>
                            <Icon name="loader" size={14} />재판정 중… {status.done ?? 0}/{status.total ?? '—'}콜
                        </div>
                    )}
                    {msg && (
                        <div style={{ fontSize: 12.5, color: msgColor, fontWeight: 600, lineHeight: 1.5 }}>{msg.text}</div>
                    )}
                </div>
            )}
        </Modal>
    );
}

export default function BatchManage() {
    // 조건 on/off
    const [on, setOn] = useState({ quality: true, confidence: true, risk: true, tenure: false, bias: false });
    const toggle = (k) => setOn((s) => ({ ...s, [k]: !s[k] }));

    // ① 저품질
    const [q, setQ] = useState({ avgBelow: true, avgMode: 'rel', avgRel: 10, avgAbs: 70, essential: true, essThreshold: 60 });
    const setQk = (k, v) => setQ((s) => ({ ...s, [k]: v }));

    // ② AI 신뢰도 (weak '근거 빈약'은 기준 모호 + 과검출(53%)로 제외 — 불확실 표현·근거-점수 모순만)
    const [c, setC] = useState({ uncertain: true, contradiction: true });
    const setCk = (k, v) => setC((s) => ({ ...s, [k]: v }));
    const [excluded, setExcluded] = useState(new Set()); // 제외할 평가항목 order_no 집합(기본: 전 항목 포함)
    const toggleExcluded = (key) => setExcluded((s) => { const n = new Set(s); n.has(key) ? n.delete(key) : n.add(key); return n; });
    const [evalItems, setEvalItems] = useState([]); // 실제 평가된 항목(order_no+item) — ② 적용 항목 칩

    // ④ 근속
    const [tenure, setTenure] = useState({ junior: true, juniorMonths: 6, senior: true, seniorYears: 5 });
    const setTk = (k, v) => setTenure((s) => ({ ...s, [k]: v }));

    // ⑤ 편향
    const [bias, setBias] = useState({ random: true, randomPct: 5, highScore: true, highThreshold: 95 });
    const setBk = (k, v) => setBias((s) => ({ ...s, [k]: v }));

    // 공통 범위 / 스케줄
    const [scope, setScope] = useState({ minMin: 3, maxMin: 60, freq: 'daily', time: '02:00' });
    const setSk = (k, v) => setScope((s) => ({ ...s, [k]: v }));

    // ── 실연동: 저장된 설정 로드 + 서버 미리보기(예상 대상 실수치) + 저장 ─────────────
    const [preview, setPreview] = useState(null);
    const [loaded, setLoaded] = useState(false);
    const [saving, setSaving] = useState(false);
    const [savedAt, setSavedAt] = useState(null);
    const [promptModal, setPromptModal] = useState(null);  // null | 'uncertain' | 'contradiction'
    const [previewNonce, setPreviewNonce] = useState(0);    // 재판정 후 미리보기 강제 갱신

    // 현재 화면 state → 서버 config 직렬화(Set→배열).
    const config = useMemo(() => ({
        on, quality: q, confidence: { ...c, excluded: Array.from(excluded) }, tenure, bias, scope,
    }), [on, q, c, excluded, tenure, bias, scope]);

    // 마운트 시 저장된 설정 1회 로드(있으면 state 복원).
    useEffect(() => {
        let alive = true;
        fetchBatchConfig()
            .then((res) => {
                if (!alive) return;
                const cfg = res?.config;
                if (cfg && typeof cfg === 'object') {
                    if (cfg.on) setOn((s) => ({ ...s, ...cfg.on }));
                    if (cfg.quality) setQ((s) => ({ ...s, ...cfg.quality }));
                    if (cfg.confidence) {
                        const { excluded: ex, ...rest } = cfg.confidence;
                        setC((s) => ({ ...s, ...rest }));
                        if (Array.isArray(ex)) setExcluded(new Set(ex));
                    }
                    if (cfg.tenure) setTenure((s) => ({ ...s, ...cfg.tenure }));
                    if (cfg.bias) setBias((s) => ({ ...s, ...cfg.bias }));
                    if (cfg.scope) setScope((s) => ({ ...s, ...cfg.scope }));
                }
            })
            .catch(() => {})
            .finally(() => { if (alive) setLoaded(true); });
        return () => { alive = false; };
    }, []);

    // 적용 평가 항목 — 실제 평가된 항목 1회 로드.
    useEffect(() => {
        let alive = true;
        fetchBatchEvalItems().then((res) => { if (alive && res?.ok) setEvalItems(res.items || []); }).catch(() => {});
        return () => { alive = false; };
    }, []);

    // config 변경 → 디바운스 후 서버 미리보기 갱신(실데이터 예상 대상).
    useEffect(() => {
        if (!loaded) return;
        const t = setTimeout(() => {
            previewBatch(config).then((res) => { if (res?.ok) setPreview(res); }).catch(() => {});
        }, 350);
        return () => clearTimeout(t);
    }, [config, loaded, previewNonce]);

    const handleSave = useCallback(async () => {
        setSaving(true);
        try {
            await saveBatchConfig(config);
            setSavedAt(new Date());
        } catch (e) {
            alert('배치 설정 저장 실패: ' + (e?.message || '오류'));
        } finally {
            setSaving(false);
        }
    }, [config]);

    // 카드별 예상 대상 — 지원 조건은 실수치(number), 미지원은 사유 라벨(string).
    const cardEst = (key) => {
        const cc = preview?.conditions?.[key];
        if (!cc) return null; // 미리보기 도착 전
        if (cc.supported) return cc.count ?? 0;
        return key === 'confidence' ? '엔진 연동 대기'
            : key === 'risk' ? '기준 정의 대기'
            : key === 'tenure' ? '데이터 보강 대기' : '미지원';
    };
    const pool = preview ? preview.pool : null;
    const totalTargets = preview ? preview.total_targets : null;
    const activeCount = Object.values(on).filter(Boolean).length;
    const coverage = preview && preview.pool > 0 ? Math.round((preview.total_targets / preview.pool) * 100) : 0;

    return (
        <div>
            <PageHead title="AI 평가 배치 관리" sub="AI가 평가한 콜 중 사람이 재청취·검토할 대상을 조건으로 선별합니다. AI 오판 보정과 평가 신뢰성 확보를 위한 표본 추출 규칙을 설정하세요.">
                {/* '지금 실행'은 수동 주기일 때만 노출 — 스케줄(실시간/매시간/매일)은 자동 실행이라 수동 트리거 불필요. */}
                {scope.freq === 'manual' && (
                    <button
                        type="button"
                        onClick={() => alert('수동 실행은 배치 실행 로직 연동 후 활성화됩니다. (현재는 조건 저장만 지원)')}
                        title="배치 실행 로직 연동 예정"
                        style={{ display: 'inline-flex', alignItems: 'center', gap: 7, background: 'var(--primary)', color: 'white', border: 0, padding: '9px 16px', borderRadius: 9, fontWeight: 700, fontSize: 13, cursor: 'pointer', fontFamily: 'inherit', opacity: 0.6 }}
                    >
                        <Icon name="play" size={15} />지금 실행
                    </button>
                )}
            </PageHead>

            {/* 요약 바 */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 0, flexWrap: 'wrap', border: '1px solid var(--border)', borderRadius: 14, background: 'white', overflow: 'hidden', marginBottom: 18 }}>
                <div style={{ flex: 1, minWidth: 180, padding: '16px 20px', display: 'flex', alignItems: 'center', gap: 14 }}>
                    <span style={{ width: 44, height: 44, borderRadius: 12, background: 'var(--primary)', color: 'white', display: 'grid', placeItems: 'center', flexShrink: 0 }}>
                        <Icon name="filter" size={21} />
                    </span>
                    <div>
                        <div style={{ fontSize: 25, fontWeight: 800, color: 'var(--ink-900)', fontVariantNumeric: 'tabular-nums', lineHeight: 1 }}>
                            {totalTargets != null ? totalTargets.toLocaleString() : '—'} <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink-400)' }}>/ {pool != null ? pool.toLocaleString() : '—'} 콜</span>
                        </div>
                        <div style={{ fontSize: 12, color: 'var(--ink-500)', marginTop: 4 }}>
                            {preview == null ? '예상 대상 산출 중…' : `검토 배치 예상 대상 · 통화시간 범위 내 ${(preview.in_scope ?? 0).toLocaleString()}콜 중 ${coverage}%`}
                        </div>
                    </div>
                </div>
                <div style={{ width: 1, alignSelf: 'stretch', background: 'var(--border-soft)' }}></div>
                <div style={{ padding: '16px 20px', textAlign: 'center' }}>
                    <div style={{ fontSize: 19, fontWeight: 800, color: 'var(--ink-900)', fontVariantNumeric: 'tabular-nums' }}>{activeCount} <span style={{ fontSize: 12, color: 'var(--ink-400)', fontWeight: 600 }}>/ 5</span></div>
                    <div style={{ fontSize: 11.5, color: 'var(--ink-500)', marginTop: 3 }}>활성 조건</div>
                </div>
                <div style={{ width: 1, alignSelf: 'stretch', background: 'var(--border-soft)' }}></div>
                <div style={{ padding: '16px 20px', textAlign: 'center' }}>
                    <div style={{ fontSize: 19, fontWeight: 800, color: 'var(--ink-900)', fontVariantNumeric: 'tabular-nums' }}>{scope.minMin}–{scope.maxMin}<span style={{ fontSize: 12, color: 'var(--ink-400)', fontWeight: 600 }}>분</span></div>
                    <div style={{ fontSize: 11.5, color: 'var(--ink-500)', marginTop: 3 }}>통화시간 범위</div>
                </div>
                <div style={{ width: 1, alignSelf: 'stretch', background: 'var(--border-soft)' }}></div>
                <div style={{ padding: '16px 20px', textAlign: 'center' }}>
                    <div style={{ fontSize: 19, fontWeight: 800, color: 'var(--ink-900)' }}>{scope.freq === 'realtime' ? '실시간' : scope.freq === 'hourly' ? '매시간' : scope.freq === 'daily' ? `매일 ${scope.time}` : '수동'}</div>
                    <div style={{ fontSize: 11.5, color: 'var(--ink-500)', marginTop: 3 }}>배치 주기</div>
                </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 14 }}>
                {/* 공통 범위 / 스케줄 */}
                <div className="panel" style={{ padding: 0 }}>
                    <div className="panel-head">
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            <Icon name="sliders-horizontal" size={15} style={{ color: 'var(--ink-500)' }} />
                            <h3>공통 범위 · 스케줄</h3>
                        </div>
                        <span className="muted-text" style={{ fontSize: 12, marginLeft: 'auto' }}>모든 조건에 공통 적용됩니다</span>
                    </div>
                    <div style={{ padding: 18, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 22 }}>
                        {/* 통화시간 */}
                        <div>
                            <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--ink-700)', marginBottom: 8 }}>통화시간 범위</div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                <input type="number" min={0} value={scope.minMin} onChange={(e) => setSk('minMin', +e.target.value)} style={{ ...bInput, width: 64 }} />
                                <span style={{ fontSize: 12.5, color: 'var(--ink-500)' }}>분 이상</span>
                                <span style={{ color: 'var(--ink-300)' }}>~</span>
                                <input type="number" min={0} value={scope.maxMin} onChange={(e) => setSk('maxMin', +e.target.value)} style={{ ...bInput, width: 64 }} />
                                <span style={{ fontSize: 12.5, color: 'var(--ink-500)' }}>분 미만</span>
                            </div>
                            <div style={{ fontSize: 11, color: 'var(--ink-400)', marginTop: 7, lineHeight: 1.45 }}>너무 짧은 콜(단순 문의)과 비정상적으로 긴 콜을 검토 대상에서 제외합니다.</div>
                        </div>
                        {/* 배치 주기 */}
                        <div>
                            <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--ink-700)', marginBottom: 8 }}>배치 주기</div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                                <Segment value={scope.freq} onChange={(v) => setSk('freq', v)} options={[
                                    { v: 'realtime', label: '실시간' }, { v: 'hourly', label: '매시간' }, { v: 'daily', label: '매일' }, { v: 'manual', label: '수동' },
                                ]} />
                                {scope.freq === 'daily' && (
                                    <input type="time" value={scope.time} onChange={(e) => setSk('time', e.target.value)} style={{ ...bInput, width: 150 }} />
                                )}
                            </div>
                            <div style={{ fontSize: 11, color: 'var(--ink-400)', marginTop: 7, lineHeight: 1.45 }}>
                                {scope.freq === 'daily' ? `매일 ${scope.time}에 전일 콜을 대상으로 배치를 실행합니다.` : scope.freq === 'realtime' ? 'AI 평가 완료 즉시 조건에 맞는 콜을 배치합니다.' : scope.freq === 'hourly' ? '매시간 정각에 직전 1시간 콜을 배치합니다.' : '관리자가 수동으로 실행할 때만 배치합니다.'}
                            </div>
                        </div>
                    </div>
                </div>

                {/* ① 저품질 검증 */}
                <FilterCard idx={1} icon="trending-down" title="저품질 검증" tag="점수 필터링" est={cardEst('quality')}
                    desc="평균·필수항목 점수가 기준 이하인 콜을 재검토 대상으로 선별합니다."
                    on={on.quality} onToggle={() => toggle('quality')}>
                    <SubRule on={q.avgBelow} onToggle={() => setQk('avgBelow', !q.avgBelow)} label="평균 점수 미달" desc="콜 종합 점수가 기준 이하인 경우">
                        <Segment value={q.avgMode} onChange={(v) => setQk('avgMode', v)} options={[{ v: 'rel', label: '상대값' }, { v: 'abs', label: '절대값' }]} />
                        {q.avgMode === 'rel' ? (
                            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                <span style={{ fontSize: 12, color: 'var(--ink-500)' }}>월평균 대비</span>
                                <input type="number" value={q.avgRel} onChange={(e) => setQk('avgRel', +e.target.value)} style={{ ...bInput, width: 56 }} />
                                <span style={{ fontSize: 12, color: 'var(--ink-500)' }}>점 이하</span>
                            </div>
                        ) : (
                            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                <input type="number" value={q.avgAbs} onChange={(e) => setQk('avgAbs', +e.target.value)} style={{ ...bInput, width: 56 }} />
                                <span style={{ fontSize: 12, color: 'var(--ink-500)' }}>점 미만</span>
                            </div>
                        )}
                    </SubRule>
                    <SubRule on={q.essential} onToggle={() => setQk('essential', !q.essential)} label="필수 항목 미달" desc="업무정확도 등 필수 항목 평균이 기준 이하인 경우">
                        <input type="number" value={q.essThreshold} onChange={(e) => setQk('essThreshold', +e.target.value)} style={{ ...bInput, width: 56 }} />
                        <span style={{ fontSize: 12, color: 'var(--ink-500)' }}>점 미만</span>
                    </SubRule>
                </FilterCard>

                {/* ② AI 신뢰도 검증 */}
                <FilterCard idx={2} icon="scan-search" title="AI 신뢰도 검증" tag="AI 오판 보정" est={cardEst('confidence')}
                    desc="AI 평가 근거가 불확실하거나 점수와 모순되는 콜을 선별합니다."
                    on={on.confidence} onToggle={() => toggle('confidence')}>
                    <SubRule on={c.uncertain} onToggle={() => setCk('uncertain', !c.uncertain)} label="불확실 표현 포함"
                        desc={'근거 문장에 "~같음", "애매", "판단 어려움" 등 불확실 표현이 있는 경우'}>
                        <PencilBtn title="불확실 표현 판정 기준 수정" onClick={() => setPromptModal('uncertain')} />
                    </SubRule>
                    <SubRule on={c.contradiction} onToggle={() => setCk('contradiction', !c.contradiction)} label="근거–점수 모순"
                        desc="근거는 부정적인데 점수가 높게 부여된 경우">
                        <PencilBtn title="근거-점수 모순 판정 기준 수정" onClick={() => setPromptModal('contradiction')} />
                    </SubRule>

                    {/* 적용 평가 항목 선택 */}
                    <div style={{ marginTop: 4, padding: '12px 14px', borderRadius: 10, background: 'white', border: '1px solid var(--border)' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
                            <Icon name="list-checks" size={14} style={{ color: 'var(--ink-500)' }} />
                            <span style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--ink-900)' }}>적용 평가 항목</span>
                            <span style={{ fontSize: 11, color: 'var(--ink-400)' }}>· 체크 해제한 항목은 검사 제외 ({Math.max(0, evalItems.length - excluded.size)}/{evalItems.length})</span>
                        </div>
                        <div style={{ fontSize: 11, color: 'var(--ink-400)', marginBottom: 10, lineHeight: 1.5, background: 'var(--warning-soft)', border: '1px solid var(--warning-border)', borderRadius: 8, padding: '8px 11px' }}>
                            <Icon name="info" size={12} style={{ verticalAlign: '-2px', marginRight: 4, color: 'var(--warning-ink)' }} />
                            조건에 따라 자동으로 <strong>‘해당 없음’</strong>으로 처리되는 항목은 신뢰도 검증에서 제외하는 것을 권장합니다.
                        </div>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 7 }}>
                            {evalItems.length === 0 && (
                                <span style={{ fontSize: 12, color: 'var(--ink-400)' }}>평가된 콜이 없어 항목이 비어 있습니다.</span>
                            )}
                            {evalItems.map((it) => {
                                const incl = !excluded.has(it.order_no);
                                return (
                                    <button
                                        key={it.order_no}
                                        type="button"
                                        onClick={() => toggleExcluded(it.order_no)}
                                        title={`${it.calls}콜 평가됨`}
                                        style={{
                                            display: 'inline-flex', alignItems: 'center', gap: 6, padding: '6px 11px', borderRadius: 9999,
                                            border: `1px solid ${incl ? 'var(--primary-soft-border)' : 'var(--border)'}`,
                                            background: incl ? 'var(--primary-soft-flat)' : 'white',
                                            color: incl ? 'var(--primary)' : 'var(--ink-400)',
                                            fontSize: 12, fontWeight: 600, fontFamily: 'inherit', cursor: 'pointer',
                                            textDecoration: incl ? 'none' : 'line-through',
                                        }}
                                    >
                                        <Icon name={incl ? 'check' : 'minus'} size={11} />{it.item}
                                    </button>
                                );
                            })}
                        </div>
                    </div>
                </FilterCard>

                {/* ③ 리스크 감지 */}
                <FilterCard idx={3} icon="shield-alert" title="리스크 감지" tag="금칙어 · 고객 신호" est={cardEst('risk')}
                    desc="금칙어·고객 리스크 신호가 감지된 콜을 우선 검토 대상으로 선별합니다."
                    on={on.risk} onToggle={() => toggle('risk')}>
                    <SubRule locked label="금칙어 감지" desc="응대 중 금칙어(비속어·부적절 표현)가 감지된 경우" />
                    <SubRule locked label="고객 리스크 신호" desc="민원·불만·해지 언급, 강한 부정 감정이 감지된 경우" />
                    <div style={{ fontSize: 11, color: 'var(--ink-400)', padding: '2px 4px', lineHeight: 1.5 }}>
                        리스크 항목은 신뢰성·컴플라이언스를 위해 항상 포함되며 개별로 끌 수 없습니다.
                    </div>
                </FilterCard>

                {/* ④ 대상자 특정 */}
                <FilterCard idx={4} icon="user-round-search" title="대상자 특정" tag="근속 기간" est={cardEst('tenure')}
                    desc="근속 기간에 따라 집중 모니터링이 필요한 상담사의 콜을 선별합니다."
                    on={on.tenure} onToggle={() => toggle('tenure')}>
                    <SubRule on={tenure.junior} onToggle={() => setTk('junior', !tenure.junior)} label="신입 상담사" desc="응대 미숙 가능성 — 입사 후 일정 기간 이내">
                        <span style={{ fontSize: 12, color: 'var(--ink-500)' }}>입사</span>
                        <input type="number" value={tenure.juniorMonths} onChange={(e) => setTk('juniorMonths', +e.target.value)} style={{ ...bInput, width: 52 }} />
                        <span style={{ fontSize: 12, color: 'var(--ink-500)' }}>개월 이내</span>
                    </SubRule>
                    <SubRule on={tenure.senior} onToggle={() => setTk('senior', !tenure.senior)} label="장기 근속 상담사" desc="매너리즘 가능성 — 일정 연차 이상">
                        <span style={{ fontSize: 12, color: 'var(--ink-500)' }}>근속</span>
                        <input type="number" value={tenure.seniorYears} onChange={(e) => setTk('seniorYears', +e.target.value)} style={{ ...bInput, width: 52 }} />
                        <span style={{ fontSize: 12, color: 'var(--ink-500)' }}>년 이상</span>
                    </SubRule>
                </FilterCard>

                {/* ⑤ AI 편향점검 */}
                <FilterCard idx={5} icon="shuffle" title="AI 편향점검" tag="표본 · 과대평가" est={cardEst('bias')}
                    desc="무작위 표본과 비정상 고점 콜을 추출해 AI 평가의 편향을 점검합니다."
                    on={on.bias} onToggle={() => toggle('bias')}>
                    <SubRule on={bias.random} onToggle={() => setBk('random', !bias.random)} label="무작위 표본" desc="전체 콜 중 무작위 추출 — 평가 일관성 점검용">
                        <input type="number" value={bias.randomPct} onChange={(e) => setBk('randomPct', +e.target.value)} style={{ ...bInput, width: 56 }} />
                        <span style={{ fontSize: 12, color: 'var(--ink-500)' }}>%</span>
                    </SubRule>
                    <SubRule on={bias.highScore} onToggle={() => setBk('highScore', !bias.highScore)} label="비정상 고점 · 만점 콜" desc="과대평가 의심 — 점수가 기준 이상인 콜">
                        <input type="number" value={bias.highThreshold} onChange={(e) => setBk('highThreshold', +e.target.value)} style={{ ...bInput, width: 56 }} />
                        <span style={{ fontSize: 12, color: 'var(--ink-500)' }}>점 이상</span>
                    </SubRule>
                </FilterCard>
            </div>

            {/* 하단 액션 바 — 조건 설정을 마친 뒤 저장(상단에서 하단으로 이동, 자연스러운 흐름). */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 14, marginTop: 22 }}>
                {savedAt && (
                    <span style={{ fontSize: 12, color: 'var(--ink-400)' }}>
                        {savedAt.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })} 저장됨
                    </span>
                )}
                <button
                    type="button"
                    onClick={handleSave}
                    disabled={saving}
                    style={{ display: 'inline-flex', alignItems: 'center', gap: 7, background: 'var(--primary)', color: 'white', border: 0, padding: '11px 20px', borderRadius: 10, fontWeight: 700, fontSize: 14, cursor: saving ? 'default' : 'pointer', fontFamily: 'inherit', opacity: saving ? 0.6 : 1 }}
                >
                    <Icon name="save" size={16} />{saving ? '저장 중…' : '배치 저장'}
                </button>
            </div>

            {promptModal && (
                <PromptEditModal
                    focus={promptModal}
                    onClose={() => setPromptModal(null)}
                    onChanged={() => setPreviewNonce((n) => n + 1)}
                />
            )}
        </div>
    );
}
