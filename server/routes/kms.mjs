// KMS 업무 데이터 · 색인 라우트 — server/index.js 에서 분리 (2026-09-03).
//
// 라우트 3개 · 함께 옮긴 헬퍼/상태 9개. 본문은 index.js 원문 그대로(경로·메서드·순서·핸들러 무변경),
// callee 만 app→router. 이 파일 라우트에서만 쓰이던 선언만 여기로 왔고, 다른 곳도 쓰는 공통 헬퍼
// (pool·requireAdmin·resolveActiveOrgId 등)는 index.js 가 ctx 로 넘긴다 — 등록: app.use(createKmsRoutes({ ... })).
// 전역 인증 미들웨어(app.use, index.js)는 마운트 앞에 있으므로 종전과 같이 적용된다.

import express from 'express';
import { insertQaAuditLog } from '../auditLog.mjs';
import { resolvePipelineBaseUrl } from '../qaPipelineIngest.mjs';

export function createKmsRoutes(ctx) {
    const { pool, requireAdmin, resolveActiveOrgId } = ctx;
    const router = express.Router();

    /* ── KMS 업무 데이터 (업무별 필수 확인정보·안내) ──────────────────
     * 평가항목 관리 > [KMS 업무 데이터] 탭의 영속 소스.
     *
     * ★ 저장 위치 = qa_batch_configs.config.kms — 전용 테이블을 만들지 않는다(DDL 금지 원칙).
     *   같은 blob 안 golden/skill 키와 형제 관계다. 저장은 **읽기-수정-쓰기**로 형제 키를 보존하며,
     *   `/api/batch/config` PUT 을 재사용하지 않는다(그 라우트는 골든/스킬 동기화 부수효과가 있어
     *   KMS 탭에서 부분 저장하면 형제 설정이 지워질 수 있다).
     *
     * 채점 반영은 아직 없다 — 파이프라인 pure 트랙의 프롬프트 주입 슬롯이 fewshot·skill_overlay
     *   2개뿐이라 지식문서 슬롯이 신설될 때까지 이 탭은 **데이터 등록·조회 전용**이다.
     *   반영 시점에는 `linked_items`(평가항목 order_no)로 주입 대상을 게이트한다.
     * ───────────────────────────────────────────────────────── */

    const KMS_MAX_ITEMS = 200;

    // 문자열 배열 정규화 — 공백 제거·중복 제거·길이 상한. blob 무한 증식 방지.
    function normalizeKmsStrList(v, max, len) {
        if (!Array.isArray(v)) return [];
        const out = [];
        for (const s of v) {
            const t = String(s ?? '').trim().slice(0, len);
            if (t && !out.includes(t)) out.push(t);
            if (out.length >= max) break;
        }
        return out;
    }

    // 1건 정규화. 업무명(task)이 자연키 — 없으면 버린다(id 필드를 두지 않아 키 관리 실패 모드 제거).
    function normalizeKmsItem(raw) {
        if (!raw || typeof raw !== 'object') return null;
        const task = String(raw.task ?? '').trim().slice(0, 120);
        if (!task) return null;
        return {
            task,
            confirm_info: normalizeKmsStrList(raw.confirm_info, 30, 60),
            readback: raw.readback === true,
            mandatory_notice: normalizeKmsStrList(raw.mandatory_notice, 30, 300),
            linked_items: Array.isArray(raw.linked_items)
                ? [
                      ...new Set(
                          raw.linked_items.map((n) => Number(n)).filter((n) => Number.isInteger(n) && n > 0 && n < 1000)
                      ),
                  ]
                      .sort((a, b) => a - b)
                      .slice(0, 20)
                : [],
            active: raw.active !== false,
            note: String(raw.note ?? '').trim().slice(0, 500),
        };
    }

    const KMS_MAX_DOCS = 100;

    const KMS_DOC_BODY_MAX = 20000;      // 문서 1건 본문 상한

    const KMS_DOCS_TOTAL_MAX = 500000;   // 전체 본문 합 상한 — jsonb blob 비대화 방지

    // KMS 문서 1건 정규화. 제목(title)이 자연키. 본문이 비면 색인 대상이 없으므로 폐기.
    // linked_items = 이 문서를 근거로 판정할 평가항목 order_no — 색인 후 주입 게이트가 된다.
    function normalizeKmsDoc(raw) {
        if (!raw || typeof raw !== 'object') return null;
        const title = String(raw.title ?? '').trim().slice(0, 200);
        const body = String(raw.body ?? '').replace(/\r\n/g, '\n').trim().slice(0, KMS_DOC_BODY_MAX);
        if (!title || !body) return null;
        return {
            title,
            body,
            tags: normalizeKmsStrList(raw.tags, 20, 40),
            linked_items: Array.isArray(raw.linked_items)
                ? [
                      ...new Set(
                          raw.linked_items.map((n) => Number(n)).filter((n) => Number.isInteger(n) && n > 0 && n < 1000)
                      ),
                  ]
                      .sort((a, b) => a - b)
                      .slice(0, 20)
                : [],
            active: raw.active !== false,
        };
    }

    // KMS 지정 평가항목 번호 목록 — 배지 표시 + 색인/주입 대상 게이트.
    function normalizeMarkedItems(v) {
        if (!Array.isArray(v)) return [];
        return [...new Set(v.map((n) => Number(n)).filter((n) => Number.isInteger(n) && n > 0 && n < 1000))]
            .sort((a, b) => a - b)
            .slice(0, 100);
    }

    // 저장 blob → API 응답 형태. 레거시(items 만 있던 초기 저장분)도 그대로 읽힌다.
    function readKmsBlob(blob) {
        return {
            items: Array.isArray(blob?.items) ? blob.items.map(normalizeKmsItem).filter(Boolean) : [],
            marked_items: normalizeMarkedItems(blob?.marked_items),
            docs: Array.isArray(blob?.docs) ? blob.docs.map(normalizeKmsDoc).filter(Boolean) : [],
            indexed_at: blob?.indexed_at ?? null,
            index_status: blob?.index_status ?? null,
        };
    }

    // GET /api/admin/kms-items — 활성 브랜드의 KMS 설정(업무 데이터 · 지정 항목 · 문서).
    // 평가항목 관리 화면의 KMS 배지도 이 응답의 marked_items/docs 로 그린다(별 라우트 없음).
    router.get('/api/admin/kms-items', requireAdmin, async (req, res) => {
        try {
            const orgId = resolveActiveOrgId(req);
            if (!orgId) {
                res.json({ ok: true, org_id: null, items: [], marked_items: [], docs: [], updated_at: null });
                return;
            }
            const { rows } = await pool.query(
                `SELECT config -> 'kms' AS kms, updated_at FROM qa_batch_configs WHERE tenant_id = $1`,
                [orgId]
            );
            const blob = rows[0]?.kms;
            res.json({
                ok: true,
                org_id: orgId,
                ...readKmsBlob(blob),
                updated_at: blob?.updated_at ?? rows[0]?.updated_at ?? null,
            });
        } catch (e) {
            console.error('GET /api/admin/kms-items error:', e?.message || e);
            res.status(500).json({ ok: false, message: 'KMS 설정 조회 실패' });
        }
    });

    // PUT /api/admin/kms-items — 전량 저장(치환). body: { items[], marked_items[], docs[] }
    // 세 채널 모두 선택적 — 넘긴 것만 교체하고 나머지는 기존값을 보존한다(탭별 부분 저장 허용).
    router.put('/api/admin/kms-items', requireAdmin, async (req, res) => {
        // 쓰기 라우트는 strict — 활성 브랜드 헤더가 없으면 어디에 저장할지 정할 수 없다.
        const orgId = resolveActiveOrgId(req, { strict: true });
        if (!orgId) {
            res.status(400).json({ ok: false, message: '브랜드를 선택한 뒤 저장하세요.' });
            return;
        }
        const rawItems = Array.isArray(req.body?.items) ? req.body.items : null;
        const rawMarks = Array.isArray(req.body?.marked_items) ? req.body.marked_items : null;
        const rawDocs = Array.isArray(req.body?.docs) ? req.body.docs : null;
        if (!rawItems && !rawMarks && !rawDocs) {
            res.status(400).json({ ok: false, message: 'items · marked_items · docs 중 하나 이상이 필요합니다.' });
            return;
        }
        if (rawItems && rawItems.length > KMS_MAX_ITEMS) {
            res.status(400).json({ ok: false, message: `업무는 최대 ${KMS_MAX_ITEMS}건까지 저장합니다.` });
            return;
        }
        if (rawDocs && rawDocs.length > KMS_MAX_DOCS) {
            res.status(400).json({ ok: false, message: `문서는 최대 ${KMS_MAX_DOCS}건까지 저장합니다.` });
            return;
        }

        let items = null;
        let dropped = 0;
        if (rawItems) {
            const seen = new Set();
            items = [];
            for (const r of rawItems) {
                const n = normalizeKmsItem(r);
                if (!n || seen.has(n.task)) continue;   // 업무명 중복은 뒤쪽을 버린다
                seen.add(n.task);
                items.push(n);
            }
            dropped += rawItems.length - items.length;
        }

        let docs = null;
        if (rawDocs) {
            const seenT = new Set();
            docs = [];
            let total = 0;
            for (const r of rawDocs) {
                const n = normalizeKmsDoc(r);
                if (!n || seenT.has(n.title)) continue;   // 제목 중복은 뒤쪽을 버린다
                total += n.body.length;
                if (total > KMS_DOCS_TOTAL_MAX) break;    // 본문 총량 상한에서 중단
                seenT.add(n.title);
                docs.push(n);
            }
            dropped += rawDocs.length - docs.length;
        }

        const marks = rawMarks ? normalizeMarkedItems(rawMarks) : null;

        try {
            // 기존 blob 을 읽어 미전송 채널과 색인 메타(indexed_at/index_status)를 보존한다.
            const { rows: prevRows } = await pool.query(
                `SELECT config -> 'kms' AS kms FROM qa_batch_configs WHERE tenant_id = $1`,
                [orgId]
            );
            const prev = readKmsBlob(prevRows[0]?.kms);
            const next = {
                items: items ?? prev.items,
                marked_items: marks ?? prev.marked_items,
                docs: docs ?? prev.docs,
                indexed_at: prev.indexed_at,
                index_status: prev.index_status,
                updated_at: new Date().toISOString(),
            };
            const payload = JSON.stringify(next);
            // `||` 는 jsonb 최상위 키 병합 — kms 만 교체하고 golden/skill/on 등 형제 키는 보존된다.
            await pool.query(
                `INSERT INTO qa_batch_configs (tenant_id, config, updated_at, updated_by)
                  VALUES ($1, jsonb_build_object('kms', $2::jsonb), now(), $3)
             ON CONFLICT (tenant_id) DO UPDATE
                SET config = COALESCE(qa_batch_configs.config, '{}'::jsonb) || jsonb_build_object('kms', $2::jsonb),
                    updated_at = now(),
                    updated_by = EXCLUDED.updated_by`,
                [orgId, payload, req.session?.user_id ?? null]
            );
            await insertQaAuditLog(pool, {
                req,
                action: 'QA_KMS_ITEMS_SAVE',
                resource_type: 'kms_items',
                resource_id: String(orgId).slice(0, 256),
                http_method: 'PUT',
                http_path: '/api/admin/kms-items',
                detail_json: JSON.stringify({
                    items: next.items.length,
                    marked_items: next.marked_items,
                    docs: next.docs.length,
                    doc_chars: next.docs.reduce((a, d) => a + d.body.length, 0),
                    dropped,
                    channels: [rawItems ? 'items' : null, rawMarks ? 'marked_items' : null, rawDocs ? 'docs' : null].filter(Boolean),
                }).slice(0, 8000),
                success: true,
            });
            res.json({ ok: true, org_id: orgId, ...next, dropped });
        } catch (e) {
            console.error('PUT /api/admin/kms-items error:', e?.message || e);
            res.status(500).json({ ok: false, message: 'KMS 설정 저장 실패' });
        }
    });

    // POST /api/admin/kms-index — 등록 문서를 파이프라인에 넘겨 RAG 색인(임베딩) 요청.
    //
    // ★ 파이프라인 측 엔드포인트는 아직 없다. 색인기 자체는 존재하지만 CLI 전용이다 —
    //   `v2/scripts/bootstrap_aoss_qa.py::_index_business_knowledge(store, tenant_id, dry_run)` 가
    //   `tenants/{tid}/**/business_knowledge/manual.md` 를 chunk 로 쪼개 Titan Embed V2 로
    //   임베딩한 뒤 AOSS 에 bulk 색인한다(진행률 `_emit_progress` 방출).
    //   따라서 남은 일은 ① 문서 → manual.md 기록(chunk meta 주석 규약) ② 위 함수를 호출하는
    //   HTTP 트리거 신설. 그때까지 이 라우트는 파이프라인 404 를 그대로 표면화한다(조용한 성공 금지).
    router.post('/api/admin/kms-index', requireAdmin, async (req, res) => {
        const orgId = resolveActiveOrgId(req, { strict: true });
        if (!orgId) {
            res.status(400).json({ ok: false, message: '브랜드를 선택한 뒤 색인하세요.' });
            return;
        }
        try {
            const { rows } = await pool.query(
                `SELECT config -> 'kms' AS kms FROM qa_batch_configs WHERE tenant_id = $1`,
                [orgId]
            );
            const blob = readKmsBlob(rows[0]?.kms);
            const docs = blob.docs.filter((d) => d.active !== false);
            if (!docs.length) {
                res.status(400).json({ ok: false, message: '색인할 활성 문서가 없습니다.' });
                return;
            }
            const base = resolvePipelineBaseUrl(null, {}).replace(/\/+$/, '');
            const resp = await fetch(`${base}/v2/kms/index`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ tenant_id: orgId, docs, marked_items: blob.marked_items }),
                signal: AbortSignal.timeout(600_000),
            });
            const text = await resp.text().catch(() => '');
            let body = null;
            try {
                body = text ? JSON.parse(text) : null;
            } catch {
                /* 비-JSON 응답은 원문 유지 */
            }
            if (!resp.ok) {
                const hint =
                    resp.status === 404
                        ? '파이프라인에 색인 엔드포인트(/v2/kms/index)가 아직 없습니다. 색인기는 CLI 전용 상태입니다.'
                        : body?.message || text.slice(0, 300) || `HTTP ${resp.status}`;
                res.status(502).json({ ok: false, status: resp.status, message: hint });
                return;
            }
            // 색인 성공 시각을 blob 에 기록 — 화면에서 '마지막 색인' 표시용.
            const stamp = new Date().toISOString();
            await pool.query(
                `UPDATE qa_batch_configs
                SET config = COALESCE(config, '{}'::jsonb)
                             || jsonb_build_object('kms', COALESCE(config -> 'kms', '{}'::jsonb)
                             || jsonb_build_object('indexed_at', $2::text, 'index_status', $3::jsonb)),
                    updated_at = now()
              WHERE tenant_id = $1`,
                [orgId, stamp, JSON.stringify({ docs: docs.length, result: body ?? null })]
            );
            await insertQaAuditLog(pool, {
                req,
                action: 'QA_KMS_INDEX',
                resource_type: 'kms_index',
                resource_id: String(orgId).slice(0, 256),
                http_method: 'POST',
                http_path: '/api/admin/kms-index',
                detail_json: JSON.stringify({ docs: docs.length, result: body ?? null }).slice(0, 8000),
                success: true,
            });
            res.json({ ok: true, org_id: orgId, docs: docs.length, indexed_at: stamp, result: body ?? null });
        } catch (e) {
            console.error('POST /api/admin/kms-index error:', e?.message || e);
            res.status(500).json({ ok: false, message: `색인 요청 실패 — ${String(e?.message || e)}` });
        }
    });

    return router;
}
