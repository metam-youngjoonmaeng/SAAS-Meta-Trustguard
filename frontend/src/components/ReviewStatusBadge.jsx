import React from 'react';
import { Check, Play, RotateCcw } from 'lucide-react';

// 검수 워크플로우(반려/이의제기 루프): 대기 → 검수중 → 검토요청 →[반려↔이의제기]→ 확정.
//   pending → in_review → review_done → (admin_revised 반려 ↔ objection 이의제기) → approved(확정)
//   상담사: 검토 제출(→검토요청) / 반려분에 점수 동의(→확정)·이의제기(→이의제기).
//   관리자: 직접 확정 / 반려(사유)·최종 승인 / 이의제기분 재검토 후 승인·다시 반려 / 강제 확정 / 확정 취소.
export const REVIEW_STATUS = {
    PENDING: 'pending',
    IN_REVIEW: 'in_review',
    REVIEW_DONE: 'review_done',
    ADMIN_REVISED: 'admin_revised',
    OBJECTION: 'objection',
    APPROVED: 'approved',
    COMPLETED: 'approved', // (deprecated) 레거시 3단계 'completed' → approved 별칭
};

export const REVIEW_STATUS_LABEL = {
    pending: '대기',
    in_review: '검수중',
    review_done: '검토요청',
    admin_revised: '반려',
    objection: '이의제기',
    approved: '확정',
};

// 콜 row → 검수상태. 명시적 워크플로우라 자동승격 없이 저장값을 그대로 정규화('completed'→approved).
export function deriveReviewStatus(call) {
    if (!call) return REVIEW_STATUS.PENDING;
    const v = call.review_status === 'completed' ? 'approved' : call.review_status;
    return REVIEW_STATUS_LABEL[v] ? v : REVIEW_STATUS.PENDING;
}

const STYLES = {
    pending: { dot: '#98A2B3', bg: '#F2F4F7', text: '#667085', border: '#E4E7EC' },
    // 검수중: 진행 중 단계라 회색 계열(대기보다 진하게) — 파란색은 '완료된 느낌'이라 회색으로.
    in_review: { dot: '#475467', bg: '#E4E7EC', text: '#344054', border: '#CDD2DA' },
    // 검토요청: 검수중과 동일한 블루 계열(체크 아이콘으로 "작업 끝, 승인 요청" 구분).
    review_done: { dot: '#1E70E0', bg: '#EEF4FB', text: '#055AAF', border: '#BFD4F2' },
    // 반려: 상담사 액션 필요 → 주황 계열(주의 환기).
    admin_revised: { dot: '#F79009', bg: '#FFFAEB', text: '#B54708', border: '#FEDF89' },
    // 이의제기: 관리자 재검토 필요 → 적색 계열.
    objection: { dot: '#D92D20', bg: '#FEF3F2', text: '#B42318', border: '#FECDCA' },
    approved: { dot: '#12B76A', bg: '#ECFDF3', text: '#067647', border: '#ABEFC6' },
};

const ReviewStatusBadge = ({ status, size = 'sm', title }) => {
    const s = STYLES[status] || STYLES.pending;
    const label = REVIEW_STATUS_LABEL[status] || REVIEW_STATUS_LABEL.pending;
    // 검토요청·최종승인은 체크 아이콘, 나머지는 점.
    const isDone = status === REVIEW_STATUS.REVIEW_DONE || status === REVIEW_STATUS.APPROVED;
    const padding = size === 'md' ? 'px-2.5 py-1' : 'px-2 py-0.5';
    const fontSize = size === 'md' ? 'text-[12px]' : 'text-[11.5px]';

    return (
        <span
            title={title || undefined}
            className={`inline-flex items-center gap-1.5 ${padding} ${fontSize} font-semibold rounded-full border whitespace-nowrap${title ? ' cursor-help' : ''}`}
            style={{ background: s.bg, color: s.text, borderColor: s.border }}
        >
            {isDone ? (
                <Check size={11} strokeWidth={3} style={{ color: s.dot }} />
            ) : (
                <span
                    className="inline-block w-1.5 h-1.5 rounded-full"
                    style={{ background: s.dot }}
                />
            )}
            {label}
        </span>
    );
};

export default ReviewStatusBadge;

// 검수상태 전이 액션 버튼.
//   상담사: 대기 → [검수 시작] → 검수중 → [검토 요청] → 검토요청(이후 잠금, 관리자 승인 대기)
//   관리자: 검토요청 → [최종 승인] → 최종승인
const ACTIONS = {
    [REVIEW_STATUS.PENDING]: {
        next: REVIEW_STATUS.IN_REVIEW,
        label: '검수 시작',
        Icon: Play,
        variant: 'primary',
    },
    [REVIEW_STATUS.IN_REVIEW]: {
        next: REVIEW_STATUS.REVIEW_DONE,
        label: '검토 요청',
        Icon: Check,
        variant: 'primary',
    },
    [REVIEW_STATUS.REVIEW_DONE]: {
        next: REVIEW_STATUS.IN_REVIEW,
        label: '검수중으로',
        Icon: RotateCcw,
        variant: 'ghost',
    },
    [REVIEW_STATUS.APPROVED]: {
        next: REVIEW_STATUS.IN_REVIEW,
        label: '재검수',
        Icon: RotateCcw,
        variant: 'ghost',
    },
};

export const ReviewStatusActionButton = ({ status, isSaving, onChange }) => {
    const action = ACTIONS[status] || ACTIONS[REVIEW_STATUS.PENDING];
    const { next, label, Icon, variant } = action;
    const base = 'px-4 py-2 rounded-lg text-sm font-semibold flex items-center gap-2 transition-colors disabled:opacity-60 disabled:cursor-not-allowed';
    const variantClass =
        variant === 'primary'
            ? 'bg-[#055AAF] text-white hover:bg-[#044a93]'
            : 'border border-[#D0D5DD] text-[#344054] hover:bg-gray-50';
    return (
        <button
            type="button"
            disabled={isSaving}
            onClick={() => onChange?.(next)}
            className={`${base} ${variantClass}`}
        >
            <Icon size={16} />
            {label}
        </button>
    );
};
