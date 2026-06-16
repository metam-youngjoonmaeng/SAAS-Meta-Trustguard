/**
 * AI Canvas pull 어댑터.
 *
 * 외부 AI Canvas 의 "데이터셋 API 배포" 엔드포인트를 GET 으로 호출 → `data[].payload`
 * (JSON 문자열)을 파싱 → 각 콜을 `ingestCollectionCallToDb` 로 적재.
 *
 * AI Canvas 응답 스키마 (사용자 확보 샘플 기준):
 *   {
 *     "datasetInfo": {...},
 *     "pagination": { "currentPage": 1, "hasNext": false, ... },
 *     "data": [{ "payload": "{\"call\":{\"id\":\"...\",\"cdate\":\"...\",\"role\":\"PDS1\"}}" }, ...]
 *   }
 *
 * 인증: `Authorization: Bearer <API_KEY>` (옵션 — 401 응답 시 안내).
 */

import { ingestCollectionCallToDb } from './collectionCallIngest.mjs';

const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_PAGES = 50;

function parsePayload(raw) {
    if (raw === null || raw === undefined) return null;
    if (typeof raw === 'object') return raw;
    try {
        return JSON.parse(String(raw));
    } catch {
        return null;
    }
}

export async function fetchAndIngestFromAiCanvas(pool, { url, apiKey } = {}) {
    if (!url) {
        return { ok: false, message: 'url 이 필요합니다 (body 의 url 또는 AI_CANVAS_DATASET_URL 환경변수).' };
    }

    let totalFetched = 0;
    let totalIngested = 0;
    const failed = [];
    const details = [];
    let nextUrl = url;
    let pages = 0;

    while (nextUrl && pages < MAX_PAGES) {
        pages += 1;
        const headers = { Accept: 'application/json' };
        if (apiKey) headers.Authorization = `Bearer ${apiKey}`;

        let res;
        try {
            res = await fetch(nextUrl, { headers, signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS) });
        } catch (e) {
            return { ok: false, message: `AI Canvas 호출 실패 (네트워크): ${String(e?.message || e)}` };
        }
        if (!res.ok) {
            const body = await res.text().catch(() => '');
            const hint = res.status === 401 || res.status === 403
                ? ' — Authorization Bearer 토큰(api_key) 누락 또는 무효'
                : '';
            return {
                ok: false,
                message: `AI Canvas 호출 실패: HTTP ${res.status}${hint} — ${body.slice(0, 300)}`,
            };
        }

        let json;
        try {
            json = await res.json();
        } catch (e) {
            return { ok: false, message: `AI Canvas 응답 JSON 파싱 실패: ${String(e?.message || e)}` };
        }

        const rows = Array.isArray(json?.data) ? json.data : [];
        totalFetched += rows.length;

        for (const row of rows) {
            const payload = parsePayload(row?.payload);
            if (!payload || typeof payload !== 'object') {
                failed.push({ reason: 'payload 파싱 실패 (JSON 문자열 아님)', raw: row });
                continue;
            }
            const qaIdHint = payload?.call?.id;
            try {
                const result = await ingestCollectionCallToDb(pool, payload);
                if (!result.ok) {
                    failed.push({ qa_id: qaIdHint, reason: result.message });
                } else {
                    totalIngested += 1;
                    details.push({
                        qa_id: result.qa_id,
                        role: result.role,
                        ai_score: result.ai_score,
                    });
                }
            } catch (e) {
                failed.push({ qa_id: qaIdHint, reason: String(e?.message || e) });
            }
        }

        const pg = json?.pagination;
        const hasNext = Boolean(pg?.hasNext);
        const curr = Number(pg?.currentPage);
        if (!hasNext || !Number.isFinite(curr)) break;
        const u = new URL(nextUrl);
        u.searchParams.set('page', String(curr + 1));
        nextUrl = u.toString();
    }

    return {
        ok: true,
        source: url,
        pages,
        fetched: totalFetched,
        ingested: totalIngested,
        failed_count: failed.length,
        failed,
        details,
    };
}
