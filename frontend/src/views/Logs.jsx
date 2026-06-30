import React, { useEffect, useRef, useState } from 'react';
import { Loader2, Pause, Play, RefreshCw, ChevronDown, ListChecks, Terminal, Sparkles } from 'lucide-react';
import Header from '../components/Header';
import { fetchAuditLogs, fetchAppLogsRecent, fetchRagLogRecent } from '../services/api';

const POLL_INTERVAL_MS = 5000;
const PAGE_SIZE = 100;
const APP_LOG_LIMIT = 500;
// 서버 보관: 3일 (qa_audit_logs prune 주기 / winston-daily-rotate-file maxFiles=3d 동일) / 화면 노출: 1일
const VIEW_WINDOW_DAYS = 1;

const ACTION_TONES = {
    AUTH_LOGIN_SUCCESS: 'bg-green-50 text-green-700',
    AUTH_LOGIN_FAIL: 'bg-red-50 text-red-700',
    AUTH_LOGOUT: 'bg-gray-100 text-gray-600',
    QA_MANUAL_EVAL_SAVE: 'bg-blue-50 text-blue-700',
    QA_ADMIN_COMMENTS_SAVE: 'bg-blue-50 text-blue-700',
    SAMPLE_INGEST: 'bg-amber-50 text-amber-700',
    SAMPLE_CLEAR: 'bg-amber-50 text-amber-700',
    INGEST_AI_CANVAS: 'bg-amber-50 text-amber-700',
    INGEST_COLLECTION_CALL: 'bg-amber-50 text-amber-700',
    BRAND_CREATE: 'bg-indigo-50 text-indigo-700',
    BRAND_UPDATE: 'bg-indigo-50 text-indigo-700',
    BRAND_DELETE: 'bg-indigo-50 text-indigo-700',
    USER_CREATE: 'bg-purple-50 text-purple-700',
    USER_UPDATE: 'bg-purple-50 text-purple-700',
    USER_DELETE: 'bg-purple-50 text-purple-700',
    DOMAIN_CREATE: 'bg-teal-50 text-teal-700',
    DOMAIN_UPDATE: 'bg-teal-50 text-teal-700',
    DOMAIN_DELETE: 'bg-teal-50 text-teal-700',
};

const ACTION_OPTIONS = [
    { value: '', label: '전체 액션' },
    { value: 'AUTH_LOGIN_SUCCESS', label: '로그인 성공' },
    { value: 'AUTH_LOGIN_FAIL', label: '로그인 실패' },
    { value: 'AUTH_LOGOUT', label: '로그아웃' },
    { value: 'QA_MANUAL_EVAL_SAVE', label: '평가 저장' },
    { value: 'SAMPLE_INGEST', label: '샘플 적재' },
    { value: 'SAMPLE_CLEAR', label: '샘플 일괄 삭제' },
    { value: 'INGEST_AI_CANVAS', label: 'AI Canvas 적재' },
    { value: 'INGEST_COLLECTION_CALL', label: '외부 콜 적재' },
    { value: 'BRAND_CREATE', label: '브랜드 생성' },
    { value: 'BRAND_UPDATE', label: '브랜드 수정' },
    { value: 'BRAND_DELETE', label: '브랜드 삭제' },
    { value: 'USER_CREATE', label: '사용자 생성' },
    { value: 'USER_UPDATE', label: '사용자 수정' },
    { value: 'USER_DELETE', label: '사용자 삭제' },
    { value: 'DOMAIN_CREATE', label: '도메인 생성' },
    { value: 'DOMAIN_UPDATE', label: '도메인 수정' },
    { value: 'DOMAIN_DELETE', label: '도메인 삭제' },
];

const LEVEL_TONES = {
    DEBUG: 'bg-gray-100 text-gray-600',
    INFO: 'bg-blue-50 text-blue-700',
    WARNING: 'bg-amber-50 text-amber-700',
    WARN: 'bg-amber-50 text-amber-700',
    ERROR: 'bg-red-50 text-red-700',
    CRITICAL: 'bg-red-100 text-red-800',
};

function ActionChip({ action }) {
    const tone = ACTION_TONES[action] || 'bg-[#F2F4F7] text-[#667085]';
    return (
        <span className={`inline-flex items-center px-2 py-0.5 rounded-md text-[11px] font-semibold font-mono ${tone}`}>
            {action}
        </span>
    );
}

function LevelChip({ level }) {
    const tone = LEVEL_TONES[String(level || '').toUpperCase()] || 'bg-[#F2F4F7] text-[#667085]';
    return (
        <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold font-mono ${tone}`}>
            {level || '—'}
        </span>
    );
}

function fmtTime(iso) {
    if (!iso) return '—';
    const d = new Date(iso);
    return d.toLocaleString('ko-KR', {
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
    });
}

/* ── Audit 패널 (DB qa_audit_logs) ───────────────────────── */
function AuditPanel() {
    const [logs, setLogs] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [paused, setPaused] = useState(false);
    const [actionFilter, setActionFilter] = useState('');
    const [loadingMore, setLoadingMore] = useState(false);
    const seenIdsRef = useRef(new Set());

    async function loadInitial() {
        setLoading(true);
        try {
            const rows = await fetchAuditLogs({ limit: PAGE_SIZE, action: actionFilter || undefined });
            setLogs(rows);
            seenIdsRef.current = new Set(rows.map((r) => r.audit_id));
            setError(null);
        } catch (e) {
            setError(e?.message || '로그 로드 실패');
        } finally {
            setLoading(false);
        }
    }

    async function tailNew() {
        try {
            const rows = await fetchAuditLogs({ limit: PAGE_SIZE, action: actionFilter || undefined });
            const fresh = rows.filter((r) => !seenIdsRef.current.has(r.audit_id));
            if (fresh.length === 0) return;
            for (const r of fresh) seenIdsRef.current.add(r.audit_id);
            setLogs((prev) => [...fresh, ...prev].slice(0, 500));
        } catch (e) {
            console.error('audit tail error:', e);
        }
    }

    async function loadMore() {
        if (loadingMore || logs.length === 0) return;
        setLoadingMore(true);
        try {
            const last = logs[logs.length - 1];
            const more = await fetchAuditLogs({
                limit: PAGE_SIZE,
                before: last.audit_id,
                action: actionFilter || undefined,
            });
            for (const r of more) seenIdsRef.current.add(r.audit_id);
            setLogs((prev) => [...prev, ...more]);
        } catch (e) {
            setError(e?.message || '추가 로드 실패');
        } finally {
            setLoadingMore(false);
        }
    }

    useEffect(() => {
        loadInitial();
    }, [actionFilter]);

    useEffect(() => {
        if (paused) return;
        const id = setInterval(tailNew, POLL_INTERVAL_MS);
        return () => clearInterval(id);
    }, [paused, actionFilter]);

    return (
        <>
            <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 text-[12px] text-[#667085]">
                    <span className="inline-flex items-center gap-1.5">
                        <span className={`w-2 h-2 rounded-full ${paused ? 'bg-gray-400' : 'bg-green-500 animate-pulse'}`} />
                        {paused ? '갱신 일시정지' : `자동 갱신 중 (${POLL_INTERVAL_MS / 1000}초)`}
                    </span>
                    <span>·</span>
                    <span>총 {logs.length}건 표시</span>
                </div>
                <div className="flex items-center gap-2">
                    <select
                        value={actionFilter}
                        onChange={(e) => setActionFilter(e.target.value)}
                        className="h-[34px] px-3 rounded-xl border border-[#E4E7EC] bg-white text-[12.5px] outline-none focus:border-[#055AAF] cursor-pointer text-[#101828]"
                    >
                        {ACTION_OPTIONS.map((opt) => (
                            <option key={opt.value || 'all'} value={opt.value}>
                                {opt.label}
                            </option>
                        ))}
                    </select>
                    <button
                        onClick={() => setPaused((v) => !v)}
                        className="inline-flex items-center gap-1.5 h-[34px] px-3.5 rounded-full border border-[#E4E7EC] bg-white text-[12.5px] font-semibold text-[#101828] hover:bg-[#F2F4F7] cursor-pointer"
                    >
                        {paused ? <Play size={12} /> : <Pause size={12} />}
                        {paused ? '재개' : '일시정지'}
                    </button>
                    <button
                        onClick={loadInitial}
                        className="inline-flex items-center gap-1.5 h-[34px] px-3.5 rounded-full bg-[#055AAF] text-white text-[12.5px] font-semibold hover:bg-[#1E70E0] shadow-sm cursor-pointer"
                    >
                        <RefreshCw size={12} /> 새로고침
                    </button>
                </div>
            </div>

            {loading ? (
                <div className="flex justify-center py-12">
                    <Loader2 className="h-5 w-5 animate-spin text-[#667085]" />
                </div>
            ) : (
                <>
                    {error && <p className="text-sm text-[#D92D20]">{error}</p>}
                    <div className="bg-white border border-[#E4E7EC] rounded-xl overflow-hidden">
                        <table className="w-full text-sm">
                            <thead>
                                <tr className="border-b border-[#E4E7EC] bg-[#F9FAFB]">
                                    <th className="px-3 py-2.5 text-left text-[11px] font-semibold text-[#667085] uppercase tracking-wider w-[140px]">시각</th>
                                    <th className="px-3 py-2.5 text-left text-[11px] font-semibold text-[#667085] uppercase tracking-wider w-[180px]">액션</th>
                                    <th className="px-3 py-2.5 text-left text-[11px] font-semibold text-[#667085] uppercase tracking-wider w-[140px]">수행자</th>
                                    <th className="px-3 py-2.5 text-left text-[11px] font-semibold text-[#667085] uppercase tracking-wider w-[80px]">역할</th>
                                    <th className="px-3 py-2.5 text-left text-[11px] font-semibold text-[#667085] uppercase tracking-wider">자원</th>
                                    <th className="px-3 py-2.5 text-left text-[11px] font-semibold text-[#667085] uppercase tracking-wider w-[100px]">IP</th>
                                    <th className="px-3 py-2.5 text-center text-[11px] font-semibold text-[#667085] uppercase tracking-wider w-[60px]">결과</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-[#E4E7EC] font-mono">
                                {logs.length === 0 && (
                                    <tr>
                                        <td colSpan={7} className="px-3 py-10 text-center text-sm text-[#667085]">
                                            로그가 없습니다
                                        </td>
                                    </tr>
                                )}
                                {logs.map((l) => (
                                    <tr key={l.audit_id} className="hover:bg-[#F9FAFB]">
                                        <td className="px-3 py-2 text-[11.5px] text-[#667085] tabular-nums">{fmtTime(l.created_at)}</td>
                                        <td className="px-3 py-2"><ActionChip action={l.action} /></td>
                                        <td className="px-3 py-2 text-[12px] text-[#101828]">{l.login_id || '—'}</td>
                                        <td className="px-3 py-2 text-[11px] text-[#667085]">{l.role || '—'}</td>
                                        <td className="px-3 py-2 text-[12px] text-[#475467]">
                                            <span className="font-semibold">{l.resource_type}</span>
                                            {l.resource_id && <span className="text-[#667085]">/{l.resource_id}</span>}
                                            {l.http_method && (
                                                <span className="ml-1.5 inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold bg-[#F2F4F7] text-[#667085]">
                                                    {l.http_method}
                                                </span>
                                            )}
                                        </td>
                                        <td className="px-3 py-2 text-[11px] text-[#98A2B3] tabular-nums">{l.client_ip || '—'}</td>
                                        <td className="px-3 py-2 text-center">
                                            {l.success === 1 || l.success === true ? (
                                                <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold bg-green-50 text-green-700">OK</span>
                                            ) : (
                                                <span title={l.error_message || ''} className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold bg-red-50 text-red-700">FAIL</span>
                                            )}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                        {logs.length >= PAGE_SIZE && (
                            <div className="px-4 py-3 border-t border-[#E4E7EC] bg-[#F9FAFB] flex justify-center">
                                <button
                                    onClick={loadMore}
                                    disabled={loadingMore}
                                    className="inline-flex items-center gap-1.5 h-[32px] px-4 rounded-full border border-[#E4E7EC] bg-white text-[12px] font-semibold text-[#101828] hover:bg-[#F2F4F7] cursor-pointer disabled:opacity-50"
                                >
                                    {loadingMore ? <Loader2 size={12} className="animate-spin" /> : <ChevronDown size={12} />}
                                    {loadingMore ? '로드 중...' : '이전 100건 더 보기'}
                                </button>
                            </div>
                        )}
                    </div>
                </>
            )}
        </>
    );
}

/* ── App 패널 (winston 파일 로그) ────────────────────────── */
function AppPanel() {
    const [file, setFile] = useState('');
    const [exists, setExists] = useState(false);
    const [lines, setLines] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [paused, setPaused] = useState(false);
    const [levelFilter, setLevelFilter] = useState('');
    const lastFingerprintRef = useRef('');

    async function load() {
        try {
            const data = await fetchAppLogsRecent({ limit: APP_LOG_LIMIT });
            setFile(data.file || '');
            setExists(Boolean(data.exists));
            const incoming = Array.isArray(data.lines) ? data.lines : [];
            // 변경 감지용 fingerprint: 마지막 5줄의 ts+message 해시 대체로 join
            const fp = incoming.slice(-5).map((l) => `${l.ts}|${l.message}`).join('§');
            if (fp !== lastFingerprintRef.current) {
                lastFingerprintRef.current = fp;
                setLines(incoming);
            }
            setError(null);
        } catch (e) {
            setError(e?.message || '앱 로그 로드 실패');
        } finally {
            setLoading(false);
        }
    }

    useEffect(() => {
        load();
    }, []);

    useEffect(() => {
        if (paused) return;
        const id = setInterval(load, POLL_INTERVAL_MS);
        return () => clearInterval(id);
    }, [paused]);

    const filtered = levelFilter
        ? lines.filter((l) => String(l.level || '').toUpperCase() === levelFilter)
        : lines;

    return (
        <>
            <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 text-[12px] text-[#667085]">
                    <span className="inline-flex items-center gap-1.5">
                        <span className={`w-2 h-2 rounded-full ${paused ? 'bg-gray-400' : 'bg-green-500 animate-pulse'}`} />
                        {paused ? '갱신 일시정지' : `자동 갱신 중 (${POLL_INTERVAL_MS / 1000}초)`}
                    </span>
                    <span>·</span>
                    <span className="font-mono">{exists ? file : '(파일 없음)'} · {filtered.length}줄</span>
                </div>
                <div className="flex items-center gap-2">
                    <select
                        value={levelFilter}
                        onChange={(e) => setLevelFilter(e.target.value)}
                        className="h-[34px] px-3 rounded-xl border border-[#E4E7EC] bg-white text-[12.5px] outline-none focus:border-[#055AAF] cursor-pointer text-[#101828]"
                    >
                        <option value="">전체 레벨</option>
                        <option value="INFO">INFO</option>
                        <option value="WARN">WARN</option>
                        <option value="WARNING">WARNING</option>
                        <option value="ERROR">ERROR</option>
                        <option value="DEBUG">DEBUG</option>
                    </select>
                    <button
                        onClick={() => setPaused((v) => !v)}
                        className="inline-flex items-center gap-1.5 h-[34px] px-3.5 rounded-full border border-[#E4E7EC] bg-white text-[12.5px] font-semibold text-[#101828] hover:bg-[#F2F4F7] cursor-pointer"
                    >
                        {paused ? <Play size={12} /> : <Pause size={12} />}
                        {paused ? '재개' : '일시정지'}
                    </button>
                    <button
                        onClick={load}
                        className="inline-flex items-center gap-1.5 h-[34px] px-3.5 rounded-full bg-[#055AAF] text-white text-[12.5px] font-semibold hover:bg-[#1E70E0] shadow-sm cursor-pointer"
                    >
                        <RefreshCw size={12} /> 새로고침
                    </button>
                </div>
            </div>

            {loading ? (
                <div className="flex justify-center py-12">
                    <Loader2 className="h-5 w-5 animate-spin text-[#667085]" />
                </div>
            ) : (
                <>
                    {error && <p className="text-sm text-[#D92D20]">{error}</p>}
                    <div className="bg-[#0B1220] text-[#E5E7EB] border border-[#1F2A44] rounded-xl overflow-hidden">
                        <div className="max-h-[68vh] overflow-y-auto font-mono text-[12px] leading-relaxed">
                            {filtered.length === 0 ? (
                                <div className="px-4 py-10 text-center text-[#94A3B8]">표시할 로그가 없습니다</div>
                            ) : (
                                <table className="w-full">
                                    <tbody>
                                        {filtered.map((l, idx) => (
                                            <tr key={`${l.ts}-${idx}`} className="border-b border-[#1F2A44]/60 last:border-0">
                                                <td className="px-3 py-1.5 align-top text-[#94A3B8] whitespace-nowrap w-[160px]">
                                                    {l.ts || '—'}
                                                </td>
                                                <td className="px-2 py-1.5 align-top w-[80px]">
                                                    <LevelChip level={l.level} />
                                                </td>
                                                <td className="px-2 py-1.5 align-top text-[#7DD3FC] whitespace-nowrap w-[200px] truncate" title={l.module}>
                                                    {l.module || '—'}
                                                </td>
                                                <td className="px-2 py-1.5 align-top text-[#E5E7EB] break-all">
                                                    {l.message}
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            )}
                        </div>
                    </div>
                </>
            )}
        </>
    );
}

/* ── RAG · 사전 패널 (백엔드 인메모리 링버퍼) ──────────────── */
function fmtRagTime(ts) {
    if (!ts) return '—';
    const d = new Date(ts);
    if (Number.isNaN(d.getTime())) return '—';
    return d.toLocaleString('ko-KR', {
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
    });
}

/* ──────────────────────────────────────────────────────────────────────────
 * 골든셋 RAG 리치 카드 — chatbot-ui-next UnifiedRagPanel 이식(TSX→JSX, 인라인 색상).
 *  · 항목(item_number)별 접이식 토글(기본 접힘) → 버킷(full/partial/zero) 그룹 → 카드.
 *  · 카드 섹션(STT 원문·색인요약·근거발화·검수자코멘트)은 각각 펼치기/접기 토글.
 * ────────────────────────────────────────────────────────────────────────── */

const _DASH_LINE_RE = /^[\-=*_~·•\s]{3,}$/;
function stripSeparatorLines(text) {
    if (!text) return '';
    const out = [];
    for (const raw of String(text).split('\n')) {
        const s = raw.trim();
        if (s && _DASH_LINE_RE.test(s)) continue;
        out.push(raw.replace(/\s+$/, ''));
    }
    const compact = [];
    let prevBlank = false;
    for (const ln of out) {
        const blank = !ln.trim();
        if (blank && prevBlank) continue;
        compact.push(ln);
        prevBlank = blank;
    }
    return compact.join('\n').trim();
}

function RagSourceBadge({ source }) {
    const meta =
        source === 'hitl'
            ? { label: '📚 HITL', title: 'qa-hitl-cases — 운영 검수 누적', bg: '#fef3c7', fg: '#92400e' }
            : source === 'self_match'
              ? { label: '🔁 동일상담', title: '현재 평가 중인 원문 자체 매칭', bg: '#fee2e2', fg: '#b91c1c' }
              : { label: '🌱 골든셋', title: 'qa-golden-set — 사람 검수 정답', bg: '#dcfce7', fg: '#166534' };
    return (
        <span
            title={meta.title}
            style={{ fontSize: 9.5, fontWeight: 700, background: meta.bg, color: meta.fg, padding: '1px 9px', borderRadius: 999, letterSpacing: '0.04em' }}
        >
            {meta.label}
        </span>
    );
}

function RagSimilarityChips({ hit }) {
    const chips = [];
    const cos = hit.cosine_score;
    if (cos != null && Number.isFinite(cos)) {
        chips.push(
            <span key="cos" title="cosine 의미 유사도 (0~1)" style={{ fontSize: 9.5, fontWeight: 700, background: '#eff6ff', color: '#1e40af', padding: '1px 7px', borderRadius: 999 }}>
                cos {Number(cos).toFixed(2)}
            </span>,
        );
    }
    const rrf = hit.rrf_score;
    if (rrf != null && Number.isFinite(rrf)) {
        const RRF_MAX = 2 / 61;
        const rrfNorm = Math.min(1, Math.max(0, Number(rrf) / RRF_MAX));
        chips.push(
            <span key="rrf" title={`RRF(BM25+KNN) 0~1 정규화 · raw=${Number(rrf).toFixed(4)}`} style={{ fontSize: 9.5, fontWeight: 600, background: '#f2f4f7', color: '#475467', padding: '1px 7px', borderRadius: 999 }}>
                rrf {rrfNorm.toFixed(2)}
            </span>,
        );
    }
    const rr = hit.cohere_rerank_score;
    const isCohere = hit.rerank_provider === 'cohere';
    const skip = hit.rerank_skipped_reason;
    if (skip) {
        const txt =
            skip === 'bucket_le_quota' ? '🤖 bucket 직채택' : skip === 'disabled' ? '🤖 reranker OFF' : skip === 'leftover_fill' ? '🤖 leftover 채택' : '🤖 rerank 폴백';
        chips.push(
            <span key="rerank-skip" title={`rerank 스킵: ${skip}`} style={{ fontSize: 9.5, fontWeight: 600, background: '#f3f4f6', color: '#6b7280', padding: '1px 7px', borderRadius: 999 }}>
                {txt}
            </span>,
        );
    } else if (rr != null && Number.isFinite(rr) && Number(rr) > 0) {
        chips.push(
            <span
                key="rerank"
                title={`${isCohere ? 'Cohere Rerank 3.5' : 'LLM(Haiku 4.5) reranker'} · 0~10 스케일(raw=${Number(rr).toFixed(4)})`}
                style={{ fontSize: 9.5, fontWeight: 700, background: isCohere ? '#dcfce7' : '#dbeafe', color: isCohere ? '#166534' : '#1e40af', padding: '1px 7px', borderRadius: 999 }}
            >
                {isCohere ? '🪶 Cohere' : '🤖 Haiku'} rerank {(Number(rr) * 10).toFixed(1)}/10
            </span>,
        );
    }
    if (chips.length === 0) return null;
    return <span style={{ display: 'inline-flex', gap: 4, flexWrap: 'wrap' }}>{chips}</span>;
}

function RagCardSection({ eyebrow, body, tone = 'default', defaultOpen = true, previewChars }) {
    const [open, setOpen] = useState(defaultOpen);
    if (!body) return null;
    const previewBody = previewChars != null && body.length > previewChars ? body.slice(0, previewChars).trimEnd() + ' …' : body;
    const visible = open ? body : previewChars != null ? previewBody : '';
    return (
        <div
            style={{
                marginTop: 6,
                padding: tone === 'info' ? '6px 8px' : '0 0 0 4px',
                background: tone === 'info' ? '#eff8ff' : 'transparent',
                border: tone === 'info' ? '1px solid #b2ddff' : 'none',
                borderRadius: tone === 'info' ? 6 : 0,
            }}
        >
            <div style={{ fontSize: 9, fontWeight: 700, color: '#667085', marginBottom: 3, textTransform: 'uppercase', letterSpacing: '0.08em', display: 'flex', alignItems: 'center', gap: 5 }}>
                <span>{eyebrow}</span>
                <button
                    type="button"
                    onClick={() => setOpen((o) => !o)}
                    style={{ fontSize: 9, padding: '0 5px', background: 'transparent', border: '1px solid #e4e7ec', borderRadius: 3, cursor: 'pointer', color: '#667085' }}
                >
                    {open ? '접기' : '펼치기'}
                </button>
            </div>
            {visible && <div style={{ fontSize: 11, color: '#344054', whiteSpace: 'pre-wrap', wordBreak: 'break-word', lineHeight: 1.55 }}>{visible}</div>}
        </div>
    );
}

function RagGoldenCard({ hit }) {
    const source = hit.source || (hit.rater_type === 'hitl' ? 'hitl' : hit.is_self_match ? 'self_match' : 'golden_set');
    const isSelf = source === 'self_match';
    const _trim = (s) => String(s || '').trim();
    const segBody = _trim(hit.segment_text) || _trim(hit.transcript_excerpt);
    const noteBody = _trim(hit.rationale) || _trim(hit.human_note);
    const debugSummary = JSON.stringify(
        {
            segment_text_len: (hit.segment_text || '').length,
            parsed_text_len: (hit.parsed_text || '').length,
            rationale_len: (hit.rationale || '').length,
            index_summary_len: (hit.index_summary || '').length,
            reranker: hit.rerank_provider ?? null,
            rr: hit.cohere_rerank_score ?? null,
            rerank_skipped_reason: hit.rerank_skipped_reason ?? null,
        },
        null,
        2,
    );
    // 색인 요약 = AOSS BM25/KNN 색인된 구조 요약(원문/근거발화와 별개). 비어있으면 재구성하지
    // 않고 섹션 숨김 — segment+rationale 재구성은 근거발화·검수자코멘트와 중복돼 혼란 유발(사용자 지적).
    const idxBody = stripSeparatorLines(_trim(hit.index_summary).replace(/\s+\|\s+/g, '\n'));
    return (
        <div
            style={{
                marginBottom: 8,
                padding: '10px 12px',
                background: isSelf ? '#fee2e2' : '#ffffff',
                border: `1px solid ${isSelf ? '#fecaca' : '#e4e7ec'}`,
                borderLeft: `3px solid ${isSelf ? '#ef4444' : source === 'hitl' ? '#f59e0b' : '#10b981'}`,
                borderRadius: 6,
            }}
        >
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center', marginBottom: 5 }}>
                <RagSourceBadge source={source} />
                <code style={{ fontSize: 10, fontWeight: 700, background: '#f2f4f7', color: '#101828', padding: '1px 7px', borderRadius: 999 }}>{hit.example_id}</code>
                {hit.item_number && (
                    <span style={{ fontSize: 9.5, color: '#667085', background: '#f2f4f7', padding: '1px 6px', borderRadius: 4 }}>#{hit.item_number}</span>
                )}
                {hit.score_bucket && hit.score_bucket !== 'unknown' && (
                    <span style={{ fontSize: 9.5, color: '#667085', background: '#f2f4f7', padding: '1px 6px', borderRadius: 4 }}>{hit.score_bucket}</span>
                )}
            </div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center', marginBottom: 5, fontSize: 11 }}>
                {hit.score != null && (
                    <span style={{ fontWeight: 600 }}>
                        人 <b>{hit.score}{hit.max_score != null ? `/${hit.max_score}` : ''}</b>
                    </span>
                )}
                <RagSimilarityChips hit={hit} />
                {hit.intent && hit.intent !== '*' && hit.intent !== 'unknown' && (
                    <span style={{ fontSize: 9.5, color: '#667085', background: '#f2f4f7', padding: '1px 6px', borderRadius: 4 }}>{hit.intent}</span>
                )}
                {hit.rater_type && (
                    <span title={hit.rater_source || ''} style={{ fontSize: 9.5, color: '#667085', background: '#f2f4f7', padding: '1px 6px', borderRadius: 4 }}>
                        {hit.rater_type}
                    </span>
                )}
            </div>
            <RagCardSection eyebrow="🔍 디버그 — 원본 hit 필드" body={debugSummary} tone="default" defaultOpen={false} />
            {hit.parsed_text && (
                <RagCardSection eyebrow="📄 STT 전체 원본 (상담 transcript)" body={stripSeparatorLines(hit.parsed_text)} tone="info" defaultOpen={false} previewChars={240} />
            )}
            {idxBody && <RagCardSection eyebrow="🔍 색인 요약 (BM25/KNN 매칭 대상)" body={idxBody} tone="info" defaultOpen={false} previewChars={200} />}
            {segBody && <RagCardSection eyebrow="근거 발화" body={stripSeparatorLines(segBody)} tone="default" defaultOpen={false} />}
            {noteBody && <RagCardSection eyebrow={source === 'golden_set' ? '이유 · 검수자 코멘트' : '검수자 코멘트'} body={stripSeparatorLines(noteBody)} tone="default" defaultOpen />}
            {Array.isArray(hit.rationale_tags) && hit.rationale_tags.length > 0 && (
                <div style={{ marginTop: 5, display: 'flex', flexWrap: 'wrap', gap: 3 }}>
                    {hit.rationale_tags.map((t, i) => (
                        <span key={i} style={{ fontSize: 9, padding: '1px 5px', borderRadius: 3, background: '#dbeafe', color: '#1e3a8a' }}>
                            {t}
                        </span>
                    ))}
                </div>
            )}
        </div>
    );
}

const RAG_BUCKET_META = {
    full: { label: '🟢 full · 만점 사례', color: '#10b981', order: 0 },
    partial: { label: '🟡 partial · 부분점수 사례', color: '#f59e0b', order: 1 },
    zero: { label: '🔴 zero · 0점 사례', color: '#ef4444', order: 2 },
    unevaluable: { label: '⚫ unevaluable · 평가 불가', color: '#6b7280', order: 3 },
    unknown: { label: '🏷 메타 분류 없음', color: '#9ca3af', order: 9 },
};

/** 한 항목(item_number)의 hits 를 버킷 그룹 → 카드로. defaultOpen=false(접힘). */
function RagItemGroup({ entry, defaultOpen = false }) {
    const [open, setOpen] = useState(defaultOpen);
    const hits = Array.isArray(entry.hits) ? entry.hits : [];
    const sorted = [...hits].sort((a, b) => {
        const ba = RAG_BUCKET_META[a.score_bucket]?.order ?? 99;
        const bb = RAG_BUCKET_META[b.score_bucket]?.order ?? 99;
        if (ba !== bb) return ba - bb;
        const ra = a.cohere_rerank_score ?? -Infinity;
        const rb = b.cohere_rerank_score ?? -Infinity;
        if (ra !== rb) return rb - ra;
        return (b.cosine_score ?? -Infinity) - (a.cosine_score ?? -Infinity);
    });
    const groups = (() => {
        const map = new Map();
        for (const h of sorted) {
            const k = h.score_bucket || 'unknown';
            if (!map.has(k)) map.set(k, []);
            map.get(k).push(h);
        }
        return Array.from(map.entries())
            .sort(([a], [b]) => (RAG_BUCKET_META[a]?.order ?? 99) - (RAG_BUCKET_META[b]?.order ?? 99))
            .map(([bucket, bhits]) => ({ bucket, ...(RAG_BUCKET_META[bucket] || { label: `❓ ${bucket}`, color: '#9ca3af' }), hits: bhits }));
    })();
    const total = hits.length;
    return (
        <div className="bg-white border border-[#E4E7EC] rounded-xl overflow-hidden">
            <button
                type="button"
                onClick={() => setOpen((o) => !o)}
                className="w-full flex items-center justify-between gap-2 px-4 py-3 text-left hover:bg-[#F9FAFB] cursor-pointer"
            >
                <span className="flex items-center gap-2 min-w-0">
                    <ChevronDown size={15} className={`shrink-0 text-[#98A2B3] transition-transform ${open ? '' : '-rotate-90'}`} />
                    <span className="font-semibold text-[#101828] text-[13px]">🌟 #{entry.item_number}</span>
                    {entry.item_name && <span className="text-[#667085] text-[12.5px] truncate">{entry.item_name}</span>}
                    {entry.intent && entry.intent !== '*' && (
                        <span className="text-[10.5px] text-[#667085] bg-[#F2F4F7] px-1.5 py-0.5 rounded">{entry.intent}</span>
                    )}
                </span>
                <span className="flex items-center gap-2 shrink-0">
                    {total > 0 ? (
                        <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-semibold bg-blue-50 text-blue-700">총 {total}건</span>
                    ) : (
                        <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-semibold bg-gray-100 text-gray-500">조회됨 · 0건</span>
                    )}
                    <span className="text-[10.5px] text-[#98A2B3] font-mono">{fmtRagTime(entry.ts)}</span>
                </span>
            </button>
            {open && total > 0 && (
                <div className="px-4 pb-4 pt-1 border-t border-[#F2F4F7]">
                    {entry.fewshot_query && (
                        <div style={{ marginBottom: 8, padding: '8px 10px', background: '#fef9e7', borderLeft: '3px solid #f59e0b', borderRadius: 4 }}>
                            <div style={{ fontSize: 9.5, fontWeight: 800, color: '#92400e', letterSpacing: '0.05em', marginBottom: 4, textTransform: 'uppercase' }}>
                                검색어 · sub-agent fewshot
                            </div>
                            <div style={{ fontSize: 11, color: '#78350f', lineHeight: 1.55, whiteSpace: 'pre-wrap', wordBreak: 'break-word', maxHeight: 200, overflowY: 'auto', background: 'rgba(255,255,255,0.6)', padding: '6px 8px', borderRadius: 3 }}>
                                {entry.fewshot_query}
                            </div>
                        </div>
                    )}
                    {groups.map((g) => (
                        <div key={g.bucket} style={{ marginBottom: 12 }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '8px 0 6px 0', paddingBottom: 4, borderBottom: `2px solid ${g.color}`, fontSize: 12, fontWeight: 700, color: g.color }}>
                                <span>{g.label}</span>
                                <span style={{ fontSize: 10, fontWeight: 500, color: '#667085' }}>· {g.hits.length}건</span>
                            </div>
                            {g.hits.map((h, i) => (
                                <RagGoldenCard hit={h} key={h.example_id || i} />
                            ))}
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}

/** 한 대화(qa_id)의 항목들을 묶는 외곽 토글(기본 접힘) → 내부에 항목별 RagItemGroup. */
function RagQaGroup({ qaId, items, defaultOpen = false }) {
    const [open, setOpen] = useState(defaultOpen);
    const sortedItems = [...items].sort((a, b) => Number(a.item_number) - Number(b.item_number));
    const totalHits = sortedItems.reduce((s, e) => s + (Array.isArray(e.hits) ? e.hits.length : 0), 0);
    const latestTs = sortedItems.reduce((mx, e) => Math.max(mx, e.ts || 0), 0);
    return (
        <div className="bg-white border border-[#E4E7EC] rounded-xl overflow-hidden shadow-sm">
            <button
                type="button"
                onClick={() => setOpen((o) => !o)}
                className="w-full flex items-center justify-between gap-2 px-4 py-3 text-left bg-[#F9FAFB] hover:bg-[#F2F4F7] cursor-pointer"
            >
                <span className="flex items-center gap-2 min-w-0">
                    <ChevronDown size={16} className={`shrink-0 text-[#667085] transition-transform ${open ? '' : '-rotate-90'}`} />
                    <span className="text-[12px]">🗣</span>
                    <span className="font-bold text-[#101828] text-[13px] font-mono break-all">{qaId}</span>
                    <span className="text-[11px] text-[#667085]">· {sortedItems.length}개 항목</span>
                </span>
                <span className="flex items-center gap-2 shrink-0">
                    <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-semibold bg-blue-50 text-blue-700">사례 {totalHits}건</span>
                    <span className="text-[10.5px] text-[#98A2B3] font-mono">{fmtRagTime(latestTs)}</span>
                </span>
            </button>
            {open && (
                <div className="px-3 pb-3 pt-2 border-t border-[#F2F4F7] space-y-2">
                    {sortedItems.map((e) => (
                        <RagItemGroup key={`${qaId}-${e.item_number}`} entry={e} defaultOpen={false} />
                    ))}
                </div>
            )}
        </div>
    );
}

function RagContentCell({ entry }) {
    if (entry.kind === 'forbidden') {
        const matches = Array.isArray(entry.matches) ? entry.matches : [];
        if (matches.length === 0)
            return (
                <span className="inline-flex items-center gap-1 text-[#98A2B3]">
                    <span className="text-[11px] font-medium">조회됨</span>
                    <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold bg-gray-100 text-gray-600">0건</span>
                </span>
            );
        return (
            <ul className="space-y-0.5">
                {matches.map((m, i) => (
                    <li key={i} className="text-[12px] text-[#475467]">
                        <span className="font-semibold text-[#B42318]">{m.rule_ref || m.term || '—'}</span>
                        {m.verdict && <span className="text-[#667085]"> · {m.verdict}</span>}
                        {m.quote && <span className="text-[#98A2B3]"> — “{m.quote}”</span>}
                    </li>
                ))}
            </ul>
        );
    }
    const hits = Array.isArray(entry.hits) ? entry.hits : [];
    if (hits.length === 0)
        return (
            <span className="inline-flex items-center gap-1 text-[#98A2B3]">
                <span className="text-[11px] font-medium">조회됨</span>
                <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold bg-blue-50 text-blue-600">0건</span>
            </span>
        );
    return (
        <ul className="space-y-0.5">
            {hits.map((h, i) => (
                <li key={i} className="text-[12px] text-[#475467]">
                    <span className="font-semibold text-[#055AAF]">{h.example_id || '—'}</span>
                    {(h.score !== null && h.score !== undefined) && (
                        <span className="text-[#667085]"> ({h.score})</span>
                    )}
                    {h.summary && <span className="text-[#98A2B3]"> — {h.summary}</span>}
                </li>
            ))}
        </ul>
    );
}

function RagLogPanel() {
    const [entries, setEntries] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [paused, setPaused] = useState(false);

    async function load() {
        try {
            // fetchRagLogRecent 는 이미 entries 배열을 반환(api.js) — 재언랩 금지(이중 언랩 시 항상 [])
            // 0-hit(조회됨·0건) 도 표시 — "RAG 가 조회를 돌렸는지" 자체를 가시화. 미적중 엔트리는 RagContentCell 이
            //   '조회됨 · 0건' 배지로 렌더. 잔존(stale) 노이즈는 서버 within_minutes(기본 60분) 윈도우로 1차 차단.
            const rows = await fetchRagLogRecent({ limit: PAGE_SIZE });
            setEntries(Array.isArray(rows) ? rows : []);
            setError(null);
        } catch (e) {
            setError(e?.message || 'RAG 로그 로드 실패');
        } finally {
            setLoading(false);
        }
    }

    useEffect(() => {
        load();
    }, []);

    useEffect(() => {
        if (paused) return;
        const id = setInterval(load, POLL_INTERVAL_MS);
        return () => clearInterval(id);
    }, [paused]);

    return (
        <>
            <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 text-[12px] text-[#667085]">
                    <span className="inline-flex items-center gap-1.5">
                        <span className={`w-2 h-2 rounded-full ${paused ? 'bg-gray-400' : 'bg-green-500 animate-pulse'}`} />
                        {paused ? '갱신 일시정지' : `자동 갱신 중 (${POLL_INTERVAL_MS / 1000}초)`}
                    </span>
                    <span>·</span>
                    <span>총 {entries.length}건 표시</span>
                </div>
                <div className="flex items-center gap-2">
                    <button
                        onClick={() => setPaused((v) => !v)}
                        className="inline-flex items-center gap-1.5 h-[34px] px-3.5 rounded-full border border-[#E4E7EC] bg-white text-[12.5px] font-semibold text-[#101828] hover:bg-[#F2F4F7] cursor-pointer"
                    >
                        {paused ? <Play size={12} /> : <Pause size={12} />}
                        {paused ? '재개' : '일시정지'}
                    </button>
                    <button
                        onClick={load}
                        className="inline-flex items-center gap-1.5 h-[34px] px-3.5 rounded-full bg-[#055AAF] text-white text-[12.5px] font-semibold hover:bg-[#1E70E0] shadow-sm cursor-pointer"
                    >
                        <RefreshCw size={12} /> 새로고침
                    </button>
                </div>
            </div>

            {loading ? (
                <div className="flex justify-center py-12">
                    <Loader2 className="h-5 w-5 animate-spin text-[#667085]" />
                </div>
            ) : (
                <RagLogBody entries={entries} error={error} />
            )}
        </>
    );
}

/** RAG 엔트리 = 대화(qa_id)별 → 항목별 2단 접이식 리치 카드, 금지어 = 기존 테이블. */
function RagLogBody({ entries, error }) {
    // 대화(qa_id) 별 그룹 → 그 안에서 같은 item_number 는 최신 ts 1건만 유지(항목 토글 1개).
    const ragQaGroups = (() => {
        const byQa = new Map(); // qa_id → Map(item_number → 최신 entry)
        for (const e of entries) {
            if (e.kind === 'forbidden') continue;
            const qa = e.qa_id || 'unknown';
            if (!byQa.has(qa)) byQa.set(qa, new Map());
            const itemMap = byQa.get(qa);
            const key = Number(e.item_number);
            const prev = itemMap.get(key);
            if (!prev || (e.ts || 0) > (prev.ts || 0)) itemMap.set(key, e);
        }
        return Array.from(byQa.entries())
            .map(([qaId, itemMap]) => {
                const items = Array.from(itemMap.values());
                const latestTs = items.reduce((mx, e) => Math.max(mx, e.ts || 0), 0);
                return { qaId, items, latestTs };
            })
            .sort((a, b) => b.latestTs - a.latestTs); // 최근 대화 먼저
    })();
    const forbidden = entries.filter((e) => e.kind === 'forbidden');
    const totalItems = ragQaGroups.reduce((s, g) => s + g.items.length, 0);
    const totalHits = ragQaGroups.reduce(
        (s, g) => s + g.items.reduce((t, e) => t + (Array.isArray(e.hits) ? e.hits.length : 0), 0),
        0,
    );

    return (
        <>
            {error && <p className="text-sm text-[#D92D20]">{error}</p>}

            {/* ── 골든셋 RAG · 페르소나 참조 자료 ── */}
            <div className="mt-1">
                <div className="text-[14px] font-bold text-[#101828] flex items-center gap-2">
                    🌟 골든셋 RAG · 페르소나 참조 자료
                    {ragQaGroups.length > 0 && (
                        <span className="text-[12px] font-medium text-[#667085]">
                            · 대화 {ragQaGroups.length} · 항목 {totalItems} · 사례 {totalHits}건
                        </span>
                    )}
                </div>
                <p className="mt-1 text-[11.5px] text-[#667085] leading-relaxed">
                    AI 평가 시 sub-agent fewshot 으로 사용된 사람 검수 정답(골든셋). <b>대화(qa_id) → 평가항목</b> 2단으로 접혀 있으며, 펼치면 버킷(full/partial/zero)별 사례·검색어·STT 원문·색인 요약·근거 발화·검수자 코멘트를 확인할 수 있습니다. (판사는 RAG 미사용)
                </p>
                <div className="mt-3 space-y-2.5">
                    {ragQaGroups.length === 0 ? (
                        <div className="bg-white border border-[#E4E7EC] rounded-xl px-4 py-10 text-center text-sm text-[#667085]">
                            표시할 RAG 조회 기록이 없습니다. (평가 실행 시 disable_rag=false 여야 RAG hit 가 기록됩니다.)
                        </div>
                    ) : (
                        ragQaGroups.map((g) => <RagQaGroup key={`qa-${g.qaId}`} qaId={g.qaId} items={g.items} defaultOpen={false} />)
                    )}
                </div>
            </div>

            {/* ── 금지어·사전 매칭 (기존 테이블) ── */}
            {forbidden.length > 0 && (
                <div className="mt-6">
                    <div className="text-[13px] font-bold text-[#101828] mb-2">🚫 금지어 · 사전 매칭 · {forbidden.length}건</div>
                    <div className="bg-white border border-[#E4E7EC] rounded-xl overflow-hidden">
                        <table className="w-full text-sm">
                            <thead>
                                <tr className="border-b border-[#E4E7EC] bg-[#F9FAFB]">
                                    <th className="px-3 py-2.5 text-left text-[11px] font-semibold text-[#667085] uppercase tracking-wider w-[140px]">시각</th>
                                    <th className="px-3 py-2.5 text-left text-[11px] font-semibold text-[#667085] uppercase tracking-wider w-[140px]">qa_id</th>
                                    <th className="px-3 py-2.5 text-left text-[11px] font-semibold text-[#667085] uppercase tracking-wider w-[200px]">항목</th>
                                    <th className="px-3 py-2.5 text-left text-[11px] font-semibold text-[#667085] uppercase tracking-wider">내용</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-[#E4E7EC]">
                                {forbidden.map((e, idx) => (
                                    <tr key={`${e.qa_id || 'na'}-${e.ts}-${idx}`} className="hover:bg-[#F9FAFB] align-top">
                                        <td className="px-3 py-2 text-[11.5px] text-[#667085] tabular-nums font-mono">{fmtRagTime(e.ts)}</td>
                                        <td className="px-3 py-2 text-[12px] text-[#101828] font-mono break-all">{e.qa_id || '—'}</td>
                                        <td className="px-3 py-2 text-[12px] text-[#475467]">
                                            <span className="font-semibold text-[#101828]">#{e.item_number}</span>
                                            {e.item_name && <span className="text-[#667085]"> {e.item_name}</span>}
                                        </td>
                                        <td className="px-3 py-2"><RagContentCell entry={e} /></td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}
        </>
    );
}

/* ── 페이지 컨테이너 + 서브탭 ────────────────────────────── */
// RAG·사전(백엔드) 탭은 개발/실험 기능 — 기본 숨김(커밋 상태). 로컬 개발 시 .env.local 에
// NEXT_PUBLIC_SHOW_RAG=1 을 주면 노출(활성화). 미설정(운영/공유)에서는 탭 자체가 렌더되지 않음.
const SHOW_RAG_DEV = typeof process !== 'undefined' && process.env.NEXT_PUBLIC_SHOW_RAG === '1';
const TABS = [
    { id: 'audit', label: '사용자 활동 (Audit)', icon: ListChecks },
    { id: 'app', label: '서버 로그 (App)', icon: Terminal },
    ...(SHOW_RAG_DEV ? [{ id: 'rag', label: 'RAG · 사전 (백엔드)', icon: Sparkles }] : []),
];

const Logs = () => {
    const [activeTab, setActiveTab] = useState('audit');

    return (
        <div className="w-full">
            <Header
                title="실시간 로그"
                subtitle={
                    activeTab === 'audit'
                        ? `사용자 활동 audit — 최근 ${VIEW_WINDOW_DAYS}일 이내 ${PAGE_SIZE}건을 ${POLL_INTERVAL_MS / 1000}초마다 자동 갱신 (DB 보관 3일).`
                        : activeTab === 'app'
                          ? `서버 application 로그 — 오늘 ${APP_LOG_LIMIT}줄을 ${POLL_INTERVAL_MS / 1000}초마다 자동 갱신 (파일 보관 3일).`
                          : `RAG few-shot 골든 / 금지어·사전 매칭 로그 — 백엔드 인메모리 ${PAGE_SIZE}건을 ${POLL_INTERVAL_MS / 1000}초마다 자동 갱신 (평가 시 disable_rag=false 필요).`
                }
                actions={null}
            />

            <div className="flex items-center gap-1.5 mb-4">
                {TABS.map((t) => {
                    const Icon = t.icon;
                    const active = activeTab === t.id;
                    return (
                        <button
                            key={t.id}
                            onClick={() => setActiveTab(t.id)}
                            className={`inline-flex items-center gap-1.5 h-[34px] px-3.5 rounded-full text-[12.5px] font-semibold cursor-pointer transition-colors ${
                                active
                                    ? 'bg-[#055AAF] text-white shadow-sm'
                                    : 'bg-white border border-[#E4E7EC] text-[#475467] hover:bg-[#F2F4F7]'
                            }`}
                        >
                            <Icon size={13} />
                            {t.label}
                        </button>
                    );
                })}
            </div>

            <div className="space-y-3">
                {activeTab === 'audit' ? <AuditPanel /> : activeTab === 'app' ? <AppPanel /> : <RagLogPanel />}
            </div>
        </div>
    );
};

export default Logs;
