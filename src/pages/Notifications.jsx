import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
    Loader2,
    Bell,
    BellOff,
    CheckCheck,
    RefreshCw,
    AlertOctagon,
    ClipboardCheck,
    Upload,
    PhoneIncoming,
    ArrowRight,
} from 'lucide-react';
import Header from '../components/Header';
import { fetchNotifications } from '../services/api';

const POLL_INTERVAL_MS = 10000;
const PAGE_SIZE = 50;
const LAST_READ_STORAGE_KEY = 'qa_dashboard_notifications_last_read';

// 액션별 메타: 라벨, 색조, 아이콘, 상세 설명 빌더.
// 서버 응답의 action 값과 일치해야 함 (server/auditLog.mjs::AUDIT_ACTION).
const ACTION_META = {
    QA_MANUAL_EVAL_SAVE: {
        label: '평가 저장',
        Icon: ClipboardCheck,
        tone: { bg: 'bg-[#EFF6FF]', fg: 'text-[#055AAF]' },
        chip: 'bg-blue-50 text-blue-700',
        describe: (n) => `QA ${n.resource_id || ''} 평가가 저장되었습니다`.trim(),
        deepLink: (n) => (n.resource_id ? `#/detail/${encodeURIComponent(n.resource_id)}` : null),
        actionLabel: '결과 보기',
    },
    SAMPLE_INGEST: {
        label: '샘플 적재',
        Icon: Upload,
        tone: { bg: 'bg-[#FEF3C7]', fg: 'text-[#92400E]' },
        chip: 'bg-amber-50 text-amber-700',
        describe: () => '샘플 데이터 적재가 완료되었습니다',
        deepLink: () => '#/dashboard',
        actionLabel: '대시보드로',
    },
    INGEST_AI_CANVAS: {
        label: 'AI Canvas 적재',
        Icon: Upload,
        tone: { bg: 'bg-[#FEF3C7]', fg: 'text-[#92400E]' },
        chip: 'bg-amber-50 text-amber-700',
        describe: (n) => `AI Canvas 호출 ${n.resource_id || ''} 적재 완료`.trim(),
        deepLink: () => '#/dashboard',
        actionLabel: '대시보드로',
    },
    INGEST_COLLECTION_CALL: {
        label: '외부 콜 적재',
        Icon: PhoneIncoming,
        tone: { bg: 'bg-[#FEF3C7]', fg: 'text-[#92400E]' },
        chip: 'bg-amber-50 text-amber-700',
        describe: (n) => `외부 콜 ${n.resource_id || ''} 적재 완료`.trim(),
        deepLink: () => '#/dashboard',
        actionLabel: '대시보드로',
    },
    INGEST_QA_PIPELINE: {
        label: 'QA 파이프라인 적재',
        Icon: Upload,
        tone: { bg: 'bg-[#FEF3C7]', fg: 'text-[#92400E]' },
        chip: 'bg-amber-50 text-amber-700',
        describe: (n) => `QA 파이프라인 평가 ${n.resource_id || ''} 적재 완료`.trim(),
        deepLink: (n) => (n.resource_id ? `#/detail/${encodeURIComponent(n.resource_id)}` : '#/dashboard'),
        actionLabel: '결과 보기',
    },
};

const FALLBACK_META = {
    label: '이벤트',
    Icon: Bell,
    tone: { bg: 'bg-[#F2F4F7]', fg: 'text-[#667085]' },
    chip: 'bg-[#F2F4F7] text-[#667085]',
    describe: (n) => `${n.resource_type || ''} ${n.resource_id || ''}`.trim() || '이벤트',
    deepLink: () => null,
    actionLabel: null,
};

const TAB_OPTIONS = [
    { key: 'all', label: '전체' },
    { key: 'unread', label: '미읽음' },
    { key: 'eval', label: '평가' },
    { key: 'ingest', label: '적재' },
];

function metaFor(action) {
    return ACTION_META[action] || FALLBACK_META;
}

function bucketFor(createdAt) {
    if (!createdAt) return '이전';
    const d = new Date(createdAt);
    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const startOfYesterday = new Date(startOfToday.getTime() - 24 * 60 * 60 * 1000);
    const dayOfWeek = now.getDay(); // 0=Sun
    const daysSinceMonday = (dayOfWeek + 6) % 7;
    const startOfWeek = new Date(startOfToday.getTime() - daysSinceMonday * 24 * 60 * 60 * 1000);

    if (d >= startOfToday) return '오늘';
    if (d >= startOfYesterday) return '어제';
    if (d >= startOfWeek) return '이번주';
    return '이전';
}

function fmtTime(iso) {
    if (!iso) return '—';
    const d = new Date(iso);
    return d.toLocaleString('ko-KR', {
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
    });
}

function readLastReadId() {
    if (typeof window === 'undefined') return 0;
    const raw = window.localStorage.getItem(LAST_READ_STORAGE_KEY);
    const parsed = raw ? Number(raw) : 0;
    return Number.isFinite(parsed) ? parsed : 0;
}

function writeLastReadId(value) {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(LAST_READ_STORAGE_KEY, String(value));
}

function NotificationRow({ item, isUnread, onReadOne }) {
    const meta = metaFor(item.action);
    const Icon = meta.Icon;
    const deepLink = meta.deepLink(item);
    const failed = item.success === 0 || item.success === false;

    const handleClick = () => {
        onReadOne(item.audit_id);
    };

    const handleAction = (e) => {
        e.stopPropagation();
        onReadOne(item.audit_id);
        if (deepLink && typeof window !== 'undefined') {
            window.location.hash = deepLink;
        }
    };

    return (
        <div
            onClick={handleClick}
            className={`grid grid-cols-[40px_1fr_120px_140px] gap-3 items-center px-5 py-3 border-b border-[#E4E7EC] cursor-pointer transition-colors hover:bg-[#F9FAFB] ${
                isUnread ? 'bg-[rgba(5,90,175,0.03)]' : ''
            }`}
        >
            <div
                className={`w-9 h-9 rounded-lg ${meta.tone.bg} ${meta.tone.fg} grid place-items-center flex-shrink-0`}
            >
                {failed ? <AlertOctagon size={16} /> : <Icon size={16} />}
            </div>
            <div className="min-w-0">
                <div className="flex items-center gap-2 mb-1">
                    {isUnread && (
                        <span className="w-1.5 h-1.5 rounded-full bg-[#055AAF] flex-shrink-0" />
                    )}
                    <span
                        className={`text-[13.5px] text-[#101828] ${
                            isUnread ? 'font-bold' : 'font-semibold'
                        }`}
                    >
                        {failed ? `${meta.label} 실패` : meta.label}
                    </span>
                    <span
                        className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-mono font-semibold ${meta.chip}`}
                    >
                        {item.action}
                    </span>
                </div>
                <div className="text-[12.5px] text-[#667085] leading-snug">
                    {failed && item.error_message
                        ? item.error_message
                        : meta.describe(item)}
                </div>
            </div>
            <div className="text-[11.5px] text-[#667085] text-right font-mono tabular-nums">
                {fmtTime(item.created_at)}
            </div>
            <div className="flex justify-end">
                {meta.actionLabel && deepLink && !failed && (
                    <button
                        onClick={handleAction}
                        className="inline-flex items-center gap-1 h-[28px] px-3 rounded-full border border-[#E4E7EC] bg-white text-[11.5px] font-semibold text-[#101828] hover:bg-[#F2F4F7] cursor-pointer"
                    >
                        {meta.actionLabel}
                        <ArrowRight size={11} />
                    </button>
                )}
            </div>
        </div>
    );
}

const Notifications = () => {
    const [items, setItems] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [tab, setTab] = useState('all');
    const [lastReadId, setLastReadId] = useState(() => readLastReadId());

    const load = useCallback(async () => {
        try {
            const rows = await fetchNotifications({ limit: PAGE_SIZE });
            setItems(Array.isArray(rows) ? rows : []);
            setError(null);
        } catch (e) {
            setError(e?.message || '알림 로드 실패');
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        load();
    }, [load]);

    useEffect(() => {
        const id = setInterval(load, POLL_INTERVAL_MS);
        return () => clearInterval(id);
    }, [load]);

    const counts = useMemo(() => {
        const unread = items.filter((n) => Number(n.audit_id) > lastReadId).length;
        const evalCount = items.filter((n) => n.action === 'QA_MANUAL_EVAL_SAVE').length;
        const ingestCount = items.filter((n) =>
            ['SAMPLE_INGEST', 'INGEST_AI_CANVAS', 'INGEST_COLLECTION_CALL', 'INGEST_QA_PIPELINE'].includes(n.action)
        ).length;
        return { all: items.length, unread, eval: evalCount, ingest: ingestCount };
    }, [items, lastReadId]);

    const filtered = useMemo(() => {
        if (tab === 'unread') return items.filter((n) => Number(n.audit_id) > lastReadId);
        if (tab === 'eval') return items.filter((n) => n.action === 'QA_MANUAL_EVAL_SAVE');
        if (tab === 'ingest') {
            return items.filter((n) =>
                ['SAMPLE_INGEST', 'INGEST_AI_CANVAS', 'INGEST_COLLECTION_CALL', 'INGEST_QA_PIPELINE'].includes(n.action)
            );
        }
        return items;
    }, [items, tab, lastReadId]);

    const groups = useMemo(() => {
        const order = ['오늘', '어제', '이번주', '이전'];
        const byBucket = new Map(order.map((k) => [k, []]));
        for (const n of filtered) {
            const b = bucketFor(n.created_at);
            byBucket.get(b).push(n);
        }
        return order.map((when) => ({ when, items: byBucket.get(when) })).filter((g) => g.items.length > 0);
    }, [filtered]);

    const markAllRead = () => {
        if (items.length === 0) return;
        const maxId = items.reduce((acc, n) => Math.max(acc, Number(n.audit_id) || 0), 0);
        if (maxId > lastReadId) {
            setLastReadId(maxId);
            writeLastReadId(maxId);
        }
    };

    const markOneRead = (auditId) => {
        const id = Number(auditId);
        if (!Number.isFinite(id) || id <= lastReadId) return;
        setLastReadId(id);
        writeLastReadId(id);
    };

    return (
        <div className="w-full max-w-[1280px] mx-auto">
            <Header
                title="알림 센터"
                subtitle={`본인이 수행한 평가/적재 이벤트를 ${POLL_INTERVAL_MS / 1000}초마다 자동 갱신합니다 (최근 1일).`}
                actions={
                    <div className="flex items-center gap-2">
                        <button
                            onClick={markAllRead}
                            disabled={counts.unread === 0}
                            className="inline-flex items-center gap-1.5 h-[38px] px-4 rounded-full border border-[#E4E7EC] bg-white text-[13px] font-semibold text-[#101828] hover:bg-[#F2F4F7] cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                            <CheckCheck size={13} />
                            모두 읽음
                        </button>
                        <button
                            onClick={load}
                            className="inline-flex items-center gap-1.5 h-[38px] px-4 rounded-full bg-[#055AAF] text-white text-[13px] font-semibold hover:bg-[#1E70E0] shadow-sm cursor-pointer"
                        >
                            <RefreshCw size={13} />
                            새로고침
                        </button>
                    </div>
                }
            />

            <div className="flex items-center gap-1 mb-4 border-b border-[#E4E7EC]">
                {TAB_OPTIONS.map((opt) => (
                    <button
                        key={opt.key}
                        onClick={() => setTab(opt.key)}
                        className={`relative px-4 py-2 text-[13px] font-semibold cursor-pointer transition-colors ${
                            tab === opt.key
                                ? 'text-[#055AAF]'
                                : 'text-[#667085] hover:text-[#101828]'
                        }`}
                    >
                        {opt.label}
                        <span className="ml-1.5 text-[11.5px] text-[#98A2B3] font-mono">
                            {counts[opt.key] ?? 0}
                        </span>
                        {tab === opt.key && (
                            <span className="absolute left-0 right-0 bottom-[-1px] h-[2px] bg-[#055AAF]" />
                        )}
                    </button>
                ))}
            </div>

            {loading ? (
                <div className="flex justify-center py-12">
                    <Loader2 className="h-5 w-5 animate-spin text-[#667085]" />
                </div>
            ) : (
                <div className="space-y-3">
                    {error && <p className="text-sm text-[#D92D20]">{error}</p>}

                    {groups.length === 0 ? (
                        <div className="bg-white border border-[#E4E7EC] rounded-xl py-16 px-6 text-center">
                            <div className="w-12 h-12 mx-auto mb-3 rounded-full bg-[#F2F4F7] grid place-items-center">
                                <BellOff size={20} className="text-[#98A2B3]" />
                            </div>
                            <h3 className="text-[15px] font-bold text-[#101828] mb-1">알림 없음</h3>
                            <p className="text-[13px] text-[#667085]">
                                평가를 저장하거나 데이터를 적재하면 여기에 표시됩니다.
                            </p>
                        </div>
                    ) : (
                        groups.map((g) => (
                            <div key={g.when}>
                                <div className="flex items-center gap-2 mb-2 px-1">
                                    <span className="text-[11px] font-bold text-[#055AAF] uppercase tracking-wider">
                                        {g.when}
                                    </span>
                                    <span className="text-[11.5px] text-[#98A2B3]">· {g.items.length}건</span>
                                    <div className="flex-1 h-px bg-[#E4E7EC] ml-1" />
                                </div>
                                <div className="bg-white border border-[#E4E7EC] rounded-xl overflow-hidden">
                                    {g.items.map((item) => (
                                        <NotificationRow
                                            key={item.audit_id}
                                            item={item}
                                            isUnread={Number(item.audit_id) > lastReadId}
                                            onReadOne={markOneRead}
                                        />
                                    ))}
                                </div>
                            </div>
                        ))
                    )}
                </div>
            )}
        </div>
    );
};

export default Notifications;
