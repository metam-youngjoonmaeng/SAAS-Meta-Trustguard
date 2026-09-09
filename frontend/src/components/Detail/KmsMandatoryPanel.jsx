import React, { useState } from 'react';
import { MessageSquare, ListChecks, ShieldCheck, ShieldAlert, Target, Database } from 'lucide-react';

/**
 * KMS 필수사항 체크 (QA-PAIR) — 평가 결과 [KMS] 탭 본문.
 *
 * V3 프론트 `components/results/KmsMandatoryCard.tsx` 와 **같은 데이터·같은 판정 표기**를
 * MTG 스택(React/JSX + Tailwind 변수)으로 옮긴 것. 검수 컨트롤·이커머스 바인딩처럼 MTG 에
 * 없는 기능은 옮기지 않았다(그 부분이 원본 2,800행의 대부분이다).
 *
 * 데이터 소스 = 파이프라인 응답 최상위 `kiwoom_coverage`
 *   ├ detected[]  {intent, branch, confidence, self_confidence, reason, evidence[],
 *   │              adversarial{refuted, refuted_count, n_lenses, better_intent, votes[]}}
 *   └ mandatory
 *       ├ coverage_summary {fulfilled, total, rate}
 *       └ evaluations_by_intent { <intent>: {branch, total, fulfilled, coverage_rate,
 *                                            reason, checks[]} }
 *            checks[] {statement, status, best_turn_id, quote, rationale,
 *                      binding, axis, trigger_turn_id}
 *
 * status 표기는 V3 `ecomStatusVisual` 과 동일한 색·글리프를 쓴다 — 두 화면에서 같은 콜이
 * 다르게 보이면 안 된다.
 */

const STATUS_VISUAL = {
    O: { bg: '#dcfce7', fg: '#166534', border: '#86efac', glyph: '✓' },
    X: { bg: '#fee2e2', fg: '#991b1b', border: '#fca5a5', glyph: '✗' },
    W: { bg: '#fef3c7', fg: '#92400e', border: '#fde68a', glyph: '!' },
};
const STATUS_FALLBACK = { bg: '#f3f4f6', fg: '#6b7280', border: '#d1d5db', glyph: '—' };
const statusVisual = (s) => STATUS_VISUAL[s] || STATUS_FALLBACK;

/** 0.87 → "87%" · 값 없으면 "-" */
const pct = (rate) => (Number.isFinite(Number(rate)) ? `${Math.round(Number(rate) * 100)}%` : '-');

/** T#N 칩 — 클릭 시 전사 해당 턴으로. */
const TurnChip = ({ turn, onTurn, tone = 'default' }) => {
    if (turn === null || turn === undefined) return null;
    const isTrigger = tone === 'trigger';
    return (
        <button
            type="button"
            onClick={() => onTurn?.(Number(turn))}
            title="전사에서 이 발화 보기"
            className="shrink-0 text-[10px] font-bold rounded px-1.5 py-px tabular-nums transition-colors"
            style={{
                background: isTrigger ? '#EEF2FF' : 'var(--muted)',
                color: isTrigger ? '#3730A3' : 'var(--ink-700)',
                border: `1px solid ${isTrigger ? '#C7D2FE' : 'transparent'}`,
            }}
        >
            T#{turn}
        </button>
    );
};

/** 적대검증 요약 — 반박 여부 + 렌즈 통과 수. */
const AdversarialLine = ({ adv }) => {
    const [open, setOpen] = useState(false);
    if (!adv || typeof adv !== 'object') return null;
    const n = Number(adv.n_lenses) || 0;
    const refutedCount = Number(adv.refuted_count) || 0;
    const passed = Math.max(0, n - refutedCount);
    const refuted = adv.refuted === true;
    const votes = Array.isArray(adv.votes) ? adv.votes : [];

    return (
        <div className="flex flex-col gap-1">
            <div className="flex items-center gap-1.5 text-[11px]">
                {refuted ? (
                    <ShieldAlert size={12} className="text-[var(--destructive)] shrink-0" />
                ) : (
                    <ShieldCheck size={12} className="text-[var(--success)] shrink-0" />
                )}
                <span className="text-[var(--ink-500)]">적대검증</span>
                <span className="font-semibold text-[var(--ink-900)]">
                    {refuted ? '반박됨' : '통과'} ({passed}/{n} 렌즈 통과)
                </span>
                {refuted && adv.better_intent && (
                    <span className="text-[10px] text-[var(--ink-500)]">
                        대안 업무 · {adv.better_intent}
                    </span>
                )}
                {votes.length > 0 && (
                    <button
                        type="button"
                        onClick={() => setOpen((v) => !v)}
                        className="ml-auto text-[10px] text-[var(--ink-400)] hover:text-[var(--ink-700)]"
                    >
                        렌즈별 상세 {open ? '▴' : '▸'}
                    </button>
                )}
            </div>
            {open &&
                votes.map((v, i) => (
                    <div
                        key={i}
                        className="ml-4 rounded-[6px] border border-[var(--muted)] bg-[var(--background-soft)]/60 px-2.5 py-1.5"
                    >
                        <div className="flex items-center gap-1.5 text-[10.5px]">
                            <span className="font-bold text-[var(--ink-700)]">{v.lens}</span>
                            <span style={{ color: v.refuted ? 'var(--destructive)' : 'var(--success)' }}>
                                {v.refuted ? '반박' : '유지'}
                            </span>
                            {v.better_intent && (
                                <span className="text-[var(--ink-500)]">→ {v.better_intent}</span>
                            )}
                        </div>
                        {v.rationale && (
                            <p className="mt-1 text-[10.5px] text-[var(--ink-700)] leading-relaxed">
                                {v.rationale}
                            </p>
                        )}
                    </div>
                ))}
        </div>
    );
};

/** 필수 항목 1건 타일. */
const CheckTile = ({ check, onTurn }) => {
    const v = statusVisual(check.status);
    return (
        <div
            className="rounded-[8px] px-3 py-2 flex flex-col gap-1"
            style={{ background: v.bg, border: `1px solid ${v.border}` }}
        >
            <div className="flex items-center gap-1.5">
                <span className="text-[12px] font-bold shrink-0" style={{ color: v.fg }}>
                    {v.glyph}
                </span>
                <span className="text-[11.5px] font-semibold text-[var(--ink-900)] leading-snug">
                    {check.statement || check.label || '(항목명 없음)'}
                </span>
                {check.axis && (
                    <span className="text-[9.5px] font-bold text-[var(--ink-500)] bg-white/60 rounded px-1 py-px shrink-0">
                        축 {check.axis}
                    </span>
                )}
                {/* 귀속 항목 — 파이프라인 내부번호(#5005)는 사용자에게 의미가 없다. 적재 시 붙여 둔
                    `binding_label`(항목명) · `binding_order_no`(화면 번호)를 우선 쓰고, 옛 payload
                    (주석 이전에 평가된 콜)만 원번호로 폴백한다. */}
                {check.binding_label || check.binding_order_no || check.binding ? (
                    <span
                        className="text-[9.5px] font-bold text-[var(--ink-500)] bg-white/60 rounded px-1 py-px shrink-0"
                        title="이 판정이 귀속되는 평가항목"
                    >
                        {check.binding_label
                            ? `${check.binding_order_no ? `#${check.binding_order_no} ` : ''}${check.binding_label}`
                            : `#${check.binding_order_no || check.binding}`}
                    </span>
                ) : null}
            </div>
            {check.quote ? (
                <div className="flex items-start gap-1.5">
                    <TurnChip turn={check.best_turn_id} onTurn={onTurn} />
                    <button
                        type="button"
                        onClick={() => check.quote && onTurn?.(Number(check.best_turn_id), check.quote)}
                        className="text-left text-[10.5px] italic text-[var(--ink-700)] leading-relaxed hover:underline"
                    >
                        “{check.quote}”
                    </button>
                </div>
            ) : (
                <span className="text-[10.5px] text-[var(--ink-500)]">근거 발화 없음</span>
            )}
            {check.trigger_turn_id !== null && check.trigger_turn_id !== undefined && (
                <div className="flex items-center gap-1.5">
                    <span className="text-[10px] text-[var(--ink-500)]">적용조건</span>
                    <TurnChip turn={check.trigger_turn_id} onTurn={onTurn} tone="trigger" />
                </div>
            )}
            {check.rationale && (
                <p className="text-[10.5px] text-[var(--ink-700)] leading-relaxed">{check.rationale}</p>
            )}
        </div>
    );
};

/** 숫자 → 소수 n자리 문자열. 값 없으면 "-" */
const num = (v, digits = 4) => (Number.isFinite(Number(v)) ? Number(v).toFixed(digits) : '-');

/**
 * chunk 의 md 강조 기호 제거 — 화면용.
 * `notes`/`text` 는 **LLM 에 들어간 원문 그대로** 저장한다(판정 재현성). 화면에서만 `**`·백틱을
 * 걷어낸다 — 그대로 두면 "**본인여부가 …**" 처럼 기호가 노출된다(0831 사용자 지적).
 */
const stripMd = (s) =>
    String(s || '')
        .replace(/\*\*(.+?)\*\*/g, '$1')
        .replace(/`([^`]+)`/g, '$1');

/**
 * RAG 조회 근거 — 무엇을 가져왔고, 그 안에 어떤 판정 지침이 있었는지.
 *
 * 사용자 지시(2026-08-31), 세 갈래를 한 섹션으로 묶는다:
 *   ① "어떤 rag항목을 가져왔는지도 표시되게 해야돼"
 *   ② "가져온 rag와 그거 클릭했을때 어떤 내용인지도 나오게"
 *   ③ "aoss에서 하이브리드 서치 사용할건데 그 점수도 나오게 해줘"
 *
 * 왜 필요한가 — 판정 근거가 정적 표에서 RAG 로 옮겨졌다. 사용자 정리대로 흐름이
 * "고객 발화(트리거) → RAG 조회 → **가져온 chunk 안의 판정 지침** → LLM 이 그걸 보고 판단"
 * 이므로, chunk 를 못 보면 판정을 검증할 방법이 없다. `chosen` 후보 1건이 실제 원천이고
 * 나머지는 LLM 이 탈락시킨 후보다.
 *
 * 하이브리드 점수를 셋 다 보여주는 이유: 융합(RRF) 값은 후보 간 차이가 거의 없다
 * (실측 0.0328 / 0.0320 / 0.0318). 그래서 **순위가 정답을 정하지 않는다** — BM25/KNN 부분
 * 점수를 함께 봐야 그 chunk 가 왜 후보에 들었는지 읽힌다.
 *
 * 데이터 = `coverage.rag` (v2/pure_llm/kms_rag_check.py::_to_coverage)
 */
const RagEvidenceSection = ({ rag }) => {
    const cands = Array.isArray(rag?.candidates) ? rag.candidates : [];
    // 채택된 후보는 **기본 펼침** — 사용자 지시 "rag로 조회한 문서는 어떤 항목이 있는지 ...
    // 이런게 보여야하는건데". 판정의 실제 원천이므로 클릭 한 번을 더 요구하지 않는다.
    const chosenKey = (cands.find((c) => c.chosen) || {}).chunk_id || null;
    const [openId, setOpenId] = useState(chosenKey);
    if (!cands.length) return null;

    return (
        <div className="shrink-0 rounded-[12px] border border-[var(--border)] bg-white overflow-hidden">
            <div className="px-4 py-2.5 bg-[var(--background-soft)] border-b border-[var(--muted)] flex items-center gap-2.5 flex-wrap">
                <Database size={14} className="text-[var(--ink-700)] shrink-0" />
                <span className="text-[12.5px] font-semibold text-[var(--ink-900)]">RAG 조회 근거</span>
                <span className="text-[10.5px] text-[var(--ink-500)]">
                    {rag?.backend === 'aoss' ? 'AOSS 하이브리드(BM25+KNN→RRF)' : rag?.backend || '-'}
                    {rag?.index ? ` · ${rag.index}` : ''}
                </span>
                <span className="ml-auto text-[10.5px] text-[var(--ink-500)]">후보 {cands.length}건</span>
            </div>

            {rag?.query && (
                <div className="px-4 py-2 border-b border-[var(--muted)] bg-white">
                    <p className="text-[10px] font-bold text-[var(--ink-500)] mb-1">조회 질의 (고객 발화)</p>
                    <p className="text-[11px] text-[var(--ink-700)] leading-relaxed whitespace-pre-wrap break-words max-h-[92px] overflow-y-auto">
                        {rag.query}
                    </p>
                </div>
            )}

            <div className="p-3 flex flex-col gap-2">
                {cands.map((c, i) => {
                    const key = c.chunk_id || `c${i}`;
                    const open = openId === key;
                    const h = c.hybrid || {};
                    return (
                        <div
                            key={key}
                            className="rounded-[8px] border overflow-hidden"
                            style={{
                                borderColor: c.chosen ? '#86efac' : 'var(--muted)',
                                background: c.chosen ? '#f0fdf4' : 'white',
                            }}
                        >
                            <button
                                type="button"
                                onClick={() => setOpenId(open ? null : key)}
                                className="w-full px-3 py-2 flex items-center gap-2 flex-wrap text-left"
                                title="클릭하면 chunk 본문과 판정 지침을 펼칩니다"
                            >
                                <span
                                    className="shrink-0 text-[9.5px] font-extrabold rounded px-1.5 py-px"
                                    style={
                                        c.chosen
                                            ? { background: '#dcfce7', color: '#166534', border: '1px solid #86efac' }
                                            : { background: 'var(--muted)', color: 'var(--ink-500)' }
                                    }
                                >
                                    {c.chosen ? '채택' : '후보'}
                                </span>
                                <span className="text-[12px] font-semibold text-[var(--ink-900)] truncate">
                                    {c.title || c.chunk_id}
                                </span>
                                <span className="text-[10px] font-mono text-[var(--ink-500)] shrink-0">
                                    {c.chunk_id}
                                </span>
                                <span className="ml-auto shrink-0 flex items-center gap-2 text-[10px] tabular-nums">
                                    <span
                                        className="font-bold text-[var(--ink-900)]"
                                        title="RRF 융합 점수 — BM25 순위와 KNN 순위를 1/(60+rank) 로 합산한 값"
                                    >
                                        RRF {num(h.rrf ?? c.score)}
                                    </span>
                                    <span
                                        className="text-[var(--ink-700)]"
                                        title={`BM25 원점수 ${num(h.bm25, 2)} · 쿼리 내 top-1 대비 · 순위 ${h.bm25_rank ?? '-'}`}
                                    >
                                        BM25 {Number.isFinite(Number(h.bm25_pct)) ? `${Math.round(h.bm25_pct)}%` : '-'}
                                    </span>
                                    <span
                                        className="text-[var(--ink-700)]"
                                        title={`KNN 코사인 (1+cos)/2 · 순위 ${h.knn_rank ?? '-'}`}
                                    >
                                        KNN {num(h.knn, 3)}
                                    </span>
                                    <span className="text-[var(--ink-500)]">{open ? '▾' : '▸'}</span>
                                </span>
                            </button>

                            {open && (
                                <div className="px-3 pb-3 pt-1 border-t border-[var(--muted)] flex flex-col gap-2.5">
                                    {c.source_ref && (
                                        <p className="text-[10px] text-[var(--ink-500)]">출처 {c.source_ref}</p>
                                    )}
                                    {Array.isArray(c.required) && c.required.length > 0 && (
                                        <div>
                                            <p className="text-[10px] font-bold text-[var(--ink-500)] mb-1">
                                                필수 확인정보 {c.required.length}건
                                            </p>
                                            <div className="flex flex-wrap gap-1">
                                                {c.required.map((r, k) => (
                                                    <span
                                                        key={k}
                                                        className="text-[10.5px] rounded px-1.5 py-px bg-[var(--muted)] text-[var(--ink-900)]"
                                                    >
                                                        {r}
                                                    </span>
                                                ))}
                                            </div>
                                        </div>
                                    )}
                                    {Array.isArray(c.conditional) && c.conditional.length > 0 && (
                                        <div>
                                            <p className="text-[10px] font-bold text-[var(--ink-500)] mb-1">
                                                조건부 {c.conditional.length}건
                                            </p>
                                            <ul className="flex flex-col gap-0.5">
                                                {c.conditional.map((r, k) => (
                                                    <li key={k} className="text-[10.5px] text-[var(--ink-700)]">
                                                        · {r}
                                                    </li>
                                                ))}
                                            </ul>
                                        </div>
                                    )}
                                    {c.notes && (
                                        <div className="rounded-[6px] bg-[#FFFBEB] border border-[#FDE68A] px-2.5 py-2">
                                            <p className="text-[10px] font-bold text-[#92400E] mb-1">
                                                판정 지침 — LLM 이 이 문구를 보고 판단한다
                                            </p>
                                            <p className="text-[10.5px] text-[#78350F] leading-relaxed whitespace-pre-wrap break-words">
                                                {stripMd(c.notes)}
                                            </p>
                                        </div>
                                    )}
                                    {c.text && (
                                        <div>
                                            <p className="text-[10px] font-bold text-[var(--ink-500)] mb-1">chunk 본문</p>
                                            <pre className="text-[10.5px] text-[var(--ink-700)] leading-relaxed whitespace-pre-wrap break-words max-h-[260px] overflow-y-auto bg-[var(--background-soft)] rounded p-2 font-sans">
                                                {stripMd(c.text)}
                                            </pre>
                                        </div>
                                    )}
                                </div>
                            )}
                        </div>
                    );
                })}
            </div>
        </div>
    );
};

/**
 * 전사 (turn 순서) — 줄마다 트리거·판정 칩. V3 `KmsMandatoryCard.TranscriptSection` 이식.
 *
 * 사용자 지시(2026-08-31): "qa pipeline v3에 있는 전사처럼 전사에서 트리거랑 답변 이거 나오게".
 * V3 는 그 화면에서 판정 근거를 **전사 위에서** 읽는다 — 어느 발화가 업무를 성립시켰고(트리거)
 * 어느 발화가 필수항목을 충족시켰는지(✓/✗)를 카드와 전사에서 두 번 대조하지 않아도 된다.
 *
 * V3 와 다른 점 — 스키마가 단수다. V3 체크는 `trigger_turns[] / evidence_turns[]` 배열이지만
 * MTG 가 소비하는 파이프라인 산출은 `trigger_turn_id / best_turn_id` 단수 필드다. 그래서
 * 배열 순회 대신 값 1개를 넣는다(형태만 다르고 의미는 동일).
 *
 * @param turns  전사 턴. `coverage.transcript_turns`(파이프라인 산출) 우선, 없으면 상세화면의
 *               `evaluation.conversation` — 두 소스의 필드명이 달라 `normalizeTurns` 가 흡수한다.
 */
const TRIGGER_CHIP = { bg: '#EEF2FF', fg: '#3730A3', border: '#C7D2FE' };

/** 파이프라인 transcript_turns / MTG conversation → {turn_id, speaker, text} 공통형. */
const normalizeTurns = (covTurns, conversation) => {
    const src = Array.isArray(covTurns) && covTurns.length ? covTurns : conversation;
    if (!Array.isArray(src)) return [];
    return src
        .map((t, i) => {
            const rawId = t?.turn_id ?? t?.turn_no ?? t?.turn ?? null;
            const id = Number(rawId);
            return {
                turn_id: Number.isFinite(id) ? id : i + 1,
                speaker: String(t?.speaker ?? t?.speaker_type ?? t?.role ?? '').trim(),
                text: String(t?.text ?? t?.utterance ?? t?.content ?? '').trim(),
            };
        })
        .filter((t) => t.text);
};

/**
 * 전사 한 줄에 붙는 트리거·판정 칩 목록.
 * 좌측 카드(4열)와 우측 패널(3열, 발화 아래) 두 레이아웃이 공유한다 — 칩 모양은 동일해야 한다.
 */
const ChipList = ({ as }) => {
    if (!as || !as.length) return null;
    return (
        <span className="flex flex-col gap-1 min-w-0">
            {as.map((a, j) => {
                const v = statusVisual(a.status);
                const trig = a.kind === 'trigger';
                return (
                    <span
                        key={j}
                        title={
                            (a.bind ? `${a.bind} 귀속 · ` : '표시 전용(점수 미반영) · ') +
                            (trig
                                ? `(트리거) 이 발화가 [${a.intent}] 업무를 성립시킴 — 해당 업무 필수 확인정보 전건에 적용`
                                : `[${a.intent}] ${a.label} — ${a.status}`)
                        }
                        className="inline-flex items-center gap-1.5 rounded-[6px] px-1.5 py-px text-[10px] font-semibold max-w-full w-fit"
                        style={{
                            background: trig ? 'transparent' : v.bg,
                            color: trig ? TRIGGER_CHIP.fg : v.fg,
                            border: trig ? `1px dashed ${TRIGGER_CHIP.border}` : `1px solid ${v.border}`,
                        }}
                    >
                        <span className="font-extrabold shrink-0">{trig ? '트리거' : v.glyph}</span>
                        {a.bind && (
                            <span className="shrink-0 text-[9px] font-extrabold rounded px-1 bg-[var(--muted)] text-[var(--ink-700)] border border-[var(--border)]">
                                {a.bind}
                            </span>
                        )}
                        <span className="truncate">{a.label}</span>
                    </span>
                );
            })}
        </span>
    );
};

export const KmsTranscriptSection = ({ coverage, conversation, onTurn, variant, onClose }) => {
    const [open, setOpen] = useState(true);
    const turns = normalizeTurns(coverage?.transcript_turns, conversation);
    // variant="panel" — 우측 컬럼의 「STT 전사」 카드를 **대체**한다(사용자 지시 2026-08-31:
    //   "STT 전사 이부분을 아예 전사 (turn 순서) … 이거로 바꿀 수 있나 kms 탭 누르면?").
    //   좌측 KMS 패널에 같은 표를 또 두면 화면에 전사가 두 벌이 되므로 그쪽에서는 렌더하지 않는다.
    //   패널 모드는 접기를 쓰지 않고(카드 자체가 전사 전용) 높이를 카드에 맞춘다.
    const asPanel = variant === 'panel';
    if (!turns.length) return null;

    const byIntent = coverage?.mandatory?.evaluations_by_intent || {};

    // turn_id → 주석 목록. 트리거는 업무 1건이 필수항목 전부와 같은 turn 을 공유하므로
    // 업무 단위 1칩으로 접는다(V3 와 동일 — 안 접으면 한 줄에 같은 칩이 항목 수만큼 쌓인다).
    const ann = new Map();
    const push = (tid, a) => {
        const n = Number(tid);
        if (!Number.isFinite(n)) return;
        const arr = ann.get(n) || [];
        arr.push(a);
        ann.set(n, arr);
    };
    for (const [intent, ev] of Object.entries(byIntent)) {
        const checks = Array.isArray(ev?.checks) ? ev.checks : [];
        const trigSeen = new Set();
        for (const c of checks) {
            if (c?.status === '-') continue; // 미해당은 전사 주석에서도 제외
            const bind = c?.binding_label || (c?.binding_order_no ? `#${c.binding_order_no}` : '');
            if (c?.trigger_turn_id !== null && c?.trigger_turn_id !== undefined) {
                const key = `${intent}:${c.trigger_turn_id}`;
                if (!trigSeen.has(key)) {
                    trigSeen.add(key);
                    push(c.trigger_turn_id, { kind: 'trigger', intent, label: intent, bind, status: 'O' });
                }
            }
            if (c?.best_turn_id !== null && c?.best_turn_id !== undefined) {
                push(c.best_turn_id, {
                    kind: 'verdict',
                    intent,
                    label: c.statement || '',
                    bind,
                    status: c.status,
                });
            }
        }
    }

    return (
        <div
            className={
                asPanel
                    ? 'bg-white rounded-[14px] border border-[var(--border)] shadow-[0_1px_2px_rgba(16,24,40,0.04)] flex flex-col lg:h-[884px] overflow-hidden animate-in slide-in-from-right-4 duration-500'
                    : 'shrink-0 rounded-[12px] border border-[var(--border)] bg-white overflow-hidden'
            }
        >
            <div
                className={
                    asPanel
                        ? 'shrink-0 px-5 py-3.5 border-b border-[var(--muted)] bg-[var(--background-soft)] flex items-center gap-2.5'
                        : 'contents'
                }
            >
            <button
                type="button"
                onClick={() => (asPanel ? undefined : setOpen((v) => !v))}
                className={
                    asPanel
                        ? 'flex items-center gap-2.5 text-left'
                        : 'w-full px-4 py-2.5 bg-[var(--background-soft)] border-b border-[var(--muted)] flex items-center gap-2.5 text-left'
                }
            >
                <MessageSquare size={asPanel ? 16 : 14} className="text-[var(--ink-700)] shrink-0" />
                <span className={asPanel ? 'text-[14px] font-semibold text-[var(--ink-900)] tracking-tight' : 'text-[12.5px] font-semibold text-[var(--ink-900)]'}>
                    전사 (turn 순서)
                </span>
                <span className="text-[11px] text-[var(--ink-500)]">전체 {turns.length}턴</span>
                {ann.size > 0 && (
                    <span
                        className="text-[10.5px] font-bold rounded-full px-2 py-px"
                        style={{ background: TRIGGER_CHIP.bg, color: TRIGGER_CHIP.fg, border: `1px solid ${TRIGGER_CHIP.border}` }}
                        title="판정 근거 또는 업무 트리거로 표기된 turn 수"
                    >
                        판정·트리거 {ann.size}턴
                    </span>
                )}
                {!asPanel && <span className="ml-auto text-[11px] text-[var(--ink-500)]">{open ? '▾' : '▸'}</span>}
            </button>
            {asPanel && onClose && (
                <button
                    onClick={onClose}
                    className="ml-auto text-[var(--ink-400)] hover:text-[var(--ink-900)] transition-colors text-[15px] leading-none"
                    aria-label="분석 화면으로"
                >
                    ✕
                </button>
            )}
            </div>

            {(open || asPanel) && (
                <div className={asPanel ? 'flex-1 min-h-0 overflow-y-auto' : 'max-h-[440px] overflow-y-auto'}>
                    {turns.map((t, i) => {
                        const as = ann.get(t.turn_id) || [];
                        const isAgent = t.speaker.includes('상담');
                        return (
                            <div
                                key={`${t.turn_id}-${i}`}
                                className="grid gap-2 px-3 py-1.5 border-b border-[var(--muted)] text-[11.5px] leading-relaxed"
                                style={{
                                    // 패널 모드(우측 컬럼 ~400px)는 3열 — 칩은 발화 아래로 내린다.
                                    // 4열을 유지하면 발화 칸이 100px 남아 한 글자씩 줄바꿈된다(0831 실측).
                                    gridTemplateColumns: asPanel
                                        ? '30px 42px minmax(0,1fr)'
                                        : '40px 48px minmax(0,1fr) minmax(150px,240px)',
                                    background: as.length ? '#F5F7FF' : 'transparent',
                                }}
                            >
                                <button
                                    type="button"
                                    onClick={() => onTurn?.(t.turn_id, t.text)}
                                    className="text-left text-[10.5px] font-bold text-[var(--ink-500)] tabular-nums pt-px"
                                    title="전사에서 이 발화 보기"
                                >
                                    T{t.turn_id}
                                </button>
                                <span
                                    className="justify-self-start rounded-full px-1.5 text-[10px] font-bold h-[15px] leading-[15px] whitespace-nowrap"
                                    style={{
                                        background: isAgent ? '#E0E7FF' : 'var(--muted)',
                                        color: isAgent ? '#3730A3' : 'var(--ink-700)',
                                    }}
                                >
                                    {t.speaker || '?'}
                                </span>
                                {asPanel ? (
                                    <span className="min-w-0 flex flex-col gap-1">
                                        <span className="text-[var(--ink-900)] break-words">{t.text}</span>
                                        <ChipList as={as} />
                                    </span>
                                ) : (
                                    <>
                                        <span className="text-[var(--ink-900)] break-words">{t.text}</span>
                                        <ChipList as={as} />
                                    </>
                                )}
                            </div>
                        );
                    })}
                </div>
            )}
        </div>
    );
};

const KmsMandatoryPanel = ({ coverage, rows = [], marked = new Set(), onTurn, conversation }) => {
    const cov = coverage && typeof coverage === 'object' ? coverage : null;
    const mandatory = cov?.mandatory || {};
    const summary = mandatory.coverage_summary || {};
    const byIntent = mandatory.evaluations_by_intent || {};
    const detected = Array.isArray(cov?.detected) ? cov.detected : [];
    const intents = Object.keys(byIntent);

    // 업무명 → detected 원본(트리거·확신도·적대검증). 적대검증에서 다른 업무로 교정된 검출은
    // better_intent 로도 찾는다 — 카드는 교정 후 업무로 그룹핑되기 때문.
    const detectedFor = (intent) =>
        detected.find((d) => d.intent === intent) ||
        detected.find((d) => (d.adversarial || {}).better_intent === intent) ||
        null;

    if (!cov || cov.available !== true) {
        const reason = cov?.reason;
        const REASON_TEXT = {
            disabled: 'KMS 커버리지가 비활성 상태로 평가되었습니다.',
            no_loader: 'KMS 기준 데이터를 읽지 못했습니다.',
            no_kiwoom_md: 'KMS 기준 문서가 없습니다.',
            no_agent_body_utterances: '상담사 발화가 없어 판정하지 않았습니다.',
        };
        return (
            <div className="flex-1 flex items-center justify-center p-10">
                <p className="text-[12px] text-[var(--ink-400)] text-center leading-relaxed">
                    {REASON_TEXT[reason] || 'KMS 필수사항 체크 결과가 없습니다.'}
                    <br />
                    <span className="text-[11px]">
                        이 콜은 KMS 커버리지 산출 전에 평가되었을 수 있습니다 — 재평가하면 표시됩니다.
                    </span>
                </p>
            </div>
        );
    }

    return (
        <div data-testid="kms-panel" className="flex-1 min-h-0 overflow-auto p-4 flex flex-col gap-3">
            {/* 종합 충족률 */}
            <div className="shrink-0 rounded-[12px] border border-[var(--border)] bg-[var(--background-soft)] px-4 py-3 flex items-center gap-4">
                <div className="flex items-center gap-2 min-w-0">
                    <ListChecks size={16} className="text-[var(--ink-700)] shrink-0" />
                    <span className="text-[13px] font-semibold text-[var(--ink-900)]">종합 충족률</span>
                </div>
                <div className="flex items-baseline gap-1.5 shrink-0">
                    <span className="text-[18px] font-bold text-[var(--ink-900)] tabular-nums">
                        {summary.fulfilled ?? '-'}
                    </span>
                    <span className="text-[13px] text-[var(--ink-500)] tabular-nums">
                        / {summary.total ?? '-'}
                    </span>
                    <span className="ml-1 text-[13px] font-bold text-[var(--primary)] tabular-nums">
                        {pct(summary.rate)}
                    </span>
                </div>
                <span className="ml-auto text-[11px] text-[var(--ink-500)] shrink-0">
                    업무 {intents.length}건 · 필수항목 {summary.total ?? 0}건
                </span>
            </div>

            {/* KMS 지정 평가항목의 채점 — 충족률과 점수는 별개(충족률 모델)라 함께 보여준다 */}
            {rows.filter((r) => marked.has(Number(r.order_no))).map((r, i) => (
                <div
                    key={`s${i}`}
                    className="shrink-0 rounded-[10px] border border-[var(--muted)] bg-white px-4 py-2.5 flex items-center gap-3"
                >
                    <span className="text-[10px] font-bold text-[var(--ink-500)] bg-[var(--muted)] rounded px-1.5 py-0.5 shrink-0 tabular-nums">
                        #{r.order_no}
                    </span>
                    <span className="text-[12.5px] font-semibold text-[var(--ink-900)] shrink-0">
                        {r.item}
                    </span>
                    {/* `ai_eval` 은 체크리스트의 표시 라벨이라 이미 "10 / 20" 형태다.
                        분모를 또 붙이면 "10 / 20 / 20" 이 된다(0831 실측) — 슬래시가 있으면 그대로 쓴다. */}
                    <span className="text-[12.5px] font-bold tabular-nums shrink-0 text-[var(--ink-900)]">
                        {String(r.ai_eval ?? '-').includes('/') ? (
                            String(r.ai_eval)
                        ) : (
                            <>
                                {r.ai_eval ?? '-'}
                                <span className="text-[var(--ink-500)] font-medium"> / {r.max_score ?? '-'}</span>
                            </>
                        )}
                    </span>
                    {r.reason_text && (
                        <p className="text-[11px] text-[var(--ink-700)] leading-relaxed truncate" title={r.reason_text}>
                            {r.reason_text}
                        </p>
                    )}
                </div>
            ))}

            {/* 업무(인텐트)별 필수 항목 */}
            {intents.map((intent) => {
                const ev = byIntent[intent] || {};
                const checks = Array.isArray(ev.checks) ? ev.checks : [];
                const det = detectedFor(intent);
                return (
                    <div
                        key={intent}
                        className="shrink-0 rounded-[12px] border border-[var(--border)] bg-white overflow-hidden"
                    >
                        <div className="px-4 py-2.5 bg-[var(--background-soft)] border-b border-[var(--muted)] flex items-center gap-3">
                            <Target size={14} className="text-[var(--ink-700)] shrink-0" />
                            <span className="text-[13px] font-semibold text-[var(--ink-900)] truncate">
                                {intent}
                            </span>
                            {ev.branch && ev.branch !== intent && (
                                <span className="text-[10.5px] text-[var(--ink-500)] shrink-0">{ev.branch}</span>
                            )}
                            <span className="ml-auto text-[12.5px] font-bold tabular-nums shrink-0">
                                {ev.fulfilled ?? '-'}
                                <span className="text-[var(--ink-500)] font-medium"> / {ev.total ?? '-'}</span>
                                <span className="ml-1.5 text-[var(--primary)]">{pct(ev.coverage_rate)}</span>
                            </span>
                        </div>

                        <div className="p-4 flex flex-col gap-3">
                            {/* 업무 트리거 · 확신도 · 판정 이유 · 적대검증 */}
                            {det && (
                                <div className="rounded-[8px] border border-[var(--muted)] bg-[var(--background-soft)]/50 px-3 py-2 flex flex-col gap-1.5">
                                    <div className="flex items-center gap-1.5 flex-wrap">
                                        <span className="text-[10.5px] text-[var(--ink-500)]">업무 트리거</span>
                                        {(checks.find((c) => c.trigger_turn_id !== null && c.trigger_turn_id !== undefined) || {})
                                            .trigger_turn_id !== undefined && (
                                            <TurnChip
                                                turn={
                                                    (checks.find(
                                                        (c) => c.trigger_turn_id !== null && c.trigger_turn_id !== undefined
                                                    ) || {}).trigger_turn_id
                                                }
                                                onTurn={onTurn}
                                                tone="trigger"
                                            />
                                        )}
                                        {/* null 도 걸러야 한다 — RAG 경로는 self_confidence 를
                                            내지 않아(적대검증 미사용) "확신도 /10" 빈칸이 떴다. */}
                                        {det.self_confidence !== undefined && det.self_confidence !== null && (
                                            <span className="text-[10.5px] text-[var(--ink-500)] ml-2">
                                                확신도{' '}
                                                <span className="font-bold text-[var(--ink-900)] tabular-nums">
                                                    {det.self_confidence}/10
                                                </span>
                                            </span>
                                        )}
                                    </div>
                                    {det.reason && (
                                        <p className="text-[11px] text-[var(--ink-700)] leading-relaxed">
                                            {det.reason}
                                        </p>
                                    )}
                                    <AdversarialLine adv={det.adversarial} />
                                </div>
                            )}

                            {ev.reason && (
                                <p className="text-[11px] text-[var(--ink-700)] leading-relaxed">{ev.reason}</p>
                            )}

                            {checks.length > 0 ? (
                                <div className="grid grid-cols-1 xl:grid-cols-2 gap-2">
                                    {checks.map((c, ci) => (
                                        <CheckTile key={ci} check={c} onTurn={onTurn} />
                                    ))}
                                </div>
                            ) : (
                                <p className="text-[11px] text-[var(--ink-400)]">필수 항목 판정 결과가 없습니다.</p>
                            )}
                        </div>
                    </div>
                );
            })}

            {/* RAG 조회 근거 — 가져온 chunk · 하이브리드 점수 · 판정 지침 */}
            <RagEvidenceSection key={cov?.rag?.chosen_chunk_id || 'rag'} rag={cov?.rag} />

            {/* 전사(칩 포함)는 **우측 컬럼 카드**로 옮겼다 — Detail.jsx 의 variant="panel" 사용처 참조.
                여기 두면 같은 전사가 좌·우에 두 벌 뜬다(사용자 지시로 STT 전사 카드를 대체). */}

            <p className="shrink-0 text-[10.5px] text-[var(--ink-400)] leading-relaxed flex items-start gap-1.5">
                <MessageSquare size={11} className="mt-0.5 shrink-0" />
                충족률은 <b>표시 전용</b>이며 항목 점수와 직접 연동되지 않는다. T#N 칩을 누르면 전사에서
                해당 발화로 이동한다.
            </p>
        </div>
    );
};

export default KmsMandatoryPanel;
