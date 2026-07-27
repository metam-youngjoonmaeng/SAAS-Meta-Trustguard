/* SAMPLE_UPLOAD_FEATURE — 임시 기능. 제거 시 이 파일 삭제 + index.js 의 SAMPLE_UPLOAD_FEATURE 마커 라인 제거 */

import { CHECKLIST_TEMPLATE, CHECKLIST_KEYS, RADAR_KEYS, RADAR_REPORT_LABELS } from './sampleIngestConstants.mjs';
import { insertItemScoreRows, insertTranscriptRows } from './itemScoreIngest.mjs';

const SAMPLE_ID_PREFIX = 'sample-';

function buildQaId(consultationId) {
    const base = String(consultationId || '').trim() || 'unknown';
    return `${SAMPLE_ID_PREFIX}${base}`;
}

function nowAsCdate() {
    const d = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function parseTranscriptToTurns(transcript) {
    const text = String(transcript || '').trim();
    if (!text) return [];
    const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    const turns = [];
    let turnNo = 1;
    for (const line of lines) {
        const idx = line.indexOf(':');
        if (idx <= 0) continue;
        const speakerRaw = line.slice(0, idx).trim();
        const utterance = line.slice(idx + 1).trim();
        if (!utterance) continue;
        const speaker = speakerRaw.includes('고객') ? '고객' : '상담사';
        turns.push({ turn_no: turnNo, speaker, text: utterance });
        turnNo += 1;
    }
    return turns;
}

function extractEvalItems(output) {
    const sample = output?.evaluations_sample;
    const fromSample = Array.isArray(sample?.items) ? sample.items : [];
    if (fromSample.length > 0) return fromSample;
    const fromTop = Array.isArray(output?.evaluations) ? output.evaluations : [];
    return fromTop;
}

function pickEvaluation(item) {
    if (!item || typeof item !== 'object') return null;
    if (item.evaluation && typeof item.evaluation === 'object') return item.evaluation;
    return item;
}

function joinQuotes(evidence) {
    if (!Array.isArray(evidence)) return '';
    const parts = [];
    for (const e of evidence) {
        if (!e) continue;
        const sp = e.speaker !== undefined && e.speaker !== null ? String(e.speaker).trim() : '';
        if (sp && sp !== '상담사') continue;
        const q = String(e.quote || '').trim();
        if (q) parts.push(q);
    }
    return parts.join(' // ');
}

function safeNumber(value, fallback = 0) {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
}

/**
 * 에이전트 점수(0..agentMax)를 한화 만점 척도(hanwhaMax)로 선형 스케일.
 * 한화 컬럼은 DOUBLE PRECISION이라 정수 티어 스냅 없이 그대로 저장 가능.
 */
function scaleScoreToHanwha(agentScore, agentMax, hanwhaMax) {
    const a = safeNumber(agentScore, 0);
    const am = safeNumber(agentMax, 0);
    if (am <= 0) return 0;
    const ratio = Math.max(0, Math.min(1, a / am));
    return Math.round(ratio * hanwhaMax * 10) / 10;
}

function buildChecklistAndEvalRows(qaId, items) {
    const checklist = [];
    const evaluations = [];
    const seenOrders = new Set();
    for (const raw of items || []) {
        const ev = pickEvaluation(raw);
        if (!ev) continue;
        const orderNo = Number(ev.item_number);
        if (!Number.isFinite(orderNo) || orderNo < 1 || orderNo > CHECKLIST_TEMPLATE.length) continue;
        if (seenOrders.has(orderNo)) continue;
        seenOrders.add(orderNo);
        const slot = CHECKLIST_TEMPLATE[orderNo - 1];
        const hanwhaMax = Number(slot.validation_time.replace(/[^0-9.]/g, '')) || 10;
        const agentMax = safeNumber(ev.max_score, 5);
        const agentScore = safeNumber(ev.score, 0);
        const aiEval = scaleScoreToHanwha(agentScore, agentMax, hanwhaMax);
        const judgment = String(ev.judgment || ev?.persona_details?.neutral?.judgment || '').trim();
        const utterance = joinQuotes(ev.evidence) || joinQuotes(ev?.persona_details?.neutral?.evidence);
        const agentItemName = String(ev.item || '').trim();
        const reasonPrefix = agentItemName && agentItemName !== slot.item ? `[에이전트 항목: ${agentItemName}] ` : '';
        checklist.push({
            order_no: orderNo,
            category: slot.category,
            item: slot.item,
            agent_utterance: utterance,
            validation_time: slot.validation_time,
        });
        evaluations.push({
            order_no: orderNo,
            category: slot.category,
            item: slot.item,
            reason_text: `${reasonPrefix}${judgment}`.trim() || '(에이전트 사유 없음)',
            ai_eval: aiEval,
            manual_eval: aiEval,
        });
    }
    return { checklist, evaluations };
}

function categoryPctFromRows(category, checklistRows, evalRows) {
    const evalByOrder = new Map(evalRows.map((r) => [Number(r.order_no), Number(r.ai_eval)]));
    let totalMax = 0;
    let totalEarned = 0;
    for (const ch of checklistRows) {
        if (String(ch.category).trim() !== category) continue;
        const maxPts = Number(ch.validation_time.replace(/[^0-9.]/g, '')) || 0;
        const earned = evalByOrder.get(Number(ch.order_no)) ?? 0;
        totalMax += maxPts;
        totalEarned += earned;
    }
    if (totalMax <= 0) return 0;
    return Math.round((100 * totalEarned) / totalMax * 10) / 10;
}

function computeAxisScores(checklistRows, evalRows) {
    // 한화 8-항목 sample → 컬렉션관리부 Pentagon 5축 best-effort 매핑.
    // 임시 sample upload 경로용 (SAMPLE_UPLOAD_FEATURE). 정식 baseline 시드 매핑은 server/index.js 의 RADAR_AXIS_TO_ORDER_NOS 참조.
    const cat = (k) => categoryPctFromRows(k, checklistRows, evalRows);
    const raw = {
        greeting_verify:   (cat('전화수신/종료태도') + cat('첫인사') + cat('끝인사')) / 3,
        tone_language:     cat('사과/대기/감사표현'),
        empathy_listening: cat('문의내용 파악/경청'),
        work_accuracy:     (cat('정확한 업무처리') + cat('정보보호')) / 2,
        aftercare:         cat('상담태도'),
    };
    const out = {};
    for (const k of RADAR_KEYS) out[k] = Math.round(raw[k] * 10) / 10;
    return out;
}

function ratingFromScore(score) {
    if (score >= 90) return '우수';
    if (score >= 80) return '보통';
    if (score >= 70) return '주의';
    return '실패';
}

function commentFromScore(score) {
    if (score >= 90) return '핵심 응대가 안정적으로 수행되어 품질 수준이 우수합니다.';
    if (score >= 80) return '기본 응대는 양호하나 일관성과 전달력을 조금 더 보완할 필요가 있습니다.';
    if (score >= 70) return '핵심 구간에서 누락 또는 불명확한 응대가 보여 개선이 필요합니다.';
    return '기준 대비 품질 편차가 커 우선 개선 대상입니다.';
}

function summaryFromScore(score) {
    if (score >= 90) return '전반적으로 우수한 상담 품질을 보이며, 현재 강점을 유지하는 것이 중요합니다.';
    if (score >= 80) return '기본 절차는 양호하며, 경청·공감 응대와 사후 처리 구간을 보완하면 더 안정적입니다.';
    if (score >= 70) return '인사·본인확인은 수행되었으나 경청·공감 응대와 업무 정확도 보강이 필요합니다.';
    return '인사·본인확인·경청·공감 응대·업무 정확도·사후 처리 전반에 걸쳐 우선 개선이 필요합니다.';
}

function buildAnalysisReportRows(checklistRows, evalRows, aiScore) {
    const axis = computeAxisScores(checklistRows, evalRows);
    const rows = [];
    for (let i = 0; i < RADAR_REPORT_LABELS.length; i += 1) {
        const score = Number(axis[RADAR_KEYS[i]] || 0);
        rows.push({
            item_type_no: i + 1,
            item_type: RADAR_REPORT_LABELS[i],
            rating: ratingFromScore(score),
            comment: `${commentFromScore(score)} (지표 점수: ${Math.round(score * 10) / 10})`,
            summary: i === 0 ? summaryFromScore(aiScore) : null,
        });
    }
    return rows;
}

export function transformSamplePayload(input, output) {
    const inputConsult = String(input?.consultation_id || '').trim();
    const outputConsult = String(output?.consultation_id || '').trim();
    if (!inputConsult || !outputConsult) {
        return { ok: false, message: 'consultation_id가 input/output 중 하나라도 없습니다.' };
    }
    if (inputConsult !== outputConsult) {
        return { ok: false, message: `consultation_id 불일치: input=${inputConsult}, output=${outputConsult}` };
    }
    const items = extractEvalItems(output);
    if (items.length === 0) {
        return { ok: false, message: 'output에서 평가 항목(items)을 찾지 못했습니다.' };
    }
    const qaId = buildQaId(outputConsult);
    const sessionId = String(input?.session_id || output?._meta?.session_id || qaId).trim();
    const turns = parseTranscriptToTurns(input?.transcript);
    const { checklist, evaluations } = buildChecklistAndEvalRows(qaId, items);
    if (evaluations.length === 0) {
        return { ok: false, message: '유효한 item_number(1~8)를 가진 항목이 없습니다.' };
    }
    let totalMax = 0;
    let totalEarned = 0;
    for (const ch of checklist) {
        const maxPts = Number(ch.validation_time.replace(/[^0-9.]/g, '')) || 0;
        const earned = evaluations.find((e) => e.order_no === ch.order_no)?.ai_eval ?? 0;
        totalMax += maxPts;
        totalEarned += earned;
    }
    const aiScore = totalMax > 0 ? Math.round((100 * totalEarned) / totalMax * 10) / 10 : 0;
    const report = buildAnalysisReportRows(checklist, evaluations, aiScore);
    const itemsCovered = evaluations.map((e) => e.order_no).sort((a, b) => a - b);
    const itemsMissing = CHECKLIST_KEYS.map((_, i) => i + 1).filter((n) => !itemsCovered.includes(n));
    return {
        ok: true,
        qa_id: qaId,
        warnings: itemsMissing.length > 0
            ? [`item_number ${itemsMissing.join(',')} 누락 (전체 8개 중 ${itemsCovered.length}개만 매핑됨)`]
            : [],
        rows: {
            call: {
                ID: qaId,
                CALL_SEQ: outputConsult,
                CDATE: nowAsCdate(),
                UID: sessionId || qaId,
                AI_SCORE: aiScore,
                TOTAL_SCORE: aiScore,
            },
            conversation: turns,
            checklist,
            evaluations,
            report,
        },
    };
}

export async function ingestSampleToDb(pool, input, output) {
    const transformed = transformSamplePayload(input, output);
    if (!transformed.ok) return transformed;
    const { rows } = transformed;
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        // 같은 ID가 있으면 자식 row를 먼저 비우고 다시 채움 (단순·안전).
        await client.query(`DELETE FROM qa_call_pentagon_result WHERE "ID" = $1`, [rows.call.ID]);
        await client.query(`DELETE FROM qa_call_item_score WHERE "ID" = $1`, [rows.call.ID]);
        await client.query(`DELETE FROM qa_call_transcript WHERE "ID" = $1`, [rows.call.ID]);
        // 샘플 업로드는 sandbox 데이터로 분류 — sandbox 세션 종료 시 is_sandbox=true 만 정리된다.
        await client.query(
            `INSERT INTO qa_calls ("ID","CALL_SEQ","CDATE","UID","AI_SCORE","TOTAL_SCORE", is_sandbox)
             VALUES ($1,$2,$3,$4,$5,$6,true)
             ON CONFLICT ("ID") DO UPDATE SET
               "CALL_SEQ" = EXCLUDED."CALL_SEQ",
               "CDATE" = EXCLUDED."CDATE",
               "UID" = EXCLUDED."UID",
               "AI_SCORE" = EXCLUDED."AI_SCORE",
               "TOTAL_SCORE" = EXCLUDED."TOTAL_SCORE",
               is_sandbox = true`,
            [rows.call.ID, rows.call.CALL_SEQ, rows.call.CDATE, rows.call.UID, rows.call.AI_SCORE, rows.call.TOTAL_SCORE]
        );
        // 전사 + 항목별 평가 — 각각 다중행 INSERT 1회. 점수와 근거는 병합 테이블 하나에 적재(마이그레이션 67).
        await insertTranscriptRows(client, rows.call.ID, rows.conversation);
        await insertItemScoreRows(client, rows.call.ID, rows.evaluations, rows.checklist);
        for (const r of rows.report) {
            await client.query(
                `INSERT INTO qa_call_pentagon_result ("ID", item_type_no, item_type, rating, comment, summary)
                 VALUES ($1,$2,$3,$4,$5,$6)`,
                [rows.call.ID, r.item_type_no, r.item_type, r.rating, r.comment, r.summary]
            );
        }
        await client.query('COMMIT');
    } catch (e) {
        await client.query('ROLLBACK');
        throw e;
    } finally {
        client.release();
    }
    return {
        ok: true,
        qa_id: transformed.qa_id,
        warnings: transformed.warnings,
        ai_score: transformed.rows.call.AI_SCORE,
    };
}

export async function clearSamplesFromDb(pool) {
    // 이중 안전망: 프리픽스 LIKE 매칭 + is_sandbox=true 둘 다 만족해야 삭제.
    // 운영 행은 is_sandbox=false 라서 절대 매칭 안 됨.
    const { rows } = await pool.query(
        `DELETE FROM qa_calls WHERE "ID" LIKE $1 AND is_sandbox = true RETURNING "ID"`,
        [`${SAMPLE_ID_PREFIX}%`]
    );
    return { ok: true, deleted: rows.length, ids: rows.map((r) => r.ID) };
}
