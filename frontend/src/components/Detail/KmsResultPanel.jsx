import React from 'react';
import { MessageSquare, BookOpen, ListChecks, Megaphone } from 'lucide-react';

/**
 * 평가 결과 상세 — KMS 탭.
 *
 * 평가항목 관리에서 **KMS 지정(marked_items)** 한 항목만 추려, 그 항목의 채점 결과와
 * 판정 근거가 된 KMS 자료(업무 데이터 · 근거 문서)를 한 화면에 묶어 보여준다.
 * 상세 체크리스트 탭은 전 항목을 점수 관점으로 나열하므로 "이 항목이 어떤 KMS 근거로
 * 채점됐는가" 가 드러나지 않는다 — 그 질문 전용 화면이다.
 *
 * props
 *   rows        : KMS 지정 항목만 필터된 checklistRows (Detail.jsx 가 계산)
 *   items       : KMS 업무 데이터 [{task, confirm_info[], readback, mandatory_notice[], linked_items[]}]
 *   docs        : KMS 근거 문서   [{title, body, tags[], linked_items[], active}]
 *   onUtterance : (quote) => void — 발화 클릭 시 STT 전사 하이라이트
 */
const KmsResultPanel = ({ rows = [], items = [], docs = [], onUtterance }) => {
    // 항목번호 → 연결 자료. linked_items 가 비어 있는 자료는 "전 KMS 항목 공통" 으로 본다
    // (평가항목 관리에서 문서만 등록하고 연결을 안 건 경우 — 근거가 사라지면 안 된다).
    const linkedFor = (orderNo, pool) =>
        pool.filter((x) => {
            const li = Array.isArray(x.linked_items) ? x.linked_items : [];
            return x.active !== false && (li.length === 0 || li.includes(orderNo));
        });

    if (!rows.length) {
        return (
            <div className="flex-1 flex items-center justify-center p-10">
                <p className="text-[12px] text-[var(--ink-400)] text-center leading-relaxed">
                    KMS 지정 평가항목의 채점 결과가 없습니다.
                    <br />
                    평가항목 관리에서 KMS 항목으로 지정하면 이 탭에 나타납니다.
                </p>
            </div>
        );
    }

    return (
        <div className="flex-1 min-h-0 overflow-auto p-4 flex flex-col gap-3">
            {rows.map((r, i) => {
                const linkedDocs = linkedFor(r.order_no, docs);
                const linkedTasks = linkedFor(r.order_no, items);
                const isYn = r.scoring_type === 'yes_no';
                const failed = isYn ? !(r.earned_ai > 0) : r.earned_ai < r.rubric_max_pts;

                return (
                    <div
                        key={i}
                        className="rounded-[12px] border border-[var(--border)] bg-white overflow-hidden"
                    >
                        {/* 헤더 — 항목명 · 구분 · 채점 결과 */}
                        <div className="px-4 py-2.5 bg-[var(--background-soft)] border-b border-[var(--muted)] flex items-center justify-between gap-3">
                            <div className="flex items-center gap-2 min-w-0">
                                <span className="text-[10px] font-bold text-[var(--ink-500)] bg-[var(--muted)] rounded px-1.5 py-0.5 shrink-0 tabular-nums">
                                    #{r.order_no}
                                </span>
                                <span className="text-[13px] font-semibold text-[var(--ink-900)] truncate">
                                    {r.item}
                                </span>
                                <span className="text-[11px] text-[var(--ink-400)] shrink-0">{r.category}</span>
                            </div>
                            <span className="shrink-0 text-[13px] font-bold tabular-nums">
                                {isYn ? (
                                    <span className={failed ? 'text-[var(--destructive)]' : 'text-[var(--success)]'}>
                                        {failed ? 'N' : 'Y'}
                                    </span>
                                ) : (
                                    <span className={failed ? 'text-[var(--destructive)]' : 'text-[var(--ink-900)]'}>
                                        {r.ai_eval_label}
                                    </span>
                                )}
                            </span>
                        </div>

                        <div className="p-4 flex flex-col gap-3">
                            {/* 평가 이유 */}
                            {r.reason_text && (
                                <p className="text-[11.5px] text-[var(--ink-700)] leading-relaxed">
                                    {r.reason_text}
                                </p>
                            )}

                            {/* 근거 발화 — 체크리스트 탭과 동일하게 클릭 시 전사로 이동 */}
                            {String(r.utterance || '').trim() && (
                                <div className="flex flex-col gap-1">
                                    {String(r.utterance)
                                        .split('\n')
                                        .map((q) => q.trim())
                                        .filter(Boolean)
                                        .map((q, qi) => (
                                            <button
                                                key={qi}
                                                type="button"
                                                onClick={() => onUtterance?.(q)}
                                                className="text-left text-[11px] italic text-[var(--ink-700)] leading-relaxed rounded px-2 py-1 bg-[var(--background-soft)] hover:bg-[var(--muted)] hover:text-[var(--primary)] transition-colors inline-flex items-start gap-1.5"
                                            >
                                                <MessageSquare size={11} className="mt-0.5 shrink-0 opacity-60" />
                                                <span>"{q}"</span>
                                            </button>
                                        ))}
                                </div>
                            )}

                            {/* KMS 업무 데이터 — 필수 확인정보 / 필수 안내 */}
                            {linkedTasks.map((t, ti) => (
                                <div
                                    key={`t${ti}`}
                                    className="rounded-[8px] border border-[var(--muted)] bg-[var(--background-soft)]/60 px-3 py-2 flex flex-col gap-1.5"
                                >
                                    <div className="flex items-center gap-1.5">
                                        <ListChecks size={12} className="text-[var(--ink-500)] shrink-0" />
                                        <span className="text-[11.5px] font-semibold text-[var(--ink-900)]">
                                            {t.task}
                                        </span>
                                        {t.readback && (
                                            <span className="text-[10px] font-bold text-[var(--ink-500)] bg-[var(--muted)] rounded px-1.5 py-px">
                                                복창 필수
                                            </span>
                                        )}
                                    </div>
                                    {t.confirm_info?.length > 0 && (
                                        <p className="text-[11px] text-[var(--ink-700)] leading-relaxed">
                                            <span className="text-[var(--ink-500)]">필수 확인정보 · </span>
                                            {t.confirm_info.join(' · ')}
                                        </p>
                                    )}
                                    {t.mandatory_notice?.length > 0 && (
                                        <div className="flex items-start gap-1.5">
                                            <Megaphone size={11} className="text-[var(--ink-500)] mt-0.5 shrink-0" />
                                            <p className="text-[11px] text-[var(--ink-700)] leading-relaxed">
                                                {t.mandatory_notice.join(' / ')}
                                            </p>
                                        </div>
                                    )}
                                </div>
                            ))}

                            {/* KMS 근거 문서 — 제목 + 본문 접기(details) */}
                            {linkedDocs.map((d, di) => (
                                <details
                                    key={`d${di}`}
                                    className="rounded-[8px] border border-[var(--muted)] bg-white px-3 py-2 group/doc"
                                >
                                    <summary className="cursor-pointer list-none flex items-center gap-1.5 text-[11.5px] font-semibold text-[var(--ink-900)]">
                                        <BookOpen size={12} className="text-[var(--ink-500)] shrink-0" />
                                        {d.title}
                                        {d.tags?.length > 0 && (
                                            <span className="text-[10px] font-medium text-[var(--ink-400)]">
                                                {d.tags.join(' · ')}
                                            </span>
                                        )}
                                        <span className="ml-auto text-[10px] text-[var(--ink-400)] group-open/doc:hidden">
                                            펼치기
                                        </span>
                                    </summary>
                                    <p className="mt-2 text-[11px] text-[var(--ink-700)] leading-relaxed whitespace-pre-line max-h-[220px] overflow-y-auto">
                                        {d.body}
                                    </p>
                                </details>
                            ))}

                            {!linkedTasks.length && !linkedDocs.length && (
                                <p className="text-[11px] text-[var(--ink-400)]">
                                    이 항목에 연결된 KMS 업무 데이터·근거 문서가 없습니다.
                                </p>
                            )}
                        </div>
                    </div>
                );
            })}
        </div>
    );
};

export default KmsResultPanel;
