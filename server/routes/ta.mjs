// 내 TA 지표 라우트 — server/index.js 에서 분리 (2026-09-03).
//
// 라우트 2개 · 함께 옮긴 헬퍼/상태 1개. 본문은 index.js 원문 그대로(경로·메서드·순서·핸들러 무변경),
// callee 만 app→router. 이 파일 라우트에서만 쓰이던 선언만 여기로 왔고, 다른 곳도 쓰는 공통 헬퍼
// (pool·requireAdmin·resolveActiveOrgId 등)는 index.js 가 ctx 로 넘긴다 — 등록: app.use(createTaRoutes({ ... })).
// 전역 인증 미들웨어(app.use, index.js)는 마운트 앞에 있으므로 종전과 같이 적용된다.

import express from 'express';
import { fetchForbiddenCallsByUids, fetchNegativeCallsByUids, fetchSegmentSentimentsByUids, fetchTaMetricsByUids, taEnabled } from '../taSource.mjs';

export function createTaRoutes(ctx) {
    const { pool } = ctx;
    const router = express.Router();

    // A-71: 내 평가 결과 기간 선택 → TA 지표/드릴다운 기간 필터. from/to = YYYY-MM-DD(둘 다 선택,
    // to 당일 포함). 형식이 어긋나면 무시(전체 기간 = 기존 동작)라 구버전 프론트와도 호환.
    function taRangeFromQuery(req) {
        const pick = (v) => (/^\d{4}-\d{2}-\d{2}$/.test(String(v || '').trim()) ? String(v).trim() : null);
        const from = pick(req.query.from);
        const to = pick(req.query.to);
        return from || to ? { from, to } : null;
    }

    router.get('/api/me/ta-metrics', async (req, res) => {
        if (!req.session?.user_id) {
            res.status(401).json({ message: 'unauthenticated' });
            return;
        }
        if (!taEnabled()) {
            res.json({ enabled: false, total: 0, negative_count: 0, negative_rate: null, banned_count: 0, banned_rate: null,
                       recovery_denom: 0, recovery_count: 0, recovery_rate: null });
            return;
        }
        try {
            const me = req.session.user_id;
            const range = taRangeFromQuery(req); // A-71: 기간(from/to) — 미지정 시 전체(기존 동작)
            // 통합DB: 콜 헤더=common.calls. proj_cd=tenant_id, "UID"=uid. 본인 응대 콜을 테넌트별로 묶어 TA 지표 조회.
            const { rows: grp } = await pool.query(
                `SELECT c.tenant_id AS proj_cd, array_agg(c.uid) AS uids
               FROM common.calls c
              WHERE c.agent_user_id = $1 AND c.uid IS NOT NULL
              GROUP BY c.tenant_id`,
                [me]
            );
            let total = 0, negative = 0, banned = 0;
            let rDenom = 0, rRec = 0;
            for (const g of grp) {
                const m = await fetchTaMetricsByUids(g.proj_cd, g.uids || [], range);
                total += m.total; negative += m.negative; banned += m.banned;

                const segRows = await fetchSegmentSentimentsByUids(g.proj_cd, g.uids || [], range);
                for (const sr of segRows) {
                    const sents = sr.sentiments || [];
                    const segCount = sents.length;
                    const negCount = sents.filter((s) => s === '부정').length;
                    const firstNeg = sents.findIndex((s) => s === '부정');
                    const finalS = segCount ? sents[segCount - 1] : null;
                    const hadNegSeg = negCount > 0;
                    const recovered = hadNegSeg && (finalS === '긍정' || finalS === '중립');
                    // A-72: '부정 발생' 분모 = 구간에 부정 존재 AND (대표감정이 부정 OR 회복 서사).
                    //   수기검토로 대표감정이 부정→비부정으로 정정됐고 회복 서사도 아닌 콜은 분모 제외
                    //   — 부정 발화 비율(sentiment_cls 기준)과 판정 일치. 회복된 콜은 대표감정이
                    //   자연히 비부정이어도 분모 유지(회복률 의미 보존).
                    const hadNeg = hadNegSeg && (sr.sentiment_cls === '부정' || recovered);
                    if (hadNeg) {
                        rDenom += 1;
                        if (recovered) rRec += 1;
                    }
                    // 통합DB: eval_emotion_recovery 는 call_id 키(구 (proj_cd,uid)·agent_user_id 컬럼 없음).
                    //   (tenant_id, uid) → call_id 해석 후 콜단위 캐시 upsert. 매칭 콜 없으면 캐시 생략(회복률은 인메모리 카운트 사용).
                    const { rows: erc } = await pool.query(
                        'SELECT call_id FROM common.calls WHERE tenant_id = $1 AND uid = $2 LIMIT 1',
                        [g.proj_cd, sr.uid]
                    );
                    if (erc[0]) {
                        await pool.query(
                            `INSERT INTO eval_emotion_recovery
                            (call_id, segment_count, neg_seg_count, first_neg_idx,
                             final_sentiment, had_negative, recovered, source, analyzed_at)
                         VALUES ($1,$2,$3,$4,$5,$6,$7,'ta_segments', now())
                         ON CONFLICT (call_id) DO UPDATE SET
                            segment_count = EXCLUDED.segment_count,
                            neg_seg_count = EXCLUDED.neg_seg_count,
                            first_neg_idx = EXCLUDED.first_neg_idx,
                            final_sentiment = EXCLUDED.final_sentiment,
                            had_negative = EXCLUDED.had_negative,
                            recovered = EXCLUDED.recovered,
                            analyzed_at = now()`,
                            [erc[0].call_id, segCount, negCount, firstNeg >= 0 ? firstNeg + 1 : null, finalS, hadNeg, recovered]
                        );
                    }
                }
            }
            // 회복률 집계는 위 루프의 인메모리 카운트 사용 — 기간 필터(A-71)·대표감정 규칙(A-72)이
            // 항상 현재 조회분과 일치. qa_call_emotion_recovery 는 콜단위 분석 캐시로 계속 적재(타 소비처 대비).

            const pct = (n) => (total > 0 ? Math.round((n / total) * 1000) / 10 : null);
            res.json({
                enabled: true,
                total,
                negative_count: negative,
                negative_rate: pct(negative),
                banned_count: banned,
                banned_rate: pct(banned),
                recovery_denom: rDenom,
                recovery_count: rRec,
                recovery_rate: rDenom > 0 ? Math.round((rRec / rDenom) * 1000) / 10 : null,
            });
        } catch (e) {
            console.error('GET /api/me/ta-metrics error:', e?.message || e);
            res.status(502).json({ enabled: true, error: 'TA 지표 조회 실패' });
        }
    });

    // GET /api/me/ta-metrics/calls?kind=negative|recovery|forbidden
    //   감정·대화 품질 카드 드릴다운 — 각 지표에 집계된 '내 콜' 목록을 반환(팝업용).
    //   negative/forbidden = 03 tb_ta_rslt(본인 콜 uid 기준), recovery = 05 qa_call_emotion_recovery + 03 구간감정 궤적.
    router.get('/api/me/ta-metrics/calls', async (req, res) => {
        if (!req.session?.user_id) {
            res.status(401).json({ message: 'unauthenticated' });
            return;
        }
        const kind = String(req.query.kind || '').trim();
        if (!['negative', 'recovery', 'forbidden'].includes(kind)) {
            res.status(400).json({ message: 'invalid kind (negative|recovery|forbidden)' });
            return;
        }
        if (!taEnabled()) {
            res.json({ enabled: false, kind, calls: [] });
            return;
        }
        try {
            const me = req.session.user_id;
            const range = taRangeFromQuery(req); // A-71: 기간 필터 — 지표 카드와 동일 범위
            // 통합DB: 콜 헤더=common.calls. proj_cd=tenant_id, "UID"=uid. 본인 응대 콜을 테넌트별로 묶어 TA 지표 조회.
            const { rows: grp } = await pool.query(
                `SELECT c.tenant_id AS proj_cd, array_agg(c.uid) AS uids
               FROM common.calls c
              WHERE c.agent_user_id = $1 AND c.uid IS NOT NULL
              GROUP BY c.tenant_id`,
                [me]
            );
            // (proj_cd, UID) → qa_id("ID"). 03 tb_ta_rslt.uid=bare 지만, 콜 상세는 qa_id(ICS 전체형식)로
            //   조회하므로 행 클릭용 qa_id 를 매핑해 동봉한다. (UID='100-...' vs ID='ics:METAM:100-...')
            const { rows: idRows } = await pool.query(
                `SELECT c.tenant_id AS proj_cd, c.uid AS uid, c.source_id AS qa_id
               FROM common.calls c
              WHERE c.agent_user_id = $1 AND c.uid IS NOT NULL`,
                [me]
            );
            const qaIdOf = new Map(idRows.map((r) => [`${r.proj_cd}::${r.uid}`, r.qa_id]));
            const withQaId = (proj_cd, r) => ({ proj_cd, qa_id: qaIdOf.get(`${proj_cd}::${r.uid}`) || r.uid, ...r });
            let calls = [];
            if (kind === 'negative') {
                for (const g of grp) {
                    const rows = await fetchNegativeCallsByUids(g.proj_cd, g.uids || [], range);
                    calls.push(...rows.map((r) => withQaId(g.proj_cd, r)));
                }
                calls.sort((a, b) => new Date(b.cdate || 0) - new Date(a.cdate || 0));
            } else if (kind === 'forbidden') {
                for (const g of grp) {
                    const rows = await fetchForbiddenCallsByUids(g.proj_cd, g.uids || [], range);
                    calls.push(...rows.map((r) => withQaId(g.proj_cd, r)));
                }
                calls.sort((a, b) => new Date(b.cdate || 0) - new Date(a.cdate || 0));
            } else {
                // recovery — 03 구간감정에서 직접 계산(지표 카드와 동일 규칙·동일 기간 — 캐시 미경유).
                //   분모(A-72): 구간 부정 존재 AND (대표감정 부정 OR 회복 서사) — /api/me/ta-metrics 와 일치.
                for (const g of grp) {
                    const segRows = await fetchSegmentSentimentsByUids(g.proj_cd, g.uids || [], range);
                    for (const s of segRows) {
                        const sents = s.sentiments || [];
                        const segCount = sents.length;
                        const negCount = sents.filter((x) => x === '부정').length;
                        const firstNeg = sents.findIndex((x) => x === '부정');
                        const finalS = segCount ? sents[segCount - 1] : null;
                        const hadNegSeg = negCount > 0;
                        const recovered = hadNegSeg && (finalS === '긍정' || finalS === '중립');
                        const hadNeg = hadNegSeg && (s.sentiment_cls === '부정' || recovered);
                        if (!hadNeg) continue;
                        calls.push({
                            proj_cd: g.proj_cd,
                            uid: s.uid,
                            qa_id: qaIdOf.get(`${g.proj_cd}::${s.uid}`) || s.uid,
                            recovered,
                            first_neg_idx: firstNeg >= 0 ? firstNeg + 1 : null,
                            final_sentiment: finalS,
                            neg_seg_count: negCount,
                            segment_count: segCount,
                            trajectory: sents,
                            cdate: s.cdate || null,
                            channel: s.channel || null,
                        });
                    }
                }
                // 미회복(코칭 후보) 먼저, 그 안에서 최신순.
                calls.sort((a, b) =>
                    a.recovered === b.recovered ? new Date(b.cdate || 0) - new Date(a.cdate || 0) : a.recovered ? 1 : -1
                );
            }
            res.json({ enabled: true, kind, calls });
        } catch (e) {
            console.error('GET /api/me/ta-metrics/calls error:', e?.message || e);
            res.status(502).json({ enabled: true, error: 'TA 콜 목록 조회 실패' });
        }
    });

    return router;
}
