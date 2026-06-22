import React, { useEffect, useMemo, useState } from 'react';
import {
    Plus, Pencil, Trash2, Loader2, Settings2, Check, X,
    Building2, Activity, Users, MessageCircle,
} from 'lucide-react';
import Header from '../components/Header';
import {
    fetchBrands, fetchDomains,
    createBrand, updateBrand, deleteBrand,
    createDomain, updateDomain, deleteDomain,
} from '../services/api';

const COLOR_PRESETS = [
    '#055AAF', '#1E70E0', '#003078', '#6f7ede', '#22c55e',
    '#f59e0b', '#ef4444', '#a855f7', '#0ea5e9', '#64748b',
];

function BrandTileSmall({ name, short, color, size = 36 }) {
    return (
        <div
            style={{
                width: size,
                height: size,
                borderRadius: Math.round(size * 0.28),
                background: color || '#055AAF',
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
        <div className="bg-white border border-[#E4E7EC] rounded-xl p-4">
            <div className="flex items-center gap-2.5">
                <div className={`w-9 h-9 rounded-lg grid place-items-center ${tone}`}>
                    <Icon size={16} />
                </div>
                <div className="text-xs font-semibold text-[#667085] uppercase tracking-wide">{label}</div>
            </div>
            <div className="mt-2 text-2xl font-bold text-[#101828] tabular-nums">
                {Number(value || 0).toLocaleString('ko-KR')}
            </div>
            {sub && <div className="text-xs text-[#667085] mt-1">{sub}</div>}
        </div>
    );
}

function BrandModal({ initial, domains, onSave, onClose, saving }) {
    const [draft, setDraft] = useState(initial);
    const set = (k, v) => setDraft((d) => ({ ...d, [k]: v }));

    return (
        <div
            className="fixed inset-0 z-[100] flex items-center justify-center px-4"
            style={{ background: 'rgba(15,23,42,0.4)' }}
            onClick={(e) => {
                if (e.target === e.currentTarget) onClose();
            }}
        >
            <div className="w-full max-w-md bg-white rounded-2xl shadow-xl overflow-hidden">
                <div className="px-6 pt-5 pb-3 flex items-center justify-between border-b border-[#E4E7EC]">
                    <h3 className="text-base font-bold text-[#101828]">
                        {initial.name ? '브랜드 편집' : '새 브랜드'}
                    </h3>
                    <button
                        onClick={onClose}
                        className="w-7 h-7 grid place-items-center rounded-md text-[#667085] hover:bg-[#F2F4F7] cursor-pointer"
                    >
                        <X size={14} />
                    </button>
                </div>

                <div className="px-6 py-5 space-y-4">
                    <div>
                        <label className="block text-xs font-semibold text-[#667085] mb-1.5 uppercase tracking-wide">
                            도메인
                        </label>
                        <select
                            value={draft.domain_id ?? ''}
                            onChange={(e) =>
                                set('domain_id', e.target.value === '' ? null : Number(e.target.value))
                            }
                            className="w-full h-[40px] px-3 rounded-xl border border-[#E4E7EC] bg-white text-sm outline-none focus:border-[#055AAF]"
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
                        <label className="block text-xs font-semibold text-[#667085] mb-1.5 uppercase tracking-wide">
                            브랜드명 <span className="text-[#D92D20]">*</span>
                        </label>
                        <input
                            type="text"
                            value={draft.name}
                            onChange={(e) => set('name', e.target.value)}
                            placeholder="예) 신한카드"
                            className="w-full h-[40px] px-3 rounded-xl border border-[#E4E7EC] bg-white text-sm outline-none focus:border-[#055AAF]"
                        />
                    </div>

                    <div>
                        <label className="block text-xs font-semibold text-[#667085] mb-1.5 uppercase tracking-wide">
                            이니셜 <span className="text-xs font-normal normal-case">(타일 표시, 최대 2자)</span>
                        </label>
                        <input
                            type="text"
                            value={draft.short}
                            onChange={(e) => set('short', e.target.value.slice(0, 2))}
                            placeholder="예) 신"
                            className="w-full h-[40px] px-3 rounded-xl border border-[#E4E7EC] bg-white text-sm outline-none focus:border-[#055AAF]"
                        />
                    </div>

                    <div>
                        <label className="block text-xs font-semibold text-[#667085] mb-1.5 uppercase tracking-wide">
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
                                className="w-7 h-7 rounded-lg border border-[#E4E7EC] cursor-pointer p-0.5 flex-shrink-0"
                                title="직접 입력"
                            />
                        </div>
                    </div>

                    <div>
                        <label className="block text-xs font-semibold text-[#667085] mb-1.5 uppercase tracking-wide">
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
                                                ? 'bg-green-50 border-green-200 text-green-700'
                                                : 'bg-amber-50 border-amber-200 text-amber-700'
                                            : 'bg-white border-[#E4E7EC] text-[#667085] hover:bg-[#F2F4F7]'
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
                        className="h-[38px] px-5 rounded-xl border border-[#E4E7EC] bg-white text-[13px] font-semibold text-[#101828] hover:bg-[#F2F4F7] cursor-pointer"
                    >
                        취소
                    </button>
                    <button
                        type="button"
                        onClick={() => onSave(draft)}
                        disabled={!draft.name.trim() || saving}
                        className="h-[38px] px-5 rounded-xl bg-[#055AAF] text-white text-[13px] font-semibold hover:bg-[#1E70E0] shadow-sm disabled:opacity-50 cursor-pointer"
                    >
                        {saving ? <Loader2 size={14} className="animate-spin inline" /> : '저장'}
                    </button>
                </div>
            </div>
        </div>
    );
}

function DomainsPanel({ domains, onDomainsChange }) {
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
        <div className="bg-white border border-[#E4E7EC] rounded-xl overflow-hidden">
            <div className="flex items-center justify-between px-4 py-3 border-b border-[#E4E7EC] bg-[#F9FAFB]">
                <span className="text-[12px] font-semibold text-[#667085] uppercase tracking-wide">
                    도메인 목록
                </span>
                <button
                    onClick={() => setAdding((v) => !v)}
                    className="inline-flex items-center gap-1 h-[26px] px-2.5 rounded-lg border border-[#E4E7EC] bg-white text-[11.5px] font-semibold text-[#101828] hover:bg-[#F2F4F7] cursor-pointer"
                >
                    <Plus size={11} /> 추가
                </button>
            </div>
            <div className="divide-y divide-[#E4E7EC]">
                {domains.map((d) => (
                    <div key={d.id} className="flex items-center gap-2 px-4 py-2.5">
                        {editId === d.id ? (
                            <>
                                <input
                                    autoFocus
                                    value={editName}
                                    onChange={(e) => setEditName(e.target.value)}
                                    placeholder="도메인명"
                                    className="flex-1 h-[30px] px-2 rounded-lg border border-[#055AAF] text-sm outline-none"
                                />
                                <input
                                    value={editKey}
                                    onChange={(e) => setEditKey(e.target.value)}
                                    placeholder="key (영문)"
                                    className="w-28 h-[30px] px-2 rounded-lg border border-[#E4E7EC] text-sm outline-none"
                                />
                                <button
                                    onClick={() => handleRename(d.id)}
                                    className="text-[12px] font-semibold text-[#055AAF] cursor-pointer"
                                >
                                    저장
                                </button>
                                <button
                                    onClick={() => setEditId(null)}
                                    className="text-[12px] text-[#667085] cursor-pointer"
                                >
                                    취소
                                </button>
                            </>
                        ) : (
                            <>
                                <span className="flex-1 text-[13px] font-medium text-[#101828]">{d.name}</span>
                                <span className="text-[11px] font-mono text-[#98A2B3]">{d.key || '—'}</span>
                                <button
                                    onClick={() => {
                                        setEditId(d.id);
                                        setEditName(d.name);
                                        setEditKey(d.key || '');
                                    }}
                                    className="text-[11.5px] text-[#667085] hover:text-[#101828] cursor-pointer p-1"
                                >
                                    <Pencil size={12} />
                                </button>
                                <button
                                    onClick={() => handleDelete(d)}
                                    className="text-[11.5px] text-[#667085] hover:text-[#D92D20] cursor-pointer p-1"
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
                            className="flex-1 h-[30px] px-2 rounded-lg border border-[#055AAF] text-sm outline-none"
                        />
                        <input
                            value={newKey}
                            onChange={(e) => setNewKey(e.target.value)}
                            placeholder="key (예: insurance)"
                            className="w-32 h-[30px] px-2 rounded-lg border border-[#E4E7EC] text-sm outline-none"
                        />
                        <button
                            onClick={handleAdd}
                            disabled={saving}
                            className="text-[12px] font-semibold text-[#055AAF] cursor-pointer disabled:opacity-50"
                        >
                            {saving ? <Loader2 size={12} className="animate-spin inline" /> : '추가'}
                        </button>
                        <button
                            onClick={() => setAdding(false)}
                            className="text-[12px] text-[#667085] cursor-pointer"
                        >
                            취소
                        </button>
                    </div>
                )}
                {domains.length === 0 && !adding && (
                    <div className="px-4 py-6 text-center text-sm text-[#667085]">도메인이 없습니다</div>
                )}
            </div>
        </div>
    );
}

const Brands = () => {
    const [items, setItems] = useState([]);
    const [domains, setDomains] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [search, setSearch] = useState('');
    const [domainFilter, setDomainFilter] = useState('');
    const [showDomains, setShowDomains] = useState(false);
    const [modalState, setModalState] = useState({ open: false, target: null });
    const [saving, setSaving] = useState(false);

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
        } catch (e) {
            setError(e?.message || '상태 변경 실패');
        }
    }

    async function handleDelete(b) {
        if (!confirm(`"${b.name}" 브랜드를 삭제하시겠습니까?\n이 작업은 되돌릴 수 없습니다.`)) return;
        try {
            await deleteBrand(b.id);
            setItems((prev) => prev.filter((x) => x.id !== b.id));
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

    return (
        <div className="w-full">
            <Header
                title="브랜드 관리"
                subtitle="브랜드(=조직)와 도메인(=업종)을 등록·편집합니다. 콜 데이터는 등록된 브랜드 단위로 격리됩니다."
                actions={null}
            />

            {loading ? (
                <div className="flex justify-center py-12">
                    <Loader2 className="h-5 w-5 animate-spin text-[#667085]" />
                </div>
            ) : (
                <div className="space-y-[14px]">
                    <div className="grid grid-cols-4 gap-3.5">
                        <StatCard
                            icon={Building2}
                            tone="bg-blue-50 text-blue-600"
                            label="전체 브랜드"
                            value={totalBrands}
                            sub="등록된 전체 브랜드 수"
                        />
                        <StatCard
                            icon={Activity}
                            tone="bg-green-50 text-green-600"
                            label="활성 브랜드"
                            value={activeBrands}
                            sub={`${totalBrands ? Math.round((activeBrands / totalBrands) * 100) : 0}%가 활성`}
                        />
                        <StatCard
                            icon={Users}
                            tone="bg-purple-50 text-purple-600"
                            label="전체 사용자"
                            value={totalMembers}
                            sub="모든 브랜드 합산"
                        />
                        <StatCard
                            icon={MessageCircle}
                            tone="bg-amber-50 text-amber-600"
                            label="누적 콜"
                            value={totalSessions}
                            sub="모든 브랜드 운영 콜 합산"
                        />
                    </div>

                    {error && <p className="text-sm text-[#D92D20]">{error}</p>}

                    <div className="flex items-center gap-2 flex-wrap">
                        <input
                            type="text"
                            placeholder="브랜드명 검색"
                            value={search}
                            onChange={(e) => setSearch(e.target.value)}
                            className="h-[38px] w-[220px] px-3 rounded-xl border border-[#E4E7EC] bg-white text-[13px] outline-none focus:border-[#055AAF]"
                        />
                        <select
                            value={domainFilter}
                            onChange={(e) =>
                                setDomainFilter(e.target.value === '' ? '' : Number(e.target.value))
                            }
                            className="h-[38px] px-3 rounded-xl border border-[#E4E7EC] bg-white text-[13px] outline-none focus:border-[#055AAF] cursor-pointer text-[#101828]"
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
                                className="inline-flex items-center gap-1.5 h-[38px] px-4 rounded-full border border-[#E4E7EC] bg-white text-[13px] font-semibold text-[#101828] hover:bg-[#F2F4F7] cursor-pointer"
                            >
                                <Settings2 size={13} /> 도메인 편집
                            </button>
                            <button
                                onClick={() => setModalState({ open: true, target: null })}
                                className="inline-flex items-center gap-1.5 h-[38px] px-4 rounded-full bg-[#055AAF] text-white text-[13px] font-semibold hover:bg-[#1E70E0] shadow-sm cursor-pointer"
                            >
                                <Plus size={14} /> 새 브랜드
                            </button>
                        </div>
                    </div>

                    {showDomains && <DomainsPanel domains={domains} onDomainsChange={setDomains} />}

                    <div className="bg-white border border-[#E4E7EC] rounded-xl overflow-hidden">
                        <table className="w-full text-sm">
                            <thead>
                                <tr className="border-b border-[#E4E7EC] bg-[#F9FAFB]">
                                    <th className="px-4 py-3 text-left text-[11.5px] font-semibold text-[#667085] uppercase tracking-wider w-[35%]">
                                        브랜드
                                    </th>
                                    <th className="px-4 py-3 text-left text-[11.5px] font-semibold text-[#667085] uppercase tracking-wider">
                                        도메인
                                    </th>
                                    <th className="px-4 py-3 text-right text-[11.5px] font-semibold text-[#667085] uppercase tracking-wider">
                                        사용자
                                    </th>
                                    <th className="px-4 py-3 text-right text-[11.5px] font-semibold text-[#667085] uppercase tracking-wider">
                                        누적 콜
                                    </th>
                                    <th className="px-4 py-3 text-center text-[11.5px] font-semibold text-[#667085] uppercase tracking-wider">
                                        상태
                                    </th>
                                    <th className="px-4 py-3 text-left text-[11.5px] font-semibold text-[#667085] uppercase tracking-wider">
                                        등록일
                                    </th>
                                    <th className="px-4 py-3 text-right text-[11.5px] font-semibold text-[#667085] uppercase tracking-wider">
                                        액션
                                    </th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-[#E4E7EC]">
                                {filtered.length === 0 && (
                                    <tr>
                                        <td colSpan={7} className="px-4 py-10 text-center text-sm text-[#667085]">
                                            {search || domainFilter !== ''
                                                ? '검색 결과가 없습니다'
                                                : '등록된 브랜드가 없습니다'}
                                        </td>
                                    </tr>
                                )}
                                {filtered.map((b) => (
                                    <tr key={b.id} className="hover:bg-[#F9FAFB]">
                                        <td className="px-4 py-3">
                                            <div className="flex items-center gap-3">
                                                <BrandTileSmall name={b.name} short={b.short} color={b.color} size={34} />
                                                <div>
                                                    <div className="font-semibold text-[13.5px] text-[#101828] leading-tight">
                                                        {b.name}
                                                    </div>
                                                    <div className="text-[11px] text-[#667085] mt-0.5 font-mono">{b.short}</div>
                                                </div>
                                            </div>
                                        </td>
                                        <td className="px-4 py-3">
                                            {b.domain_name ? (
                                                <span className="inline-flex items-center px-2 py-0.5 rounded-md text-[11.5px] font-semibold bg-[#F2F4F7] text-[#667085]">
                                                    {b.domain_name}
                                                </span>
                                            ) : (
                                                <span className="text-[11.5px] text-[#667085]">—</span>
                                            )}
                                        </td>
                                        <td className="px-4 py-3 text-right tabular-nums text-[13px] font-semibold text-[#101828]">
                                            {Number(b.members || 0).toLocaleString('ko-KR')}
                                            <span className="text-[11px] font-normal text-[#667085] ml-0.5">명</span>
                                        </td>
                                        <td className="px-4 py-3 text-right tabular-nums text-[13px] font-semibold text-[#101828]">
                                            {Number(b.sessions || 0).toLocaleString('ko-KR')}
                                            <span className="text-[11px] font-normal text-[#667085] ml-0.5">건</span>
                                        </td>
                                        <td className="px-4 py-3 text-center">
                                            <button
                                                onClick={() => handleToggle(b)}
                                                title={b.active ? '클릭하여 비활성화' : '클릭하여 활성화'}
                                                className="cursor-pointer"
                                            >
                                                {b.active ? (
                                                    <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11.5px] font-semibold bg-green-50 text-green-700">
                                                        <span className="w-1.5 h-1.5 rounded-full bg-green-500" /> 활성
                                                    </span>
                                                ) : (
                                                    <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11.5px] font-semibold bg-gray-100 text-gray-500">
                                                        <span className="w-1.5 h-1.5 rounded-full bg-gray-400" /> 비활성
                                                    </span>
                                                )}
                                            </button>
                                        </td>
                                        <td className="px-4 py-3 text-[12.5px] text-[#667085] tabular-nums">
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
                                                    className="inline-flex items-center gap-1 h-[28px] px-3 rounded-lg border border-[#E4E7EC] bg-white text-[12px] font-semibold text-[#101828] hover:bg-[#F2F4F7] cursor-pointer"
                                                >
                                                    <Pencil size={11} /> 편집
                                                </button>
                                                <button
                                                    onClick={() => handleDelete(b)}
                                                    className="inline-flex items-center gap-1 h-[28px] px-3 rounded-lg border border-red-200 bg-white text-[12px] font-semibold text-red-600 hover:bg-red-50 cursor-pointer"
                                                >
                                                    <Trash2 size={11} /> 삭제
                                                </button>
                                            </div>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                        <div className="flex items-center justify-between px-4 py-3 border-t border-[#E4E7EC] bg-[#F9FAFB] text-xs text-[#667085]">
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
                            : { name: '', short: '', color: '#055AAF', active: true, domain_id: null }
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
