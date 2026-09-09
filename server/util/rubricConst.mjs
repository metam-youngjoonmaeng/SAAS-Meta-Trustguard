// 루브릭 트랙 공용 상수 — 2026-09-03 qaPipelineIngest.mjs · skillLearn.mjs 양쪽에 같은 값으로 따로 있던 것을 한 곳으로.
//   (두 파일은 서로 import 하는 순환 관계라 한쪽에서 export 하지 않고 별도 모듈에 둔다)

/** 백엔드 항목번호 = RUBRIC_ITEM_BASE + index (5000+index). 브랜드 무관. */
export const RUBRIC_ITEM_BASE = 5000;

/** /v2/rubrics 등록(멱등, LLM 미개입) 타임아웃. */
export const RUBRIC_REGISTER_TIMEOUT_MS = 30_000;
