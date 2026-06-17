// 평가 관리 — 공용 UI 컴포넌트 (디자인 프로토타입 etc/components.jsx 포팅)
// 원본은 CDN Lucide(전역 Icon)를 썼으나, 본 앱은 lucide-react 를 쓰므로
// kebab-case 아이콘명을 PascalCase 컴포넌트로 매핑하는 Icon 래퍼로 대체했다.
import React, { useState, useEffect, useRef } from 'react';
import * as Lucide from 'lucide-react';

// ─────────────────────────────────────────────────────
// Icon — 'chevron-right' → <ChevronRight/> (lucide-react)
// ─────────────────────────────────────────────────────
const toPascal = (name) =>
    String(name || '')
        .split('-')
        .map((s) => s.charAt(0).toUpperCase() + s.slice(1))
        .join('');

// lucide-react 에서 deprecated 처리되어 버전에 따라 빠질 수 있는 별칭 → 정식 컴포넌트명 보정
const ICON_ALIASES = {
    CheckCircle: 'CircleCheck',
    AlertTriangle: 'TriangleAlert',
    CircleHelp: 'CircleHelp',
    BarChart2: 'ChartNoAxesColumn',
};

export function Icon({ name, size = 16, style, ...rest }) {
    const pascal = toPascal(name);
    const Cmp = Lucide[pascal] || Lucide[ICON_ALIASES[pascal]] || Lucide.Circle;
    return (
        <Cmp
            size={size}
            strokeWidth={1.8}
            style={{ flexShrink: 0, display: 'inline-block', verticalAlign: 'middle', ...style }}
            {...rest}
        />
    );
}

// ─────────────────────────────────────────────────────
// Score gauge (circular)
// ─────────────────────────────────────────────────────
export function Gauge({ value, max = 100, label = '종합 점수', size = 140 }) {
    const r = (size - 18) / 2;
    const c = 2 * Math.PI * r;
    const pct = Math.max(0, Math.min(1, value / max));
    const offset = c * (1 - pct);
    const grad = value >= 90 ? ['#34a86b', '#4dbd75'] : value >= 80 ? ['#e8a045', '#f5c022'] : ['#d04443', '#e85a5a'];
    const gid = `g${String(label).replace(/[^a-zA-Z0-9]/g, '')}`;
    return (
        <div className="gauge" style={{ width: size, height: size }}>
            <svg width={size} height={size}>
                <defs>
                    <linearGradient id={gid} x1="0" y1="0" x2="1" y2="1">
                        <stop offset="0%" stopColor={grad[0]} />
                        <stop offset="100%" stopColor={grad[1]} />
                    </linearGradient>
                </defs>
                <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--muted)" strokeWidth="10" />
                <circle
                    cx={size / 2}
                    cy={size / 2}
                    r={r}
                    fill="none"
                    stroke={`url(#${gid})`}
                    strokeWidth="10"
                    strokeLinecap="round"
                    strokeDasharray={c}
                    strokeDashoffset={offset}
                    style={{ transition: 'stroke-dashoffset 800ms ease' }}
                />
            </svg>
            <div className="gauge-num">
                <span className="big">{value}</span>
                <span className="small">{label}</span>
            </div>
        </div>
    );
}

// ─────────────────────────────────────────────────────
// Sparkline
// ─────────────────────────────────────────────────────
export function Spark({ data, color = '#2563eb', height = 56, fill = true }) {
    const w = 200;
    const h = height;
    const max = Math.max(...data);
    const min = Math.min(...data);
    const range = max - min || 1;
    const step = w / (data.length - 1);
    const pts = data.map((v, i) => `${i * step},${h - 8 - ((v - min) / range) * (h - 16)}`);
    const path = `M ${pts.join(' L ')}`;
    const area = `${path} L ${w},${h} L 0,${h} Z`;
    return (
        <svg className="spark" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none">
            <defs>
                <linearGradient id="sparkFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={color} stopOpacity="0.2" />
                    <stop offset="100%" stopColor={color} stopOpacity="0" />
                </linearGradient>
            </defs>
            {fill && <path d={area} fill="url(#sparkFill)" />}
            <path d={path} fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
    );
}

// ─────────────────────────────────────────────────────
// Score breakdown bars
// ─────────────────────────────────────────────────────
export function ScoreBreakdown({ scores, dimensions }) {
    return (
        <div>
            {dimensions.map((d) => {
                const s = scores[d.key] ?? 0;
                const cls = s >= 90 ? '' : s >= 80 ? 'mid' : 'low';
                return (
                    <div className="sb-row" key={d.key}>
                        <div className="sb-name">{d.label}</div>
                        <div className={`sb-bar ${cls}`}>
                            <div style={{ width: `${s}%` }}></div>
                        </div>
                        <div className="sb-val">{s}</div>
                    </div>
                );
            })}
        </div>
    );
}

// ─────────────────────────────────────────────────────
// Status pill
// ─────────────────────────────────────────────────────
export function StatusPill({ status }) {
    const map = {
        running: { cls: 'blue', dot: true, label: '평가중' },
        queued: { cls: 'gray', dot: true, label: '대기' },
        done: { cls: 'green', dot: true, label: '완료' },
        failed: { cls: 'red', dot: true, label: '실패' },
        reviewed: { cls: 'blue', dot: true, label: '강사 검토' },
        completed: { cls: 'green', dot: true, label: '자동 완료' },
        pending: { cls: 'yellow', dot: true, label: '검토 대기' },
        active: { cls: 'green', dot: true, label: '활성' },
        beta: { cls: 'yellow', dot: true, label: '베타' },
    };
    const m = map[status] || { cls: 'gray', dot: true, label: status };
    return (
        <span className={`pill ${m.cls}`}>
            {m.dot && <span className="dot"></span>}
            {m.label}
        </span>
    );
}

// ─────────────────────────────────────────────────────
// Channel chip (인바운드 / 아웃바운드) — 프로토타입에서 누락된 컴포넌트 보충
// ─────────────────────────────────────────────────────
export function ChannelChip({ channel }) {
    const inbound = channel === 'inbound';
    return (
        <span
            className="pill"
            style={
                inbound
                    ? { background: 'var(--primary-soft)', color: 'var(--primary)' }
                    : { background: '#fdf2e3', color: '#c67d12' }
            }
        >
            <Icon name={inbound ? 'phone-incoming' : 'phone-outgoing'} size={10} />
            {inbound ? '인바운드' : '아웃바운드'}
        </span>
    );
}

// ─────────────────────────────────────────────────────
// Avatar
// ─────────────────────────────────────────────────────
export function Avatar({ id, name, size = 'sm' }) {
    const initials = (name || '?').slice(0, 1);
    return <div className={`avatar-${size} ${id}`}>{initials}</div>;
}

// ─────────────────────────────────────────────────────
// Heatmap
// ─────────────────────────────────────────────────────
export function Heatmap({ data }) {
    return (
        <div className="heat">
            {data.map((v, i) => (
                <div key={i} className={`heat-cell lv${v}`} title={v > 0 ? `${v}건` : '없음'}></div>
            ))}
        </div>
    );
}

// ─────────────────────────────────────────────────────
// Page header
// ─────────────────────────────────────────────────────
export function PageHead({ eyebrow, title, sub, children }) {
    return (
        <div className="page-head">
            <div>
                {eyebrow && (
                    <span className="eyebrow" style={{ display: 'block', marginBottom: 6 }}>
                        {eyebrow}
                    </span>
                )}
                <h1>{title}</h1>
                {sub && <p>{sub}</p>}
            </div>
            {children && <div className="actions">{children}</div>}
        </div>
    );
}

// ─────────────────────────────────────────────────────
// Tabs / Seg
// ─────────────────────────────────────────────────────
export function Tabs({ items, value, onChange }) {
    return (
        <div className="tabs">
            {items.map((it) => (
                <button key={it.key} className={`tab ${value === it.key ? 'active' : ''}`} onClick={() => onChange(it.key)}>
                    {it.label}
                </button>
            ))}
        </div>
    );
}

export function Seg({ items, value, onChange }) {
    return (
        <div className="seg">
            {items.map((it) => (
                <button key={it.key} className={`seg-btn ${value === it.key ? 'active' : ''}`} onClick={() => onChange(it.key)}>
                    {it.label}
                </button>
            ))}
        </div>
    );
}

// ─────────────────────────────────────────────────────
// Modal
// ─────────────────────────────────────────────────────
export function Modal({ title, onClose, children, foot }) {
    useEffect(() => {
        const onKey = (e) => {
            if (e.key === 'Escape') onClose?.();
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [onClose]);
    return (
        <div className="modal-scrim" onClick={onClose}>
            <div className="modal" onClick={(e) => e.stopPropagation()}>
                <div className="modal-head">
                    <h2>{title}</h2>
                    <button className="icon-btn" onClick={onClose}>
                        <Icon name="x" />
                    </button>
                </div>
                <div className="modal-body">{children}</div>
                {foot && <div className="modal-foot">{foot}</div>}
            </div>
        </div>
    );
}

// ─────────────────────────────────────────────────────
// Count-up + Donut (회복률/금칙어 등 원형 진행률)
// ─────────────────────────────────────────────────────
export function useCountUp(target, duration = 850) {
    const [val, setVal] = useState(0);
    const fromRef = useRef(0);
    const rafRef = useRef(null);
    useEffect(() => {
        const from = fromRef.current;
        const start = performance.now();
        cancelAnimationFrame(rafRef.current);
        const tick = (now) => {
            const t = Math.min(1, (now - start) / duration);
            const eased = 1 - Math.pow(1 - t, 3);
            setVal(from + (target - from) * eased);
            if (t < 1) rafRef.current = requestAnimationFrame(tick);
            else fromRef.current = target;
        };
        rafRef.current = requestAnimationFrame(tick);
        return () => cancelAnimationFrame(rafRef.current);
    }, [target, duration]);
    return val;
}

export function Donut({ value, size = 96, stroke = 9, color = 'var(--primary)', track = 'var(--primary-soft-flat)', children }) {
    const v = useCountUp(value);
    const r = (size - stroke) / 2;
    const c = 2 * Math.PI * r;
    return (
        <div style={{ position: 'relative', width: size, height: size, flexShrink: 0 }}>
            <svg width={size} height={size} style={{ transform: 'rotate(-90deg)', display: 'block' }}>
                <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={track} strokeWidth={stroke} />
                <circle
                    cx={size / 2}
                    cy={size / 2}
                    r={r}
                    fill="none"
                    stroke={color}
                    strokeWidth={stroke}
                    strokeLinecap="round"
                    strokeDasharray={c}
                    strokeDashoffset={c * (1 - v / 100)}
                />
            </svg>
            <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', textAlign: 'center' }}>
                {children}
            </div>
        </div>
    );
}

// ─────────────────────────────────────────────────────
// PeriodPicker — 통합 기간 선택기
// ─────────────────────────────────────────────────────
const APP_TODAY = new Date(2026, 5, 16); // 2026-06-16 (mock "today")

const PERIOD_PRESETS = [
    { key: 'today', label: '오늘' },
    { key: '7d', label: '최근 7일' },
    { key: '30d', label: '최근 30일' },
    { key: 'month', label: '이번 달' },
    { key: 'all', label: '전체' },
];

const startOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const addDays = (d, n) => {
    const r = new Date(d);
    r.setDate(r.getDate() + n);
    return r;
};
const sameDay = (a, b) =>
    a && b && a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
const fmtDate = (d) => `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')}`;
const fmtShort = (d) => `${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')}`;

function resolvePreset(key) {
    const today = startOfDay(APP_TODAY);
    switch (key) {
        case 'today':
            return { start: today, end: today };
        case '7d':
            return { start: addDays(today, -6), end: today };
        case '30d':
            return { start: addDays(today, -29), end: today };
        case 'month':
            return { start: new Date(today.getFullYear(), today.getMonth(), 1), end: today };
        case 'all':
            return { start: null, end: null };
        default:
            return { start: today, end: today };
    }
}

export function defaultPeriod(preset = '7d') {
    const r = resolvePreset(preset);
    return { preset, start: r.start, end: r.end };
}

export function PeriodPicker({ value, onChange }) {
    const v = value || defaultPeriod('7d');
    const [open, setOpen] = useState(false);
    const [viewMonth, setViewMonth] = useState(() => startOfDay(v.end || APP_TODAY));
    const [draft, setDraft] = useState({ start: v.start, end: v.end });
    const ref = useRef(null);

    useEffect(() => {
        if (!open) return;
        const onDoc = (e) => {
            if (ref.current && !ref.current.contains(e.target)) setOpen(false);
        };
        document.addEventListener('mousedown', onDoc);
        return () => document.removeEventListener('mousedown', onDoc);
    }, [open]);

    useEffect(() => {
        if (open) {
            setDraft({ start: v.start, end: v.end });
            setViewMonth(startOfDay(v.end || APP_TODAY));
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [open]);

    const label = (() => {
        if (v.preset && v.preset !== 'custom') return PERIOD_PRESETS.find((p) => p.key === v.preset)?.label || '기간';
        if (v.start && v.end) return sameDay(v.start, v.end) ? fmtDate(v.start) : `${fmtDate(v.start)} – ${fmtShort(v.end)}`;
        return '기간 선택';
    })();

    const pickPreset = (key) => {
        const r = resolvePreset(key);
        onChange?.({ preset: key, start: r.start, end: r.end });
        setOpen(false);
    };

    const onDayClick = (day) => {
        if (!draft.start || (draft.start && draft.end)) {
            setDraft({ start: day, end: null });
        } else {
            let s = draft.start;
            let e = day;
            if (e < s) [s, e] = [e, s];
            setDraft({ start: s, end: e });
        }
    };

    const applyCustom = () => {
        if (draft.start) {
            const end = draft.end || draft.start;
            onChange?.({ preset: 'custom', start: draft.start, end });
            setOpen(false);
        }
    };

    const year = viewMonth.getFullYear();
    const month = viewMonth.getMonth();
    const firstDow = new Date(year, month, 1).getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const cells = [];
    for (let i = 0; i < firstDow; i++) cells.push(null);
    for (let d = 1; d <= daysInMonth; d++) cells.push(new Date(year, month, d));

    const inRange = (d) => draft.start && draft.end && d > draft.start && d < draft.end;
    const isEnd = (d) => sameDay(d, draft.start) || sameDay(d, draft.end);
    const future = (d) => d > startOfDay(APP_TODAY);

    return (
        <div className="period-picker" ref={ref}>
            <button className={`period-trigger ${open ? 'open' : ''}`} onClick={() => setOpen((o) => !o)}>
                <Icon name="calendar" size={14} />
                <span>{label}</span>
                <Icon name="chevron-down" size={13} style={{ color: 'var(--ink-400)' }} />
            </button>

            {open && (
                <div className="period-pop">
                    <div className="period-presets">
                        {PERIOD_PRESETS.map((p) => (
                            <button
                                key={p.key}
                                className={`period-preset ${v.preset === p.key ? 'active' : ''}`}
                                onClick={() => pickPreset(p.key)}
                            >
                                {p.label}
                            </button>
                        ))}
                    </div>

                    <div className="period-cal">
                        <div className="period-cal-head">
                            <button className="period-nav" onClick={() => setViewMonth(new Date(year, month - 1, 1))}>
                                <Icon name="chevron-left" size={15} />
                            </button>
                            <span className="period-cal-title">
                                {year}년 {month + 1}월
                            </span>
                            <button
                                className="period-nav"
                                onClick={() => setViewMonth(new Date(year, month + 1, 1))}
                                disabled={year === APP_TODAY.getFullYear() && month >= APP_TODAY.getMonth()}
                            >
                                <Icon name="chevron-right" size={15} />
                            </button>
                        </div>
                        <div className="period-dow">
                            {['일', '월', '화', '수', '목', '금', '토'].map((d) => (
                                <span key={d}>{d}</span>
                            ))}
                        </div>
                        <div className="period-grid">
                            {cells.map((d, i) => {
                                if (!d) return <span key={i} className="period-day empty"></span>;
                                const cls = ['period-day'];
                                if (future(d)) cls.push('disabled');
                                if (inRange(d)) cls.push('in-range');
                                if (isEnd(d)) cls.push('end');
                                if (sameDay(d, APP_TODAY)) cls.push('today');
                                return (
                                    <button key={i} className={cls.join(' ')} disabled={future(d)} onClick={() => onDayClick(d)}>
                                        {d.getDate()}
                                    </button>
                                );
                            })}
                        </div>
                        <div className="period-foot">
                            <span className="period-foot-range">
                                {draft.start
                                    ? draft.end && !sameDay(draft.start, draft.end)
                                        ? `${fmtDate(draft.start)} – ${fmtShort(draft.end)}`
                                        : fmtDate(draft.start)
                                    : '날짜를 선택하세요'}
                            </span>
                            <button className="btn-mini primary" disabled={!draft.start} onClick={applyCustom}>
                                적용
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
