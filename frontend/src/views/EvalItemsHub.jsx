// AI QA 항목관리 — 평가항목 관리(체크리스트 + Pentagon 5축, EvalItems) 단일 뷰.
//   LLM 스킬 버전의 트래킹·활성화/롤백은 평가항목 관리 > [변경 이력] 모달의
//   'LLM 스킬 관리' 모드에서 수행한다. (딥링크 #/admin/skill-prompts 라우트는 별도 존치)
//
// KMS(항목 지정 · 근거 문서 · RAG 색인)는 **별 탭을 두지 않는다** — 평가항목 관리 안에서 처리한다:
//   목록 행의 KMS 배지 · 항목 모달의 [KMS 항목] 선택 · 우측 패널 'KMS 근거 문서' 섹션.
//   (0827 초안의 별도 [KMS 업무 데이터] 탭은 사용자 지시로 폐기)
import React from 'react';
import EvalItems from './EvalItems';

const EvalItemsHub = ({ activeBrandId }) => (
    <div className="w-full">
        <EvalItems activeBrandId={activeBrandId} />
    </div>
);

export default EvalItemsHub;
