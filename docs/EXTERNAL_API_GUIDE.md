# 외부 API 연동 가이드 — 컬렉션관리부 1콜

신한카드 QA 대시보드 PoC 에 외부 시스템(파트너 API)이 평가 결과 1콜을 적재할 때 사용하는 **JSON / CSV 형식 명세**입니다.

> 본 가이드는 **1차 연동 테스트** 용으로 **컬렉션관리부 1콜** 만 다룹니다. 소비자보호부 트랙(20 Y/N + 금칙어 + 12 AI 카테고리), 다른 부서 확장은 1차 검증 이후 별도 명세로 안내합니다.

---

## TL;DR — 가장 최소 페이로드

**콜 목록에 1줄이 뜨는 것까지**만 확인하려면 아래 4개 필드만 보내도 됩니다.
STT / 평가 점수 / 5축 코멘트는 전부 옵션입니다.

```bash
curl -X POST http://<host>:3027/api/ingest/collection-call \
  -H "Content-Type: application/json" \
  -d '{
    "call": {
      "id":   "ext-20260514-0001",
      "cdate":"2026-05-14T10:21:35+09:00",
      "role": "PDS1"
    }
  }'
```

| 필드 | 필수 | 비고 |
|---|---|---|
| `call.id`    | ✅ | 콜 고유 ID. 같은 ID 로 재호출하면 upsert |
| `call.cdate` | ✅ | 통화 일시 (ISO 8601 권장) |
| `call.role`  | ✅ | `PDS1` / `PDS2` / `PDS3` / `수동대인` / `인바운드` 중 1 |
| `call.department` |  | 생략 시 `컬렉션관리부` (현재 엔드포인트 전용값) |

이렇게만 보내도 대시보드 새로고침 시:
- 콜 목록 화면에 **부서 / 직무 / 콜번호(=ID) / 통화일시** 가 표시됩니다.
- `AI_SCORE` / `TOTAL_SCORE` 는 0 으로 저장됩니다.
- 통화 상세 화면에 들어가면 9개 평가항목 / Pentagon 5축 영역은 빈 상태(점수 0)로 노출됩니다.

---

## 1. 엔드포인트

```
POST /api/ingest/collection-call
Content-Type: application/json
```

| 환경 | URL |
|---|---|
| 로컬 (docker-compose) | `http://<host>:3027/api/ingest/collection-call` |
| 대시보드 프록시 경유 | `http://<host>:3026/api/ingest/collection-call` (Next rewrites → API) |

- 성공 (`200 OK`): `{ ok: true, qa_id, ai_score, total_score, role, department, turns }`
- 검증 실패 (`400`): `{ ok: false, message }`
- 서버 오류 (`500`):  `{ ok: false, message }`
- 동일 `call.id` 재호출 → **upsert** (자식 행은 트랜잭션 내에서 삭제 후 재적재)

---

## 2. JSON 형식 — 전체 묶음

```jsonc
{
  "call":         { /* 콜 메타 (필수: id, cdate, role) */ },
  "conversation": [ /* STT turn (옵션, 0~N개) */ ],
  "evaluations":  [ /* 9개 평가 항목 (옵션, 1~9 중 일부만 보내도 OK) */ ],
  "report":       [ /* Pentagon 5축 + summary (옵션, 누락 시 서버 derive) */ ]
}
```

### 2-1. `call` (객체, 필수)

| 키 | 타입 | 필수 | 설명 |
|---|---|---|---|
| `id`         | string | ✅ | 콜 고유 ID. 테스트 단계는 `ext-YYYYMMDD-NNNN` 권장 |
| `cdate`      | string | ✅ | 통화 일시. ISO 8601 권장 (`2026-05-14T10:21:35+09:00`). `YYYY-MM-DD HH:MM:SS` 도 허용 |
| `role`       | string | ✅ | `PDS1` / `PDS2` / `PDS3` / `수동대인` / `인바운드` 중 1 |
| `department` | string |  | 생략 시 `컬렉션관리부`. 다른 값을 보내면 400 |
| `call_seq`   | string |  | 콜 일련번호. 생략 시 `id` 와 동일 |
| `uid`        | string |  | 세션/UID. 생략 시 `id` 와 동일 |

> `ai_score` / `total_score` 는 보내지 마세요 — 서버가 `evaluations` 의 점수 합산 + 직무 만점에서 백분율로 자동 산출합니다 (평가가 없으면 0).

### 2-2. `conversation` (배열, 옵션)

| 키 | 타입 | 필수 | 설명 |
|---|---|---|---|
| `turn_no` | int    |  | 발화 순서 (1부터). 생략 시 배열 순서대로 자동 부여 |
| `speaker` | string | ✅ | 문자열에 `'고객'` 포함 시 고객, 그 외는 모두 상담사로 정규화 |
| `text`    | string | ✅ | 발화 내용 |

배열을 통째로 생략하거나 빈 배열이면 STT 토글이 빈 상태로 표시됩니다.

### 2-3. `evaluations` (배열, 옵션 — 1~9 중 일부만 보내도 OK)

`order_no` 1~9 가 모두 와야 의미 있는 점수(`AI_SCORE` 등)가 나오지만, 1개만 와도 그 항목만 적재됩니다.
요청 자체를 통째로 생략하면 자식 테이블에 행이 들어가지 않습니다.

| 키 | 타입 | 필수 | 설명 |
|---|---|---|---|
| `order_no`        | int    | ✅ | 1~9 (아래 4-1 절 만점 매트릭스 표의 항목 번호) |
| `ai_eval`         | number | ✅ | AI 평가 점수. 0 ~ 해당 항목 만점 |
| `manual_eval`     | number |  | 수기 평가 점수. 생략/`null`/`""` 이면 `ai_eval` 과 동일. 9개 중 1건이라도 `ai_eval` 과 다르면 "수기 보정 있음"으로 간주 |
| `reason_text`     | string |  | 평가 사유. 생략 시 `(사유 미제공)` |
| `agent_utterance` | string |  | 항목과 매칭된 상담사 대표 발화. 생략 시 빈 문자열 |

### 2-4. `report` (배열, 옵션)

Pentagon 5축 + 종합 summary 평문 코멘트. 보내지 않으면 서버가 점수 구간에 따라 표준 라벨/코멘트로 자동 채웁니다(`evaluations` 가 9개 모두 와 있을 때).

| 키 | 타입 | 필수 | 설명 |
|---|---|---|---|
| `item_type_no` | int    | ✅ | 1~5 (5축) 또는 99 (summary) |
| `rating`       | string |  | 미지정 시 axis 점수 구간으로 derive (≥90 `우수`, ≥80 `보통`, ≥70 `주의`, 그 외 `실패`). `item_type_no=99` 행은 NULL |
| `comment`      | string |  | 분석 코멘트 평문 |
| `summary`      | string |  | `item_type_no=99` 에서만 사용. 종합 의견 |

---

## 3. 대시보드에 무엇이 보이는지 (필드별)

`call` 만 보내든 평가까지 보내든, 화면 어디에 어떤 필드가 반영되는지 정리:

| 화면 영역 | 필요한 입력 | 비고 |
|---|---|---|
| **콜 목록** — 부서 / 직무 / 콜번호 / 통화일시 | `call.id` / `call.cdate` / `call.role` | **최소 페이로드만으로도 표시** |
| 콜 목록 — AI 점수 / 최종 점수 | `evaluations[*].ai_eval` (+ 옵션 `manual_eval`) | 없으면 0 |
| 통화 상세 — 9개 평가항목 체크리스트 | `evaluations[*]` 의 각 행 | 부분 입력 시 보낸 항목만 표시 |
| 통화 상세 — Pentagon 5축 | `evaluations` 9개 모두 | 부분 입력 시 빈 축은 0 |
| 통화 상세 — 5축 코멘트 / summary | `evaluations` (서버 derive) 또는 `report` (외부 override) | |
| 통화 상세 — STT 토글 | `conversation` 배열 | 없으면 빈 상태 |

---

## 4. 직무별 만점 매트릭스 (참고)

평가항목 9개의 **만점은 직무에 따라 다르며**, 외부에서 보낼 필요 없습니다(서버가 `role` 값으로 자동 결정). 외부 점수(`ai_eval`, `manual_eval`)는 아래 범위 안의 숫자여야 합니다.

### 4-1. PDS1 만점

| order_no | 대분류         | 평가항목 (item) | PDS1 만점 |
|---------:|-----------------|---------------|---------:|
| 1 | 친절도          | 첫인사         | 3 |
| 2 | 친절도          | 본인 확인      | 4 |
| 3 | 친절도          | 종료 인사      | 3 |
| 4 | 친절도          | 음성           | 5 |
| 5 | 친절도          | 언어 표현      | 5 |
| 6 | 맞춤 응대 스킬  | 기반 형성      | 16 |
| 7 | 맞춤 응대 스킬  | 회수 스킬      | 20 |
| 8 | 업무 정확도     | 업무 정확도    | 20 |
| 9 | 사후 처리       | 이력 등록      | 10 |
|   |                 | **합계**       | **86** |

### 4-2. 직무별 만점 매트릭스

| order_no | item       | PDS1 | PDS2 | PDS3 | 수동대인 | 인바운드 |
|---------:|-----------|-----:|-----:|-----:|--------:|--------:|
| 1 | 첫인사       | 3 | 3 | 3 | 3 | 5 |
| 2 | 본인 확인     | 4 | 4 | 4 | 4 | 5 |
| 3 | 종료 인사     | 3 | 3 | 3 | 3 | 5 |
| 4 | 음성        | 5 | 4 | 4 | 4 | 5 |
| 5 | 언어 표현     | 5 | 3 | 10 | 10 | 10 |
| 6 | 기반 형성     | 16 | 20 | 10 | 10 | 20 |
| 7 | 회수 스킬     | 20 | 20 | 20 | 20 | 15 |
| 8 | 업무 정확도    | 20 | 20 | 20 | 20 | 15 |
| 9 | 이력 등록     | 10 | 10 | 10 | 10 | 10 |
| - | **합계**    | **86** | **87** | **84** | **84** | **90** |

> 5축 매핑: `1=인사·본인확인`(1,2,3) / `2=응대 화법·음성`(4,5) / `3=경청·공감 응대`(6,7) / `4=업무 정확도`(8) / `5=사후 처리`(9).

---

## 5. CSV 컬럼 명세

대량 적재 또는 사전 검토용. 1콜당 4개 파일로 분리하는 형태를 권장합니다.
**현재 ingest 엔드포인트는 JSON 만 받습니다.** CSV → JSON 변환은 외부에서 처리하거나, 별도 일괄 적재가 필요한 경우 사전에 협의해 주세요.

인코딩 **UTF-8 (BOM 없음)**, 구분자 **콤마(`,`)**. `text` / `reason_text` / `agent_utterance` 에 콤마·줄바꿈이 포함되면 큰따옴표(`"..."`)로 감싸 주세요.

### 5-1. `calls.csv` (최소 페이로드 = 이 파일 1개)

| 컬럼 | 필수 | 설명 |
|---|---|---|
| `call_id`    | ✅ | 콜 ID (JSON 의 `call.id`) |
| `cdate`      | ✅ | 통화 일시 (ISO 8601 권장) |
| `role`       | ✅ | PDS1 / PDS2 / PDS3 / 수동대인 / 인바운드 |
| `department` |  | 생략 시 `컬렉션관리부` |
| `call_seq`   |  | 콜 일련번호. 생략 시 `call_id` 와 동일 |

### 5-2. `conversations.csv`

| 컬럼 | 필수 | 설명 |
|---|---|---|
| `call_id` | ✅ | `calls.csv` 의 `call_id` 와 연결 |
| `turn_no` | ✅ | 발화 순서 (1부터) |
| `speaker` | ✅ | `상담사` 또는 `고객` |
| `text`    | ✅ | 발화 내용 |

### 5-3. `evaluations.csv`

| 컬럼 | 필수 | 설명 |
|---|---|---|
| `call_id`         | ✅ | 콜 ID |
| `order_no`        | ✅ | 1~9 (부분만 적어도 됨) |
| `ai_eval`         | ✅ | AI 점수 (0 ~ 해당 order 만점) |
| `manual_eval`     |  | 수기 점수. 빈 값이면 `ai_eval` 과 동일 처리 |
| `reason_text`     |  | 평가 사유 (빈 값 시 `(사유 미제공)`) |
| `agent_utterance` |  | 대표 발화 (빈 값 허용) |
| `item`            |  | 참고용 (서버는 만점 매트릭스 라벨로 덮어씀) |

### 5-4. `analysis_report.csv` (옵션)

| 컬럼 | 필수 | 설명 |
|---|---|---|
| `call_id`      | ✅ | 콜 ID |
| `item_type_no` | ✅ | 1~5 또는 99 |
| `rating`       |  | `우수` / `보통` / `주의` / `실패`. 99 행은 빈 값 |
| `comment`      |  | 분석 코멘트 |
| `summary`      |  | 99 행에서만 사용 |

---

## 6. 서버가 자동으로 채우는(derive) 값

외부가 보낼 필요 없는 값입니다.

| 값 | derive 방식 |
|---|---|
| `qa_calls.AI_SCORE`     | `Σ(ai_eval) / Σ(직무 만점) × 100`. evaluations 없으면 0 |
| `qa_calls.TOTAL_SCORE`  | 위와 동일. 9개 중 1건이라도 `manual_eval ≠ ai_eval` 이면 `manual_eval` 기준 |
| `qa_checklist_rows.validation_time` | `'배점 N'` (N = 해당 order 의 직무 만점) |
| `qa_checklist_rows.category` / `item` | 만점 매트릭스 표준 라벨 |
| `qa_analysis_report` (`report` 미전송 시) | 5축 점수 + 점수 구간에 따른 표준 라벨/코멘트/summary (evaluations 9개 모두 와 있을 때) |

---

## 7. 검증 / 거부 룰

다음 조건 중 하나라도 위반하면 400 응답으로 거부됩니다.

- `call.id` / `call.cdate` 누락
- `call.department` 가 `컬렉션관리부` 가 아님
- `call.role` 이 허용 5종이 아님
- `evaluations[*].ai_eval` / `manual_eval` 이 숫자가 아니거나 해당 항목 만점 범위 (0 ~ 만점) 밖

> `evaluations` / `conversation` / `report` 는 전부 옵션이므로 비우거나 부분만 보내도 거부되지 않습니다.

---

## 8. 화면 반영 흐름

1. 외부가 `POST /api/ingest/collection-call` 호출 → 적재 성공 응답.
2. 대시보드를 **새로고침** → `GET /api/calls` 가 신규 콜을 포함해 응답.
3. 콜 목록에서 해당 `call_id` 를 클릭하면 통화 상세 화면 진입.

> 신규 콜은 baseline 통계(당월평균/직무평균)에 자동으로 섞입니다. 통계에서 분리하려면 ID 를 `sample-` 접두로 보내세요 — 백엔드 `WHERE e."ID" NOT LIKE 'sample-%'` 필터에 자동 제외됩니다.

---

## 9. 예제 파일

`data/script/external_api_sample/` 하위:

| 파일 | 내용 |
|---|---|
| `sample-call-minimal.json` | **최소** 페이로드 — `call` 4필드만 |
| `sample-call.json`         | 풀 페이로드 — `call` + `conversation` + `evaluations` × 9 |
| `calls.csv`                | CSV — 콜 메타 1행 (최소 페이로드 대응) |
| `conversations.csv`        | CSV — STT 13행 |
| `evaluations.csv`          | CSV — 9개 평가 행 |
| `analysis_report.csv`      | CSV — Pentagon 5축 + summary (옵션 입력 예시) |

`sample-call.json` 의 9개 평가 점수 합 = 70 / 86 = **81.4점** (rating: `보통`).
