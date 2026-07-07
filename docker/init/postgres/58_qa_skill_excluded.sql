-- 스킬셋(수기 높음/낮음 정정) 배치 학습 제외 목록.
-- AI 스킬 관리 화면에서 '삭제'한 케이스 = 스킬 학습(skillLearn)에서 제외(원본 평가행 qa_evaluation_rows 는 불변).
-- collectSkillCases 가 NOT EXISTS 로 참조하고, /api/skillset 조회에서도 제외한다.
CREATE TABLE IF NOT EXISTS qa_skill_excluded (
    org_id     integer     NOT NULL,
    qa_id      text        NOT NULL,
    order_no   integer     NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (org_id, qa_id, order_no)
);
