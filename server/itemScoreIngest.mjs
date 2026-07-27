/**
 * 항목별 평가 결과 적재 — qa_call_item_score 단일 테이블 (마이그레이션 67 병합 결과).
 *
 * 배경: 구 모델은 같은 평가 응답을 두 테이블에 나눠 적재했다.
 *   - qa_evaluation_rows(→qa_call_item_score) : order_no, category, item, reason_text, ai_eval, manual_eval
 *   - qa_checklist_rows (→삭제)               : order_no, category, item, agent_utterance, validation_time
 *   PK 가 ("ID", order_no) 로 동일 grain 이었고 category·item 은 양쪽에 중복 저장됐다
 *   (실측 1070행 전량 일치, 불일치 0건). 적재 코드도 루프를 두 번 돌았다.
 *
 * ★ 분모 규약: checklist 에 없던 항목(Y/N 가·부 항목)은 max_score = NULL 로 남긴다.
 *   구 모델이 "체크리스트 행을 아예 만들지 않아" 총점 분모에서 제외했던 것과 동일한 의미다.
 *   NULL 을 0 이나 5 로 채우면 분모가 늘어 총점이 조용히 틀어진다.
 *
 * 성능: 행마다 개별 INSERT(왕복 N회) → jsonb_to_recordset 다중행 INSERT(왕복 1회).
 */

import { maxPointsOf } from './rubricManual.mjs';

const toNum = (v) => {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
};

/**
 * 평가행 + 체크리스트행을 order_no 기준으로 합쳐 qa_call_item_score 적재행을 만든다.
 * @param {Array} evaluations 평가행 (점수·사유) — 항목 전체
 * @param {Array} checklist   체크리스트행 (근거 발화·만점) — Y/N 항목 제외분
 */
export function buildItemScoreRows(evaluations, checklist) {
    const chByOrder = new Map(
        (checklist || []).map((c) => [Number(c.order_no), c])
    );
    return (evaluations || []).map((e) => {
        const ch = chByOrder.get(Number(e.order_no));
        return {
            order_no: Number(e.order_no),
            category: e.category ?? ch?.category ?? null,
            item: e.item ?? ch?.item ?? null,
            reason_text: e.reason_text ?? null,
            ai_eval: toNum(e.ai_eval),
            manual_eval: toNum(e.manual_eval),
            agent_utterance: ch ? (ch.agent_utterance ?? null) : null,
            max_score: ch ? maxPointsOf(ch) : null,
        };
    });
}

/**
 * 재적재(DELETE → INSERT) 를 가로질러 살아남아야 하는 '사람이 내린 결정' 을 보존한다.
 *
 * skill_excluded_at(스킬 학습 제외 지정)은 원래 별도 테이블 qa_skill_excluded 에 있어서
 * 콜을 재평가해도 그대로 남았다. 마이그레이션 70 이 이를 qa_call_item_score 컬럼으로 흡수하면서
 * 재적재가 지우는 행 안으로 들어갔고, 그대로 두면 재평가 한 번에 관리자의 제외 지정이 조용히 사라진다.
 * 채점 결과(점수·사유)는 재평가로 덮어쓰는 게 맞지만 제외 지정은 아니다 → 지우기 전에 떠서 되돌린다.
 *
 * 사용법: DELETE 직전 captureSticky() → INSERT 직후 restoreSticky().
 * @returns {Promise<Array<{order_no:number, skill_excluded_at:string}>>}
 */
export async function captureSticky(client, callId) {
    const { rows } = await client.query(
        `SELECT order_no, skill_excluded_at FROM qa_call_item_score
          WHERE "ID" = $1 AND skill_excluded_at IS NOT NULL`,
        [callId]
    );
    return rows;
}

/** captureSticky 로 뜬 값을 재적재된 행에 복원. 재적재로 사라진 항목(order_no)은 자연히 건너뛴다. */
export async function restoreSticky(client, callId, sticky) {
    if (!sticky || !sticky.length) return 0;
    const { rowCount } = await client.query(
        `UPDATE qa_call_item_score s
            SET skill_excluded_at = x.skill_excluded_at
           FROM jsonb_to_recordset($2::jsonb)
                AS x(order_no int, skill_excluded_at timestamptz)
          WHERE s."ID" = $1 AND s.order_no = x.order_no`,
        [callId, JSON.stringify(sticky)]
    );
    return rowCount;
}

/**
 * 다중행 INSERT 1회. jsonb_to_recordset 은 텍스트→숫자 암묵 캐스팅을 관용하지 않으므로
 * buildItemScoreRows 가 숫자 컬럼을 미리 Number|null 로 정규화한다.
 * @param {import('pg').PoolClient} client 트랜잭션 클라이언트
 */
export async function insertItemScoreRows(client, callId, evaluations, checklist) {
    const rows = buildItemScoreRows(evaluations, checklist);
    if (!rows.length) return 0;
    await client.query(
        `INSERT INTO qa_call_item_score
             ("ID", order_no, category, item, reason_text, ai_eval, manual_eval,
              agent_utterance, max_score)
         SELECT $1, r.order_no, r.category, r.item, r.reason_text, r.ai_eval, r.manual_eval,
                r.agent_utterance, r.max_score
           FROM jsonb_to_recordset($2::jsonb)
                AS r(order_no int, category text, item text, reason_text text,
                     ai_eval float8, manual_eval float8,
                     agent_utterance text, max_score numeric)`,
        [callId, JSON.stringify(rows)]
    );
    return rows.length;
}

/** 전사(대화 턴) 다중행 INSERT 1회. 200턴 콜에서 왕복 200회 → 1회. */
export async function insertTranscriptRows(client, callId, conversation) {
    const turns = (conversation || []).map((t) => ({
        turn_no: Number(t.turn_no),
        speaker: t.speaker ?? null,
        text: t.text ?? null,
    }));
    if (!turns.length) return 0;
    await client.query(
        `INSERT INTO qa_call_transcript ("ID", turn_no, speaker, "text")
         SELECT $1, t.turn_no, t.speaker, t.text
           FROM jsonb_to_recordset($2::jsonb)
                AS t(turn_no int, speaker text, text text)`,
        [callId, JSON.stringify(turns)]
    );
    return turns.length;
}
