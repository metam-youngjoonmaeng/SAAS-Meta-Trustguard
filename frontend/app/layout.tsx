import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
    title: '메타엠 - Meta-Trustguard',
    icons: { icon: '/metam_favicon.png' },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
    return (
        <html lang="ko">
            <head>
                {/* Pretendard + Moneygraphy Rounded (self-hosted in public/fonts) */}
                <link rel="stylesheet" href="/fonts/fonts.css" />
            </head>
            <body>{children}</body>
        </html>
    );
}
