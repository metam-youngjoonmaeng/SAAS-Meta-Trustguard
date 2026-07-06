// AI QA 항목관리 — 평가항목 관리(체크리스트 + Pentagon 5축, EvalItems) 단일 뷰.
//   LLM 스킬 버전의 트래킹·활성화/롤백은 평가항목 관리 > [변경 이력] 모달의
//   'LLM 스킬 관리' 모드에서 수행한다. (딥링크 #/admin/skill-prompts 라우트는 별도 존치)
import React from 'react';
import EvalItems from './EvalItems';

const EvalItemsHub = ({ activeBrandId }) => (
    <div className="w-full">
        <EvalItems activeBrandId={activeBrandId} />
    </div>
);

export default EvalItemsHub;
