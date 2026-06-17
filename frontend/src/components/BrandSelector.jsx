import React, { useEffect, useRef, useState } from 'react';
import { ChevronDown, Search, Check, ShieldCheck } from 'lucide-react';

function fmtNum(n) {
    return Number(n || 0).toLocaleString('ko-KR');
}

function BrandTile({ brand, size = 36 }) {
    return (
        <div
            style={{
                width: size,
                height: size,
                borderRadius: Math.round(size * 0.28),
                background: brand.color || '#055AAF',
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
            {brand.short || (brand.name ? brand.name.slice(0, 1) : '·')}
        </div>
    );
}

function BrandOption({ brand, selected, onClick }) {
    const [hovered, setHovered] = useState(false);
    return (
        <button
            type="button"
            onClick={onClick}
            onMouseEnter={() => setHovered(true)}
            onMouseLeave={() => setHovered(false)}
            style={{
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                padding: '8px 10px',
                border: 0,
                borderRadius: 10,
                background: selected ? 'var(--primary-bg)' : hovered ? 'var(--bg-subtle)' : 'transparent',
                cursor: 'pointer',
                textAlign: 'left',
                font: 'inherit',
                color: 'inherit',
                transition: 'background 150ms ease',
                width: '100%',
            }}
        >
            <BrandTile brand={brand} size={32} />
            <div style={{ flex: 1, minWidth: 0 }}>
                <div
                    style={{
                        fontSize: 13.5,
                        fontWeight: 600,
                        color: selected ? 'var(--primary)' : 'var(--text-main)',
                        letterSpacing: '-0.01em',
                        whiteSpace: 'nowrap',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                    }}
                >
                    {brand.name}
                </div>
                <div
                    style={{
                        marginTop: 1,
                        fontSize: 11.5,
                        color: 'var(--text-muted)',
                        fontVariantNumeric: 'tabular-nums',
                        letterSpacing: '0.01em',
                        display: 'flex',
                        alignItems: 'center',
                        gap: 4,
                    }}
                >
                    {fmtNum(brand.members)}명 · {fmtNum(brand.sessions)}건
                    {brand.is_own && (
                        <span
                            style={{
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: 3,
                                padding: '1px 5px',
                                fontSize: 10,
                                borderRadius: 999,
                                background: 'var(--primary-tint)',
                                color: 'var(--primary)',
                                fontWeight: 700,
                                letterSpacing: '0.02em',
                            }}
                        >
                            <ShieldCheck size={9} strokeWidth={2.5} />내 조직
                        </span>
                    )}
                </div>
            </div>
            {selected && <Check size={14} strokeWidth={2.5} style={{ color: 'var(--primary)', flexShrink: 0 }} />}
        </button>
    );
}

const BrandSelector = ({ brands, value, onChange, lockSingle = false }) => {
    const [open, setOpen] = useState(false);
    const [query, setQuery] = useState('');
    const rootRef = useRef(null);
    const selected = brands.find((b) => b.id === value) || brands[0];
    const disabled = lockSingle || brands.length <= 1;

    useEffect(() => {
        if (!open) return;
        const onDocClick = (e) => {
            if (rootRef.current && !rootRef.current.contains(e.target)) setOpen(false);
        };
        const onKey = (e) => {
            if (e.key === 'Escape') setOpen(false);
        };
        document.addEventListener('mousedown', onDocClick);
        document.addEventListener('keydown', onKey);
        return () => {
            document.removeEventListener('mousedown', onDocClick);
            document.removeEventListener('keydown', onKey);
        };
    }, [open]);

    if (!selected) return null;

    const filtered = brands.filter((b) => b.name.toLowerCase().includes(query.toLowerCase().trim()));

    return (
        <div ref={rootRef} style={{ position: 'relative' }}>
            <button
                type="button"
                onClick={() => !disabled && setOpen((o) => !o)}
                aria-expanded={open}
                aria-haspopup="listbox"
                disabled={disabled}
                style={{
                    width: '100%',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 10,
                    padding: '10px',
                    background: 'white',
                    border: `1px solid ${open ? 'var(--primary-tint)' : 'var(--border)'}`,
                    borderRadius: 12,
                    cursor: disabled ? 'default' : 'pointer',
                    textAlign: 'left',
                    font: 'inherit',
                    color: 'inherit',
                    transition: 'border-color 150ms ease, box-shadow 150ms ease',
                    boxShadow: open ? '0 0 0 3px var(--primary-bg)' : '0 1px 2px rgba(0,0,0,0.04)',
                }}
            >
                <BrandTile brand={selected} size={36} />
                <div style={{ flex: 1, minWidth: 0 }}>
                    <div
                        style={{
                            fontSize: 10.5,
                            fontWeight: 600,
                            letterSpacing: '0.08em',
                            textTransform: 'uppercase',
                            color: 'var(--text-muted)',
                        }}
                    >
                        {selected.domain_name ? `${selected.domain_name} · 브랜드` : '관리 중인 브랜드'}
                    </div>
                    <div
                        style={{
                            marginTop: 2,
                            fontSize: 13.5,
                            fontWeight: 700,
                            color: 'var(--text-main)',
                            whiteSpace: 'nowrap',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            letterSpacing: '-0.01em',
                        }}
                    >
                        {selected.name}
                    </div>
                </div>
                {!disabled && (
                    <ChevronDown
                        size={16}
                        style={{
                            color: 'var(--text-muted)',
                            transition: 'transform 150ms ease',
                            transform: open ? 'rotate(180deg)' : 'rotate(0deg)',
                            flexShrink: 0,
                        }}
                    />
                )}
            </button>

            {open && (
                <div
                    role="listbox"
                    style={{
                        position: 'absolute',
                        top: 'calc(100% + 6px)',
                        left: 0,
                        right: 0,
                        background: 'white',
                        border: '1px solid var(--border)',
                        borderRadius: 14,
                        boxShadow: '0 12px 32px rgba(15,23,42,0.12), 0 2px 6px rgba(15,23,42,0.06)',
                        padding: 6,
                        zIndex: 60,
                    }}
                >
                    {brands.length > 4 && (
                        <div
                            style={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: 6,
                                padding: '6px 8px',
                                borderBottom: '1px solid var(--border)',
                                marginBottom: 4,
                            }}
                        >
                            <Search size={13} style={{ color: 'var(--text-dim)' }} />
                            <input
                                autoFocus
                                value={query}
                                onChange={(e) => setQuery(e.target.value)}
                                placeholder="브랜드 검색"
                                style={{
                                    flex: 1,
                                    border: 0,
                                    outline: 0,
                                    background: 'transparent',
                                    font: 'inherit',
                                    fontSize: 12.5,
                                    color: 'var(--text-main)',
                                    padding: '4px 0',
                                }}
                            />
                        </div>
                    )}

                    <div
                        style={{
                            fontSize: 10,
                            fontWeight: 600,
                            letterSpacing: '0.08em',
                            textTransform: 'uppercase',
                            color: 'var(--text-muted)',
                            padding: '6px 10px 4px',
                        }}
                    >
                        전체 {brands.length}개 브랜드
                    </div>

                    <div
                        style={{
                            maxHeight: 280,
                            overflowY: 'auto',
                            display: 'flex',
                            flexDirection: 'column',
                            gap: 2,
                        }}
                    >
                        {filtered.length === 0 ? (
                            <div
                                style={{
                                    padding: '20px 10px',
                                    textAlign: 'center',
                                    color: 'var(--text-muted)',
                                    fontSize: 12,
                                }}
                            >
                                일치하는 브랜드가 없습니다
                            </div>
                        ) : (
                            (() => {
                                const groups = new Map();
                                for (const b of filtered) {
                                    const key = b.domain_name || '미분류';
                                    if (!groups.has(key)) groups.set(key, []);
                                    groups.get(key).push(b);
                                }
                                const nodes = [];
                                groups.forEach((groupBrands, domainLabel) => {
                                    if (groups.size > 1) {
                                        nodes.push(
                                            <div
                                                key={`hdr-${domainLabel}`}
                                                style={{
                                                    fontSize: 10,
                                                    fontWeight: 700,
                                                    letterSpacing: '0.07em',
                                                    textTransform: 'uppercase',
                                                    color: 'var(--text-muted)',
                                                    padding: '6px 10px 2px',
                                                    marginTop: 2,
                                                }}
                                            >
                                                {domainLabel}
                                            </div>
                                        );
                                    }
                                    for (const b of groupBrands) {
                                        nodes.push(
                                            <BrandOption
                                                key={b.id}
                                                brand={b}
                                                selected={b.id === selected.id}
                                                onClick={() => {
                                                    onChange(b.id);
                                                    setOpen(false);
                                                }}
                                            />
                                        );
                                    }
                                });
                                return nodes;
                            })()
                        )}
                    </div>
                </div>
            )}
        </div>
    );
};

export default BrandSelector;
