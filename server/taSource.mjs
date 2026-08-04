/**
 * 03-Meta_Summary(TA, TextAnalytics) 결과 DB — 읽기 전용.
 *
 * 05(QA)의 상담사 '내 평가결과'에 03의 TA 지표(부정발화·금칙어)를 붙이기 위한 소스.
 * 조인 키 = (proj_cd, uid). 05 qa_calls.UID ↔ 03 tb_ta_rslt.uid 가 동일 ICS 콜 녹취키로 일치.
 * (05 가 콜→상담사 귀속을 이미 알고 있으므로, 본인 콜 uid 목록으로 03 지표를 끌어와 집계한다.)
 *
 * 지표 정의(03 코드와 동일, 상담=호출 단위):
 *   - 부정발화: sentiment_cls = '부정' 인 콜 수
 *   - 금칙어  : banned_hits(JSON) 길이 > 0 인 콜 수 (상담사 발화 기준)
 *   - 회복률  : 03 에선 상담유형 재인입률(개인 지표 아님) → 여기서 다루지 않음(프론트 mock 유지).
 *
 * env-gated: TA_DB_URL(또는 TA_DB_HOST) 미설정 시 taEnabled()=false → 호출부가 폴백.
 * ICS/IPCC 소스와 동일하게 앱 본체와 독립된 작은 읽기 전용 풀.
 */

import pg from 'pg';
import { logger } from './logger.mjs';

function env(key, def = '') {
    return String(process.env[key] ?? def).trim();
}

/** TA 결과 DB 접속정보가 채워져야 활성. 미설정 시 전체 no-op. */
export function taEnabled() {
    return Boolean(env('TA_DB_URL') || env('TA_DB_HOST'));
}

let _pool = null;

/** TA 결과 DB(Postgres) 읽기 전용 풀(lazy). 미설정 시 호출부는 taEnabled() 로 가드. */
function getPool() {
    if (!taEnabled()) throw new Error('TA DB 연결정보 미설정 (TA_DB_URL 또는 TA_DB_* 환경변수)');
    if (_pool === null) {
        const url = env('TA_DB_URL');
        _pool = url
            ? new pg.Pool({ connectionString: url, max: 4, connectionTimeoutMillis: 5000, statement_timeout: 10000 })
            : new pg.Pool({
                  host: env('TA_DB_HOST'),
                  port: Number(env('TA_DB_PORT', '5432')) || 5432,
                  database: env('TA_DB_NAME', 'TA_dev'),
                  user: env('TA_DB_USER'),
                  password: process.env.TA_DB_PW ?? process.env.TA_DB_PASSWORD ?? '',
                  max: 4,
                  connectionTimeoutMillis: 5000,
                  statement_timeout: 10000,
              });
        const where = url ? '(TA_DB_URL)' : `${env('TA_DB_USER')}@${env('TA_DB_HOST')}:${env('TA_DB_PORT', '5432')}/${env('TA_DB_NAME', 'TA_dev')}`;
        logger.info(`[ta-source] TA 결과 DB 읽기풀 생성 — ${where}`);
    }
    return _pool;
}

/**
 * 기간 조건 SQL 조각 — range={from,to}(YYYY-MM-DD, 둘 다 선택). cdate 기준, to 는 당일 포함.
 * params 배열에 값을 push 하고 " AND ..." 문자열을 돌려준다(빈 range 면 '').
 */
function rangeSql(params, range) {
    let sql = '';
    if (range?.from) {
        params.push(range.from);
        sql += ` AND cdate >= $${params.length}::date`;
    }
    if (range?.to) {
        params.push(range.to);
        sql += ` AND cdate < ($${params.length}::date + 1)`;
    }
    return sql;
}

/**
 * (proj_cd, uids[]) → TA 지표 집계. tb_ta_rslt(realtime) 기준, 콜(=행) 단위.
 * 반환: { total, negative, banned }  (모두 정수, 03 에 매칭된 콜만 분모)
 * uids 가 비면 0 집계. range={from,to} 지정 시 cdate 기간 필터(A-71). 미설정/오류 시 throw.
 */
export async function fetchTaMetricsByUids(projCd, uids, range = null) {
    if (!Array.isArray(uids) || uids.length === 0) {
        return { total: 0, negative: 0, banned: 0 };
    }
    const params = [projCd, uids];
    const cond = rangeSql(params, range);
    const { rows } = await getPool().query(
        `SELECT
            count(*)::int AS total,
            count(*) FILTER (WHERE sentiment_cls = '부정')::int AS negative,
            count(*) FILTER (
                WHERE banned_hits IS NOT NULL
                  AND jsonb_array_length(to_jsonb(banned_hits)) > 0
            )::int AS banned
         FROM public.tb_ta_rslt
         WHERE upper(proj_cd) = upper($1) AND uid = ANY($2::text[])${cond}`,
        params
    );
    const r = rows[0] || {};
    return { total: r.total || 0, negative: r.negative || 0, banned: r.banned || 0 };
}

/**
 * (proj_cd, uids[]) → 콜별 구간 감정열. 회복률(부정→긍정) 분석 입력.
 * 03 tb_ta_rslt.segments(JSON).segments[] 의 구간별 sentiment 를 idx 순으로 추출.
 * sentiment_cls(대표감정, 수기검토 변경 반영본)도 동봉 — 회복률 분모 판정(A-72)에 사용.
 * 반환: [{ uid, cdate, channel, sentiment_cls, sentiments: ['중립','부정',...] }]  (segments 없는 콜 제외)
 * range={from,to} 지정 시 cdate 기간 필터(A-71).
 */
export async function fetchSegmentSentimentsByUids(projCd, uids, range = null) {
    if (!Array.isArray(uids) || uids.length === 0) return [];
    const params = [projCd, uids];
    const cond = rangeSql(params, range);
    const { rows } = await getPool().query(
        `SELECT uid, cdate, channel_type, sentiment_cls, segments FROM public.tb_ta_rslt
          WHERE upper(proj_cd) = upper($1) AND uid = ANY($2::text[]) AND segments IS NOT NULL${cond}`,
        params
    );
    const out = [];
    for (const r of rows) {
        let seg = r.segments;
        if (typeof seg === 'string') {
            try { seg = JSON.parse(seg); } catch { seg = null; }
        }
        const arr = seg && Array.isArray(seg.segments) ? seg.segments : [];
        const ordered = arr
            .filter((s) => s && s.sentiment)
            .sort((a, b) => (Number(a.idx) || 0) - (Number(b.idx) || 0));
        // cdate/channel 은 드릴다운 콜목록용(집계 호출부는 uid/sentiments 만 사용 — 하위호환).
        out.push({
            uid: r.uid,
            cdate: r.cdate,
            channel: r.channel_type,
            sentiment_cls: r.sentiment_cls == null ? null : String(r.sentiment_cls),
            sentiments: ordered.map((s) => String(s.sentiment)),
        });
    }
    return out;
}

/**
 * (proj_cd, uids[]) → 부정 감정으로 분류된 콜 목록(드릴다운용). sentiment_cls='부정'.
 * 반환: [{ uid, cdate, channel, sentiment }]  (최신순)
 */
export async function fetchNegativeCallsByUids(projCd, uids, range = null) {
    if (!Array.isArray(uids) || uids.length === 0) return [];
    const params = [projCd, uids];
    const cond = rangeSql(params, range);
    const { rows } = await getPool().query(
        `SELECT uid, cdate, channel_type, sentiment_cls
           FROM public.tb_ta_rslt
          WHERE upper(proj_cd) = upper($1) AND uid = ANY($2::text[]) AND sentiment_cls = '부정'${cond}
          ORDER BY cdate DESC NULLS LAST`,
        params
    );
    return rows.map((r) => ({ uid: r.uid, cdate: r.cdate, channel: r.channel_type, sentiment: r.sentiment_cls }));
}

/**
 * (proj_cd, uids[]) → 금칙어 언급 콜 목록(드릴다운용). banned_hits(배열) 비어있지 않은 콜.
 * banned_hits 요소 = { seq, word, snippet, utterance }. word 중복 제거 후 최대 8개.
 * 반환: [{ uid, cdate, channel, hits:[{ word, utterance }] }]  (최신순)
 */
export async function fetchForbiddenCallsByUids(projCd, uids, range = null) {
    if (!Array.isArray(uids) || uids.length === 0) return [];
    const params = [projCd, uids];
    const cond = rangeSql(params, range);
    const { rows } = await getPool().query(
        `SELECT uid, cdate, channel_type, banned_hits
           FROM public.tb_ta_rslt
          WHERE upper(proj_cd) = upper($1) AND uid = ANY($2::text[])
            AND banned_hits IS NOT NULL
            AND jsonb_typeof(to_jsonb(banned_hits)) = 'array'
            AND jsonb_array_length(to_jsonb(banned_hits)) > 0${cond}
          ORDER BY cdate DESC NULLS LAST`,
        params
    );
    return rows.map((r) => {
        let hits = r.banned_hits;
        if (typeof hits === 'string') { try { hits = JSON.parse(hits); } catch { hits = []; } }
        if (!Array.isArray(hits)) hits = [];
        const seen = new Set();
        const out = [];
        for (const h of hits) {
            const word = String(h?.word || '').trim();
            if (!word || seen.has(word)) continue;
            seen.add(word);
            out.push({ word, utterance: String(h?.utterance || h?.snippet || '').trim() });
            if (out.length >= 8) break;
        }
        return { uid: r.uid, cdate: r.cdate, channel: r.channel_type, hits: out };
    });
}
