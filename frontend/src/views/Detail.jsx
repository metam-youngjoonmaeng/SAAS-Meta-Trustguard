import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import {
    fetchAnalysis,
    fetchEvaluations,
    saveAdminComments,
    saveConsumerYnPatches,
    fetchGoldenSet,
    addGoldenSet,
    removeGoldenSet,
    updateReviewStatus,
    saveManualEvaluationPatches,
    fetchReviewEvents,
} from '../services/api';
import RadarChart from '../components/Detail/RadarChart';
import ConsumerEvalTable from '../components/Detail/ConsumerEvalTable';
import ConsumerAnalysisPanel from '../components/Detail/ConsumerAnalysisPanel';
import ManualJudgmentCell from '../components/Detail/ManualJudgmentCell';
import ReviewActionBar from '../components/Detail/ReviewActionBar';
import ReviewStatusBadge, {
    REVIEW_STATUS,
    deriveReviewStatus,
} from '../components/ReviewStatusBadge';
import { DEFAULT_TOTAL_MAX, getBrandConfig, isDynamicChecklistBrand } from '../constants';
import useDefaultRubricMax from '../hooks/useDefaultRubricMax';
import { formatDateTime, formatDuration, formatTime } from '../utils/formatters';
import {
    formatEarnedOverMax,
    parseMaxPointsFromValidationTime,
    parseStoredEarned,
} from '../utils/rubricScore';
import { ArrowLeft, MessageSquare, ListCheck, BarChart3, X, Star } from 'lucide-react';

/** 검수상태 배지 호버 툴팁 — 검토요청·최종승인일 때 검수자/검토(승인)일시 노출. 평가리스트와 동일 규칙. */
function reviewTooltip(call, status) {
    if (status !== REVIEW_STATUS.REVIEW_DONE && status !== REVIEW_STATUS.APPROVED) return undefined;
    const who = call?.reviewed_by ? String(call.reviewed_by).trim() : '';
    const when = call?.reviewed_at ? formatDateTime(call.reviewed_at) : '';
    const parts = [];
    if (who) parts.push(`검수자: ${who}`);
    if (when) parts.push(`${status === REVIEW_STATUS.APPROVED ? '승인' : '검토'}: ${when}`);
    if (!parts.length) return '검수자·검토일시 기록 없음';
    return parts.join('\n');
}

const Detail = ({ qaId, onBack, calls, onEvaluationsSaved, activeBrandId, role }) => {
    // 골드셋 등록/해제는 관리자(admin/super_admin)만. 상담사는 버튼 미노출(서버도 403).
    const canManageGold = role === 'admin' || role === 'super_admin';
    // 브랜드별 Pentagon 라벨/키 lookup. 신한=컬렉션 5축, 한화=고객센터 5축.
    // (사용자 생성 트랙 축은 analysis 로드 후 아래에서 카테고리명으로 재도출 — PENTAGON_KEYS/LABELS)
    const brandConfig = useMemo(() => getBrandConfig(activeBrandId), [activeBrandId]);
    const [analysis, setAnalysis] = useState(null);
    const [evaluation, setEvaluation] = useState(null);
    const [isLoading, setIsLoading] = useState(true);
    const [rightView, setRightView] = useState('analysis'); // 'analysis' or 'stt'
    const [highlightText, setHighlightText] = useState('');
    const [commentDraft, setCommentDraft] = useState('');
    const [adminComments, setAdminComments] = useState([]);
    const [selectedCommentIdx, setSelectedCommentIdx] = useState(null);
    const [isCommentSaving, setIsCommentSaving] = useState(false);
    const [commentSaveError, setCommentSaveError] = useState('');
    // 수기평가: AI평가 대비 상대 판단 + (동일일 때만) 골드셋 등록 여부.
    // shape: { [row_key]: { judgment: '낮음'|'동일'|'높음'|'', goldSet: boolean } }
    // judgment 는 기존 qa_evaluation_rows.manual_eval(double) 에 숫자 인코딩으로 영속 —
    // 서버 PUT /api/evaluations 가 동일→ai / 높음→ai+0.5 / 낮음→ai-0.5 로 변환 저장
    // (신규 테이블/컬럼 없음), goldSet 은 qa_golden_set.
    const [manualJudgments, setManualJudgments] = useState({});
    // 서버에서 받아온 (이 콜에 대한) 골든셋 행 목록 — order_no 만 사용해 시드에 머지.
    const [goldenEntries, setGoldenEntries] = useState([]);
    const [consumerRows, setConsumerRows] = useState([]);
    const [consumerSaveUi, setConsumerSaveUi] = useState({ status: 'idle', message: '' });
    const consumerDebounceRef = useRef(null);
    const consumerSaveGenRef = useRef(0);

    const call = useMemo(() => calls.find(c => c.qa_id === qaId) || {}, [calls, qaId]);
    const department = useMemo(
        () => evaluation?.department || call.department || '컬렉션관리부',
        [evaluation, call]
    );
    const isConsumer = department === '소비자보호부';
    // 고객지원실(코오롱 등 기본 브랜드) 콜은 합계를 원점수 "X / 80" 으로 표기. 그 외 부서는 기존 100점 만점 유지.
    const isDefaultDept = department === '고객지원실';
    // 레거시(신한1/한화2/코오롱3)=정적 체크리스트, 신규 브랜드(id≥4)=DB 기반 동적.
    const dynamic = isDynamicChecklistBrand(activeBrandId);
    // 만점(분모)을 EvalItems 탭 편집 DB(eval_item_defs '기본')에서 라이브 조회 — 미적재 시 정적 폴백.
    const { maxByOrderNo: rubricMaxByOrderNo, effectiveTemplate, totalMax: rubricTotalMax } = useDefaultRubricMax({
        enabled: isDefaultDept || dynamic,
        fallbackTemplate: brandConfig.checklistTemplate,
        dynamicList: dynamic,
    });
    // 표시용 체크리스트: 신규 브랜드는 DB 기반(effectiveTemplate), 레거시는 정적 템플릿.
    const checklistTemplate = dynamic ? (effectiveTemplate || []) : brandConfig.checklistTemplate;
    // Pentagon 축은 브랜드 설정의 정적 5축 고정 (동적 N축 미사용).
    const PENTAGON_KEYS = brandConfig.radarKeys;
    const PENTAGON_LABELS = brandConfig.radarLabels;

    // 뒤로가기 시 Dashboard 가 이 콜의 부서 탭을 복원할 수 있도록 sessionStorage 에 기록.
    // (Dashboard.jsx 의 DASHBOARD_DEPT_STORAGE_KEY 와 동일 키.)
    useEffect(() => {
        if (typeof window === 'undefined') return;
        if (!department) return;
        window.sessionStorage.setItem('qa_dashboard_active_department', department);
    }, [department]);

    useEffect(() => {
        async function loadDetail() {
            if (!qaId) return;
            setIsLoading(true);
            try {
                const [aData, eData, gData] = await Promise.all([
                    fetchAnalysis(qaId),
                    fetchEvaluations(qaId),
                    fetchGoldenSet(qaId).catch(() => ({ entries: [] })),
                ]);
                setAnalysis(aData);
                setEvaluation(eData);
                setAdminComments((eData?.admin_comments || []).slice().sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0)));
                setConsumerRows(Array.isArray(eData?.consumer_eval_rows) ? eData.consumer_eval_rows : []);
                setGoldenEntries(Array.isArray(gData?.entries) ? gData.entries : []);
                setSelectedCommentIdx(null);
                setCommentDraft('');
                setCommentSaveError('');
            } catch (err) {
                console.error("Detail 로딩 중 오류:", err);
            } finally {
                setIsLoading(false);
            }
        }
        loadDetail();
    }, [qaId]);

    const persistConsumerPatch = useCallback(
        async (patch) => {
            if (!qaId) return;
            const g = ++consumerSaveGenRef.current;
            setConsumerSaveUi({ status: 'saving', message: '' });
            try {
                await saveConsumerYnPatches(qaId, [patch]);
                if (g !== consumerSaveGenRef.current) return;
                setConsumerSaveUi({ status: 'saved', message: '' });
                onEvaluationsSaved?.();
            } catch (err) {
                if (g !== consumerSaveGenRef.current) return;
                setConsumerSaveUi({
                    status: 'error',
                    message: err?.message || '저장 실패',
                });
            }
        },
        [qaId, onEvaluationsSaved]
    );

    useEffect(() => {
        if (consumerSaveUi.status !== 'saved') return undefined;
        const t = window.setTimeout(() => setConsumerSaveUi({ status: 'idle', message: '' }), 2000);
        return () => window.clearTimeout(t);
    }, [consumerSaveUi.status]);

    // 검수상태 — 서버가 SSOT. 토글 직후 낙관적으로 로컬 override 를 유지하다가
    // onEvaluationsSaved 가 calls 를 새로고침하면 prop 으로 다시 흘러들어옴.
    const [reviewStatusOverride, setReviewStatusOverride] = useState(null);
    const [isReviewStatusSaving, setIsReviewStatusSaving] = useState(false);
    // 검수상태 자동 전이 가드 — 판단(낮음/동일/높음) 클릭이 있어야만 상태 PUT.
    // 페이지 열람/judgment 시드만으로는 서버 상태를 건드리지 않는다.
    const reviewTouchedRef = useRef(false);
    // PUT 실패한 목표 상태 기억 — 같은 상태로 무한 재시도 방지 (다음 클릭에서 해제).
    const reviewSyncFailedRef = useRef(null);
    useEffect(() => {
        setReviewStatusOverride(null);
        reviewTouchedRef.current = false;
        reviewSyncFailedRef.current = null;
    }, [qaId]);
    const currentReviewStatus = reviewStatusOverride ?? deriveReviewStatus(call);

    // 검수 이력(타임라인) — 상태 변경마다 재로딩.
    const [reviewEvents, setReviewEvents] = useState([]);
    const reloadReviewEvents = useCallback(() => {
        if (!qaId) return;
        fetchReviewEvents(qaId).then((rows) => setReviewEvents(Array.isArray(rows) ? rows : [])).catch(() => {});
    }, [qaId]);
    useEffect(() => { reloadReviewEvents(); }, [reloadReviewEvents]);

    const handleReviewStatusChange = useCallback(
        async (nextStatus, { force = false, alertOnError = false, reason } = {}) => {
            if (!qaId || isReviewStatusSaving) return;
            const prev = currentReviewStatus;
            setReviewStatusOverride(nextStatus);
            setIsReviewStatusSaving(true);
            try {
                await updateReviewStatus(qaId, nextStatus, { force, reason });
                onEvaluationsSaved?.();
                reloadReviewEvents();
                return true;
            } catch (err) {
                console.error('updateReviewStatus failed:', err);
                setReviewStatusOverride(prev);
                if (alertOnError) {
                    let m = err?.message || '';
                    try { m = JSON.parse(err.message)?.message || m; } catch { /* noop */ }
                    alert(m || '상태 변경에 실패했습니다.');
                }
                return false;
            } finally {
                setIsReviewStatusSaving(false);
            }
        },
        [qaId, currentReviewStatus, isReviewStatusSaving, onEvaluationsSaved, reloadReviewEvents]
    );

    // 관리자 수정분(상담사 마지막 제출 counselor_eval 대비 현재 manual_eval) — 상담사 확인 배너용.
    const revisedItems = useMemo(() => {
        const rows = evaluation?.evaluation_rows || [];
        return rows
            .filter((r) => r.counselor_eval != null && r.manual_eval != null && Number(r.manual_eval) !== Number(r.counselor_eval))
            .map((r) => ({ order_no: r.order_no, item: r.item, from: r.counselor_eval, to: r.manual_eval }));
    }, [evaluation]);

    const handleConsumerYnChange = useCallback(
        (itemNo, nextYn) => {
            const yn = String(nextYn || '').toUpperCase();
            if (yn !== 'Y' && yn !== 'N') return;
            setConsumerRows((prev) => {
                const next = prev.map((r) =>
                    Number(r.item_no) === Number(itemNo)
                        ? { ...r, yn, ...(yn === 'Y' ? { detail_text: '' } : {}) }
                        : r
                );
                return next;
            });
            if (consumerDebounceRef.current) window.clearTimeout(consumerDebounceRef.current);
            consumerDebounceRef.current = window.setTimeout(() => {
                persistConsumerPatch({ item_no: Number(itemNo), yn, ...(yn === 'Y' ? { detail_text: '' } : {}) });
            }, 350);
        },
        [persistConsumerPatch]
    );

    const handleConsumerDetailChange = useCallback(
        (itemNo, nextDetail) => {
            setConsumerRows((prev) =>
                prev.map((r) =>
                    Number(r.item_no) === Number(itemNo)
                        ? { ...r, detail_text: nextDetail }
                        : r
                )
            );
            if (consumerDebounceRef.current) window.clearTimeout(consumerDebounceRef.current);
            consumerDebounceRef.current = window.setTimeout(() => {
                const target = (consumerRows || []).find((r) => Number(r.item_no) === Number(itemNo));
                const yn = target ? String(target.yn || '').toUpperCase() : 'N';
                persistConsumerPatch({ item_no: Number(itemNo), yn: yn === 'Y' ? 'Y' : 'N', detail_text: nextDetail });
            }, 750);
        },
        [persistConsumerPatch, consumerRows]
    );

    useEffect(() => {
        return () => {
            if (consumerDebounceRef.current) window.clearTimeout(consumerDebounceRef.current);
        };
    }, []);

    const handleJumpToTurn = useCallback(
        (lineNo) => {
            const turn = Number(lineNo);
            if (!Number.isFinite(turn) || turn < 1) return;
            const list = evaluation?.conversation || [];
            const found = list.find((c) => Number(c.turn_no) === turn);
            const text = found?.text || '';
            setHighlightText(text);
            setRightView('stt');
        },
        [evaluation]
    );

    const teamData = useMemo(() => {
        const td = analysis?.pentagon?.team_avg || {};
        return PENTAGON_KEYS.map(k => Number(td[k] || 0));
    }, [analysis, PENTAGON_KEYS]);

    const agentData = useMemo(() => {
        const ad = analysis?.pentagon?.agent_score || {};
        return PENTAGON_KEYS.map(k => Number(ad[k] || 0));
    }, [analysis, PENTAGON_KEYS]);

    const overallData = useMemo(() => {
        const od = analysis?.pentagon?.overall_avg || {};
        if (od && typeof od === 'object') {
            return PENTAGON_KEYS.map(k => Number(od[k] || 0));
        }
        return PENTAGON_KEYS.map(() => 0);
    }, [analysis, PENTAGON_KEYS]);

    const reportMap = useMemo(() => {
        const src = analysis?.report;
        if (Array.isArray(src)) {
            const byItem = {};
            src.forEach((row) => {
                const itemType = String(row?.item_type || '').trim();
                if (!itemType) return;
                const comment = String(row?.comment || '').trim();
                const rating = String(row?.rating || '').trim();
                byItem[itemType] = rating ? `[${rating}] ${comment}` : comment;
            });
            return byItem;
        }
        if (src && typeof src === 'object') {
            return src;
        }
        return {};
    }, [analysis]);

    const reportScore = useMemo(() => {
        const total = Number(call?.total_score);
        if (!Number.isNaN(total)) {
            return Math.max(0, Math.min(100, total));
        }
        const aiScore = Number(call?.ai_score);
        if (!Number.isNaN(aiScore)) {
            return Math.max(0, Math.min(100, aiScore));
        }
        const nums = agentData.map((v) => Number(v)).filter((v) => !Number.isNaN(v));
        if (!nums.length) return 0;
        const avg = nums.reduce((sum, v) => sum + v, 0) / nums.length;
        return Math.round(avg * 10) / 10;
    }, [call, agentData]);

    const reportSummary = useMemo(() => {
        if (typeof reportMap.summary === 'string' && reportMap.summary.trim()) {
            return reportMap.summary.trim();
        }
        const aiScore = Number(call?.ai_score);
        if (!Number.isNaN(aiScore)) {
            if (aiScore >= 90) return '전반적으로 우수한 상담 품질을 보이며, 현재 강점을 유지하는 것이 중요합니다.';
            if (aiScore >= 80) return '기본 절차는 양호하며, 경청·공감 응대와 사후 처리 구간을 보완하면 더 안정적입니다.';
            if (aiScore >= 70) return '인사·본인확인은 수행되었으나 경청·공감 응대와 업무 정확도 보강이 필요합니다.';
            return '인사·본인확인·경청·공감 응대·업무 정확도·사후 처리 전반에 걸쳐 우선 개선이 필요합니다.';
        }
        return '전반적인 상담 품질 개선이 필요합니다.';
    }, [reportMap, call]);

    const checklistRows = useMemo(() => {
        const checklistRowsRaw = evaluation?.checklist_rows || [];
        const evaluationRowsRaw = evaluation?.evaluation_rows || [];

        const normalize = (value) =>
            String(value || '')
                .replace(/\s+/g, '')
                .replace(/[^\p{L}\p{N}]/gu, '')
                .toLowerCase();

        const evaluationByCategory = new Map();
        const checklistByCategory = new Map();

        evaluationRowsRaw.forEach((row) => {
            const key = row.category || '';
            if (!evaluationByCategory.has(key)) evaluationByCategory.set(key, []);
            evaluationByCategory.get(key).push(row);
        });

        checklistRowsRaw.forEach((row) => {
            const key = row.category || '';
            if (!checklistByCategory.has(key)) checklistByCategory.set(key, []);
            checklistByCategory.get(key).push(row);
        });

        const findBestRow = (rows, category, item) => {
            if (!rows || rows.length === 0) return null;
            const target = normalize(item);
            const exact = rows.find((r) => normalize(r.item) === target);
            if (exact) return exact;
            const contains = rows.find((r) => {
                const src = normalize(r.item);
                return src.includes(target) || target.includes(src);
            });
            return contains || rows.find((r) => r.category === category) || rows[0];
        };

        const formatPercent = (value) => {
            if (value === null || value === undefined || value === '') return '-';
            const num = Number(value);
            if (Number.isNaN(num)) return '-';
            return `${num}%`;
        };

        return checklistTemplate.map((base) => {
            const evalRow = findBestRow(evaluationByCategory.get(base.category), base.category, base.item) || {};
            const checklistRow = findBestRow(checklistByCategory.get(base.category), base.category, base.item) || {};
            const templateIdx = checklistTemplate.findIndex(
                (t) => t.category === base.category && t.item === base.item
            );
            const orderNoRaw = checklistRow.order_no;
            const orderNo =
                orderNoRaw !== undefined && orderNoRaw !== null && orderNoRaw !== ''
                    ? Number(orderNoRaw)
                    : templateIdx >= 0
                      ? templateIdx + 1
                      : 0;
            const customerText = checklistRow.customer_utterance || '';
            const agentText = checklistRow.agent_utterance || '';
            const utterance = agentText || '-';
            // 항목 만점: DB(eval_item_defs '기본') order_no 매칭 우선, 없으면 정적 템플릿 폴백.
            const dbMaxPts = rubricMaxByOrderNo[orderNo];
            const maxPts =
                Number.isFinite(dbMaxPts) && dbMaxPts > 0
                    ? dbMaxPts
                    : parseMaxPointsFromValidationTime(base.validation_time);
            const aiEvalRaw = evalRow.ai_eval;
            let earnedAi = null;
            if (aiEvalRaw !== null && aiEvalRaw !== undefined && aiEvalRaw !== '') {
                const n = Number(aiEvalRaw);
                if (Number.isFinite(n)) earnedAi = Math.max(0, Math.min(maxPts, n));
            }
            const aiEvalLabel = earnedAi === null ? '-' : formatEarnedOverMax(earnedAi, maxPts);
            const manRaw = evalRow.manual_eval_option ?? evalRow.manual_eval;
            const manStr = manRaw === null || manRaw === undefined ? '' : String(manRaw).trim();
            const earnedMan = manStr === '' ? null : parseStoredEarned(manStr, maxPts, base.item);
            const manualEvalLabel =
                manStr === '평가제외'
                    ? '평가제외'
                    : earnedMan === null
                      ? '-'
                      : formatEarnedOverMax(earnedMan, maxPts);

            return {
                ...base,
                order_no: orderNo,
                row_key: `${base.category}__${base.item}`,
                reason_text: evalRow.reason_text || '-',
                utterance: utterance || '-',
                customer_utterance: customerText, // For modal matching
                agent_utterance: agentText,       // For modal matching
                rubric_max_pts: maxPts,
                manual_eval_raw: manStr,
                earned_ai: earnedAi,
                earned_manual: earnedMan,
                ai_eval_label: aiEvalLabel,
                manual_eval_label: manualEvalLabel,
                match_rate: formatPercent(evalRow.match_rate),
                monthly_avg: formatPercent(evalRow.monthly_avg),
                team_avg: formatPercent(evalRow.team_avg),
            };
        });
    }, [evaluation, brandConfig, checklistTemplate, rubricMaxByOrderNo]);

    // 점수 헤더 표기 — 고객지원실은 원점수 "X / N점", 그 외는 기존 "X점 / 100점".
    // 분모 = 이 콜의 checklistRows.rubric_max_pts 합(평가-시점 만점 동결) — 0이면 DEFAULT_TOTAL_MAX 폴백.
    // 옛 콜: 카탈로그 배점 합(80)으로 동결, 루브릭 평가 콜: ev.max_score 합(예: 78)으로 동결.
    // NOTE: 반드시 checklistRows 선언 뒤에 위치 — 앞에 두면 const TDZ ReferenceError 로
    // Detail 전체가 흰 화면 (2026-06-11 수정).
    const callTotalMax = useMemo(
        () => checklistRows.reduce((s, r) => s + (Number(r.rubric_max_pts) || 0), 0)
            || (dynamic ? Number(rubricTotalMax) || 0 : 0)
            || DEFAULT_TOTAL_MAX,
        [checklistRows, dynamic, rubricTotalMax]
    );
    const reportScoreLabel = useMemo(() => {
        // 저장값 = 획득점 합계 원점수 — 환산 없이 "X / 만점" 그대로 표기.
        // 고객지원실(코오롱) + 사용자 생성 트랙(동적)은 원점수 표기, 표준 신한/한화만 100점 환산.
        if (isDefaultDept || dynamic) {
            return `${reportScore} / ${callTotalMax}점`;
        }
        return `${reportScore}점 / 100점`;
    }, [isDefaultDept, dynamic, reportScore, callTotalMax]);

    // 새 수기평가 모델(낮음/동일/높음 + 골드셋)을 위한 setter.
    // 판단이 '동일' 에서 벗어나면 골드셋은 자동 해제 + DB 에서도 즉시 삭제.
    const setJudgment = useCallback(
        async (rowKey, orderNo, judgment) => {
            // 검수상태 자동 전이 트리거 — 첫 판단 입력 즉시 '검수중', 전 항목 입력 시 '완료'.
            // 실제 동기화는 reviewProgress 를 보는 useEffect 가 담당.
            reviewTouchedRef.current = true;
            reviewSyncFailedRef.current = null;
            let wasGoldBefore = false;
            let prevEntry;
            setManualJudgments((prev) => {
                const cur = prev[rowKey] || { judgment: '', goldSet: false };
                prevEntry = cur;
                wasGoldBefore = cur.judgment === '동일' && cur.goldSet === true;
                return {
                    ...prev,
                    [rowKey]: {
                        judgment,
                        goldSet: judgment === '동일' ? cur.goldSet : false,
                    },
                };
            });
            // 판단 영속화 — 기존 수기평가 저장 경로 재사용 (manual_eval 에 라벨 저장).
            // 실패 시 로컬 판단 롤백 + 골든셋 자동 해제도 중단.
            try {
                await saveManualEvaluationPatches(qaId, [
                    { order_no: orderNo, manual_eval: judgment },
                ]);
            } catch (err) {
                console.error('manual judgment save failed:', err);
                setManualJudgments((prev) => ({
                    ...prev,
                    [rowKey]: prevEntry ?? { judgment: '', goldSet: false },
                }));
                return;
            }
            if (wasGoldBefore && judgment !== '동일') {
                try {
                    await removeGoldenSet(qaId, orderNo);
                } catch (err) {
                    console.error('golden-set auto-remove failed:', err);
                }
            }
        },
        [qaId]
    );

    // 골드셋 토글: 낙관적 업데이트 후 API 호출. 실패 시 직전 상태로 롤백.
    const setGoldSet = useCallback(
        async (rowKey, orderNo, goldSet) => {
            let prevSnapshot;
            setManualJudgments((prev) => {
                prevSnapshot = prev[rowKey];
                return {
                    ...prev,
                    [rowKey]: { ...(prev[rowKey] || { judgment: '동일' }), goldSet },
                };
            });
            try {
                if (goldSet) {
                    await addGoldenSet(qaId, orderNo);
                } else {
                    await removeGoldenSet(qaId, orderNo);
                }
            } catch (err) {
                console.error('golden-set toggle failed:', err);
                setManualJudgments((prev) => ({
                    ...prev,
                    [rowKey]: prevSnapshot ?? { judgment: '동일', goldSet: false },
                }));
            }
        },
        [qaId]
    );

    // 골드셋 개수 (헤더 칩에 표시)
    const goldSetCount = useMemo(
        () =>
            Object.values(manualJudgments).filter(
                (v) => v?.judgment === '동일' && v?.goldSet
            ).length,
        [manualJudgments]
    );

    // 체크리스트 검수 진행률 — 판단(낮음/동일/높음) 입력된 행 / 전체 항목.
    const reviewProgress = useMemo(() => {
        const total = checklistRows.length;
        const done = checklistRows.filter(
            (r) => !!manualJudgments[r.row_key]?.judgment
        ).length;
        const pct = total > 0 ? Math.round((done / total) * 100) : 0;
        return { total, done, pct };
    }, [checklistRows, manualJudgments]);

    // 검수상태 자동 전이 — '검수 시작'(대기→검수중)만 자동.
    //  상담사가 첫 판단을 입력하면 '검수중'으로 표시. 검토요청 '제출'은 명시 버튼(아래 액션바)으로만 —
    //  보이지 않는 자동 제출은 새로고침/리로드 race 로 멈추는 문제가 있어 제거했다(설계: 명시 검토 제출).
    //  관리자는 자동전이 없음. 검토요청/반려/이의제기/확정 상태는 자동전이 금지.
    useEffect(() => {
        if (isConsumer || role !== 'agent') return;
        if (!reviewProgress.total || isReviewStatusSaving) return;
        if (currentReviewStatus !== REVIEW_STATUS.PENDING) return;
        if (!reviewTouchedRef.current) return; // 단순 열람 보호 — 직접 입력했을 때만
        if (reviewSyncFailedRef.current === REVIEW_STATUS.IN_REVIEW) return;
        handleReviewStatusChange(REVIEW_STATUS.IN_REVIEW).then((ok) => {
            if (ok === false) reviewSyncFailedRef.current = REVIEW_STATUS.IN_REVIEW;
        });
    }, [reviewProgress, currentReviewStatus, isReviewStatusSaving, isConsumer, handleReviewStatusChange, role]);

    // 새 수기평가 모델 시드:
    // - judgment: manual_eval(double) 을 AI 대비 상대 판단으로 역산
    //   (평가제외/공란 → 미선택, =AI → 동일, >AI → 높음, <AI → 낮음).
    //   판단 저장분은 서버가 ai±0.5 로 인코딩하므로 (동일=ai 그대로) 동일 규칙으로 복원되고,
    //   레거시 수기 숫자값도 같은 규칙으로 자연 변환된다.
    //   ※ 비교는 클램프 전 원시값 — ai 가 만점일 때의 '높음'(ai+0.5), 0점일 때의
    //   '낮음'(ai-0.5) 이 클램프로 '동일' 이 되는 것을 방지.
    // - goldSet: qa_golden_set 테이블에서 해당 (qa_id, order_no) 가 있으면 true
    useEffect(() => {
        if (!checklistRows.length) {
            setManualJudgments({});
            return;
        }
        const goldByOrderNo = new Set(
            goldenEntries.map((g) => Number(g.order_no)).filter(Number.isFinite)
        );
        const seeded = {};
        checklistRows.forEach((row) => {
            const isGold = goldByOrderNo.has(Number(row.order_no));
            const mStr = String(row.manual_eval_raw || '').trim();
            if (mStr === '낮음' || mStr === '동일' || mStr === '높음') {
                seeded[row.row_key] = {
                    judgment: mStr,
                    goldSet: mStr === '동일' && isGold,
                };
                return;
            }
            if (mStr === '' || mStr === '평가제외') {
                // 골드셋 행이 존재하면 판정은 '동일' 이었던 것으로 복원.
                seeded[row.row_key] = isGold
                    ? { judgment: '동일', goldSet: true }
                    : { judgment: '', goldSet: false };
                return;
            }
            const ai = row.earned_ai;
            const manParsed = parseFloat(mStr);
            const man = Number.isFinite(manParsed) ? manParsed : row.earned_manual;
            if (ai === null || ai === undefined || man === null || man === undefined) {
                seeded[row.row_key] = isGold
                    ? { judgment: '동일', goldSet: true }
                    : { judgment: '', goldSet: false };
                return;
            }
            let judgment = '동일';
            if (man > ai) judgment = '높음';
            else if (man < ai) judgment = '낮음';
            seeded[row.row_key] = {
                judgment,
                goldSet: judgment === '동일' && isGold,
            };
        });
        setManualJudgments(seeded);
    }, [qaId, checklistRows, goldenEntries]);

    const conversationNodes = useMemo(() => {
        return (evaluation?.conversation || []).sort((a, b) => (a.turn_no || 0) - (b.turn_no || 0));
    }, [evaluation]);

    // Auto-scroll to highlighted turn when Right View switches to 'stt'
    useEffect(() => {
        if (rightView !== 'stt' || !highlightText) return;

        let cancelled = false;
        let retries = 0;
        const maxRetries = 12;

        const tryScroll = () => {
            if (cancelled) return;
            const element =
                document.getElementById('highlighted-turn') ||
                document.querySelector('[data-highlighted="true"]');

            if (element) {
                element.scrollIntoView({ behavior: 'smooth', block: 'center' });
                return;
            }

            if (retries < maxRetries) {
                retries += 1;
                setTimeout(tryScroll, 120);
            }
        };

        setTimeout(tryScroll, 120);
        return () => {
            cancelled = true;
        };
    }, [rightView, highlightText, conversationNodes]);

    const syncAdminComments = async (nextComments) => {
        setIsCommentSaving(true);
        setCommentSaveError('');
        try {
            await saveAdminComments(qaId, nextComments);
            setAdminComments(nextComments);
            return true;
        } catch (err) {
            console.error('관리자 코멘트 저장 실패:', err);
            const detail = err?.message ? ` (${err.message})` : '';
            setCommentSaveError(`코멘트 저장 중 오류가 발생했습니다${detail}`);
            return false;
        } finally {
            setIsCommentSaving(false);
        }
    };

    if (isLoading) {
        return (
            <div className="flex flex-col items-center justify-center py-40">
                <div className="w-10 h-10 border-4 border-[#055AAF]/20 border-t-[#055AAF] rounded-full animate-spin"></div>
                <p className="mt-4 font-semibold text-[#667085]">분석 데이터를 로딩 중입니다...</p>
            </div>
        );
    }

    const sttPanel = (
        <div className="bg-white rounded-[14px] border border-[#E4E7EC] shadow-[0_1px_2px_rgba(16,24,40,0.04)] flex flex-col lg:h-[884px] overflow-hidden animate-in slide-in-from-right-4 duration-500">
            <div className="px-5 py-3.5 border-b border-[#F2F4F7] bg-[#FAFBFC] flex justify-between items-center">
                <div className="flex items-center gap-2.5">
                    <MessageSquare size={16} className="text-[#475467]" />
                    <h3 className="text-[14px] font-semibold text-[#101828] tracking-tight">STT 전사</h3>
                </div>
                <button
                    onClick={() => setRightView('analysis')}
                    className="text-[#98A2B3] hover:text-[#101828] transition-colors"
                    aria-label="분석 화면으로"
                >
                    <X size={16} />
                </button>
            </div>
            <div className="flex-1 overflow-y-auto p-4 space-y-3">
                {conversationNodes.map((n, i) => {
                    const isAgent = n.speaker === '상담사';
                    const normalizedNode = (n.text || '').replace(/\s+/g, '');
                    // 평가 발화는 '\n' 구분 다중 인용 — 발화별 개별 매칭해 해당 턴 모두 하이라이트.
                    // "아"/"예"/"음" 같은 초단문 턴이 긴 인용문에 포함돼 오매칭되는 것을 막기 위해
                    // 완전 일치 외의 포함 검사에는 최소 길이 가드를 둔다.
                    const targets = (highlightText || '')
                        .split('\n')
                        .map((t) => t.replace(/\s+/g, ''))
                        .filter(Boolean);
                    const reallyMatched =
                        isAgent &&
                        Boolean(normalizedNode) &&
                        targets.some((normalizedTarget) => {
                            if (normalizedNode === normalizedTarget) return true;
                            if (normalizedTarget.length >= 4 && normalizedNode.includes(normalizedTarget)) return true;
                            if (normalizedNode.length >= 6 && normalizedTarget.includes(normalizedNode)) return true;
                            const shortTarget = normalizedTarget.slice(0, 12);
                            if (shortTarget.length >= 6 && normalizedNode.includes(shortTarget)) return true;
                            return false;
                        });
                    return (
                        <div
                            key={i}
                            id={reallyMatched ? 'highlighted-turn' : undefined}
                            data-highlighted={reallyMatched ? 'true' : undefined}
                            className={`flex flex-col ${isAgent ? 'items-start' : 'items-end'} transition-all duration-500`}
                        >
                            <div className="text-[10px] text-[#98A2B3] mb-1 font-mono tabular-nums px-1">
                                {n.speaker} · {formatTime(n.ts)}
                            </div>
                            <div
                                className={`max-w-[88%] px-3 py-2 rounded-lg text-[13px] leading-relaxed transition-all ${
                                    reallyMatched
                                        ? 'bg-[#FFFAEB] text-[#B54708] ring-2 ring-[#FEC84B]/40'
                                        : isAgent
                                          ? 'bg-[#F2F4F7] text-[#101828]'
                                          : 'bg-[#055AAF] text-white'
                                }`}
                            >
                                {n.text}
                                {reallyMatched && (
                                    <div className="mt-1.5 text-[10px] font-semibold text-[#B54708] flex items-center gap-1">
                                        <ListCheck size={10} /> 평가 해당 발화
                                    </div>
                                )}
                            </div>
                        </div>
                    );
                })}
                {conversationNodes.length === 0 && (
                    <div className="py-20 text-center text-[#98A2B3] text-[13px]">녹취록 데이터가 없습니다.</div>
                )}
            </div>
        </div>
    );

    return (
        <>
            <div className="pb-10 w-full">
                {/* 상단 제목 제거(상단바 브레드크럼이 대체) — 상담사/상담번호 + 수기평가 사유 딱지 + 목록으로 */}
                <div className="flex items-start justify-between gap-4 mb-5">
                    <div className="min-w-0">
                        <p className="text-sm text-[#667085] truncate">
                            {`${call.agent_name || '-'} 상담사 | 상담번호: ${call.call_no || '-'}`}
                        </p>
                        {(() => {
                            const reasons = evaluation?.manual_review_reasons || call.manual_review_reasons || [];
                            if (!Array.isArray(reasons) || reasons.length === 0) return null;
                            return (
                                <div className="flex flex-wrap items-center gap-1.5 mt-2">
                                    <span className="text-[11px] text-[#98A2B3]">수기평가 대상 사유</span>
                                    {reasons.map((r, i) => (
                                        <span
                                            key={i}
                                            className="inline-flex items-center px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-[#FFFAEB] text-[#B54708] border border-[#FEDF89]"
                                        >
                                            {r}
                                        </span>
                                    ))}
                                </div>
                            );
                        })()}
                    </div>
                    <button
                        onClick={onBack}
                        className="shrink-0 px-4 py-2 border border-[#D0D5DD] rounded-lg text-sm font-semibold text-[#344054] hover:bg-gray-50 flex items-center gap-2"
                    >
                        <ArrowLeft size={16} />
                        목록으로
                    </button>
                </div>

                <div className="bg-white rounded-[14px] border border-[#E4E7EC] shadow-sm overflow-x-auto mb-6">
                    <table className="w-full min-w-[1180px] border-collapse">
                        <thead>
                            <tr className="bg-[#F9FAFB] text-[10px] text-[#667085]">
                                <th className="px-2.5 py-1.5 text-center border-r border-[#EEF2F7]">상담번호</th>
                                <th className="px-2.5 py-1.5 text-center border-r border-[#EEF2F7]">상담일시</th>
                                <th className="px-2.5 py-1.5 text-center border-r border-[#EEF2F7]">상담시간</th>
                                <th className="px-2.5 py-1.5 text-center border-r border-[#EEF2F7]">부서</th>
                                <th className="px-2.5 py-1.5 text-center border-r border-[#EEF2F7]">직무</th>
                                <th className="px-2.5 py-1.5 text-center border-r border-[#EEF2F7]">상담사ID</th>
                                <th className="px-2.5 py-1.5 text-center border-r border-[#EEF2F7]">상담사명</th>
                                <th className="px-2.5 py-1.5 text-center border-r border-[#EEF2F7]">고객번호</th>
                                <th className="px-2.5 py-1.5 text-center border-r border-[#EEF2F7]">고객등급</th>
                                <th className="px-2.5 py-1.5 text-center border-r border-[#EEF2F7]">AI평가</th>
                                <th className="px-2.5 py-1.5 text-center">검수상태</th>
                            </tr>
                        </thead>
                        <tbody>
                            <tr className="text-[11px] text-[#101828]">
                                <td className="px-2.5 py-1.5 text-center border-r border-[#EEF2F7]">{call.call_no || '-'}</td>
                                <td className="px-2.5 py-1.5 text-center border-r border-[#EEF2F7]">{formatDateTime(call.call_datetime)}</td>
                                <td className="px-2.5 py-1.5 text-center border-r border-[#EEF2F7]">{formatDuration(call.duration_sec)}</td>
                                <td className="px-2.5 py-1.5 text-center border-r border-[#EEF2F7]">{call.department || department || '-'}</td>
                                <td className="px-2.5 py-1.5 text-center border-r border-[#EEF2F7]">{call.role || (isConsumer ? '전체' : '-')}</td>
                                <td className="px-2.5 py-1.5 text-center border-r border-[#EEF2F7]">{call.agent_id || '-'}</td>
                                <td className="px-2.5 py-1.5 text-center border-r border-[#EEF2F7]">{call.agent_name || '-'}</td>
                                <td className="px-2.5 py-1.5 text-center border-r border-[#EEF2F7]">{call.customer_no || '-'}</td>
                                <td className="px-2.5 py-1.5 text-center border-r border-[#EEF2F7]">{call.customer_grade || '-'}</td>
                                <td className="px-2.5 py-1.5 text-center border-r border-[#EEF2F7]">
                                    {isConsumer
                                        ? '-'
                                        : call.ai_score === null || call.ai_score === undefined || call.ai_score === ''
                                          ? '-'
                                          : isDefaultDept
                                            ? `${Math.max(0, Math.round(Number(call.ai_score) * 10) / 10)} / ${callTotalMax}`
                                            : String(Math.max(0, Math.round(Number(call.ai_score))))}
                                </td>
                                <td className="px-2.5 py-1.5 text-center">
                                    {isConsumer ? (
                                        <span className="inline-flex items-center justify-center min-w-[28px] px-2 py-0.5 rounded-full text-[12px] font-semibold bg-[#F9FAFB] text-[#98A2B3]">
                                            -
                                        </span>
                                    ) : (
                                        <ReviewStatusBadge status={currentReviewStatus} title={reviewTooltip(call, currentReviewStatus)} />
                                    )}
                                </td>
                            </tr>
                        </tbody>
                    </table>
                </div>

                {/* 검수 워크플로우 액션 바 — 스텝퍼 + 역할별 액션 + 사유/이력 팝업(새 설계). */}
                {!isConsumer && (
                    <ReviewActionBar
                        status={currentReviewStatus}
                        role={role}
                        isSaving={isReviewStatusSaving}
                        onChange={(next, opts) => handleReviewStatusChange(next, opts)}
                        reviewEvents={reviewEvents}
                        revisedItems={revisedItems}
                        progress={reviewProgress}
                    />
                )}

                {isConsumer ? (
                    <div className="flex flex-col lg:flex-row gap-6 items-stretch">
                        {/* Left Column — 소비자보호부 20항목 Y/N (고정) */}
                        <div className="lg:w-2/3 flex min-h-0 lg:h-[884px]">
                            <ConsumerEvalTable
                                rows={consumerRows}
                                onChangeYn={handleConsumerYnChange}
                                onChangeDetail={handleConsumerDetailChange}
                                saveStatus={consumerSaveUi.status}
                                onShowStt={() => {
                                    setHighlightText('');
                                    setRightView('stt');
                                }}
                                onJumpToTurn={handleJumpToTurn}
                            />
                        </div>
                        {/* Right Column — 분석대상/금칙어/12 카테고리 ↔ STT 전사 토글 */}
                        <div className="lg:w-1/3 lg:h-[884px]">
                            {rightView === 'stt' ? (
                                sttPanel
                            ) : (
                                <ConsumerAnalysisPanel
                                    meta={{ ai_analysis_target: evaluation?.ai_analysis_target }}
                                    keywords={evaluation?.consumer_keywords || []}
                                    categories={evaluation?.consumer_ai_categories || []}
                                    onJumpToTurn={handleJumpToTurn}
                                />
                            )}
                        </div>
                    </div>
                ) : (
                <div className="flex flex-col lg:flex-row gap-6 items-stretch">
                    {/* Left Column (8 units) — 체크리스트 카드 + (고객지원실) KMS 카드 stack */}
                    {/* 우측 컬럼(펜타곤 440 + gap 24 + 코멘트 420 = 884px)과 동일 높이로 고정.
                        min-h 면 높이가 확정되지 않아 안쪽 overflow-auto 가 스크롤로 잘리지 못하고
                        표 전체 높이로 늘어남 → h-[884px] 로 확정해 카드 안에서만 스크롤되게 함. */}
                    <div className="lg:w-2/3 flex flex-col gap-6 min-h-0 lg:h-[884px]">
                        {/* Main Content Tabs */}
                        <div className="bg-white rounded-[14px] border border-[#E4E7EC] shadow-[0_1px_2px_rgba(16,24,40,0.04)] flex flex-col flex-1 min-h-0 lg:h-[884px] w-full overflow-hidden">
                            <div className="px-5 py-3 border-b border-[#F2F4F7] bg-[#FAFBFC]">
                                <div className="flex justify-between items-center">
                                    <div className="flex items-center gap-2.5 min-w-0">
                                        <ListCheck size={16} className="text-[#475467] shrink-0" />
                                        <h3 className="text-[14px] font-semibold text-[#101828] tracking-tight shrink-0">상세 체크리스트</h3>
                                        {goldSetCount > 0 && (
                                            <span
                                                className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-bold whitespace-nowrap"
                                                style={{
                                                    background: '#FDF6E3',
                                                    color: '#7D5A00',
                                                    border: '1px solid #EBD58A',
                                                }}
                                            >
                                                <Star size={11} style={{ fill: '#F4C451', color: '#C8951B' }} />
                                                골드셋 {goldSetCount}
                                            </span>
                                        )}
                                    </div>
                                    <button
                                        onClick={() => {
                                            setHighlightText('');
                                            setRightView('stt');
                                        }}
                                        className="px-3 py-1.5 rounded-lg text-[11px] font-semibold text-[#475467] hover:bg-[#F9FAFB] border border-[#E4E7EC] inline-flex items-center gap-1.5 transition-colors"
                                    >
                                        <MessageSquare size={13} />
                                        STT전사
                                    </button>
                                </div>
                                {reviewProgress.total > 0 && (
                                    <div className="mt-2.5 flex items-center gap-3">
                                        <div className="flex-1 h-1.5 rounded-full bg-[#EAECF0] overflow-hidden">
                                            <div
                                                className="h-full rounded-full bg-[#055AAF] transition-[width] duration-300"
                                                style={{ width: `${reviewProgress.pct}%` }}
                                            />
                                        </div>
                                        <span className="text-[11.5px] font-semibold text-[#667085] tabular-nums shrink-0">
                                            {reviewProgress.pct}% · {reviewProgress.total}개 항목 중 {reviewProgress.done}완료
                                        </span>
                                    </div>
                                )}
                            </div>

                            <div className="flex-1 min-h-0 p-0 overflow-auto">
                                <table className="w-full h-full min-w-[1040px] text-center">
                                    <thead>
                                        <tr>
                                            <th className="sticky top-0 z-10 bg-[#FAFBFC] border-b border-[#F2F4F7] px-2.5 py-2.5 text-[12px] font-semibold text-[#667085] w-20">구분</th>
                                            <th className="sticky top-0 z-10 bg-[#FAFBFC] border-b border-[#F2F4F7] px-2.5 py-2.5 text-[12px] font-semibold text-[#667085] w-20">평가항목</th>
                                            <th className="sticky top-0 z-10 bg-[#FAFBFC] border-b border-[#F2F4F7] px-2.5 py-2.5 text-[12px] font-semibold text-[#667085] w-44 text-left">평가 이유</th>
                                            <th className="sticky top-0 z-10 bg-[#FAFBFC] border-b border-[#F2F4F7] px-2.5 py-2.5 text-[12px] font-semibold text-[#667085] w-44 text-left">평가 발화</th>
                                            <th className="sticky top-0 z-10 bg-[#FAFBFC] border-b border-[#F2F4F7] px-2.5 py-2.5 text-[12px] font-semibold text-[#667085] w-24">AI평가</th>
                                            <th className="sticky top-0 z-10 bg-[#FAFBFC] border-b border-[#F2F4F7] px-2.5 py-2.5 text-[12px] font-semibold text-[#667085] w-40">수기평가</th>
                                            <th className="sticky top-0 z-10 bg-[#FAFBFC] border-b border-[#F2F4F7] px-2.5 py-2.5 text-[12px] font-semibold text-[#667085] w-24">당월평균</th>
                                            <th className="sticky top-0 z-10 bg-[#FAFBFC] border-b border-[#F2F4F7] px-2.5 py-2.5 text-[12px] font-semibold text-[#667085] w-24">직무평균</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-[#F2F4F7]">
                                        {(() => {
                                            const categorySpans = new Map();
                                            checklistRows.forEach(r => {
                                                categorySpans.set(r.category, (categorySpans.get(r.category) || 0) + 1);
                                            });

                                            const categoryRendered = new Set();

                                            return checklistRows.map((r, i) => {
                                                const showCategory = !categoryRendered.has(r.category);
                                                if (showCategory) categoryRendered.add(r.category);

                                                return (
                                                    <tr key={i} className="hover:bg-[#FAFBFC] transition-colors group">
                                                        {showCategory && (
                                                            <td
                                                                rowSpan={categorySpans.get(r.category)}
                                                                className="px-2.5 py-2.5 align-top text-[12px] font-semibold text-[#101828] border-r border-[#F2F4F7] bg-[#FAFBFC]/40"
                                                            >
                                                                {r.category}
                                                            </td>
                                                        )}
                                                        <td className="px-2.5 py-2.5 align-top text-[13px] font-medium text-[#101828] whitespace-pre-line leading-snug">{r.item}</td>
                                                        <td className="px-2.5 py-2.5 align-top text-left text-[11px] text-[#475467] leading-relaxed">{r.reason_text}</td>
                                                        <td
                                                            className="px-2.5 py-2.5 align-top text-left text-[11px] text-[#475467] leading-relaxed cursor-pointer hover:text-[#055AAF] hover:bg-[#FAFBFC] transition-colors group/utt"
                                                            onClick={() => {
                                                                const match = r.agent_utterance || '';
                                                                setHighlightText(match);
                                                                setRightView('stt');
                                                            }}
                                                        >
                                                            <div className="flex flex-col gap-1">
                                                                {String(r.utterance || '')
                                                                    .split('\n')
                                                                    .map((q) => q.trim())
                                                                    .filter(Boolean)
                                                                    .map((q, qi, arr) => (
                                                                        <span
                                                                            key={qi}
                                                                            className="flex items-start gap-1.5 rounded hover:bg-[#EFF6FF] transition-colors"
                                                                            onClick={(e) => {
                                                                                // 발화별 개별 클릭 — 해당 발화만 하이라이트하고 그 턴으로 스크롤
                                                                                e.stopPropagation();
                                                                                setHighlightText(q);
                                                                                setRightView('stt');
                                                                            }}
                                                                        >
                                                                            {arr.length > 1 && (
                                                                                <span className="text-[10px] font-bold text-[#667085] bg-[#F2F4F7] rounded px-1 py-px mt-0.5 shrink-0 tabular-nums">
                                                                                    {qi + 1}
                                                                                </span>
                                                                            )}
                                                                            <span className="italic group-hover/utt:underline">"{q}"</span>
                                                                        </span>
                                                                    ))}
                                                                <span className="text-[11px] text-[#98A2B3] opacity-0 group-hover/utt:opacity-100 transition-opacity flex items-center gap-1 mt-1">
                                                                    <MessageSquare size={11} /> 클릭하여 상담 텍스트 확인
                                                                </span>
                                                            </div>
                                                        </td>
                                                        <td className="px-2.5 py-2.5 align-middle text-[13px] font-semibold text-[#101828] tabular-nums">{r.ai_eval_label}</td>
                                                        <td className="px-2.5 py-2.5 align-middle">
                                                            <ManualJudgmentCell
                                                                judgment={manualJudgments[r.row_key]?.judgment || ''}
                                                                goldSet={manualJudgments[r.row_key]?.goldSet || false}
                                                                onJudgment={(v) => setJudgment(r.row_key, r.order_no, v)}
                                                                onGoldSet={(v) => setGoldSet(r.row_key, r.order_no, v)}
                                                                canManageGold={canManageGold}
                                                            />
                                                        </td>
                                                        <td className="px-2.5 py-2.5 align-middle text-[13px] text-[#475467] tabular-nums">{r.monthly_avg}</td>
                                                        <td className="px-2.5 py-2.5 align-middle text-[13px] text-[#475467] tabular-nums">{r.team_avg}</td>
                                                    </tr>
                                                );
                                            });
                                        })()}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    </div>

                    {/* Right Column (4 units) */}
                    <div className="lg:w-1/3 space-y-6">
                        {rightView === 'analysis' ?
                            <div className="flex flex-col gap-6 lg:h-[884px] animate-in slide-in-from-right-4 duration-500">
                                {/* Radar Chart Card */}
                                <div className="bg-white rounded-[14px] border border-[#E4E7EC] shadow-[0_1px_2px_rgba(16,24,40,0.04)] flex flex-col h-[440px] shrink-0 overflow-visible">
                                    <div className="px-5 py-3.5 border-b border-[#F2F4F7] bg-[#FAFBFC] flex items-center gap-2.5">
                                        <BarChart3 size={16} className="text-[#475467]" />
                                        <h3 className="text-[14px] font-semibold text-[#101828] tracking-tight">Pentagon Diagram</h3>
                                    </div>
                                    <div className="flex-1 p-6 flex items-center justify-center relative group/radar">
                                        <RadarChart
                                            labels={PENTAGON_LABELS}
                                            teamData={teamData}
                                            overallData={overallData}
                                            agentData={agentData}
                                            size={320}
                                        />

                                        <div className="absolute top-0 right-[calc(100%+20px)] w-[600px] bg-white z-50 rounded-xl shadow-[0_20px_50px_rgba(0,0,0,0.15)] border border-[#E4E7EC] opacity-0 group-hover/radar:opacity-100 transition-all duration-300 pointer-events-none group-hover/radar:pointer-events-auto overflow-hidden flex flex-col translate-x-4 group-hover/radar:translate-x-0">
                                            <div className="absolute top-20 -right-2 w-4 h-4 bg-white border-r border-t border-[#E4E7EC] rotate-45 z-10"></div>
                                            <div className="px-5 py-3.5 border-b border-[#F2F4F7] bg-[#FAFBFC] flex items-center gap-2.5">
                                                <BarChart3 size={16} className="text-[#475467]" />
                                                <h4 className="text-[14px] font-semibold text-[#101828] tracking-tight">
                                                    분석 리포트 가이드 <span className="text-[#667085] font-medium tabular-nums">({reportScoreLabel})</span>
                                                </h4>
                                            </div>
                                            <div className="flex-1 overflow-auto max-h-[500px]">
                                                <table className="w-full text-[11px] border-collapse">
                                                    <thead className="bg-[#F9FAFB] border-b border-[#E4E7EC] sticky top-0 z-20">
                                                        <tr>
                                                            <th className="px-5 py-3 text-left w-32 font-black text-[#101828]">항목</th>
                                                            <th className="px-5 py-3 text-left font-black text-[#101828]">상세 분석 리포트</th>
                                                        </tr>
                                                    </thead>
                                                    <tbody className="divide-y divide-gray-50">
                                                        {PENTAGON_LABELS.map((label, idx) => {
                                                            const key = PENTAGON_KEYS[idx];
                                                            const content =
                                                                reportMap[key] ||
                                                                reportMap[label] ||
                                                                '분석 데이터가 존재하지 않습니다.';
                                                            return (
                                                                <tr key={key} className="transition-colors hover:bg-gray-50">
                                                                    <td className="px-5 py-4 font-black align-top text-[#344054]">{label}</td>
                                                                    <td className="px-5 py-4 text-[#475467] leading-relaxed whitespace-pre-line text-[12px]">{content}</td>
                                                                </tr>
                                                            );
                                                        })}
                                                        <tr className="bg-[#055AAF]/5 border-t border-[#055AAF]/10">
                                                            <td className="px-5 py-5 font-black text-[#055AAF] align-top text-xs">종합의견</td>
                                                            <td className="px-5 py-5 text-[#101828] font-bold leading-relaxed italic whitespace-pre-line text-[13px] bg-white/50">
                                                                {reportSummary}
                                                            </td>
                                                        </tr>
                                                    </tbody>
                                                </table>
                                            </div>
                                            <div className="p-3 bg-gray-50 border-t border-[#E4E7EC] text-[10px] text-center text-[#98A2B3] flex items-center justify-center gap-2 font-medium">
                                                <div className="w-1.5 h-1.5 bg-[#055AAF] rounded-full animate-pulse"></div>
                                                차트 위에서 마우스를 떼면 분석 리포트가 닫힙니다.
                                            </div>
                                        </div>
                                    </div>
                                </div>

                                {/* Analysis Comments / Admin Actions */}
                                <div className="bg-white rounded-[14px] border border-[#E4E7EC] shadow-[0_1px_2px_rgba(16,24,40,0.04)] flex flex-col h-[420px] shrink-0 overflow-hidden">
                                    <div className="px-5 py-3.5 border-b border-[#F2F4F7] bg-[#FAFBFC] flex items-center gap-2.5">
                                        <MessageSquare size={16} className="text-[#475467]" />
                                        <h3 className="text-[14px] font-semibold text-[#101828] tracking-tight">관리자 코멘트</h3>
                                    </div>

                                    <div className="flex-1 p-4 overflow-y-auto space-y-4 bg-gray-50/30">
                                        {adminComments.length > 0 ? (
                                            adminComments.map((c, i) => (
                                                <div key={i} className="bg-white p-4 rounded-xl border border-[#D0D5DD] shadow-sm relative overflow-hidden group">
                                                    <div className="absolute top-0 left-0 bottom-0 w-1 bg-[#055AAF]"></div>
                                                    <button
                                                        onClick={() => {
                                                            if (selectedCommentIdx === i) {
                                                                setSelectedCommentIdx(null);
                                                                setCommentDraft('');
                                                                return;
                                                            }
                                                            setSelectedCommentIdx(i);
                                                            setCommentDraft(c.text || '');
                                                        }}
                                                        className={`absolute top-3 right-3 w-4 h-4 rounded border ${selectedCommentIdx === i ? 'bg-[#055AAF] border-[#055AAF]' : 'border-[#D0D5DD] bg-white'}`}
                                                        aria-label="코멘트 선택"
                                                    />
                                                    <div className="flex justify-between items-center mb-2">
                                                        <span className="text-[10px] font-extrabold text-[#101828]">{c.author || 'QA 매니저'}</span>
                                                        <span className="text-[9px] text-[#98A2B3]">{formatDateTime(c.created_at)}</span>
                                                    </div>
                                                    <p className="text-xs text-[#344054] leading-relaxed line-clamp-4 group-hover:line-clamp-none transition-all">
                                                        {c.text}
                                                    </p>
                                                </div>
                                            ))
                                        ) : (
                                            <div className="h-full flex flex-col items-center justify-center opacity-40 italic text-xs py-10">
                                                <p>등록된 코멘트가 없습니다.</p>
                                            </div>
                                        )}
                                    </div>

                                    <div className="p-4 border-t border-[#E4E7EC] bg-white">
                                        <textarea
                                            className="w-full p-3 bg-[#F9FAFB] border border-[#D0D5DD] rounded-xl text-xs outline-none focus:ring-2 focus:ring-[#055AAF]/20 focus:border-[#055AAF] transition-all resize-none mb-3"
                                            placeholder={selectedCommentIdx === null ? "상담사 코칭을 위한 코멘트를 입력하세요..." : "선택한 코멘트 내용을 수정하세요..."}
                                            rows={3}
                                            value={commentDraft}
                                            onChange={(e) => setCommentDraft(e.target.value)}
                                            disabled={isCommentSaving}
                                        />
                                        {commentSaveError && (
                                            <p className="mb-3 text-[11px] text-[#B42318]">{commentSaveError}</p>
                                        )}
                                        <div className="grid grid-cols-3 gap-2">
                                            <button
                                                className="py-2 border border-[#D0D5DD] rounded-lg text-xs font-semibold text-[#344054] hover:bg-gray-50 transition-colors"
                                                disabled={isCommentSaving}
                                                onClick={async () => {
                                                    if (!commentDraft.trim()) return;
                                                    const now = new Date().toISOString();
                                                    const nextComments = [
                                                        { author: 'QA평가자', created_at: now, text: commentDraft.trim() },
                                                        ...adminComments,
                                                    ];
                                                    const ok = await syncAdminComments(nextComments);
                                                    if (!ok) return;
                                                    setCommentDraft('');
                                                    setSelectedCommentIdx(null);
                                                }}
                                            >
                                                {isCommentSaving ? '저장 중...' : '저장'}
                                            </button>
                                            <button
                                                className="py-2 border border-[#D0D5DD] rounded-lg text-xs font-semibold text-[#344054] hover:bg-gray-50 transition-colors disabled:opacity-50"
                                                disabled={isCommentSaving || selectedCommentIdx === null || !commentDraft.trim()}
                                                onClick={async () => {
                                                    if (selectedCommentIdx === null || !commentDraft.trim()) return;
                                                    const nextComments = adminComments.map((item, idx) =>
                                                        idx === selectedCommentIdx
                                                            ? { ...item, text: commentDraft.trim(), updated_at: new Date().toISOString() }
                                                            : item
                                                    );
                                                    await syncAdminComments(nextComments);
                                                }}
                                            >
                                                수정
                                            </button>
                                            <button
                                                className="py-2 border border-[#D0D5DD] rounded-lg text-xs font-semibold text-[#344054] hover:bg-gray-50 transition-colors disabled:opacity-50"
                                                disabled={isCommentSaving || selectedCommentIdx === null}
                                                onClick={async () => {
                                                    if (selectedCommentIdx === null) return;
                                                    const nextComments = adminComments.filter((_, idx) => idx !== selectedCommentIdx);
                                                    const ok = await syncAdminComments(nextComments);
                                                    if (!ok) return;
                                                    setSelectedCommentIdx(null);
                                                    setCommentDraft('');
                                                }}
                                            >
                                                삭제
                                            </button>
                                        </div>
                                    </div>
                                </div>
                            </div>
                            :
                            sttPanel
                        }
                    </div>
                </div>
                )}
            </div>
        </>
    );
};

export default Detail;
