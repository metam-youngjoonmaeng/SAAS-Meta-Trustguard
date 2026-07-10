-- KSQI-STT 평가항목 브랜드별 정의 (신규 테이블 + 전 브랜드 시딩).
--
-- 판정 프롬프트 본문의 원본(SSOT)은 채점 파이프라인 v2/nodes/ksqi_stt(rules.py·prompts.py)이며,
-- 이 테이블은 브랜드(org)별 항목 메타(번호·명칭·영역·대분류·배점·활성)를 보관한다.
-- 'KSQI 관리' 화면·카탈로그 API(GET /api/ksqi-stt/catalog?org_id=)가 브랜드별로 이 테이블을
-- 우선 조회하고, 테이블/행 부재 시 파이프라인 프록시로 폴백(무회귀).
-- 멱등: 매 기동마다 seeder 재적용 → CREATE/INSERT 모두 IF NOT EXISTS / ON CONFLICT DO NOTHING.
--       신규 브랜드는 브랜드 생성 API 가 즉시 시딩하고, 다음 기동 시에도 자동 보충된다.

CREATE TABLE IF NOT EXISTS public.ksqi_item_defs (
    id         serial PRIMARY KEY,
    org_id     integer NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    number     integer NOT NULL,
    name       text    NOT NULL,
    area       text    NOT NULL,
    category   text    NOT NULL DEFAULT '',
    kind       text    NOT NULL DEFAULT 'llm',
    max_score  integer NOT NULL DEFAULT 10,
    is_active  boolean NOT NULL DEFAULT true,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT ksqi_item_defs_org_number_uk UNIQUE (org_id, number)
);

CREATE INDEX IF NOT EXISTS ix_ksqi_item_defs_org ON public.ksqi_item_defs (org_id);

-- 전 브랜드 시딩 — 텍스트평가 O 12항목 (원본 평가표 1~17 중 결번 #1~3·9·13 제외, 전부 llm·10점).
INSERT INTO public.ksqi_item_defs (org_id, number, name, area, category)
SELECT o.id, v.number, v.name, v.area, v.category
  FROM public.organizations o
 CROSS JOIN (VALUES
    (4,  '맞이인사',         'A', '맞이인사'),
    (5,  '적극적 안내',      'A', '상담태도'),
    (6,  '쉬운 답변',        'A', '업무처리'),
    (7,  '문의내용 파악도',  'A', '업무처리'),
    (8,  '종료인사',         'A', '종료태도'),
    (10, '친밀감(맞이인사)', 'B', '맞이인사'),
    (11, '답례표현',         'B', '맞이인사'),
    (12, '말투 및 어감',     'B', '상담태도'),
    (14, '단순 공감',        'B', '상담태도'),
    (15, '고차원 공감',      'B', '상담태도'),
    (16, '응대 신속성',      'B', '업무처리'),
    (17, '친밀감(종료인사)', 'B', '종료태도')
 ) AS v(number, name, area, category)
    ON CONFLICT (org_id, number) DO NOTHING;
