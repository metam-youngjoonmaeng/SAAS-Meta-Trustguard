import React, { useState, useMemo, useEffect } from 'react';
import { Search, ChevronRight, FileX, Info } from 'lucide-react';
import {
    CONSUMER_TOTAL_MAX,
    DEFAULT_TOTAL_MAX,
    getBrandConfig,
    isDynamicChecklistBrand,
} from '../constants';
import { formatDateTime, formatDuration } from '../utils/formatters';
import { fetchEvalItemVersions } from '../services/api';
import useDefaultRubricMax from '../hooks/useDefaultRubricMax';
// 추후 상세 로직 확정 후 재활성화 — "코칭 액션 (AI 자동 추천)" / "자동 플래그 (오늘 배치)"
// import CoachingActionPanel from '../components/CoachingActionPanel';
// import AutoFlagPanel from '../components/AutoFlagPanel';
import ReviewStatusBadge, {
    REVIEW_STATUS,
    REVIEW_STATUS_LABEL,
    deriveReviewStatus,
} from '../components/ReviewStatusBadge';

const RUBRIC_TOTAL_MAX = 100;

/** 검수상태 배지 호버 툴팁 — 검토요청·최종승인일 때 검수자/검토(승인)일시 노출. */
function reviewTooltip(row) {
    const st = deriveReviewStatus(row);
    if (st !== REVIEW_STATUS.REVIEW_DONE && st !== REVIEW_STATUS.APPROVED) return undefined;
    const who = row?.reviewed_by ? String(row.reviewed_by).trim() : '';
    const when = row?.reviewed_at ? formatDateTime(row.reviewed_at) : '';
    const parts = [];
    if (who) parts.push(`검수자: ${who}`);
    if (when) parts.push(`${st === REVIEW_STATUS.APPROVED ? '승인' : '검토'}: ${when}`);
    if (!parts.length) return '검수자·검토일시 기록 없음';
    return parts.join('\n');
}

/** 합계 열: DB 루브릭 %를 0~100 정수 득점만 표시 */
function labelEarnedOverMax(scoreLike) {
    if (scoreLike === null || scoreLike === undefined || scoreLike === '') return '-';
    const n = Number(scoreLike);
    if (!Number.isFinite(n)) return '-';
    const e = Math.min(RUBRIC_TOTAL_MAX, Math.max(0, Math.round(n)));
    return String(e);
}

/** 고객지원실 합계 열: total_score(획득점 합계 원점수)를 "X / totalMax" 그대로 표시 — 환산 없음.
 *  totalMax = 콜별 평가-시점 만점(row.total_max) — 미지정 시 DEFAULT_TOTAL_MAX 폴백.
 *  저장값이 곧 합계 (예: 80점 만점 78점 → "78 / 80"). */
function labelEarnedOverDefaultMax(scoreLike, totalMax = DEFAULT_TOTAL_MAX) {
    if (scoreLike === null || scoreLike === undefined || scoreLike === '') return '-';
    const n = Number(scoreLike);
    if (!Number.isFinite(n)) return '-';
    const earned = Math.round(Math.max(0, n) * 10) / 10;
    return `${earned} / ${totalMax}`;
}

/** checklist_yn_kor: "8/10" 또는 구형 "%" — 표시는 득점만, ratio는 만점 대비(배지 색) */
function categoryCell(raw, categoryKey, categoryMaxPoints) {
    const maxPts = categoryMaxPoints[categoryKey] ?? 0;
    if (raw === undefined || raw === null || raw === '') {
        return { text: '-', ratio: NaN };
    }
    const s = String(raw).trim();
    if (s.includes('/')) {
        const parts = s.split('/');
        const a = parseInt(parts[0], 10);
        const b = parseInt(parts[1], 10);
        if (Number.isFinite(a) && Number.isFinite(b) && b > 0) {
            return { text: String(a), ratio: Math.min(1, a / b) };
        }
        return { text: '-', ratio: NaN };
    }
    const pct = Number(s);
    if (!Number.isFinite(pct) || maxPts <= 0) {
        return { text: '-', ratio: NaN };
    }
    const earned = Math.min(maxPts, Math.max(0, Math.round((pct / 100) * maxPts)));
    return { text: String(earned), ratio: earned / maxPts };
}

const DASHBOARD_DEPT_STORAGE_KEY = 'qa_dashboard_active_department';

// 평가 리스트 한 페이지 건수 — 10건까지 한 화면, 초과분은 하단 숫자 네비게이션.
const PAGE_SIZE = 10;

// 하단 페이지 네비게이션 표시용 — 현재 페이지 주변 + 처음/끝, 사이는 '…'. (0-based 입력/반환, '…' 포함)
function buildPages(current, total) {
    const keep = new Set([0, total - 1, current - 1, current, current + 1]);
    const valid = [...keep].filter((p) => p >= 0 && p < total).sort((a, b) => a - b);
    const out = [];
    let prev = null;
    for (const p of valid) {
        if (prev !== null && p - prev > 1) out.push('…');
        out.push(p);
        prev = p;
    }
    return out;
}

const Dashboard = ({ calls, isLoading, onOpenDetail, activeBrandId }) => {
    // 활성 브랜드의 평가 체계 lookup. 신한(=1) 은 컬렉션관리부 9항목 + 소비자보호부 20항목, 한화(=2) 는 고객센터 8항목.
    const brandConfig = useMemo(() => getBrandConfig(activeBrandId), [activeBrandId]);
    const DEPARTMENT_OPTIONS = brandConfig.departments;
    const ROLE_OPTIONS_BY_DEPT = brandConfig.roleOptionsByDept;
    // 레거시(신한1/한화2/코오롱3)=정적 체크리스트, 신규 브랜드(id≥4)=DB 기반 동적.
    const dynamic = isDynamicChecklistBrand(activeBrandId);
    // 기본 브랜드: 만점(분모)을 EvalItems 탭 편집 DB(eval_item_defs '기본')에서 라이브 조회.
    // 신한/한화 등은 enabled=false → 정적 checklistTemplate 폴백.
    const { categoryMaxPoints: CATEGORY_MAX_POINTS, effectiveTemplate, totalMax: rubricTotalMax } = useDefaultRubricMax({
        enabled: brandConfig.key === 'default' || dynamic,
        fallbackTemplate: brandConfig.checklistTemplate,
        dynamicList: dynamic,
        activeBrandId, // 브랜드 전환 시 재조회 → 컬럼(카테고리)·분모 즉시 갱신(stale 방지).
    });
    // 표 컬럼(CHECKLIST_KEYS)은 평가체계 버전 필터에 의존하므로 버전 계산 뒤(아래)에서 정의한다.
    // 상세페이지 → 뒤로가기 복귀 시 직전에 보던 부서 탭을 유지.
    // 같은 탭(sessionStorage)에서만 살아남도록 함 — 새 탭/새 창은 기본 부서로 시작.
    const [department, setDepartment] = useState(() => {
        if (typeof window === 'undefined') return DEPARTMENT_OPTIONS[0];
        const saved = window.sessionStorage.getItem(DASHBOARD_DEPT_STORAGE_KEY);
        return DEPARTMENT_OPTIONS.includes(saved) ? saved : DEPARTMENT_OPTIONS[0];
    });

    // 브랜드가 바뀌면 현재 선택된 부서가 신규 브랜드의 부서 리스트에 없을 수 있음 → 첫 부서로 강제.
    useEffect(() => {
        if (!DEPARTMENT_OPTIONS.includes(department)) {
            setDepartment(DEPARTMENT_OPTIONS[0]);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [activeBrandId]);
    const [filters, setFilters] = useState({
        startDate: '',
        endDate: '',
        agent: '',
        eval: '',
        role: '',
        item: 'AI_QA',
        consultationType: '',
        reviewStatus: '',
        manualOnly: false,
    });
    const [page, setPage] = useState(0);  // 평가 리스트 페이지네이션(0-based)

    // 부서 변경 시 부서별 의미 없는 필터(직무) 초기화
    const handleDepartmentChange = (next) => {
        setDepartment(next);
        setFilters((prev) => ({ ...prev, role: '' }));
        if (typeof window !== 'undefined' && DEPARTMENT_OPTIONS.includes(next)) {
            window.sessionStorage.setItem(DASHBOARD_DEPT_STORAGE_KEY, next);
        }
    };

    const uniqueValues = useMemo(() => ({
        consultationTypes: [...new Set(calls.map(c => c.consultation_type).filter(Boolean))],
    }), [calls]);

    // 평가체계 버전 목록 (부서별). 활성 브랜드 변경 시 재로드.
    // 설계: docs/EVALUATION_ITEMS.md "평가체계 버전 관리"
    const [evalVersions, setEvalVersions] = useState([]);
    useEffect(() => {
        let cancelled = false;
        fetchEvalItemVersions()
            .then((res) => {
                if (cancelled) return;
                setEvalVersions(Array.isArray(res?.versions) ? res.versions : []);
            })
            .catch(() => { if (!cancelled) setEvalVersions([]); });
        return () => { cancelled = true; };
    }, [activeBrandId]);

    // 현재 부서의 버전 목록 (effective_from ASC 정렬)
    const departmentVersions = useMemo(() => {
        return evalVersions
            .filter((v) => v.department === department)
            .map((v) => ({
                ...v,
                effectiveFromDate: v.effective_from ? new Date(v.effective_from) : null,
            }))
            .sort((a, b) => {
                const ad = a.effectiveFromDate?.getTime() ?? 0;
                const bd = b.effectiveFromDate?.getTime() ?? 0;
                return ad - bd;
            });
    }, [evalVersions, department]);

    // 현재 부서의 최신 평가체계 버전 번호 (없으면 '').
    const latestVersion = useMemo(() => (
        departmentVersions.length
            ? Math.max(...departmentVersions.map((v) => Number(v.version)))
            : ''
    ), [departmentVersions]);

    // 콜 → 버전 매칭: 콜 call_datetime <= effective_from 인 버전 중 가장 최근
    const matchCallToVersion = useMemo(() => {
        const sortedDesc = [...departmentVersions].reverse(); // 최신부터
        return (callDate) => {
            if (!callDate || !sortedDesc.length) return null;
            for (const v of sortedDesc) {
                if (!v.effectiveFromDate) continue;
                if (v.effectiveFromDate <= callDate) {
                    // deactivated 체크: 활성 = 효력 이후. 비활성화 시점 이후 콜은 매칭 안 됨.
                    if (v.last_deactivated_at) {
                        const deact = new Date(v.last_deactivated_at);
                        if (callDate >= deact) continue;
                    }
                    return v.version;
                }
            }
            return null;
        };
    }, [departmentVersions]);

    const roleOptions = useMemo(() => ROLE_OPTIONS_BY_DEPT[department] || [], [department]);

    const departmentCounts = useMemo(() => {
        const m = Object.fromEntries(DEPARTMENT_OPTIONS.map((d) => [d, 0]));
        const defaultDept = DEPARTMENT_OPTIONS[0];
        // 부서가 1개인 브랜드(신규/코오롱 등 default-config '기본')는 부서 구분이 없으므로
        // 콜이 과거 '고객지원실' 로 적재돼 있어도 모두 단일 버킷에 집계.
        const singleDept = DEPARTMENT_OPTIONS.length <= 1;
        for (const c of calls) {
            const d = singleDept ? defaultDept : (c.department || defaultDept);
            if (m[d] !== undefined) m[d] += 1;
        }
        return m;
    }, [calls, DEPARTMENT_OPTIONS]);

    // 평가체계 버전 필터 — 사용자 선택값과 실제 적용 값을 분리.
    // selectedVersion: 사용자가 명시적으로 고른 값 ('' = 전체)
    // effectiveVersion: 실제 데이터 매칭에 쓰는 값. 선택한 버전 × 날짜 필터가 0건이면 자동 전환됨.
    const parseCallDate = (value) => {
        if (!value) return null;
        const direct = new Date(value);
        if (!Number.isNaN(direct.getTime())) return direct;
        const normalized = new Date(String(value).replace(' ', 'T'));
        if (!Number.isNaN(normalized.getTime())) return normalized;
        return null;
    };

    // 데이터(콜)가 실제로 매칭되는 버전만 추림 — 콜 0건 버전(항목 편집마다 발번된 빈 버전)은
    // 드롭다운/기본값에서 제외(변경이력 eval_item_change_log 에는 남으므로 기록 손실 없음). 부서 스코프 적용.
    const versionsWithData = useMemo(() => {
        const defaultDept = DEPARTMENT_OPTIONS[0];
        const singleDept = DEPARTMENT_OPTIONS.length <= 1;
        const s = new Set();
        for (const c of calls) {
            if (!singleDept && (c.department || defaultDept) !== department) continue;
            const v = matchCallToVersion(parseCallDate(c.call_datetime));
            if (v !== null && v !== undefined) s.add(Number(v));
        }
        return s;
    }, [calls, department, DEPARTMENT_OPTIONS, matchCallToVersion]);

    // 기본 선택 = 데이터 있는 버전 중 최신.
    const defaultVersion = useMemo(() => {
        const withData = departmentVersions
            .map((v) => Number(v.version))
            .filter((n) => versionsWithData.has(n));
        return withData.length ? Math.max(...withData) : '';
    }, [departmentVersions, versionsWithData]);

    // 드롭다운 노출 버전 = 데이터 있는 버전만 (콜 0건 버전 숨김).
    const dropdownVersions = useMemo(
        () => departmentVersions.filter((v) => versionsWithData.has(Number(v.version))),
        [departmentVersions, versionsWithData]
    );

    // 실제 내부 버전 → 화면 연번(1,2,3…) 매핑. 드롭다운·배너 라벨을 일관되게.
    const versionLabelOf = useMemo(() => {
        const m = new Map();
        dropdownVersions.forEach((v, i) => m.set(Number(v.version), i + 1));
        return (realVersion) => m.get(Number(realVersion)) ?? realVersion;
    }, [dropdownVersions]);

    // 평가체계 필터 값 해석: 'all'=전체(모든 버전), ''=기본(데이터 있는 최신 버전), 그 외=해당 버전.
    //   selectedVersion === '' 는 다운스트림에서 '전체'를 의미(기존 로직 유지).
    const selectedVersion =
        filters.eval === 'all' ? ''
            : filters.eval === '' ? defaultVersion
                : Number(filters.eval);

    // 기본 필터 (버전 제외) 적용 후 콜 셋. 자동 전환 판정용.
    const baseFilteredCalls = useMemo(() => {
        const startDate = filters.startDate ? new Date(`${filters.startDate}T00:00:00`) : null;
        const endDate = filters.endDate ? new Date(`${filters.endDate}T23:59:59.999`) : null;
        const defaultDept = DEPARTMENT_OPTIONS[0];
        // 부서가 1개인 브랜드는 부서 분할이 없으므로 부서 필터를 적용하지 않는다.
        // (콜이 과거 '고객지원실' 등으로 적재돼 있어도 '기본' 탭에서 모두 노출 — /api/calls 는 org 스코프라 안전)
        const singleDept = DEPARTMENT_OPTIONS.length <= 1;

        return calls.filter(row => {
            const rowDept = row.department || defaultDept;
            if (!singleDept && rowDept !== department) return false;
            if (startDate || endDate) {
                const callDate = parseCallDate(row.call_datetime);
                if (!callDate) return false;
                if (startDate && callDate < startDate) return false;
                if (endDate && callDate > endDate) return false;
            }
            if (filters.role && row.role !== filters.role) return false;
            if (filters.agent && !String(row.agent_name || '').includes(filters.agent)) return false;
            if (filters.item && filters.item !== 'AI_QA' && !(row.evaluation_items || []).includes(filters.item)) return false;
            if (filters.consultationType && row.consultation_type !== filters.consultationType) return false;
            if (filters.reviewStatus && deriveReviewStatus(row) !== filters.reviewStatus) return false;
            if (filters.manualOnly && !row.manual_review) return false;
            return true;
        });
    }, [calls, filters.startDate, filters.endDate, filters.role, filters.agent, filters.item, filters.consultationType, filters.reviewStatus, filters.manualOnly, department, DEPARTMENT_OPTIONS]);

    // 자동 전환: 선택 버전과 날짜 범위가 완전히 어긋나 0건이면 데이터가 있는 버전으로 fallback.
    // 0건 ≠ 자동 전환: 사용자가 선택한 버전 안에 콜이 있으면 그대로 유지 (부분 겹침은 부분만 표시).
    const versionFilterInfo = useMemo(() => {
        if (selectedVersion === '') {
            return { effectiveVersion: '', autoSwitched: false };
        }
        const matchSelected = baseFilteredCalls.filter((row) => {
            const callDate = parseCallDate(row.call_datetime);
            return matchCallToVersion(callDate) === selectedVersion;
        }).length;
        if (matchSelected > 0) {
            return { effectiveVersion: selectedVersion, autoSwitched: false };
        }
        // 0건 — 다른 버전 중 데이터가 있는 가장 가까운 버전으로 자동 전환
        const candidates = [...departmentVersions].reverse(); // 최신부터
        for (const v of candidates) {
            if (v.version === selectedVersion) continue;
            const hits = baseFilteredCalls.filter((row) => {
                const callDate = parseCallDate(row.call_datetime);
                return matchCallToVersion(callDate) === v.version;
            }).length;
            if (hits > 0) {
                return { effectiveVersion: v.version, autoSwitched: true };
            }
        }
        return { effectiveVersion: selectedVersion, autoSwitched: false };
    }, [selectedVersion, baseFilteredCalls, departmentVersions, matchCallToVersion]);

    const filteredCalls = useMemo(() => {
        if (versionFilterInfo.effectiveVersion === '') return baseFilteredCalls;
        return baseFilteredCalls.filter((row) => {
            const callDate = parseCallDate(row.call_datetime);
            return matchCallToVersion(callDate) === versionFilterInfo.effectiveVersion;
        });
    }, [baseFilteredCalls, versionFilterInfo.effectiveVersion, matchCallToVersion]);

    // 페이지네이션 — 한 화면에 PAGE_SIZE(10)건, 초과분은 하단 숫자 네비게이션.
    const pageCount = Math.max(1, Math.ceil(filteredCalls.length / PAGE_SIZE));
    const safePage = Math.min(page, pageCount - 1);
    const pagedCalls = filteredCalls.slice(safePage * PAGE_SIZE, safePage * PAGE_SIZE + PAGE_SIZE);
    // 필터·데이터 변경 시 1페이지로 복귀.
    useEffect(() => { setPage(0); }, [filteredCalls]);

    // 표 컬럼(평가 항목) = 선택된 평가체계 버전의 항목만. (전 기간 합집합 나열 금지 — UX)
    //   - 최신 버전(기본): 현재 활성 항목만(effectiveTemplate) → 삭제(소프트삭제) 항목 제외, 콜 0건 신규 항목도 표시.
    //   - 옛 버전: 그 버전에 매칭되는 콜에 실제 채점된 카테고리만(과거 결과 보존 — 버전 전환으로 열람).
    //   - 전체('all'): 활성 + 전 기간 콜 카테고리 합집합(정말 다 볼 때만).
    const CHECKLIST_KEYS = useMemo(() => {
        if (!dynamic) return brandConfig.checklistKeys;
        const activeCats = [...new Set((effectiveTemplate || []).map((t) => t.category).filter(Boolean))];
        const catsOf = (rows) => {
            const out = [];
            const seen = new Set();
            for (const c of rows) {
                const yn = c?.checklist_yn_kor;
                if (!yn || typeof yn !== 'object') continue;
                for (const k of Object.keys(yn)) {
                    if (k && !seen.has(k)) { seen.add(k); out.push(k); }
                }
            }
            return out;
        };
        const eff = versionFilterInfo.effectiveVersion;
        if (eff === '') {
            // 전체 — 활성 + 전 기간 콜 합집합
            const keys = [...activeCats];
            const seen = new Set(keys);
            for (const k of catsOf(calls)) if (!seen.has(k)) { seen.add(k); keys.push(k); }
            return keys;
        }
        if (eff === latestVersion) return activeCats; // 최신 = 현재 활성 항목만(깔끔)
        // 옛 버전 — 그 버전에 매칭되는 콜의 카테고리(날짜 등 타 필터와 무관, 버전 기준).
        const versionCalls = calls.filter((c) => matchCallToVersion(parseCallDate(c.call_datetime)) === eff);
        return catsOf(versionCalls);
    }, [dynamic, brandConfig, effectiveTemplate, calls, versionFilterInfo.effectiveVersion, latestVersion, matchCallToVersion]);

    return (
        <div className="w-full">
            {/* Filter Section */}
            <div className="bg-white p-6 rounded-xl border border-[#E4E7EC] shadow-sm mb-6">
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
                    <div className="space-y-1.5">
                        <label className="text-xs font-bold text-[#667085] uppercase tracking-wider">기간</label>
                        <div className="grid grid-cols-[1fr_auto_1fr] gap-2 items-center">
                            <input
                                type="date"
                                lang="en-CA"
                                className="w-full px-3 py-2 bg-[#F9FAFB] border border-[#D0D5DD] rounded-lg text-sm focus:ring-2 focus:ring-[#055AAF]/20 focus:border-[#055AAF] outline-none transition-all"
                                value={filters.startDate}
                                onChange={(e) => setFilters(prev => ({ ...prev, startDate: e.target.value }))}
                            />
                            <span className="text-[#98A2B3] font-bold text-xs">~</span>
                            <input
                                type="date"
                                lang="en-CA"
                                className="w-full px-3 py-2 bg-[#F9FAFB] border border-[#D0D5DD] rounded-lg text-sm focus:ring-2 focus:ring-[#055AAF]/20 focus:border-[#055AAF] outline-none transition-all"
                                value={filters.endDate}
                                onChange={(e) => setFilters(prev => ({ ...prev, endDate: e.target.value }))}
                            />
                        </div>
                    </div>
                    <div className="space-y-1.5">
                        <label className="text-xs font-bold text-[#667085] uppercase tracking-wider">상담사</label>
                        <div className="relative">
                            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={16} />
                            <input
                                type="text"
                                placeholder="성명 입력"
                                className="w-full pl-10 pr-4 py-2 bg-[#F9FAFB] border border-[#D0D5DD] rounded-lg text-sm focus:ring-2 focus:ring-[#055AAF]/20 focus:border-[#055AAF] outline-none transition-all placeholder:text-gray-400"
                                value={filters.agent}
                                onChange={(e) => setFilters(prev => ({ ...prev, agent: e.target.value }))}
                            />
                        </div>
                    </div>
                    <div className="space-y-1.5">
                        <label className="text-xs font-bold text-[#667085] uppercase tracking-wider">QA 항목버전</label>
                        <select
                            className="w-full px-3 py-2 bg-[#F9FAFB] border border-[#D0D5DD] rounded-lg text-sm focus:ring-2 focus:ring-[#055AAF]/20 outline-none cursor-pointer disabled:bg-[#F2F4F7] disabled:text-[#98A2B3] disabled:cursor-not-allowed"
                            value={filters.eval === '' ? (defaultVersion === '' ? 'all' : String(defaultVersion)) : filters.eval}
                            onChange={(e) => setFilters(prev => ({ ...prev, eval: e.target.value }))}
                            disabled={dropdownVersions.length === 0}
                            title={dropdownVersions.length === 0 ? '이 부서에 평가 데이터가 있는 평가체계 버전이 없습니다' : undefined}
                        >
                            <option value="all">전체</option>
                            {/* 데이터 있는 버전만 1,2,3… 연번 표기(중간 빈 버전 없음). 라벨='v연번 · 처음 반영일', value=실제 내부 버전 유지. */}
                            {dropdownVersions
                                .map((v, i) => ({
                                    v,
                                    displayNo: i + 1, // dropdownVersions 는 효력일 ASC → 가장 오래된 게 v1
                                    dateStr: v.effectiveFromDate ? v.effectiveFromDate.toISOString().slice(0, 10) : '',
                                }))
                                .reverse() // 최신을 위로
                                .map(({ v, displayNo, dateStr }) => (
                                    <option key={`${v.department}-${v.version}`} value={String(v.version)}>
                                        v{displayNo} · {dateStr}
                                    </option>
                                ))}
                        </select>
                    </div>
                    <div className="space-y-1.5">
                        <label className="text-xs font-bold text-[#667085] uppercase tracking-wider">직무</label>
                        <select
                            className="w-full px-3 py-2 bg-[#F9FAFB] border border-[#D0D5DD] rounded-lg text-sm focus:ring-2 focus:ring-[#055AAF]/20 outline-none cursor-pointer disabled:bg-[#F2F4F7] disabled:text-[#98A2B3] disabled:cursor-not-allowed"
                            value={filters.role}
                            onChange={(e) => setFilters(prev => ({ ...prev, role: e.target.value }))}
                            disabled={roleOptions.length <= 1}
                        >
                            <option value="">전체</option>
                            {roleOptions.map(v => <option key={v} value={v}>{v}</option>)}
                        </select>
                    </div>
                    <div className="space-y-1.5">
                        <label className="text-xs font-bold text-[#667085] uppercase tracking-wider">부서</label>
                        <select
                            className="w-full px-3 py-2 bg-[#F9FAFB] border border-[#D0D5DD] rounded-lg text-sm focus:ring-2 focus:ring-[#055AAF]/20 outline-none cursor-pointer"
                            value={department}
                            onChange={(e) => handleDepartmentChange(e.target.value)}
                        >
                            {DEPARTMENT_OPTIONS.map(v => (
                                <option key={v} value={v}>
                                    {v} ({departmentCounts[v] || 0})
                                </option>
                            ))}
                        </select>
                    </div>
                    <div className="space-y-1.5">
                        <label className="text-xs font-bold text-[#667085] uppercase tracking-wider">검수상태</label>
                        <select
                            className="w-full px-3 py-2 bg-[#F9FAFB] border border-[#D0D5DD] rounded-lg text-sm focus:ring-2 focus:ring-[#055AAF]/20 outline-none cursor-pointer"
                            value={filters.reviewStatus}
                            onChange={(e) => setFilters(prev => ({ ...prev, reviewStatus: e.target.value }))}
                        >
                            <option value="">전체</option>
                            <option value={REVIEW_STATUS.PENDING}>{REVIEW_STATUS_LABEL[REVIEW_STATUS.PENDING]}</option>
                            <option value={REVIEW_STATUS.IN_REVIEW}>{REVIEW_STATUS_LABEL[REVIEW_STATUS.IN_REVIEW]}</option>
                            <option value={REVIEW_STATUS.REVIEW_DONE}>{REVIEW_STATUS_LABEL[REVIEW_STATUS.REVIEW_DONE]}</option>
                            <option value={REVIEW_STATUS.ADMIN_REVISED}>{REVIEW_STATUS_LABEL[REVIEW_STATUS.ADMIN_REVISED]}</option>
                            <option value={REVIEW_STATUS.OBJECTION}>{REVIEW_STATUS_LABEL[REVIEW_STATUS.OBJECTION]}</option>
                            <option value={REVIEW_STATUS.APPROVED}>{REVIEW_STATUS_LABEL[REVIEW_STATUS.APPROVED]}</option>
                        </select>
                    </div>
                    <div className="space-y-1.5">
                        <label className="text-xs font-bold text-[#667085] uppercase tracking-wider">수기평가 대상</label>
                        <select
                            className="w-full px-3 py-2 bg-[#F9FAFB] border border-[#D0D5DD] rounded-lg text-sm focus:ring-2 focus:ring-[#055AAF]/20 outline-none cursor-pointer"
                            value={filters.manualOnly ? 'only' : ''}
                            onChange={(e) => setFilters(prev => ({ ...prev, manualOnly: e.target.value === 'only' }))}
                        >
                            <option value="">전체</option>
                            <option value="only">수기평가 대상만</option>
                        </select>
                    </div>
                    <div className="space-y-1.5">
                        <label className="text-xs font-bold text-[#667085] uppercase tracking-wider">항목</label>
                        <select
                            className="w-full px-3 py-2 bg-[#F9FAFB] border border-[#D0D5DD] rounded-lg text-sm outline-none cursor-not-allowed text-[#667085] disabled:opacity-100"
                            value={filters.item}
                            disabled
                        >
                            <option value="AI_QA">AI_QA</option>
                        </select>
                    </div>
                </div>
            </div>

            {/* 평가체계 자동 전환 배너 — 선택한 버전 × 조건이 0건일 때 가장 가까운 데이터 있는 버전으로 전환됨을 명시 */}
            {versionFilterInfo.autoSwitched && (
                <div className="mb-4 px-4 py-3 rounded-lg border border-[#BFD4F2] bg-[#EEF4FB] flex items-start gap-2.5 text-[12.5px] text-[#055AAF]">
                    <Info size={14} className="mt-0.5 shrink-0" />
                    <div className="flex-1">
                        <div className="font-semibold">
                            선택한 v{versionLabelOf(selectedVersion)} 의 데이터가 현재 조건에 없어 v{versionLabelOf(versionFilterInfo.effectiveVersion)} 으로 자동 전환되었습니다.
                        </div>
                        <div className="text-[11.5px] text-[#1E70E0] mt-0.5">
                            날짜 범위를 v{versionLabelOf(selectedVersion)} 효력 기간으로 조정하거나 전체 보기로 돌아갈 수 있습니다.
                        </div>
                    </div>
                    <button
                        type="button"
                        onClick={() => setFilters((prev) => ({ ...prev, eval: '' }))}
                        className="shrink-0 h-[28px] px-3 rounded-md bg-white border border-[#BFD4F2] text-[11.5px] font-semibold text-[#055AAF] hover:bg-[#FAFBFC] cursor-pointer"
                    >
                        전체 보기
                    </button>
                </div>
            )}

            {/* Main Table — evolved direction: 흰색 헤더 + 중성 칩, 짙은 파란 chrome 제거 */}
            <div className="bg-white rounded-xl border border-[#E4E7EC] overflow-hidden shadow-[0_1px_2px_rgba(16,24,40,0.04)]">
                <div className="overflow-auto min-h-[400px] max-h-[720px]">
                    {department !== '소비자보호부' ? (
                        <table className="w-full border-collapse table-fixed text-left">
                            <colgroup>
                                <col className="w-12" />
                                <col className="w-24" />
                                <col className="w-40" />
                                <col className="w-20" />
                                <col className="w-20" />
                                <col className="w-16" />
                                {CHECKLIST_KEYS.map(k => <col key={k} className="w-20" />)}
                                <col className="w-24" />
                            </colgroup>
                            <thead>
                                <tr>
                                    <th rowSpan={2} className="sticky top-0 z-20 bg-[#FAFBFC] border-b border-[#E4E7EC]"></th>
                                    <th rowSpan={2} className="sticky top-0 z-20 bg-[#FAFBFC] border-b border-[#E4E7EC] px-3 py-2 text-[12px] font-semibold text-[#667085]">상담번호</th>
                                    <th rowSpan={2} className="sticky top-0 z-20 bg-[#FAFBFC] border-b border-[#E4E7EC] px-3 py-2 text-[12px] font-semibold text-[#667085]">상담일시</th>
                                    <th rowSpan={2} className="sticky top-0 z-20 bg-[#FAFBFC] border-b border-[#E4E7EC] px-3 py-2 text-[12px] font-semibold text-[#667085]">직무</th>
                                    <th rowSpan={2} className="sticky top-0 z-20 bg-[#FAFBFC] border-b border-[#E4E7EC] px-3 py-2 text-[12px] font-semibold text-[#667085]">상담시간</th>
                                    <th rowSpan={2} className="sticky top-0 z-20 bg-[#FAFBFC] border-b border-[#E4E7EC] px-2 py-2 text-[12px] font-semibold text-[#667085] text-right">합계</th>
                                    <th colSpan={CHECKLIST_KEYS.length} className="sticky top-0 z-20 bg-[#FAFBFC] border-b border-[#F2F4F7] px-1.5 py-1.5 text-[12px] font-semibold text-[#98A2B3] text-center">평가 항목</th>
                                    <th rowSpan={2} className="sticky top-0 z-20 bg-[#FAFBFC] border-b border-[#E4E7EC] px-3 py-2 text-[12px] font-semibold text-[#667085] text-center">검수상태</th>
                                </tr>
                                <tr>
                                    {CHECKLIST_KEYS.map(key => (
                                        <th
                                            key={key}
                                            className="sticky top-[28px] z-20 bg-[#FAFBFC] border-b border-[#E4E7EC] px-1 py-1.5 text-[12px] font-semibold text-[#667085] text-center"
                                        >
                                            {key}
                                        </th>
                                    ))}
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-[#F2F4F7]">
                                {isLoading ? (
                                    <tr>
                                        <td colSpan={7 + CHECKLIST_KEYS.length} className="py-20 text-center text-[#98A2B3] text-[13px]">
                                            데이터를 불러오는 중입니다...
                                        </td>
                                    </tr>
                                ) : filteredCalls.length === 0 ? (
                                    <tr>
                                        <td colSpan={7 + CHECKLIST_KEYS.length} className="py-20 text-center">
                                            <div className="flex flex-col items-center gap-2 text-[#98A2B3]">
                                                <FileX size={40} strokeWidth={1.5} className="opacity-60" />
                                                <p className="text-[13px]">조회 결과가 없습니다.</p>
                                            </div>
                                        </td>
                                    </tr>
                                ) : pagedCalls.map((row) => {
                                    const yn = row.checklist_yn_kor || {};
                                    return (
                                        <tr key={row.qa_id} className="hover:bg-[#FAFBFC] transition-colors group">
                                            <td className="text-center py-3">
                                                <button
                                                    onClick={() => onOpenDetail(row.qa_id)}
                                                    className="w-7 h-7 rounded-md inline-flex items-center justify-center text-[#98A2B3] hover:bg-[#055AAF] hover:text-white transition-all"
                                                >
                                                    <ChevronRight size={16} />
                                                </button>
                                            </td>
                                            <td className="px-3 py-3 font-mono text-[12px] text-[#475467]">
                                                <div className="flex items-center gap-1.5">
                                                    <span>{row.call_no || '-'}</span>
                                                    {row.manual_review && (
                                                        <span
                                                            title={Array.isArray(row.manual_review_reasons) ? row.manual_review_reasons.join(', ') : ''}
                                                            className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold bg-[#FFFAEB] text-[#B54708] border border-[#FEDF89] whitespace-nowrap"
                                                        >
                                                            수기평가
                                                        </span>
                                                    )}
                                                </div>
                                            </td>
                                            <td className="px-3 py-3 text-[13px] text-[#475467]">{formatDateTime(row.call_datetime)}</td>
                                            <td className="px-3 py-3 text-[13px] text-[#475467]">{row.role || '-'}</td>
                                            <td className="px-3 py-3 text-[13px] text-[#475467]">{formatDuration(row.duration_sec)}</td>
                                            <td className="px-2 py-3 text-right text-[14px] font-semibold text-[#101828] tabular-nums">
                                                {(department === '고객지원실' || dynamic || brandConfig.key === 'default')
                                                    ? labelEarnedOverDefaultMax(row.total_score, row.total_max || rubricTotalMax || DEFAULT_TOTAL_MAX)
                                                    : labelEarnedOverMax(row.total_score)}
                                            </td>
                                            {CHECKLIST_KEYS.map((key) => {
                                                const { text } = categoryCell(yn[key], key, CATEGORY_MAX_POINTS);
                                                const empty = text === '-';
                                                return (
                                                    <td key={key} className="px-1 py-3 text-center">
                                                        <span
                                                            className={`inline-flex items-center justify-center min-w-[30px] px-2 py-0.5 rounded-full text-[12px] font-semibold tabular-nums ${empty ? 'bg-[#F9FAFB] text-[#98A2B3]' : 'bg-[#F2F4F7] text-[#101828]'}`}
                                                        >
                                                            {text}
                                                        </span>
                                                    </td>
                                                );
                                            })}
                                            <td className="px-3 py-3 text-center">
                                                <ReviewStatusBadge
                                                    status={deriveReviewStatus(row)}
                                                    title={reviewTooltip(row)}
                                                />
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    ) : (
                        <table className="w-full border-collapse table-fixed text-left">
                            <colgroup>
                                <col className="w-12" />
                                <col className="w-28" />
                                <col className="w-48" />
                                <col className="w-24" />
                                <col className="w-24" />
                                <col className="w-24" />
                                <col className="w-24" />
                            </colgroup>
                            <thead>
                                <tr>
                                    <th className="sticky top-0 z-20 bg-[#FAFBFC] border-b border-[#E4E7EC]"></th>
                                    <th className="sticky top-0 z-20 bg-[#FAFBFC] border-b border-[#E4E7EC] px-3 py-2 text-[12px] font-semibold text-[#667085]">상담번호</th>
                                    <th className="sticky top-0 z-20 bg-[#FAFBFC] border-b border-[#E4E7EC] px-3 py-2 text-[12px] font-semibold text-[#667085]">상담일시</th>
                                    <th className="sticky top-0 z-20 bg-[#FAFBFC] border-b border-[#E4E7EC] px-3 py-2 text-[12px] font-semibold text-[#667085]">VOC</th>
                                    <th className="sticky top-0 z-20 bg-[#FAFBFC] border-b border-[#E4E7EC] px-3 py-2 text-[12px] font-semibold text-[#667085]">판촉</th>
                                    <th className="sticky top-0 z-20 bg-[#FAFBFC] border-b border-[#E4E7EC] px-3 py-2 text-[12px] font-semibold text-[#667085] text-right">합계</th>
                                    <th className="sticky top-0 z-20 bg-[#FAFBFC] border-b border-[#E4E7EC] px-3 py-2 text-[12px] font-semibold text-[#667085] text-right">미충족</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-[#F2F4F7]">
                                {isLoading ? (
                                    <tr>
                                        <td colSpan={7} className="py-20 text-center text-[#98A2B3] text-[13px]">
                                            데이터를 불러오는 중입니다...
                                        </td>
                                    </tr>
                                ) : filteredCalls.length === 0 ? (
                                    <tr>
                                        <td colSpan={7} className="py-20 text-center">
                                            <div className="flex flex-col items-center gap-2 text-[#98A2B3]">
                                                <FileX size={40} strokeWidth={1.5} className="opacity-60" />
                                                <p className="text-[13px]">조회 결과가 없습니다.</p>
                                            </div>
                                        </td>
                                    </tr>
                                ) : pagedCalls.map((row) => {
                                    const violations = Number(row.consumer_violations);
                                    const total = Number(row.consumer_total) || CONSUMER_TOTAL_MAX;
                                    const earned = Number.isFinite(violations)
                                        ? Math.max(0, total - violations)
                                        : null;
                                    return (
                                        <tr key={row.qa_id} className="hover:bg-[#FAFBFC] transition-colors group">
                                            <td className="text-center py-3">
                                                <button
                                                    onClick={() => onOpenDetail(row.qa_id)}
                                                    className="w-7 h-7 rounded-md inline-flex items-center justify-center text-[#98A2B3] hover:bg-[#055AAF] hover:text-white transition-all"
                                                >
                                                    <ChevronRight size={16} />
                                                </button>
                                            </td>
                                            <td className="px-3 py-3 font-mono text-[12px] text-[#475467]">
                                                <div className="flex items-center gap-1.5">
                                                    <span>{row.call_no || '-'}</span>
                                                    {row.manual_review && (
                                                        <span
                                                            title={Array.isArray(row.manual_review_reasons) ? row.manual_review_reasons.join(', ') : ''}
                                                            className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold bg-[#FFFAEB] text-[#B54708] border border-[#FEDF89] whitespace-nowrap"
                                                        >
                                                            수기평가
                                                        </span>
                                                    )}
                                                </div>
                                            </td>
                                            <td className="px-3 py-3 text-[13px] text-[#475467]">{formatDateTime(row.call_datetime)}</td>
                                            <td className="px-3 py-3 text-[13px] text-[#475467]">{row.voc_code || '-'}</td>
                                            <td className="px-3 py-3 text-[13px] text-[#475467]">{row.promotion_code || '-'}</td>
                                            <td className="px-3 py-3 text-right text-[14px] font-semibold text-[#101828] tabular-nums">
                                                {earned === null ? '-' : `${earned}/${total}`}
                                            </td>
                                            <td className="px-3 py-3 text-right">
                                                <span
                                                    className={`inline-flex items-center justify-center min-w-[40px] px-2.5 py-0.5 rounded-full text-[12px] font-semibold tabular-nums ${
                                                        Number.isFinite(violations) && violations > 0
                                                            ? 'bg-[#FFFAEB] text-[#B54708]'
                                                            : 'bg-[#F9FAFB] text-[#98A2B3]'
                                                    }`}
                                                >
                                                    {Number.isFinite(violations) ? `${violations}건` : '-'}
                                                </span>
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    )}
                </div>
                <div className="px-5 py-3 border-t border-[#F2F4F7] bg-[#FAFBFC] flex items-center justify-between gap-4 text-[12px] text-[#667085]">
                    <span className="shrink-0">{department} · 총 <strong className="text-[#101828] font-semibold">{filteredCalls.length}</strong> 건</span>

                    {/* 페이지 네비게이션 — 10건 초과 시에만 노출 */}
                    {pageCount > 1 && (
                        <div className="flex items-center gap-1">
                            <button
                                type="button"
                                onClick={() => setPage((p) => Math.max(0, p - 1))}
                                disabled={safePage === 0}
                                className="w-7 h-7 inline-flex items-center justify-center rounded-md border border-[#D0D5DD] bg-white text-[#475467] hover:bg-[#F2F4F7] disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                                aria-label="이전 페이지"
                            >
                                <ChevronRight size={14} className="rotate-180" />
                            </button>
                            {buildPages(safePage, pageCount).map((p, i) =>
                                p === '…' ? (
                                    <span key={`gap-${i}`} className="w-7 h-7 inline-flex items-center justify-center text-[#98A2B3]">…</span>
                                ) : (
                                    <button
                                        key={p}
                                        type="button"
                                        onClick={() => setPage(p)}
                                        className={`min-w-[28px] h-7 px-2 inline-flex items-center justify-center rounded-md border text-[12px] font-semibold transition-colors ${
                                            p === safePage
                                                ? 'border-[#055AAF] bg-[#055AAF] text-white'
                                                : 'border-[#D0D5DD] bg-white text-[#475467] hover:bg-[#F2F4F7]'
                                        }`}
                                        aria-current={p === safePage ? 'page' : undefined}
                                    >
                                        {p + 1}
                                    </button>
                                )
                            )}
                            <button
                                type="button"
                                onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))}
                                disabled={safePage === pageCount - 1}
                                className="w-7 h-7 inline-flex items-center justify-center rounded-md border border-[#D0D5DD] bg-white text-[#475467] hover:bg-[#F2F4F7] disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                                aria-label="다음 페이지"
                            >
                                <ChevronRight size={14} />
                            </button>
                        </div>
                    )}

                    <span className="shrink-0">전체 녹취 데이터 실시간 분석 현황</span>
                </div>
            </div>

            {/* AI 자동 평가 인사이트 — 좌: 코칭 액션, 우: 자동 플래그
                추후 상세 로직 확정 후 재활성화. 비활성 동안 import 도 함께 주석 처리됨. */}
            {/*
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mt-6">
                <CoachingActionPanel calls={filteredCalls} department={department} />
                <AutoFlagPanel
                    calls={filteredCalls}
                    department={department}
                    onOpenDetail={onOpenDetail}
                />
            </div>
            */}
        </div>
    );
};

export default Dashboard;
