-- ============================================================
-- 06_revert_eval_items.sql — 평가항목관리 1단계 MVP 전면 롤백
-- ------------------------------------------------------------
-- 직전 시도(구 06_eval_items.sql + 07_eval_items_seed.sql)에서 생성된 객체를
-- 모두 idempotent 하게 제거한다. 신한 운영 데이터는 처음부터 건드린 적 없고,
-- 본 스크립트도 운영 테이블(qa_calls, qa_call_item_evidence, qa_call_item_score,
-- qa_call_pentagon_result, qa_consumer_eval_rows, admin_users, qa_golden_set)
-- 의 데이터는 절대 수정하지 않는다.
--
-- 제거 대상:
--   1) qa_call_item_score.item_version_id     (구 06 이 ADD COLUMN 한 nullable FK)
--   2) qa_call_pentagon_result.axis_version_id     (구 06 이 ADD COLUMN 한 nullable FK)
--   3) eval_items / eval_item_versions / pentagon_axes / pentagon_axis_versions 4 테이블
--   4) 트리거 / 함수 7개
-- ============================================================

BEGIN;

-- 1) ALTER 로 추가됐던 스냅샷 FK 컬럼 제거 (값이 채워진 적이 없어 데이터 손실 0)
ALTER TABLE IF EXISTS public.qa_call_item_score DROP COLUMN IF EXISTS item_version_id;
ALTER TABLE IF EXISTS public.qa_call_pentagon_result DROP COLUMN IF EXISTS axis_version_id;

-- 2) 4 테이블 — eval_item_versions/pentagon_axis_versions 가 부모 참조이므로 자식부터
--
-- ★ pentagon_axes 는 조건부로만 지운다 (2026-07-27).
--    구 MVP 의 pentagon_axes 와 현행 pentagon_axes(13_pentagon_axes.sql — 브랜드별 5축 정의)가
--    이름이 같다. 시더는 매 기동 06 을 재적용하므로, 무조건 DROP 하면 06 이 현행 테이블을 지우고
--    7 파일 뒤 13 이 빈 테이블로 다시 만든다 → 관리자가 편집한 축 라벨·설명·prompt_template 과
--    브랜드 생성 시 복제된 기본축이 재기동마다 전멸한다. 프론트는 축 0건이면 정본 5축으로 조용히
--    폴백하고(index.js:1868-1884), rubricSync 는 pentagon 블록 자체를 빼므로 유실이 눈에 안 띈다.
--
--    판별 근거: 구 MVP 는 pentagon_axes 와 pentagon_axis_versions 를 한 쌍으로 만들었고,
--    현행 스키마에는 versions 짝이 없다. 따라서 'pentagon_axis_versions 존재' = 아직 MVP 잔재가
--    남은 DB → 그때만 지운다. 이미 정리된 DB(현행)에서는 no-op.
DO $$
DECLARE
    has_mvp boolean := to_regclass('public.pentagon_axis_versions') IS NOT NULL;
BEGIN
    DROP TABLE IF EXISTS public.eval_item_versions     CASCADE;
    DROP TABLE IF EXISTS public.eval_items             CASCADE;
    DROP TABLE IF EXISTS public.pentagon_axis_versions CASCADE;

    IF has_mvp THEN
        DROP TABLE IF EXISTS public.pentagon_axes CASCADE;
        RAISE NOTICE '[06] MVP 잔재 감지 → pentagon_axes 제거 (13 이 현행 스키마로 재생성)';
    END IF;
END $$;

-- 3) 트리거 함수 + 시드 헬퍼 함수
DROP FUNCTION IF EXISTS public.eval_items_enforce_yes_no_max()    CASCADE;
DROP FUNCTION IF EXISTS public.pentagon_axes_touch_updated_at()   CASCADE;
DROP FUNCTION IF EXISTS public.eval_items_seed_one(INT, INT, TEXT, TEXT, TEXT, NUMERIC, BIGINT, TEXT, TEXT, BOOLEAN) CASCADE;
DROP FUNCTION IF EXISTS public.pentagon_axes_seed_one(INT, SMALLINT, TEXT, TEXT, TEXT) CASCADE;
DROP FUNCTION IF EXISTS public.seed_default_eval_template(INT)    CASCADE;

COMMIT;
