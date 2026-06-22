import React from 'react';

// ─────────────────────────────────────────────────────────────
// PageContainer — 모든 페이지 본문의 가로폭을 한 곳에서 통제하는 단일 모듈.
//
// 기준 폭: "평가 리스트"(Dashboard) 페이지의 1280px. [[ui-fixed-max-content-width]]
// 페이지마다 max-w-[…] 를 따로 박지 말고 이 컴포넌트로 감싼다.
// 폭을 바꿔야 하면 여기 PAGE_MAX_WIDTH 한 줄만 고치면 전 페이지에 반영된다.
// ─────────────────────────────────────────────────────────────

// 본문 최대 가로폭(px). 단일 소스 오브 트루스.
export const PAGE_MAX_WIDTH = 1280;

export default function PageContainer({ children, className = '' }) {
    return (
        <div
            className={`w-full mx-auto ${className}`.trim()}
            style={{ maxWidth: PAGE_MAX_WIDTH }}
        >
            {children}
        </div>
    );
}
