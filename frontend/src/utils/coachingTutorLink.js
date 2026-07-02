// 배정 코칭 "학습 시작" → 튜터(02-AI-Tutor-ICS) 학습 앱 deep-link.
// 내 평가결과 카드(CounselorResults)와 알림의 코칭 플랜 팝업(NotificationBell)이 공유한다.
//   튜터(02 page.tsx)가 from=coaching 으로 코칭모드 진입:
//   scenarios=<slug,slug>(자동선택) · mode=call|chat(전화/채팅 프리셋) · since=ISO(배정 이후 완료만 인정) · from=coaching
//   userId=userCd@projCd → ICS 로그인 사용자는 튜터가 /auth/ics-sso 자동로그인(로그인창 없음).
import { QA_ACTOR_STORAGE_KEY } from '../services/api';

// NEXT_PUBLIC_ 이라 빌드 시점 인라인.
const TUTOR_APP_URL = (typeof process !== 'undefined' && process.env.NEXT_PUBLIC_TUTOR_APP_URL) || '';

// 로그인 actor 원본(localStorage). { login_id, auth_source('ics'|'manual'), ... }
function readActor() {
    if (typeof window === 'undefined') return null;
    try {
        const raw = window.localStorage.getItem(QA_ACTOR_STORAGE_KEY);
        return raw ? JSON.parse(raw) : null;
    } catch {
        return null;
    }
}

export function buildTutorLink(g) {
    if (!TUTOR_APP_URL) return null;
    const params = new URLSearchParams();
    // 배정은 무제한이지만 튜터는 동시 3개까지 — 미완료 시나리오 우선으로 다음 3개를 전달(방문할수록 소거됨).
    const all = (g.scenarios || []).filter(Boolean);
    const done = Array.isArray(g.completed) ? g.completed : [];
    const remaining = all.filter((c) => !done.includes(c));
    const codes = (remaining.length ? remaining : all).slice(0, 3);
    if (codes.length) params.set('scenarios', codes.join(','));
    params.set('mode', g.channel === 'chat' ? 'chat' : 'call');
    if (g.assignedAtIso) params.set('since', g.assignedAtIso);
    params.set('from', 'coaching');
    const actor = readActor();
    if (actor && actor.auth_source === 'ics' && actor.login_id) {
        params.set('userId', String(actor.login_id));
    }
    return `${TUTOR_APP_URL.replace(/\/+$/, '')}/?${params.toString()}`;
}
