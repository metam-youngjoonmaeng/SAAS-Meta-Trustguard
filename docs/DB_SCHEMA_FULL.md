# QA Dashboard — DB 스키마 전체 명세 (Full Inventory, dev)

> **이 문서의 용도**: QA 평가 AI Agent 측에 DB 구조 전체를 공유하기 위한 마스터 참조서.
> `docs/DB_SCHEMA.md` 가 콜 1건 적재 관점의 v2 PoC 안내서라면, 본 문서는 **현재 운영 DB 의 모든 테이블·컬럼·제약·인덱스를 누락 없이** 정리한 인벤토리.
>
> **기준 환경**: [01-AI-QA_Dashboard-dev/](../) — `docker/init/postgres/01_init.sql ~ 14_unify_user_columns.sql` 모두 적용.
> 운영(`01-AI-QA_Dashboard/`)은 본 문서 범위 밖.
>
> AI Agent 가 실제로 row 를 적재하거나 derive 입력으로 참조하는 테이블은 §2 (운영 데이터 테이블) 와 §3 (메타·평가정의 테이블) 만이며, §4 (감사·시스템 테이블) 와 §5 (샌드박스 스냅샷) 는 AI Agent 가 직접 쓰지 않는다.

---

## 0. 한눈에 보기

### 테이블 인벤토리 — 총 **26개** (17 운영/메타 + 9 샌드박스 스냅샷)

| #  | 테이블 (한국어 의미) | 분류 | AI Agent 적재 책임 | 핵심 PK |
|----|--------------------|----|------------------|--------|
| 1  | `qa_calls` (콜 메타/평가 총점) | §2 운영 데이터 | 일부 (점수/분석대상) | `ID` |
| 2  | `qa_conversations` (STT 전사) | §2 운영 데이터 | STT 시 | (`ID`, `turn_no`) |
| 3  | `qa_checklist_rows` (체크리스트 발화·배점) | §2 운영 데이터 | 컬렉션관리부 9 항목 | (`ID`, `order_no`) |
| 4  | `qa_evaluation_rows` (9 항목 평가 점수) | §2 운영 데이터 | 컬렉션관리부 9 항목 | (`ID`, `order_no`) |
| 5  | `qa_analysis_report` (Pentagon 5축 분석·코멘트) | §2 운영 데이터 | 컬렉션관리부 5축 + summary | (`ID`, `item_type_no`) |
| 6  | `qa_consumer_eval_rows` (소비자보호부 20 항목 Y/N) | §2 운영 데이터 | 소비자보호부 20 항목 | (`ID`, `item_no`) |
| 7  | `qa_consumer_keywords` (금칙어 감지) | §2 운영 데이터 | 소비자보호부 금칙어 | `keyword_id` |
| 8  | `qa_consumer_ai_categories` (12 카테고리 적합도) | §2 운영 데이터 | 소비자보호부 12 카테고리 | (`ID`, `category_no`) |
| 9  | `eval_item_defs` (평가항목 정의·프롬프트) | §3 평가정의 | ❌ (대시보드 관리) | `id` |
| 10 | `eval_item_change_log` (평가항목 변경 이력) | §3 평가정의 | ❌ | `id` |
| 11 | `pentagon_axes` (Pentagon 5축 정의·프롬프트) | §3 평가정의 | ❌ (대시보드 관리) | `id` |
| 12 | `pentagon_axis_change_log` (Pentagon 축 변경 이력) | §3 평가정의 | ❌ | `id` |
| 13 | `qa_golden_set` (골든셋/Few-shot 예시) | §3 평가정의 | ❌ (Few-shot 입력 자원) | `golden_id` |
| 14 | `domains` (업종 상위 분류) | §4 시스템 | ❌ | `id` |
| 15 | `organizations` (브랜드/조직) | §4 시스템 | ❌ | `id` |
| 16 | `admin_users` (계정/검수자) | §4 시스템 | ❌ | `user_id` |
| 17 | `qa_audit_logs` (감사 로그/사용자 활동) | §4 시스템 | ❌ | `audit_id` |
| 18~26 | `*__sandbox_snapshot` (운영 데이터 사본 9개) | §5 샌드박스 | ❌ | (각 부모 PK) |

### FK 관계 다이어그램

```
┌──────────────┐
│   domains    │ id  (업종)
└──────┬───────┘
       │ domain_id (SET NULL)
       ▼
┌──────────────┐
│ organizations│ id  (브랜드)
└──┬──────┬────┘
   │      │ (org_id, SET NULL)
   │      ▼
   │   ┌────────────────┐
   │   │  admin_users   │ user_id  (계정)
   │   └────────┬───────┘
   │            │ (user_id, SET NULL) ─ 검수자
   │            │
   │            │ (FK 논리적 참조 — 캐시 박제)
   │            ├─→ qa_audit_logs.user_id
   │            ├─→ eval_item_change_log.user_id
   │            └─→ pentagon_axis_change_log.user_id
   │
   │ (org_id, RESTRICT)
   ▼
┌─────────────────────────────────┐
│            qa_calls             │ ID (PK)
│   user_id, org_id ──────────────┤
└──┬──────────────────────────────┘
   │
   │ (ID/qa_id, CASCADE) — 자식 8종
   ├─→ qa_conversations          (STT)
   ├─→ qa_checklist_rows         (컬렉션 9항목 발화·배점)
   ├─→ qa_evaluation_rows        (컬렉션 9항목 점수)
   ├─→ qa_analysis_report        (컬렉션 Pentagon 5축)
   ├─→ qa_consumer_eval_rows     (소비자보호 20 항목)
   ├─→ qa_consumer_keywords      (소비자보호 금칙어)
   ├─→ qa_consumer_ai_categories (소비자보호 12 카테고리)
   └─→ qa_golden_set (qa_id)     (골든셋)

(편집 자원 — org_id 로 organizations 참조)
organizations
   ├─ eval_item_defs           (CASCADE)
   ├─ eval_item_change_log     (CASCADE)
   ├─ pentagon_axes            (CASCADE)
   └─ pentagon_axis_change_log (CASCADE)

(논리적 연결 — FK 없음)
qa_audit_logs               : org/qa_calls 와 명시적 FK 없음 (resource_type/resource_id 로 연결)
*__sandbox_snapshot (9건)   : FK 없음 (운영 데이터 사본)
```

### 정의 위치 색인

| 파일 | 다루는 테이블/변경 |
|----|-----------|
| `docker/init/postgres/01_init.sql` | admin_users, qa_audit_logs, qa_analysis_report, qa_calls, qa_checklist_rows, qa_consumer_ai_categories, qa_consumer_eval_rows, qa_consumer_keywords, qa_conversations, qa_evaluation_rows, + 9 __sandbox_snapshot |
| `02_brands_domains.sql` | domains, organizations / qa_calls·admin_users 에 `org_id` 추가 / qa_calls 에 `is_sandbox` partial index |
| `03_admin_users_department.sql` | admin_users 에 `department` 컬럼 추가 |
| `04_hanwha_brand_seed.sql` | qa_calls department CHECK 확장 (`'고객센터'` 포함) + 한화손해보험 시드 |
| `05_golden_set.sql` | qa_golden_set (14 에서 일부 컬럼 DROP) |
| `06_revert_eval_items.sql` | (마이그레이션 rollback 스크립트, 새 테이블 없음) |
| `07_eval_item_defs.sql` | eval_item_defs |
| `08_jiyeokjeongbo_brand_seed.sql` | qa_calls department CHECK 확장 (`'고객지원실'` 포함) + 지역정보개발원 시드 |
| `09_eval_item_change_log.sql` | eval_item_change_log |
| `10_admin_users_profile.sql` | admin_users 에 `profile_image_path` / `must_change_password` 추가 |
| `11_review_status.sql` | qa_calls 에 검수상태 컬럼 4종 추가 (`review_status`, `review_started_at`, `review_completed_at`, `reviewed_by_user_id` — 14 에서 `user_id` 로 RENAME) |
| `12_eval_item_meta.sql` | eval_item_defs 에 `pentagon_axis` / `scoring_type` / `max_score` / `is_active` 추가 |
| `13_pentagon_axes.sql` | pentagon_axes, pentagon_axis_change_log |
| `14_unify_user_columns.sql` | admin_users 참조 컬럼 네이밍 통일 (qa_calls / qa_audit_logs / eval_item_change_log / pentagon_axis_change_log) + qa_golden_set 의 user 캐시 3종 & `call_datetime` DROP |
| `server/index.js` (~L2413) | qa_calls 에 `is_sandbox` 컬럼 + 인덱스 idempotent 추가 |

> 트리거·뷰·머티리얼라이즈드 뷰·도메인 타입은 정의되어 있지 않음.

---

## 1. 공통 규칙

- 모든 timestamp 컬럼은 `timestamp with time zone` (`timestamptz`).
- 부울 플래그는 `boolean` 또는 `smallint(0/1)` 혼용 (`smallint` 는 01_init.sql 의 pg_dump 출력).
- 자동 증가 PK 는 `serial` (PostgreSQL 의 `integer + sequence + DEFAULT nextval`).
- FK 정책:
  - `qa_calls` 자식 8종: **ON DELETE CASCADE** (콜 삭제 시 평가/대화/리포트/골든셋 동반 삭제).
  - `organizations` 자식: **ON DELETE RESTRICT** (qa_calls) 또는 **ON DELETE SET NULL** / **CASCADE** (테이블별로 다름, 아래 정의 참조).
  - `admin_users` 참조: **ON DELETE SET NULL** (검수자/등록자 탈퇴 시 row 보존).
- 한국어 식별자(부서명·항목명) 는 모두 `text` 컬럼 값으로 저장. 컬럼명 자체는 영문.
- **사용자 참조 컬럼 네이밍** (14 마이그레이션 후): 어느 테이블이든 `user_id` / `login_id` / `display_name` / `role` 로 통일.

---

## 2. 운영 데이터 테이블 (AI Agent 적재 대상)

### 2.1 `qa_calls` (콜 메타/평가 총점)

콜 1건 = 이 테이블 1 row. 모든 자식 테이블이 `ID` 를 FK 로 참조.

| 컬럼 | 타입 | NULL | 기본값 | 한국어 의미 / 설명 |
|----|----|----|-------|----|
| `ID`                    | text             | NN | —              | 콜 고유 ID (PK). 예: `QA-20260601-0001`, `ext-20260601-0001`, `sample-668481` |
| `CALL_SEQ`              | text             | NN | —              | 콜 일련번호 (외부 채널 콜 식별자). 생략 시 ingest 가 `ID` 와 동일하게 채움 |
| `CDATE`                 | text             | NN | —              | 통화 일시. ISO 8601 권장 (`2026-06-01T10:21:35+09:00`) |
| `UID`                   | text             | NN | —              | 세션/UID. 통상 `ID` 와 동일 |
| `AI_SCORE`              | double precision | NN | —              | AI 평가 총점 (0~100). 컬렉션관리부 전용. 소비자보호부는 0 |
| `TOTAL_SCORE`           | double precision | NN | —              | 최종 총점 (수기 보정 반영). 컬렉션관리부 전용 |
| `department`            | text             | NN | `'컬렉션관리부'` | 부서 구분. CHECK 허용값: `'컬렉션관리부'`, `'소비자보호부'`, `'고객센터'`, `'고객지원실'` |
| `role`                  | text             | NN | `'PDS1'`       | 직무. CHECK 허용값: `'PDS1'`, `'PDS2'`, `'PDS3'`, `'수동대인'`, `'인바운드'`, `'전체'`. 소비자보호부면 `'전체'` |
| `ai_analysis_target`    | text             | Y  | —              | AI 분석대상 여부. CHECK: `'O'`, `'X'`, NULL. 소비자보호부 전용 |
| `ai_analysis_reason`    | text             | Y  | —              | AI 분석대상 선정/제외 사유 (소비자보호부) |
| `voc_code`              | text             | Y  | —              | VOC 분류 코드 (소비자보호부) |
| `promotion_code`        | text             | Y  | —              | 판촉결과 코드 (소비자보호부) |
| `is_sandbox`            | boolean          | NN | `false`        | 샌드박스 콜 플래그. 운영 통계에서 제외 |
| `org_id`                | integer          | NN | `1`            | 브랜드 ID. FK → `organizations(id)` ON DELETE RESTRICT |
| `review_status`         | text             | NN | `'pending'`    | 검수 상태. CHECK: `'pending'`, `'in_review'`, `'completed'` |
| `review_started_at`     | timestamptz      | Y  | —              | 검수 시작 시점 |
| `review_completed_at`   | timestamptz      | Y  | —              | 검수 완료 시점 |
| `user_id`               | integer          | Y  | —              | 검수자 (14 마이그레이션 후, 구: `reviewed_by_user_id`). FK → `admin_users(user_id)` ON DELETE SET NULL |

**제약**
- PK: (`ID`)
- CHECK: `qa_calls_ai_target_chk`, `qa_calls_department_chk`, `qa_calls_role_chk`, `qa_calls_review_status_chk`
- FK: `org_id` → `organizations(id)` ON DELETE RESTRICT
- FK: `user_id` → `admin_users(user_id)` ON DELETE SET NULL (검수자)

**인덱스**
- `qa_calls_pkey` (PK)
- `idx_qa_calls_is_sandbox`: partial index `(is_sandbox) WHERE is_sandbox = true`
- `idx_qa_calls_org`: (`org_id`)
- `idx_qa_calls_review_status`: (`review_status`)

**ID 컨벤션**

| 용도 | 패턴 | 예시 |
|----|----|----|
| 운영 콜 | `QA-YYYYMMDD-NNNN` | `QA-20260601-0001` |
| 외부 API ingest | `ext-YYYYMMDD-NNNN` | `ext-20260601-0001` |
| 샘플 업로드 | `sample-` + 임의 ID | `sample-668481` (baseline 통계 제외) |

---

### 2.2 `qa_conversations` (STT 전사) — 두 부서 공용

| 컬럼 | 타입 | NULL | 한국어 의미 / 설명 |
|----|----|----|----|
| `ID`      | text    | NN | 콜 ID. FK → `qa_calls(ID)` ON DELETE CASCADE |
| `turn_no` | integer | NN | 발화 순서 (1부터) |
| `speaker` | text    | NN | 화자. `'상담사'` 또는 `'고객'`. 외부 ingest 는 문자열에 `'고객'` 포함 시 고객, 그 외는 상담사로 정규화 |
| `text`    | text    | NN | 발화 내용 |

**제약**
- PK: (`ID`, `turn_no`)
- FK: `ID` → `qa_calls(ID)` ON DELETE CASCADE

---

### 2.3 `qa_checklist_rows` (체크리스트 발화·배점) — 컬렉션관리부 9 항목

| 컬럼 | 타입 | NULL | 한국어 의미 / 설명 |
|----|----|----|----|
| `ID`              | text    | NN | 콜 ID. FK → `qa_calls(ID)` ON DELETE CASCADE |
| `order_no`        | integer | NN | 항목 순서 1~9 |
| `category`        | text    | NN | 대분류 (`'친절도'` / `'맞춤 응대 스킬'` / `'업무 정확도'` / `'사후 처리'`) |
| `item`            | text    | NN | 항목명 (예: `'첫인사'`) |
| `agent_utterance` | text    | NN | 항목과 매칭된 상담사 대표 발화 |
| `validation_time` | text    | NN | 만점 표기. `'배점 N'` 형식 (예: `'배점 5'`). 직무별 만점 매트릭스 사용 |

**제약**
- PK: (`ID`, `order_no`)
- FK: `ID` → `qa_calls(ID)` ON DELETE CASCADE

**직무별 만점 매트릭스 (validation_time 결정 근거)**

| order_no | category    | item     | PDS1 | PDS2 | PDS3 | 수동대인 | 인바운드 |
|---------:|-----------|---------|----:|----:|----:|------:|------:|
| 1 | 친절도          | 첫인사     |  3 |  3 |  3 |  3 |  5 |
| 2 | 친절도          | 본인 확인  |  4 |  4 |  4 |  4 |  5 |
| 3 | 친절도          | 종료 인사  |  3 |  3 |  3 |  3 |  5 |
| 4 | 친절도          | 음성       |  5 |  4 |  4 |  4 |  5 |
| 5 | 친절도          | 언어 표현  |  5 |  3 | 10 | 10 | 10 |
| 6 | 맞춤 응대 스킬  | 기반 형성  | 16 | 20 | 10 | 10 | 20 |
| 7 | 맞춤 응대 스킬  | 회수 스킬  | 20 | 20 | 20 | 20 | 15 |
| 8 | 업무 정확도     | 업무 정확도| 20 | 20 | 20 | 20 | 15 |
| 9 | 사후 처리       | 이력 등록  | 10 | 10 | 10 | 10 | 10 |
|   |               | **합계**  | **86** | **87** | **84** | **84** | **90** |

---

### 2.4 `qa_evaluation_rows` (9 항목 평가 점수) — 컬렉션관리부

| 컬럼 | 타입 | NULL | 한국어 의미 / 설명 |
|----|----|----|----|
| `ID`           | text             | NN | 콜 ID. FK → `qa_calls(ID)` ON DELETE CASCADE |
| `order_no`     | integer          | NN | 항목 순서 1~9. `qa_checklist_rows.order_no` 와 1:1 대응 |
| `category`     | text             | NN | 대분류 |
| `item`         | text             | NN | 항목명 |
| `reason_text`  | text             | NN | 평가 사유 (AI 자동 생성 멘트). 미제공 시 `'(사유 미제공)'` |
| `ai_eval`      | double precision | NN | AI 평가 점수 (0 ~ 해당 항목 만점) |
| `manual_eval`  | double precision | NN | 수기 평가 점수. 미수기 시 `ai_eval` 과 동일 |

**제약**
- PK: (`ID`, `order_no`)
- FK: `ID` → `qa_calls(ID)` ON DELETE CASCADE

> `ai_eval ≠ manual_eval` 인 항목이 1개라도 있으면 "수기 보정 있음" 으로 간주됨.

---

### 2.5 `qa_analysis_report` (Pentagon 5축 분석·코멘트) — 컬렉션관리부

| 컬럼 | 타입 | NULL | 한국어 의미 / 설명 |
|----|----|----|----|
| `ID`           | text    | NN | 콜 ID. FK → `qa_calls(ID)` ON DELETE CASCADE |
| `item_type_no` | integer | NN | 1~5 = Pentagon 축, 99 = summary |
| `item_type`    | text    | NN | 축 이름 (또는 `'summary'`) |
| `rating`       | text    | Y  | 등급 라벨. `'우수'`/`'보통'`/`'주의'`/`'실패'`. item_type_no=99 행은 NULL |
| `comment`      | text    | NN | 분석 코멘트 |
| `summary`      | text    | Y  | 종합 의견. item_type_no=99 행에서만 채움 |

**제약**
- PK: (`ID`, `item_type_no`)
- FK: `ID` → `qa_calls(ID)` ON DELETE CASCADE

**Pentagon 5축 매핑 (item_type_no ↔ 9 항목)**

| item_type_no | item_type        | 매핑 카테고리 / order_no                |
|-------------:|------------------|--------------------------------------|
| 1            | 인사·본인확인     | 친절도 · order_no 1, 2, 3            |
| 2            | 응대 화법·음성    | 친절도 · order_no 4, 5               |
| 3            | 경청·공감 응대    | 맞춤 응대 스킬 · order_no 6, 7       |
| 4            | 업무 정확도       | 업무 정확도 · order_no 8             |
| 5            | 사후 처리         | 사후 처리 · order_no 9               |
| 99           | summary          | 종합 의견                              |

**점수 구간 → 표준 등급 (rating derive 규칙, 외부 미제공 시)**

| 구간 | rating |
|----|------|
| ≥ 90 | `우수` |
| ≥ 80 | `보통` |
| ≥ 70 | `주의` |
| 그 외 | `실패` |

---

### 2.6 `qa_consumer_eval_rows` (20 항목 Y/N) — 소비자보호부

| 컬럼 | 타입 | NULL | 한국어 의미 / 설명 |
|----|----|----|----|
| `ID`                | text    | NN | 콜 ID. FK → `qa_calls(ID)` ON DELETE CASCADE |
| `item_no`           | integer | NN | 항목 순서 1~20 |
| `major_category`    | text    | NN | 대분류 (4종) |
| `sub_no`            | integer | NN | 대분류 내 번호 |
| `criterion`         | text    | NN | 평가 기준 (예: `'고지의 의무'`) |
| `item_text`         | text    | NN | 평가항목 전문 |
| `yn`                | text    | NN | Y/N. CHECK: `'Y'` 또는 `'N'` |
| `detail_text`       | text    | Y  | 세분 내용/사유 (위반 시 권장) |
| `evidence_line_no`  | integer | Y  | 근거 발화의 `qa_conversations.turn_no` |
| `evidence_text`     | text    | Y  | 근거 발화 원문 |

**제약**
- PK: (`ID`, `item_no`)
- FK: `ID` → `qa_calls(ID)` ON DELETE CASCADE
- CHECK: `qa_consumer_eval_rows_yn_chk` (`yn IN ('Y', 'N')`)

**채점 룰**
- 만점 20점 (각 항목 1점, 부분 감점 없음)
- `yn = 'N'` 1건당 -1점
- 총점 = 20 − N건 수 (점수 컬럼은 두지 않고 백엔드에서 derive)

**20 항목 고정 매핑 (item_no 1~20)**

| item_no | major_category   | sub_no | criterion              |
|---:|-------------------|---:|----------------------|
| 1  | 1. 금소법준수여부     | 1 | 고지의 의무                |
| 2  | 1. 금소법준수여부     | 2 | 적합성원칙안내              |
| 3  | 1. 금소법준수여부     | 3 | 불공정 영업행위 금지         |
| 4  | 1. 금소법준수여부     | 4 | 부당권유 행위 금지           |
| 5  | 1. 금소법준수여부     | 5 | 계약서류 제공 의무           |
| 6  | 1. 금소법준수여부     | 6 | 상품설명 이해여부 확인       |
| 7  | 1. 금소법준수여부     | 7 | 불공정 영업행위 금지         |
| 8  | 2. 방문판매모범규준   | 1 | 판매절차 적정성             |
| 9  | 2. 방문판매모범규준   | 2 | 판매절차 적정성             |
| 10 | 2. 방문판매모범규준   | 3 | 판매절차 적정성             |
| 11 | 3. 금융취약계층대상   | 1 | 설명의 의무                  |
| 12 | 3. 금융취약계층대상   | 2 | 설명의 의무                  |
| 13 | 3. 금융취약계층대상   | 3 | 상품설명 이해여부 확인       |
| 14 | 3. 금융취약계층대상   | 4 | 상품설명 이해여부 확인       |
| 15 | 4. 불완전판매개연성   | 1 | 상품설명 정확성&전달력       |
| 16 | 4. 불완전판매개연성   | 2 | 상품설명 정확성&전달력       |
| 17 | 4. 불완전판매개연성   | 3 | 상품설명 정확성&전달력       |
| 18 | 4. 불완전판매개연성   | 4 | 상품설명 정확성&전달력       |
| 19 | 4. 불완전판매개연성   | 5 | 상품설명 정확성&전달력       |
| 20 | 4. 불완전판매개연성   | 6 | 상품설명 정확성&전달력       |

> `item_text` 전문은 `docs/DB_SCHEMA.md §5-1` 표 참조 (20개 행 모두 정의됨).

---

### 2.7 `qa_consumer_keywords` (금칙어 감지) — 소비자보호부

| 컬럼 | 타입 | NULL | 한국어 의미 / 설명 |
|----|----|----|----|
| `keyword_id`     | integer | NN | 금칙어 row ID (PK, `serial`, auto increment) |
| `ID`             | text    | NN | 콜 ID. FK → `qa_calls(ID)` ON DELETE CASCADE |
| `level`          | text    | NN | 위험도 등급 (8종, 아래 표 참조) |
| `major_category` | text    | NN | 대분류 (38종 후보, `금칙어.csv` 사전 참조) |
| `sub_category`   | text    | NN | 세부 카테고리 |
| `keyword`        | text    | NN | 감지된 단어 원문 |
| `line_no`        | integer | Y  | `qa_conversations.turn_no` |
| `line_text`      | text    | Y  | 발화 컨텍스트 원문 |

**제약**
- PK: (`keyword_id`)
- FK: `ID` → `qa_calls(ID)` ON DELETE CASCADE
- 시퀀스: `qa_consumer_keywords_keyword_id_seq` (OWNED BY)

**인덱스**
- `qa_consumer_keywords_pkey` (PK)
- `idx_qa_consumer_keywords_id` (`ID`)

**`level` 분류 (8종)**

| level | 비고 |
|----|----|
| `Level 1 - 최고위험` | 법적 리스크·욕설·허위과장·불완전판매·고령자 보호 위반·적합성원칙 위반 |
| `Level 2 - 고위험` | 반말/하대·감정 표현·고객 비난·청약철회권·카드론·할부 |
| `Level 3 - 중위험` | 방어적 응대·소극적 응대·연회비 조건·실적/혜택 미고지 |
| `부서특화 - 채권팀` | 채권 독촉 |
| `부서특화 - 심사발급팀` | 심사 부정 단정·개인정보 언급 |
| `부서특화 - CRM팀` | 응대 거부·불친절·대기 유발 |
| `부서특화 - 법률지원팀` | 위협적 표현·일방적 주장 |
| `부서특화 - 소비자보호팀` | 방어적 태도·처리 지연 |

> 점수 차감은 없음 (UI 노출/하이라이트 및 AI 분석대상 판정 입력 신호용).

---

### 2.8 `qa_consumer_ai_categories` (12 카테고리 적합도) — 소비자보호부

| 컬럼 | 타입 | NULL | 한국어 의미 / 설명 |
|----|----|----|----|
| `ID`             | text          | NN | 콜 ID. FK → `qa_calls(ID)` ON DELETE CASCADE |
| `category_no`    | integer       | NN | 카테고리 번호 1~12 |
| `major_category` | text          | NN | 대분류 (4종) |
| `sub_category`   | text          | NN | 소분류 (12종 중 1) |
| `score`          | numeric(5,2)  | NN | 적합도 점수. CHECK: 0 ≤ score ≤ 100 |

**제약**
- PK: (`ID`, `category_no`)
- FK: `ID` → `qa_calls(ID)` ON DELETE CASCADE
- CHECK: `qa_consumer_ai_categories_score_chk`

**12 카테고리 고정 매핑 (category_no 1~12)**

| category_no | major_category    | sub_category  |
|---:|------------------|---------------|
| 1  | 1. 리스크 관리       | A. 법적 리스크 감지 |
| 2  | 1. 리스크 관리       | B. 민원 전환 가능성  |
| 3  | 1. 리스크 관리       | C. 컴플라이언스 위반  |
| 4  | 2. 품질 관리         | A. 응대 품질 저하   |
| 5  | 2. 품질 관리         | B. 설명 부족      |
| 6  | 2. 품질 관리         | C. 우수 응대      |
| 7  | 3. 프로세스 개선     | A. 고객 제안      |
| 8  | 3. 프로세스 개선     | B. 반복 문의      |
| 9  | 3. 프로세스 개선     | C. 시스템 오류     |
| 10 | 4. 비즈니스 인사이트  | A. 상품 관심      |
| 11 | 4. 비즈니스 인사이트  | B. 경쟁사 언급      |
| 12 | 4. 비즈니스 인사이트  | C. 해지 사유      |

> 한 콜은 항상 12 row 모두 채움 (점수 0 이어도 row 존재). 60점 미만은 막대그래프에만 표시, 60+ 만 요약 카드 노출.

---

## 3. 평가 정의 / Few-shot 자원 테이블

> AI Agent 는 이 테이블들에 직접 row 를 적재하지 않는다. **읽기 전용 입력**으로 참조 가능 (org 별 평가 기준·프롬프트·골든셋).

### 3.1 `eval_item_defs` (평가항목 정의·프롬프트) — 편집 가능, 버전 관리

| 컬럼 | 타입 | NULL | 기본값 | 한국어 의미 / 설명 |
|----|----|----|------|----|
| `id`               | integer (serial) | NN | —          | 평가항목 row ID (PK) |
| `org_id`           | integer          | NN | —          | 브랜드 ID. FK → `organizations(id)` ON DELETE CASCADE |
| `order_no`         | integer          | NN | —          | 항목 순서 |
| `category`         | text             | NN | —          | 카테고리명 |
| `item`             | text             | NN | —          | 항목명 |
| `criterion`        | text             | Y  | —          | 평가 기준 텍스트 |
| `prompt_template`  | text             | Y  | —          | AI 평가용 프롬프트 템플릿 |
| `department`       | text             | NN | `'기본'`   | 부서별 버전 스코프 |
| `version`          | integer          | NN | `1`        | 부서별 버전번호 |
| `effective_from`   | timestamptz      | NN | `now()`    | 효력 시작 시점 |
| `deactivated_at`   | timestamptz      | Y  | —          | 비활성화 시점 |
| `updated_at`       | timestamptz      | NN | `now()`    | 마지막 수정 시점 |
| `pentagon_axis`    | text             | Y  | —          | Pentagon 축 라벨 (12_eval_item_meta.sql) |
| `scoring_type`     | text             | NN | `'numeric'`| 채점 방식. CHECK: `'numeric'` 또는 `'yes_no'` |
| `max_score`        | integer          | Y  | —          | numeric 항목의 만점 |
| `is_active`        | boolean          | NN | `true`     | 활성 여부 |

**제약**
- PK: (`id`)
- FK: `org_id` → `organizations(id)` ON DELETE CASCADE
- UNIQUE: `eval_item_defs_versioned_uk` (`org_id`, `department`, `order_no`, `version`)
- CHECK: `eval_item_defs_scoring_type_chk`

**인덱스**
- `idx_eval_item_defs_org` (`org_id`, `order_no`)
- `idx_eval_item_defs_effective` (`org_id`, `department`, `effective_from DESC`)

---

### 3.2 `eval_item_change_log` (평가항목 변경 이력) — 영구 보관

| 컬럼 | 타입 | NULL | 한국어 의미 / 설명 |
|----|----|----|----|
| `id`                  | integer (serial) | NN | 이력 row ID (PK) |
| `org_id`              | integer          | NN | 브랜드 ID. FK → `organizations(id)` ON DELETE CASCADE |
| `department`          | text             | NN | 부서명 |
| `order_no`            | integer          | NN | 항목 순서 |
| `item_name`           | text             | Y  | 항목명 스냅샷 |
| `category_name`       | text             | Y  | 카테고리명 스냅샷 |
| `version`             | integer          | Y  | 참조 버전 |
| `change_type`         | text             | NN | 변경 유형. `'criterion_update'` / `'prompt_update'` / `'item_rename'` / `'new_version'` / `'deactivate'` / `'create'` |
| `before_json`         | jsonb            | Y  | 변경 전 스냅샷 |
| `after_json`          | jsonb            | Y  | 변경 후 스냅샷 |
| `user_id`             | integer          | Y  | 변경자 사용자 ID (admin_users 논리적 참조). 14 마이그레이션 후 (구: `actor_user_id`) |
| `login_id`            | text             | Y  | 변경자 로그인 ID (캐시). 14 마이그레이션 후 (구: `actor_login_id`) |
| `display_name`        | text             | Y  | 변경자 표시 이름 (캐시). 14 마이그레이션 후 (구: `actor_display_name`) |
| `changed_at`          | timestamptz      | NN | 변경 시각. DEFAULT `now()` |

**인덱스**
- `idx_eval_item_change_log_lookup` (`org_id`, `department`, `order_no`, `changed_at DESC`)
- `idx_eval_item_change_log_org_time` (`org_id`, `changed_at DESC`)

---

### 3.3 `pentagon_axes` (Pentagon 5축 정의·프롬프트) — 편집 가능

| 컬럼 | 타입 | NULL | 기본값 | 한국어 의미 / 설명 |
|----|----|----|------|----|
| `id`               | integer (serial) | NN | —          | 축 정의 row ID (PK) |
| `org_id`           | integer          | NN | —          | 브랜드 ID. FK → `organizations(id)` ON DELETE CASCADE |
| `department`       | text             | NN | `'기본'`   | 부서별 버전 스코프 |
| `axis_no`          | integer          | NN | —          | 축 번호 |
| `label`            | text             | NN | —          | 축 라벨 (예: `'인사·본인확인'`) |
| `description`      | text             | Y  | —          | 축 설명 |
| `prompt_template`  | text             | Y  | —          | AI 평가용 프롬프트 (축 단위) |
| `is_active`        | boolean          | NN | `true`     | 활성 여부 |
| `version`          | integer          | NN | `1`        | 버전번호 |
| `effective_from`   | timestamptz      | NN | `now()`    | 효력 시작 시점 |
| `deactivated_at`   | timestamptz      | Y  | —          | 비활성화 시점 |
| `updated_at`       | timestamptz      | NN | `now()`    | 마지막 수정 시점 |

**제약**
- PK: (`id`)
- FK: `org_id` → `organizations(id)` ON DELETE CASCADE
- UNIQUE: `pentagon_axes_versioned_uk` (`org_id`, `department`, `axis_no`, `version`)

**인덱스**
- `idx_pentagon_axes_org` (`org_id`, `axis_no`)
- `idx_pentagon_axes_effective` (`org_id`, `department`, `effective_from DESC`)

---

### 3.4 `pentagon_axis_change_log` (Pentagon 축 변경 이력) — 영구 보관

| 컬럼 | 타입 | NULL | 한국어 의미 / 설명 |
|----|----|----|----|
| `id`                  | integer (serial) | NN | 이력 row ID (PK) |
| `org_id`              | integer          | NN | 브랜드 ID. FK → `organizations(id)` ON DELETE CASCADE |
| `department`          | text             | NN | 부서명 |
| `axis_no`             | integer          | NN | 축 번호 |
| `label_snapshot`      | text             | Y  | 축 라벨 스냅샷 |
| `version`             | integer          | Y  | 참조 버전 |
| `change_type`         | text             | NN | 변경 유형. `'create'` / `'label_rename'` / `'description_update'` / `'prompt_update'` / `'deactivate'` / `'reactivate'` / `'new_version'` |
| `before_json`         | jsonb            | Y  | 변경 전 스냅샷 |
| `after_json`          | jsonb            | Y  | 변경 후 스냅샷 |
| `user_id`             | integer          | Y  | 변경자 사용자 ID (admin_users 논리적 참조). 14 마이그레이션 후 |
| `login_id`            | text             | Y  | 변경자 로그인 ID (캐시). 14 마이그레이션 후 |
| `display_name`        | text             | Y  | 변경자 표시 이름 (캐시). 14 마이그레이션 후 |
| `changed_at`          | timestamptz      | NN | 변경 시각. DEFAULT `now()` |

**인덱스**
- `idx_pentagon_axis_change_log_lookup` (`org_id`, `department`, `axis_no`, `changed_at DESC`)
- `idx_pentagon_axis_change_log_org_time` (`org_id`, `changed_at DESC`)

---

### 3.5 `qa_golden_set` (골든셋/Few-shot 예시) — AI 입력 자원

> 검수자가 검수 중 "이건 모범 답안" 으로 박제한 콜 항목. **14 마이그레이션 후 컬럼 10개로 정리.**
> 등록자는 항상 `qa_calls.user_id` (검수자) 와 동일하므로 별도 user 컬럼 없음. 수정 이력은 `qa_audit_logs` (`resource_type='qa_golden_set'`) 에 적재.

| 컬럼 | 타입 | NULL | 기본값 | 한국어 의미 / 설명 |
|----|----|----|------|----|
| `golden_id`         | integer (serial) | NN | —      | 골든셋 row ID (PK) |
| `qa_id`             | text             | NN | —      | 콜 ID. FK → `qa_calls(ID)` ON DELETE CASCADE. 등록자(검수자)는 `qa_calls.user_id` 로 추적 |
| `order_no`          | integer          | NN | —      | 항목 순서 (1~9) |
| `org_id`            | integer          | Y  | —      | 브랜드 ID. FK → `organizations(id)` ON DELETE SET NULL |
| `category`          | text             | NN | —      | 카테고리명 (등록 시점 박제) |
| `item`              | text             | NN | —      | 항목명 (등록 시점 박제) |
| `reason_text`       | text             | Y  | —      | 평가 사유 |
| `agent_utterance`   | text             | Y  | —      | 상담사 발화 원문 |
| `score`             | double precision | NN | —      | 확정 점수 (manual = ai) |
| `created_at`        | timestamptz      | NN | `now()`| 등록 시점 |

**제약**
- PK: (`golden_id`)
- UNIQUE: (`qa_id`, `order_no`) — 한 콜의 한 항목은 최대 1건
- FK: `qa_id` → `qa_calls(ID)` ON DELETE CASCADE / `org_id` → `organizations(id)` ON DELETE SET NULL

**인덱스**
- `idx_qa_golden_set_lookup` (`org_id`, `category`, `item`)
- `idx_qa_golden_set_created` (`created_at DESC`)

> **14 마이그레이션으로 드롭된 4 컬럼**: `call_datetime` (→ `qa_calls.CDATE` JOIN), `created_by_user_id` / `created_by_login_id` / `created_by_display_name` (→ `qa_calls.user_id` JOIN, 또는 수정자는 `qa_audit_logs`).

---

## 4. 시스템 / 감사 테이블

### 4.1 `domains` (업종 상위 분류)

| 컬럼 | 타입 | NULL | 기본값 | 한국어 의미 / 설명 |
|----|----|----|----|----|
| `id`         | integer (serial) | NN | — | 업종 ID (PK) |
| `name`       | text             | NN | — | 업종명 (예: `'금융'`) |
| `key`        | text             | NN | `''` | 업종 키 (예: `'finance'`) |
| `sort_order` | integer          | NN | `0` | 정렬 순서 |
| `active`     | boolean          | NN | `true` | 활성 여부 |
| `created_at` | timestamptz      | NN | `now()` | 등록 시각 |

**제약**: PK (`id`)
**인덱스**
- `idx_domains_key`: UNIQUE (`key`) WHERE `key <> ''`
- `idx_domains_sort` (`sort_order`, `id`)

---

### 4.2 `organizations` (브랜드/조직)

| 컬럼 | 타입 | NULL | 기본값 | 한국어 의미 / 설명 |
|----|----|----|----|----|
| `id`         | integer (serial) | NN | — | 브랜드 ID (PK). 신한=1 |
| `name`       | text             | NN | — | 브랜드명 (예: `'신한카드'`) |
| `short`      | text             | NN | `''` | 단축 라벨 (1~2자, 브랜드 타일용) |
| `color`      | text             | NN | `'#055AAF'` | 브랜드 HEX 컬러 |
| `active`     | boolean          | NN | `true` | 활성 여부 |
| `domain_id`  | integer          | Y  | — | 업종 ID. FK → `domains(id)` ON DELETE SET NULL |
| `created_at` | timestamptz      | NN | `now()` | 등록 시각 |

**인덱스**
- `idx_organizations_domain` (`domain_id`)
- `idx_organizations_active` (`active`)

---

### 4.3 `admin_users` (계정/검수자) — 시스템 사용자 마스터

| 컬럼 | 타입 | NULL | 기본값 | 한국어 의미 / 설명 |
|----|----|----|----|----|
| `user_id`              | integer (serial) | NN | — | 사용자 ID (PK) |
| `login_id`             | text             | NN | — | 로그인 ID (UNIQUE, 사실상 불변 식별자) |
| `password_hash`        | text             | NN | — | 비밀번호 해시 |
| `display_name`         | text             | NN | — | 표시 이름 (변경 가능) |
| `role`                 | text             | NN | `'admin'` | 권한 (`'admin'` / 확장: `'super_admin'`) |
| `is_active`            | smallint         | NN | `1` | 활성 여부 (0=비활성, 1=활성) |
| `created_at`           | timestamptz      | NN | `now()` | 계정 생성 시각 |
| `updated_at`           | timestamptz      | NN | `now()` | 마지막 수정 시각 |
| `org_id`               | integer          | Y  | — | 소속 브랜드. FK → `organizations(id)` ON DELETE SET NULL |
| `department`           | text             | Y  | — | 부서명 |
| `profile_image_path`   | text             | Y  | — | 프로필 이미지 경로 |
| `must_change_password` | boolean          | NN | `false` | 다음 로그인 시 비밀번호 변경 강제 |

**제약**: PK (`user_id`), UNIQUE (`login_id`)

---

### 4.4 `qa_audit_logs` (감사 로그/사용자 활동) — 3일 retention

> 14 마이그레이션 후 `actor_*` prefix 제거. 컬럼명은 `admin_users` 와 동일하게 통일.

| 컬럼 | 타입 | NULL | 기본값 | 한국어 의미 / 설명 |
|----|----|----|----|----|
| `audit_id`         | integer (serial) | NN | — | 감사 row ID (PK) |
| `created_at`       | timestamptz      | NN | `now()` | 감사 발생 시각 |
| `user_id`          | integer          | Y  | — | 행위자 사용자 ID (admin_users 논리적 참조). 14 마이그레이션 후 (구: `actor_user_id`) |
| `login_id`         | text             | NN | — | 행위자 로그인 ID (캐시). 14 마이그레이션 후 (구: `actor_login_id`) |
| `display_name`     | text             | Y  | — | 행위자 표시 이름 (캐시). 14 마이그레이션 후 (구: `actor_display_name`) |
| `role`             | text             | Y  | — | 행위자 권한 (캐시). 14 마이그레이션 후 (구: `actor_role`) |
| `action`           | text             | NN | — | 액션 코드 (`'AUTH_LOGIN_SUCCESS'`/`'QA_GOLDEN_SET_ADD'`/`'QA_MANUAL_EVAL_SAVE'` 등) |
| `resource_type`    | text             | NN | — | 자원 타입 (`'qa_calls'`/`'qa_evaluation_rows'`/`'qa_golden_set'` 등) |
| `resource_id`      | text             | NN | — | 자원 ID |
| `http_method`      | text             | Y  | — | HTTP 메소드 |
| `http_path`        | text             | Y  | — | HTTP 경로 |
| `client_ip`        | text             | Y  | — | 클라이언트 IP |
| `user_agent`       | text             | Y  | — | User-Agent 헤더 |
| `detail_json`      | text             | Y  | — | 상세 (JSON 직렬화 텍스트, before/after 스냅샷 포함) |
| `success`          | smallint         | NN | `1` | 성공 여부 (0/1) |
| `error_message`    | text             | Y  | — | 실패 사유 |

**인덱스** (14 마이그레이션 후)
- `idx_qa_audit_action` (`action`, `created_at DESC`)
- `idx_qa_audit_user_time` (`login_id`, `created_at DESC`) ← 14 마이그레이션 RENAME (구: `idx_qa_audit_actor_time`)
- `idx_qa_audit_created` (`created_at DESC`)
- `idx_qa_audit_resource` (`resource_type`, `resource_id`)

> 3일 이상 경과 row 는 retention job 으로 정리.

---

## 5. 샌드박스 스냅샷 테이블 (읽기 전용)

`qa_calls.is_sandbox = true` 콜의 사본 보존용. 샌드박스 세션 정리(`DELETE FROM qa_calls WHERE is_sandbox=true`) 후에도 보존하기 위해 별도 테이블로 분리.

| 테이블 (한국어 의미) | 부모 테이블 | 컬럼 구조 |
|----|----|----|
| `qa_calls__sandbox_snapshot` (콜 메타 사본) | `qa_calls` | 부모 컬럼 사본 (단, `org_id` 만 02 마이그레이션으로 추가됨. 11/14 미적용) |
| `qa_conversations__sandbox_snapshot` (STT 사본) | `qa_conversations` | 부모 컬럼 사본 |
| `qa_checklist_rows__sandbox_snapshot` (체크리스트 사본) | `qa_checklist_rows` | 부모 컬럼 사본 |
| `qa_evaluation_rows__sandbox_snapshot` (평가 점수 사본) | `qa_evaluation_rows` | 부모 컬럼 사본 |
| `qa_analysis_report__sandbox_snapshot` (Pentagon 사본) | `qa_analysis_report` | 부모 컬럼 사본 |
| `qa_consumer_eval_rows__sandbox_snapshot` (20 항목 사본) | `qa_consumer_eval_rows` | 부모 컬럼 사본 |
| `qa_consumer_keywords__sandbox_snapshot` (금칙어 사본) | `qa_consumer_keywords` | 부모 컬럼 사본 |
| `qa_consumer_ai_categories__sandbox_snapshot` (12 카테고리 사본) | `qa_consumer_ai_categories` | 부모 컬럼 사본 |
| `qa_audit_logs__sandbox_snapshot` (감사 로그 사본) | `qa_audit_logs` | 부모 컬럼 사본 (14 의 `user_id`/`login_id`/`display_name`/`role` RENAME 적용됨) |

> 외부 FK 없음. AI Agent 가 직접 쓰지 않음.

---

## 6. 시퀀스 목록

| 시퀀스 | OWNED BY |
|----|----|
| `admin_users_user_id_seq`                  | `admin_users.user_id` |
| `qa_audit_logs_audit_id_seq`               | `qa_audit_logs.audit_id` |
| `qa_consumer_keywords_keyword_id_seq`      | `qa_consumer_keywords.keyword_id` |
| `domains_id_seq`                           | `domains.id` |
| `organizations_id_seq`                     | `organizations.id` |
| `eval_item_defs_id_seq`                    | `eval_item_defs.id` |
| `eval_item_change_log_id_seq`              | `eval_item_change_log.id` |
| `pentagon_axes_id_seq`                     | `pentagon_axes.id` |
| `pentagon_axis_change_log_id_seq`          | `pentagon_axis_change_log.id` |

---

## 7. 부서별 사용 테이블 매트릭스

`qa_calls.department` 값으로 분기. 한 콜은 두 부서를 동시에 점유하지 않음.

| 테이블 | 컬렉션관리부 | 소비자보호부 | 고객센터(한화) | 고객지원실(지역정보) |
|----|:--:|:--:|:--:|:--:|
| `qa_calls`                  | ✅ | ✅ | ✅ | ✅ |
| `qa_conversations`          | ✅ | ✅ | ✅ | ✅ |
| `qa_checklist_rows`         | ✅ | ❌ | ✅ (브랜드별 분기) | ✅ (브랜드별 분기) |
| `qa_evaluation_rows`        | ✅ | ❌ | ✅ (브랜드별 분기) | ✅ (브랜드별 분기) |
| `qa_analysis_report`        | ✅ | ❌ | ✅ (브랜드별 분기) | ✅ (브랜드별 분기) |
| `qa_consumer_eval_rows`     | ❌ | ✅ | — | — |
| `qa_consumer_keywords`      | ❌ | ✅ | — | — |
| `qa_consumer_ai_categories` | ❌ | ✅ | — | — |

> 한화/지역정보 브랜드의 부서명은 신한과 다르나 평가 트랙은 컬렉션관리부 9 항목 체계를 따른다 (브랜드별 시드 SQL 참조).

---

## 8. 검증 / 거부 룰 (외부 ingest 기준, 참고)

ingest 엔드포인트(`POST /api/ingest/collection-call`) 가 적용하는 검증 규칙. AI Agent 응답이 이 규칙을 위반하면 적재 실패.

- `qa_calls.ID` / `qa_calls.CDATE` 누락 → 400
- `qa_calls.department` 가 CHECK 허용 4종 외 → 400
- `qa_calls.role` 이 CHECK 허용 6종 외 → 400
- `qa_evaluation_rows.ai_eval` / `manual_eval` 이 숫자 아님 또는 해당 order 직무 만점 범위 밖 → 400
- `qa_consumer_eval_rows.yn` 이 `'Y'`/`'N'` 외 → DB CHECK 위반
- `qa_consumer_ai_categories.score` 가 0~100 범위 밖 → DB CHECK 위반

---

## 9. 서버가 derive 하는 값 (외부에서 보낼 필요 없음)

| 값 | derive 규칙 |
|----|----|
| `qa_calls.AI_SCORE`    | `Σ(qa_evaluation_rows.ai_eval) / Σ(직무 만점) × 100`. evaluations 없으면 0 |
| `qa_calls.TOTAL_SCORE` | 위와 동일. 단, 9개 중 1건이라도 `manual_eval ≠ ai_eval` 이면 `manual_eval` 기준 |
| `qa_checklist_rows.validation_time` | `'배점 N'`, N = 해당 order 의 직무 만점 |
| `qa_checklist_rows.category` / `item` | 만점 매트릭스 표준 라벨로 덮어씀 |
| `qa_analysis_report` (외부 report 미전송 시) | 5축 점수 + 표준 라벨/코멘트/summary (evaluations 9개 모두 있을 때) |

---

## 10. 외부 참고 문서

- `docs/AI_AGENT_OUTPUT_SPEC.md` — AI Agent 응답(Output) 형식 명세서.
- `docs/DB_SCHEMA.md` — PoC v2 시드 데이터 채우기 안내 (8개 코어 테이블 중심).
- `docs/EVALUATION_ITEMS.md` — 9 항목 / Pentagon 5축 / 20 항목 평가 기준 SSOT.
- `docs/EXTERNAL_API_GUIDE.md` — 외부 ingest 엔드포인트 JSON 명세 (컬렉션관리부 1콜).

---

## 변경 이력

- **2026-06-01 (v1.1)** — `14_unify_user_columns.sql` 적용 후 상태 반영. `qa_calls.reviewed_by_user_id` → `user_id`, `qa_audit_logs` / `eval_item_change_log` / `pentagon_axis_change_log` 의 `actor_*` → `user_id` / `login_id` / `display_name` / `role` 로 RENAME. `qa_golden_set` 의 user 캐시 3종 (`created_by_*`) + `call_datetime` DROP. 인덱스 `idx_qa_audit_actor_time` → `idx_qa_audit_user_time` RENAME, `idx_qa_golden_set_creator` DROP. 모든 테이블에 한국어 의미 추가.
- **2026-05-29 (초안)** — 전체 init SQL 13종 + server/index.js 동적 DDL 누적 결과를 단일 인벤토리로 정리.
