// AI QA 항목관리 — 2탭 허브.
//   ① 평가항목 관리 (체크리스트 + Pentagon 5축, EvalItems)
//   ② KMS 업무 데이터 (업무별 필수 확인정보·안내, KmsItems)
//
//   LLM 스킬 버전의 트래킹·활성화/롤백은 평가항목 관리 > [변경 이력] 모달의
//   'LLM 스킬 관리' 모드에서 수행한다. (딥링크 #/admin/skill-prompts 라우트는 별도 존치)
//
// 탭 스트립은 Tailwind 로 직접 그린다 — evalMgmt.css 의 `.tg-eval .tabs` 를 쓰면
//   그 CSS 가 번들에 포함되는지에 의존하게 되므로(현재 EvalMgmt.jsx 단독 import) 회피.
// 탭 높이(≈56px)만큼 하위 뷰의 세로 계산을 보정해 넘긴다(topOffset).
import React, { useState } from 'react';
import EvalItems from './EvalItems';
import KmsItems from './KmsItems';

const TABS = [
    { key: 'items', label: '평가항목 관리' },
    { key: 'kms', label: 'KMS 업무 데이터' },
];

const TAB_STRIP_PX = 56;

const EvalItemsHub = ({ activeBrandId }) => {
    const [tab, setTab] = useState('items');

    return (
        <div className="w-full">
            <div className="flex gap-1 mb-4 border-b border-[var(--border)]">
                {TABS.map((t) => {
                    const on = tab === t.key;
                    return (
                        <button
                            key={t.key}
                            type="button"
                            onClick={() => setTab(t.key)}
                            className={`px-4 py-2.5 text-[13px] transition-colors border-b-2 -mb-px ${
                                on
                                    ? 'border-[var(--primary)] text-[var(--primary)] font-semibold'
                                    : 'border-transparent text-[var(--ink-500)] font-medium hover:text-[var(--ink-900)]'
                            }`}
                        >
                            {t.label}
                        </button>
                    );
                })}
            </div>

            {tab === 'items' && <EvalItems activeBrandId={activeBrandId} topOffset={TAB_STRIP_PX} />}
            {tab === 'kms' && <KmsItems activeBrandId={activeBrandId} topOffset={TAB_STRIP_PX} />}
        </div>
    );
};

export default EvalItemsHub;
