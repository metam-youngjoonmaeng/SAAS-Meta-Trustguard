# AI Agent Output API 파라미터 명세서

> **이 문서의 용도**: 외부 AI Agent 가 QA Dashboard 로 평가 결과를 반환할 때 사용할 **응답(Output) 형식 명세서**.
> Dashboard 측이 정의하여 Agent 측에 요청하는 "이대로 맞춰서 응답해달라" 는 스펙. Input(요청) 파라미터는 Agent 개발자가 정의하여 회신.
>
> 본 문서의 모든 필드는 [`DB_SCHEMA_FULL.md`](./DB_SCHEMA_FULL.md) §2 의 운영 데이터 테이블 컬럼과 1:1 매핑되며, §9 "매핑 검수" 표로 누락·잉여 없음을 검증한다.

---

## 0. 호출 구도

```
[ Dashboard 또는 외부 콜 수집기 ]
            │  ① 콜 1건 + 평가 기준 + 골든셋 (Few-shot) 전송  ← §A
            ▼
[ AI Agent API ]   ← Agent 측이 input 스펙 정의 (본 문서는 권장안 §A 제시)
            │
            │  내부:
            │    - 평가 기준(eval_criteria) 로드        ← §B.1
            │    - 골든셋(golden_set) few-shot 주입      ← §B.3
            │    - 발화 1개씩 점수·사유 추론             ← §B.2
            │    - 9 항목 점수 → Pentagon 5축 매핑·코멘트 ← §B.2
            │
            │  ② 평가 결과 응답 (본 문서가 정의)         ← §1~§9
            ▼
[ Dashboard 적재 파이프라인 ]
            │  ③ DB 테이블 8종에 매핑 적재
            ▼
[ PostgreSQL ]
```

- AI Agent 의 **Input(요청) 파라미터는 Agent 개발자가 정의**하여 회신 — 단, Dashboard 가 권장하는 형태는 **§A** 에 제시.
- AI Agent 의 **Output(응답) 파라미터는 본 문서 §1~§9 에 따라 반환**.
- 한 응답은 콜 1건의 평가 결과. 부서(`department`) 에 따라 채워야 할 필드 집합이 다르다.

---

## §A. Input 페이로드 (Dashboard → Agent, 권장안)

> Agent 가 평가를 정확히 하려면 **콜 메타 + STT + 평가 기준 + 골든셋** 4종이 같이 들어와야 한다.
> Agent 개발자가 Input 스펙을 확정하기 전까지 Dashboard 가 권장하는 형태.

### §A.1 컬렉션관리부 PDS1 — 풀 페이로드

```jsonc
{
  "qa_id": "ext-20260601-0001",
  "department": "컬렉션관리부",
  "role": "PDS1",

  // ── 콜 메타 (qa_calls 의 원본 메타. Output 에 그대로 echo) ──
  "call_meta": {
    "call_datetime": "2026-06-01T10:21:35+09:00",  // qa_calls.CDATE
    "call_seq":      "SH-20260601-0001",            // qa_calls.CALL_SEQ
    "uid":           "ext-20260601-0001",           // qa_calls.UID
    "org_id":        1                              // 신한 (qa_calls.org_id)
  },

  // ── STT (둘 중 하나) ──
  "stt": [                                          // 이미 STT 가 있을 때
    { "turn_no": 1, "speaker": "상담사", "text": "안녕하세요 컬렉션관리부 김상담입니다." },
    { "turn_no": 2, "speaker": "고객",   "text": "네." }
    // ...
  ],
  // 또는:
  // "audio_url": "https://.../call.wav"             // Agent 가 STT 책임지는 경우

  // ── 평가 기준 (eval_item_defs 에서 추출. order_no 별) ──
  "eval_criteria": [
    {
      "order_no":        1,
      "category":        "친절도",
      "item":            "첫인사",
      "max_score":       3,                          // PDS1 만점 매트릭스
      "criterion":       "오프닝에 부서·이름·인사말을 명시",
      "prompt_template": "다음 발화를 0~3점으로 평가하라. ..."
    }
    // ... order_no 2 ~ 9
  ],

  // ── Pentagon 5축 정의 (pentagon_axes 에서 추출) ──
  "pentagon_axes": [
    {
      "axis_no":         1,
      "label":           "인사·본인확인",
      "description":     "오프닝/본인확인/종료 인사 전반",
      "prompt_template": "9 항목 중 1·2·3 점수를 받아 코멘트 생성."
    }
    // ... axis_no 2 ~ 5
  ],

  // ── 골든셋 (qa_golden_set 에서 order_no 별 N건 펼침) ──
  "golden_set": [
    // order_no 1 (첫인사) — 고/저 점수 섞어서
    { "order_no": 1, "agent_utterance": "안녕하세요 컬렉션관리부 김상담입니다.", "score": 3, "reason_text": "부서·이름·인사 모두 명시." },
    { "order_no": 1, "agent_utterance": "여보세요?",                          "score": 0, "reason_text": "부서·이름 누락." },
    // order_no 7 (회수 스킬) — 만점/중간 예시
    { "order_no": 7, "agent_utterance": "고객님 사정 이해됩니다. 분납 어떠세요?", "score": 20, "reason_text": "협상 스킬 우수." }
    // ...
  ]
}
```

### §A.2 소비자보호부 — 추가로 들어가는 항목

소비자보호부 콜은 위 페이로드에 **금칙어 사전 + 12 카테고리 정의** 추가:

```jsonc
{
  "qa_id": "ext-20260601-0002",
  "department": "소비자보호부",
  "role": "전체",
  "call_meta": { /* 동일 */ },
  "stt": [ /* 동일 */ ],

  // ── 소비자보호부 20 항목 정의 (qa_consumer_eval_rows 의 item_no 1~20) ──
  "consumer_criteria": [
    { "item_no": 1, "major_category": "1. 금소법준수여부", "criterion": "고지의 의무", "item_text": "..." }
    // ... 20개
  ],

  // ── 금칙어 사전 (금칙어.csv 마스터) ──
  "keyword_dict": [
    { "level": "Level 1 - 최고위험", "major_category": "법적 리스크", "sub_category": "형사처벌 협박", "keywords": ["감옥", "고발", "...", ...] }
    // ... 8 level × N 카테고리
  ],

  // ── 12 카테고리 정의 (qa_consumer_ai_categories.category_no 1~12 마스터) ──
  "ai_category_defs": [
    { "category_no": 1, "major_category": "1. 리스크 관리", "sub_category": "A. 법적 리스크 감지", "prompt_template": "..." }
    // ... 12개
  ]
}
```

### §A.3 Input 출처 — Dashboard 가 어디서 가져오나

| Input 필드 | DB 출처 | 의미 |
|---|---|---|
| `qa_id`, `call_meta.*` | `qa_calls` | 콜 메타 (Output 매칭 키 + DB 적재) |
| `stt[]` | `qa_conversations` (이미 적재된 경우) | 평가 근거 텍스트 |
| `eval_criteria[]` | `eval_item_defs` WHERE `org_id` & `department` & `is_active=true` | 항목별 만점·기준·프롬프트 |
| `pentagon_axes[]` | `pentagon_axes` WHERE `org_id` & `department` & `is_active=true` | 5축 정의 |
| `golden_set[]` | `qa_golden_set` WHERE `org_id` & `category`/`item` | Few-shot 예시 (Agent 정확도 ↑) |
| `consumer_criteria[]` | `qa_consumer_eval_rows` 의 20 항목 마스터 (DB_SCHEMA_FULL.md §2.6) | 소비자보호부 |
| `keyword_dict[]` | `금칙어.csv` (외부 마스터) | 소비자보호부 |
| `ai_category_defs[]` | 12 카테고리 마스터 (DB_SCHEMA_FULL.md §2.8) | 소비자보호부 |

---

## §B. Agent 활용 패턴 (핵심 로직)

> Agent 가 받은 Input 을 어떻게 LLM 호출로 풀어내는지의 권장 패턴.

### §B.1 컬렉션관리부 — 9 항목 채점 (체크리스트)

**순서**:

```
for order_no in 1..9:
    1. eval_criteria[order_no] 로 평가 기준·만점·프롬프트 로드
    2. golden_set 에서 order_no 일치하는 예시 N건 (고/중/저 섞어서) 추출
    3. STT 에서 해당 order 의 평가 대상 발화 추출
       (order 1~5 는 보통 첫 몇 turn, 6~9 는 본문/말미)
    4. 프롬프트 조립:
         [평가 기준] criterion + max_score
         [Few-shot 예시] golden_set 추출분 (발화 → 점수+사유)
         [평가 대상] 추출된 상담사 발화
         "→ 점수와 사유를 JSON 으로 출력"
    5. LLM 호출 → 점수·사유 파싱
    6. evaluations[] 에 push
```

**조립 예시 (order_no=1 첫인사)**:

```
[평가 기준]
- 항목: 첫인사 (만점 3점)
- 기준: 오프닝에 부서·이름·인사말을 명시했는가?

[Few-shot 예시]
- 발화: "안녕하세요 컬렉션관리부 김상담입니다."
  점수: 3 / 사유: 부서·이름·인사 모두 명시
- 발화: "여보세요?"
  점수: 0 / 사유: 부서·이름 누락

[평가 대상]
- 발화: "{이번 콜의 첫 발화}"

→ {"ai_eval": N, "reason_text": "...", "agent_utterance": "..."} 형식으로 출력
```

### §B.2 Pentagon 5축 derive (다이어그램)

**순서**:

```
1. evaluations 9개의 ai_eval / max_score 비율 계산
2. Pentagon 매핑표대로 축 점수 산출:
   axis 1 (인사·본인확인)   = (eval[1] + eval[2] + eval[3]) / (max[1]+max[2]+max[3]) × 100
   axis 2 (응대 화법·음성)   = (eval[4] + eval[5]) / (max[4]+max[5]) × 100
   axis 3 (경청·공감 응대)   = (eval[6] + eval[7]) / (max[6]+max[7]) × 100
   axis 4 (업무 정확도)      = eval[8] / max[8] × 100
   axis 5 (사후 처리)        = eval[9] / max[9] × 100

3. 축별 rating derive:
   ≥90 우수 / ≥80 보통 / ≥70 주의 / 그 외 실패

4. 축별 comment 생성:
   pentagon_axes[axis_no].prompt_template + 해당 evaluations 의 reason_text 종합
   → LLM 한 번 호출로 5개 comment 생성

5. summary (item_type_no=99) 생성:
   전체 evaluations + 5축 코멘트 종합 → LLM 한 번 더 호출

6. pentagon[] 에 6 row push (1~5 + 99)
```

> `rating` 은 Agent 가 직접 보낼 수도 있고, 미전송 시 서버가 점수 구간으로 derive (§8 참조).

### §B.3 골든셋 참조 로직 (Few-shot 주입)

**§A 에서 받은 `golden_set[]` 활용법**:

```
1. order_no 별로 그룹화:
     by_order = group_by(golden_set, key="order_no")

2. 각 order 마다:
   - 점수 분포가 골고루 (예: max/mid/0 점) 인 예시 3건 추리기
   - 너무 많으면 token 부담, 너무 적으면 정확도 ↓

3. 프롬프트 조립 시:
     "[Few-shot 예시]"
     for ex in by_order[order_no]:
         f"- 발화: \"{ex.agent_utterance}\"\n  점수: {ex.score} / 사유: {ex.reason_text}"
```

**Dashboard 측 골든셋 SQL 예시** (Agent 호출 직전에 실행):

```sql
SELECT g.order_no, g.agent_utterance, g.score, g.reason_text
FROM qa_golden_set g
WHERE g.org_id = :org_id                -- 신한=1
  AND g.category = :category            -- 예: '친절도'
  AND g.item     = :item                -- 예: '첫인사'
ORDER BY g.created_at DESC
LIMIT :k_per_item;                       -- 보통 order 당 3~5건
```

> 등록자(검수자)는 본문 컬럼이 아니라 `qa_calls.user_id` JOIN 으로 추적 (14 마이그레이션 후 정규화). Agent Input 에는 등록자 정보 불필요 — 점수·사유·발화만 충분.

### §B.4 소비자보호부 — 20 항목 + 금칙어 + 12 카테고리

**순서**:

```
1. 20 항목 Y/N 채점:
   for item_no in 1..20:
       - consumer_criteria[item_no].criterion 로드
       - STT 전체에서 근거 발화 탐색
       - LLM 호출 → Y/N + detail_text + evidence_line_no
   → consumer_eval[] 에 20 row push

2. 금칙어 감지:
   - keyword_dict 의 모든 4-튜플 (level, major_category, sub_category, keyword) 순회
   - STT 의 모든 turn 에 대해 keyword 포함 여부 검사
   - 감지 시 keywords[] 에 push (line_no, line_text 포함)
   - 미감지 시 빈 배열

3. 12 카테고리 적합도 (0~100):
   for category_no in 1..12:
       - ai_category_defs[category_no].prompt_template 로드
       - STT 전체 + Y/N 결과 + 금칙어 결과 종합
       - LLM 호출 → 0~100 점수
   → ai_categories[] 에 12 row push

4. AI 분석대상 판정 (ai_analysis):
   - 통화길이, 금칙어 감지 수, Y/N 패턴 등으로 'O'/'X' 결정
   - target + reason 생성
   - voc_code / promotion_code 는 Input 의 call_meta 에서 echo
```

---

## §C. 책임 분담 매트릭스 — Agent 가 만들어야 하는 것 vs Dashboard 가 만드는 것

> **이 섹션이 본 문서의 핵심.** "Agent 가 절대적으로 만들어야 하는 것" 만 추려서 정리.
> 우리(Dashboard)가 만들 수 있는 건 Agent 가 보낼 필요 없음 — 응답 페이로드를 가볍게 유지.

### §C.0 분류 기호

| 기호 | 의미 |
|----|----|
| 🤖 **Agent 필수** | Agent 만이 만들 수 있음. 응답에 반드시 포함 |
| 🟡 **Agent 선택** | Agent 가 보내면 그대로 사용, 안 보내면 서버 derive |
| 📋 **Dashboard 제공** | Input 으로 Agent 에 전달 (Agent 가 받기만 함, 응답엔 포함 X) |
| ⚙️ **서버 derive** | Dashboard 가 DB 적재 시 자동 계산 (Agent 도 Dashboard 도 안 만듦) |
| 👤 **사람 입력** | 검수자가 화면에서 채움 (Agent 영역 외) |

---

### §C.1 핵심 로직 3가지 — Agent 가 반드시 해야 할 일

| # | 로직 | Agent 가 만드는 결과물 (Output) |
|---:|---|---|
| 1 | **체크리스트 채점** (컬렉션 9 항목 / 소비자 20 항목) | 항목별 점수 + 사유 + 평가한 발화 인용 |
| 2 | **Pentagon 5축 코멘트** (컬렉션만, 다이어그램용) | 축별 코멘트 + 종합 의견(summary) |
| 3 | **골든셋 Few-shot 활용** (Input 으로 받음) | 응답 결과의 정확도/일관성 ↑ — 별도 출력 없음 |

> 골든셋(qa_golden_set)은 **Input 으로 받기만** 함. Agent 가 응답으로 돌려보내지 않음. Dashboard 가 검수자 클릭 시 별도 API 로 적재.

---

### §C.2 컬렉션관리부 — Input (Dashboard → Agent)

| 필드 (한국어) | 타입 | 책임 | 비고 |
|---|---|---|---|
| `qa_id` (콜 ID) | string | 📋 Dashboard 제공 | Output 에 그대로 echo |
| `department` (부서) | string | 📋 Dashboard 제공 | `"컬렉션관리부"` 고정 |
| `role` (직무) | string | 📋 Dashboard 제공 | `"PDS1"` 등. 만점 매트릭스 결정 |
| `call_meta.call_datetime` (통화 일시) | string | 📋 Dashboard 제공 | `qa_calls.CDATE` |
| `call_meta.call_seq` (콜 일련번호) | string | 📋 Dashboard 제공 | `qa_calls.CALL_SEQ` |
| `call_meta.uid` (세션 UID) | string | 📋 Dashboard 제공 | `qa_calls.UID` |
| `call_meta.org_id` (브랜드 ID) | int | 📋 Dashboard 제공 | 신한=1 |
| `stt[]` (STT 전사) | array | 📋 Dashboard 제공 | 이미 있을 때. 없으면 `audio_url` |
| `eval_criteria[]` (평가 기준) | array | 📋 Dashboard 제공 | 항목별 만점·기준·프롬프트 (`eval_item_defs` 에서 추출) |
| `pentagon_axes[]` (5축 정의) | array | 📋 Dashboard 제공 | 축별 라벨·설명·프롬프트 (`pentagon_axes` 에서 추출) |
| `golden_set[]` (골든셋 Few-shot) | array | 📋 Dashboard 제공 | `qa_golden_set` 펼침. order_no 별 고/중/저 점수 예시 |

> 즉 **Agent 는 입력으로 위 11개를 받기만** 하면 됨. Input 스펙은 Agent 개발자가 확정.

---

### §C.3 컬렉션관리부 — Output (Agent → Dashboard)

#### §C.3.1 envelope (공통, 콜 식별)

| 필드 (한국어) | 타입 | 책임 | 비고 |
|---|---|---|---|
| `schema_version` (스키마 버전) | string | 🤖 Agent 필수 | `"1.0"` 고정 |
| `qa_id` (콜 ID) | string | 🤖 Agent 필수 | Input echo |
| `department` (부서) | string | 🤖 Agent 필수 | Input echo |
| `role` (직무) | string | 🤖 Agent 필수 | Input echo |
| `evaluated_at` (평가 완료 시각) | string | 🟡 Agent 선택 | ISO 8601, 감사 로그용 |
| `model_meta` (모델 메타) | object | 🟡 Agent 선택 | `{model_name, model_version}` |

#### §C.3.2 evaluations[] — 9 항목 채점 (정확히 9 row)

| 필드 (한국어) | 타입 | 책임 | 비고 |
|---|---|---|---|
| `order_no` (항목 순서) | int | 🤖 Agent 필수 | 1~9 |
| `ai_eval` (AI 평가 점수) | number | 🤖 Agent 필수 | 0 ≤ 값 ≤ 직무 만점 |
| `reason_text` (평가 사유) | string | 🤖 Agent 필수 | 빈 값 시 서버가 `"(사유 미제공)"` 채움 |
| `agent_utterance` (평가한 발화 인용) | string | 🤖 Agent 필수 | 항목별 대표 발화 |
| `category` (대분류) | — | ⚙️ 서버 derive | `order_no` 매핑 |
| `item` (항목명) | — | ⚙️ 서버 derive | `order_no` 매핑 |
| `validation_time` (배점 표기) | — | ⚙️ 서버 derive | `'배점 N'`, N = 직무 만점 |
| `manual_eval` (수기 평가 점수) | — | 👤 사람 입력 | 검수자가 화면에서 채움 |

#### §C.3.3 pentagon[] — Pentagon 5축 (정확히 6 row, item_type_no 1~5 + 99)

| 필드 (한국어) | 타입 | 책임 | 비고 |
|---|---|---|---|
| `item_type_no` (축 번호) | int | 🤖 Agent 필수 | 1·2·3·4·5·99 |
| `item_type` (축 라벨) | string | 🤖 Agent 필수 | 고정 6 라벨 중 1 |
| `comment` (축별 코멘트) | string | 🤖 Agent 필수 | 빈 문자열 허용 |
| `summary` (종합 의견) | string | 🤖 Agent 필수 | **`item_type_no=99` 에서만** |
| `rating` (등급) | string | 🟡 Agent 선택 | `우수`/`보통`/`주의`/`실패`. 미전송 시 서버가 점수 구간으로 derive |

#### §C.3.4 콜 메타 — 응답에 포함되지 않음

| 필드 (한국어) | 책임 | 이유 |
|---|---|---|
| `qa_calls.CALL_SEQ` / `CDATE` / `UID` / `org_id` / `is_sandbox` | 📋 Dashboard 제공 | Input 의 `call_meta` 그대로 적재 |
| `qa_calls.user_id` (검수자) | 👤 사람 입력 | 검수 시작 시 채워짐 |
| `qa_calls.review_status` / `review_started_at` / `review_completed_at` | ⚙️ 서버 derive | 검수 워크플로우 |
| `qa_calls.AI_SCORE` (AI 평가 총점) | ⚙️ 서버 derive | `Σ(ai_eval)/Σ(만점)×100` |
| `qa_calls.TOTAL_SCORE` (최종 총점) | ⚙️ 서버 derive | 수기 보정 반영 |

---

### §C.4 컬렉션관리부 — Output 미니멈 JSON (Agent 가 만들 것만)

```jsonc
{
  "schema_version": "1.0",                                       // 🤖
  "qa_id": "ext-20260601-0001",                                   // 🤖 (Input echo)
  "department": "컬렉션관리부",                                    // 🤖 (Input echo)
  "role": "PDS1",                                                 // 🤖 (Input echo)
  "evaluated_at": "2026-06-01T14:00:00+09:00",                   // 🟡

  "collection_track": {
    "evaluations": [                                              // 🤖 9 row
      { "order_no": 1, "ai_eval": 3,  "reason_text": "오프닝 인사 정상.",         "agent_utterance": "안녕하세요 컬렉션관리부 김상담입니다." },
      { "order_no": 2, "ai_eval": 4,  "reason_text": "본인 확인 명확.",          "agent_utterance": "본인 확인을 위해 생년월일 부탁드립니다." },
      { "order_no": 3, "ai_eval": 3,  "reason_text": "종료 인사 명확.",          "agent_utterance": "이용해주셔서 감사합니다." },
      { "order_no": 4, "ai_eval": 5,  "reason_text": "발음 명료.",              "agent_utterance": "" },
      { "order_no": 5, "ai_eval": 4,  "reason_text": "공손한 표현.",            "agent_utterance": "" },
      { "order_no": 6, "ai_eval": 12, "reason_text": "라포 형성 보통.",         "agent_utterance": "" },
      { "order_no": 7, "ai_eval": 14, "reason_text": "회수 스킬 부분 미흡.",    "agent_utterance": "" },
      { "order_no": 8, "ai_eval": 17, "reason_text": "업무 안내 정확.",         "agent_utterance": "" },
      { "order_no": 9, "ai_eval": 8,  "reason_text": "이력 등록 일부 누락.",    "agent_utterance": "" }
    ],
    "pentagon": [                                                 // 🤖 6 row
      { "item_type_no": 1,  "item_type": "인사·본인확인", "comment": "본인 확인 명확함." },
      { "item_type_no": 2,  "item_type": "응대 화법·음성", "comment": "발음·표현 양호." },
      { "item_type_no": 3,  "item_type": "경청·공감 응대", "comment": "라포 형성 보완 필요." },
      { "item_type_no": 4,  "item_type": "업무 정확도",   "comment": "업무 안내 정확." },
      { "item_type_no": 5,  "item_type": "사후 처리",     "comment": "이력 등록 일부 누락." },
      { "item_type_no": 99, "item_type": "summary", "comment": "", "summary": "전반적 양호. 회수 스킬·이력 등록 보완 필요." }
    ]
  }
}
```

> 이게 **Agent 가 보내야 할 최소 페이로드**. `rating`/`AI_SCORE`/`TOTAL_SCORE`/`category`/`item`/`validation_time`/`manual_eval` 은 서버가 알아서 채움.

---

### §C.5 소비자보호부 — Input (Dashboard → Agent)

§C.2 의 컬렉션 Input 에 **추가로** 다음 3종이 들어옴:

| 필드 (한국어) | 타입 | 책임 | 비고 |
|---|---|---|---|
| `consumer_criteria[]` (20 항목 정의) | array | 📋 Dashboard 제공 | `qa_consumer_eval_rows` 의 20 항목 마스터 (item_no 1~20) |
| `keyword_dict[]` (금칙어 사전) | array | 📋 Dashboard 제공 | `금칙어.csv` 마스터. 4-튜플 (level/major_category/sub_category/keywords[]) |
| `ai_category_defs[]` (12 카테고리 정의) | array | 📋 Dashboard 제공 | 12 카테고리 마스터 + 축별 프롬프트 |

> `eval_criteria` / `pentagon_axes` / `golden_set` 은 소비자보호부에서 미사용 (트랙이 다름).

---

### §C.6 소비자보호부 — Output (Agent → Dashboard)

#### §C.6.1 ai_analysis — AI 분석대상 판정

| 필드 (한국어) | 타입 | 책임 | 비고 |
|---|---|---|---|
| `target` (분석대상 O/X) | string | 🤖 Agent 필수 | 통화길이·금칙어·Y/N 패턴 종합 판단 |
| `reason` (판정 사유) | string | 🤖 Agent 필수 | 선정/제외 근거 |
| `voc_code` (VOC 코드) | string | 📋 Dashboard 제공 | Input echo |
| `promotion_code` (판촉 코드) | string | 📋 Dashboard 제공 | Input echo |

#### §C.6.2 consumer_eval[] — 20 항목 Y/N (정확히 20 row)

| 필드 (한국어) | 타입 | 책임 | 비고 |
|---|---|---|---|
| `item_no` (항목 번호) | int | 🤖 Agent 필수 | 1~20 (모두) |
| `yn` (준수 여부) | string | 🤖 Agent 필수 | `'Y'`/`'N'` |
| `detail_text` (위반 사유) | string | 🟡 Agent 선택 | `yn='N'` 시 권장 |
| `evidence_line_no` (근거 turn) | int | 🤖 Agent 필수 | `qa_conversations.turn_no` |
| `evidence_text` (근거 발화) | string | 🤖 Agent 필수 | 근거 발화 원문 |
| `major_category` (대분류) | — | ⚙️ 서버 derive | `item_no` 고정 매핑 |
| `sub_no` (대분류 내 번호) | — | ⚙️ 서버 derive | `item_no` 고정 매핑 |
| `criterion` (평가 기준) | — | ⚙️ 서버 derive | `item_no` 고정 매핑 |
| `item_text` (항목 전문) | — | ⚙️ 서버 derive | `item_no` 고정 매핑 |

#### §C.6.3 keywords[] — 금칙어 감지 (0~N row, 미감지면 빈 배열)

| 필드 (한국어) | 타입 | 책임 | 비고 |
|---|---|---|---|
| `level` (위험 등급) | string | 🤖 Agent 필수 | 8종 허용값 중 1 (`keyword_dict` 사전과 일치) |
| `major_category` (대분류) | string | 🤖 Agent 필수 | 사전 일치 |
| `sub_category` (세부 카테고리) | string | 🤖 Agent 필수 | 사전 일치 |
| `keyword` (감지 단어) | string | 🤖 Agent 필수 | 발화에서 감지한 원문 |
| `line_no` (감지 turn) | int | 🤖 Agent 필수 | `qa_conversations.turn_no` |
| `line_text` (발화 컨텍스트) | string | 🤖 Agent 필수 | 발화 원문 |

#### §C.6.4 ai_categories[] — 12 카테고리 적합도 (정확히 12 row)

| 필드 (한국어) | 타입 | 책임 | 비고 |
|---|---|---|---|
| `category_no` (카테고리 번호) | int | 🤖 Agent 필수 | 1~12 (모두) |
| `score` (적합도 점수) | number | 🤖 Agent 필수 | 0~100, 소수점 2자리 |
| `major_category` (대분류) | — | ⚙️ 서버 derive | `category_no` 고정 매핑 |
| `sub_category` (소분류) | — | ⚙️ 서버 derive | `category_no` 고정 매핑 |

---

### §C.7 소비자보호부 — Output 미니멈 JSON (Agent 가 만들 것만)

```jsonc
{
  "schema_version": "1.0",                                       // 🤖
  "qa_id": "ext-20260601-0002",                                   // 🤖 (Input echo)
  "department": "소비자보호부",                                    // 🤖 (Input echo)
  "role": "전체",                                                 // 🤖 (Input echo)
  "evaluated_at": "2026-06-01T14:05:00+09:00",                   // 🟡

  "consumer_track": {
    "ai_analysis": {
      "target": "O",                                              // 🤖
      "reason": "통화길이 90초 이상 & 금칙어 1건 감지",            // 🤖
      "voc_code": "V123",                                         // 📋 (Input echo)
      "promotion_code": "P456"                                    // 📋 (Input echo)
    },
    "consumer_eval": [                                            // 🤖 20 row
      { "item_no": 1,  "yn": "Y", "evidence_line_no": 1,  "evidence_text": "..." },
      { "item_no": 2,  "yn": "Y", "evidence_line_no": 3,  "evidence_text": "..." },
      { "item_no": 3,  "yn": "N", "detail_text": "고객 이해 부족에도 가입 진행", "evidence_line_no": 14, "evidence_text": "..." }
      // ... 4~20
    ],
    "keywords": [                                                 // 🤖 0~N row
      { "level": "Level 1 - 최고위험", "major_category": "법적 리스크", "sub_category": "형사처벌 협박", "keyword": "감옥", "line_no": 12, "line_text": "이 건 처리 안 되면 감옥 갈 수도 있어요." }
    ],
    "ai_categories": [                                            // 🤖 12 row
      { "category_no": 1,  "score": 85.50 },
      { "category_no": 2,  "score": 60.00 }
      // ... 3~12
    ]
  }
}
```

---

### §C.8 STT — 어디에 속하나

| 시나리오 | 책임 |
|---|---|
| Dashboard 에 이미 STT 가 있는 경우 | 📋 Dashboard 가 Input 의 `stt[]` 로 제공. Agent 는 응답에 포함 X |
| Agent 가 STT 도 책임지는 경우 | 🤖 Agent 가 응답 `stt[]` 에 포함 (`turn_no`/`speaker`/`text`) |

→ Agent 개발자가 §10 Open Q #1 (STT 책임 주체) 에서 결정.

---

### §C.9 "Agent 가 절대 만들 수 없는 것" — 응답에 포함 금지

| 항목 (한국어) | 누가 만드나 | 왜 |
|---|---|---|
| `qa_calls.AI_SCORE` (AI 총점) | ⚙️ 서버 | `evaluations[].ai_eval` 합으로 자동 계산 |
| `qa_calls.TOTAL_SCORE` (최종 총점) | ⚙️ 서버 | 수기 보정 반영 |
| `qa_calls.user_id` (검수자) | 👤 사람 | 검수자가 화면 진입 시 박힘 |
| `qa_calls.review_status` (검수 상태) | ⚙️ 서버 | 워크플로우 상태 머신 |
| `qa_calls.review_started_at` / `review_completed_at` (검수 시각) | ⚙️ 서버 | 워크플로우 |
| `qa_calls.is_sandbox` (샌드박스 플래그) | ⚙️ 서버 | ingest 시점 분기 |
| `qa_checklist_rows.category` / `item` / `validation_time` | ⚙️ 서버 | `order_no` + 직무 만점 매트릭스로 derive |
| `qa_evaluation_rows.category` / `item` | ⚙️ 서버 | `order_no` 매핑 |
| `qa_evaluation_rows.manual_eval` (수기 점수) | 👤 사람 | 검수자가 화면에서 채움. 초기값은 `ai_eval` |
| `qa_consumer_eval_rows.major_category` / `sub_no` / `criterion` / `item_text` | ⚙️ 서버 | `item_no` 1~20 고정 매핑 |
| `qa_consumer_ai_categories.major_category` / `sub_category` | ⚙️ 서버 | `category_no` 1~12 고정 매핑 |
| `qa_audit_logs.*` (감사 로그) | ⚙️ 서버 | Dashboard 가 모든 API 호출에 자동 기록 |
| `eval_item_change_log` / `pentagon_axis_change_log` (변경 이력) | 👤 사람 + ⚙️ 서버 | 관리자 화면에서 편집 시 자동 기록 |
| `qa_golden_set` (골든셋) | 👤 사람 + ⚙️ 서버 | 검수자 클릭 시 별도 API 적재. **Agent 응답엔 미포함** |
| `qa_calls.CALL_SEQ` / `CDATE` / `UID` / `org_id` | 📋 Dashboard | Input 으로 받아서 echo 만, 응답에 별도 필드 만들 필요 X |

> 위 항목들이 Agent 응답에 들어오면 **무시 또는 덮어쓰기** 됨.

---

### §C.10 한눈에 보는 책임 요약

| 카테고리 | Agent 의 일 (🤖) | Dashboard 의 일 (📋⚙️👤) |
|---|---|---|
| **STT 텍스트** | (옵션) STT 생성 | STT 이미 있으면 Input 으로 제공 |
| **평가 기준** | — | `eval_item_defs` 에서 추출해 Input 으로 제공 |
| **골든셋 (Few-shot)** | — | `qa_golden_set` 에서 펼쳐서 Input 으로 제공 |
| **9 항목 채점** (`evaluations[]`) | **🤖 점수 + 사유 + 발화 인용** | 카테고리/항목명/배점은 서버 derive |
| **Pentagon 5축** (`pentagon[]`) | **🤖 축별 코멘트 + 종합 의견** | rating 은 미전송 시 서버 derive |
| **20 항목 Y/N** (`consumer_eval[]`) | **🤖 Y/N + 근거 turn/발화** | 대분류/criterion/item_text 는 서버 derive |
| **금칙어 감지** (`keywords[]`) | **🤖 사전과 일치하는 4-튜플 감지 + 위치** | 사전 자체는 Input 으로 제공 |
| **12 카테고리 적합도** (`ai_categories[]`) | **🤖 0~100 점수** | 카테고리 라벨은 서버 derive |
| **AI 분석대상 판정** (`ai_analysis`) | **🤖 O/X + 사유** | voc_code/promotion_code 는 Input echo |
| **총점** (`AI_SCORE`/`TOTAL_SCORE`) | — | ⚙️ 서버가 `ai_eval` 합으로 자동 계산 |
| **수기 점수** (`manual_eval`) | — | 👤 검수자가 화면에서 채움 |
| **검수 상태** (`review_status`) | — | ⚙️ 서버 워크플로우 |
| **감사 로그** (`qa_audit_logs`) | — | ⚙️ 서버가 모든 API 자동 기록 |
| **변경 이력** (`*_change_log`) | — | 👤+⚙️ 관리자 편집 시 자동 |

---

## 1. 응답 envelope (공통)

```jsonc
{
  "schema_version": "1.0",          // 본 문서 버전. 향후 호환성용
  "qa_id": "ext-20260601-0001",     // qa_calls.ID 와 일치. Dashboard 가 매칭 키로 사용
  "department": "컬렉션관리부",       // 평가 대상 부서. CHECK 허용 4종 중 1
  "role": "PDS1",                    // CHECK 허용 6종 중 1
  "evaluated_at": "2026-06-01T14:00:00+09:00", // Agent 가 평가를 마친 시점 (ISO 8601)
  "model_meta": {                    // 옵션. 감사/추적용
    "model_name": "qa-eval-v1",
    "model_version": "2026.06.01"
  },

  // 부서별 트랙 — 둘 중 정확히 하나만 채움
  "collection_track": { /* §2 — 컬렉션관리부일 때 */ },
  "consumer_track":   { /* §3 — 소비자보호부일 때 */ },

  // STT (옵션 — Agent 가 STT까지 책임지는 경우에만)
  "stt": [ /* §4 */ ]
}
```

### envelope 검증 규칙

| 필드 | 필수 | 검증 |
|----|:--:|----|
| `schema_version`    | ✅ | 문자열 `"1.0"` (현재) |
| `qa_id`             | ✅ | 비어있지 않은 문자열 |
| `department`        | ✅ | `'컬렉션관리부'` / `'소비자보호부'` / `'고객센터'` / `'고객지원실'` 중 1 |
| `role`              | ✅ | `'PDS1'` / `'PDS2'` / `'PDS3'` / `'수동대인'` / `'인바운드'` / `'전체'` 중 1. 소비자보호부면 `'전체'` |
| `evaluated_at`      | ⭕ | ISO 8601 |
| `collection_track`  | 부서 의존 | `department` 가 `'컬렉션관리부'` / `'고객센터'` / `'고객지원실'` 일 때 필수 |
| `consumer_track`    | 부서 의존 | `department` 가 `'소비자보호부'` 일 때 필수 |
| `stt`               | ⭕ | Agent 가 STT 결과를 함께 반환할 때만 |

---

## 2. `collection_track` — 컬렉션관리부 응답 본문

> 9 항목 점수 + Pentagon 5축 코멘트. 한·지역정보 브랜드도 본 트랙을 따른다.

```jsonc
{
  "evaluations": [           // 9 항목 (order_no 1~9)
    {
      "order_no": 1,
      "ai_eval":  3.0,
      "reason_text": "오프닝 인사를 정상적으로 수행함.",
      "agent_utterance": "안녕하세요 컬렉션관리부 김상담입니다."
    },
    // ... order_no 2 ~ 9
  ],
  "pentagon": [              // 5축 + summary (총 6 row)
    {
      "item_type_no": 1,
      "item_type":    "인사·본인확인",
      "rating":       "보통",     // 옵션. 미전송 시 서버 derive
      "comment":      "본인 확인 절차가 명확함."
    },
    // ... item_type_no 2 ~ 5
    {
      "item_type_no": 99,
      "item_type":    "summary",
      "rating":       null,
      "comment":      "",
      "summary":      "전반적으로 양호하나 회수 스킬 보완 필요."
    }
  ]
}
```

### 2.1 `evaluations[*]` (배열, 길이 1~9)

| 키 | 타입 | 필수 | 매핑 | 검증 |
|----|----|:--:|----|----|
| `order_no`        | int    | ✅ | `qa_evaluation_rows.order_no` / `qa_checklist_rows.order_no` | 1~9 |
| `ai_eval`         | number | ✅ | `qa_evaluation_rows.ai_eval` | 0 ≤ 값 ≤ 직무 만점 (아래 표) |
| `reason_text`     | string | ⭕ | `qa_evaluation_rows.reason_text` | 빈 값 시 서버가 `'(사유 미제공)'` 채움 |
| `agent_utterance` | string | ⭕ | `qa_checklist_rows.agent_utterance` | 빈 값 허용 |

**직무별 만점 (ai_eval 상한)**

| order_no | item       | PDS1 | PDS2 | PDS3 | 수동대인 | 인바운드 |
|---:|-----------|----:|----:|----:|------:|------:|
| 1 | 첫인사       |  3 |  3 |  3 |  3 |  5 |
| 2 | 본인 확인    |  4 |  4 |  4 |  4 |  5 |
| 3 | 종료 인사    |  3 |  3 |  3 |  3 |  5 |
| 4 | 음성         |  5 |  4 |  4 |  4 |  5 |
| 5 | 언어 표현    |  5 |  3 | 10 | 10 | 10 |
| 6 | 기반 형성    | 16 | 20 | 10 | 10 | 20 |
| 7 | 회수 스킬    | 20 | 20 | 20 | 20 | 15 |
| 8 | 업무 정확도  | 20 | 20 | 20 | 20 | 15 |
| 9 | 이력 등록    | 10 | 10 | 10 | 10 | 10 |

> `category` / `item` / `validation_time` 은 서버 derive 라 응답에 포함하지 않음.
> `manual_eval` 은 검수자 화면에서 사람이 채우는 컬럼 — Agent 가 보내지 않음 (서버가 `ai_eval` 로 초기화).
> `AI_SCORE` / `TOTAL_SCORE` 도 서버 derive 라 응답에 포함하지 않음.

### 2.2 `pentagon[*]` (배열, 정확히 6 row — item_type_no 1~5 + 99)

| 키 | 타입 | 필수 | 매핑 | 검증 |
|----|----|:--:|----|----|
| `item_type_no` | int    | ✅ | `qa_analysis_report.item_type_no` | 1, 2, 3, 4, 5, 99 |
| `item_type`    | string | ✅ | `qa_analysis_report.item_type` | 아래 고정 라벨 표와 정확히 일치 |
| `rating`       | string | ⭕ | `qa_analysis_report.rating` | `'우수'`/`'보통'`/`'주의'`/`'실패'`. `item_type_no=99` 는 `null`. 미전송 시 서버가 점수 구간으로 derive |
| `comment`      | string | ✅ | `qa_analysis_report.comment` | 빈 문자열 허용 |
| `summary`      | string | 99에서만 | `qa_analysis_report.summary` | `item_type_no=99` 에서만 값 채움. 그 외 `null` |

**`item_type` 고정 라벨 (1:1 매핑 필수)**

| item_type_no | item_type        |
|---:|----------------|
| 1  | `인사·본인확인`     |
| 2  | `응대 화법·음성`     |
| 3  | `경청·공감 응대`     |
| 4  | `업무 정확도`        |
| 5  | `사후 처리`          |
| 99 | `summary`           |

> 점수 구간 → rating 자동 변환 (서버 derive 규칙): ≥90 `우수` / ≥80 `보통` / ≥70 `주의` / 그 외 `실패`.
> Agent 가 자체 rating 을 보내고 싶으면 위 4종만 사용.

---

## 3. `consumer_track` — 소비자보호부 응답 본문

> 20 항목 Y/N + 금칙어 + 12 카테고리 + AI 분석대상 판정.

```jsonc
{
  "ai_analysis": {                    // qa_calls 의 분석대상 판정 필드들
    "target": "O",                    // "O" 또는 "X"
    "reason": "통화길이 90초 이상 & 금칙어 1건 감지",
    "voc_code": "V123",
    "promotion_code": "P456"
  },
  "consumer_eval": [                  // 20 항목 (item_no 1~20, 모두 전송)
    {
      "item_no": 1,
      "yn": "Y",
      "detail_text": null,
      "evidence_line_no": 3,
      "evidence_text": "본인 확인을 위해 생년월일 부탁드립니다."
    },
    // ... item_no 2 ~ 20
  ],
  "keywords": [                       // 0~다건. 미감지면 빈 배열
    {
      "level":          "Level 1 - 최고위험",
      "major_category": "법적 리스크",
      "sub_category":   "형사처벌 협박",
      "keyword":        "감옥",
      "line_no":        12,
      "line_text":      "이 건 처리 안 되면 감옥 갈 수도 있어요."
    }
  ],
  "ai_categories": [                  // 12 카테고리 (category_no 1~12, 모두 전송)
    {
      "category_no": 1,
      "score": 85.50
    },
    // ... category_no 2 ~ 12
  ]
}
```

### 3.1 `ai_analysis` (객체)

| 키 | 타입 | 필수 | 매핑 | 검증 |
|----|----|:--:|----|----|
| `target`         | string | ✅ | `qa_calls.ai_analysis_target` | `'O'` 또는 `'X'` |
| `reason`         | string | ✅ | `qa_calls.ai_analysis_reason` | 선정/제외 사유 텍스트 |
| `voc_code`       | string | ⭕ | `qa_calls.voc_code` | 빈 값 시 NULL 저장 |
| `promotion_code` | string | ⭕ | `qa_calls.promotion_code` | 빈 값 시 NULL 저장 |

> `voc_code` / `promotion_code` 가 Agent 의 판정 입력이 아니라 외부 시스템 메타라면, 요청(input) 에 포함되어 응답에서는 echo back 만 해도 무방.

### 3.2 `consumer_eval[*]` (배열, 정확히 20 row)

| 키 | 타입 | 필수 | 매핑 | 검증 |
|----|----|:--:|----|----|
| `item_no`           | int    | ✅ | `qa_consumer_eval_rows.item_no` | 1~20 (20 row 모두 필수) |
| `yn`                | string | ✅ | `qa_consumer_eval_rows.yn` | `'Y'` 또는 `'N'` (DB CHECK) |
| `detail_text`       | string | ⭕ | `qa_consumer_eval_rows.detail_text` | `yn='N'` 시 채우기 권장. 빈 값 허용 |
| `evidence_line_no`  | int    | ⭕ | `qa_consumer_eval_rows.evidence_line_no` | `qa_conversations.turn_no` 와 일치 |
| `evidence_text`     | string | ⭕ | `qa_consumer_eval_rows.evidence_text` | 근거 발화 원문 |

> `major_category` / `sub_no` / `criterion` / `item_text` 는 `item_no` 로 결정되는 **고정 매핑**이라 응답에 포함하지 않음 (서버가 [`DB_SCHEMA_FULL.md`](./DB_SCHEMA_FULL.md) §2.6 의 20 항목 표대로 채움).

### 3.3 `keywords[*]` (배열, 길이 0~N)

| 키 | 타입 | 필수 | 매핑 | 검증 |
|----|----|:--:|----|----|
| `level`          | string | ✅ | `qa_consumer_keywords.level` | 8종 허용값 중 1 (아래 표) |
| `major_category` | string | ✅ | `qa_consumer_keywords.major_category` | 표준 사전(`금칙어.csv`)과 정확히 일치 |
| `sub_category`   | string | ✅ | `qa_consumer_keywords.sub_category` | 표준 사전과 정확히 일치 |
| `keyword`        | string | ✅ | `qa_consumer_keywords.keyword` | 감지 단어 원문 |
| `line_no`        | int    | ⭕ | `qa_consumer_keywords.line_no` | `qa_conversations.turn_no` |
| `line_text`      | string | ⭕ | `qa_consumer_keywords.line_text` | 발화 컨텍스트 |

**`level` 허용값 8종**

```
Level 1 - 최고위험
Level 2 - 고위험
Level 3 - 중위험
부서특화 - 채권팀
부서특화 - 심사발급팀
부서특화 - CRM팀
부서특화 - 법률지원팀
부서특화 - 소비자보호팀
```

> 점수 차감은 없음. 미감지 시 빈 배열 `[]` 전송.

### 3.4 `ai_categories[*]` (배열, 정확히 12 row)

| 키 | 타입 | 필수 | 매핑 | 검증 |
|----|----|:--:|----|----|
| `category_no` | int     | ✅ | `qa_consumer_ai_categories.category_no` | 1~12 (12 row 모두 필수) |
| `score`       | number  | ✅ | `qa_consumer_ai_categories.score` | 0 ≤ 값 ≤ 100. 소수점 둘째 자리까지 (`numeric(5,2)`) |

> `major_category` / `sub_category` 는 `category_no` 로 결정되는 **고정 매핑**이라 응답에 포함하지 않음 (서버가 [`DB_SCHEMA_FULL.md`](./DB_SCHEMA_FULL.md) §2.8 의 12 카테고리 표대로 채움).

---

## 4. `stt` — STT 전사 (옵션, 두 부서 공용)

Agent 가 STT 결과를 자체 생성하여 함께 반환하는 경우에만 사용. 별도 STT 파이프라인이 있다면 생략.

```jsonc
[
  { "turn_no": 1,  "speaker": "상담사", "text": "안녕하세요 ..." },
  { "turn_no": 2,  "speaker": "고객",   "text": "네 ..." }
]
```

| 키 | 타입 | 필수 | 매핑 | 검증 |
|----|----|:--:|----|----|
| `turn_no` | int    | ⭕ | `qa_conversations.turn_no` | 생략 시 배열 순서대로 1부터 자동 부여 |
| `speaker` | string | ✅ | `qa_conversations.speaker` | 문자열에 `'고객'` 포함 시 `'고객'`, 그 외 `'상담사'` 로 정규화 |
| `text`    | string | ✅ | `qa_conversations.text` | 발화 내용 |

> `consumer_track.consumer_eval[*].evidence_line_no` / `keywords[*].line_no` 가 `turn_no` 를 참조하므로, STT 와 같은 응답에 포함되면 라인 일관성이 보장된다.

---

## 5. 에러 응답 (Agent → Dashboard, 옵션)

Agent 가 평가 실패를 알리고 싶을 때:

```jsonc
{
  "schema_version": "1.0",
  "qa_id": "ext-20260601-0001",
  "error": {
    "code":    "STT_FAILED",          // 자체 정의 코드
    "message": "STT 결과 부재로 평가 불가",
    "retryable": false
  }
}
```

> Dashboard 는 `error` 가 있으면 DB 적재를 건너뛰고 `qa_audit_logs` 에 실패 기록만 남긴다.

---

## 6. 응답 예시

### 6.1 컬렉션관리부 PDS1 콜 (풀 응답)

```json
{
  "schema_version": "1.0",
  "qa_id": "ext-20260601-0001",
  "department": "컬렉션관리부",
  "role": "PDS1",
  "evaluated_at": "2026-06-01T14:00:00+09:00",
  "model_meta": { "model_name": "qa-eval-v1", "model_version": "2026.06.01" },
  "collection_track": {
    "evaluations": [
      { "order_no": 1, "ai_eval": 3,  "reason_text": "오프닝 인사 정상.", "agent_utterance": "안녕하세요 컬렉션관리부 김상담입니다." },
      { "order_no": 2, "ai_eval": 4,  "reason_text": "본인 확인 절차 명확.", "agent_utterance": "본인 확인을 위해 생년월일 부탁드립니다." },
      { "order_no": 3, "ai_eval": 3,  "reason_text": "종료 인사 명확.", "agent_utterance": "이용해주셔서 감사합니다." },
      { "order_no": 4, "ai_eval": 5,  "reason_text": "발음 명료.", "agent_utterance": "" },
      { "order_no": 5, "ai_eval": 4,  "reason_text": "공손한 표현 사용.", "agent_utterance": "" },
      { "order_no": 6, "ai_eval": 12, "reason_text": "라포 형성 보통.", "agent_utterance": "" },
      { "order_no": 7, "ai_eval": 14, "reason_text": "회수 스킬 부분 미흡.", "agent_utterance": "" },
      { "order_no": 8, "ai_eval": 17, "reason_text": "업무 안내 정확.", "agent_utterance": "" },
      { "order_no": 9, "ai_eval": 8,  "reason_text": "이력 등록 안내 일부 누락.", "agent_utterance": "" }
    ],
    "pentagon": [
      { "item_type_no": 1, "item_type": "인사·본인확인", "rating": "우수", "comment": "본인 확인 절차가 명확함." },
      { "item_type_no": 2, "item_type": "응대 화법·음성", "rating": "보통", "comment": "발음·표현 양호." },
      { "item_type_no": 3, "item_type": "경청·공감 응대", "rating": "주의", "comment": "라포 형성 부분 보완 필요." },
      { "item_type_no": 4, "item_type": "업무 정확도",   "rating": "보통", "comment": "업무 안내 정확." },
      { "item_type_no": 5, "item_type": "사후 처리",     "rating": "주의", "comment": "이력 등록 안내 일부 누락." },
      { "item_type_no": 99,"item_type": "summary",       "rating": null,   "comment": "", "summary": "전반적 양호. 회수 스킬·이력 등록 보완 필요." }
    ]
  }
}
```

> 위 점수 합 = 70 / 86 = 81.4점 → `AI_SCORE` 서버 derive.

### 6.2 소비자보호부 콜 (분석대상 O, 풀 응답)

```json
{
  "schema_version": "1.0",
  "qa_id": "ext-20260601-0002",
  "department": "소비자보호부",
  "role": "전체",
  "evaluated_at": "2026-06-01T14:05:00+09:00",
  "consumer_track": {
    "ai_analysis": {
      "target": "O",
      "reason": "통화길이 90초 이상 & 금칙어 1건 감지",
      "voc_code": "V123",
      "promotion_code": "P456"
    },
    "consumer_eval": [
      { "item_no": 1,  "yn": "Y", "detail_text": null, "evidence_line_no": 1, "evidence_text": "..." },
      { "item_no": 2,  "yn": "Y", "detail_text": null, "evidence_line_no": 3, "evidence_text": "..." },
      { "item_no": 3,  "yn": "N", "detail_text": "고객 이해 부족에도 가입 진행", "evidence_line_no": 14, "evidence_text": "..." }
      // ... 4~20 (총 20 row)
    ],
    "keywords": [
      { "level": "Level 1 - 최고위험", "major_category": "법적 리스크", "sub_category": "형사처벌 협박", "keyword": "감옥", "line_no": 12, "line_text": "이 건 처리 안 되면 감옥 갈 수도 있어요." }
    ],
    "ai_categories": [
      { "category_no": 1,  "score": 85.50 },
      { "category_no": 2,  "score": 60.00 }
      // ... 3~12 (총 12 row)
    ]
  }
}
```

### 6.3 소비자보호부 콜 (분석대상 X)

```json
{
  "schema_version": "1.0",
  "qa_id": "ext-20260601-0003",
  "department": "소비자보호부",
  "role": "전체",
  "evaluated_at": "2026-06-01T14:10:00+09:00",
  "consumer_track": {
    "ai_analysis": {
      "target": "X",
      "reason": "통화길이 30초 미만 & 금칙어 미발견",
      "voc_code": null,
      "promotion_code": null
    },
    "consumer_eval": [ /* 20 row (분석대상 X 라도 모두 채움) */ ],
    "keywords": [],
    "ai_categories": [ /* 12 row, score 0 허용 */ ]
  }
}
```

---

## 7. JSON Schema (Draft 2020-12, 간략)

```jsonc
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "required": ["schema_version", "qa_id", "department", "role"],
  "properties": {
    "schema_version": { "type": "string", "const": "1.0" },
    "qa_id":          { "type": "string", "minLength": 1 },
    "department":     { "type": "string", "enum": ["컬렉션관리부", "소비자보호부", "고객센터", "고객지원실"] },
    "role":           { "type": "string", "enum": ["PDS1", "PDS2", "PDS3", "수동대인", "인바운드", "전체"] },
    "evaluated_at":   { "type": "string", "format": "date-time" },
    "model_meta":     { "type": "object" },

    "collection_track": {
      "type": "object",
      "required": ["evaluations", "pentagon"],
      "properties": {
        "evaluations": {
          "type": "array",
          "minItems": 1, "maxItems": 9,
          "items": {
            "type": "object",
            "required": ["order_no", "ai_eval"],
            "properties": {
              "order_no":        { "type": "integer", "minimum": 1, "maximum": 9 },
              "ai_eval":         { "type": "number",  "minimum": 0 },
              "reason_text":     { "type": "string" },
              "agent_utterance": { "type": "string" }
            }
          }
        },
        "pentagon": {
          "type": "array",
          "minItems": 6, "maxItems": 6,
          "items": {
            "type": "object",
            "required": ["item_type_no", "item_type", "comment"],
            "properties": {
              "item_type_no": { "type": "integer", "enum": [1, 2, 3, 4, 5, 99] },
              "item_type":    { "type": "string",  "enum": ["인사·본인확인", "응대 화법·음성", "경청·공감 응대", "업무 정확도", "사후 처리", "summary"] },
              "rating":       { "type": ["string", "null"], "enum": ["우수", "보통", "주의", "실패", null] },
              "comment":      { "type": "string" },
              "summary":      { "type": ["string", "null"] }
            }
          }
        }
      }
    },

    "consumer_track": {
      "type": "object",
      "required": ["ai_analysis", "consumer_eval", "keywords", "ai_categories"],
      "properties": {
        "ai_analysis": {
          "type": "object",
          "required": ["target", "reason"],
          "properties": {
            "target":         { "type": "string", "enum": ["O", "X"] },
            "reason":         { "type": "string" },
            "voc_code":       { "type": ["string", "null"] },
            "promotion_code": { "type": ["string", "null"] }
          }
        },
        "consumer_eval": {
          "type": "array",
          "minItems": 20, "maxItems": 20,
          "items": {
            "type": "object",
            "required": ["item_no", "yn"],
            "properties": {
              "item_no":           { "type": "integer", "minimum": 1, "maximum": 20 },
              "yn":                { "type": "string",  "enum": ["Y", "N"] },
              "detail_text":       { "type": ["string", "null"] },
              "evidence_line_no":  { "type": ["integer", "null"], "minimum": 1 },
              "evidence_text":     { "type": ["string", "null"] }
            }
          }
        },
        "keywords": {
          "type": "array",
          "items": {
            "type": "object",
            "required": ["level", "major_category", "sub_category", "keyword"],
            "properties": {
              "level":          { "type": "string", "enum": [
                "Level 1 - 최고위험", "Level 2 - 고위험", "Level 3 - 중위험",
                "부서특화 - 채권팀", "부서특화 - 심사발급팀", "부서특화 - CRM팀",
                "부서특화 - 법률지원팀", "부서특화 - 소비자보호팀"
              ] },
              "major_category": { "type": "string" },
              "sub_category":   { "type": "string" },
              "keyword":        { "type": "string" },
              "line_no":        { "type": ["integer", "null"], "minimum": 1 },
              "line_text":      { "type": ["string", "null"] }
            }
          }
        },
        "ai_categories": {
          "type": "array",
          "minItems": 12, "maxItems": 12,
          "items": {
            "type": "object",
            "required": ["category_no", "score"],
            "properties": {
              "category_no": { "type": "integer", "minimum": 1, "maximum": 12 },
              "score":       { "type": "number",  "minimum": 0, "maximum": 100 }
            }
          }
        }
      }
    },

    "stt": {
      "type": "array",
      "items": {
        "type": "object",
        "required": ["speaker", "text"],
        "properties": {
          "turn_no": { "type": ["integer", "null"], "minimum": 1 },
          "speaker": { "type": "string" },
          "text":    { "type": "string" }
        }
      }
    },

    "error": {
      "type": "object",
      "required": ["code", "message"],
      "properties": {
        "code":      { "type": "string" },
        "message":   { "type": "string" },
        "retryable": { "type": "boolean" }
      }
    }
  }
}
```

---

## 8. 서버가 derive 하는 값 (Agent 가 보낼 필요 없음)

| 값 | derive 규칙 |
|----|----|
| `qa_calls.AI_SCORE`                  | `Σ(ai_eval) / Σ(직무 만점) × 100`. evaluations 미전송 시 0 |
| `qa_calls.TOTAL_SCORE`               | 위와 동일 (검수자 보정 들어오기 전까지 `AI_SCORE` 와 동일) |
| `qa_checklist_rows.category`         | order_no 별 표준 라벨로 덮어씀 |
| `qa_checklist_rows.item`             | order_no 별 표준 라벨로 덮어씀 |
| `qa_checklist_rows.validation_time`  | `'배점 N'`, N = 직무 만점 |
| `qa_evaluation_rows.category`        | order_no 별 표준 라벨로 덮어씀 |
| `qa_evaluation_rows.item`            | order_no 별 표준 라벨로 덮어씀 |
| `qa_evaluation_rows.manual_eval`     | 검수 전까지 `ai_eval` 과 동일 |
| `qa_analysis_report.rating`          | 응답에 없으면 점수 구간으로 derive |
| `qa_analysis_report.item_type`       | 응답에 있으면 그대로, 없으면 `item_type_no` 로 derive |
| `qa_consumer_eval_rows.major_category` / `sub_no` / `criterion` / `item_text` | `item_no` 로 고정 매핑 |
| `qa_consumer_ai_categories.major_category` / `sub_category` | `category_no` 로 고정 매핑 |

---

## 9. 매핑 검수 (응답 필드 ↔ DB 컬럼)

### 9.1 컬렉션관리부 트랙 매핑

| 응답 경로 | DB 테이블.컬럼 | Agent 책임 | 비고 |
|----|----|:--:|----|
| `qa_id` | `qa_calls.ID` | ✅ | envelope key |
| `department` | `qa_calls.department` | ✅ | envelope key |
| `role` | `qa_calls.role` | ✅ | envelope key |
| `collection_track.evaluations[].order_no` | `qa_evaluation_rows.order_no` & `qa_checklist_rows.order_no` | ✅ | 두 테이블 동시 채움 |
| `collection_track.evaluations[].ai_eval` | `qa_evaluation_rows.ai_eval` | ✅ | |
| `collection_track.evaluations[].reason_text` | `qa_evaluation_rows.reason_text` | ⭕ | |
| `collection_track.evaluations[].agent_utterance` | `qa_checklist_rows.agent_utterance` | ⭕ | |
| `collection_track.pentagon[].item_type_no` | `qa_analysis_report.item_type_no` | ✅ | |
| `collection_track.pentagon[].item_type` | `qa_analysis_report.item_type` | ✅ | 6 row 모두 |
| `collection_track.pentagon[].rating` | `qa_analysis_report.rating` | ⭕ | 미전송 시 derive |
| `collection_track.pentagon[].comment` | `qa_analysis_report.comment` | ✅ | |
| `collection_track.pentagon[].summary` | `qa_analysis_report.summary` | item_type_no=99 에서만 | |
| — (derive) | `qa_calls.AI_SCORE` / `TOTAL_SCORE` | ❌ | 서버 derive |
| — (derive) | `qa_evaluation_rows.category` / `item` | ❌ | order_no 매핑 |
| — (derive) | `qa_checklist_rows.category` / `item` / `validation_time` | ❌ | order_no + 직무 매핑 |
| — (검수 입력) | `qa_evaluation_rows.manual_eval` | ❌ | 사람이 채움 |

### 9.2 소비자보호부 트랙 매핑

| 응답 경로 | DB 테이블.컬럼 | Agent 책임 | 비고 |
|----|----|:--:|----|
| `consumer_track.ai_analysis.target` | `qa_calls.ai_analysis_target` | ✅ | |
| `consumer_track.ai_analysis.reason` | `qa_calls.ai_analysis_reason` | ✅ | |
| `consumer_track.ai_analysis.voc_code` | `qa_calls.voc_code` | ⭕ | 입력 echo 도 무방 |
| `consumer_track.ai_analysis.promotion_code` | `qa_calls.promotion_code` | ⭕ | 입력 echo 도 무방 |
| `consumer_track.consumer_eval[].item_no` | `qa_consumer_eval_rows.item_no` | ✅ | 20 row 모두 |
| `consumer_track.consumer_eval[].yn` | `qa_consumer_eval_rows.yn` | ✅ | |
| `consumer_track.consumer_eval[].detail_text` | `qa_consumer_eval_rows.detail_text` | ⭕ | yn=N 시 권장 |
| `consumer_track.consumer_eval[].evidence_line_no` | `qa_consumer_eval_rows.evidence_line_no` | ⭕ | turn_no 와 일치 |
| `consumer_track.consumer_eval[].evidence_text` | `qa_consumer_eval_rows.evidence_text` | ⭕ | |
| `consumer_track.keywords[].level` | `qa_consumer_keywords.level` | ✅ | 미감지 시 빈 배열 |
| `consumer_track.keywords[].major_category` | `qa_consumer_keywords.major_category` | ✅ | |
| `consumer_track.keywords[].sub_category` | `qa_consumer_keywords.sub_category` | ✅ | |
| `consumer_track.keywords[].keyword` | `qa_consumer_keywords.keyword` | ✅ | |
| `consumer_track.keywords[].line_no` | `qa_consumer_keywords.line_no` | ⭕ | |
| `consumer_track.keywords[].line_text` | `qa_consumer_keywords.line_text` | ⭕ | |
| `consumer_track.ai_categories[].category_no` | `qa_consumer_ai_categories.category_no` | ✅ | 12 row 모두 |
| `consumer_track.ai_categories[].score` | `qa_consumer_ai_categories.score` | ✅ | 0~100 |
| — (derive) | `qa_consumer_eval_rows.major_category` / `sub_no` / `criterion` / `item_text` | ❌ | item_no 매핑 |
| — (derive) | `qa_consumer_ai_categories.major_category` / `sub_category` | ❌ | category_no 매핑 |
| — (서버 정책) | `qa_calls.AI_SCORE` / `TOTAL_SCORE` | ❌ | 소비자보호부는 0 고정 |
| — (서버 입력) | `qa_calls.CALL_SEQ` / `CDATE` / `UID` / `org_id` | ❌ | 원본 콜 메타 (요청 시점에 결정) |

### 9.3 STT 매핑

| 응답 경로 | DB 테이블.컬럼 | Agent 책임 |
|----|----|:--:|
| `stt[].turn_no` | `qa_conversations.turn_no` | ⭕ |
| `stt[].speaker` | `qa_conversations.speaker` | ✅ |
| `stt[].text` | `qa_conversations.text` | ✅ |

### 9.4 부수 / 적재되지 않는 응답 필드

| 응답 필드 | 용도 | DB 적재 |
|----|----|:--:|
| `schema_version` | 호환성 체크 | ❌ |
| `evaluated_at` | 감사 로그 메타 | `qa_audit_logs.detail_json` 에 보존 |
| `model_meta`    | 감사 로그 메타 | `qa_audit_logs.detail_json` 에 보존 |
| `error.*`       | 적재 스킵 신호 | `qa_audit_logs` 에 실패 기록 |

### 9.5 응답에 포함되지 않는(=서버 자체 관리) 테이블

| 테이블 | 이유 |
|----|----|
| `domains` / `organizations`         | 마스터 데이터. Dashboard 관리 화면에서 운영 |
| `admin_users`                       | 사용자 계정. Agent 외부 영역 |
| `eval_item_defs` / `pentagon_axes`  | 평가 정의 / 프롬프트. Dashboard 관리 화면에서 편집 |
| `eval_item_change_log` / `pentagon_axis_change_log` | 정의 변경 이력 |
| `qa_golden_set`                     | Few-shot 자원 (요청 시 Agent 에 **입력**으로 전달 가능, 응답으로는 안 받음) |
| `qa_audit_logs`                     | Dashboard 가 자체 기록 |
| `*__sandbox_snapshot` (9건)         | 운영 데이터 보존 사본 |

> §9.1~9.5 를 통해 §2 운영 데이터 테이블 8종의 모든 적재 책임 컬럼이 응답 필드에 1:1 매핑됨을 확인.

---

## 10. Open Question (Agent 측 확정 필요)

본 문서를 회신할 때 함께 확인 받을 항목.

1. **STT 책임 주체**: Agent 가 STT 까지 책임지는가? 아니면 외부 STT 시스템 결과를 Agent 입력으로 받는가?
2. **소비자보호부 분석대상 판정 입력 신호**: `voc_code` / `promotion_code` / `통화길이` / `금칙어 감지` 중 Agent 가 어떤 신호로 `target` 을 결정하는가?
3. **부분 응답 허용 여부**: 9 항목 / 20 항목 / 12 카테고리 중 일부만 평가 가능한 경우, 누락분을 빈 row 로 채울지 응답에서 생략할지.
4. **금칙어 사전 동기화**: `level` / `major_category` / `sub_category` / `keyword` 4-튜플은 표준 사전(`금칙어.csv`)에 정확히 일치해야 한다. 사전은 어느 시점에 어떻게 동기화할 것인가?
5. **rating derive 권한**: Agent 가 `rating` 을 직접 결정할지, 서버 derive 에 위임할지.
6. **에러 코드 카탈로그**: `error.code` 값의 표준 집합 정의 필요.

---

## 변경 이력

- **2026-06-01 (v1.2)** — §C "책임 분담 매트릭스" 추가. Agent 가 반드시 만들어야 하는 것(🤖)과 Dashboard 가 만드는 것(📋⚙️👤)을 필드별로 명확히 분리. 핵심 로직 3종(체크리스트·Pentagon·골든셋 Few-shot) 기준으로 컬렉션/소비자보호 트랙 각각의 Input/Output 표 + 미니멈 JSON 예시 + "Agent 가 절대 만들 수 없는 것" 목록 정리. 모든 필드에 한국어 의미 괄호 표기.
- **2026-06-01 (v1.1)** — §A "Input 페이로드 (Dashboard → Agent, 권장안)" + §B "Agent 활용 패턴 (핵심 로직)" 추가. 평가 기준·골든셋 전달 형식과 9 항목 채점·Pentagon 5축 derive·골든셋 few-shot 주입·소비자보호부 20 항목/금칙어/12 카테고리 처리 순서를 명세화.
- **2026-05-29 (v1.0 초안)** — DB_SCHEMA_FULL.md §2 운영 데이터 8 테이블과 1:1 매핑되도록 envelope / 부서별 트랙 / STT / 매핑 검수표 정의.
