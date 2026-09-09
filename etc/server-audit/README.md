# server/ 정적 감사 · 분리 도구 (2026-09-03)

`server/index.js` 6,619줄을 도메인 라우터 11개로 분리하고, 서버 전체의 미사용·중복·충돌을 잡을 때 쓴 도구. acorn + eslint-scope 로 **실제 참조 그래프**를 계산한다(grep 추정이 아님).

## 준비

```bash
cd etc/server-audit
npm init -y && npm i acorn@8 eslint-scope@8        # 저장소 의존성에 넣지 않는다 — 여기서만
```

## server_audit.mjs — 감사 리포트

```bash
node server_audit.mjs [--json out.json]
```

| 항목 | 내용 |
|---|---|
| A | 파일별 미사용 import 스펙 |
| B | 참조 0 최상위 선언(비-export) = 데드코드 |
| C | export 됐지만 어느 서버 파일도 import 하지 않는 이름(내부 참조 수 병기) |
| D | 동명 최상위 정의 — 본문 해시 같으면 `중복`, 다르면 `충돌?` |
| E | 같은 (method, path) 라우트 2회 등록 |
| F | `.bak*` 등 백업·임시 파일 |

D 의 `main`(backfill 스크립트) · `getPool`(소스별 MySQL 풀, env 키가 다름) 은 의도된 동명이라 남긴다.

## split_index.mjs — index.js 도메인 분리 (1회성, 재실행 금지)

2026-09-03 에 실행 완료. 라우트 문장을 원문 그대로 `server/routes/<domain>.mjs` 의 `create<X>Routes(ctx)` 로 옮기고, 그 도메인에서만 참조되는 헬퍼·상태를 함께 옮겼다. 공통 헬퍼는 index.js 가 ctx 로 넘긴다. 검증: 모듈별 미해결 식별자 0 · (method, path) 다중집합 동일 · 순서 역전 섀도잉 0. 이미 분리된 index.js 에 다시 돌리면 라우트가 없어 의미가 없다 — 참고용으로만 둔다.

## 구조 (분리 후)

```
server/
  index.js            앱 부트스트랩 · 미들웨어(gzip·인증·샌드박스·활성 브랜드) · 공통 헬퍼 · 라우터 마운트 (약 650줄)
  routes/
    svc.mjs           health · svc · realtime · ipcc
    auth.mjs          login/logout · memberships · switch-org
    calls.mjs         콜 목록 · 상담사 · 통계 · 평가 상세/수정 · 검수 (펜타곤 빌더 포함, 가장 큼)
    golden.mjs        골든셋 · 스킬셋 지정
    evalItems.mjs     평가항목 CRUD · 버전 · 이력 · 펜타곤 축 · KSQI 카탈로그
    kms.mjs           KMS 업무 데이터 · 색인
    ragLlm.mjs        LLM 백엔드 조회 · RAG 벡터 백엔드 전환 · RAG 로그/few-shot 설정
    ingest.mjs        AI Canvas · 컬렉션 콜 · QA 파이프라인 적재 · 배치 job
    coaching.mjs      코칭 · 튜터 시나리오 · 상담사별 콜
    ta.mjs            내 TA 지표
    batch.mjs         배치 설정 · 골든/스킬 학습 · 판정 프롬프트 · 재판정
  util/
    common.mjs        round1 · safeStr · asNumber · env · sha256Hex (중복 통합)
    rubricConst.mjs   RUBRIC_ITEM_BASE · RUBRIC_REGISTER_TIMEOUT_MS
```

새 라우트는 해당 도메인 파일의 `router.<method>(...)` 로 추가한다. 공통 헬퍼가 더 필요하면 index.js 의 `app.use(createXRoutes({ ... }))` ctx 에 이름을 추가하고 모듈 상단 `const { ... } = ctx` 에 받는다.
