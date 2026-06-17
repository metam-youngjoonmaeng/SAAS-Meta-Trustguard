'use client';

// 1차 마이그레이션: 기존 Vite SPA(App.jsx, 해시 라우팅)를 Next 클라이언트 셸로 그대로 호스팅한다.
// App 은 window/localStorage/해시 라우팅에 의존하므로 ssr:false 로 클라이언트에서만 렌더한다.
// (이후 단계에서 탭을 App Router 파일 라우트로 점진 전환 예정.)
import dynamic from 'next/dynamic';

const App = dynamic(() => import('@/src/App'), {
    ssr: false,
    loading: () => (
        <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#667085', fontSize: 14 }}>
            로딩 중…
        </div>
    ),
});

export default function Page() {
    return <App />;
}
