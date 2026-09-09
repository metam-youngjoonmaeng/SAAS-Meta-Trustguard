// 평가항목 · 버전 · 이력 · 펜타곤 축 · KSQI 카탈로그 라우트 — server/index.js 에서 분리 (2026-09-03).
//
// 라우트 11개 · 함께 옮긴 헬퍼/상태 4개. 본문은 index.js 원문 그대로(경로·메서드·순서·핸들러 무변경),
// callee 만 app→router. 이 파일 라우트에서만 쓰이던 선언만 여기로 왔고, 다른 곳도 쓰는 공통 헬퍼
// (pool·requireAdmin·resolveActiveOrgId 등)는 index.js 가 ctx 로 넘긴다 — 등록: app.use(createEvalItemRoutes({ ... })).
// 전역 인증 미들웨어(app.use, index.js)는 마운트 앞에 있으므로 종전과 같이 적용된다.

import express from 'express';
import { resolvePipelineBaseUrl } from '../qaPipelineIngest.mjs';

export function createEvalItemRoutes(ctx) {
    const { normalizeDepartment, pool, requireAdmin, resolveActiveOrgId } = ctx;
    const router = express.Router();

    // GET /api/admin/eval-items
    // query: ?department=...&version=...  (둘 다 옵션)
    // - 둘 다 미지정: 현재 효력 중인 활성 정의만 반환 (deactivated_at IS NULL AND effective_from <= now())
    // - version 지정: 해당 부서·버전 행 반환
    router.get('/api/admin/eval-items', async (req, res) => {
        const orgId = resolveActiveOrgId(req);
        if (orgId === null || orgId === undefined) {
            res.json({ ok: true, items: [] });
            return;
        }
        const department = req.query.department ? normalizeDepartment(req.query.department) : null;
        const version = req.query.version !== undefined ? Number(req.query.version) : null;
        if (version !== null && !Number.isFinite(version)) {
            res.status(400).json({ message: 'version must be a number' });
            return;
        }
        try {
            const params = [orgId];
            const where = ['tenant_id = $1'];
            if (department) {
                params.push(department);
                where.push(`department = $${params.length}`);
            }
            if (version !== null) {
                params.push(version);
                where.push(`version = $${params.length}`);
            } else {
                where.push('deactivated_at IS NULL');
                where.push('effective_from <= now()');
            }
            const { rows } = await pool.query(
                `SELECT order_no, category, item, criterion, prompt_template,
                    pentagon_axis, scoring_type, max_score, is_active,
                    department, version, effective_from, deactivated_at, updated_at
             FROM eval_item_defs
             WHERE ${where.join(' AND ')}
             ORDER BY department ASC, order_no ASC`,
                params
            );
            res.json({ ok: true, items: rows });
        } catch (error) {
            console.error('GET /api/admin/eval-items error:', error);
            res.status(500).json({ message: 'Failed to load eval item defs.' });
        }
    });

    // GET /api/admin/eval-item-versions
    // 부서별 버전 목록 (드롭다운용). 각 버전의 effective_from = MIN(해당 버전 항목들의 effective_from).
    router.get('/api/admin/eval-item-versions', async (req, res) => {
        const orgId = resolveActiveOrgId(req);
        if (orgId === null || orgId === undefined) {
            res.json({ ok: true, versions: [] });
            return;
        }
        try {
            const { rows } = await pool.query(
                `SELECT department,
                    version,
                    MIN(effective_from) AS effective_from,
                    MAX(deactivated_at) FILTER (WHERE deactivated_at IS NOT NULL) AS last_deactivated_at,
                    bool_and(deactivated_at IS NULL) AS is_active
             FROM eval_item_defs
             WHERE tenant_id = $1
             GROUP BY department, version
             ORDER BY department ASC, version DESC`,
                [orgId]
            );
            res.json({ ok: true, versions: rows });
        } catch (error) {
            console.error('GET /api/admin/eval-item-versions error:', error);
            res.status(500).json({ message: 'Failed to load eval item versions.' });
        }
    });

    // POST /api/admin/eval-items/compose-prompt — AI 프롬프트 다듬기(평가항목 편집 모달).
    // 러프 설명 초안 + 폼 상태(항목명/채점방식/만점/점수 단계)를 파이프라인 /v2/mtg-prompt/compose 로
    // 프록시(스킬 학습과 동일 base 해석 — EC2 타깃 기본, QA_PIPELINE_FORCE_LOCAL 우선).
    // DB 무접촉 — 생성 결과는 프론트 검토 모달에서 관리자가 확인·수정 후 기존 저장 경로로만 반영.
    const COMPOSE_PROMPT_TIMEOUT_MS = 120_000; // LLM 단발 + 파이프라인 내부 1회 재시도 여유

    router.post('/api/admin/eval-items/compose-prompt', requireAdmin, async (req, res) => {
        const b = req.body || {};
        const draft = typeof b.criterion_draft === 'string' ? b.criterion_draft.trim() : '';
        if (!draft) {
            res.status(400).json({ message: 'criterion_draft(설명 초안)가 필요합니다.' });
            return;
        }
        const payload = {
            item_name: typeof b.item_name === 'string' ? b.item_name : '',
            category: typeof b.category === 'string' ? b.category : '',
            scoring_type: b.scoring_type === 'yes_no' ? 'yes_no' : 'numeric',
            max_score: Number.isFinite(Number(b.max_score)) && b.max_score !== null && b.max_score !== '' ? Number(b.max_score) : null,
            steps: Array.isArray(b.steps)
                ? b.steps
                      .map((s) => ({ score: Number(s?.score), condition: typeof s?.condition === 'string' ? s.condition : '' }))
                      .filter((s) => Number.isFinite(s.score))
                : [],
            criterion_draft: draft,
            yn_criteria_draft: typeof b.yn_criteria_draft === 'string' ? b.yn_criteria_draft : '',
        };
        try {
            const base = resolvePipelineBaseUrl({ pipeline_target: 'ec2' }, {}).replace(/\/+$/, '');
            const resp = await fetch(`${base}/v2/mtg-prompt/compose`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
                signal: AbortSignal.timeout(COMPOSE_PROMPT_TIMEOUT_MS),
            });
            let j = null;
            try {
                j = await resp.json();
            } catch {
                /* 비-JSON 응답 */
            }
            if (j && typeof j === 'object') {
                res.json(j); // ok:false(파이프라인 graceful 오류) 도 본문 그대로 전달 — 프론트 모달이 표기
                return;
            }
            res.json({ ok: false, error: `http_${resp.status}` });
        } catch (err) {
            console.error('POST /api/admin/eval-items/compose-prompt error:', err);
            res.json({ ok: false, error: String(err?.message || err) });
        }
    });

    // ksqi_item_defs(브랜드별 KSQI 항목 정의) 테이블 존재 여부 — prod 미적용 시 부재. 1회 캐시.
    // 부재 시 카탈로그가 기존 파이프라인 프록시 동작으로 폴백해 무회귀 보장.
    let _ksqiItemDefsTableCache = null;

    async function hasKsqiItemDefsTable(pool) {
        if (_ksqiItemDefsTableCache !== null) return _ksqiItemDefsTableCache;
        try {
            const { rows } = await pool.query(
                `SELECT 1 FROM information_schema.tables
             WHERE table_schema = 'trustguard' AND table_name = 'ksqi_item_defs' LIMIT 1`
            );
            _ksqiItemDefsTableCache = rows.length > 0;
        } catch {
            _ksqiItemDefsTableCache = false;
        }
        return _ksqiItemDefsTableCache;
    }

    // 파이프라인 GET /ksqi-stt/catalog 중계 — 항목 판정 기준 본문(criterion)의 SSOT 는 파이프라인 코드.
    async function fetchPipelineKsqiCatalog(timeoutMs = 30_000) {
        const base = resolvePipelineBaseUrl({ pipeline_target: 'ec2' }, {}).replace(/\/+$/, '');
        const resp = await fetch(`${base}/ksqi-stt/catalog`, { signal: AbortSignal.timeout(timeoutMs) });
        let j = null;
        try {
            j = await resp.json();
        } catch {
            /* 비-JSON 응답 */
        }
        if (!resp.ok || j === null) throw new Error(`ksqi-stt catalog 조회 실패 (http_${resp.status})`);
        return Array.isArray(j) ? j : Array.isArray(j?.catalog) ? j.catalog : Array.isArray(j?.items) ? j.items : [];
    }

    // GET /api/ksqi-stt/catalog?org_id=N — KSQI 평가항목 카탈로그.
    //   org_id 지정 + ksqi_item_defs 존재 시: 브랜드별 DB 정의(번호·명칭·영역·대분류·배점·활성)를
    //   우선 반환하고, 판정 기준 본문(criterion)은 파이프라인 카탈로그에서 번호로 병합(베스트에포트 —
    //   파이프라인 불통이어도 DB 항목 목록은 정상 반환). 'KSQI 관리' 탭이 사용.
    //   org_id 미지정 / 테이블·행 부재(prod 미적용): 기존 파이프라인 프록시 그대로(무회귀).
    router.get('/api/ksqi-stt/catalog', async (req, res) => {
        // 통합DB: org_id(int) → tenant_id(citext). 쿼리파라미터는 tenant_id 우선, 구 org_id 문자열 폴백.
        const orgId = String(req.query.tenant_id ?? req.query.org_id ?? '').trim().toLowerCase() || null;
        try {
            if (orgId && (await hasKsqiItemDefsTable(pool))) {
                const { rows } = await pool.query(
                    `SELECT number, name, area, category, kind, max_score, is_active
                   FROM ksqi_item_defs
                  WHERE tenant_id = $1
                  ORDER BY number`,
                    [orgId]
                );
                if (rows.length > 0) {
                    let criterionByNumber = new Map();
                    try {
                        const pipelineItems = await fetchPipelineKsqiCatalog(10_000);
                        criterionByNumber = new Map(pipelineItems.map((it) => [Number(it.number), it]));
                    } catch (err) {
                        console.warn('ksqi-stt catalog: 파이프라인 criterion 병합 생략 —', String(err?.message || err));
                    }
                    res.json({
                        source: 'db',
                        org_id: orgId,
                        items: rows.map((r) => {
                            const p = criterionByNumber.get(Number(r.number)) || {};
                            return {
                                number: Number(r.number),
                                name: r.name,
                                area: r.area,
                                category: r.category,
                                kind: r.kind,
                                max_score: Number(r.max_score),
                                is_active: r.is_active !== false,
                                criterion: p.criterion ?? '',
                                alt_channel: p.alt_channel ?? null,
                            };
                        }),
                    });
                    return;
                }
            }
            // 폴백 — 파이프라인 프록시 (org 미지정·테이블/행 부재).
            res.json({ source: 'pipeline', items: await fetchPipelineKsqiCatalog() });
        } catch (err) {
            console.error('GET /api/ksqi-stt/catalog error:', err);
            res.status(502).json({ message: String(err?.message || err) });
        }
    });

    // PUT /api/admin/eval-items/:orderNo
    // body: {
    //   category, item, criterion, prompt_template,
    //   pentagon_axis?, scoring_type?, max_score?, is_active?,
    //   department?, is_meaning_change?
    // }
    // - is_meaning_change=false (기본): 활성 행 in-place UPDATE
    // - is_meaning_change=true: 활성 행 deactivated_at=now() + 새 버전 행 INSERT
    router.put('/api/admin/eval-items/:orderNo', requireAdmin, async (req, res) => {
        const orgId = resolveActiveOrgId(req, { strict: true });
        const orderNo = Number(req.params.orderNo);
        if (orgId === null || orgId === undefined) {
            res.status(400).json({ message: 'active brand context required' });
            return;
        }
        if (!Number.isFinite(orderNo)) {
            res.status(400).json({ message: 'orderNo must be a number' });
            return;
        }
        const { category, item, criterion, prompt_template } = req.body || {};
        if (typeof category !== 'string' || typeof item !== 'string') {
            res.status(400).json({ message: 'category and item are required strings' });
            return;
        }
        // 새 메타 필드 — undefined 면 백엔드에서 기본값/기존값 처리.
        const pentagonAxisRaw = req.body?.pentagon_axis;
        const pentagonAxis =
            pentagonAxisRaw === undefined ? undefined
            : (typeof pentagonAxisRaw === 'string' && pentagonAxisRaw.trim()) ? pentagonAxisRaw.trim()
            : null;
        const scoringTypeRaw = req.body?.scoring_type;
        const scoringType =
            scoringTypeRaw === undefined ? undefined
            : (scoringTypeRaw === 'numeric' || scoringTypeRaw === 'yes_no') ? scoringTypeRaw
            : null;
        if (scoringType === null) {
            res.status(400).json({ message: "scoring_type must be 'numeric' or 'yes_no'" });
            return;
        }
        const maxScoreRaw = req.body?.max_score;
        let maxScore;
        if (maxScoreRaw === undefined) maxScore = undefined;
        else if (maxScoreRaw === null || maxScoreRaw === '') maxScore = null;
        else {
            const n = Number(maxScoreRaw);
            if (!Number.isFinite(n) || n < 0) {
                res.status(400).json({ message: 'max_score must be a non-negative number' });
                return;
            }
            maxScore = Math.round(n);
        }
        const isActiveRaw = req.body?.is_active;
        const isActive =
            isActiveRaw === undefined ? undefined
            : isActiveRaw === true ? true
            : isActiveRaw === false ? false
            : null;
        if (isActive === null) {
            res.status(400).json({ message: 'is_active must be boolean' });
            return;
        }
        const department = normalizeDepartment(req.body?.department);
        const isMeaningChange = req.body?.is_meaning_change === true;

        const actor = req.session || {};
        const client = await pool.connect();
        try {
            await client.query('BEGIN');

            // 현재 활성 행 (있으면) — 변경 전 스냅샷 계산용으로 전체 필드 가져옴
            const { rows: activeRows } = await client.query(
                `SELECT id, version, category, item, criterion, prompt_template,
                    pentagon_axis, scoring_type, max_score, is_active
               FROM eval_item_defs
              WHERE tenant_id = $1 AND department = $2 AND order_no = $3
                AND deactivated_at IS NULL
              ORDER BY version DESC
              LIMIT 1`,
                [orgId, department, orderNo]
            );
            const activeRow = activeRows[0];

            // 미제공 필드는 기존 활성 행 값 유지 (없으면 백엔드 default).
            const effPentagonAxis = pentagonAxis !== undefined ? pentagonAxis : (activeRow?.pentagon_axis ?? null);
            const effScoringType = scoringType !== undefined ? scoringType : (activeRow?.scoring_type ?? 'numeric');
            const effMaxScore = maxScore !== undefined ? maxScore : (activeRow?.max_score ?? null);
            const effIsActive = isActive !== undefined ? isActive : (activeRow?.is_active ?? true);

            let resultRow;
            let logChangeType = null;
            let logBefore = null;
            let logAfter = null;
            let logVersion = null;

            if (!activeRow) {
                // 활성 행 없음 → 신규 발행 (v1 또는 부서 max+1)
                const { rows: maxRows } = await client.query(
                    `SELECT COALESCE(MAX(version), 0) AS max_version
                   FROM eval_item_defs
                  WHERE tenant_id = $1 AND department = $2 AND order_no = $3`,
                    [orgId, department, orderNo]
                );
                const nextVersion = (maxRows[0]?.max_version || 0) + 1;
                const { rows: insertRows } = await client.query(
                    `INSERT INTO eval_item_defs
                   (tenant_id, department, order_no, category, item, criterion, prompt_template,
                    pentagon_axis, scoring_type, max_score, is_active,
                    version, effective_from, updated_at)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, now(), now())
                 RETURNING order_no, category, item, criterion, prompt_template,
                           pentagon_axis, scoring_type, max_score, is_active,
                           department, version, effective_from, deactivated_at, updated_at`,
                    [
                        orgId, department, orderNo, category, item,
                        criterion ?? null, prompt_template ?? null,
                        effPentagonAxis, effScoringType, effMaxScore, effIsActive,
                        nextVersion,
                    ]
                );
                resultRow = insertRows[0];
                logChangeType = 'create';
                logBefore = null;
                logAfter = {
                    category, item,
                    criterion: criterion ?? null,
                    prompt_template: prompt_template ?? null,
                    pentagon_axis: effPentagonAxis,
                    scoring_type: effScoringType,
                    max_score: effMaxScore,
                    is_active: effIsActive,
                    version: nextVersion,
                };
                logVersion = nextVersion;
            } else if (isMeaningChange) {
                // 의미 변경 → 활성 행 deactivate + 새 버전 발행
                await client.query(
                    `UPDATE eval_item_defs
                    SET deactivated_at = now()
                  WHERE id = $1`,
                    [activeRow.id]
                );
                const { rows: maxRows } = await client.query(
                    `SELECT COALESCE(MAX(version), 0) AS max_version
                   FROM eval_item_defs
                  WHERE tenant_id = $1 AND department = $2`,
                    [orgId, department]
                );
                const nextVersion = (maxRows[0]?.max_version || 0) + 1;
                const { rows: insertRows } = await client.query(
                    `INSERT INTO eval_item_defs
                   (tenant_id, department, order_no, category, item, criterion, prompt_template,
                    pentagon_axis, scoring_type, max_score, is_active,
                    version, effective_from, updated_at)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, now(), now())
                 RETURNING order_no, category, item, criterion, prompt_template,
                           pentagon_axis, scoring_type, max_score, is_active,
                           department, version, effective_from, deactivated_at, updated_at`,
                    [
                        orgId, department, orderNo, category, item,
                        criterion ?? null, prompt_template ?? null,
                        effPentagonAxis, effScoringType, effMaxScore, effIsActive,
                        nextVersion,
                    ]
                );
                resultRow = insertRows[0];
                logChangeType = 'new_version';
                logBefore = {
                    category: activeRow.category,
                    item: activeRow.item,
                    criterion: activeRow.criterion,
                    prompt_template: activeRow.prompt_template,
                    pentagon_axis: activeRow.pentagon_axis,
                    scoring_type: activeRow.scoring_type,
                    max_score: activeRow.max_score,
                    is_active: activeRow.is_active,
                    version: activeRow.version,
                };
                logAfter = {
                    category, item,
                    criterion: criterion ?? null,
                    prompt_template: prompt_template ?? null,
                    pentagon_axis: effPentagonAxis,
                    scoring_type: effScoringType,
                    max_score: effMaxScore,
                    is_active: effIsActive,
                    version: nextVersion,
                };
                logVersion = nextVersion;
            } else {
                // 텍스트 다듬기 / 배점 변경 → in-place UPDATE
                const { rows: updateRows } = await client.query(
                    `UPDATE eval_item_defs
                    SET category        = $1,
                        item            = $2,
                        criterion       = $3,
                        prompt_template = $4,
                        pentagon_axis   = $5,
                        scoring_type    = $6,
                        max_score       = $7,
                        is_active       = $8,
                        updated_at      = now()
                  WHERE id = $9
                 RETURNING order_no, category, item, criterion, prompt_template,
                           pentagon_axis, scoring_type, max_score, is_active,
                           department, version, effective_from, deactivated_at, updated_at`,
                    [
                        category, item, criterion ?? null, prompt_template ?? null,
                        effPentagonAxis, effScoringType, effMaxScore, effIsActive,
                        activeRow.id,
                    ]
                );
                resultRow = updateRows[0];
                // 변경된 필드만 before/after 에 담는다. 변경 없으면 audit log 박지 않음.
                const changedFields = {};
                const fieldMap = {
                    category, item,
                    criterion: criterion ?? null,
                    prompt_template: prompt_template ?? null,
                    pentagon_axis: effPentagonAxis,
                    scoring_type: effScoringType,
                    max_score: effMaxScore,
                    is_active: effIsActive,
                };
                for (const [key, newVal] of Object.entries(fieldMap)) {
                    const oldVal = activeRow[key] ?? null;
                    if ((oldVal ?? null) !== (newVal ?? null)) {
                        changedFields[key] = { before: oldVal, after: newVal };
                    }
                }
                if (Object.keys(changedFields).length > 0) {
                    const before = {};
                    const after = {};
                    for (const [k, v] of Object.entries(changedFields)) {
                        before[k] = v.before;
                        after[k] = v.after;
                    }
                    // change_type 결정: 의미적으로 가장 영향 큰 변경 기준
                    if (changedFields.item || changedFields.category) logChangeType = 'item_rename';
                    else if (changedFields.is_active !== undefined && Object.keys(changedFields).length === 1) {
                        logChangeType = effIsActive ? 'reactivate' : 'deactivate';
                    }
                    else if (changedFields.pentagon_axis) logChangeType = 'pentagon_axis_update';
                    else if (changedFields.scoring_type || changedFields.max_score) logChangeType = 'scoring_update';
                    else if (changedFields.prompt_template && changedFields.criterion) logChangeType = 'criterion_prompt_update';
                    else if (changedFields.prompt_template) logChangeType = 'prompt_update';
                    else logChangeType = 'criterion_update';
                    logBefore = before;
                    logAfter = after;
                    logVersion = activeRow.version;
                }
            }

            // change log 삽입 (변경이 있을 때만)
            // item_name / category_name 은 변경 시점의 스냅샷 — 항목 삭제 후에도 통합 이력에서 표시 가능.
            if (logChangeType) {
                await client.query(
                    `INSERT INTO rubric_change_log
                   (tenant_id, target_kind, department, target_no, target_name, category_name,
                    version, change_type, before_json, after_json,
                    user_id, login_id, display_name)
                 VALUES ($1, 'item', $2, $3, $4, $5, $6, $7, $8::jsonb, $9::jsonb, $10, $11, $12)`,
                    [
                        orgId, department, orderNo,
                        item, category,
                        logVersion, logChangeType,
                        logBefore ? JSON.stringify(logBefore) : null,
                        logAfter ? JSON.stringify(logAfter) : null,
                        actor.user_id ?? null,
                        actor.login_id ?? null,
                        actor.display_name ?? null,
                    ]
                );
            }

            await client.query('COMMIT');
            // 루브릭 push 훅 없음 — 백엔드(QA_RUBRIC_SOURCE=db)가 평가 시 eval_item_defs 를 직접 읽음.
            res.json({ ok: true, item: resultRow });
        } catch (error) {
            await client.query('ROLLBACK').catch(() => {});
            console.error('PUT /api/admin/eval-items/:orderNo error:', error);
            res.status(500).json({ message: 'Failed to save eval item def.' });
        } finally {
            client.release();
        }
    });

    // DELETE /api/admin/eval-items/:orderNo
    // 소프트 삭제: 해당 order_no 의 활성 행(전 부서)을 deactivated_at=now() + is_active=false 로 비활성화.
    // GET(deactivated_at IS NULL 필터)·평가에서 즉시 제외 → 목록에서 "삭제"로 보이며, 버전/변경 이력은 보존(감사 추적).
    // 하드 삭제(row 제거) 아님 — 이력·과거 평가 무결성 유지를 위해 의도적으로 soft-delete.
    router.delete('/api/admin/eval-items/:orderNo', requireAdmin, async (req, res) => {
        const orgId = resolveActiveOrgId(req, { strict: true });
        const orderNo = Number(req.params.orderNo);
        // 부서 스코프(선택): 지정 시 해당 부서 행만 비활성화, 미지정 시 전 부서(하위호환).
        // 같은 order_no 가 부서별로 다른 항목인 경우(예: org3 '기본' 첫인사 vs 'KSQI' 맞이인사)
        // 한 부서 삭제가 타 부서 항목까지 소리 없이 비활성화하던 문제 방지.
        const deptRaw = req.query?.department ?? req.body?.department;
        const department = typeof deptRaw === 'string' && deptRaw.trim() ? deptRaw.trim() : null;
        if (orgId === null || orgId === undefined) {
            res.status(400).json({ message: 'active brand context required' });
            return;
        }
        if (!Number.isFinite(orderNo)) {
            res.status(400).json({ message: 'orderNo must be a number' });
            return;
        }
        const actor = req.session || {};
        const client = await pool.connect();
        try {
            await client.query('BEGIN');

            // 활성 행 스냅샷 (부서별 1행씩) — 변경 이력 before 용
            const { rows: activeRows } = await client.query(
                `SELECT id, department, version, category, item, criterion, prompt_template,
                    pentagon_axis, scoring_type, max_score, is_active
               FROM eval_item_defs
              WHERE tenant_id = $1 AND order_no = $2 AND deactivated_at IS NULL${department ? ' AND department = $3' : ''}`,
                department ? [orgId, orderNo, department] : [orgId, orderNo]
            );
            if (activeRows.length === 0) {
                await client.query('ROLLBACK').catch(() => {});
                res.status(404).json({ message: 'eval item not found or already deleted' });
                return;
            }

            // 활성 행 비활성화 (department 지정 시 해당 부서만, 미지정 시 전 부서)
            await client.query(
                `UPDATE eval_item_defs
                SET deactivated_at = now(), is_active = false, updated_at = now()
              WHERE tenant_id = $1 AND order_no = $2 AND deactivated_at IS NULL${department ? ' AND department = $3' : ''}`,
                department ? [orgId, orderNo, department] : [orgId, orderNo]
            );

            // 부서별 삭제 이력 (change_type='delete')
            for (const row of activeRows) {
                const beforeJson = {
                    category: row.category, item: row.item,
                    criterion: row.criterion, prompt_template: row.prompt_template,
                    pentagon_axis: row.pentagon_axis, scoring_type: row.scoring_type,
                    max_score: row.max_score, is_active: row.is_active, version: row.version,
                };
                await client.query(
                    `INSERT INTO rubric_change_log
                   (tenant_id, target_kind, department, target_no, target_name, category_name,
                    version, change_type, before_json, after_json,
                    user_id, login_id, display_name)
                 VALUES ($1, 'item', $2, $3, $4, $5, $6, 'delete', $7::jsonb, NULL, $8, $9, $10)`,
                    [
                        orgId, row.department, orderNo,
                        row.item, row.category, row.version,
                        JSON.stringify(beforeJson),
                        actor.user_id ?? null, actor.login_id ?? null, actor.display_name ?? null,
                    ]
                );
            }

            await client.query('COMMIT');
            res.json({ ok: true, order_no: orderNo, deleted: activeRows.length });
        } catch (error) {
            await client.query('ROLLBACK').catch(() => {});
            console.error('DELETE /api/admin/eval-items/:orderNo error:', error);
            res.status(500).json({ message: 'Failed to delete eval item.' });
        } finally {
            client.release();
        }
    });

    // POST /api/admin/eval-items
    // body: {
    //   category, item, criterion?, prompt_template?,
    //   pentagon_axis?, scoring_type, max_score?, is_active?,
    //   departments: string[]    // 1개 이상의 부서. 각 부서별로 row 발행.
    // }
    // - order_no 는 활성 브랜드 전체에서 max(order_no)+1 로 자동 발급.
    // - 동일 order_no 를 모든 부서에 INSERT (브랜드 내에서 같은 항목 = 같은 order_no 패턴 유지).
    // - change_type='create' 로 부서별로 변경 이력 적재.
    router.post('/api/admin/eval-items', requireAdmin, async (req, res) => {
        const orgId = resolveActiveOrgId(req, { strict: true });
        if (orgId === null || orgId === undefined) {
            res.status(400).json({ message: 'active brand context required' });
            return;
        }
        const { category, item, criterion, prompt_template } = req.body || {};
        if (typeof category !== 'string' || !category.trim()) {
            res.status(400).json({ message: 'category is required' });
            return;
        }
        if (typeof item !== 'string' || !item.trim()) {
            res.status(400).json({ message: 'item is required' });
            return;
        }
        const departments = Array.isArray(req.body?.departments) ? req.body.departments : [];
        const normalizedDepts = Array.from(new Set(
            departments.map((d) => (typeof d === 'string' ? d.trim() : '')).filter(Boolean)
        ));
        if (normalizedDepts.length === 0) {
            res.status(400).json({ message: 'departments must include at least one department' });
            return;
        }
        const pentagonAxisRaw = req.body?.pentagon_axis;
        const pentagonAxis =
            pentagonAxisRaw === undefined || pentagonAxisRaw === null || pentagonAxisRaw === '' ? null
            : typeof pentagonAxisRaw === 'string' ? pentagonAxisRaw.trim() : null;
        const scoringType = req.body?.scoring_type === 'yes_no' ? 'yes_no' : 'numeric';
        let maxScore = null;
        if (scoringType === 'numeric') {
            const n = Number(req.body?.max_score);
            if (!Number.isFinite(n) || n <= 0) {
                res.status(400).json({ message: 'max_score must be > 0 for numeric scoring' });
                return;
            }
            maxScore = Math.round(n);
        }
        const isActive = req.body?.is_active === false ? false : true;

        const actor = req.session || {};
        const client = await pool.connect();
        try {
            await client.query('BEGIN');

            // order_no 발급: 활성 행 기준 사용 안 된 최소 양의 정수 (gap-fill).
            // soft-delete(deactivated_at) 로 비운 슬롯은 재사용 가능 — 전부 삭제 후 추가하면 #1 부터,
            // 부분 삭제 후 추가하면 빈 자리를 채운다. (version 카운터는 org+department 전역 단조라
            // 같은 order_no 재발급 시에도 versioned_uk 충돌 없음.)
            const { rows: usedRows } = await client.query(
                `SELECT DISTINCT order_no
               FROM eval_item_defs
              WHERE tenant_id = $1 AND deactivated_at IS NULL`,
                [orgId]
            );
            const usedSet = new Set(usedRows.map((r) => Number(r.order_no)));
            let nextOrderNo = 1;
            while (usedSet.has(nextOrderNo)) nextOrderNo++;

            const inserted = [];
            for (const dept of normalizedDepts) {
                const { rows: vRows } = await client.query(
                    `SELECT COALESCE(MAX(version), 0) AS max_version
                   FROM eval_item_defs
                  WHERE tenant_id = $1 AND department = $2`,
                    [orgId, dept]
                );
                const nextVersion = (vRows[0]?.max_version || 0) + 1;
                const { rows: insertRows } = await client.query(
                    `INSERT INTO eval_item_defs
                   (tenant_id, department, order_no, category, item, criterion, prompt_template,
                    pentagon_axis, scoring_type, max_score, is_active,
                    version, effective_from, updated_at)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, now(), now())
                 RETURNING order_no, category, item, criterion, prompt_template,
                           pentagon_axis, scoring_type, max_score, is_active,
                           department, version, effective_from, deactivated_at, updated_at`,
                    [
                        orgId, dept, nextOrderNo, category.trim(), item.trim(),
                        criterion ?? null, prompt_template ?? null,
                        pentagonAxis, scoringType, maxScore, isActive,
                        nextVersion,
                    ]
                );
                inserted.push(insertRows[0]);

                // 부서별 변경 이력
                const afterJson = {
                    category: category.trim(), item: item.trim(),
                    criterion: criterion ?? null,
                    prompt_template: prompt_template ?? null,
                    pentagon_axis: pentagonAxis,
                    scoring_type: scoringType,
                    max_score: maxScore,
                    is_active: isActive,
                    version: nextVersion,
                };
                await client.query(
                    `INSERT INTO rubric_change_log
                   (tenant_id, target_kind, department, target_no, target_name, category_name,
                    version, change_type, before_json, after_json,
                    user_id, login_id, display_name)
                 VALUES ($1, 'item', $2, $3, $4, $5, $6, 'create', NULL, $7::jsonb, $8, $9, $10)`,
                    [
                        orgId, dept, nextOrderNo,
                        item.trim(), category.trim(),
                        nextVersion,
                        JSON.stringify(afterJson),
                        actor.user_id ?? null,
                        actor.login_id ?? null,
                        actor.display_name ?? null,
                    ]
                );
            }

            await client.query('COMMIT');
            // 루브릭 push 훅 없음 — 백엔드(QA_RUBRIC_SOURCE=db)가 평가 시 eval_item_defs 를 직접 읽음.
            res.json({ ok: true, items: inserted, order_no: nextOrderNo });
        } catch (error) {
            await client.query('ROLLBACK').catch(() => {});
            console.error('POST /api/admin/eval-items error:', error);
            res.status(500).json({ message: 'Failed to create eval item.' });
        } finally {
            client.release();
        }
    });

    /* ── Pentagon 축 ───────────────────────────────────────────── */

    // GET /api/admin/pentagon-axes
    // 현재 효력 중인 활성 행만 반환. 행이 없으면 빈 배열 — UI 는 brandConfig.radarLabels fallback.
    router.get('/api/admin/pentagon-axes', async (req, res) => {
        const orgId = resolveActiveOrgId(req);
        if (orgId === null || orgId === undefined) {
            res.json({ ok: true, axes: [] });
            return;
        }
        const department = req.query.department ? normalizeDepartment(req.query.department) : null;
        try {
            const params = [orgId];
            const where = ['tenant_id = $1', 'deactivated_at IS NULL', 'effective_from <= now()'];
            if (department) {
                params.push(department);
                where.push(`department = $${params.length}`);
            }
            const { rows } = await pool.query(
                `SELECT axis_no, label, description, prompt_template, is_active,
                    department, version, effective_from, deactivated_at, updated_at
             FROM pentagon_axes
             WHERE ${where.join(' AND ')}
             ORDER BY department ASC, axis_no ASC`,
                params
            );
            res.json({ ok: true, axes: rows });
        } catch (error) {
            console.error('GET /api/admin/pentagon-axes error:', error);
            res.status(500).json({ message: 'Failed to load pentagon axes.' });
        }
    });

    // POST /api/admin/pentagon-axes  — 신규 축 추가
    // body: { label, description?, prompt_template?, is_active?, department? }
    // axis_no = 활성 브랜드 내 max+1.
    router.post('/api/admin/pentagon-axes', requireAdmin, async (req, res) => {
        const orgId = resolveActiveOrgId(req, { strict: true });
        if (orgId === null || orgId === undefined) {
            res.status(400).json({ message: 'active brand context required' });
            return;
        }
        const { label } = req.body || {};
        if (typeof label !== 'string' || !label.trim()) {
            res.status(400).json({ message: 'label is required' });
            return;
        }
        const description = typeof req.body?.description === 'string' ? req.body.description : null;
        const promptTemplate = typeof req.body?.prompt_template === 'string' ? req.body.prompt_template : null;
        const isActive = req.body?.is_active === false ? false : true;
        const department = normalizeDepartment(req.body?.department);
        const actor = req.session || {};

        const client = await pool.connect();
        try {
            await client.query('BEGIN');
            const { rows: maxRows } = await client.query(
                `SELECT COALESCE(MAX(axis_no), 0) AS max_axis
               FROM pentagon_axes
              WHERE tenant_id = $1 AND department = $2`,
                [orgId, department]
            );
            const nextAxisNo = (maxRows[0]?.max_axis || 0) + 1;
            const { rows: insertRows } = await client.query(
                `INSERT INTO pentagon_axes
               (tenant_id, department, axis_no, label, description, prompt_template,
                is_active, version, effective_from, updated_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, 1, now(), now())
             RETURNING axis_no, label, description, prompt_template, is_active,
                       department, version, effective_from, deactivated_at, updated_at`,
                [orgId, department, nextAxisNo, label.trim(), description, promptTemplate, isActive]
            );
            const afterJson = {
                label: label.trim(),
                description,
                prompt_template: promptTemplate,
                is_active: isActive,
                version: 1,
            };
            await client.query(
                `INSERT INTO rubric_change_log
               (tenant_id, target_kind, department, target_no, target_name, version, change_type,
                before_json, after_json,
                user_id, login_id, display_name)
             VALUES ($1, 'axis', $2, $3, $4, 1, 'create', NULL, $5::jsonb, $6, $7, $8)`,
                [
                    orgId, department, nextAxisNo, label.trim(),
                    JSON.stringify(afterJson),
                    actor.user_id ?? null,
                    actor.login_id ?? null,
                    actor.display_name ?? null,
                ]
            );
            await client.query('COMMIT');
            res.json({ ok: true, axis: insertRows[0] });
        } catch (error) {
            await client.query('ROLLBACK').catch(() => {});
            console.error('POST /api/admin/pentagon-axes error:', error);
            res.status(500).json({ message: 'Failed to create pentagon axis.' });
        } finally {
            client.release();
        }
    });

    // PUT /api/admin/pentagon-axes/:axisNo
    // body: { label?, description?, prompt_template?, is_active?, department? }
    // 활성 행 in-place UPDATE + 변경 이력 적재. is_meaning_change 옵션 없음 (PoC 단순화).
    router.put('/api/admin/pentagon-axes/:axisNo', requireAdmin, async (req, res) => {
        const orgId = resolveActiveOrgId(req, { strict: true });
        const axisNo = Number(req.params.axisNo);
        if (orgId === null || orgId === undefined) {
            res.status(400).json({ message: 'active brand context required' });
            return;
        }
        if (!Number.isFinite(axisNo)) {
            res.status(400).json({ message: 'axisNo must be a number' });
            return;
        }
        const department = normalizeDepartment(req.body?.department);
        const labelRaw = req.body?.label;
        const descriptionRaw = req.body?.description;
        const promptRaw = req.body?.prompt_template;
        const isActiveRaw = req.body?.is_active;
        const actor = req.session || {};

        const client = await pool.connect();
        try {
            await client.query('BEGIN');
            const { rows: activeRows } = await client.query(
                `SELECT id, version, label, description, prompt_template, is_active
               FROM pentagon_axes
              WHERE tenant_id = $1 AND department = $2 AND axis_no = $3
                AND deactivated_at IS NULL
              ORDER BY version DESC
              LIMIT 1`,
                [orgId, department, axisNo]
            );
            const activeRow = activeRows[0];

            const nextLabel = typeof labelRaw === 'string' && labelRaw.trim() ? labelRaw.trim() : (activeRow?.label ?? null);
            const nextDesc = descriptionRaw === undefined ? (activeRow?.description ?? null) : (descriptionRaw || null);
            const nextPrompt = promptRaw === undefined ? (activeRow?.prompt_template ?? null) : (promptRaw || null);
            const nextActive = isActiveRaw === undefined ? (activeRow?.is_active ?? true) : (isActiveRaw === false ? false : true);

            if (!nextLabel) {
                res.status(400).json({ message: 'label is required (no existing row)' });
                await client.query('ROLLBACK');
                return;
            }

            let resultRow;
            let logChangeType = null;
            let logBefore = null;
            let logAfter = null;
            let logVersion = null;

            if (!activeRow) {
                // 활성 행 없음 → 신규 발행 (eval_item_defs 와 동일 패턴)
                const { rows: vRows } = await client.query(
                    `SELECT COALESCE(MAX(version), 0) AS max_version
                   FROM pentagon_axes
                  WHERE tenant_id = $1 AND department = $2 AND axis_no = $3`,
                    [orgId, department, axisNo]
                );
                const nextVersion = (vRows[0]?.max_version || 0) + 1;
                const { rows: insertRows } = await client.query(
                    `INSERT INTO pentagon_axes
                   (tenant_id, department, axis_no, label, description, prompt_template,
                    is_active, version, effective_from, updated_at)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, now(), now())
                 RETURNING axis_no, label, description, prompt_template, is_active,
                           department, version, effective_from, deactivated_at, updated_at`,
                    [orgId, department, axisNo, nextLabel, nextDesc, nextPrompt, nextActive, nextVersion]
                );
                resultRow = insertRows[0];
                logChangeType = 'create';
                logAfter = {
                    label: nextLabel, description: nextDesc,
                    prompt_template: nextPrompt, is_active: nextActive,
                    version: nextVersion,
                };
                logVersion = nextVersion;
            } else {
                const { rows: updateRows } = await client.query(
                    `UPDATE pentagon_axes
                    SET label           = $1,
                        description     = $2,
                        prompt_template = $3,
                        is_active       = $4,
                        updated_at      = now()
                  WHERE id = $5
                 RETURNING axis_no, label, description, prompt_template, is_active,
                           department, version, effective_from, deactivated_at, updated_at`,
                    [nextLabel, nextDesc, nextPrompt, nextActive, activeRow.id]
                );
                resultRow = updateRows[0];

                const changedFields = {};
                const fieldMap = {
                    label: nextLabel,
                    description: nextDesc,
                    prompt_template: nextPrompt,
                    is_active: nextActive,
                };
                for (const [key, newVal] of Object.entries(fieldMap)) {
                    const oldVal = activeRow[key] ?? null;
                    if ((oldVal ?? null) !== (newVal ?? null)) {
                        changedFields[key] = { before: oldVal, after: newVal };
                    }
                }
                if (Object.keys(changedFields).length > 0) {
                    const before = {};
                    const after = {};
                    for (const [k, v] of Object.entries(changedFields)) {
                        before[k] = v.before;
                        after[k] = v.after;
                    }
                    if (changedFields.is_active !== undefined && Object.keys(changedFields).length === 1) {
                        logChangeType = nextActive ? 'reactivate' : 'deactivate';
                    } else if (changedFields.label) logChangeType = 'label_rename';
                    else if (changedFields.prompt_template) logChangeType = 'prompt_update';
                    else logChangeType = 'description_update';
                    logBefore = before;
                    logAfter = after;
                    logVersion = activeRow.version;
                }
            }

            if (logChangeType) {
                await client.query(
                    `INSERT INTO rubric_change_log
                   (tenant_id, target_kind, department, target_no, target_name, version, change_type,
                    before_json, after_json,
                    user_id, login_id, display_name)
                 VALUES ($1, 'axis', $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb, $9, $10, $11)`,
                    [
                        orgId, department, axisNo, nextLabel,
                        logVersion, logChangeType,
                        logBefore ? JSON.stringify(logBefore) : null,
                        logAfter ? JSON.stringify(logAfter) : null,
                        actor.user_id ?? null,
                        actor.login_id ?? null,
                        actor.display_name ?? null,
                    ]
                );
            }

            await client.query('COMMIT');
            res.json({ ok: true, axis: resultRow });
        } catch (error) {
            await client.query('ROLLBACK').catch(() => {});
            console.error('PUT /api/admin/pentagon-axes/:axisNo error:', error);
            res.status(500).json({ message: 'Failed to save pentagon axis.' });
        } finally {
            client.release();
        }
    });

    // GET /api/admin/eval-item-history
    // query: ?department=...&change_type=...&limit=...  (모두 옵션)
    // 활성 브랜드의 전체 평가항목 변경 이력 (시간순 DESC). 항목 한정 X.
    // item_name / category_name 은 변경 시점의 스냅샷이라 항목 삭제 후에도 표시 가능.
    router.get('/api/admin/eval-item-history', async (req, res) => {
        const orgId = resolveActiveOrgId(req);
        if (orgId === null || orgId === undefined) {
            res.json({ ok: true, entries: [] });
            return;
        }
        const department = req.query.department ? normalizeDepartment(req.query.department) : null;
        const changeType = typeof req.query.change_type === 'string' ? req.query.change_type : null;
        const limit = Number(req.query.limit);
        const effectiveLimit = Number.isFinite(limit) && limit > 0 && limit <= 500 ? limit : 200;
        try {
            const params = [orgId];
            const where = ['tenant_id = $1'];
            if (department) {
                params.push(department);
                where.push(`department = $${params.length}`);
            }
            if (changeType) {
                params.push(changeType);
                where.push(`change_type = $${params.length}`);
            }
            const whereSql = where.join(' AND ');
            params.push(effectiveLimit);
            const limitParam = `$${params.length}`;
            // 루브릭 변경 이력 — 평가항목/펜타곤축이 rubric_change_log 한 테이블로 병합(마이그레이션 69).
            // 프론트 응답 계약은 그대로 유지: target_no→order_no, target_name→item_name,
            // target_kind→source('eval_item'|'pentagon_axis'), 축은 category_name='펜타곤 축' 로 표시.
            // 구 UNION ALL 2회 조회가 단일 스캔이 되고, id 가 한 시퀀스라 두 테이블 id 충돌 문제도 사라진다.
            const { rows } = await pool.query(
                `SELECT id, department,
                    target_no   AS order_no,
                    target_name AS item_name,
                    CASE WHEN target_kind = 'axis' THEN '펜타곤 축' ELSE category_name END AS category_name,
                    change_type, version, before_json, after_json,
                    user_id, login_id, display_name, changed_at,
                    CASE WHEN target_kind = 'axis' THEN 'pentagon_axis' ELSE 'eval_item' END AS source
               FROM rubric_change_log
              WHERE ${whereSql}
              ORDER BY changed_at DESC
              LIMIT ${limitParam}`,
                params
            );
            res.json({ ok: true, entries: rows });
        } catch (error) {
            console.error('GET /api/admin/eval-item-history error:', error);
            res.status(500).json({ message: 'Failed to load eval item history.' });
        }
    });

    return router;
}
