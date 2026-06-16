import React, { useEffect, useRef, useState } from 'react';
import { Loader2, Pause, Play, RefreshCw, ChevronDown, ListChecks, Terminal } from 'lucide-react';
import Header from '../components/Header';
import { fetchAuditLogs, fetchAppLogsRecent } from '../services/api';

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

/* ── 페이지 컨테이너 + 서브탭 ────────────────────────────── */
const TABS = [
    { id: 'audit', label: '사용자 활동 (Audit)', icon: ListChecks },
    { id: 'app', label: '서버 로그 (App)', icon: Terminal },
];

const Logs = () => {
    const [activeTab, setActiveTab] = useState('audit');

    return (
        <div className="w-full max-w-[1280px] mx-auto">
            <Header
                title="실시간 로그"
                subtitle={
                    activeTab === 'audit'
                        ? `사용자 활동 audit — 최근 ${VIEW_WINDOW_DAYS}일 이내 ${PAGE_SIZE}건을 ${POLL_INTERVAL_MS / 1000}초마다 자동 갱신 (DB 보관 3일).`
                        : `서버 application 로그 — 오늘 ${APP_LOG_LIMIT}줄을 ${POLL_INTERVAL_MS / 1000}초마다 자동 갱신 (파일 보관 3일).`
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
                {activeTab === 'audit' ? <AuditPanel /> : <AppPanel />}
            </div>
        </div>
    );
};

export default Logs;
