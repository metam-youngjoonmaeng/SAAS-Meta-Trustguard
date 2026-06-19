// 알림 센터(전체 페이지) — 헤더 벨과 동일한 수신자별 알림(/api/notifications)을 큰 화면으로.
//   현재(안읽음)/지난(읽음) + 클릭 시 읽음·상세 이동, 개별 삭제, 모두 읽음, 새로고침.
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Loader2, Bell, BellOff, CheckCheck, RefreshCw, X, ArrowRight, CheckCircle2, Pencil, ClipboardCheck, GraduationCap, Award } from 'lucide-react';
import Header from '../components/Header';
import { fetchNotifications, markNotificationRead, markAllNotificationsRead, deleteNotification } from '../services/api';

const POLL_INTERVAL_MS = 30000;

const TYPE_META = {
    review_approved: { label: '승인', Icon: CheckCircle2, tone: { bg: 'bg-[#ECFDF3]', fg: 'text-[#067647]' }, chip: 'bg-[#ECFDF3] text-[#067647]' },
    review_edited: { label: '수정 반영', Icon: Pencil, tone: { bg: 'bg-[#FFFAEB]', fg: 'text-[#B54708]' }, chip: 'bg-[#FFFAEB] text-[#B54708]' },
    review_submitted: { label: '검토요청', Icon: ClipboardCheck, tone: { bg: 'bg-[#EEF4FB]', fg: 'text-[#055AAF]' }, chip: 'bg-[#EEF4FB] text-[#055AAF]' },
    coaching_assigned: { label: '코칭 배정', Icon: GraduationCap, tone: { bg: 'bg-[#F4F3FF]', fg: 'text-[#5925DC]' }, chip: 'bg-[#F4F3FF] text-[#5925DC]' },
    coaching_completed: { label: '코칭 완료', Icon: Award, tone: { bg: 'bg-[#ECFDF3]', fg: 'text-[#067647]' }, chip: 'bg-[#ECFDF3] text-[#067647]' },
};
const metaFor = (t) => TYPE_META[t] || { label: '알림', Icon: Bell, tone: { bg: 'bg-[#F2F4F7]', fg: 'text-[#667085]' }, chip: 'bg-[#F2F4F7] text-[#667085]' };
const deepLinkOf = (n) => {
    if (n.resource_type === 'qa_call' && n.resource_id) return `#/detail/${encodeURIComponent(n.resource_id)}`;
    if (n.resource_type === 'coaching') return '#/eval-mgmt';
    return null;
};

const TAB_OPTIONS = [
    { key: 'all', label: '전체' },
    { key: 'current', label: '현재(안읽음)' },
    { key: 'past', label: '지난(읽음)' },
];

function bucketFor(createdAt) {
    if (!createdAt) return '이전';
    const d = new Date(createdAt);
    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const startOfYesterday = new Date(startOfToday.getTime() - 86400000);
    const startOfWeek = new Date(startOfToday.getTime() - ((now.getDay() + 6) % 7) * 86400000);
    if (d >= startOfToday) return '오늘';
    if (d >= startOfYesterday) return '어제';
    if (d >= startOfWeek) return '이번주';
    return '이전';
}

function fmtTime(iso) {
    if (!iso) return '—';
    return new Date(iso).toLocaleString('ko-KR', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
}

function NotificationRow({ item, onOpen, onDelete }) {
    const meta = metaFor(item.type);
    const Icon = meta.Icon;
    const link = deepLinkOf(item);
    return (
        <div
            onClick={() => onOpen(item)}
            className={`group relative grid grid-cols-[40px_1fr_120px_120px] gap-3 items-center px-5 py-3 border-b border-[#E4E7EC] cursor-pointer transition-colors hover:bg-[#F9FAFB] ${item.read ? '' : 'bg-[rgba(5,90,175,0.03)]'}`}
        >
            <div className={`w-9 h-9 rounded-lg ${meta.tone.bg} ${meta.tone.fg} grid place-items-center flex-shrink-0`}>
                <Icon size={16} />
            </div>
            <div className="min-w-0">
                <div className="flex items-center gap-2 mb-1">
                    {!item.read && <span className="w-1.5 h-1.5 rounded-full bg-[#055AAF] flex-shrink-0" />}
                    <span className={`text-[13.5px] text-[#101828] ${item.read ? 'font-semibold' : 'font-bold'}`}>{item.title}</span>
                    <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold ${meta.chip}`}>{meta.label}</span>
                </div>
                {item.body && <div className="text-[12.5px] text-[#667085] leading-snug">{item.body}</div>}
            </div>
            <div className="text-[11.5px] text-[#667085] text-right font-mono tabular-nums">{fmtTime(item.created_at)}</div>
            <div className="flex justify-end items-center gap-1">
                {link && (
                    <button
                        onClick={(e) => { e.stopPropagation(); onOpen(item); }}
                        className="inline-flex items-center gap-1 h-[28px] px-3 rounded-full border border-[#E4E7EC] bg-white text-[11.5px] font-semibold text-[#101828] hover:bg-[#F2F4F7] cursor-pointer"
                    >
                        상세 <ArrowRight size={11} />
                    </button>
                )}
                <button
                    onClick={(e) => { e.stopPropagation(); onDelete(item.id); }}
                    className="p-1.5 text-[#C0C6D0] opacity-0 group-hover:opacity-100 hover:text-[#475467] transition-opacity"
                    title="삭제"
                >
                    <X size={15} />
                </button>
            </div>
        </div>
    );
}

const Notifications = () => {
    const [items, setItems] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [tab, setTab] = useState('all');

    const load = useCallback(async () => {
        try {
            const rows = await fetchNotifications('all');
            setItems(Array.isArray(rows) ? rows : []);
            setError(null);
        } catch (e) {
            setError(e?.message || '알림 로드 실패');
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => { load(); }, [load]);
    useEffect(() => {
        const id = setInterval(load, POLL_INTERVAL_MS);
        return () => clearInterval(id);
    }, [load]);

    const counts = useMemo(() => ({
        all: items.length,
        current: items.filter((n) => !n.read).length,
        past: items.filter((n) => n.read).length,
    }), [items]);

    const filtered = useMemo(() => {
        if (tab === 'current') return items.filter((n) => !n.read);
        if (tab === 'past') return items.filter((n) => n.read);
        return items;
    }, [items, tab]);

    const groups = useMemo(() => {
        const order = ['오늘', '어제', '이번주', '이전'];
        const byBucket = new Map(order.map((k) => [k, []]));
        for (const n of filtered) byBucket.get(bucketFor(n.created_at)).push(n);
        return order.map((when) => ({ when, items: byBucket.get(when) })).filter((g) => g.items.length > 0);
    }, [filtered]);

    const open = (n) => {
        if (!n.read) {
            setItems((list) => list.map((x) => (x.id === n.id ? { ...x, read: true } : x)));
            markNotificationRead(n.id).catch(() => {});
        }
        const link = deepLinkOf(n);
        if (link && typeof window !== 'undefined') window.location.hash = link;
    };

    const removeOne = (id) => {
        setItems((list) => list.filter((x) => x.id !== id));
        deleteNotification(id).catch(() => {});
    };

    const markAll = () => {
        if (counts.current === 0) return;
        setItems((list) => list.map((x) => ({ ...x, read: true })));
        markAllNotificationsRead().catch(() => {});
    };

    return (
        <div className="w-full max-w-[1280px] mx-auto">
            <Header
                title="알림 센터"
                subtitle={`나에게 온 알림(검수 승인·수정 등)을 ${POLL_INTERVAL_MS / 1000}초마다 자동 갱신합니다 (최근 30일).`}
                actions={
                    <div className="flex items-center gap-2">
                        <button
                            onClick={markAll}
                            disabled={counts.current === 0}
                            className="inline-flex items-center gap-1.5 h-[38px] px-4 rounded-full border border-[#E4E7EC] bg-white text-[13px] font-semibold text-[#101828] hover:bg-[#F2F4F7] cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                            <CheckCheck size={13} />모두 읽음
                        </button>
                        <button
                            onClick={load}
                            className="inline-flex items-center gap-1.5 h-[38px] px-4 rounded-full bg-[#055AAF] text-white text-[13px] font-semibold hover:bg-[#1E70E0] shadow-sm cursor-pointer"
                        >
                            <RefreshCw size={13} />새로고침
                        </button>
                    </div>
                }
            />

            <div className="flex items-center gap-1 mb-4 border-b border-[#E4E7EC]">
                {TAB_OPTIONS.map((opt) => (
                    <button
                        key={opt.key}
                        onClick={() => setTab(opt.key)}
                        className={`relative px-4 py-2 text-[13px] font-semibold cursor-pointer transition-colors ${tab === opt.key ? 'text-[#055AAF]' : 'text-[#667085] hover:text-[#101828]'}`}
                    >
                        {opt.label}
                        <span className="ml-1.5 text-[11.5px] text-[#98A2B3] font-mono">{counts[opt.key] ?? 0}</span>
                        {tab === opt.key && <span className="absolute left-0 right-0 bottom-[-1px] h-[2px] bg-[#055AAF]" />}
                    </button>
                ))}
            </div>

            {loading ? (
                <div className="flex justify-center py-12"><Loader2 className="h-5 w-5 animate-spin text-[#667085]" /></div>
            ) : (
                <div className="space-y-3">
                    {error && <p className="text-sm text-[#D92D20]">{error}</p>}
                    {groups.length === 0 ? (
                        <div className="bg-white border border-[#E4E7EC] rounded-xl py-16 px-6 text-center">
                            <div className="w-12 h-12 mx-auto mb-3 rounded-full bg-[#F2F4F7] grid place-items-center">
                                <BellOff size={20} className="text-[#98A2B3]" />
                            </div>
                            <h3 className="text-[15px] font-bold text-[#101828] mb-1">알림 없음</h3>
                            <p className="text-[13px] text-[#667085]">검수 승인 등 나에게 온 알림이 여기에 표시됩니다.</p>
                        </div>
                    ) : (
                        groups.map((g) => (
                            <div key={g.when}>
                                <div className="flex items-center gap-2 mb-2 px-1">
                                    <span className="text-[11px] font-bold text-[#055AAF] uppercase tracking-wider">{g.when}</span>
                                    <span className="text-[11.5px] text-[#98A2B3]">· {g.items.length}건</span>
                                    <div className="flex-1 h-px bg-[#E4E7EC] ml-1" />
                                </div>
                                <div className="bg-white border border-[#E4E7EC] rounded-xl overflow-hidden">
                                    {g.items.map((item) => (
                                        <NotificationRow key={item.id} item={item} onOpen={open} onDelete={removeOne} />
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
