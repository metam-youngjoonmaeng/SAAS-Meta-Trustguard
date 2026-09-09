// LLM 백엔드 조회 · RAG 벡터 백엔드 전환 · RAG 로그/few-shot 설정 라우트 — server/index.js 에서 분리 (2026-09-03).
//
// 라우트 6개 · 함께 옮긴 헬퍼/상태 0개. 본문은 index.js 원문 그대로(경로·메서드·순서·핸들러 무변경),
// callee 만 app→router. 이 파일 라우트에서만 쓰이던 선언만 여기로 왔고, 다른 곳도 쓰는 공통 헬퍼
// (pool·requireAdmin·resolveActiveOrgId 등)는 index.js 가 ctx 로 넘긴다 — 등록: app.use(createRagLlmRoutes({ ... })).
// 전역 인증 미들웨어(app.use, index.js)는 마운트 앞에 있으므로 종전과 같이 적용된다.

import express from 'express';
import { insertQaAuditLog } from '../auditLog.mjs';
import { resolvePipelineBaseUrl } from '../qaPipelineIngest.mjs';
import { loadRagFewshotConfig, saveRagFewshotConfig } from '../ragFewshotConfig.mjs';

export function createRagLlmRoutes(ctx) {
    const { RAG_LOG, RAG_LOG_MAX, pool, requireAdmin } = ctx;
    const router = express.Router();

    // ── LLM 백엔드 가용성 중계 (2026-08-27) ──────────────────────────────────────
    // GET /api/llm/backends — 파이프라인 GET /v2/llm/backends 를 그대로 물어본다.
    //
    // 왜 필요한가: 평가 업로드 모달의 백엔드 드롭다운은 종전에 옵션을 하드코딩했다. Azure 를
    //   그대로 추가하면 **서버 env(AZURE_OPENAI_*)가 비어 있어도 고를 수 있게** 되는데, 그 상태로
    //   실행하면 파이프라인 _resolve_backend 가 기본 백엔드로 폴백해 **의도와 다른 백엔드로 평가**된다
    //   (2026-09-02 이전엔 bedrock 폴백 → IAM 거부로 통째 실패). 그래서 고르기 전에 가용성을 물어본다.
    //
    // 응답: { ok, default, lock:{locked,backend,model,exempt_backends}, backends:{<name>:{available,...}} }
    //   파이프라인 불통이면 200 + { ok:false, message } — 프론트는 '알 수 없음' 으로 degrade 하고
    //   옵션을 막지 않는다(가용성 조회 실패가 평가 실행을 막아서는 안 된다).
    //
    // ※ 키는 오지 않는다 — 파이프라인 azure_status() 가 존재 여부만 bool 로 준다. 여기서는 그중
    //   `endpoint`(Azure 리소스 URL)마저 떨어내고 넘긴다. 대시보드 화면이 쓰지 않는 값이다.
    router.get('/api/llm/backends', async (req, res) => {
        try {
            const base = resolvePipelineBaseUrl(null, {}).replace(/\/+$/, '');
            const resp = await fetch(`${base}/v2/llm/backends`, { signal: AbortSignal.timeout(8_000) });
            let j = null;
            try {
                j = await resp.json();
            } catch {
                /* 비-JSON 응답 */
            }
            if (!resp.ok || j === null) throw new Error(`백엔드 목록 조회 실패 (http_${resp.status})`);
            const backends = {};
            for (const [name, info] of Object.entries(j.backends || {})) {
                const src = info && typeof info === 'object' ? info : {};
                backends[name] = {
                    available: src.available === true,
                    has_api_key: src.has_api_key === true ? true : undefined,
                    default_deployment: src.default_deployment ?? undefined,
                    default_model: src.default_model ?? src.model ?? undefined,
                    api_version: src.api_version ?? undefined,
                };
            }
            res.json({ ok: true, default: j.default ?? null, lock: j.lock ?? null, backends });
        } catch (err) {
            // 502 로 던지지 않는다 — 프론트가 이 조회 실패로 실행 버튼을 잠그면 안 된다.
            console.warn('GET /api/llm/backends: 파이프라인 조회 실패 —', String(err?.message || err));
            res.json({ ok: false, message: String(err?.message || err), backends: {} });
        }
    });

    // ── RAG 벡터 백엔드(AOSS ↔ 로컬 OpenSearch) 조회·전환 (2026-09-03, 실험용) ─────────────────────
    // 파이프라인 `GET/POST /v2/rag/backend` 중계. 시스템 설정 > '운영' 그룹의 'RAG 벡터 백엔드' 카드가 쓴다.
    //   · GET  : 현재 모드·엔드포인트·연결 여부(probe=1 은 실제 인덱스 조회까지). 불통이면 200 + ok:false
    //            (llm/backends 와 같은 degrade — 조회 실패가 화면을 잠그면 안 된다).
    //   · PUT  : { mode: 'aoss'|'local' } — 관리자 전용. 파이프라인이 새 백엔드 연결 실패 시 이전 모드로
    //            되돌리고 502 를 주므로 그 사유를 그대로 전달한다(조용한 성공 금지).
    //   ※ 파이프라인 프로세스 런타임 상태다 — 파이프라인이 재기동되면 env 기본값(운영: aoss)으로 돌아간다.
    //     이 서버는 값을 저장하지 않는다(DB 무변경).
    router.get('/api/rag/backend', async (req, res) => {
        try {
            const base = resolvePipelineBaseUrl(null, {}).replace(/\/+$/, '');
            const probe = String(req.query?.probe ?? '1') === '0' ? '' : '?probe=1';
            const resp = await fetch(`${base}/v2/rag/backend${probe}`, { signal: AbortSignal.timeout(15_000) });
            let j = null;
            try {
                j = await resp.json();
            } catch {
                /* 비-JSON 응답 */
            }
            if (!resp.ok || j === null) throw new Error(`RAG 백엔드 조회 실패 (http_${resp.status})`);
            res.json({
                ok: j.ok === true,
                mode: j.mode ?? null,
                local: j.local === true,
                endpoint: j.endpoint ?? '',
                allowed: Array.isArray(j.allowed) ? j.allowed : ['aoss', 'local'],
                // 기본 모드 — 카드가 '(default)' 표시에 쓴다(2026-09-07). 파이프라인이 정본.
                default: j.default ?? null,
                reachable: j.reachable === true,
                golden_docs: Number.isFinite(Number(j.golden_docs)) ? Number(j.golden_docs) : null,
                cluster: j.cluster ?? null,
                error: j.error ?? null,
                persistent: j.persistent === true,
                // 2026-09-04 — 스토어 모드에 묶인 임베딩 모델(aoss→Titan V2 · local→Harrier). 파이프라인 값 그대로.
                embedding: j.embedding && typeof j.embedding === 'object' ? j.embedding : null,
                index_embedding_backend: j.index_embedding_backend ?? null,
            });
        } catch (err) {
            console.warn('GET /api/rag/backend: 파이프라인 조회 실패 —', String(err?.message || err));
            res.json({ ok: false, message: String(err?.message || err), mode: null, allowed: ['aoss', 'local'] });
        }
    });

    router.put('/api/rag/backend', requireAdmin, async (req, res) => {
        const mode = String(req.body?.mode ?? '').trim().toLowerCase();
        if (mode !== 'aoss' && mode !== 'local') {
            res.status(400).json({ ok: false, message: "mode 는 'aoss' 또는 'local' 이어야 합니다." });
            return;
        }
        try {
            const base = resolvePipelineBaseUrl(null, {}).replace(/\/+$/, '');
            const resp = await fetch(`${base}/v2/rag/backend`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ mode }),
                signal: AbortSignal.timeout(30_000),
            });
            let j = null;
            try {
                j = await resp.json();
            } catch {
                /* 비-JSON 응답 */
            }
            if (!resp.ok || !j || j.ok !== true) {
                // 파이프라인이 되돌린 경우 j.mode = 복귀한 모드. 사유를 그대로 올린다.
                res.status(resp.status >= 400 ? resp.status : 502).json({
                    ok: false,
                    message: String(j?.error || `RAG 백엔드 전환 실패 (http_${resp.status})`),
                    mode: j?.mode ?? null,
                    embedding: j?.embedding && typeof j.embedding === 'object' ? j.embedding : null,
                });
                return;
            }
            // 감사로그 — 실패해도 전환 결과 응답은 막지 않는다(전환은 파이프라인에서 이미 끝났다).
            try {
                await insertQaAuditLog(pool, {
                    req,
                    action: 'QA_RAG_BACKEND_SWITCH',
                    resource_type: 'rag_backend',
                    resource_id: String(j.mode).slice(0, 256),
                    http_method: 'PUT',
                    http_path: '/api/rag/backend',
                    detail_json: JSON.stringify({
                        from: j.previous ?? null, to: j.mode, endpoint: j.endpoint ?? '',
                        embedding: j.embedding?.backend ?? null, embedding_model: j.embedding?.model ?? null,
                    }),
                });
            } catch (auditErr) {
                console.warn('PUT /api/rag/backend: 감사로그 기록 실패 —', String(auditErr?.message || auditErr));
            }
            res.json({
                ok: true,
                mode: j.mode,
                local: j.local === true,
                endpoint: j.endpoint ?? '',
                previous: j.previous ?? null,
                reachable: j.reachable === true,
                golden_docs: Number.isFinite(Number(j.golden_docs)) ? Number(j.golden_docs) : null,
                cluster: j.cluster ?? null,
                embedding: j.embedding && typeof j.embedding === 'object' ? j.embedding : null,
                index_embedding_backend: j.index_embedding_backend ?? null,
            });
        } catch (err) {
            console.warn('PUT /api/rag/backend: 파이프라인 호출 실패 —', String(err?.message || err));
            res.status(502).json({ ok: false, message: String(err?.message || err) });
        }
    });

    // ── 평가 모델(OpenAI) 조회·전환 (2026-09-07) ───────────────────────────────────────────
    // 파이프라인 `GET/POST /v2/llm/model` 중계. 시스템 설정 > '운영' 그룹의 '평가 모델' 카드가 쓴다.
    //   · GET  : 현재 모델 + 선택 가능 목록. 불통이면 200 + ok:false (조회 실패가 화면을 잠그면 안 된다).
    //   · PUT  : { model } — 관리자 전용. 파이프라인이 허용목록 밖이면 400, 실제 호출 실패 시
    //            이전 모델로 되돌리고 502 를 주므로 그 사유를 그대로 전달한다(조용한 성공 금지).
    //   ※ RAG 백엔드 카드와 같은 성격 — 파이프라인 프로세스 런타임 상태이고 재기동되면
    //     env 기본값(OPENAI_MODEL=gpt-5.6-luna)으로 돌아간다. 이 서버는 값을 저장하지 않는다(DB 무변경).
    //   ※ 허용목록 정본은 파이프라인 nodes/openai_llm.py::SELECTABLE_MODELS 다. 여기서 값을
    //     검증하지 않는다 — 두 곳에서 검증하면 목록이 갈렸을 때 어느 쪽이 맞는지 모르게 된다.
    router.get('/api/llm/model', async (req, res) => {
        try {
            const base = resolvePipelineBaseUrl(null, {}).replace(/\/+$/, '');
            // probe=1 기본 — 카드의 작동 표시등이 실제 호출 결과여야 의미가 있다.
            //   ?probe=0 으로 끌 수 있다(과금 호출 1회를 아끼고 싶을 때).
            const probe = String(req.query?.probe ?? '1') === '0' ? '?probe=0' : '?probe=1';
            const resp = await fetch(`${base}/v2/llm/model${probe}`, { signal: AbortSignal.timeout(60_000) });
            let j = null;
            try {
                j = await resp.json();
            } catch {
                /* 비-JSON 응답 */
            }
            if (!resp.ok || j === null) throw new Error(`평가 모델 조회 실패 (http_${resp.status})`);
            res.json({
                ok: j.ok === true,
                model: j.model ?? null,
                default: j.default ?? null,
                // 작동 표시등 — 'ok' | 'down' | 'unknown' (probe=1 실호출 결과)
                health: j.health ?? 'unknown',
                health_ms: Number.isFinite(Number(j.health_ms)) ? Number(j.health_ms) : null,
                health_error: j.health_error ?? '',
                selectable: Array.isArray(j.selectable) ? j.selectable : [],
                // entries = [{model, base_url?, available}] — 카드가 (default)/(내려감) 표시에 쓴다.
                entries: Array.isArray(j.entries) ? j.entries : [],
                source: j.source ?? null,
                backend: j.backend ?? null,
                // vllm 전용 — 설정 모델이 그 포트에 없으면 평가가 전부 404 다.
                base_url: j.base_url ?? null,
                mismatch: j.mismatch === true,
                served: Array.isArray(j.served) ? j.served : [],
                error: j.error ?? null,
            });
        } catch (err) {
            console.warn('GET /api/llm/model: 파이프라인 조회 실패 —', String(err?.message || err));
            res.json({ ok: false, message: String(err?.message || err), model: null, selectable: [] });
        }
    });

    router.put('/api/llm/model', requireAdmin, async (req, res) => {
        const model = String(req.body?.model ?? '').trim();
        if (!model) {
            res.status(400).json({ ok: false, message: 'model 이 필요합니다.' });
            return;
        }
        try {
            const base = resolvePipelineBaseUrl(null, {}).replace(/\/+$/, '');
            // 전환은 실제 모델 호출 1회를 포함한다 — reasoning 모델이면 수 초 걸리므로 여유를 둔다.
            const resp = await fetch(`${base}/v2/llm/model`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ model }),
                signal: AbortSignal.timeout(60_000),
            });
            let j = null;
            try {
                j = await resp.json();
            } catch {
                /* 비-JSON 응답 */
            }
            if (!resp.ok || !j || j.ok !== true) {
                // 파이프라인이 되돌린 경우 j.model = 복귀한 모델. 사유를 그대로 올린다.
                res.status(resp.status >= 400 ? resp.status : 502).json({
                    ok: false,
                    message: String(j?.error || `평가 모델 전환 실패 (http_${resp.status})`),
                    detail: j?.detail ?? null,
                    model: j?.model ?? null,
                    selectable: Array.isArray(j?.selectable) ? j.selectable : [],
                });
                return;
            }
            // 감사로그 — 평가 결과의 해석이 모델에 달려 있으므로 "언제 누가 바꿨는지" 가 남아야 한다.
            //   실패해도 전환 결과 응답은 막지 않는다(전환은 파이프라인에서 이미 끝났다).
            try {
                await insertQaAuditLog(pool, {
                    req,
                    action: 'QA_LLM_MODEL_SWITCH',
                    resource_type: 'llm_model',
                    resource_id: String(j.model).slice(0, 256),
                    http_method: 'PUT',
                    http_path: '/api/llm/model',
                    detail_json: JSON.stringify({
                        from: j.previous ?? null,
                        to: j.model,
                        latency_ms: j.latency_ms ?? null,
                        unchanged: j.unchanged === true,
                    }),
                });
            } catch (auditErr) {
                console.warn('PUT /api/llm/model: 감사로그 기록 실패 —', String(auditErr?.message || auditErr));
            }
            res.json({
                ok: true,
                model: j.model,
                // ★ backend 를 반드시 실어 보낸다 — 모델 선택이 백엔드까지 바꾸므로, 빠지면
                //   화면이 이전 백엔드를 그대로 들고 있어 경고가 엉뚱하게 뜬다(2026-09-07 실측).
                backend: j.backend ?? null,
                previous: j.previous ?? null,
                latency_ms: j.latency_ms ?? null,
                unchanged: j.unchanged === true,
                selectable: Array.isArray(j.selectable) ? j.selectable : [],
                base_url: j.base_url ?? null,
                source: j.source ?? 'runtime',
            });
        } catch (err) {
            console.warn('PUT /api/llm/model: 파이프라인 호출 실패 —', String(err?.message || err));
            res.status(502).json({ ok: false, message: String(err?.message || err) });
        }
    });

    // [RAG·사전 로그, additive] 백엔드 RAG few-shot hit / 금지어·사전 매칭 인메모리 로그 조회.
    // limit(기본 100, 1~500) · qa_id(옵션 필터). 최신순으로 slice 반환. DB 미조회(인메모리 링버퍼).
    // 평가 시 disable_rag=false 여야 RAG hit 이 발생(대시보드 기본 모드는 RAG OFF → 빈 결과).
    router.get('/api/rag-log/recent', requireAdmin, (req, res) => {
        let limit = Number(req.query.limit);
        if (!Number.isFinite(limit) || limit <= 0) limit = 100;
        limit = Math.min(Math.max(1, Math.trunc(limit)), RAG_LOG_MAX);
        const qaId = String(req.query.qa_id || '').trim();
        // 잔존 노이즈 차단: RAG_LOG 는 글로벌·평가간 미클리어라 0-hit 적재 후 과거 콜이 섞여 보일 수 있음.
        //   qa_id 지정 시 그 콜만(윈도우 무시). 미지정(탭 기본 폴링) 시 within_minutes(기본 60분) 밖은 컷.
        let withinMin = Number(req.query.within_minutes);
        if (!Number.isFinite(withinMin) || withinMin <= 0) withinMin = 60;
        let rows = RAG_LOG;
        if (qaId) {
            rows = rows.filter((e) => String(e.qa_id ?? '') === qaId);
        } else {
            const cutoff = Date.now() - withinMin * 60 * 1000;
            rows = rows.filter((e) => (e.ts || 0) >= cutoff);
        }
        // 최신순(ts 내림차순) — 원본 링버퍼는 변형하지 않도록 복사 후 정렬.
        const entries = rows.slice().sort((a, b) => (b.ts || 0) - (a.ts || 0)).slice(0, limit);
        res.json({ entries });
    });

    // 루브릭 few-shot 항목 토글 설정 — UI 에서 "이 항목만 RAG" 를 켜고 끄는 영속 설정.
    // shape: { "<org_id>": { rubric_id, item_names:[...] } }. DB(organizations) 영속, 평가 시
    // evaluateStandardCall 이 getOrgFewshot 으로 읽음.
    router.get('/api/rag-fewshot-config', requireAdmin, async (req, res) => {
        try {
            res.json({ config: await loadRagFewshotConfig(pool) });
        } catch (e) {
            res.status(500).json({ error: String(e?.message || e) });
        }
    });

    router.put('/api/rag-fewshot-config', requireAdmin, async (req, res) => {
        try {
            // body 가 {config:{...}} 또는 설정 객체 자체 둘 다 수용.
            const body = req.body && typeof req.body === 'object' ? req.body : {};
            const cfg = body.config && typeof body.config === 'object' ? body.config : body;
            const saved = await saveRagFewshotConfig(pool, cfg);
            res.json({ ok: true, config: saved });
        } catch (e) {
            res.status(500).json({ error: String(e?.message || e) });
        }
    });

    return router;
}
