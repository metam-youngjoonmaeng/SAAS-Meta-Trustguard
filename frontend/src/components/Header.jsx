import React from 'react';
import { Search } from 'lucide-react';

const Header = ({ title, subtitle, actions }) => {
    return (
        <header className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-6 mb-6 border-b-2 border-[#E4E7EC]">
            <div className="flex-1 min-w-[300px] max-w-4xl">
                <h1 className="text-2xl font-bold text-[#101828] tracking-tight">{title}</h1>
                {subtitle && (
                    <p className="text-sm text-[#667085] mt-1 leading-relaxed whitespace-pre-line">{subtitle}</p>
                )}
            </div>
            <div className="flex items-center gap-2">
                {actions ? actions : (
                    <button className="flex items-center gap-2 px-6 py-2 bg-[#055AAF] rounded-lg text-sm font-semibold text-white hover:bg-[#1E70E0] shadow-sm transition-all active:scale-[0.98]">
                        <Search size={16} />
                        조회
                    </button>
                )}
            </div>
        </header>
    );
};

export default Header;
