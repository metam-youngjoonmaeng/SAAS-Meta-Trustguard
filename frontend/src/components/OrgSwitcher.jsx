// 조직(소속) 전환 셀렉터 — 다중 소속(02/03 동일) 사용자용.
// 소속이 2개 이상일 때만 노출. 선택 시 서버 활성 멤버십 전환 후 새로고침(전 화면 새 org 재조회).
import React, { useEffect, useRef, useState } from 'react';
import { Building2, Check, ChevronDown, Loader2 } from 'lucide-react';
import { fetchMyMemberships, switchOrg } from '../services/api';

const ROLE_LABEL = { agent: '상담사', admin: '관리자', super_admin: '슈퍼관리자' };

export default function OrgSwitcher() {
    const [items, setItems] = useState([]);
    const [open, setOpen] = useState(false);
    const [busy, setBusy] = useState(false);
    const ref = useRef(null);

    useEffect(() => {
        let cancelled = false;
        fetchMyMemberships()
            .then((d) => { if (!cancelled) setItems(Array.isArray(d) ? d : []); })
            .catch(() => { if (!cancelled) setItems([]); });
        return () => { cancelled = true; };
    }, []);

    useEffect(() => {
        if (!open) return undefined;
        const onDoc = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
        document.addEventListener('mousedown', onDoc);
        return () => document.removeEventListener('mousedown', onDoc);
    }, [open]);

    if (items.length < 2) return null;  // 단일 소속이면 전환 UI 불필요

    const current = items.find((m) => m.current) || items[0];

    const pick = async (m) => {
        if (busy) return;
        if (m.current) { setOpen(false); return; }
        setBusy(true);
        try {
            await switchOrg(m.trainee_id);
            window.location.reload();  // 서버 세션이 새 org/role → 전 화면을 새 org 로 재조회
        } catch {
            setBusy(false);
            alert('조직 전환에 실패했습니다.');
        }
    };

    return (
        <div ref={ref} className="relative">
            <button
                type="button"
                onClick={() => setOpen((v) => !v)}
                className="inline-flex items-center gap-1.5 h-9 px-2.5 rounded-lg border border-[var(--border)] text-[var(--ink-700)] hover:bg-[var(--background-soft)] transition-colors max-w-[200px]"
                title="소속 조직 전환"
            >
                <Building2 size={15} className="text-[var(--ink-500)] shrink-0" />
                <span className="text-[13px] font-semibold truncate">{current?.org_name || '조직'}</span>
                <ChevronDown size={14} className="text-[var(--ink-400)] shrink-0" />
            </button>

            {open && (
                <div className="absolute right-0 top-[calc(100%+6px)] z-[120] w-[240px] bg-white rounded-xl border border-[var(--border)] shadow-xl overflow-hidden">
                    <div className="px-3 py-2 text-[11px] font-bold uppercase tracking-wide text-[var(--ink-400)] border-b border-[var(--border)]">소속 조직 전환</div>
                    <div className="max-h-[280px] overflow-y-auto py-1">
                        {items.map((m) => (
                            <button
                                key={m.trainee_id}
                                type="button"
                                onClick={() => pick(m)}
                                disabled={busy}
                                className={`w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-[var(--background-soft)] transition-colors ${m.current ? 'bg-[var(--violet-soft)]' : ''}`}
                            >
                                <Building2 size={14} className="text-[var(--ink-500)] shrink-0" />
                                <span className="flex-1 min-w-0">
                                    <span className="block text-[13px] font-semibold text-[var(--ink-900)] truncate">{m.org_name || `조직 ${m.org_id}`}</span>
                                    <span className="block text-[11px] text-[var(--ink-500)]">{ROLE_LABEL[m.role] || m.role}{m.department ? ` · ${m.department}` : ''}</span>
                                </span>
                                {m.current
                                    ? <Check size={15} className="text-[var(--violet)] shrink-0" />
                                    : (busy ? <Loader2 size={14} className="animate-spin text-[var(--ink-400)] shrink-0" /> : null)}
                            </button>
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
}
