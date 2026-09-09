// LLM 스킬 관리 (LLM Skill Prompt Manage)
// 검수자 정정('낮음'=AI 과소평가 / '높음'=AI 과대평가) 케이스로 학습된 브랜드별·평가항목별
// 보완 룰(overlay md) 버전 관리 화면 — 요약/지금 학습 · 버전 리스트 · 버전 상세(생성 근거 케이스) ·
// 활성화/롤백/비활성화. 데이터 소스: 서버 /api/skill-learn/* (qa-pipeline mtg-skill 프록시).
// 디자인은 BatchManage 관행(.tg-eval 토큰 + panel/panel-head + 인라인 스타일) 재사용.
import React, { useState, useEffect, useCallback } from 'react';
import { Icon, PageHead } from './evalMgmt/ui';
import { DiffText } from './EvalItems'; // 평가항목 변경이력과 동일한 GitHub식 diff 렌더러 재사용
import {
    fetchSkillVersions, fetchSkillVersionDetail, activateSkillVersion,
    fetchSkillLearnStatus,
} from '../services/api';
import { formatDateTime } from '../utils/formatters';

// 'YYYY-MM-DD HH:MM:SS'(항상 KST 고정 — utils/formatters). null/불량 시 '—'.
function fmtDateTime(ts) {
    if (!ts) return '—';
    const out = formatDateTime(ts);
    return out === '-' ? '—' : out;
}

// 방향 배지 — 낮음(AI 과소평가)=파랑 / 높음(AI 과대평가)=주황.
function DirectionBadge({ direction }) {
    const meta =
        direction === '낮음'
            ? { bg: '#EFF8FF', fg: '#175CD3', bd: '#B2DDFF', label: '낮음 · AI 과소평가' }
            : direction === '높음'
              ? { bg: '#FFF6ED', fg: '#C4320A', bd: '#FFD6AE', label: '높음 · AI 과대평가' }
              : { bg: 'var(--muted)', fg: 'var(--ink-500)', bd: 'var(--border)', label: direction || '—' };
    return (
        <span style={{ fontSize: 10.5, fontWeight: 700, background: meta.bg, color: meta.fg, border: `1px solid ${meta.bd}`, padding: '1px 8px', borderRadius: 999, whiteSpace: 'nowrap' }}>
            {meta.label}
        </span>
    );
}

// 케이스 카드 내부 라벨 블록 — 값 없으면 렌더 생략.
function CaseField({ label, text, boxed }) {
    if (!text) return null;
    return (
        <div style={{ marginTop: 7 }}>
            <div style={{ fontSize: 9.5, fontWeight: 800, color: 'var(--ink-400)', letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: 3 }}>{label}</div>
            <div
                style={{
                    fontSize: 11.5, color: 'var(--ink-700)', lineHeight: 1.6, whiteSpace: 'pre-wrap', wordBreak: 'break-word',
                    maxHeight: 150, overflowY: 'auto',
                    background: boxed ? 'var(--muted)' : 'transparent',
                    padding: boxed ? '6px 9px' : 0, borderRadius: boxed ? 6 : 0,
                }}
            >
                {text}
            </div>
        </div>
    );
}

// 생성 근거 케이스 카드 — 상담ID · 방향 배지 · AI점수/만점(원점수) · AI 사유 · 근거 발화 · 콜단위 검수 사유.
function SkillCaseCard({ c }) {
    return (
        <div style={{ border: '1px solid var(--border)', borderRadius: 10, padding: '10px 12px', background: 'white' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--ink-900)', fontFamily: 'var(--font-mono)' }}>
                    상담 {c.consultation_id || '—'}
                </span>
                <DirectionBadge direction={c.direction} />
                <span style={{ fontSize: 11.5, fontWeight: 700, color: 'var(--ink-600)', fontVariantNumeric: 'tabular-nums' }}>
                    AI 점수 {c.ai_score ?? '—'} / {c.max_score ?? '—'}
                </span>
                {c.call_datetime && (
                    <span style={{ fontSize: 11, color: 'var(--ink-400)', marginLeft: 'auto', fontVariantNumeric: 'tabular-nums' }}>{c.call_datetime}</span>
                )}
            </div>
            <CaseField label="AI 판정 사유" text={c.ai_reason} />
            <CaseField label="근거 발화 발췌" text={c.evidence} boxed />
            <CaseField label="검수 사유 (콜 단위)" text={c.call_reason} />
        </div>
    );
}

// 항목 아코디언 — 항목명(#item_number) + changed 배지, 펼치면 overlay md(pre) + 생성 근거 케이스 카드.
function SkillItemAccordion({ item, prevOverlay, hasParent }) {
    const [open, setOpen] = useState(false);
    const cases = Array.isArray(item.cases) ? item.cases : [];
    const curOverlay = item.overlay_md || '';
    const prevOv = prevOverlay || '';
    const overlayChanged = hasParent && prevOv !== curOverlay; // 이전 버전 대비 룰 변경 여부
    return (
        <div style={{ border: '1px solid var(--border)', borderRadius: 10, overflow: 'hidden', background: 'white' }}>
            <button
                type="button"
                onClick={() => setOpen((o) => !o)}
                style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 8, padding: '11px 14px', background: open ? 'var(--muted)' : 'white', border: 0, cursor: 'pointer', fontFamily: 'inherit', textAlign: 'left' }}
            >
                <Icon name="chevron-down" size={14} style={{ color: 'var(--ink-400)', transform: open ? 'none' : 'rotate(-90deg)', transition: 'transform .15s' }} />
                <span style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--ink-900)', whiteSpace: 'nowrap' }}>#{item.item_number}</span>
                {item.item_name && (
                    <span style={{ fontSize: 12.5, color: 'var(--ink-600)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.item_name}</span>
                )}
                <span style={{ marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
                    {cases.length > 0 && (
                        <span style={{ fontSize: 10.5, fontWeight: 600, color: 'var(--ink-500)', background: 'var(--muted)', padding: '1px 8px', borderRadius: 999 }}>케이스 {cases.length}건</span>
                    )}
                    {item.changed ? (
                        <span style={{ fontSize: 10.5, fontWeight: 700, color: '#067647', background: '#ECFDF3', border: '1px solid #ABEFC6', padding: '1px 8px', borderRadius: 999 }}>이번 버전 갱신</span>
                    ) : (
                        <span style={{ fontSize: 10.5, fontWeight: 600, color: 'var(--ink-500)', background: 'var(--muted)', border: '1px solid var(--border)', padding: '1px 8px', borderRadius: 999 }}>이전 버전 룰 승계</span>
                    )}
                </span>
            </button>
            {open && (
                <div style={{ padding: '12px 14px', borderTop: '1px solid var(--border)' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 5 }}>
                        <div style={{ fontSize: 9.5, fontWeight: 800, color: 'var(--ink-400)', letterSpacing: '0.06em', textTransform: 'uppercase' }}>
                            보완 룰 변경 {hasParent ? '(이전 버전 → 이번 버전)' : '(최초 버전)'}
                        </div>
                        {hasParent && (
                            overlayChanged
                                ? <span style={{ fontSize: 10, fontWeight: 700, color: '#067647', background: '#ECFDF3', border: '1px solid #ABEFC6', padding: '0 7px', borderRadius: 999 }}>변경됨</span>
                                : <span style={{ fontSize: 10, fontWeight: 600, color: 'var(--ink-400)', background: 'var(--muted)', border: '1px solid var(--border)', padding: '0 7px', borderRadius: 999 }}>이전 버전과 동일</span>
                        )}
                    </div>
                    {!curOverlay && !prevOv ? (
                        <div style={{ fontSize: 12, color: 'var(--ink-400)' }}>overlay 내용이 비어 있습니다.</div>
                    ) : (
                        /* 평가항목 변경이력과 동일한 GitHub식 2단 diff — 삭제=빨강(이전 칸) / 추가=초록(이번 칸). */
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden' }}>
                            <div style={{ padding: '6px 10px', background: 'var(--muted)', borderRight: '1px solid var(--border)', borderBottom: '1px solid var(--border)', fontSize: 9.5, fontWeight: 800, color: 'var(--ink-500)', letterSpacing: '0.06em', textTransform: 'uppercase' }}>
                                이전 버전 {hasParent ? '' : '(없음)'}
                            </div>
                            <div style={{ padding: '6px 10px', background: 'var(--primary-soft-flat)', borderBottom: '1px solid var(--border)', fontSize: 9.5, fontWeight: 800, color: 'var(--primary)', letterSpacing: '0.06em', textTransform: 'uppercase' }}>
                                이번 버전 {item.changed ? '(갱신)' : '(승계)'}
                            </div>
                            <div style={{ padding: '10px 12px', borderRight: '1px solid var(--border)', background: 'white', fontSize: 11.5, lineHeight: 1.65, whiteSpace: 'pre-wrap', wordBreak: 'break-word', maxHeight: 340, overflowY: 'auto', color: 'var(--ink-700)', fontFamily: 'var(--font-mono)' }}>
                                <DiffText value={hasParent ? prevOv : ''} other={curOverlay} mode="before" />
                            </div>
                            <div style={{ padding: '10px 12px', background: 'white', fontSize: 11.5, lineHeight: 1.65, whiteSpace: 'pre-wrap', wordBreak: 'break-word', maxHeight: 340, overflowY: 'auto', color: 'var(--ink-900)', fontFamily: 'var(--font-mono)' }}>
                                <DiffText value={curOverlay} other={hasParent ? prevOv : ''} mode="after" />
                            </div>
                        </div>
                    )}
                    <div style={{ fontSize: 9.5, fontWeight: 800, color: 'var(--ink-400)', letterSpacing: '0.06em', textTransform: 'uppercase', margin: '14px 0 6px' }}>
                        생성 근거 — 투입 검수 정정 케이스
                    </div>
                    {cases.length === 0 ? (
                        <div style={{ fontSize: 12, color: 'var(--ink-400)' }}>
                            {item.changed ? '보존된 케이스가 없습니다.' : '이번 버전에 투입된 케이스 없음 — 이전 버전 룰을 그대로 승계했습니다.'}
                        </div>
                    ) : (
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 8 }}>
                            {cases.map((c, i) => (
                                <SkillCaseCard key={`${c.consultation_id || 'na'}-${i}`} c={c} />
                            ))}
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}

const SkillPromptManage = () => {
    // 버전 목록/요약 — active_version_id 는 이 목록 응답이 정본(상세 active 플래그보다 우선).
    const [meta, setMeta] = useState(null); // { rubric_id, active_version_id, excluded_items, versions }
    const [listLoading, setListLoading] = useState(true);
    const [listError, setListError] = useState(null);
    // 버전 상세
    const [selectedId, setSelectedId] = useState(null);
    const [detail, setDetail] = useState(null);
    const [prevMap, setPrevMap] = useState({}); // 부모 버전 항목별 overlay_md (item_number → md) — diff 근거
    const [detailLoading, setDetailLoading] = useState(false);
    const [detailError, setDetailError] = useState(null);
    // 학습 진행 표시 — 이 탭은 조회·활성화 전용(수동 트리거는 'AI 평가 배치 > 스킬배치').
    //   다른 화면/스케줄러가 시작한 학습이 진행 중이면 복원 폴링으로 진행 단계를 노출.
    const [learnMsg, setLearnMsg] = useState(null);
    // 활성화/비활성화 요청 중
    const [actBusy, setActBusy] = useState(false);

    const loadVersions = useCallback(async () => {
        setListLoading(true);
        try {
            const r = await fetchSkillVersions();
            if (r?.ok) {
                setMeta({
                    rubric_id: r.rubric_id || null,
                    active_version_id: r.active_version_id ?? null,
                    excluded_items: Array.isArray(r.excluded_items) ? r.excluded_items : [],
                    versions: Array.isArray(r.versions) ? r.versions : [],
                });
                setListError(null);
            } else {
                // rubric_not_found = 아직 한 번도 학습 안 됨 → 오류가 아닌 빈 상태로 표시.
                setMeta({ rubric_id: r?.rubric_id || null, active_version_id: null, excluded_items: [], versions: [] });
                setListError(r?.error === 'rubric_not_found' ? null : r?.error || '버전 목록 로드 실패');
            }
        } catch (e) {
            const msg = e?.message || '';
            if (msg.includes('rubric_not_found')) {
                setMeta({ rubric_id: null, active_version_id: null, excluded_items: [], versions: [] });
                setListError(null);
            } else {
                setListError(msg || '버전 목록 로드 실패');
            }
        } finally {
            setListLoading(false);
        }
    }, []);

    useEffect(() => {
        loadVersions();
    }, [loadVersions]);

    const openDetail = useCallback(async (versionId) => {
        setSelectedId(versionId);
        setDetail(null);
        setPrevMap({});
        setDetailError(null);
        setDetailLoading(true);
        try {
            const r = await fetchSkillVersionDetail(versionId);
            if (r?.ok === false) throw new Error(r?.error || '상세 로드 실패');
            setDetail(r);
            // 부모(직전) 버전의 항목별 overlay 를 당겨 diff(이전→이번) 렌더 근거로 사용.
            //   부모 없음(최초 버전)/로드 실패 시 prevMap 비움 → 전부 신규(초록)로 표시.
            if (r.parent_version_id) {
                try {
                    const p = await fetchSkillVersionDetail(r.parent_version_id);
                    if (p?.ok !== false && Array.isArray(p?.items)) {
                        const map = {};
                        for (const it of p.items) map[it.item_number] = it.overlay_md || '';
                        setPrevMap(map);
                    }
                } catch { /* 부모 로드 실패는 diff 없이 이번 버전 overlay 만 신규로 표시 */ }
            }
        } catch (e) {
            setDetailError(e?.message || '상세 로드 실패');
        } finally {
            setDetailLoading(false);
        }
    }, []);

    // 진행 폴링 루프 — BatchManage 골든 runGoldenPoll 미러(1초 간격, 최대 600회).
    const runSkillPoll = useCallback(() => {
        let tries = 0;
        const poll = async () => {
            tries += 1;
            let s = null;
            try {
                s = await fetchSkillLearnStatus();
            } catch {
                setLearnMsg('학습 진행 중 (상태 확인 불가) — 실시간 로그에서 확인하세요.');
                return;
            }
            if (s?.state === 'running' && tries < 600) {
                if (s.stage_message) setLearnMsg(s.stage_message); // 진행 단계 실시간 표시(수집→생성)
                setTimeout(poll, 1000);
                return;
            }
            if (s?.state === 'done') {
                const rs = s.result || {};
                if (rs.ok === false) {
                    setLearnMsg(rs.error === 'no_correction_cases'
                        ? '정정 케이스(낮음/높음) 없음 — 검수 확정 후 다시 실행'
                        : `학습 실패: ${rs.error || '오류'}`);
                } else {
                    const n = Array.isArray(rs.items_changed) ? rs.items_changed.length : (rs.items_changed ?? 0);
                    setLearnMsg(`스킬 학습 완료 · ${rs.version_id || '?'} · 항목 ${n}개 갱신${rs.activated ? '·활성화' : ''}`);
                }
            } else if (s?.state === 'error') {
                setLearnMsg(s.error === 'no_correction_cases'
                    ? '정정 케이스(낮음/높음) 없음 — 검수 확정 후 다시 실행'
                    : '학습 실패: ' + (s.error || '오류'));
            } else {
                setLearnMsg(null);
            }
            loadVersions(); // 새 버전/활성 상태 반영
        };
        setTimeout(poll, 1000);
    }, [loadVersions]);

    // 마운트 복원 — 다른 화면/스케줄러가 시작한 학습이 진행 중이면 폴링으로 진행 표시(골든 복원 미러).
    useEffect(() => {
        let alive = true;
        (async () => {
            try {
                const s = await fetchSkillLearnStatus();
                if (!alive || s?.state !== 'running') return;
                setLearnMsg('학습 진행 중…');
                runSkillPoll();
            } catch { /* 상태 확인 실패는 무시(복원 생략) */ }
        })();
        return () => { alive = false; };
    }, [runSkillPoll]);

    // 활성화/롤백/비활성화 — versionId=null 이면 전체 비활성화(스킬 끄기).
    const handleActivate = useCallback(async (versionId) => {
        if (versionId == null && !window.confirm('스킬을 전체 비활성화할까요? 평가 시 학습된 보완 룰이 적용되지 않습니다.')) return;
        setActBusy(true);
        try {
            const r = await activateSkillVersion(versionId);
            if (r?.ok === false) throw new Error(r?.error || '요청 실패');
            await loadVersions();
        } catch (e) {
            alert((versionId == null ? '비활성화 실패: ' : '활성화 실패: ') + (e?.message || '오류'));
        } finally {
            setActBusy(false);
        }
    }, [loadVersions]);

    const activeId = meta?.active_version_id ?? null;
    const versions = meta?.versions || [];
    const excludedCount = (meta?.excluded_items || []).length;
    const lastRunAt = versions[0]?.created_at || null; // 버전 목록 최신순 → [0]=마지막 학습(성공) 시각

    const smallBtn = (disabled) => ({
        display: 'inline-flex', alignItems: 'center', gap: 5, padding: '4px 10px', borderRadius: 8,
        border: '1px solid var(--border)', background: 'white', color: 'var(--ink-600)',
        fontSize: 11.5, fontWeight: 600, fontFamily: 'inherit', cursor: disabled ? 'default' : 'pointer',
        whiteSpace: 'nowrap', opacity: disabled ? 0.55 : 1,
    });

    return (
        <div>
            <PageHead
                title="LLM 스킬 관리"
                sub="검수자가 '낮음/높음'으로 정정한 케이스를 학습해 만든 브랜드별·평가항목별 보완 룰(overlay)의 버전을 관리합니다. 활성 버전의 룰이 AI 평가 프롬프트에 주입됩니다."
            >
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    {learnMsg && <span style={{ fontSize: 12, color: 'var(--ink-500)' }}>{learnMsg}</span>}
                    <button
                        type="button"
                        onClick={loadVersions}
                        disabled={listLoading}
                        title="버전 목록/활성 상태 새로고침"
                        style={{ display: 'inline-flex', alignItems: 'center', gap: 7, background: 'white', color: 'var(--ink-600)', border: '1px solid var(--border-strong)', padding: '9px 14px', borderRadius: 9, fontWeight: 700, fontSize: 12.5, cursor: listLoading ? 'default' : 'pointer', fontFamily: 'inherit', opacity: listLoading ? 0.6 : 1 }}
                    >
                        <Icon name="refresh-cw" size={13} /> 새로고침
                    </button>
                </div>
            </PageHead>

            {/* 요약 바 — 활성 버전 / 버전 수 / 제외 항목 수 */}
            <div style={{ display: 'flex', alignItems: 'stretch', gap: 0, flexWrap: 'wrap', border: '1px solid var(--border)', borderRadius: 14, background: 'white', overflow: 'hidden', marginBottom: 14 }}>
                <div style={{ flex: 1.4, minWidth: 220, padding: '14px 20px', display: 'flex', alignItems: 'center', gap: 12, borderRight: '1px solid var(--border)' }}>
                    <span style={{ width: 40, height: 40, borderRadius: 11, background: activeId ? 'var(--primary)' : 'var(--muted)', color: activeId ? 'white' : 'var(--ink-400)', display: 'grid', placeItems: 'center', flexShrink: 0 }}>
                        <Icon name="wand-2" size={19} />
                    </span>
                    <div>
                        <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--ink-400)', letterSpacing: '0.04em' }}>활성 버전</div>
                        <div style={{ fontSize: 14, fontWeight: 800, color: activeId ? 'var(--ink-900)' : 'var(--ink-400)', fontFamily: 'var(--font-mono)' }}>
                            {activeId || '없음 (스킬 미적용)'}
                        </div>
                    </div>
                </div>
                <div style={{ flex: 1, minWidth: 140, padding: '14px 20px', borderRight: '1px solid var(--border)' }}>
                    <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--ink-400)', letterSpacing: '0.04em' }}>버전 수</div>
                    <div style={{ fontSize: 14, fontWeight: 800, color: 'var(--ink-900)', fontVariantNumeric: 'tabular-nums' }}>{versions.length}개</div>
                </div>
                <div style={{ flex: 1.4, minWidth: 180, padding: '14px 20px', borderRight: '1px solid var(--border)' }}>
                    <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--ink-400)', letterSpacing: '0.04em' }}>마지막 학습</div>
                    <div style={{ fontSize: 14, fontWeight: 800, color: lastRunAt ? 'var(--ink-900)' : 'var(--ink-400)', fontVariantNumeric: 'tabular-nums' }}>
                        {lastRunAt ? fmtDateTime(lastRunAt) : '미학습'}
                    </div>
                </div>
                <div style={{ flex: 1.6, minWidth: 200, padding: '14px 20px' }}>
                    <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--ink-400)', letterSpacing: '0.04em' }}>스킬 제외 항목</div>
                    <div style={{ fontSize: 14, fontWeight: 800, color: 'var(--ink-900)', fontVariantNumeric: 'tabular-nums' }}>
                        {excludedCount}개
                        <span style={{ fontSize: 11, fontWeight: 500, color: 'var(--ink-400)', marginLeft: 8 }}>제외 항목 설정은 'AI 평가 배치 &gt; 스킬배치' 탭에서</span>
                    </div>
                </div>
            </div>

            {/* 버전 리스트 */}
            <div className="panel" style={{ padding: 0, marginBottom: 14 }}>
                <div className="panel-head">
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <Icon name="history" size={15} style={{ color: 'var(--ink-500)' }} />
                        <h3>스킬 버전 (최신순)</h3>
                    </div>
                    <span className="muted-text" style={{ fontSize: 12, marginLeft: 'auto' }}>행을 클릭하면 항목별 overlay 와 생성 근거 케이스를 확인합니다</span>
                </div>
                <div style={{ padding: versions.length === 0 ? 18 : 0 }}>
                    {listError && <div style={{ fontSize: 12.5, color: '#D92D20', padding: versions.length === 0 ? 0 : '12px 18px 0' }}>{listError}</div>}
                    {listLoading && versions.length === 0 ? (
                        <div style={{ fontSize: 12.5, color: 'var(--ink-400)' }}>버전 목록 로딩 중…</div>
                    ) : versions.length === 0 ? (
                        !listError && (
                            <div style={{ fontSize: 12.5, color: 'var(--ink-400)' }}>
                                아직 학습된 스킬 버전이 없습니다. 검수 확정(승인) 콜에 '낮음/높음' 정정이 쌓이면 '지금 학습'으로 첫 버전을 생성하세요.
                            </div>
                        )
                    ) : (
                        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
                            <thead>
                                <tr style={{ borderBottom: '1px solid var(--border)', background: 'var(--muted)' }}>
                                    <th style={{ padding: '9px 14px', textAlign: 'left', fontSize: 11, fontWeight: 700, color: 'var(--ink-500)' }}>버전</th>
                                    <th style={{ padding: '9px 14px', textAlign: 'left', fontSize: 11, fontWeight: 700, color: 'var(--ink-500)' }}>라벨</th>
                                    <th style={{ padding: '9px 14px', textAlign: 'left', fontSize: 11, fontWeight: 700, color: 'var(--ink-500)' }}>생성 시각</th>
                                    <th style={{ padding: '9px 14px', textAlign: 'left', fontSize: 11, fontWeight: 700, color: 'var(--ink-500)' }}>모델</th>
                                    <th style={{ padding: '9px 14px', textAlign: 'right', fontSize: 11, fontWeight: 700, color: 'var(--ink-500)' }}>케이스</th>
                                    <th style={{ padding: '9px 14px', textAlign: 'right', fontSize: 11, fontWeight: 700, color: 'var(--ink-500)' }}>갱신 항목</th>
                                    <th style={{ padding: '9px 14px', textAlign: 'left', fontSize: 11, fontWeight: 700, color: 'var(--ink-500)' }}>상태</th>
                                    <th style={{ padding: '9px 14px', textAlign: 'right', fontSize: 11, fontWeight: 700, color: 'var(--ink-500)' }}></th>
                                </tr>
                            </thead>
                            <tbody>
                                {versions.map((v) => {
                                    const isActive = v.version_id === activeId;
                                    const isSelected = v.version_id === selectedId;
                                    const changed = Array.isArray(v.items_changed) ? v.items_changed.length : (v.items_changed ?? 0);
                                    return (
                                        <tr
                                            key={v.version_id}
                                            onClick={() => openDetail(v.version_id)}
                                            style={{ borderBottom: '1px solid var(--border)', cursor: 'pointer', background: isSelected ? 'var(--primary-soft-flat)' : 'white' }}
                                        >
                                            <td style={{ padding: '9px 14px', fontWeight: 700, color: 'var(--ink-900)', fontFamily: 'var(--font-mono)', whiteSpace: 'nowrap' }}>{v.version_id}</td>
                                            <td style={{ padding: '9px 14px', color: 'var(--ink-600)' }}>{v.label || '—'}</td>
                                            <td style={{ padding: '9px 14px', color: 'var(--ink-500)', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>{fmtDateTime(v.created_at)}</td>
                                            <td style={{ padding: '9px 14px', color: 'var(--ink-500)', fontSize: 11.5, fontFamily: 'var(--font-mono)', wordBreak: 'break-all' }}>{v.model_id || '—'}</td>
                                            <td style={{ padding: '9px 14px', textAlign: 'right', color: 'var(--ink-600)', fontVariantNumeric: 'tabular-nums' }}>{v.case_count ?? '—'}</td>
                                            <td style={{ padding: '9px 14px', textAlign: 'right', color: 'var(--ink-600)', fontVariantNumeric: 'tabular-nums' }}>
                                                {changed}{v.item_count != null ? ` / ${v.item_count}` : ''}
                                            </td>
                                            <td style={{ padding: '9px 14px', whiteSpace: 'nowrap' }}>
                                                {isActive ? (
                                                    <span style={{ fontSize: 10.5, fontWeight: 800, color: '#067647', background: '#ECFDF3', border: '1px solid #ABEFC6', padding: '2px 9px', borderRadius: 999 }}>활성</span>
                                                ) : (
                                                    <span style={{ fontSize: 10.5, fontWeight: 600, color: 'var(--ink-400)' }}>{v.source === 'schedule' ? '스케줄' : '수동'}</span>
                                                )}
                                            </td>
                                            <td style={{ padding: '9px 14px', textAlign: 'right', whiteSpace: 'nowrap' }}>
                                                {isActive ? (
                                                    <button
                                                        type="button"
                                                        disabled={actBusy}
                                                        onClick={(ev) => { ev.stopPropagation(); handleActivate(null); }}
                                                        title="스킬 전체 비활성화 — 평가 시 overlay 미적용"
                                                        style={smallBtn(actBusy)}
                                                    >
                                                        <Icon name="power-off" size={11} /> 비활성화
                                                    </button>
                                                ) : (
                                                    <button
                                                        type="button"
                                                        disabled={actBusy}
                                                        onClick={(ev) => { ev.stopPropagation(); handleActivate(v.version_id); }}
                                                        title="이 버전을 활성화(롤백 포함) — 평가 시 이 버전의 overlay 적용"
                                                        style={smallBtn(actBusy)}
                                                    >
                                                        <Icon name="check" size={11} /> 이 버전 활성화
                                                    </button>
                                                )}
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    )}
                </div>
            </div>

            {/* 버전 상세 — 항목별 아코디언(overlay md + 생성 근거 케이스) */}
            {selectedId && (
                <div className="panel" style={{ padding: 0 }}>
                    <div className="panel-head">
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                            <Icon name="file-text" size={15} style={{ color: 'var(--ink-500)' }} />
                            <h3 style={{ whiteSpace: 'nowrap' }}>버전 상세</h3>
                            <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--ink-600)', fontFamily: 'var(--font-mono)' }}>{selectedId}</span>
                            {selectedId === activeId && (
                                <span style={{ fontSize: 10.5, fontWeight: 800, color: '#067647', background: '#ECFDF3', border: '1px solid #ABEFC6', padding: '2px 9px', borderRadius: 999 }}>활성</span>
                            )}
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginLeft: 'auto' }}>
                            {selectedId === activeId ? (
                                <>
                                    <span className="muted-text" style={{ fontSize: 11.5 }}>현재 활성 버전 — 다른 버전의 '이 버전 활성화'로 롤백할 수 있습니다</span>
                                    <button type="button" disabled={actBusy} onClick={() => handleActivate(null)} style={smallBtn(actBusy)}>
                                        <Icon name="power-off" size={11} /> 비활성화 (스킬 끄기)
                                    </button>
                                </>
                            ) : (
                                <button type="button" disabled={actBusy} onClick={() => handleActivate(selectedId)} style={smallBtn(actBusy)}>
                                    <Icon name="check" size={11} /> 이 버전 활성화
                                </button>
                            )}
                        </div>
                    </div>
                    <div style={{ padding: 18 }}>
                        {detailLoading ? (
                            <div style={{ fontSize: 12.5, color: 'var(--ink-400)' }}>상세 로딩 중…</div>
                        ) : detailError ? (
                            <div style={{ fontSize: 12.5, color: '#D92D20' }}>{detailError}</div>
                        ) : !detail ? (
                            <div style={{ fontSize: 12.5, color: 'var(--ink-400)' }}>상세 데이터가 없습니다.</div>
                        ) : (
                            <>
                                <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap', fontSize: 11.5, color: 'var(--ink-500)', marginBottom: 12 }}>
                                    <span>라벨: <b style={{ color: 'var(--ink-700)' }}>{detail.label || '—'}</b></span>
                                    <span>생성: <b style={{ color: 'var(--ink-700)', fontVariantNumeric: 'tabular-nums' }}>{fmtDateTime(detail.created_at)}</b></span>
                                    <span>모델: <b style={{ color: 'var(--ink-700)', fontFamily: 'var(--font-mono)' }}>{detail.model_id || '—'}</b></span>
                                    <span>투입 케이스: <b style={{ color: 'var(--ink-700)', fontVariantNumeric: 'tabular-nums' }}>{detail.case_count ?? '—'}건</b></span>
                                    {detail.parent_version_id && (
                                        <span>부모 버전: <b style={{ color: 'var(--ink-700)', fontFamily: 'var(--font-mono)' }}>{detail.parent_version_id}</b></span>
                                    )}
                                </div>
                                {Array.isArray(detail.items) && detail.items.length > 0 ? (
                                    <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 8 }}>
                                        {detail.items.map((it) => (
                                            <SkillItemAccordion
                                                key={it.item_number}
                                                item={it}
                                                prevOverlay={prevMap[it.item_number]}
                                                hasParent={!!detail.parent_version_id}
                                            />
                                        ))}
                                    </div>
                                ) : (
                                    <div style={{ fontSize: 12.5, color: 'var(--ink-400)' }}>이 버전에 포함된 항목이 없습니다.</div>
                                )}
                            </>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
};

export default SkillPromptManage;
