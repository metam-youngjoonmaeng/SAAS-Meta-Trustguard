// 평가 관리 탭 진입점 — 역할에 따라 다른 화면을 렌더링한다.
//   관리자(admin) / 슈퍼관리자(super_admin) → AdminEvalMgmt (평가 목록·승인 + 코칭 배정)
//   상담사(agent) 및 그 외                    → CounselorResults (내 평가 결과)
// 디자인은 etc/ 프로토타입을 그대로 포팅했으며, 프로토타입의 토큰/클래스가
// 앱 전역 스타일과 충돌하지 않도록 .tg-eval 래퍼에 스코프했다(evalMgmt.css).
import React from 'react';
import './evalMgmt/evalMgmt.css';
import AdminEvalMgmt from './evalMgmt/AdminEvalMgmt';
import CounselorResults from './evalMgmt/CounselorResults';

export default function EvalMgmt({ role }) {
    const isAdmin = role === 'admin' || role === 'super_admin';
    // 평가 리스트·전체 통계와 동일한 고정 최대 가로폭(1280px, 가운데 정렬). [[ui-fixed-max-content-width]]
    // 센터링은 바깥 래퍼에서 처리 — .tg-eval 에는 스코프된 `margin:0` 리셋이 있어
    // 거기에 mx-auto 를 주면 덮어써져 좌측 쏠림이 됨(평가관리만 그랬던 원인).
    return (
        <div className="w-full max-w-[1280px] mx-auto">
            <div className="tg-eval">
                {isAdmin ? <AdminEvalMgmt /> : <CounselorResults />}
            </div>
        </div>
    );
}
