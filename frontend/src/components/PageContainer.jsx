import React from 'react';

// ─────────────────────────────────────────────────────────────
// PageContainer — 모든 페이지 본문의 가로폭 + 진입 모션을 한 곳에서 통제하는 단일 모듈.
//
// 기준 폭: "평가 리스트"(Dashboard) 페이지의 1280px. [[ui-fixed-max-content-width]]
// 진입 모션: animate-fade-in(아래→위로 살짝 올라오며 페이드). 모든 페이지 공통.
//   App.jsx 에서 <PageContainer key={activeTab}> 로 감싸 탭 전환마다 재생된다.
// 페이지마다 max-w-[…] / animate-fade-in 을 따로 박지 말고 이 컴포넌트로 감싼다.
// 폭을 바꿔야 하면 여기 PAGE_MAX_WIDTH 한 줄만 고치면 전 페이지에 반영된다.
// ─────────────────────────────────────────────────────────────

// 본문 최대 가로폭(px). 단일 소스 오브 트루스.
export const PAGE_MAX_WIDTH = 1280;

export default function PageContainer({ children, className = '' }) {
    return (
        <div
            className={`w-full mx-auto animate-fade-in ${className}`.trim()}
            style={{ maxWidth: PAGE_MAX_WIDTH }}
        >
            {children}
        </div>
    );
}
