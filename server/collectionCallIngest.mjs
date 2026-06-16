/**
 * 외부 API 연동용 ingest 모듈 — 컬렉션관리부 1콜 (9 항목 + Pentagon 5축).
 *
 * 입력 JSON 한 묶음을 받아 다음 테이블에 트랜잭션으로 적재:
 *   qa_calls / qa_conversations / qa_checklist_rows / qa_evaluation_rows / qa_analysis_report
 *
 * SSOT: docs/EVALUATION_ITEMS.md (Pentagon 5축 설계), docs/DB_SCHEMA.md (테이블 컬럼).
 */

const COLLECTION_DEPARTMENT = '컬렉션관리부';

// 직무별 만점 매트릭스 (docs/EVALUATION_ITEMS.md 직무별 기본점수 / docs/DB_SCHEMA.md 4-1 SSOT)
const ROLE_MAX_MATRIX = {
    PDS1:     [3, 4, 3, 5, 5, 16, 20, 20, 10],
    PDS2:     [3, 4, 3, 4, 3, 20, 20, 20, 10],
    PDS3:     [3, 4, 3, 4, 10, 10, 20, 20, 10],
    '수동대인': [3, 4, 3, 4, 10, 10, 20, 20, 10],
    '인바운드': [5, 5, 5, 5, 10, 20, 15, 15, 10],
    '전체':     [3, 4, 3, 5, 5, 16, 20, 20, 10],
};

const ITEM_TEMPLATE = [
    { order_no: 1, category: '친절도',         item: '첫인사' },
    { order_no: 2, category: '친절도',         item: '본인 확인' },
    { order_no: 3, category: '친절도',         item: '종료 인사' },
    { order_no: 4, category: '친절도',         item: '음성' },
    { order_no: 5, category: '친절도',         item: '언어 표현' },
    { order_no: 6, category: '맞춤 응대 스킬', item: '기반 형성' },
    { order_no: 7, category: '맞춤 응대 스킬', item: '회수 스킬' },
    { order_no: 8, category: '업무 정확도',     item: '업무 정확도' },
    { order_no: 9, category: '사후 처리',       item: '이력 등록' },
];

const RADAR_AXES = [
    { item_type_no: 1, item_type: '인사·본인확인',  orderNos: [1, 2, 3] },
    { item_type_no: 2, item_type: '응대 화법·음성',  orderNos: [4, 5] },
    { item_type_no: 3, item_type: '경청·공감 응대',  orderNos: [6, 7] },
    { item_type_no: 4, item_type: '업무 정확도',     orderNos: [8] },
    { item_type_no: 5, item_type: '사후 처리',       orderNos: [9] },
];

function round1(value) {
    return Math.round((Number(value) || 0) * 10) / 10;
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

export function transformCollectionPayload(body) {
    const callIn = body?.call;
    if (!callIn || typeof callIn !== 'object') {
        return { ok: false, message: 'call 객체가 필요합니다.' };
    }
    const id = String(callIn.id ?? callIn.ID ?? '').trim();
    if (!id) return { ok: false, message: 'call.id 가 필요합니다.' };

    const cdate = String(callIn.cdate ?? callIn.CDATE ?? callIn.call_datetime ?? '').trim();
    if (!cdate) {
        return { ok: false, message: 'call.cdate 가 필요합니다 (예: "2026-05-14T10:21:35+09:00").' };
    }

    const department = String(callIn.department || COLLECTION_DEPARTMENT).trim();
    if (department !== COLLECTION_DEPARTMENT) {
        return {
            ok: false,
            message: `현재 ingest 엔드포인트는 ${COLLECTION_DEPARTMENT} 전용입니다. department='${department}' 는 지원되지 않습니다.`,
        };
    }

    const role = String(callIn.role || 'PDS1').trim();
    if (!ROLE_MAX_MATRIX[role]) {
        return {
            ok: false,
            message: `call.role 값이 잘못되었습니다. 허용: ${Object.keys(ROLE_MAX_MATRIX).join(', ')}`,
        };
    }

    const callSeq = String(callIn.call_seq ?? callIn.CALL_SEQ ?? id).trim();
    const uid = String(callIn.uid ?? callIn.UID ?? id).trim();
    const maxArr = ROLE_MAX_MATRIX[role];

    // evaluations 는 옵션 — 비어 있으면 자식 테이블 INSERT 생략, AI_SCORE/TOTAL_SCORE 는 0.
    // 부분(예: 9개 중 3개)만 와도 그만큼만 적재되고, 점수는 제공된 항목의 만점 대비 백분율.
    const evalsIn = Array.isArray(body?.evaluations) ? body.evaluations : [];
    const evalByOrder = new Map();
    for (const e of evalsIn) {
        const n = Number(e?.order_no);
        if (!Number.isFinite(n) || n < 1 || n > 9) continue;
        evalByOrder.set(n, e);
    }

    const checklistRows = [];
    const evaluationRows = [];
    let totalMax = 0;
    let totalAi = 0;
    let totalManual = 0;
    let hasManualOverride = false;

    for (const slot of ITEM_TEMPLATE) {
        const e = evalByOrder.get(slot.order_no);
        if (!e) continue;
        const maxPts = maxArr[slot.order_no - 1];
        const aiEval = Number(e.ai_eval);
        if (!Number.isFinite(aiEval) || aiEval < 0 || aiEval > maxPts) {
            return {
                ok: false,
                message: `evaluations[order_no=${slot.order_no}].ai_eval 는 0~${maxPts} 범위 숫자여야 합니다 (받은 값: ${e.ai_eval}).`,
            };
        }
        const manualRaw = e.manual_eval;
        const manualEval =
            manualRaw === undefined || manualRaw === null || manualRaw === ''
                ? aiEval
                : Number(manualRaw);
        if (!Number.isFinite(manualEval) || manualEval < 0 || manualEval > maxPts) {
            return {
                ok: false,
                message: `evaluations[order_no=${slot.order_no}].manual_eval 는 0~${maxPts} 범위 숫자여야 합니다 (받은 값: ${manualRaw}).`,
            };
        }
        if (Math.abs(manualEval - aiEval) > 1e-9) hasManualOverride = true;
        totalMax += maxPts;
        totalAi += aiEval;
        totalManual += manualEval;

        const agentUtterance = String(e.agent_utterance ?? '').trim();
        const reasonText = String(e.reason_text ?? '').trim() || '(사유 미제공)';
        checklistRows.push({
            order_no: slot.order_no,
            category: slot.category,
            item: slot.item,
            agent_utterance: agentUtterance,
            validation_time: `배점 ${maxPts}`,
        });
        evaluationRows.push({
            order_no: slot.order_no,
            category: slot.category,
            item: slot.item,
            reason_text: reasonText,
            ai_eval: aiEval,
            manual_eval: manualEval,
        });
    }

    const aiScore = totalMax > 0 ? round1((100 * totalAi) / totalMax) : 0;
    const totalScore =
        totalMax > 0
            ? round1((100 * (hasManualOverride ? totalManual : totalAi)) / totalMax)
            : 0;

    // 5축 점수 derive — 매핑된 항목이 한 개라도 없으면 해당 축은 skip (report 행 생성 안 함).
    // evaluations 가 비어 있으면 report 도 0 행이 되고, GET /api/analysis 는 점수 fallback 으로 표시.
    const axisScores = {};
    for (const ax of RADAR_AXES) {
        const evs = ax.orderNos.map((n) => evaluationRows.find((r) => r.order_no === n)).filter(Boolean);
        if (evs.length !== ax.orderNos.length) continue;
        let m = 0;
        let earned = 0;
        for (const n of ax.orderNos) {
            m += maxArr[n - 1];
            const ev = evaluationRows.find((r) => r.order_no === n);
            earned += hasManualOverride ? ev.manual_eval : ev.ai_eval;
        }
        axisScores[ax.item_type_no] = m > 0 ? round1((100 * earned) / m) : 0;
    }

    const reportIn = Array.isArray(body?.report) ? body.report : [];
    const reportByNo = new Map();
    for (const r of reportIn) {
        const n = Number(r?.item_type_no);
        if (Number.isFinite(n)) reportByNo.set(n, r);
    }
    const reportRows = [];
    for (const ax of RADAR_AXES) {
        const axisScore = axisScores[ax.item_type_no];
        const ext = reportByNo.get(ax.item_type_no);
        // 외부 report 입력이 없고 derive 도 불가(축 일부 누락)이면 행 생략.
        if (axisScore === undefined && !ext) continue;
        const score = axisScore ?? 0;
        reportRows.push({
            item_type_no: ax.item_type_no,
            item_type: ax.item_type,
            rating: String(ext?.rating || ratingFromScore(score)).trim(),
            comment: String(ext?.comment || commentFromScore(score)).trim(),
            summary: null,
        });
    }
    const ext99 = reportByNo.get(99);
    // 9개 평가가 다 와서 totalScore 가 의미 있을 때만 summary 행 생성 (또는 외부가 명시).
    const hasFullEvaluations = evaluationRows.length === ITEM_TEMPLATE.length;
    if (ext99 || hasFullEvaluations) {
        reportRows.push({
            item_type_no: 99,
            item_type: 'summary',
            rating: null,
            comment: String(ext99?.comment || summaryFromScore(totalScore)).trim(),
            summary: String(ext99?.summary || summaryFromScore(totalScore)).trim(),
        });
    }

    const convIn = Array.isArray(body?.conversation) ? body.conversation : [];
    const conversation = [];
    let nextTurn = 1;
    for (const t of convIn) {
        if (!t || typeof t !== 'object') continue;
        const text = String(t.text ?? '').trim();
        if (!text) continue;
        const speakerRaw = String(t.speaker ?? '').trim();
        const speaker = speakerRaw.includes('고객') ? '고객' : '상담사';
        const turnNo = Number.isFinite(Number(t.turn_no)) ? Number(t.turn_no) : nextTurn;
        conversation.push({ turn_no: turnNo, speaker, text });
        nextTurn = Math.max(nextTurn, turnNo) + 1;
    }

    return {
        ok: true,
        qa_id: id,
        rows: {
            call: {
                ID: id,
                CALL_SEQ: callSeq,
                CDATE: cdate,
                UID: uid,
                AI_SCORE: aiScore,
                TOTAL_SCORE: totalScore,
                department: COLLECTION_DEPARTMENT,
                role,
            },
            conversation,
            checklist: checklistRows,
            evaluations: evaluationRows,
            report: reportRows,
        },
    };
}

export async function ingestCollectionCallToDb(pool, body) {
    const transformed = transformCollectionPayload(body);
    if (!transformed.ok) return transformed;
    const { rows } = transformed;
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        await client.query(`DELETE FROM qa_analysis_report WHERE "ID" = $1`, [rows.call.ID]);
        await client.query(`DELETE FROM qa_evaluation_rows WHERE "ID" = $1`, [rows.call.ID]);
        await client.query(`DELETE FROM qa_checklist_rows WHERE "ID" = $1`, [rows.call.ID]);
        await client.query(`DELETE FROM qa_conversations WHERE "ID" = $1`, [rows.call.ID]);
        // 외부 ingest 는 운영 데이터 — sandbox 정리 대상에서 영구 제외.
        await client.query(
            `INSERT INTO qa_calls
                 ("ID","CALL_SEQ","CDATE","UID","AI_SCORE","TOTAL_SCORE",
                  department, role,
                  ai_analysis_target, ai_analysis_reason, voc_code, promotion_code, is_sandbox)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,NULL,NULL,NULL,NULL,false)
             ON CONFLICT ("ID") DO UPDATE SET
               "CALL_SEQ" = EXCLUDED."CALL_SEQ",
               "CDATE" = EXCLUDED."CDATE",
               "UID" = EXCLUDED."UID",
               "AI_SCORE" = EXCLUDED."AI_SCORE",
               "TOTAL_SCORE" = EXCLUDED."TOTAL_SCORE",
               department = EXCLUDED.department,
               role = EXCLUDED.role,
               ai_analysis_target = NULL,
               ai_analysis_reason = NULL,
               voc_code = NULL,
               promotion_code = NULL,
               is_sandbox = false`,
            [
                rows.call.ID,
                rows.call.CALL_SEQ,
                rows.call.CDATE,
                rows.call.UID,
                rows.call.AI_SCORE,
                rows.call.TOTAL_SCORE,
                rows.call.department,
                rows.call.role,
            ]
        );
        for (const t of rows.conversation) {
            await client.query(
                `INSERT INTO qa_conversations ("ID", turn_no, speaker, "text") VALUES ($1,$2,$3,$4)`,
                [rows.call.ID, t.turn_no, t.speaker, t.text]
            );
        }
        for (const c of rows.checklist) {
            await client.query(
                `INSERT INTO qa_checklist_rows ("ID", order_no, category, item, agent_utterance, validation_time)
                 VALUES ($1,$2,$3,$4,$5,$6)`,
                [rows.call.ID, c.order_no, c.category, c.item, c.agent_utterance, c.validation_time]
            );
        }
        for (const e of rows.evaluations) {
            await client.query(
                `INSERT INTO qa_evaluation_rows ("ID", order_no, category, item, reason_text, ai_eval, manual_eval)
                 VALUES ($1,$2,$3,$4,$5,$6,$7)`,
                [rows.call.ID, e.order_no, e.category, e.item, e.reason_text, e.ai_eval, e.manual_eval]
            );
        }
        for (const r of rows.report) {
            await client.query(
                `INSERT INTO qa_analysis_report ("ID", item_type_no, item_type, rating, comment, summary)
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
        ai_score: rows.call.AI_SCORE,
        total_score: rows.call.TOTAL_SCORE,
        role: rows.call.role,
        department: rows.call.department,
        turns: rows.conversation.length,
    };
}
