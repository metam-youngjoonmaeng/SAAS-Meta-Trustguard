// AI QA 항목관리 허브 — [평가항목 관리] / [LLM 스킬 관리] 두 탭을 한 페이지에 묶는다.
//   - 평가항목 관리: 체크리스트 + Pentagon 5축 (EvalItems)
//   - LLM 스킬 관리: 검수 정정 학습 overlay 버전 관리 (SkillPromptManage — .tg-eval 스코프)
// EvalItems / SkillPromptManage 본체는 그대로 두고 상단 탭 바만 얹는다.
import React, { useState } from 'react';
import { Bot, Wand2 } from 'lucide-react';
import EvalItems from './EvalItems';
import SkillPromptManage from './SkillPromptManage';

const TABS = [
    { key: 'items', label: '평가항목 관리', Icon: Bot },
    { key: 'skill', label: 'LLM 스킬 관리', Icon: Wand2 },
];

const EvalItemsHub = ({ activeBrandId }) => {
    const [tab, setTab] = useState('items');
    return (
        <div className="w-full">
            <div className="flex items-center gap-1 border-b border-[#E4E7EC] mb-4">
                {TABS.map(({ key, label, Icon }) => {
                    const active = tab === key;
                    return (
                        <button
                            key={key}
                            type="button"
                            onClick={() => setTab(key)}
                            className={`relative inline-flex items-center gap-2 px-4 py-3 text-[13.5px] border-b-2 -mb-px transition-colors cursor-pointer ${
                                active
                                    ? 'text-[#055AAF] font-bold border-[#055AAF]'
                                    : 'text-[#667085] font-semibold border-transparent hover:text-[#101828]'
                            }`}
                        >
                            <Icon size={15} />
                            {label}
                        </button>
                    );
                })}
            </div>
            {tab === 'items' ? (
                <EvalItems activeBrandId={activeBrandId} topOffset={64} />
            ) : (
                <div className="tg-eval"><SkillPromptManage /></div>
            )}
        </div>
    );
};

export default EvalItemsHub;
