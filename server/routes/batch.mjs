// 배치 설정 · 골든/스킬 학습 · 판정 프롬프트 · 재판정 라우트 — server/index.js 에서 분리 (2026-09-03).
//
// 라우트 20개 · 함께 옮긴 헬퍼/상태 4개. 본문은 index.js 원문 그대로(경로·메서드·순서·핸들러 무변경),
// callee 만 app→router. 이 파일 라우트에서만 쓰이던 선언만 여기로 왔고, 다른 곳도 쓰는 공통 헬퍼
// (pool·requireAdmin·resolveActiveOrgId 등)는 index.js 가 ctx 로 넘긴다 — 등록: app.use(createBatchRoutes({ ... })).
// 전역 인증 미들웨어(app.use, index.js)는 마운트 앞에 있으므로 종전과 같이 적용된다.

import express from 'express';
import { insertQaAuditLog } from '../auditLog.mjs';
import { DEFAULT_CONTRADICTION_DEF, DEFAULT_UNCERTAIN_DEF, buildSystemPrompt, judgeEnabled, judgeModel, resolvePromptParts } from '../geminiJudge.mjs';
import { triggerGoldenLearn, triggerSkillLearn } from '../icsQaPoller.mjs';
import { runJudgeBackfill } from '../judgeConfidence.mjs';
import { logger } from '../logger.mjs';
import { applyManualReviewStamps } from '../manualReview.mjs';
import { fetchGoldenIndexCoverage } from '../qaPipelineIngest.mjs';
import { getOrgFewshot, saveRagFewshotConfig } from '../ragFewshotConfig.mjs';
import { activateSkillVersion, fetchSkillGenProgress, fetchSkillMemorySummary, fetchSkillVersionDetail, fetchSkillVersions, pushSkillSettings } from '../skillLearn.mjs';

export function createBatchRoutes(ctx) {
    const { SKILL_LOG, SKILL_LOG_MAX, goldenLearnStatus, notifyGoldenLearnComplete, pool, pushSkillLog, recordSkillLearnResult, requireAdmin, resolveActiveOrgId, skillLearnProgressLogger, skillLearnStatus } = ctx;
    const router = express.Router();

    // ───────────────────────────────────────────────────────────────────────────
    // AI 평가 배치관리 (BatchManage)
    //   조건 세트(5개 카드 + 공통 통화시간/스케줄)를 브랜드별로 저장하고,
    //   "예상 대상" 을 우리 DB(qa_calls)로 실제 산출한다.
    //   현재 산출 가능(우리 데이터): ① 저품질 평균점수 미달 / 공통 통화시간 / ⑤ 고점·무작위표본.
    //   미지원(데이터·정의 대기): ② AI 신뢰도(엔진 confidence), ③ 리스크(기준 미정),
    //                              ④ 근속(상담사 입사일 없음), ① 필수항목/업무지식(기준 미정).
    // ───────────────────────────────────────────────────────────────────────────
    function batchOrgKey(req) {
        // 브랜드별 1행. 통합DB: tenant_id(citext). super_admin '전체'(null)는 '__default__' 센티넬 버킷에 보관.
        const a = resolveActiveOrgId(req);
        return a == null ? '__default__' : a;
    }

    // GET /api/batch/config — 현재 브랜드의 저장된 조건. 없으면 config:null (프론트 기본값 사용).
    router.get('/api/batch/config', requireAdmin, async (req, res) => {
        try {
            const orgId = batchOrgKey(req);
            const { rows } = await pool.query(
                `SELECT config, updated_at, updated_by FROM qa_batch_configs WHERE tenant_id = $1`,
                [orgId]
            );
            res.json({
                ok: true,
                org_id: orgId,
                config: rows[0]?.config ?? null,
                updated_at: rows[0]?.updated_at ?? null,
            });
        } catch (e) {
            console.error('GET /api/batch/config error:', e?.message || e);
            res.status(500).json({ ok: false, message: '배치 설정 조회 실패' });
        }
    });

    // PUT /api/batch/config — 조건 세트 저장(upsert). body: { config: {...} }
    router.put('/api/batch/config', requireAdmin, async (req, res) => {
        const config = req.body?.config;
        if (!config || typeof config !== 'object' || Array.isArray(config)) {
            return res.status(400).json({ ok: false, message: 'config(object) 가 필요합니다.' });
        }
        try {
            const orgId = batchOrgKey(req);
            const updatedBy = req.session?.user_id ?? null;
            await pool.query(
                `INSERT INTO qa_batch_configs (tenant_id, config, updated_at, updated_by)
             VALUES ($1, $2::jsonb, now(), $3)
             ON CONFLICT (tenant_id) DO UPDATE SET
               config = EXCLUDED.config, updated_at = now(), updated_by = EXCLUDED.updated_by`,
                [orgId, JSON.stringify(config), updatedBy]
            );
            // 골든셋 배치 '적용 평가 항목' = 평가 시 RAG 사용 항목(단일 컨트롤). 체크(=미제외)된 항목의
            //   이름을 organizations.rag_fewshot_item_names 로 동기화 → 그 항목만 평가 시 few-shot RAG 사용
            //   (getOrgFewshot 게이트). 색인(golden.excluded→allowed_items)과 동일 체크박스가 구동.
            await syncRagFewshotFromGolden(orgId, config).catch(() => {});
            // LLM 스킬 '적용 평가 항목'(config.skill.excluded, order_no) → 파이프라인 스킬 설정
            //   (PUT /v2/mtg-skill/{rubric}/settings, item_number) 동기화 — fire-and-forget(실패해도 저장은 성공).
            if (orgId !== '__default__' && config.skill && Array.isArray(config.skill.excluded)) {
                pushSkillSettings(pool, orgId, config.skill.excluded)
                    .then((r) => {
                        if (r && r.ok === false) logger.warn(`[skill-learn] 설정 동기화 실패(org=${orgId}): ${r.error || '미상'}`);
                    })
                    .catch((e) => logger.warn(`[skill-learn] 설정 동기화 실패(org=${orgId}): ${e?.message || e}`));
            }
            res.json({ ok: true, org_id: orgId });
        } catch (e) {
            console.error('PUT /api/batch/config error:', e?.message || e);
            res.status(500).json({ ok: false, message: '배치 설정 저장 실패' });
        }
    });

    // 골든셋 배치 '적용 평가 항목' → 평가 시 RAG 항목(organizations.rag_fewshot_item_names) 동기화.
    //   체크(=config.golden.excluded 에 없는) 항목의 이름을 RAG 사용 목록으로 저장. 항목명 소스는
    //   '적용 평가 항목' 칩과 동일(qa_call_item_score) — order_no 정합. rubric_id 는 기존값 보존,
    //   없으면 rbrc_org{N}(색인측 getOrgFewshot 규칙과 정합). golden 미설정/org 0 이면 무동작.
    //   전 항목 제외(체크 0) → item_names 빈 배열 → getOrgFewshot null → 평가 시 RAG 전면 OFF.
    async function syncRagFewshotFromGolden(orgId, config) {
        if (!orgId || orgId === '__default__') return;
        const golden = config && config.golden;
        if (!golden || !Array.isArray(golden.excluded)) return; // 골든 섹션 없는 저장은 건드리지 않음
        const excludedSet = new Set(golden.excluded.map(Number).filter(Number.isFinite));
        // '적용 평가 항목' 칩과 동일 소스로 order_no → 항목명(정합 보장). 통합DB: is_sandbox=qa_evaluations, org_id→tenant_id.
        const { rows } = await pool.query(
            `SELECT er.order_no, max(er.item) AS item
           FROM eval_item_score er
           JOIN common.calls c ON c.call_id = er.call_id
           JOIN trustguard.qa_evaluations e ON e.call_id = c.call_id
          WHERE e.is_sandbox = false AND c.tenant_id = $1
          GROUP BY er.order_no ORDER BY er.order_no`,
            [orgId]
        );
        const includedNames = rows
            .filter((r) => !excludedSet.has(Number(r.order_no)))
            .map((r) => String(r.item || '').trim())
            .filter(Boolean);
        // rubric_id: 기존값 보존(특수 rubric_id 유지), 없으면 rbrc_org{tenant}. (통합DB: tenant_rag_config)
        const existing = await getOrgFewshot(pool, orgId);
        const rubricId = String(existing?.rubric_id || '').trim() || `rbrc_org${orgId}`;
        await saveRagFewshotConfig(pool, { [orgId]: { rubric_id: rubricId, item_names: includedNames } });
    }

    // POST /api/golden-learn/run — 골든셋 학습 배치 수동 트리거(백그라운드). 즉시 응답({started:true}) 후
    //   triggerGoldenLearn → ingestGoldenSetToRag: qa_golden_set ⋈ 전사 → 백엔드 POST /v2/mtg-rag/{rubric_id}/examples 색인.
    //   진행/결과는 GET /api/golden-learn/status 로 폴링. body.dry_run=true 시 AOSS 미기록 프리뷰. 과거 콜 재평가 아님.
    router.post('/api/golden-learn/run', requireAdmin, async (req, res) => {
        const orgId = resolveActiveOrgId(req, { strict: true });
        if (orgId === null || orgId === undefined) {
            res.status(400).json({ message: 'active brand context required' });
            return;
        }
        const dryRun = !!(req.body && req.body.dry_run);
        const cur = goldenLearnStatus.get(orgId);
        if (cur && cur.state === 'running') {
            res.json({ ok: true, started: true, already_running: true, org_id: orgId, golden_count: cur.golden_count ?? null });
            return;
        }
        // 즉시 피드백용 빠른 카운트(임베딩 전).
        let goldenCount = null;
        try {
            const { rows } = await pool.query('SELECT count(*)::int AS n FROM qa_golden_set WHERE tenant_id = $1', [orgId]);
            goldenCount = rows[0]?.n ?? null;
        } catch {
            /* 카운트 실패는 무시 — 실행에 영향 없음 */
        }
        const startedAt = Date.now();
        goldenLearnStatus.set(orgId, { state: 'running', source: 'manual', started_at: startedAt, dry_run: dryRun, golden_count: goldenCount, progress: { processed: 0, total: goldenCount || null, saved: 0, skipped: 0, failed: 0 } });
        // 백그라운드 실행 — 즉시 응답(프록시/브라우저 타임아웃 회피). 결과는 status 로 확인.
        (async () => {
            try {
                // 진척 콜백 — ingest 청크마다 progress 갱신 → GET /status 폴링이 진행바에 실시간 반영.
                const onProgress = (p) => {
                    const prev = goldenLearnStatus.get(orgId) || {};
                    if (prev.state !== 'running') return; // 완료/에러 후 늦은 콜백 무시
                    goldenLearnStatus.set(orgId, { ...prev, progress: p });
                };
                const result = await triggerGoldenLearn(pool, orgId, { source: 'manual', dryRun, onProgress });
                goldenLearnStatus.set(orgId, { state: 'done', source: 'manual', started_at: startedAt, finished_at: Date.now(), dry_run: dryRun, golden_count: goldenCount, result });
                await insertQaAuditLog(pool, {
                    req,
                    action: 'GOLDEN_LEARN_RUN',
                    resource_type: 'golden_learn',
                    resource_id: String(orgId),
                    http_method: 'POST',
                    http_path: '/api/golden-learn/run',
                    detail_json: JSON.stringify(result),
                    success: result.ok,
                }).catch(() => {});
                // 학습 완료 → 알림 센터 통지(트리거 관리자 + 브랜드 관리자). dry-run 프리뷰는 제외.
                if (!dryRun) {
                    await notifyGoldenLearnComplete(orgId, result, {
                        actorUserId: req.session?.user_id ?? null,
                        actorName: req.session?.display_name || req.session?.login_id || null,
                        source: 'manual',
                    }).catch(() => {});
                }
            } catch (e) {
                console.error('golden-learn background error:', e?.message || e);
                goldenLearnStatus.set(orgId, { state: 'error', started_at: startedAt, finished_at: Date.now(), error: String(e?.message || e) });
            }
        })();
        res.json({ ok: true, started: true, org_id: orgId, golden_count: goldenCount });
    });

    // GET /api/golden-learn/status — 활성 브랜드의 골든셋 학습 잡 최신 상태(폴링용).
    router.get('/api/golden-learn/status', requireAdmin, (req, res) => {
        const orgId = resolveActiveOrgId(req, { strict: true });
        if (orgId === null || orgId === undefined) {
            res.status(400).json({ message: 'active brand context required' });
            return;
        }
        res.json(goldenLearnStatus.get(orgId) || { state: 'idle' });
    });

    // GET /api/golden-learn/coverage — 골든셋 규모/학습 기준일(정밀) 표시용.
    //   · 테이블: 골든 총 건수(+대화 수) + 골든 최신 등록일(qa_golden_set.created_at MAX = "며칠까지 쌓였나")
    //   · 색인(정밀): 백엔드에서 실제 색인된 consultation_id 를 받아 PG created_at 과 조인 → latest_indexed_at
    //     (= "며칠까지 진짜 학습됐나"). 재색인 없이 기존 색인 그대로 정확.
    //   · needs_relearn: 골든 총량 > 색인량 또는 최신 등록 > 최신 색인 → 미학습분 존재(재학습 필요).
    router.get('/api/golden-learn/coverage', requireAdmin, async (req, res) => {
        const orgId = resolveActiveOrgId(req, { strict: true });
        if (orgId === null || orgId === undefined) {
            res.status(400).json({ message: 'active brand context required' });
            return;
        }
        try {
            // ① 테이블 총량 + 최신 등록일
            const { rows: t } = await pool.query(
                `SELECT COUNT(*)::int AS golden_count,
                    COUNT(DISTINCT qa_id)::int AS conversation_count,
                    MAX(created_at) AS latest_golden_at
               FROM qa_golden_set WHERE tenant_id = $1`,
                [orgId]
            );
            const tot = t[0] || {};
            // ② 색인 커버리지(정밀) — 백엔드에서 색인된 consultation_id 받아 PG created_at 과 조인
            const cov = await fetchGoldenIndexCoverage(pool, orgId);
            let latestIndexedAt = null;
            let indexedConvCount = 0;
            if (cov.consultation_ids && cov.consultation_ids.length) {
                // 통합DB: qa_golden_set.qa_id=call_id(bigint). 색인 consultation_id 는 텍스트(source_id) → common.calls 조인 매칭.
                const { rows: ir } = await pool.query(
                    `SELECT COUNT(DISTINCT g.qa_id)::int AS indexed_conversation_count,
                        MAX(g.created_at) AS latest_indexed_at
                   FROM qa_golden_set g JOIN common.calls c ON c.call_id = g.qa_id
                  WHERE g.tenant_id = $1 AND c.source_id = ANY($2::text[])`,
                    [orgId, cov.consultation_ids]
                );
                latestIndexedAt = (ir[0] && ir[0].latest_indexed_at) || null;
                indexedConvCount = (ir[0] && ir[0].indexed_conversation_count) || 0;
            }
            const latestGoldenMs = tot.latest_golden_at ? new Date(tot.latest_golden_at).getTime() : null;
            const latestIndexedMs = latestIndexedAt ? new Date(latestIndexedAt).getTime() : null;
            const needsRelearn = !!(
                (tot.golden_count ?? 0) > (cov.indexed_count ?? 0) ||
                (latestGoldenMs && (!latestIndexedMs || latestGoldenMs > latestIndexedMs))
            );
            const status = goldenLearnStatus.get(orgId) || {};
            res.json({
                org_id: orgId,
                rubric_id: cov.rubric_id,
                golden_count: tot.golden_count ?? 0,
                conversation_count: tot.conversation_count ?? 0,
                latest_golden_at: tot.latest_golden_at || null,
                indexed_count: cov.indexed_count ?? 0,
                indexed_conversation_count: indexedConvCount,
                latest_indexed_at: latestIndexedAt,
                needs_relearn: needsRelearn,
                last_run_at: status.finished_at || null,
                last_run_state: status.state || 'idle',
            });
        } catch (e) {
            res.status(500).json({ message: String(e?.message || e) });
        }
    });

    // POST /api/skill-learn/run — 스킬 학습 수동 트리거(백그라운드). 즉시 응답({started:true}) 후
    //   triggerSkillLearn → runSkillLearn: 정정 케이스 수집 → 백엔드 POST /v2/mtg-skill/{rubric_id}/generate.
    //   진행/결과는 GET /api/skill-learn/status 로 폴링. golden-learn/run 미러.
    router.post('/api/skill-learn/run', requireAdmin, async (req, res) => {
        const orgId = resolveActiveOrgId(req, { strict: true });
        if (orgId === null || orgId === undefined) {
            res.status(400).json({ message: 'active brand context required' });
            return;
        }
        const cur = skillLearnStatus.get(orgId);
        if (cur && cur.state === 'running') {
            res.json({ ok: true, started: true, already_running: true, org_id: orgId });
            return;
        }
        const startedAt = Date.now();
        skillLearnStatus.set(orgId, { state: 'running', source: 'manual', started_at: startedAt, stage: 'collect', stage_message: '검수 정정 케이스 수집 중…' });
        pushSkillLog({ org_id: orgId, source: 'manual', stage: 'collect', message: '스킬 학습 시작 — 검수 정정 케이스 수집' });
        // 백그라운드 실행 — 즉시 응답(프록시/브라우저 타임아웃 회피). 결과는 status 로 확인.
        (async () => {
            try {
                const result = await triggerSkillLearn(pool, orgId, {
                    source: 'manual',
                    onProgress: skillLearnProgressLogger(orgId, 'manual'),
                });
                recordSkillLearnResult(orgId, 'manual', result, startedAt);
                // 무해 종료(멱등 스킵)는 실패가 아님 — success=1 + 'skip:' prefix error_message 로 기록,
                //   화면(Logs.jsx)이 이 마커로 OK/FAIL 대신 SKIP 칩을 렌더(recordSkillLearnResult 의 benign 과 동일 의미론).
                const benignSkip = result.ok !== true && (result.error === 'no_new_cases' || result.error === 'no_correction_cases');
                await insertQaAuditLog(pool, {
                    req,
                    action: 'SKILL_LEARN_RUN',
                    resource_type: 'skill_learn',
                    resource_id: String(orgId),
                    http_method: 'POST',
                    http_path: '/api/skill-learn/run',
                    detail_json: JSON.stringify(result),
                    success: result.ok === true || benignSkip,
                    error_message: benignSkip
                        ? (result.error === 'no_new_cases'
                            ? 'skip: 변경 없음 — 마지막 학습과 동일한 정정 케이스(학습 생략, LLM 미호출)'
                            : 'skip: 정정 케이스(낮음/높음) 없음 — 학습 생략')
                        : undefined,
                }).catch(() => {});
            } catch (e) {
                console.error('skill-learn background error:', e?.message || e);
                skillLearnStatus.set(orgId, { state: 'error', source: 'manual', started_at: startedAt, finished_at: Date.now(), error: String(e?.message || e) });
                pushSkillLog({ org_id: orgId, source: 'manual', stage: 'error', message: `스킬 학습 실패 — ${String(e?.message || e)}`, error: String(e?.message || e) });
            }
        })();
        res.json({ ok: true, started: true, org_id: orgId });
    });

    // GET /api/skill-learn/status — 활성 브랜드의 스킬 학습 잡 최신 상태(폴링용).
    //   generate 단계 진행 중이면 파이프라인 status 의 generating {done,total} 을 progress 로 동봉
    //   → 프론트 진행바(골든 진행바 미러). 프록시 실패는 progress 생략(상태 응답 무영향).
    router.get('/api/skill-learn/status', requireAdmin, async (req, res) => {
        const orgId = resolveActiveOrgId(req, { strict: true });
        if (orgId === null || orgId === undefined) {
            res.status(400).json({ message: 'active brand context required' });
            return;
        }
        const entry = skillLearnStatus.get(orgId) || { state: 'idle' };
        if (entry.state === 'running' && entry.stage === 'generate' && entry.rubric_id) {
            try {
                const g = await fetchSkillGenProgress(entry.rubric_id);
                if (g) {
                    res.json({ ...entry, progress: { done: g.done ?? 0, total: g.total ?? null } });
                    return;
                }
            } catch { /* 진행률 조회 실패 — progress 없이 상태만 */ }
        }
        res.json(entry);
    });

    // GET /api/skill-learn/versions — 스킬 버전 목록 프록시(org→rubric_id 해석 후 파이프라인 조회).
    router.get('/api/skill-learn/versions', requireAdmin, async (req, res) => {
        const orgId = resolveActiveOrgId(req, { strict: true });
        if (orgId === null || orgId === undefined) {
            res.status(400).json({ message: 'active brand context required' });
            return;
        }
        res.json(await fetchSkillVersions(pool, orgId));
    });

    // GET /api/skill-learn/versions/:versionId — 스킬 버전 상세(overlay md + 생성 근거 케이스) 프록시.
    router.get('/api/skill-learn/versions/:versionId', requireAdmin, async (req, res) => {
        const orgId = resolveActiveOrgId(req, { strict: true });
        if (orgId === null || orgId === undefined) {
            res.status(400).json({ message: 'active brand context required' });
            return;
        }
        res.json(await fetchSkillVersionDetail(pool, orgId, String(req.params.versionId || '')));
    });

    // POST /api/skill-learn/activate — 스킬 버전 활성화/롤백. body {version_id} (null=전체 비활성) 프록시.
    router.post('/api/skill-learn/activate', requireAdmin, async (req, res) => {
        const orgId = resolveActiveOrgId(req, { strict: true });
        if (orgId === null || orgId === undefined) {
            res.status(400).json({ message: 'active brand context required' });
            return;
        }
        const versionId = req.body && req.body.version_id != null ? String(req.body.version_id) : null;
        const result = await activateSkillVersion(pool, orgId, versionId);
        if (result && result.ok) {
            pushSkillLog({
                org_id: orgId,
                source: 'manual',
                stage: 'activate',
                message: versionId ? `버전 활성화 — ${versionId}` : '스킬 비활성화(active 버전 해제)',
                rubric_id: result.rubric_id ?? null,
                version_id: versionId,
            });
        }
        res.json(result);
    });

    // GET /api/skill-log/recent — 스킬 학습 로그 조회(rag-log/recent 미러, 인메모리 링버퍼).
    //   limit(기본 100, 1~500) · within_minutes(기본 60분) 밖은 컷. 최신순 {entries} 래핑.
    //   브랜드 격리: super_admin 은 전체, 그 외는 세션 org_id 엔트리만(org 미지정 관리자는 전체).
    router.get('/api/skill-log/recent', requireAdmin, (req, res) => {
        let limit = Number(req.query.limit);
        if (!Number.isFinite(limit) || limit <= 0) limit = 100;
        limit = Math.min(Math.max(1, Math.trunc(limit)), SKILL_LOG_MAX);
        let withinMin = Number(req.query.within_minutes);
        if (!Number.isFinite(withinMin) || withinMin <= 0) withinMin = 60;
        const cutoff = Date.now() - withinMin * 60 * 1000;
        let rows = SKILL_LOG.filter((e) => (e.ts || 0) >= cutoff);
        // 통합DB: 브랜드 격리키 = tenant_id(citext 문자열). 숫자 비교 금지(NaN===NaN=false 로 전부 필터됨).
        if (req.session?.role !== 'super_admin' && req.session?.tenant_id != null) {
            rows = rows.filter((e) => String(e.org_id) === String(req.session.tenant_id));
        }
        // 최신순(ts 내림차순) — 원본 링버퍼는 변형하지 않도록 복사 후 정렬.
        const entries = rows.slice().sort((a, b) => (b.ts || 0) - (a.ts || 0)).slice(0, limit);
        res.json({ entries });
    });

    // GET /api/skill-memory — 에이전트 메모리(qa_skill_store) 항목별 요약(실시간 로그 '메모리' 행 토글).
    //   org_id 쿼리 기준 rubric_id 해석 → blob 요약(읽기 전용). 브랜드 격리: skill-log/recent 와 동일 규칙.
    router.get('/api/skill-memory', requireAdmin, async (req, res) => {
        // 통합DB: org_id(int) → tenant_id(citext). 쿼리파라미터 tenant_id 우선(구 org_id 폴백), 비-super는 세션 테넌트 고정.
        let orgId = String(req.query.tenant_id ?? req.query.org_id ?? '').trim().toLowerCase() || null;
        if (req.session?.role !== 'super_admin' && req.session?.tenant_id != null) orgId = String(req.session.tenant_id);
        if (!orgId) {
            res.status(400).json({ ok: false, error: 'tenant_id required' });
            return;
        }
        try {
            res.json(await fetchSkillMemorySummary(pool, orgId));
        } catch (e) {
            res.status(500).json({ ok: false, error: String(e?.message || e) });
        }
    });

    // GET /api/batch/eval-items — ② '적용 평가 항목' 칩용. 실제 평가된 항목(order_no+item) 집합.
    //   eval_item_defs(부서·버전 엉킴) 대신, 그 org 콜이 실제 평가받은 항목으로 — ② 판정 order_no 와 정확히 일치.
    router.get('/api/batch/eval-items', requireAdmin, async (req, res) => {
        try {
            const orgId = batchOrgKey(req);
            const params = [];
            let orgClause = '';
            if (orgId !== '__default__') { params.push(orgId); orgClause = `AND c.tenant_id = $${params.length}`; }
            // 통합DB: 항목=eval_item_score(call_id), 헤더=common.calls, is_sandbox=qa_evaluations.
            const { rows } = await pool.query(
                `SELECT er.order_no, max(er.item) AS item, count(DISTINCT er.call_id)::int AS calls
               FROM eval_item_score er
               JOIN common.calls c ON c.call_id = er.call_id
               JOIN trustguard.qa_evaluations e ON e.call_id = c.call_id
              WHERE e.is_sandbox = false ${orgClause}
              GROUP BY er.order_no
              ORDER BY er.order_no`,
                params
            );
            res.json({ ok: true, org_id: orgId, items: rows });
        } catch (e) {
            console.error('GET /api/batch/eval-items error:', e?.message || e);
            res.status(500).json({ ok: false, message: '평가 항목 조회 실패' });
        }
    });

    // POST /api/batch/preview — 조건 → 예상 대상 콜 수(실데이터). body: { config }
    router.post('/api/batch/preview', requireAdmin, async (req, res) => {
        const cfg = req.body?.config || {};
        try {
            const orgId = batchOrgKey(req);
            const on = cfg.on || {};
            const q = cfg.quality || {};
            const bias = cfg.bias || {};
            const scope = cfg.scope || {};

            const num = (v, def) => (Number.isFinite(Number(v)) ? Number(v) : def);
            // 통화시간(분) → 초. max<=0 또는 max<=min 이면 상한 없음(매우 큰 값).
            const minSec = Math.max(0, Math.round(num(scope.minMin, 0) * 60));
            let maxMin = num(scope.maxMin, 0);
            const maxSec = maxMin > 0 && maxMin * 60 > minSec ? Math.round(maxMin * 60) : 2147483647;

            const conf = cfg.confidence || {};

            // 지원 조건 플래그 (우리 데이터로 산출 가능한 것만)
            const qOn = !!(on.quality && q.avgBelow);
            const qRel = q.avgMode === 'rel';
            const qRelPts = num(q.avgRel, 0);
            const qAbs = num(q.avgAbs, 0);
            const bHighOn = !!(on.bias && bias.highScore);
            const bHigh = num(bias.highThreshold, 101);
            const bHighRel = bias.highMode === 'rel';        // 평균점수 이상: 상대값(평균 대비 +N) | 절대값
            const bHighRelPts = num(bias.highRel, 0);
            // ② 신뢰도 — 저장된 LLM 판정(qa_call_annotation)을 선택 항목으로 스코프해서 필터.
            const uncOn = !!conf.uncertain;
            const conOn = !!conf.contradiction;
            const confOn = !!(on.confidence && (uncOn || conOn));
            // 적용 평가 항목: excluded(order_no 배열) 제외 = 나머지만 검사. 빈 배열이면 전 항목.
            const excluded = Array.isArray(conf.excluded)
                ? conf.excluded.map((x) => Number(x)).filter((n) => Number.isInteger(n))
                : [];

            // ⑤ 무작위 표본 — 결정적 해시 샘플링(콜별 고정)으로 in-scope 의 약 pct% 를 표본화.
            //   추정치가 아니라 manualReview 도장과 동일한 식으로 실제 카운트 → preview = 실제.
            const randomOn = !!(on.bias && bias.random);
            const randomPct = num(bias.randomPct, 0);

            // ④ 근속(대상자 특정) — 상담사 입사일(trainee_registrations.hire_date) 기준. 도장 로직과 동일 식.
            const tenure = cfg.tenure || {};
            const tjOn = !!(on.tenure && tenure.junior);
            const tjM = Math.max(0, Math.round(num(tenure.juniorMonths, 6)));
            const tsOn = !!(on.tenure && tenure.senior);
            const tsY = Math.max(0, Math.round(num(tenure.seniorYears, 5)));

            const params = [minSec, maxSec, qOn, qRel, qRelPts, qAbs, bHighOn, bHigh, confOn, uncOn, conOn, excluded, randomOn, randomPct, tjOn, tjM, tsOn, tsY, bHighRel, bHighRelPts];
            let orgClause = '';
            if (orgId !== '__default__') { params.push(orgId); orgClause = `AND c.tenant_id = $${params.length}`; }

            // 통합DB: 헤더=common.calls, 점수/is_sandbox=qa_evaluations, 판정=eval_annotation(call_id), 입사일=테넌트별 memberships.
            //   id=source_id(텍스트) 유지 → hashtext 무작위표본이 구 "ID" 와 동일(샘플셋 보존).
            const sql = `
            WITH scoped AS (
                SELECT c.source_id AS id, e."TOTAL_SCORE"::numeric AS score, c.duration_sec, cj.judgments,
                       mm.hire_date AS hire_date
                  FROM common.calls c
                  JOIN trustguard.qa_evaluations e ON e.call_id = c.call_id
                  LEFT JOIN trustguard.eval_annotation cj ON cj.call_id = c.call_id
                  LEFT JOIN common.memberships mm ON mm.user_id = c.agent_user_id AND mm.tenant_id = c.tenant_id
                 WHERE e.is_sandbox = false ${orgClause}
            ), in_scope AS (
                SELECT id, score, duration_sec, judgments, hire_date FROM scoped
                 WHERE duration_sec IS NOT NULL AND duration_sec >= $1 AND duration_sec < $2
            ), agg AS (
                SELECT avg(score) AS org_avg FROM in_scope
            ), flagged AS (
                SELECT
                    ($3 AND ( ($4 AND a.org_avg IS NOT NULL AND i.score <= a.org_avg - $5) OR (NOT $4 AND i.score < $6) )) AS q_match,
                    ($7 AND ( ($19 AND a.org_avg IS NOT NULL AND i.score >= a.org_avg + $20) OR (NOT $19 AND i.score >= $8) )) AS b_match,
                    ($9 AND EXISTS (
                        SELECT 1 FROM jsonb_array_elements(coalesce(i.judgments, '[]'::jsonb)) e
                         WHERE NOT ((e->>'order_no')::int = ANY($12::int[]))
                           AND ( ($10 AND (e->>'uncertain')::boolean) OR ($11 AND (e->>'contradiction')::boolean) )
                    )) AS c_match,
                    ($13 AND (((hashtext(i.id) % 100) + 100) % 100) < $14) AS r_match,
                    ($15 AND i.hire_date ~ '^\\d{4}-\\d{2}-\\d{2}$' AND i.hire_date::date >= (CURRENT_DATE - make_interval(months => $16))) AS te_j_match,
                    ($17 AND i.hire_date ~ '^\\d{4}-\\d{2}-\\d{2}$' AND i.hire_date::date <= (CURRENT_DATE - make_interval(years  => $18))) AS te_s_match,
                    (i.judgments IS NOT NULL) AS judged
                  FROM in_scope i CROSS JOIN agg a
            )
            SELECT
                (SELECT count(*) FROM scoped)::int   AS pool,
                (SELECT count(*) FROM in_scope)::int AS in_scope_cnt,
                (SELECT round(org_avg, 1) FROM agg)  AS org_avg,
                count(*) FILTER (WHERE q_match)::int  AS quality_cnt,
                count(*) FILTER (WHERE b_match)::int  AS bias_high_cnt,
                count(*) FILTER (WHERE r_match)::int  AS bias_random_cnt,
                count(*) FILTER (WHERE b_match OR r_match)::int AS bias_cnt,
                count(*) FILTER (WHERE c_match)::int  AS confidence_cnt,
                count(*) FILTER (WHERE te_j_match)::int AS tenure_junior_cnt,
                count(*) FILTER (WHERE te_s_match)::int AS tenure_senior_cnt,
                count(*) FILTER (WHERE te_j_match OR te_s_match)::int AS tenure_cnt,
                count(*) FILTER (WHERE judged)::int   AS judged_cnt,
                count(*) FILTER (WHERE q_match OR b_match OR c_match OR r_match OR te_j_match OR te_s_match)::int AS union_cnt
            FROM flagged`;

            const { rows } = await pool.query(sql, params);
            const r = rows[0] || { pool: 0, in_scope_cnt: 0, org_avg: null, quality_cnt: 0, bias_high_cnt: 0, bias_random_cnt: 0, bias_cnt: 0, confidence_cnt: 0, tenure_junior_cnt: 0, tenure_senior_cnt: 0, tenure_cnt: 0, judged_cnt: 0, union_cnt: 0 };

            const totalTargets = r.union_cnt || 0; // union 은 in_scope 부분집합 — 실제 도장 대상 수와 일치

            res.json({
                ok: true,
                org_id: orgId,
                pool: r.pool,
                in_scope: r.in_scope_cnt,
                org_avg: r.org_avg != null ? Number(r.org_avg) : null,
                total_targets: totalTargets,
                scope: { min_sec: minSec, max_sec: maxSec === 2147483647 ? null : maxSec },
                conditions: {
                    quality: on.quality
                        ? { supported: true, count: r.quality_cnt,
                            note: '평균점수 미달만 반영 — 필수항목 기준 미정' }
                        : { supported: true, count: 0, note: '비활성' },
                    confidence: on.confidence
                        ? { supported: true, count: r.confidence_cnt, judged: r.judged_cnt,
                            note: r.judged_cnt < r.in_scope_cnt ? `LLM 판정 ${r.judged_cnt}/${r.in_scope_cnt}콜 (미판정분 재판정 필요)` : null }
                        : { supported: true, count: 0, note: '비활성' },
                    risk:       { supported: false, count: 0, note: '리스크 기준(금칙어·고객신호) 정의 대기' },
                    tenure: on.tenure
                        ? { supported: true, count: r.tenure_cnt,
                            junior_count: r.tenure_junior_cnt, senior_count: r.tenure_senior_cnt,
                            note: `신입 ${r.tenure_junior_cnt}건 + 장기근속 ${r.tenure_senior_cnt}건 (입사일 기준)` }
                        : { supported: true, count: 0, note: '비활성' },
                    bias: on.bias
                        ? { supported: true, count: r.bias_cnt,
                            high_count: r.bias_high_cnt, random_count: r.bias_random_cnt,
                            note: randomOn ? `무작위 표본 ${r.bias_random_cnt}건(약 ${randomPct}%) + 고점 ${r.bias_high_cnt}건` : null }
                        : { supported: true, count: 0, note: '비활성' },
                },
            });
        } catch (e) {
            console.error('POST /api/batch/preview error:', e?.message || e);
            res.status(500).json({ ok: false, message: '배치 미리보기 산출 실패' });
        }
    });

    // ── AI 신뢰도 검증 ② 판정 프롬프트(B안) — 두 정의문 편집 + 재판정 ──────────────
    // v1: 단일 전역 판정 프롬프트(org 0). 브랜드별 프롬프트는 후속(runJudgeBackfill orgId 인자화 동반).
    const PROMPT_ORG = '__default__';   // 통합DB: 전역 판정 프롬프트 = '__default__' 센티넬(구 org 0)

    // 재판정 잡 상태(인프로세스 1개). 프롬프트가 전역(org 0)이라 잡도 전역 1개로 충분.
    // API 재기동 시 중단돼도 멱등(재실행이 남은 콜만 다시 처리).
    let rejudgeJob = { running: false, started_at: null, finished_at: null, done: 0, total: null, result: null, error: null };

    // GET /api/batch/prompt — 편집 UI 용. 두 정의문(불확실/모순) + 메타 + 판정 가용 여부.
    router.get('/api/batch/prompt', requireAdmin, async (req, res) => {
        try {
            const p = await resolvePromptParts(pool, PROMPT_ORG);
            res.json({
                ok: true,
                uncertain_def: p.uncertainDef,
                contradiction_def: p.contradictionDef,
                default_uncertain_def: DEFAULT_UNCERTAIN_DEF,
                default_contradiction_def: DEFAULT_CONTRADICTION_DEF,
                version: p.version,
                is_default: p.isDefault,
                updated_at: p.updatedAt,
                judge_enabled: judgeEnabled(),
                model: judgeModel(),
            });
        } catch (e) {
            console.error('GET /api/batch/prompt error:', e?.message || e);
            res.status(500).json({ ok: false, message: '판정 프롬프트 조회 실패' });
        }
    });

    // PUT /api/batch/prompt — 두 정의문 저장(변경 시 version 증가 → 기존 판정 stale → 재판정 대상).
    // body: { uncertain_def, contradiction_def }. 빈 값/기본값과 동일하면 NULL 저장(기본값 폴백).
    router.put('/api/batch/prompt', requireAdmin, async (req, res) => {
        const inU = String(req.body?.uncertain_def ?? '').trim();
        const inC = String(req.body?.contradiction_def ?? '').trim();
        try {
            const cur = await resolvePromptParts(pool, PROMPT_ORG);
            const newU = inU || DEFAULT_UNCERTAIN_DEF;
            const newC = inC || DEFAULT_CONTRADICTION_DEF;
            // 변경 없음 → 불필요한 version 증가/재판정 방지.
            if (newU === cur.uncertainDef.trim() && newC === cur.contradictionDef.trim()) {
                return res.json({ ok: true, version: cur.version, unchanged: true, stale_count: 0 });
            }
            const storeU = newU === DEFAULT_UNCERTAIN_DEF ? null : newU;
            const storeC = newC === DEFAULT_CONTRADICTION_DEF ? null : newC;
            const systemPrompt = buildSystemPrompt({ uncertainDef: newU, contradictionDef: newC });
            const updatedBy = req.session?.user_id ?? null;
            // 현재본과 이력이 한 테이블로 통합(마이그레이션 70) — 새 버전 행을 append 하면
            // 그 자체가 현재본(=org 별 최대 version)이자 이력이 된다. 별도 history INSERT 불필요.
            const { rows } = await pool.query(
                `INSERT INTO qa_confidence_prompt
                 (tenant_id, version, system_prompt, uncertain_def, contradiction_def,
                  updated_at, updated_by, updated_by_name)
             SELECT $1,
                    COALESCE((SELECT MAX(version) FROM qa_confidence_prompt WHERE tenant_id = $1), 0) + 1,
                    $2, $3, $4, now(), $5, $6
             RETURNING version`,
                [PROMPT_ORG, systemPrompt, storeU, storeC, updatedBy, req.session?.display_name ?? null]
            );
            const version = rows[0]?.version ?? 1;
            // stale = 평가행이 있으나(eval_item_score) 현재 프롬프트 버전으로 판정(eval_annotation.prompt_version)되지 않은 콜.
            const { rows: sc } = await pool.query(
                `SELECT count(*)::int AS n
               FROM common.calls c JOIN trustguard.qa_evaluations e ON e.call_id = c.call_id
              WHERE e.is_sandbox = false
                AND EXISTS (SELECT 1 FROM eval_item_score er WHERE er.call_id = c.call_id)
                AND NOT EXISTS (SELECT 1 FROM eval_annotation j
                                 WHERE j.call_id = c.call_id AND j.prompt_version = $1)`,
                [version]
            );
            res.json({ ok: true, version, unchanged: false, stale_count: sc[0]?.n ?? 0 });
        } catch (e) {
            console.error('PUT /api/batch/prompt error:', e?.message || e);
            res.status(500).json({ ok: false, message: '판정 프롬프트 저장 실패' });
        }
    });

    // POST /api/batch/run — 수기평가 대상 도장 즉시 실행(수동 트리거). 배치주기 '수동'/'매일'/'매시간'에서
    //   '지금 실행' 버튼이 호출. in-scope 전체 미도장 대상에 도장(멱등·누적). body 없음.
    router.post('/api/batch/run', requireAdmin, async (req, res) => {
        try {
            const orgId = batchOrgKey(req);
            const stamped = await applyManualReviewStamps(pool, orgId, { qaIds: null });
            res.json({ ok: true, org_id: orgId, stamped });
        } catch (e) {
            console.error('POST /api/batch/run error:', e?.message || e);
            res.status(500).json({ ok: false, message: '배치 실행 실패' });
        }
    });

    // GET /api/batch/prompt/history — 판정 프롬프트 변경 이력(버전별 스냅샷, 최신순). 읽기전용.
    router.get('/api/batch/prompt/history', requireAdmin, async (req, res) => {
        try {
            const { rows } = await pool.query(
                `SELECT version, uncertain_def, contradiction_def, updated_at, updated_by, updated_by_name
               FROM qa_confidence_prompt
              WHERE tenant_id = $1
              ORDER BY version DESC, id DESC
              LIMIT 100`,
                [PROMPT_ORG]
            );
            res.json({ ok: true, items: rows });
        } catch (e) {
            console.error('GET /api/batch/prompt/history error:', e?.message || e);
            res.status(500).json({ ok: false, message: '변경 이력 조회 실패' });
        }
    });

    // POST /api/batch/rejudge — 현재 프롬프트 버전으로 미판정 콜 재판정(백그라운드 비동기).
    // 즉시 반환하고 진행상황은 GET /api/batch/rejudge/status 로 폴링.
    router.post('/api/batch/rejudge', requireAdmin, async (req, res) => {
        if (!judgeEnabled()) {
            return res.status(400).json({ ok: false, message: 'GEMINI_API_KEY 미설정 — 재판정 불가' });
        }
        if (rejudgeJob.running) {
            return res.json({ ok: true, running: true, already: true, done: rejudgeJob.done, total: rejudgeJob.total });
        }
        rejudgeJob = { running: true, started_at: new Date().toISOString(), finished_at: null, done: 0, total: null, result: null, error: null };
        // fire-and-forget. 예외는 잡 상태에 기록(프로세스 안 죽게).
        runJudgeBackfill(pool, {
            limit: 1000,
            orgId: PROMPT_ORG,
            onProgress: ({ done, total }) => { rejudgeJob.done = done; rejudgeJob.total = total; },
        })
            .then((r) => {
                rejudgeJob.running = false;
                rejudgeJob.finished_at = new Date().toISOString();
                rejudgeJob.total = r.total;
                rejudgeJob.done = r.done;
                rejudgeJob.result = r;
            })
            .catch((e) => {
                rejudgeJob.running = false;
                rejudgeJob.finished_at = new Date().toISOString();
                rejudgeJob.error = e?.message || String(e);
                logger.warn(`[rejudge] 실패: ${rejudgeJob.error}`);
            });
        res.json({ ok: true, started: true });
    });

    // GET /api/batch/rejudge/status — 재판정 진행상황 폴링.
    router.get('/api/batch/rejudge/status', requireAdmin, (req, res) => {
        res.json({ ok: true, ...rejudgeJob });
    });

    return router;
}
