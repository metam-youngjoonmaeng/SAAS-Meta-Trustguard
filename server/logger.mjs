/**
 * Application 로그 — 일자별 회전 + 3일 retention.
 * 원본: 01-AI-Tutor-dev/backend/main.py 의 loguru 설정과 동일 정책.
 *   - rotation="00:00"  → winston-daily-rotate-file datePattern=YYYY-MM-DD, frequency 자정 회전
 *   - retention="3 days"→ maxFiles=3d (3일 경과 파일 자동 삭제)
 *   - format            → "{time} | {level} | {module} - {message}" 동일
 *
 * 사용자 활동 audit(qa_audit_logs) 과 별개 계층. 여긴 운영/디버깅용 INFO/WARN/ERROR.
 */
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import winston from 'winston';
import 'winston-daily-rotate-file';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// 컨테이너 안에서는 /app/logs 가 호스트 ./logs 에 마운트됨 (docker-compose 정의).
// 로컬 dev:api 실행 시에도 동일 경로(<repo>/logs) 사용.
const LOG_DIR = process.env.LOG_DIR || path.join(__dirname, '..', 'logs');
try {
    fs.mkdirSync(LOG_DIR, { recursive: true });
} catch (err) {
    console.error('[logger] log dir 생성 실패:', err);
}

const LEVEL = (process.env.LOG_LEVEL || 'info').toLowerCase();

// loguru 와 동일 포맷: "YYYY-MM-DD HH:mm:ss.SSS | LEVEL    | module - message"
const FILE_FORMAT = winston.format.printf(({ timestamp, level, message, module }) => {
    const lvl = String(level).toUpperCase().padEnd(8, ' ');
    const mod = module || 'qa-api';
    return `${timestamp} | ${lvl} | ${mod} - ${message}`;
});

export const LOG_FILENAME_PATTERN = 'app-%DATE%.log';
export const LOG_RETENTION_DAYS = 3;

const fileTransport = new winston.transports.DailyRotateFile({
    dirname: LOG_DIR,
    filename: LOG_FILENAME_PATTERN,
    datePattern: 'YYYY-MM-DD',
    // 자정 회전 — frequency 미지정 + datePattern 만으로 자정 분기. 호환성 위해 명시.
    frequency: '24h',
    maxFiles: `${LOG_RETENTION_DAYS}d`,
    zippedArchive: false,
    utc: false,
});

const consoleTransport = new winston.transports.Console({
    format: winston.format.combine(
        winston.format.colorize({ all: false, level: true }),
        FILE_FORMAT
    ),
});

export const logger = winston.createLogger({
    level: LEVEL,
    format: winston.format.combine(
        winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss.SSS' }),
        FILE_FORMAT
    ),
    transports: [fileTransport, consoleTransport],
});

// 현재 활성 로그 파일 경로 (실시간 tail 엔드포인트가 사용).
export function todayLogPath() {
    const d = new Date();
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return path.join(LOG_DIR, `app-${yyyy}-${mm}-${dd}.log`);
}

export function logDir() {
    return LOG_DIR;
}

// express 요청 로깅 미들웨어 — 상태 코드·소요 시간·경로.
export function requestLogger() {
    return (req, res, next) => {
        const start = process.hrtime.bigint();
        res.on('finish', () => {
            const ns = Number(process.hrtime.bigint() - start);
            const ms = (ns / 1_000_000).toFixed(1);
            const actor = req.session?.login_id || '-';
            logger.info(`${req.method} ${req.originalUrl} → ${res.statusCode} (${ms}ms, actor=${actor})`, {
                module: 'http',
            });
        });
        next();
    };
}
