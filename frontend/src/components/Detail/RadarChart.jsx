import React, { useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

const RadarChart = ({ labels, teamData, overallData, agentData, size = 300 }) => {
    const [visible, setVisible] = useState({
        overall: true,
        team: true,
        agent: true
    });

    const center = size / 2;
    const radius = (size / 2) * 0.7; // 70% of half size
    const points = labels.length;
    const angleStep = (Math.PI * 2) / points;

    const toggleSeries = (key) => {
        setVisible(prev => ({ ...prev, [key]: !prev[key] }));
    };

    const getPoint = (index, value) => {
        const r = radius * (value / 100);
        const angle = index * angleStep - Math.PI / 2;
        return {
            x: center + r * Math.cos(angle),
            y: center + r * Math.sin(angle)
        };
    };

    const teamPath = useMemo(() => {
        return labels.map((_, i) => {
            const p = getPoint(i, teamData[i] || 0);
            return `${i === 0 ? 'M' : 'L'} ${p.x},${p.y}`;
        }).join(' ') + ' Z';
    }, [teamData, labels, size]);

    const agentPath = useMemo(() => {
        return labels.map((_, i) => {
            const p = getPoint(i, agentData[i] || 0);
            return `${i === 0 ? 'M' : 'L'} ${p.x},${p.y}`;
        }).join(' ') + ' Z';
    }, [agentData, labels, size]);

    const overallPath = useMemo(() => {
        return labels.map((_, i) => {
            const p = getPoint(i, overallData?.[i] || 0);
            return `${i === 0 ? 'M' : 'L'} ${p.x},${p.y}`;
        }).join(' ') + ' Z';
    }, [overallData, labels, size]);

    const gridPaths = useMemo(() => {
        return [20, 40, 60, 80, 100].map(tick => {
            return labels.map((_, i) => {
                const p = getPoint(i, tick);
                return `${i === 0 ? 'M' : 'L'} ${p.x},${p.y}`;
            }).join(' ') + ' Z';
        });
    }, [labels, size]);

    return (
        <div className="relative flex flex-col items-center">
            <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="overflow-visible">
                {/* Grid lines */}
                {gridPaths.map((path, i) => (
                    <path key={i} d={path} fill="none" stroke="#E4E7EC" strokeWidth="1" />
                ))}

                {/* Axes */}
                {labels.map((_, i) => {
                    const edge = getPoint(i, 100);
                    return (
                        <line key={i} x1={center} y1={center} x2={edge.x} y2={edge.y} stroke="#E4E7EC" />
                    );
                })}

                {/* Overall Data (Baseline) */}
                <AnimatePresence>
                    {visible.overall && (
                        <motion.path
                            key="overall-path"
                            initial={{ d: labels.map((_, i) => `M ${center},${center}`).join(' '), opacity: 0 }}
                            animate={{ d: overallPath, opacity: 1 }}
                            exit={{ opacity: 0, scale: 0.5 }}
                            transition={{ duration: 1, ease: "easeOut" }}
                            fill="transparent"
                            stroke="#15803D"
                            strokeWidth="2"
                            strokeDasharray="2 2"
                        />
                    )}
                </AnimatePresence>

                {/* Team Data */}
                <AnimatePresence>
                    {visible.team && (
                        <motion.path
                            key="team-path"
                            initial={{ d: gridPaths[0], opacity: 0 }}
                            animate={{ d: teamPath, opacity: 1 }}
                            exit={{ opacity: 0 }}
                            transition={{ duration: 1, ease: "backOut" }}
                            fill="rgba(217, 119, 6, 0.04)"
                            stroke="#D97706"
                            strokeWidth="2.2"
                            strokeDasharray="5 2"
                        />
                    )}
                </AnimatePresence>

                {/* Agent Data (Target) */}
                <AnimatePresence>
                    {visible.agent && (
                        <motion.path
                            key="agent-path"
                            initial={{ d: labels.map((_, i) => `M ${center},${center}`).join(' '), scale: 0.8, opacity: 0 }}
                            animate={{ d: agentPath, scale: 1, opacity: 1 }}
                            exit={{ opacity: 0, scale: 0.5 }}
                            transition={{ duration: 1, ease: "circOut" }}
                            fill="rgba(5, 90, 175, 0.12)"
                            stroke="#055AAF"
                            strokeWidth="2.8"
                        />
                    )}
                </AnimatePresence>

                {/* Labels */}
                {labels.map((label, i) => {
                    const p = getPoint(i, 115);
                    const anchor = p.x > center ? 'start' : p.x < center ? 'end' : 'middle';
                    return (
                        <text
                            key={i}
                            x={p.x}
                            y={p.y}
                            fill="#667085"
                            fontSize="10"
                            fontWeight="600"
                            textAnchor={anchor}
                            alignmentBaseline="middle"
                        >
                            {label}
                        </text>
                    );
                })}

                {/* Agent Points */}
                {labels.map((_, i) => {
                    const p = getPoint(i, agentData[i] || 0);
                    return (
                        <AnimatePresence key={`agent-point-container-${i}`}>
                            {visible.agent && (
                                <motion.circle
                                    key={`agent-point-${i}`}
                                    initial={{ cx: center, cy: center, r: 0 }}
                                    animate={{ cx: p.x, cy: p.y, r: 3.4 }}
                                    exit={{ r: 0 }}
                                    transition={{ duration: 0.8 }}
                                    fill="#055AAF"
                                />
                            )}
                        </AnimatePresence>
                    );
                })}
            </svg>

            {/* Legend Tags with Toggle Functionality */}
            <div className="flex gap-3 mt-0 text-[11px] font-bold">
                <button
                    onClick={() => toggleSeries('overall')}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full border transition-all transform active:scale-95 ${visible.overall ? 'bg-green-50/50 border-green-200 text-[#15803D] shadow-sm' : 'bg-gray-50 border-gray-200 text-gray-300 opacity-60'}`}
                >
                    <span className={`w-2 h-2 rounded-full border border-dotted ${visible.overall ? 'border-[#15803D] bg-green-100' : 'border-gray-300 bg-gray-100'}`}></span>
                    전체평균
                </button>
                <button
                    onClick={() => toggleSeries('team')}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full border transition-all transform active:scale-95 ${visible.team ? 'bg-amber-50/50 border-amber-200 text-[#D97706] shadow-sm' : 'bg-gray-50 border-gray-200 text-gray-300 opacity-60'}`}
                >
                    <span className={`w-2 h-2 rounded-full border border-dashed ${visible.team ? 'border-[#D97706] bg-amber-100' : 'border-gray-300 bg-gray-100'}`}></span>
                    직무평균
                </button>
                <button
                    onClick={() => toggleSeries('agent')}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full shadow-md transition-all transform active:scale-95 ${visible.agent ? 'bg-[#055AAF] text-white' : 'bg-gray-100 border-gray-300 text-gray-400 shadow-none opacity-60'}`}
                >
                    <span className={`w-2 h-2 rounded-full ${visible.agent ? 'bg-white' : 'bg-gray-300'}`}></span>
                    상담사
                </button>
            </div>
        </div>
    );
};

export default RadarChart;
