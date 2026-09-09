// 외부 적재 (AI Canvas · 컬렉션 콜 · QA 파이프라인 · 배치 job) 라우트 — server/index.js 에서 분리 (2026-09-03).
//
// 라우트 5개 · 함께 옮긴 헬퍼/상태 4개. 본문은 index.js 원문 그대로(경로·메서드·순서·핸들러 무변경),
// callee 만 app→router. 이 파일 라우트에서만 쓰이던 선언만 여기로 왔고, 다른 곳도 쓰는 공통 헬퍼
// (pool·requireAdmin·resolveActiveOrgId 등)는 index.js 가 ctx 로 넘긴다 — 등록: app.use(createIngestRoutes({ ... })).
// 전역 인증 미들웨어(app.use, index.js)는 마운트 앞에 있으므로 종전과 같이 적용된다.

import express from 'express';
import { fetchAndIngestFromAiCanvas } from '../aiCanvasIngest.mjs';
import { AUDIT_ACTION, insertQaAuditLog } from '../auditLog.mjs';
import { ingestCollectionCallToDb } from '../collectionCallIngest.mjs';
import { logger } from '../logger.mjs';
import { extractForbiddenFromResult, ingestCallFromQaPipeline, ingestStandardCallFromQaPipeline } from '../qaPipelineIngest.mjs';
import { randomUUID } from 'node:crypto';

export function createIngestRoutes(ctx) {
    const { RAG_LOG, RAG_LOG_MAX, pool, pushSkillLog } = ctx;
    const router = express.Router();

    function pushRagLog(entry) {
        if (!entry || typeof entry !== 'object') return;
        RAG_LOG.push({ ts: Date.now(), ...entry });
        if (RAG_LOG.length > RAG_LOG_MAX) RAG_LOG.shift();
        // 서버 로그(실시간 로그 > 서버 로그 App 탭)에도 한 줄 — 전용 탭 없이 "RAG 를 돌렸는지/무엇을" 관측.
        try {
            const who = entry.item_name || (entry.item_number != null ? `#${entry.item_number}` : '');
            if (entry.kind === 'forbidden') {
                logger.info(`[RAG/사전] qa=${entry.qa_id ?? '?'} ${who} · 매칭 ${Array.isArray(entry.matches) ? entry.matches.length : 0}건`);
            } else {
                logger.info(`[RAG] qa=${entry.qa_id ?? '?'} ${who} · 조회 ${Array.isArray(entry.hits) ? entry.hits.length : 0}건 hit`);
            }
        } catch { /* 로그 실패는 무시 */ }
    }

    // AI Canvas pull 동기화 — body 의 url + api_key (또는 환경변수) 로 외부 데이터셋을 GET 한 뒤
    // 각 행의 payload(JSON 문자열) 를 풀어 컬렉션관리부 콜로 적재.
    router.post('/api/ingest/from-ai-canvas', async (req, res) => {
        const url = String(req.body?.url || process.env.AI_CANVAS_DATASET_URL || '').trim();
        const apiKey = (String(req.body?.api_key || process.env.AI_CANVAS_API_KEY || '').trim()) || null;
        if (!url) {
            res.status(400).json({
                ok: false,
                message: 'url 이 필요합니다. body 의 url 또는 AI_CANVAS_DATASET_URL 환경변수.',
            });
            return;
        }
        try {
            const result = await fetchAndIngestFromAiCanvas(pool, { url, apiKey });
            if (!result.ok) {
                res.status(502).json(result);
                return;
            }
            await insertQaAuditLog(pool, {
                req,
                action: AUDIT_ACTION.INGEST_AI_CANVAS,
                resource_type: 'qa_call',
                resource_id: String(result.inserted ?? result.count ?? 'bulk').slice(0, 256),
                http_method: 'POST',
                http_path: '/api/ingest/from-ai-canvas',
                detail_json: JSON.stringify({ url, inserted: result.inserted ?? null }).slice(0, 8000),
                success: true,
            });
            res.json(result);
        } catch (error) {
            console.error('POST /api/ingest/from-ai-canvas error:', error);
            res.status(500).json({ ok: false, message: String(error?.message || error) });
        }
    });

    // 외부 API 연동용 ingest — 컬렉션관리부 1콜.
    // 명세: docs/EXTERNAL_API_GUIDE.md (JSON / CSV 형식, 직무별 만점 매트릭스, 화면 반영 흐름).
    router.post('/api/ingest/collection-call', async (req, res) => {
        const body = req.body;
        if (!body || typeof body !== 'object') {
            res.status(400).json({ ok: false, message: 'JSON body 가 필요합니다.' });
            return;
        }
        try {
            const result = await ingestCollectionCallToDb(pool, body);
            if (!result.ok) {
                res.status(400).json(result);
                return;
            }
            await insertQaAuditLog(pool, {
                req,
                action: AUDIT_ACTION.INGEST_COLLECTION_CALL,
                resource_type: 'qa_call',
                resource_id: String(result.qa_id ?? result.call_seq ?? '(new)').slice(0, 256),
                http_method: 'POST',
                http_path: '/api/ingest/collection-call',
                success: true,
            });
            res.json(result);
        } catch (error) {
            console.error('POST /api/ingest/collection-call error:', error);
            res.status(500).json({ ok: false, message: String(error?.message || error) });
        }
    });

    // qa-pipeline (/evaluate) 연동 ingest — body.calls[] 각 콜을 순차로 평가→환산→적재.
    // 각 call: { qa_id|consultation_id|id, transcript, cdate, department, role, org_id, call_seq, uid }.
    // QA_PIPELINE_BASE_URL 환경변수(기본 http://localhost:8081) 의 POST /evaluate 호출.
    router.post('/api/ingest/from-qa-pipeline', async (req, res) => {
        const body = req.body;
        if (!body || typeof body !== 'object') {
            res.status(400).json({ ok: false, message: 'JSON body 가 필요합니다.' });
            return;
        }
        const calls = Array.isArray(body.calls) ? body.calls : body.call ? [body.call] : [];
        if (!calls.length) {
            res.status(400).json({ ok: false, message: 'calls 배열(또는 call 객체)이 필요합니다.' });
            return;
        }
        // base_url 은 명시적 body override 일 때만 전달 — env/call.pipeline_target(로컬/EC2) 해석은
        // qaPipelineIngest.resolvePipelineBaseUrl 담당 (여기서 env 를 주입하면 EC2 분기가 무력화됨).
        const baseUrl = String(body.base_url || '').trim() || undefined;
        // track: 'standard'(기본, 표준 18항목 직결 적재) | 'collection'(9-order 환산, 기존 동작).
        const track = String(body.track || 'standard').trim().toLowerCase();

        const failed = [];
        const skipped = [];
        const details = [];
        let ingested = 0;
        for (const call of calls) {
            const qaIdHint = String(call?.qa_id ?? call?.consultation_id ?? call?.id ?? '').trim();
            try {
                const result =
                    track === 'collection'
                        ? await ingestCallFromQaPipeline(pool, call, { baseUrl })
                        : await ingestStandardCallFromQaPipeline(pool, call, { baseUrl });
                if (!result.ok) {
                    failed.push({ qa_id: qaIdHint, reason: result.message, warnings: result.warnings });
                    continue;
                }
                // 포기호/미응대 — 적재 안 됨(qa_calls 미생성). 실패가 아니라 건너뜀으로 분류.
                if (result.skipped) {
                    skipped.push({ qa_id: result.qa_id || qaIdHint, reason: result.reason });
                    continue;
                }
                ingested += 1;
                details.push({
                    qa_id: result.qa_id,
                    role: result.role,
                    ai_score: result.ai_score,
                    total_score: result.total_score,
                    elapsed_sec: result.elapsed_sec,
                    warnings: result.warnings,
                    // 루브릭 트랙(standard) 부가: 원점수 합/만점 합. collection 트랙은 undefined → 생략.
                    raw_total: result.raw_total,
                    max_total: result.max_total,
                    // KMS 필수사항 체크 요약 — 적재 경로 신설 전까지 이 응답이 유일한 확인 창구.
                    // 전문(checks[]·적대검증 votes[])은 수 KB 라 응답에 싣지 않고 요약만 노출한다.
                    kms_coverage: result.kiwoom_coverage
                        ? {
                              available: result.kiwoom_coverage.available === true,
                              reason: result.kiwoom_coverage.reason ?? null,
                              detected: (result.kiwoom_coverage.detected || []).map((d) => d?.intent).filter(Boolean),
                              summary: result.kiwoom_coverage.mandatory?.coverage_summary ?? null,
                          }
                        : undefined,
                });
                await insertQaAuditLog(pool, {
                    req,
                    action: AUDIT_ACTION.INGEST_QA_PIPELINE,
                    resource_type: 'qa_call',
                    resource_id: String(result.qa_id ?? '(new)').slice(0, 256),
                    http_method: 'POST',
                    http_path: '/api/ingest/from-qa-pipeline',
                    detail_json: JSON.stringify({
                        elapsed_sec: result.elapsed_sec ?? null,
                        warnings: result.warnings ?? [],
                        source: result.source ?? null,
                    }).slice(0, 8000),
                    success: true,
                });
            } catch (error) {
                failed.push({ qa_id: qaIdHint, reason: String(error?.message || error) });
            }
        }

        res.json({ ok: failed.length === 0, ingested, skipped, failed, details });
    });

    // ── qa-pipeline 평가 비동기 잡 — SSE 노드 진행상황 중계 ──
    // POST 가 즉시 job_id 를 반환하고, 서버가 /evaluate/stream 을 소비하며 진행상황을 메모리에 보관.
    // 호출자가 GET /:jobId 를 폴링해 노드 단위 진행을 확인. 완료 시 적재 결과 포함.
    // 잡은 인메모리(컨테이너 재시작 시 소실) + 1시간 TTL 정리.
    const qaPipelineJobs = new Map();

    const QA_PIPELINE_JOB_TTL_MS = 60 * 60 * 1000;

    function sweepQaPipelineJobs() {
        const now = Date.now();
        for (const [id, job] of qaPipelineJobs) {
            if (now - job.created_at > QA_PIPELINE_JOB_TTL_MS) qaPipelineJobs.delete(id);
        }
    }

    router.post('/api/ingest/qa-pipeline-jobs', async (req, res) => {
        sweepQaPipelineJobs();
        const body = req.body;
        const call =
            body && typeof body === 'object' ? body.call || (Array.isArray(body.calls) ? body.calls[0] : null) : null;
        if (!call || typeof call !== 'object') {
            res.status(400).json({ ok: false, message: 'call 객체가 필요합니다.' });
            return;
        }
        const track = String(body.track || 'standard').trim().toLowerCase();
        const jobId = randomUUID();
        const job = {
            job_id: jobId,
            status: 'running',
            qa_id: String(call?.qa_id ?? call?.consultation_id ?? call?.id ?? '').trim(),
            pipeline_target: String(call?.pipeline_target || 'local').trim().toLowerCase(),
            track,
            created_at: Date.now(),
            finished_at: null,
            progress: { nodes_done: 0, running_nodes: [], recent_done: [], last_event_at: null },
            result: null,
            error: null,
        };
        qaPipelineJobs.set(jobId, job);

        const doneNodes = new Set();
        // 진행 표시 제외 노드 — 대시보드 경량 모드에서 스킵되는 기능(ksqi/debate/kms/narrator/GT)과
        // 내부 플럼빙(barrier 등). 0초 완료 이벤트가 단계 수를 부풀리고 "KSQI 평가" 같은
        // 꺼진 기능명이 노출되는 것을 방지.
        const PROGRESS_HIDDEN_NODE = /^(ksqi|gt_)|_barrier$|^(debate|kms|consumer_detect|hitl_queue_populator|combined_report|report_narrator)$/;
        // [RAG·사전 로그, additive] 평가 잡 진행 중 흘러오는 RAG few-shot hit(라이브)을 인메모리 링버퍼에 적재.
        // 평가 결과의 금지어/사전 매칭은 잡 완료 후 extractForbiddenFromResult 로 별도 push.
        const callOrgId = Number(call?.org_id);
        const ragOrgId = Number.isFinite(callOrgId) ? callOrgId : undefined;
        // 파이프라인이 forward 한 원 resp(있으면) — 금지어 추출용. onProgress(type==='result') 로 도착.
        let capturedRawResp = null;
        // [LLM 스킬 로그, additive] 평가 중 항목별 스킬 overlay 적용 이벤트 집계 — 잡 완료 시 1건 요약 적재.
        const skillOverlayEvents = [];
        const onProgress = (ev) => {
            if (!ev || typeof ev !== 'object') return;
            // 신규: LLM 스킬 overlay 적용 라이브 이벤트 — 잡 단위 집계(개별 push 는 링버퍼 노이즈).
            if (ev.type === 'skill_overlay') {
                if (ev.data && typeof ev.data === 'object') skillOverlayEvents.push(ev.data);
                return;
            }
            // 신규: RAG few-shot hit 라이브 이벤트 → 계약 레코드(kind:'rag') 적재. (기존 status 흐름 불변)
            if (ev.type === 'rag_hits') {
                try {
                    const d = ev.data || {};
                    const hits = Array.isArray(d.fewshot) ? d.fewshot : [];
                    // 0-hit(미적중) 도 "RAG 조회 활동"으로 적재 — 사용자가 RAG 가 돌았는지 확인 가능하게.
                    //   잔존(stale) 노이즈는 GET /api/rag-log/recent 의 qa_id 스코프 + within_minutes 윈도우로 차단.
                    //   (주의: PURE 평가 경로는 백엔드가 0-hit 시 rag_hits 이벤트 자체를 보내지 않으므로 — evaluator.py emit 가드 —
                    //    이 적재만으로 PURE 0-hit 은 안 보임. 백엔드 검토안 적용 시 가시화됨. CUSTOM_RUBRIC·금지어·hit≥1 은 즉시 표시.)
                    // STT 전체 원문(parsed_text)은 길 수 있어 인메모리 RAG_LOG 비대화 방지로 cap.
                    const _capText = (v, n) => {
                        const s = String(v ?? '');
                        return s.length > n ? s.slice(0, n) + ' …' : s;
                    };
                    pushRagLog({
                        qa_id: job.qa_id,
                        org_id: ragOrgId,
                        item_number: Number(d.item_number),
                        // 항목명 — 백엔드 emit_rag_hits_ready 가 보내는 실제 평가항목명. intent(general_inquiry)로
                        //   폴백하지 않음(폴백 시 이름 자리에 intent 가 중복 표시되던 문제). 없으면 프론트가 #번호 표시.
                        item_name: d.item_name || undefined,
                        kind: 'rag',
                        // 검색어/intent — 리치 카드 상단 표시용(UnifiedRagPanel QueryDisplay 동형).
                        fewshot_query: d.fewshot_query ? _capText(d.fewshot_query, 4000) : undefined,
                        intent: d.intent || undefined,
                        // ★ 리치 골든셋 카드(프론트 RagGoldenCard)용 — 백엔드 emit_rag_hits_ready 가 보내는
                        //   전체 필드 보존(압축 금지). segment_text/rationale/parsed_text/index_summary/
                        //   score_bucket/cos·rrf·rerank/rater_meta 모두 카드 토글 섹션에서 소비.
                        hits: hits.map((h) => ({
                            example_id: String(h?.example_id ?? ''),
                            item_number: h?.item_number ?? Number(d.item_number),
                            // 평가 score 부재(루브릭 예시 스토어) 시 코사인 유사도를 표시값으로 폴백.
                            score:
                                h?.score ??
                                (typeof h?.cosine_score === 'number'
                                    ? Math.round(h.cosine_score * 100) / 100
                                    : typeof h?.similarity === 'number'
                                      ? Math.round(h.similarity * 100) / 100
                                      : null),
                            // 항목 만점 — 카드 "人 N/M" 분모 표시용(관측 전용).
                            max_score: typeof h?.max_score === 'number' ? h.max_score : undefined,
                            score_bucket: h?.score_bucket ?? undefined,
                            intent: h?.intent ?? undefined,
                            // 가져온 예시 내용: 골든 원문(segment_text) 우선, 없으면 색인요약/근거.
                            summary: h?.segment_text || h?.index_summary || h?.rationale || undefined,
                            // ── 리치 카드 섹션 본문 ──
                            segment_text: _capText(h?.segment_text, 8000) || undefined,
                            rationale: _capText(h?.rationale, 4000) || undefined,
                            rationale_tags: Array.isArray(h?.rationale_tags) ? h.rationale_tags : undefined,
                            parsed_text: _capText(h?.parsed_text, 16000) || undefined,
                            index_summary: _capText(h?.index_summary, 4000) || undefined,
                            // ── 유사도/리랭크 칩 ──
                            cosine_score: typeof h?.cosine_score === 'number' ? h.cosine_score : undefined,
                            rrf_score: typeof h?.rrf_score === 'number' ? h.rrf_score : undefined,
                            bm25_score: typeof h?.bm25_score === 'number' ? h.bm25_score : undefined,
                            similarity: typeof h?.similarity === 'number' ? h.similarity : undefined,
                            cohere_rerank_score:
                                typeof h?.cohere_rerank_score === 'number' ? h.cohere_rerank_score : undefined,
                            reranked: h?.reranked ?? undefined,
                            rerank_provider: h?.rerank_provider ?? undefined,
                            rerank_skipped_reason: h?.rerank_skipped_reason ?? undefined,
                            // ── 검수자 메타 ──
                            rater_type: h?.rater_type ?? undefined,
                            rater_source: h?.rater_source ?? undefined,
                        })),
                    });
                } catch {
                    /* 로그 적재 실패는 평가에 영향 없음 */
                }
                return;
            }
            // 신규: 파이프라인이 원 resp 를 forward 하면 캡처(금지어 추출용). 진행 표시에는 영향 없음.
            if (ev.type === 'result') {
                if (ev.data && typeof ev.data === 'object') capturedRawResp = ev.data;
                return;
            }
            // 기존: 노드 진행(status). 신규 래핑(type:'status') / 레거시 평면 모두 수용.
            const stat = ev.type === 'status' ? ev.data?.status : ev.status;
            const node = String((ev.type === 'status' ? ev.data?.node : ev.node) || '').trim();
            if (!node) return;
            if (PROGRESS_HIDDEN_NODE.test(node)) return;
            const p = job.progress;
            p.last_event_at = Date.now();
            if (stat === 'started') {
                if (!p.running_nodes.includes(node)) p.running_nodes.push(node);
            } else if (stat === 'completed') {
                p.running_nodes = p.running_nodes.filter((n) => n !== node);
                if (!doneNodes.has(node)) {
                    doneNodes.add(node);
                    p.nodes_done += 1;
                    p.recent_done.push(node);
                    if (p.recent_done.length > 8) p.recent_done = p.recent_done.slice(-8);
                }
            }
        };

        (async () => {
            try {
                const result =
                    track === 'collection'
                        ? await ingestCallFromQaPipeline(pool, call, { onProgress })
                        : await ingestStandardCallFromQaPipeline(pool, call, { onProgress });
                if (!result.ok) {
                    job.status = 'error';
                    job.error = result.message || '적재 실패';
                    return;
                }
                // 포기호/미응대 — 적재 안 됨. 에러가 아니라 건너뜀으로 완료 처리.
                if (result.skipped) {
                    job.status = 'done';
                    job.result = { qa_id: result.qa_id, skipped: true, reason: result.reason };
                    return;
                }
                job.status = 'done';
                job.result = {
                    qa_id: result.qa_id,
                    role: result.role,
                    ai_score: result.ai_score,
                    total_score: result.total_score,
                    elapsed_sec: result.elapsed_sec,
                    warnings: result.warnings,
                    raw_total: result.raw_total,
                    max_total: result.max_total,
                };
                // [RAG·사전 로그, additive] 평가 결과에서 금지어/사전·규칙 매칭 추출 → 계약 레코드(kind:'forbidden') 적재.
                // 파이프라인이 원 resp 를 forward(onProgress type:'result')했을 때만 동작. 실패는 무시(무회귀).
                try {
                    if (capturedRawResp && typeof extractForbiddenFromResult === 'function') {
                        const forbidden = extractForbiddenFromResult(capturedRawResp) || [];
                        for (const f of forbidden) {
                            pushRagLog({
                                qa_id: result.qa_id ?? job.qa_id,
                                org_id: ragOrgId,
                                item_number: Number(f?.item_number),
                                item_name: f?.item_name || undefined,
                                kind: 'forbidden',
                                matches: Array.isArray(f?.matches)
                                    ? f.matches.map((m) => ({
                                          term: m?.term ?? undefined,
                                          rule_ref: m?.rule_ref ?? undefined,
                                          verdict: m?.verdict ?? undefined,
                                          quote: m?.quote ?? m?.agent_quote ?? undefined,
                                      }))
                                    : [],
                            });
                        }
                    }
                } catch {
                    /* 금지어 추출/적재 실패는 평가에 영향 없음 */
                }
                // [LLM 스킬 로그, additive] 평가 시 스킬 overlay 적용 요약 — 항목별 이벤트를 1건으로 집계.
                //   이벤트 자체가 없으면(스킬 게이트 비활성 콜) 적재하지 않음 — 허위 '미적용' 노이즈 방지.
                try {
                    if (skillOverlayEvents.length) {
                        const applied = skillOverlayEvents.filter((e) => e && e.applied);
                        const vid = (skillOverlayEvents.find((e) => e && e.version_id) || {}).version_id || null;
                        pushSkillLog({
                            org_id: ragOrgId,
                            source: 'evaluate',
                            stage: 'apply',
                            message: `평가 ${result.qa_id ?? job.qa_id} — 스킬 overlay 주입 ${applied.length}/${skillOverlayEvents.length}개 항목${vid ? ` · 버전 ${vid}` : ''}${applied.length === 0 ? ' (활성 버전에 해당 항목 룰 없음)' : ''}`,
                            qa_id: result.qa_id ?? job.qa_id,
                            version_id: vid,
                            items_changed: applied.map((e) => Number(e.item_number)).filter(Number.isFinite),
                            // 항목별 주입 상세(RAG 로그식 펼침용) — 파이프라인이 이벤트에 동봉한 "주입 시점
                            // 원문"(overlay_text, 파이프라인 cap 4000자) 보존. 링버퍼 방어로 한 번 더 cap.
                            items: skillOverlayEvents.map((e) => ({
                                item_number: Number(e?.item_number),
                                item_name: e?.item_name || undefined,
                                applied: !!e?.applied,
                                overlay_chars: Number(e?.overlay_chars) || 0,
                                overlay_text:
                                    typeof e?.overlay_text === 'string' && e.overlay_text
                                        ? e.overlay_text.slice(0, 4000)
                                        : undefined,
                            })),
                        });
                    }
                } catch {
                    /* 스킬 로그 적재 실패는 평가에 영향 없음 */
                }
                await insertQaAuditLog(pool, {
                    req,
                    action: AUDIT_ACTION.INGEST_QA_PIPELINE,
                    resource_type: 'qa_call',
                    resource_id: String(result.qa_id ?? '(new)').slice(0, 256),
                    http_method: 'POST',
                    http_path: '/api/ingest/qa-pipeline-jobs',
                    detail_json: JSON.stringify({
                        elapsed_sec: result.elapsed_sec ?? null,
                        warnings: result.warnings ?? [],
                        source: result.source ?? null,
                    }).slice(0, 8000),
                    success: true,
                });
            } catch (error) {
                job.status = 'error';
                job.error = String(error?.message || error);
            } finally {
                job.finished_at = Date.now();
            }
        })();

        res.json({ ok: true, job_id: jobId });
    });

    router.get('/api/ingest/qa-pipeline-jobs/:jobId', (req, res) => {
        const job = qaPipelineJobs.get(String(req.params.jobId || ''));
        if (!job) {
            res.status(404).json({ ok: false, message: '잡을 찾을 수 없습니다 (만료/서버 재시작 가능성).' });
            return;
        }
        res.json({
            ok: true,
            job: {
                job_id: job.job_id,
                status: job.status,
                qa_id: job.qa_id,
                pipeline_target: job.pipeline_target,
                track: job.track,
                progress: job.progress,
                result: job.result,
                error: job.error,
                created_at: job.created_at,
                finished_at: job.finished_at,
            },
        });
    });

    return router;
}
