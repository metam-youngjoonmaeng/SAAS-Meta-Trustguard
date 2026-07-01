import React from 'react';

const Header = ({ title, subtitle, actions }) => {
    return (
        <header className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-6 mb-6 border-b-2 border-[#E4E7EC]">
            <div className="flex-1 min-w-[300px] max-w-4xl">
                <h1 className="text-2xl font-bold text-[#101828] tracking-tight">{title}</h1>
                {subtitle && (
                    <p className="text-sm text-[#667085] mt-1 leading-relaxed whitespace-pre-line">{subtitle}</p>
                )}
            </div>
            {/* actions 를 넘긴 화면만 우측 액션 노출. 미지정 시 아무것도 렌더하지 않음
                (과거의 동작 없는 '조회' 폴백 버튼 제거 — 사용자관리 등 검색은 입력 즉시 필터). */}
            {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
        </header>
    );
};

export default Header;
