import React from 'react';
import { Check, Play, RotateCcw } from 'lucide-react';

export const REVIEW_STATUS = {
    PENDING: 'pending',
    IN_REVIEW: 'in_review',
    COMPLETED: 'completed',
};

export const REVIEW_STATUS_LABEL = {
    [REVIEW_STATUS.PENDING]: '대기',
    [REVIEW_STATUS.IN_REVIEW]: '검수중',
    [REVIEW_STATUS.COMPLETED]: '완료',
};

// 콜 row → 검수상태 결정.
// - review_status 컬럼이 'in_review'/'completed' 이면 명시적 사용자 의사이므로 그대로 사용.
// - 'pending' 이거나 미정인데 체크리스트가 사실상 완료 상태 (백엔드의 checklist_complete,
//   manual_score 둘 중 하나라도 truthy) 면 'completed' 로 승격. 수기 평가만 끝내고 "검수 완료"
//   버튼을 안 눌렀거나, 모든 행이 골든셋에 들어가 있어 Detail 이 100% 로 표시되는 케이스를 보정.
const VALID_STATUSES = new Set(Object.values(REVIEW_STATUS));

export function deriveReviewStatus(call) {
    if (!call) return REVIEW_STATUS.PENDING;
    const explicit = VALID_STATUSES.has(call.review_status) ? call.review_status : null;
    if (explicit === REVIEW_STATUS.COMPLETED) return REVIEW_STATUS.COMPLETED;
    // 모든 행 수기평가 완료(체크리스트 100%)면 '완료'를 우선 — 세션 중 자동 세팅된 옛 'in_review'
    // 가 100% 인데도 '검수중'으로 남는 문제 보정.
    if (call.checklist_complete === true) return REVIEW_STATUS.COMPLETED;
    if (explicit && explicit !== REVIEW_STATUS.PENDING) return explicit;
    const m = call.manual_score;
    const hasManualReview = m !== null && m !== undefined && m !== '' && !Number.isNaN(Number(m));
    if (hasManualReview) return REVIEW_STATUS.COMPLETED;
    return explicit ?? REVIEW_STATUS.PENDING;
}

const STYLES = {
    [REVIEW_STATUS.PENDING]: {
        dot: '#98A2B3',
        bg: '#F2F4F7',
        text: '#667085',
        border: '#E4E7EC',
    },
    [REVIEW_STATUS.IN_REVIEW]: {
        dot: '#1E70E0',
        bg: '#EEF4FB',
        text: '#055AAF',
        border: '#BFD4F2',
    },
    [REVIEW_STATUS.COMPLETED]: {
        dot: '#12B76A',
        bg: '#ECFDF3',
        text: '#067647',
        border: '#ABEFC6',
    },
};

const ReviewStatusBadge = ({ status, size = 'sm', title }) => {
    const s = STYLES[status] || STYLES[REVIEW_STATUS.PENDING];
    const label = REVIEW_STATUS_LABEL[status] || REVIEW_STATUS_LABEL[REVIEW_STATUS.PENDING];
    const isCompleted = status === REVIEW_STATUS.COMPLETED;
    const padding = size === 'md' ? 'px-2.5 py-1' : 'px-2 py-0.5';
    const fontSize = size === 'md' ? 'text-[12px]' : 'text-[11.5px]';

    return (
        <span
            title={title || undefined}
            className={`inline-flex items-center gap-1.5 ${padding} ${fontSize} font-semibold rounded-full border whitespace-nowrap${title ? ' cursor-help' : ''}`}
            style={{ background: s.bg, color: s.text, borderColor: s.border }}
        >
            {isCompleted ? (
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

// 검수상태 전이 액션 버튼 — pending → in_review → completed ↔ in_review.
const ACTIONS = {
    [REVIEW_STATUS.PENDING]: {
        next: REVIEW_STATUS.IN_REVIEW,
        label: '검수 시작',
        Icon: Play,
        variant: 'primary',
    },
    [REVIEW_STATUS.IN_REVIEW]: {
        next: REVIEW_STATUS.COMPLETED,
        label: '검수 완료',
        Icon: Check,
        variant: 'primary',
    },
    [REVIEW_STATUS.COMPLETED]: {
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
