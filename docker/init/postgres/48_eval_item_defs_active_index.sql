-- ============================================================
-- 48_eval_item_defs_active_index.sql — 활성 평가항목 핫패스 부분 인덱스
-- ------------------------------------------------------------
-- 대시보드(/api/*/eval-items)·평가엔진(buildRubricFromDefs)이 매번 쓰는
--   WHERE org_id=? [AND department=?] AND deactivated_at IS NULL AND is_active = true
--   ORDER BY order_no
-- 쿼리가 기존 인덱스로는 커버되지 않아 seq scan 이었다(59행이라 체감 무영향이나,
-- 브랜드·버전·항목 증가 대비). is_active 컬럼은 12_eval_item_meta.sql 에서 추가되므로
-- 반드시 그 이후(번호 12 < 48)에 실행된다.
-- 비파괴적·재생성 가능(IF NOT EXISTS / DROP INDEX 로 롤백).
-- ============================================================

CREATE INDEX IF NOT EXISTS idx_eval_item_defs_active
    ON public.eval_item_defs (org_id, department, order_no)
    WHERE deactivated_at IS NULL AND is_active = true;
