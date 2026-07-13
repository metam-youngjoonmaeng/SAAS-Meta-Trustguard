import React, { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import {
    Plus, Pencil, Trash2, Loader2, Settings2, Check, X,
    Building2, Activity, Users, MessageCircle, ListChecks,
} from 'lucide-react';
import Header from '../components/Header';
import DomainEvalPage from './DomainEvalPage';
import {
    fetchBrands, fetchDomains,
    createBrand, updateBrand, deleteBrand,
    createDomain, updateDomain, deleteDomain,
} from '../services/api';

// 브랜드 아바타 색 선택지(카테고리형, 흰 글자) — 10색 distinct 유지. 첫 파랑 3종은
// primary / cat-account / primary 명암으로 구분(리스킨 전 3색 파랑 대체).
const COLOR_PRESETS = [
    'var(--primary)', 'var(--cat-account)', 'color-mix(in srgb, var(--primary) 78%, black)', 'var(--cat-tech)', 'var(--success)',
    'var(--warning)', 'var(--destructive)', '#a855f7', '#0ea5e9', 'var(--ink-500)',
];

function BrandTileSmall({ name, short, color, size = 36 }) {
    return (
        <div
            style={{
                width: size,
                height: size,
                borderRadius: Math.round(size * 0.28),
                background: color || 'var(--primary)',
                color: 'white',
                display: 'grid',
                placeItems: 'center',
                fontSize: Math.round(size * 0.42),
                fontWeight: 700,
                letterSpacing: '-0.02em',
                flexShrink: 0,
                boxShadow: '0 1px 0 rgba(0,0,0,0.04), inset 0 -1px 0 rgba(0,0,0,0.08)',
            }}
        >
            {short || (name ? name.slice(0, 1) : '·')}
        </div>
    );
}

function StatCard({ icon: Icon, tone, label, value, sub }) {
    return (
        <div className="bg-white border border-[var(--border)] rounded-xl p-4">
            <div className="flex items-center gap-2.5">
                <div className={`w-9 h-9 rounded-lg grid place-items-center ${tone}`}>
                    <Icon size={16} />
                </div>
                <div className="text-xs font-semibold text-[var(--ink-500)] uppercase tracking-wide">{label}</div>
            </div>
            <div className="mt-2 text-2xl font-bold text-[var(--ink-900)] tabular-nums">
                {Number(value || 0).toLocaleString('ko-KR')}
            </div>
            {sub && <div className="text-xs text-[var(--ink-500)] mt-1">{sub}</div>}
        </div>
    );
}

function BrandModal({ initial, domains, onSave, onClose, saving }) {
    const [draft, setDraft] = useState(initial);
    const set = (k, v) => setDraft((d) => ({ ...d, [k]: v }));

    if (typeof document === 'undefined') return null;
    // document.body 포털 — 본문 컨테이너에 갇히지 않고 화면 전체를 덮는다.
    return createPortal(
        <div
            className="fixed inset-0 z-[100] flex items-center justify-center px-4"
            style={{ background: 'rgba(15,23,42,0.4)' }}
            onClick={(e) => {
                if (e.target === e.currentTarget) onClose();
            }}
        >
            <div className="w-full max-w-md bg-white rounded-2xl shadow-xl overflow-hidden">
                <div className="px-6 pt-5 pb-3 flex items-center justify-between border-b border-[var(--border)]">
                    <h3 className="text-base font-bold text-[var(--ink-900)]">
                        {initial.name ? '브랜드 편집' : '새 브랜드'}
                    </h3>
                    <button
                        onClick={onClose}
                        className="w-7 h-7 grid place-items-center rounded-md text-[var(--ink-500)] hover:bg-[var(--muted)] cursor-pointer"
                    >
                        <X size={14} />
                    </button>
                </div>

                <div className="px-6 py-5 space-y-4">
                    <div>
                        <label className="block text-xs font-semibold text-[var(--ink-500)] mb-1.5 uppercase tracking-wide">
                            도메인
                        </label>
                        <select
                            value={draft.domain_id ?? ''}
                            onChange={(e) =>
                                set('domain_id', e.target.value === '' ? null : Number(e.target.value))
                            }
                            className="w-full h-[40px] px-3 rounded-xl border border-[var(--border)] bg-white text-sm outline-none focus:border-[var(--primary)]"
                        >
                            <option value="">도메인 선택</option>
                            {domains.map((d) => (
                                <option key={d.id} value={d.id}>
                                    {d.name}
                                </option>
                            ))}
                        </select>
                    </div>

                    <div>
                        <label className="block text-xs font-semibold text-[var(--ink-500)] mb-1.5 uppercase tracking-wide">
                            브랜드명 <span className="text-[var(--destructive)]">*</span>
                        </label>
                        <input
                            type="text"
                            value={draft.name}
                            onChange={(e) => set('name', e.target.value)}
                            placeholder="예) 신한카드"
                            className="w-full h-[40px] px-3 rounded-xl border border-[var(--border)] bg-white text-sm outline-none focus:border-[var(--primary)]"
                        />
                    </div>

                    <div>
                        <label className="block text-xs font-semibold text-[var(--ink-500)] mb-1.5 uppercase tracking-wide">
                            이니셜 <span className="text-xs font-normal normal-case">(타일 표시, 최대 2자)</span>
                        </label>
                        <input
                            type="text"
                            value={draft.short}
                            onChange={(e) => set('short', e.target.value.slice(0, 2))}
                            placeholder="예) 신"
                            className="w-full h-[40px] px-3 rounded-xl border border-[var(--border)] bg-white text-sm outline-none focus:border-[var(--primary)]"
                        />
                    </div>

                    <div>
                        <label className="block text-xs font-semibold text-[var(--ink-500)] mb-1.5 uppercase tracking-wide">
                            브랜드 컬러
                        </label>
                        <div className="flex items-center gap-2 flex-wrap">
                            {COLOR_PRESETS.map((c) => (
                                <button
                                    key={c}
                                    type="button"
                                    onClick={() => set('color', c)}
                                    style={{ background: c }}
                                    className="w-7 h-7 rounded-lg flex-shrink-0 cursor-pointer transition-transform hover:scale-110 grid place-items-center"
                                    title={c}
                                >
                                    {draft.color === c && <Check size={13} strokeWidth={3} className="text-white" />}
                                </button>
                            ))}
                            <input
                                type="color"
                                value={draft.color}
                                onChange={(e) => set('color', e.target.value)}
                                className="w-7 h-7 rounded-lg border border-[var(--border)] cursor-pointer p-0.5 flex-shrink-0"
                                title="직접 입력"
                            />
                        </div>
                    </div>

                    <div>
                        <label className="block text-xs font-semibold text-[var(--ink-500)] mb-1.5 uppercase tracking-wide">
                            상태
                        </label>
                        <div className="flex gap-2">
                            {[true, false].map((v) => (
                                <button
                                    key={String(v)}
                                    type="button"
                                    onClick={() => set('active', v)}
                                    className={`flex-1 h-[38px] rounded-xl border text-[13px] font-semibold cursor-pointer ${
                                        draft.active === v
                                            ? v
                                                ? 'bg-[var(--success-soft)] border-[var(--success)] text-[var(--success)]'
                                                : 'bg-[var(--warning-soft)] border-[var(--warning)] text-[var(--warning)]'
                                            : 'bg-white border-[var(--border)] text-[var(--ink-500)] hover:bg-[var(--muted)]'
                                    }`}
                                >
                                    {v ? '활성' : '비활성'}
                                </button>
                            ))}
                        </div>
                    </div>

                </div>

                <div className="px-6 pb-5 flex gap-2 justify-end">
                    <button
                        type="button"
                        onClick={onClose}
                        className="h-[38px] px-5 rounded-xl border border-[var(--border)] bg-white text-[13px] font-semibold text-[var(--ink-900)] hover:bg-[var(--muted)] cursor-pointer"
                    >
                        취소
                    </button>
                    <button
                        type="button"
                        onClick={() => onSave(draft)}
                        disabled={!draft.name.trim() || saving}
                        className="h-[38px] px-5 rounded-xl bg-[var(--primary)] text-white text-[13px] font-semibold hover:bg-[var(--primary)] shadow-sm disabled:opacity-50 cursor-pointer"
                    >
                        {saving ? <Loader2 size={14} className="animate-spin inline" /> : '저장'}
                    </button>
                </div>
            </div>
        </div>,
        document.body
    );
}

function DomainsPanel({ domains, onDomainsChange, onOpenEvalPage }) {
    const [adding, setAdding] = useState(false);
    const [newName, setNewName] = useState('');
    const [newKey, setNewKey] = useState('');
    const [saving, setSaving] = useState(false);
    const [editId, setEditId] = useState(null);
    const [editName, setEditName] = useState('');
    const [editKey, setEditKey] = useState('');

    async function handleAdd() {
        if (!newName.trim()) return;
        setSaving(true);
        try {
            const created = await createDomain({
                name: newName.trim(),
                key: newKey.trim(),
                sort_order: domains.length + 1,
            });
            onDomainsChange([...domains, created]);
            setNewName('');
            setNewKey('');
            setAdding(false);
        } catch (err) {
            console.error(err);
            alert('도메인 추가 실패');
        } finally {
            setSaving(false);
        }
    }

    async function handleRename(id) {
        if (!editName.trim()) return;
        try {
            const updated = await updateDomain(id, {
                name: editName.trim(),
                key: editKey.trim(),
            });
            onDomainsChange(domains.map((d) => (d.id === id ? { ...d, ...updated } : d)));
            setEditId(null);
        } catch (err) {
            console.error(err);
            alert('도메인 수정 실패');
        }
    }

    async function handleDelete(d) {
        if (!confirm(`"${d.name}" 도메인을 삭제하시겠습니까?`)) return;
        try {
            await deleteDomain(d.id);
            onDomainsChange(domains.filter((x) => x.id !== d.id));
        } catch (err) {
            console.error(err);
            alert('도메인 삭제 실패');
        }
    }

    return (
        <div className="bg-white border border-[var(--border)] rounded-xl overflow-hidden">
            <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--border)] bg-[var(--background-soft)]">
                <span className="text-[12px] font-semibold text-[var(--ink-500)] uppercase tracking-wide">
                    도메인 목록
                </span>
                <button
                    onClick={() => setAdding((v) => !v)}
                    className="inline-flex items-center gap-1 h-[26px] px-2.5 rounded-lg border border-[var(--border)] bg-white text-[11.5px] font-semibold text-[var(--ink-900)] hover:bg-[var(--muted)] cursor-pointer"
                >
                    <Plus size={11} /> 추가
                </button>
            </div>
            <div className="divide-y divide-[var(--border)]">
                {domains.map((d) => (
                    <div key={d.id} className="flex items-center gap-2 px-4 py-2.5">
                        {editId === d.id ? (
                            <>
                                <input
                                    autoFocus
                                    value={editName}
                                    onChange={(e) => setEditName(e.target.value)}
                                    placeholder="도메인명"
                                    className="flex-1 h-[30px] px-2 rounded-lg border border-[var(--primary)] text-sm outline-none"
                                />
                                <input
                                    value={editKey}
                                    onChange={(e) => setEditKey(e.target.value)}
                                    placeholder="key (영문)"
                                    className="w-28 h-[30px] px-2 rounded-lg border border-[var(--border)] text-sm outline-none"
                                />
                                <button
                                    onClick={() => handleRename(d.id)}
                                    className="text-[12px] font-semibold text-[var(--primary)] cursor-pointer"
                                >
                                    저장
                                </button>
                                <button
                                    onClick={() => setEditId(null)}
                                    className="text-[12px] text-[var(--ink-500)] cursor-pointer"
                                >
                                    취소
                                </button>
                            </>
                        ) : (
                            <>
                                <span className="flex-1 text-[13px] font-medium text-[var(--ink-900)]">{d.name}</span>
                                <span className="text-[11px] font-mono text-[var(--ink-400)]">{d.key || '—'}</span>
                                <button
                                    onClick={() => onOpenEvalPage(d)}
                                    className="inline-flex items-center gap-1 h-[26px] px-2.5 rounded-lg border border-[var(--border)] bg-white text-[11.5px] font-semibold text-[var(--primary)] hover:bg-[var(--background)] cursor-pointer"
                                    title="이 도메인의 기본 평가체계(평가항목·펜타곤) 설정"
                                >
                                    <ListChecks size={12} /> 평가체계
                                </button>
                                <button
                                    onClick={() => {
                                        setEditId(d.id);
                                        setEditName(d.name);
                                        setEditKey(d.key || '');
                                    }}
                                    className="text-[11.5px] text-[var(--ink-500)] hover:text-[var(--ink-900)] cursor-pointer p-1"
                                >
                                    <Pencil size={12} />
                                </button>
                                <button
                                    onClick={() => handleDelete(d)}
                                    className="text-[11.5px] text-[var(--ink-500)] hover:text-[var(--destructive)] cursor-pointer p-1"
                                >
                                    <Trash2 size={12} />
                                </button>
                            </>
                        )}
                    </div>
                ))}
                {adding && (
                    <div className="flex items-center gap-2 px-4 py-2.5">
                        <input
                            autoFocus
                            value={newName}
                            onChange={(e) => setNewName(e.target.value)}
                            placeholder="새 도메인명 (예: 보험)"
                            className="flex-1 h-[30px] px-2 rounded-lg border border-[var(--primary)] text-sm outline-none"
                        />
                        <input
                            value={newKey}
                            onChange={(e) => setNewKey(e.target.value)}
                            placeholder="key (예: insurance)"
                            className="w-32 h-[30px] px-2 rounded-lg border border-[var(--border)] text-sm outline-none"
                        />
                        <button
                            onClick={handleAdd}
                            disabled={saving}
                            className="text-[12px] font-semibold text-[var(--primary)] cursor-pointer disabled:opacity-50"
                        >
                            {saving ? <Loader2 size={12} className="animate-spin inline" /> : '추가'}
                        </button>
                        <button
                            onClick={() => setAdding(false)}
                            className="text-[12px] text-[var(--ink-500)] cursor-pointer"
                        >
                            취소
                        </button>
                    </div>
                )}
                {domains.length === 0 && !adding && (
                    <div className="px-4 py-6 text-center text-sm text-[var(--ink-500)]">도메인이 없습니다</div>
                )}
            </div>
        </div>
    );
}

const Brands = ({ onBrandsChanged } = {}) => {
    const [items, setItems] = useState([]);
    const [domains, setDomains] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [search, setSearch] = useState('');
    const [domainFilter, setDomainFilter] = useState('');
    const [showDomains, setShowDomains] = useState(false);
    const [modalState, setModalState] = useState({ open: false, target: null });
    const [saving, setSaving] = useState(false);
    const [evalPageDomain, setEvalPageDomain] = useState(null); // 도메인 기본 평가체계 편집 페이지 대상

    async function load() {
        setLoading(true);
        try {
            const [brandsData, domainsData] = await Promise.all([fetchBrands(), fetchDomains()]);
            setItems(brandsData);
            setDomains(domainsData);
            setError(null);
        } catch (e) {
            setError(e?.message || '로드 실패');
        } finally {
            setLoading(false);
        }
    }

    useEffect(() => {
        load();
    }, []);

    async function handleSave(draft) {
        setSaving(true);
        try {
            if (modalState.target) {
                const updated = await updateBrand(modalState.target.id, draft);
                setItems((prev) => prev.map((b) => (b.id === modalState.target.id ? { ...b, ...updated } : b)));
            } else {
                await createBrand({
                    name: draft.name,
                    short: draft.short,
                    color: draft.color,
                    domain_id: draft.domain_id,
                });
                await load();
            }
            setModalState({ open: false, target: null });
            // App canonical brands(사이드바 선택기) 즉시 반영 — 새로고침 불필요
            if (onBrandsChanged) onBrandsChanged();
        } catch (e) {
            setError(e?.message || '저장 실패');
        } finally {
            setSaving(false);
        }
    }

    async function handleToggle(b) {
        try {
            await updateBrand(b.id, { active: !b.active });
            setItems((prev) => prev.map((x) => (x.id === b.id ? { ...x, active: !b.active } : x)));
            if (onBrandsChanged) onBrandsChanged();
        } catch (e) {
            setError(e?.message || '상태 변경 실패');
        }
    }

    async function handleDelete(b) {
        if (!confirm(`"${b.name}" 브랜드를 삭제하시겠습니까?\n이 작업은 되돌릴 수 없습니다.`)) return;
        try {
            await deleteBrand(b.id);
            setItems((prev) => prev.filter((x) => x.id !== b.id));
            if (onBrandsChanged) onBrandsChanged();
        } catch (e) {
            setError(e?.message || '삭제 실패');
        }
    }

    const filtered = useMemo(
        () =>
            items.filter((b) => {
                if (search && !b.name.toLowerCase().includes(search.toLowerCase())) return false;
                if (domainFilter !== '' && b.domain_id !== domainFilter) return false;
                return true;
            }),
        [items, search, domainFilter]
    );

    const totalBrands = items.length;
    const activeBrands = items.filter((b) => b.active).length;
    const totalMembers = items.reduce((s, b) => s + (b.members || 0), 0);
    const totalSessions = items.reduce((s, b) => s + (b.sessions || 0), 0);

    // 도메인 평가체계 편집 — 전체 페이지로 전환(AI QA 항목관리와 동일한 풀페이지 UX).
    if (evalPageDomain) {
        return <DomainEvalPage domain={evalPageDomain} onBack={() => setEvalPageDomain(null)} />;
    }

    return (
        <div className="w-full">
            <Header
                title="브랜드 관리"
                subtitle="브랜드(=조직)와 도메인(=업종)을 등록·편집합니다. 콜 데이터는 등록된 브랜드 단위로 격리됩니다."
                actions={null}
            />

            {loading ? (
                <div className="flex justify-center py-12">
                    <Loader2 className="h-5 w-5 animate-spin text-[var(--ink-500)]" />
                </div>
            ) : (
                <div className="space-y-[14px]">
                    <div className="grid grid-cols-4 gap-3.5">
                        <StatCard
                            icon={Building2}
                            tone="bg-[var(--primary-soft)] text-[var(--primary)]"
                            label="전체 브랜드"
                            value={totalBrands}
                            sub="등록된 전체 브랜드 수"
                        />
                        <StatCard
                            icon={Activity}
                            tone="bg-[var(--success-soft)] text-[var(--success)]"
                            label="활성 브랜드"
                            value={activeBrands}
                            sub={`${totalBrands ? Math.round((activeBrands / totalBrands) * 100) : 0}%가 활성`}
                        />
                        <StatCard
                            icon={Users}
                            tone="bg-[var(--cat-policy-soft)] text-[var(--cat-policy)]"
                            label="전체 사용자"
                            value={totalMembers}
                            sub="모든 브랜드 합산"
                        />
                        <StatCard
                            icon={MessageCircle}
                            tone="bg-[var(--warning-soft)] text-[var(--warning)]"
                            label="누적 콜"
                            value={totalSessions}
                            sub="모든 브랜드 운영 콜 합산"
                        />
                    </div>

                    {error && <p className="text-sm text-[var(--destructive)]">{error}</p>}

                    <div className="flex items-center gap-2 flex-wrap">
                        <input
                            type="text"
                            placeholder="브랜드명 검색"
                            value={search}
                            onChange={(e) => setSearch(e.target.value)}
                            className="h-[38px] w-[220px] px-3 rounded-xl border border-[var(--border)] bg-white text-[13px] outline-none focus:border-[var(--primary)]"
                        />
                        <select
                            value={domainFilter}
                            onChange={(e) =>
                                setDomainFilter(e.target.value === '' ? '' : Number(e.target.value))
                            }
                            className="h-[38px] px-3 rounded-xl border border-[var(--border)] bg-white text-[13px] outline-none focus:border-[var(--primary)] cursor-pointer text-[var(--ink-900)]"
                        >
                            <option value="">전체 도메인</option>
                            {domains.map((d) => (
                                <option key={d.id} value={d.id}>
                                    {d.name}
                                </option>
                            ))}
                        </select>
                        <div className="ml-auto flex items-center gap-2">
                            <button
                                onClick={() => setShowDomains((v) => !v)}
                                className="inline-flex items-center gap-1.5 h-[38px] px-4 rounded-full border border-[var(--border)] bg-white text-[13px] font-semibold text-[var(--ink-900)] hover:bg-[var(--muted)] cursor-pointer"
                            >
                                <Settings2 size={13} /> 도메인 편집
                            </button>
                            <button
                                onClick={() => setModalState({ open: true, target: null })}
                                className="inline-flex items-center gap-1.5 h-[38px] px-4 rounded-full bg-[var(--primary)] text-white text-[13px] font-semibold hover:bg-[var(--primary)] shadow-sm cursor-pointer"
                            >
                                <Plus size={14} /> 새 브랜드
                            </button>
                        </div>
                    </div>

                    {showDomains && <DomainsPanel domains={domains} onDomainsChange={setDomains} onOpenEvalPage={setEvalPageDomain} />}

                    <div className="bg-white border border-[var(--border)] rounded-xl overflow-hidden">
                        <table className="w-full text-sm">
                            <thead>
                                <tr className="border-b border-[var(--border)] bg-[var(--background-soft)]">
                                    <th className="px-4 py-3 text-left text-[11.5px] font-semibold text-[var(--ink-500)] uppercase tracking-wider w-[35%]">
                                        브랜드
                                    </th>
                                    <th className="px-4 py-3 text-left text-[11.5px] font-semibold text-[var(--ink-500)] uppercase tracking-wider">
                                        도메인
                                    </th>
                                    <th className="px-4 py-3 text-right text-[11.5px] font-semibold text-[var(--ink-500)] uppercase tracking-wider">
                                        사용자
                                    </th>
                                    <th className="px-4 py-3 text-right text-[11.5px] font-semibold text-[var(--ink-500)] uppercase tracking-wider">
                                        누적 콜
                                    </th>
                                    <th className="px-4 py-3 text-center text-[11.5px] font-semibold text-[var(--ink-500)] uppercase tracking-wider">
                                        상태
                                    </th>
                                    <th className="px-4 py-3 text-left text-[11.5px] font-semibold text-[var(--ink-500)] uppercase tracking-wider">
                                        등록일
                                    </th>
                                    <th className="px-4 py-3 text-right text-[11.5px] font-semibold text-[var(--ink-500)] uppercase tracking-wider">
                                        액션
                                    </th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-[var(--border)]">
                                {filtered.length === 0 && (
                                    <tr>
                                        <td colSpan={7} className="px-4 py-10 text-center text-sm text-[var(--ink-500)]">
                                            {search || domainFilter !== ''
                                                ? '검색 결과가 없습니다'
                                                : '등록된 브랜드가 없습니다'}
                                        </td>
                                    </tr>
                                )}
                                {filtered.map((b) => (
                                    <tr key={b.id} className="hover:bg-[var(--background-soft)]">
                                        <td className="px-4 py-3">
                                            <div className="flex items-center gap-3">
                                                <BrandTileSmall name={b.name} short={b.short} color={b.color} size={34} />
                                                <div>
                                                    <div className="font-semibold text-[13.5px] text-[var(--ink-900)] leading-tight">
                                                        {b.name}
                                                    </div>
                                                    <div className="text-[11px] text-[var(--ink-500)] mt-0.5 font-mono">{b.short}</div>
                                                </div>
                                            </div>
                                        </td>
                                        <td className="px-4 py-3">
                                            {b.domain_name ? (
                                                <span className="inline-flex items-center px-2 py-0.5 rounded-md text-[11.5px] font-semibold bg-[var(--muted)] text-[var(--ink-500)]">
                                                    {b.domain_name}
                                                </span>
                                            ) : (
                                                <span className="text-[11.5px] text-[var(--ink-500)]">—</span>
                                            )}
                                        </td>
                                        <td className="px-4 py-3 text-right tabular-nums text-[13px] font-semibold text-[var(--ink-900)]">
                                            {Number(b.members || 0).toLocaleString('ko-KR')}
                                            <span className="text-[11px] font-normal text-[var(--ink-500)] ml-0.5">명</span>
                                        </td>
                                        <td className="px-4 py-3 text-right tabular-nums text-[13px] font-semibold text-[var(--ink-900)]">
                                            {Number(b.sessions || 0).toLocaleString('ko-KR')}
                                            <span className="text-[11px] font-normal text-[var(--ink-500)] ml-0.5">건</span>
                                        </td>
                                        <td className="px-4 py-3 text-center">
                                            <button
                                                onClick={() => handleToggle(b)}
                                                title={b.active ? '클릭하여 비활성화' : '클릭하여 활성화'}
                                                className="cursor-pointer"
                                            >
                                                {b.active ? (
                                                    <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11.5px] font-semibold bg-[var(--success-soft)] text-[var(--success)]">
                                                        <span className="w-1.5 h-1.5 rounded-full bg-[var(--success)]" /> 활성
                                                    </span>
                                                ) : (
                                                    <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11.5px] font-semibold bg-[var(--muted)] text-[var(--ink-500)]">
                                                        <span className="w-1.5 h-1.5 rounded-full bg-[var(--ink-500)]" /> 비활성
                                                    </span>
                                                )}
                                            </button>
                                        </td>
                                        <td className="px-4 py-3 text-[12.5px] text-[var(--ink-500)] tabular-nums">
                                            {b.created_at
                                                ? new Date(b.created_at).toLocaleDateString('ko-KR', {
                                                      year: 'numeric',
                                                      month: 'short',
                                                      day: 'numeric',
                                                  })
                                                : '—'}
                                        </td>
                                        <td className="px-4 py-3 text-right">
                                            <div className="inline-flex items-center gap-1.5">
                                                <button
                                                    onClick={() => setModalState({ open: true, target: b })}
                                                    className="inline-flex items-center gap-1 h-[28px] px-3 rounded-lg border border-[var(--border)] bg-white text-[12px] font-semibold text-[var(--ink-900)] hover:bg-[var(--muted)] cursor-pointer"
                                                >
                                                    <Pencil size={11} /> 편집
                                                </button>
                                                <button
                                                    onClick={() => handleDelete(b)}
                                                    className="inline-flex items-center gap-1 h-[28px] px-3 rounded-lg border border-[var(--destructive)] bg-white text-[12px] font-semibold text-[var(--destructive)] hover:bg-[var(--destructive-soft)] cursor-pointer"
                                                >
                                                    <Trash2 size={11} /> 삭제
                                                </button>
                                            </div>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                        <div className="flex items-center justify-between px-4 py-3 border-t border-[var(--border)] bg-[var(--background-soft)] text-xs text-[var(--ink-500)]">
                            <span>총 {filtered.length}개 브랜드</span>
                        </div>
                    </div>
                </div>
            )}

            {modalState.open && (
                <BrandModal
                    initial={
                        modalState.target
                            ? {
                                  name: modalState.target.name,
                                  short: modalState.target.short,
                                  color: modalState.target.color,
                                  active: modalState.target.active,
                                  domain_id: modalState.target.domain_id,
                              }
                            : { name: '', short: '', color: 'var(--primary)', active: true, domain_id: null }
                    }
                    onSave={handleSave}
                    onClose={() => setModalState({ open: false, target: null })}
                    saving={saving}
                    domains={domains}
                />
            )}
        </div>
    );
};

export default Brands;
