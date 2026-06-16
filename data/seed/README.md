# QA Dashboard — Baseline Seed 데이터 (고객사 PoC)

DB 적재용 mock 데이터 묶음. `docs/DB_SCHEMA.md` v2 (2026-05-08) 기준.

## 설계 원칙

- **시드는 운영 데이터의 예시 1세트**입니다. 실 운영에서는 STT/AI Agent 가 동일 컬럼 구조로 row 를 채워 넣습니다.
- **표준 금칙어 사전(`금칙어.csv`)은 DB 적재 대상이 아닙니다.** 사전은 명세/참조 자료일 뿐이며, AI Agent 가 STT 분석 후 사전과 매칭되는 분류값으로 `qa_consumer_keywords` 에 row 를 적재합니다. 시드 데이터의 분류 라벨도 사전과 정합되어야 합니다 (자동 검증).
- **재생성 SSOT 는 [_generate_seed.py](_generate_seed.py)**. CSV 를 손으로 고치지 말고 스크립트를 수정하고 다시 실행하세요.

## 파일 구성

| 파일                              | 행 수 | 설명                                           |
| ------------------------------- | --- | -------------------------------------------- |
| `qa_calls.csv`                  | 8   | 콜 메타 (컬렉션 5 + 소비자 3)                          |
| `qa_conversations.csv`          | 92  | STT 전사. 콜당 8~15 turn                          |
| `qa_checklist_rows.csv`         | 45  | 컬렉션 9개 항목 발화/배점 (5콜 × 9)                      |
| `qa_evaluation_rows.csv`        | 45  | 컬렉션 9개 항목 AI/수기 점수 (5콜 × 9)                   |
| `qa_analysis_report.csv`        | 30  | 컬렉션 Pentagon 5축 + summary (5콜 × 6)            |
| `qa_consumer_eval_rows.csv`     | 60  | 소비자 20 항목 Y/N (3콜 × 20)                       |
| `qa_consumer_keywords.csv`      | 5   | 소비자 금칙어 감지 (분석대상 O 콜만, 사전 정합)                 |
| `qa_consumer_ai_categories.csv` | 36  | 소비자 AI 12 카테고리 적합도 (3콜 × 12)                  |
| `load.sql`                      | —   | 8개 CSV 를 \COPY 로 적재하는 SQL                     |
| `_generate_seed.py`             | —   | 위 CSV 들을 만든 Python 스크립트 (재생성 SSOT)            |

> ❌ **`qa_consumer_keyword_master.csv` 는 적재 대상 아님.** 표준 사전은 [`금칙어.csv`](../../금칙어.csv) 1개 파일로 명세에만 보관합니다.

## 적재 방법

### 1) Docker 환경

`\COPY` 가 컨테이너 내부 cwd 의 상대경로로 동작하므로, 호스트의 `data/seed/` 를 컨테이너로 복사한 뒤 실행합니다.

```bash
cd /home/metam/Workspace/01-AI-QA_Dashboard
sudo docker exec qa-ai-postgres mkdir -p /tmp/data
sudo docker cp data/seed qa-ai-postgres:/tmp/data/
sudo docker exec -w /tmp qa-ai-postgres psql -U qa -d qa_dashboard -v ON_ERROR_STOP=1 -f data/seed/load.sql
```

> 컨테이너 이름·DB명·유저는 `docker-compose.yml` 환경에 따라 조정.

### 2) 로컬 psql

```bash
cd /home/metam/Workspace/01-AI-QA_Dashboard
# .env 로딩 후 psql (POSTGRES_USER · POSTGRES_PASSWORD · POSTGRES_DB)
set -a; . ./.env; set +a
PGPASSWORD="$POSTGRES_PASSWORD" psql -h localhost -p 5434 -U "$POSTGRES_USER" -d "$POSTGRES_DB" -f data/seed/load.sql
```

> `\COPY` 가 클라이언트 상대경로로 동작하므로, **반드시 프로젝트 루트에서 실행**.

### 3) 재생성 후 재적재 (스키마 변경 없음)

```bash
python3 data/seed/_generate_seed.py            # CSV 재생성 + 사전 정합 검증
sudo docker cp data/seed qa-ai-postgres:/tmp/data/
sudo docker exec -w /tmp qa-ai-postgres psql -U qa -d qa_dashboard -f data/seed/load.sql
```

### 4) 스키마 변경 후 재적재 (DROP + CREATE 다시 돌리기)

`docker/init/postgres/01_init.sql` 은 PostgreSQL 컨테이너의 **첫 부팅 시에만** 실행됩니다. 스키마를 다시 적용하려면 볼륨을 삭제해야 합니다:

```bash
sudo docker compose down
sudo docker volume rm 01-ai-qa_dashboard_qa_ai_pgdata
sudo docker compose up -d
# 컨테이너 health 확인 후
sudo docker exec qa-ai-postgres mkdir -p /tmp/data
sudo docker cp data/seed qa-ai-postgres:/tmp/data/
sudo docker exec -w /tmp qa-ai-postgres psql -U qa -d qa_dashboard -f data/seed/load.sql
```

> ⚠️ 볼륨 삭제는 모든 콜·평가 데이터를 날립니다 (admin 계정·감사 로그도). 운영 단계에서는 별도 마이그레이션 SQL 로 처리해야 합니다.

## 적재 후 검증 쿼리

```sql
-- 부서별 콜 수: 컬렉션 5 / 소비자 3
SELECT department, COUNT(*) FROM qa_calls GROUP BY department;

-- 컬렉션 직무 분포: 5직무 각 1건
SELECT role, COUNT(*) FROM qa_calls
WHERE department='컬렉션관리부' GROUP BY role;

-- 소비자 분석대상 분포: O 2 / X 1
SELECT ai_analysis_target, COUNT(*) FROM qa_calls
WHERE department='소비자보호부' GROUP BY ai_analysis_target;

-- 콜별 자식 행 수
SELECT "ID", COUNT(*) FROM qa_consumer_eval_rows GROUP BY "ID";       -- 각 콜 20
SELECT "ID", COUNT(*) FROM qa_consumer_ai_categories GROUP BY "ID";   -- 각 콜 12
SELECT "ID", COUNT(*) FROM qa_checklist_rows GROUP BY "ID";           -- 각 콜 9
SELECT "ID", COUNT(*) FROM qa_evaluation_rows GROUP BY "ID";          -- 각 콜 9
SELECT "ID", COUNT(*) FROM qa_analysis_report GROUP BY "ID";          -- 각 콜 6

-- 컬렉션 점수 환산 검증 (AI_SCORE 가 9개 ai_eval 합 / 직무만점 × 100 인지)
SELECT c."ID", c.role, c."AI_SCORE", c."TOTAL_SCORE",
       SUM(e.ai_eval) AS ai_sum, SUM(e.manual_eval) AS man_sum
FROM qa_calls c
JOIN qa_evaluation_rows e ON e."ID" = c."ID"
WHERE c.department='컬렉션관리부'
GROUP BY c."ID", c.role, c."AI_SCORE", c."TOTAL_SCORE"
ORDER BY c."ID";

-- 소비자 위반(N) 건수
SELECT "ID", COUNT(*) FILTER (WHERE yn='N') AS violations
FROM qa_consumer_eval_rows GROUP BY "ID" ORDER BY "ID";

-- 금칙어 분포
SELECT "ID", level, COUNT(*) AS hits
FROM qa_consumer_keywords
GROUP BY "ID", level ORDER BY "ID";
```

## 데이터 설계 메모

### 컬렉션관리부 점수 분포

| 콜 ID                 | 직무   | AI_SCORE | TOTAL_SCORE | 수기 보정 |
| -------------------- | ---- | -------- | ----------- | ----- |
| QA-20260308-0001     | PDS1 | 72.09    | 70.93       | 1건    |
| QA-20260308-0002     | PDS2 | 86.21    | 86.21       | 0건    |
| QA-20260308-0003     | PDS3 | 96.43    | 97.62       | 1건    |
| QA-20260308-0004     | 수동대인 | 61.90    | 61.90       | 0건    |
| QA-20260308-0005     | 인바운드 | 87.78    | 88.89       | 1건    |

직무별 만점 매트릭스 (`docs/DB_SCHEMA.md` 섹션 4-1) 그대로 적용:
- PDS1 만점 86 / PDS2 만점 87 / PDS3 만점 84 / 수동대인 만점 84 / 인바운드 만점 90

### 소비자보호부 분포

| 콜 ID                 | 분석대상 | 위반(N) | 금칙어 | AI 카테고리 점수 분포            |
| -------------------- | ---- | ----- | --- | ------------------------ |
| QA-20260308-0006     | O    | 1건    | 0건  | 60+ 2개 / 30~59 1개 / 나머지   |
| QA-20260308-0007     | O    | 5건    | 5건  | 60+ 3개 / 30~59 1개 / 나머지   |
| QA-20260308-0008     | X    | 3건    | 0건  | 12개 모두 score ≤ 30 (분석 미수행) |

### 금칙어 시드 (콜 0007) — 사전 정합

5건 모두 [`금칙어.csv`](../../금칙어.csv) 사전과 `(level, major_category, sub_category, keyword)` 4-튜플 단위로 정확히 일치합니다 (`_generate_seed.py` 가 적재 전 자동 검증).

| turn | level | 대분류 | 소분류 | 금칙어 |
|---|---|---|---|---|
| 7 | Level 1 - 최고위험 | 허위·과장 광고 | 단정적 표현 | 누구나 |
| 7 | Level 1 - 최고위험 | 법적 리스크 | 강압적 표현 | 무조건 |
| 7 | Level 1 - 최고위험 | 허위·과장 광고 | 허위 안내 | 손해없음 |
| 9 | Level 3 - 중위험 | 연회비 | 조건 불명확 | 거의무료 |
| 11 | Level 3 - 중위험 | 방어적 응대 | 불친절 | 약관봐 |

운영 단계에서는 AI Agent 가 STT 결과 발화에서 사전 단어를 탐지해 동일 4-튜플 + `(line_no, line_text)` 로 본 테이블에 적재합니다.

## 재생성 가이드

KEYWORDS dict 를 수정할 때는 사전과 정합되도록 입력하세요. 정합되지 않으면 스크립트가 경고를 출력합니다:

```
[warn] 사전에 없는 콜별 감지 row:
  - QA-20260308-0007: ('Level 3 - 주의', '응대 품질', '과장 표현', '엄청')
```

이 경우 [`금칙어.csv`](../../금칙어.csv) 에 해당 단어를 추가하거나 KEYWORDS 의 분류값을 사전 표기와 일치시키면 됩니다.

```bash
python3 data/seed/_generate_seed.py
```
