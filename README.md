# Meta-Trustguard

상담 STT(통화 전사) 기반 **AI QA(품질평가) 대시보드**. 콜을 평가항목별로 자동 채점하고, 수기 보정·조직 통계·코칭 대상 추적·외부 파이프라인 연동(ingest)을 제공하는 멀티브랜드 SaaS입니다.

## 주요 기능

- **AI + 수기 평가**: AI 점수와 검수자 수기 보정을 병행(수기는 NULL 허용 선택 입력).
- **조직 통계 대시보드**: 기간별·부서별·항목별 평균, 일별 추이, 코칭 대상(80점 미만), 상담사 랭킹.
- **멀티브랜드**: `organizations` 단위 분리, 브랜드별 평가항목 정의(`eval_item_defs`).
- **외부 ingest**: qa-pipeline `/evaluate` 어댑터(`standard` / `collection` 트랙), 커스텀 루브릭 양방향 동기화.
- **실시간 유입(선택)**: AICC MQTT STT 스트림 finish 시 해당 콜 즉시 적재.
- **인증·감사**: 세션 기반 로그인, ICS SSO(선택), 변경 이력 `qa_audit_logs`, 테스트 계정 샌드박스 롤백.

## 기술 스택

| 레이어 | 기술 |
|---|---|
| Frontend | Next.js 15 (App Router, standalone), React 19, Tailwind CSS v4 |
| UI libs | framer-motion, lucide-react |
| Backend API | Node.js 20 (Express 5), `pg` / `mysql2` / `mqtt` |
| Database | PostgreSQL 16-alpine |
| Frontend 서버 / 프록시 | Next.js standalone (Node 20) — 정적·SSR 서빙 + `/api/*` → API 리버스 프록시(rewrites) |
| Infra | Docker Compose, baseline CSV 시더 |

## 시작하기

### 사전 요구사항

- Docker & Docker Compose v2

### 설치

```bash
# 1. 저장소 클론
git clone https://github.com/metam-aicc-platform/SAAS-Meta-Trustguard.git
cd SAAS-Meta-Trustguard

# 2. 환경 변수 설정 — .env 신규 작성 (필수 키는 아래 "환경변수" 표 참조)
vi .env && chmod 600 .env   # POSTGRES_USER / POSTGRES_PASSWORD / POSTGRES_DB 등

# 3. 빌드 + 기동
./deploy.sh
```

| 서비스 | Host 포트 | 컨테이너 |
|---|---|---|
| Dashboard | 3026 | `09-meta-trustguard-dashboard` |
| API | 3027 | `09-meta-trustguard-api` |
| Postgres | 5434 (127.0.0.1) | `09-meta-trustguard-postgres` |

- `./deploy.sh --reset` — DB 볼륨까지 초기화 후 재배포 (**주의: 데이터 삭제**).
- baseline CSV 강제 재시드: `docker compose run --rm qa-ai-seeder --reset`.
- `qa_calls` 가 비어 있을 때만 baseline CSV 가 일괄 적재됩니다(Compose 시더).

### 환경변수

전체 키는 [`docker-compose.yml`](docker-compose.yml) 의 `environment` 블록 참조. 핵심만 요약하면:

| Key | 설명 |
|---|---|
| `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB` | Postgres 컨테이너 자격증명 |
| `INITIAL_USER_PASSWORD` | 신규/재설정 사용자 초기 비밀번호(첫 로그인 시 변경 강제) |
| `ICS_DB_*`, `ICS_SSO_DEFAULT_ORG_ID` | ICS SSO 연동(선택, `ICS_DB_HOST` 비면 비활성) |
| `IPCC_DB_*`, `IPCC_SSH_*` | IPCC 포기호/응답률 연동(선택, autossh 터널) |
| `MQTT_*` | 실시간 STT 스트림 유입(선택, `MQTT_HOST` 비면 비활성) |
| `EVAL_SHARE_TOKEN` | 평가항목 공유(서비스 간 조회) 토큰 |

> `.env` 는 절대 커밋되지 않습니다(`.gitignore`). 운영 자격증명은 별도 시크릿 매니저로 관리하는 것을 권장합니다.

## 외부 연동(ingest)

### qa-pipeline ingest 트랙 (`POST /api/ingest/from-qa-pipeline`)

`body.track` 으로 적재 방식을 선택(미지정 시 `standard`).

| track | 동작 |
|---|---|
| `standard` (기본) | 표준 18항목 1:1 직결 적재(스케일링 없음). 분석 라우트가 Pentagon 5축을 LIVE 도출. 표준 8카테고리 브랜드용 |
| `collection` | 9-order 컬렉션 환산 적재. 컬렉션관리부 직무(PDS) 전용 |

표준 트랙은 콜이 브랜드로 귀속되도록 `call.org_id`(숫자) 또는 `call.brand_name`(예 `"코오롱"`) 중 하나가 필수입니다. 둘 다 없으면 해당 콜은 `failed[]` 로 반환됩니다. 응답 형식은 두 트랙 모두 `{ ok, ingested, failed[], details[] }` 동일.

요청 body 예시:

```json
{
  "track": "standard",
  "calls": [
    {
      "qa_id": "KOLON-20260610-0001",
      "brand_name": "코오롱",
      "cdate": "2026-06-10T10:21:35+09:00",
      "transcript": "상담사: 안녕하세요 ...\n고객: ...",
      "conversation": [
        { "turn_no": 1, "speaker": "상담사", "text": "안녕하세요 ..." },
        { "turn_no": 2, "speaker": "고객", "text": "..." }
      ]
    }
  ]
}
```

> `transcript` 는 qa-pipeline `/evaluate` 에 전달되는 STT 원문 **문자열**, 대화 탭 턴 배열은 `conversation` 으로 전달합니다(생략 시 대화 탭 빈 상태). 백분율은 존재하는 항목 만점 합 기준으로 계산됩니다.

### 커스텀 루브릭 동기화

평가항목 관리(`department='기본'`) 저장 시 `server/rubricSync.mjs` 가 정의를 qa-pipeline 커스텀 루브릭(`/v2/rubrics`)으로 푸시합니다. 발급된 `rubric_id` 와 index→order_no 매핑은 `qa_pipeline_org_settings`(org_id PK)에 보관하며, 표준 트랙 ingest 는 `ensureRubric` 으로 루브릭을 보장한 뒤 평가합니다. 자세한 매핑 규칙은 [docs/EXTERNAL_API_GUIDE.md](docs/EXTERNAL_API_GUIDE.md) 참조.

## 프로젝트 구조

```
.
├── docker/             # Compose 초기화 스크립트 (postgres DDL), xhub 터널
├── docs/               # 평가·스키마·API 설계 SSOT (도메인 상세)
├── data/seed/          # baseline CSV (시더가 조건부 적재) + 생성/적재 스크립트
├── scripts/            # seed-if-empty 등 컨테이너 진입 스크립트
├── server/             # Express API (백엔드, 루트 package.json)
└── frontend/           # Next.js 15 프론트엔드 (app/ + src/ + public/)
```

> 프론트엔드 로컬 개발: `cd frontend && npm install && npm run dev` (포트 3000, `/api` 는 `localhost:3007` 백엔드로 프록시).

## 문서

| 문서 | 내용 |
|---|---|
| [docs/EVALUATION_ITEMS.md](docs/EVALUATION_ITEMS.md) | 평가 항목·채점·AI 트랙·화면 연계 정의 |
| [docs/DB_SCHEMA_FULL.md](docs/DB_SCHEMA_FULL.md) | 테이블·컬럼·모드별 사용 관계 |
| [docs/EXTERNAL_API_GUIDE.md](docs/EXTERNAL_API_GUIDE.md) | 외부 ingest / 루브릭 동기화 가이드 |
| [docs/AI_AGENT_OUTPUT_SPEC.md](docs/AI_AGENT_OUTPUT_SPEC.md) | AI 평가 출력 스펙 |
| [docker/init/postgres/01_init.sql](docker/init/postgres/01_init.sql) | DDL 단일 원천 |

## License

Proprietary — © MetaM. 외부 배포·재사용 금지.
