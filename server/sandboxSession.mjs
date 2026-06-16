/**
 * test1 샌드박스 계정용 세션 격리 — column-scoped 모델.
 *
 * 설계: qa_calls.is_sandbox (boolean) 가 운영/sandbox 행을 컬럼 단위로 분리한다.
 *  - 샘플 업로드(sampleIngest) 는 is_sandbox=true 로 INSERT.
 *  - 외부 ingest(collectionCallIngest) 는 is_sandbox=false 로 INSERT.
 *  - test1 로그아웃 시 endSandboxSession 이 is_sandbox=true 행만 정리.
 *
 * 따라서 운영 데이터는 어떤 sandbox 세션이 끝나도 DELETE 대상이 안 된다.
 *
 * 과거의 전체 스냅샷 → 복원 모델은 폐기. 그 모델은 `DELETE FROM qa_calls`(WHERE 없음)
 * 를 통해 sandbox 세션 사이 들어온 외부 ingest 운영 데이터를 함께 휘발시키는 버그가 있었다.
 */

export const SANDBOX_LOGIN_ID = 'test1';

// 안전망: is_sandbox=true 행이 비정상적으로 많으면 정리 거부.
// 누군가 실수로 운영 행에 is_sandbox=true 를 박은 경우 대규모 손실을 막는다.
const SANDBOX_CLEANUP_HARD_CAP = 10000;

/**
 * test1 로그인 시 호출. 신규 모델에서는 별도 baseline 캡처가 불필요하다 —
 * sandbox 데이터는 is_sandbox=true 컬럼으로 영구히 식별 가능.
 * 함수는 호환성 유지를 위해 남겨두지만 무동작.
 */
export async function beginSandboxSession(_pool) {
    // no-op (column-scoped 모델에서는 baseline 스냅샷 불필요)
}

/**
 * test1 로그아웃 시 호출. is_sandbox=true 행만 정리. CASCADE 로 자식 테이블도 함께 비워진다.
 * 운영 행(is_sandbox=false)은 어떤 경우에도 건드리지 않는다.
 */
export async function endSandboxSession(pool) {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const beforeRes = await client.query(
            `SELECT COUNT(*)::int AS n FROM qa_calls WHERE is_sandbox = true`
        );
        const sandboxCount = beforeRes.rows[0]?.n ?? 0;

        if (sandboxCount > SANDBOX_CLEANUP_HARD_CAP) {
            await client.query('ROLLBACK');
            console.error(
                `[sandboxSession] is_sandbox=true 행이 ${sandboxCount}건으로 한도(${SANDBOX_CLEANUP_HARD_CAP})를 초과 — 정리 거부. ` +
                `운영 행이 잘못 태깅됐을 가능성 검사 필요.`
            );
            return { ok: false, reason: 'cap_exceeded', sandboxCount };
        }

        const delCalls = await client.query(
            `DELETE FROM qa_calls WHERE is_sandbox = true RETURNING "ID"`
        );
        const delAudit = await client.query(
            `DELETE FROM qa_audit_logs WHERE login_id = $1`,
            [SANDBOX_LOGIN_ID]
        );
        await client.query('COMMIT');
        console.log(
            `[sandboxSession] cleanup: qa_calls -${delCalls.rowCount} (sandbox), qa_audit_logs -${delAudit.rowCount} (test1)`
        );
        return { ok: true, deletedCalls: delCalls.rowCount, deletedAuditLogs: delAudit.rowCount };
    } catch (e) {
        await client.query('ROLLBACK');
        throw e;
    } finally {
        client.release();
    }
}
