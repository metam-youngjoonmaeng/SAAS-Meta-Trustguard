-- ============================================================
-- 32_metam_eval_item_defs_from_kolon.sql
--   METAM 브랜드의 '기본' 평가항목을 코오롱 '기본' 콘텐츠(criterion/prompt_template)로 채운다.
--   - org 는 name 으로 resolve(하드코딩 안 함). METAM 또는 코오롱 부재 시 전체 no-op.
--   - 코오롱 콘텐츠는 16/17 시드(이 파일보다 먼저 적용)로 채워진 상태를 런타임 복사.
--   - 비-클로버: METAM 운영자가 UI 에서 편집한 값(비어있지 않은 criterion/prompt)은 보존.
--   - METAM 고유 항목 order_no 3 '경청 (말겹침/말자름)'(코오롱에 없음)은 건드리지 않으며, 없으면 생성.
--   - seed-if-empty.sh 가 매 기동 idempotent 재적용. 이미 채워진 값은 가드로 건너뜀.
-- 주의(설계 부채): METAM org 자체는 시드가 아닌 운영 데이터라 신규 빈 볼륨에는 존재하지 않을 수 있다.
--   그 경우 이 파일은 no-op. 브랜드별 평가 콘텐츠의 소스 오브 트루스 정리는 별도 과제(B) 참고.
-- ============================================================
DO $$
DECLARE
    metam_id integer;
    kolon_id integer;
BEGIN
    SELECT id INTO metam_id FROM public.organizations WHERE name = 'METAM' LIMIT 1;
    SELECT id INTO kolon_id FROM public.organizations WHERE name = '코오롱' LIMIT 1;
    IF metam_id IS NULL OR kolon_id IS NULL THEN
        RAISE NOTICE '[32] METAM(%) 또는 코오롱(%) org 부재 — no-op', metam_id, kolon_id;
        RETURN;
    END IF;

    -- 1) METAM 고유 항목(order_no 3) 보장 — 코오롱엔 없으므로 명시 생성(이미 있으면 skip).
    INSERT INTO public.eval_item_defs
        (org_id, order_no, category, item, criterion, prompt_template,
         department, version, effective_from, updated_at, pentagon_axis, scoring_type, max_score, is_active)
    SELECT metam_id, 3, '경청 및 소통', '경청 (말겹침/말자름)', NULL, NULL,
           '기본', 1, now(), now(), NULL, 'numeric', NULL, true
    WHERE NOT EXISTS (
        SELECT 1 FROM public.eval_item_defs m
         WHERE m.org_id = metam_id AND m.department = '기본' AND m.order_no = 3 AND m.version = 1
    );

    -- 2) 코오롱 '기본' 에 있는데 METAM 에 없는 (order_no, version) → 콘텐츠째 삽입.
    INSERT INTO public.eval_item_defs
        (org_id, order_no, category, item, criterion, prompt_template,
         department, version, effective_from, updated_at, pentagon_axis, scoring_type, max_score, is_active)
    SELECT metam_id, k.order_no, k.category, k.item, k.criterion, k.prompt_template,
           k.department, k.version, now(), now(), k.pentagon_axis, k.scoring_type, k.max_score, true
      FROM public.eval_item_defs k
     WHERE k.org_id = kolon_id AND k.department = '기본' AND k.is_active
       AND NOT EXISTS (
           SELECT 1 FROM public.eval_item_defs m
            WHERE m.org_id = metam_id AND m.department = '기본'
              AND m.order_no = k.order_no AND m.version = k.version
       );

    -- 3) 이미 존재하는 METAM '기본' 항목: criterion/prompt 가 비어있을 때만 코오롱 값으로 채움(비-클로버).
    UPDATE public.eval_item_defs m
       SET criterion       = COALESCE(NULLIF(m.criterion, ''), k.criterion),
           prompt_template = COALESCE(NULLIF(m.prompt_template, ''), k.prompt_template),
           updated_at      = now()
      FROM public.eval_item_defs k
     WHERE m.org_id = metam_id AND m.department = '기본'
       AND k.org_id = kolon_id AND k.department = '기본' AND k.is_active
       AND k.order_no = m.order_no AND k.version = m.version
       AND (COALESCE(length(m.criterion), 0) = 0 OR COALESCE(length(m.prompt_template), 0) = 0);
END $$;
