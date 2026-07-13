// 평가 관리 — 공용 UI 컴포넌트 (디자인 프로토타입 etc/components.jsx 포팅)
// 원본은 CDN Lucide(전역 Icon)를 썼으나, 본 앱은 lucide-react 를 쓰므로
// kebab-case 아이콘명을 PascalCase 컴포넌트로 매핑하는 Icon 래퍼로 대체했다.
import React, { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { createRoot } from 'react-dom/client';
import * as Lucide from 'lucide-react';

// 별도 브라우저 창(window.open)을 열고 현재 문서 스타일(Tailwind/전역 CSS)을 복제한 뒤
// 그 창에 새 React 루트를 마운트한다 — 02 페르소나 추가와 동일 방식.
// (Modal 의 createPortal 은 메인 문서로 가버리므로 컴포넌트는 windowed 모드로 포털/스크림 없이 렌더.)
export function openInWindow({ name, title, width, height, render }) {
    if (typeof window === 'undefined') return;
    const W = width, H = height;
    const left = Math.round(window.screenX + Math.max(0, (window.outerWidth - W) / 2));
    const top = Math.round(window.screenY + Math.max(0, (window.outerHeight - H) / 2));
    const win = window.open('', name, `width=${W},height=${H},left=${left},top=${top},resizable=yes,scrollbars=yes`);
    if (!win) {
        alert('팝업이 차단되었습니다. 브라우저의 팝업 차단을 해제한 뒤 다시 시도해주세요.');
        return;
    }
    win.document.write('<!DOCTYPE html><html lang="ko"><head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" /></head><body></body></html>');
    win.document.close();
    win.document.title = title;
    document.querySelectorAll('style').forEach((node) => {
        win.document.head.appendChild(node.cloneNode(true));
    });
    document.querySelectorAll('link[rel="stylesheet"]').forEach((node) => {
        const link = win.document.createElement('link');
        link.rel = 'stylesheet';
        link.href = node.href; // 절대 URL 로 복사 (상대경로 깨짐 방지)
        win.document.head.appendChild(link);
    });
    win.document.body.className = document.body.className;
    win.document.body.style.margin = '0';

    const mount = win.document.createElement('div');
    win.document.body.appendChild(mount);
    const root = createRoot(mount);

    let closed = false;
    const close = () => {
        if (closed) return;
        closed = true;
        root.unmount();
        if (!win.closed) win.close();
    };
    win.addEventListener('beforeunload', () => {
        if (!closed) { closed = true; root.unmount(); }
    });

    root.render(render(close));
    win.focus();
}

// 콜 QA 분석 상세(#/detail/{qaId})로 이동한다.
// ICS 임베드 세션 마커는 sessionStorage(탭 전용)라, 새 탭/새 창으로 열면 마커가 없어
// _staleIcsDirect 로 판정돼 로그인 화면이 뜬다. → 이미 인증된 기존 창에서 in-place 이동한다.
//   · 배정 모달 등 팝업에서 호출 시: opener(메인 앱)를 상세로 이동 + 포커스.
//   · 그 외(메인 창): 현재 창에서 해시 이동(기존 상세 열기와 동일).
export function openCallDetail(qaId) {
    if (typeof window === 'undefined' || qaId == null || qaId === '') return;
    const hash = `#/detail/${encodeURIComponent(qaId)}`;
    try {
        if (window.opener && !window.opener.closed) {
            window.opener.location.hash = hash;
            window.opener.focus();
            return;
        }
    } catch {
        /* cross-origin 은 우리 구조상 없음 — 현재 창 폴백 */
    }
    window.location.hash = hash;
}

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
    const grad = value >= 90 ? ['var(--success)', 'var(--cat-delivery)'] : value >= 80 ? ['var(--cat-product)', '#f5c022'] : ['var(--cat-payment)', '#e85a5a'];
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
export function Spark({ data, color = 'var(--primary)', height = 56, fill = true }) {
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
// ColumnFilter — 테이블 헤더 클릭 → 현재 데이터에 존재하는 값 목록(엑셀식 자동필터).
//   options: [{ value, label }]  (해당 컬럼에 1건 이상 존재하는 값만 호출부가 전달)
//   excluded: Set  (체크 해제=숨길 값. 비어있으면 전체 표시)
//   onChange: (nextExcludedSet) => void
// ─────────────────────────────────────────────────────
const EMPTY_SET = new Set();
export function ColumnFilter({ title, options = [], excluded, onChange, align = 'left' }) {
    const [open, setOpen] = useState(false);
    const ref = useRef(null);
    useEffect(() => {
        if (!open) return undefined;
        const onDoc = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
        document.addEventListener('mousedown', onDoc);
        return () => document.removeEventListener('mousedown', onDoc);
    }, [open]);
    const ex = excluded || EMPTY_SET;
    const active = ex.size > 0;
    const toggle = (v) => {
        const next = new Set(ex);
        if (next.has(v)) next.delete(v); else next.add(v);
        onChange(next);
    };
    return (
        <div ref={ref} style={{ position: 'relative', display: 'inline-flex', alignItems: 'center', gap: 4, minWidth: 0 }}>
            <span
                onClick={() => setOpen((o) => !o)}
                style={{ cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 3, userSelect: 'none' }}
                title="클릭해 값 선택"
            >
                {title}
                <Icon name="list-filter" size={12} style={{ color: active ? 'var(--primary)' : 'var(--ink-300)' }} />
            </span>
            {open && (
                <div
                    onClick={(e) => e.stopPropagation()}
                    style={{
                        position: 'absolute', top: 'calc(100% + 6px)', [align]: 0, zIndex: 60,
                        background: 'white', border: '1px solid var(--border)', borderRadius: 10,
                        boxShadow: '0 8px 24px rgba(16,24,40,0.14)', padding: 8, minWidth: 168, maxHeight: 280, overflowY: 'auto',
                    }}
                >
                    <div style={{ display: 'flex', gap: 6, padding: '2px 4px 8px', borderBottom: '1px dashed var(--border)', marginBottom: 6 }}>
                        <button className="btn-mini" style={{ height: 24, flex: 1 }} onClick={() => onChange(new Set())}>전체 선택</button>
                        <button className="btn-mini" style={{ height: 24, flex: 1 }} onClick={() => onChange(new Set(options.map((o) => o.value)))}>전체 해제</button>
                    </div>
                    {options.length === 0 ? (
                        <div className="muted-text" style={{ fontSize: 12, padding: '4px 6px' }}>값 없음</div>
                    ) : options.map((o) => (
                        <label key={String(o.value)} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 6px', fontSize: 12.5, fontWeight: 500, color: 'var(--ink-700)', cursor: 'pointer', whiteSpace: 'nowrap', borderRadius: 6 }}>
                            <input type="checkbox" checked={!ex.has(o.value)} onChange={() => toggle(o.value)} style={{ cursor: 'pointer' }} />
                            {o.label}
                        </label>
                    ))}
                </div>
            )}
        </div>
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
export function Modal({ title, onClose, children, foot, width, windowed = false }) {
    useEffect(() => {
        const onKey = (e) => {
            if (e.key === 'Escape') onClose?.();
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [onClose]);
    if (typeof document === 'undefined') return null;
    // 별도 브라우저 창(window.open)에 마운트되는 경우 — createPortal 은 메인 문서로 가버리므로
    // 포털/스크림 없이 인-트리로 창 전체를 채운다.
    if (windowed) {
        // 별도 창이라 브라우저 자체 닫기(X)가 이미 있어 헤더 X 는 생략(중복 방지).
        // max-height(88vh) 를 해제하고 창 전체 높이를 채워 푸터가 바닥에 붙게 한다.
        return (
            <div className="tg-eval" style={{ minHeight: '100vh', background: '#fff' }}>
                <div className="modal" style={{ width: '100%', maxWidth: 'none', height: '100vh', maxHeight: '100vh', borderRadius: 0, boxShadow: 'none', display: 'flex', flexDirection: 'column' }}>
                    <div className="modal-head">
                        <h2>{title}</h2>
                    </div>
                    <div className="modal-body" style={{ flex: 1, minHeight: 0, overflow: 'auto' }}>{children}</div>
                    {foot && <div className="modal-foot">{foot}</div>}
                </div>
            </div>
        );
    }
    // document.body 포털 — 상위 레이아웃에 갇히지 않게 전체 화면을 덮는다.
    // 스타일이 .tg-eval 하위로 스코프돼 있어 래퍼를 .tg-eval 로 감싼다(스타일/CSS변수 유지).
    return createPortal(
        <div className="tg-eval">
            <div className="modal-scrim" onClick={onClose}>
                <div
                    className="modal"
                    onClick={(e) => e.stopPropagation()}
                    style={width ? { width: `min(${width}px, calc(100vw - 32px))` } : undefined}
                >
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
        </div>,
        document.body
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
// 실제 오늘. 과거엔 mock 고정일(2026-06-16)이 하드코딩되어 그 이후 날짜(당일 포함)가
// 캘린더에서 disabled + 월 이동 불가 + 프리셋 오계산되는 버그가 있었음 — 고정일 사용 금지.
const APP_TODAY = new Date();

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

// align: 팝업 정렬('right' 기본). 화면 왼쪽에 놓인 피커는 'left' — 오른쪽 앵커가 창 밖으로 나가 잘리는 문제 방지.
// fixedPop: overflow 클리핑 컨테이너(모달·아코디언 등) 안에서 사용할 때 true — 팝업을 뷰포트 기준
//   position:fixed 로 띄워 어떤 조상에도 잘리지 않게 한다. 열 때 트리거 rect 로 위치 계산(+화면 경계 클램프).
export function PeriodPicker({ value, onChange, align = 'right', fixedPop = false }) {
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

    // fixedPop — 열 때 트리거 위치로 뷰포트 좌표 계산. 아래 공간 부족 시 위로 펼침, 좌우는 화면 안으로 클램프.
    const [popPos, setPopPos] = useState(null);
    const POP_W = 430, POP_H = 350;
    const toggleOpen = () => {
        if (!open && fixedPop && ref.current) {
            const r = ref.current.getBoundingClientRect();
            const top = r.bottom + 8 + POP_H > window.innerHeight ? Math.max(8, r.top - 8 - POP_H) : r.bottom + 8;
            const left = Math.max(8, Math.min(align === 'left' ? r.left : r.right - POP_W, window.innerWidth - 8 - POP_W));
            setPopPos({ top, left });
        }
        setOpen((o) => !o);
    };
    const popStyle = fixedPop && popPos
        ? { position: 'fixed', top: popPos.top, left: popPos.left, right: 'auto', zIndex: 200 }
        : align === 'left' ? { left: 0, right: 'auto' } : undefined;

    return (
        <div className="period-picker" ref={ref}>
            <button className={`period-trigger ${open ? 'open' : ''}`} onClick={toggleOpen}>
                <Icon name="calendar" size={14} />
                <span>{label}</span>
                <Icon name="chevron-down" size={13} style={{ color: 'var(--ink-400)' }} />
            </button>

            {open && (
                <div className="period-pop" style={popStyle}>
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
