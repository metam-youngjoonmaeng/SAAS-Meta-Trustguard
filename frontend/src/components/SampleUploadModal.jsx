/* 평가 업로드 — input.json 만 받아 서버가 qa-pipeline 평가를 실행 후 적재.
 * 실행 중 창을 닫아도 평가는 계속 진행되며, 완료/실패 시 토스트로 알림. */
import React, { useEffect, useRef, useState } from 'react';
import { Upload, X, AlertCircle, CheckCircle2, FileJson, Sparkles, Loader2 } from 'lucide-react';
import {
    startQaPipelineJob,
    fetchQaPipelineJob,
    activeTenantId,
    fetchOrganizations,
    fetchLlmBackends,
} from '../services/api';

/** 파이프라인 노드명 → 진행 표시용 한글 라벨 (미등록 노드는 접두 규칙 → 원어 폴백) */
const NODE_LABELS = {
    transcript_summary: '전사 요약',
    layer1: '전처리·룰 분석',
    greeting: '인사 예절',
    listening_comm: '경청 및 소통',
    language: '언어 표현',
    needs: '니즈 파악',
    explanation: '설명력 및 전달력',
    proactiveness: '적극성',
    work_accuracy: '업무 정확도',
    privacy: '개인정보 보호',
    // 구 노드명 별칭 — 백엔드 버전에 따라 어느 쪽이 와도 한글 표시.
    understanding: '경청 및 소통',
    courtesy: '언어 표현',
    mandatory: '니즈 파악',
    scope: '설명력 및 전달력',
    incorrect_check: '개인정보 보호',
    custom_rubric_eval: '평가항목 채점(루브릭)',
    kms: 'KMS 충족률',
    supervisor: '평가 종합',
    layer2_barrier: '평가 취합',
    layer3: '점수 검증',
    layer4: '결과 정리',
    orchestrator_v2: '점수 집계·오버라이드',
    confidence: '신뢰도 산출',
    tier_router: '검증 라우팅',
    evidence_refiner: '근거 보강',
    report_generator: '리포트 생성',
    report_narrator: '리포트 요약',
};

function nodeLabel(name) {
    const key = String(name || '').trim();
    if (NODE_LABELS[key]) return NODE_LABELS[key];
    if (/^ksqi/i.test(key)) return 'KSQI 평가';
    if (/^verify/i.test(key)) return '검증';
    if (/debate|persona/i.test(key)) return '토론 검증';
    if (/^gt_/i.test(key)) return 'GT 비교';
    if (/hitl/i.test(key)) return '검토큐 적재';
    return key;
}

/** 노드명 배열 → 중복 제거된 한글 라벨 목록 */
function nodeLabels(names) {
    const out = [];
    for (const n of names || []) {
        const label = nodeLabel(n);
        if (label && !out.includes(label)) out.push(label);
    }
    return out;
}

function FilePicker({ label, file, onFile, hint, disabled }) {
    const inputRef = useRef(null);
    return (
        <div className="space-y-1.5">
            <label className="text-xs font-bold text-[var(--ink-500)] uppercase tracking-wider">{label}</label>
            <div className="flex items-center gap-2">
                <button
                    type="button"
                    disabled={disabled}
                    onClick={() => inputRef.current?.click()}
                    className="px-3 py-2 bg-[var(--background-soft)] border border-[var(--border-strong)] rounded-lg text-sm font-semibold text-[var(--ink-700)] hover:bg-white disabled:opacity-50"
                >
                    파일 선택
                </button>
                <span className="text-sm text-[var(--ink-700)] truncate flex items-center gap-1.5">
                    {file ? (
                        <>
                            <FileJson size={14} className="text-[var(--primary)]" />
                            {file.name}
                        </>
                    ) : (
                        <span className="text-[var(--ink-500)]">선택된 파일 없음</span>
                    )}
                </span>
                <input
                    ref={inputRef}
                    type="file"
                    accept="application/json,.json"
                    className="hidden"
                    onChange={(e) => onFile(e.target.files?.[0] ?? null)}
                />
            </div>
            {hint ? <p className="text-[11px] text-[var(--ink-500)]">{hint}</p> : null}
        </div>
    );
}

async function readJsonFile(file) {
    if (!file) return null;
    const text = await file.text();
    return JSON.parse(text);
}

/** "상담사: ... / 고객: ..." 라인 포맷 STT 원문 → 턴 배열 (server/sampleIngest.mjs 파서와 동일 규칙) */
function parseTranscriptToTurns(transcript) {
    const text = String(transcript || '').trim();
    if (!text) return [];
    const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    const turns = [];
    let turnNo = 1;
    for (const line of lines) {
        const idx = line.indexOf(':');
        if (idx <= 0) continue;
        const speakerRaw = line.slice(0, idx).trim();
        const utterance = line.slice(idx + 1).trim();
        if (!utterance) continue;
        const speaker = speakerRaw.includes('고객') ? '고객' : '상담사';
        turns.push({ turn_no: turnNo, speaker, text: utterance });
        turnNo += 1;
    }
    return turns;
}

/** 콜 식별자 해석 — consultation_id → id → session_id → 파일명 숫자 접두 순.
 *  (qa-pipeline 학습셋 input.json 은 `id` 키 사용, 대시보드 샘플 포맷은 `consultation_id`) */
function resolveConsultationId(input, fileName) {
    const fromJson = String(input?.consultation_id ?? input?.id ?? input?.session_id ?? '').trim();
    if (fromJson) return { id: fromJson, from: 'json' };
    const m = /^(\d{3,})/.exec(String(fileName || '').trim());
    if (m) return { id: m[1], from: 'filename' };
    return { id: '', from: null };
}

function formatElapsed(sec) {
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return m > 0 ? `${m}분 ${s}초` : `${s}초`;
}

export default function SampleUploadModal({ onUploaded }) {
    const [open, setOpen] = useState(false);
    const [inputFile, setInputFile] = useState(null);
    const [parsedInput, setParsedInput] = useState(null);
    const [parseError, setParseError] = useState('');
    const [resultMsg, setResultMsg] = useState('');
    const [toast, setToast] = useState(null);
    const [orgNames, setOrgNames] = useState({});
    // 평가 백엔드 대상 — 서버 기본값과 동일(local). 운영 EC2 로 돌리려면 'ec2'.
    const pipelineTarget = 'local';
    // ★ 2026-08-25 LLM 백엔드 — OpenAI(기본) / vLLM(자체 호스팅). 값은 call 에 실려
    //   서버 buildEvaluatePayload → 파이프라인 body.llm_backend 로 전달된다.
    //   빈 문자열 = "서버가 정한다"(미동봉). 사내 주소라 localStorage 보관에 문제 없다.
    //
    // ★ 2026-08-27 Azure OpenAI 추가. **엔드포인트·API 키는 이 화면에서 다루지 않는다** —
    //   파이프라인 서버 env(AZURE_OPENAI_ENDPOINT / AZURE_OPENAI_API_KEY)가 유일한 출처다.
    //   여기서 고르는 것은 백엔드와 **배포명**(=모델 선택에 해당)뿐이라 localStorage 보관에
    //   문제가 없다. 키를 프론트 입력으로 바꾸려면 server/qaPipelineIngest.mjs 의 azureCfg
    //   주석(감사로그 경로 주의)을 먼저 확인할 것.
    const [llmBackend, setLlmBackend] = useState('');
    const [vllmBaseUrl, setVllmBaseUrl] = useState('');
    const [vllmModel, setVllmModel] = useState('');
    const [azureDeployment, setAzureDeployment] = useState('');
    // 백엔드 가용성 — 서버가 파이프라인 /v2/llm/backends 를 중계. 조회 실패는 'unknown' 으로
    // 두고 선택을 막지 않는다(가용성 조회가 평가 실행의 전제조건이 되면 안 된다).
    const [backendInfo, setBackendInfo] = useState({ state: 'loading', backends: {}, lock: null });
    useEffect(() => {
        try {
            const raw = window.localStorage.getItem('mtg_llm_backend_cfg');
            if (!raw) return;
            const p = JSON.parse(raw);
            if (p.backend) setLlmBackend(String(p.backend));
            if (p.baseUrl) setVllmBaseUrl(String(p.baseUrl));
            if (p.model) setVllmModel(String(p.model));
            if (p.azureDeployment) setAzureDeployment(String(p.azureDeployment));
        } catch {
            /* 손상된 값은 무시 */
        }
    }, []);
    useEffect(() => {
        try {
            window.localStorage.setItem(
                'mtg_llm_backend_cfg',
                JSON.stringify({
                    backend: llmBackend,
                    baseUrl: vllmBaseUrl,
                    model: vllmModel,
                    azureDeployment,
                })
            );
        } catch {
            /* 저장 실패 무시 */
        }
    }, [llmBackend, vllmBaseUrl, vllmModel, azureDeployment]);
    useEffect(() => {
        let alive = true;
        fetchLlmBackends()
            .then((r) => {
                if (!alive) return;
                setBackendInfo(
                    r?.ok
                        ? { state: 'ok', backends: r.backends || {}, lock: r.lock || null }
                        : { state: 'unknown', backends: {}, lock: null }
                );
            })
            .catch(() => {
                if (alive) setBackendInfo({ state: 'unknown', backends: {}, lock: null });
            });
        return () => {
            alive = false;
        };
    }, []);
    // 'no' 만 선택 차단 — 'unknown'(조회 실패/진행 중)은 막지 않는다.
    const backendAvail = (name) => {
        if (backendInfo.state !== 'ok') return 'unknown';
        return backendInfo.backends?.[name]?.available === true ? 'yes' : 'no';
    };
    const azureAvail = backendAvail('azure');
    const azureServerDeployment = backendInfo.backends?.azure?.default_deployment || '';
    // localStorage 에 azure 가 남아 있는데 서버 설정이 빠진 경우 — 선택을 되돌린다.
    // (막힌 option 을 value 로 들고 있으면 화면엔 선택돼 보이는데 실행은 실패한다.)
    useEffect(() => {
        if (llmBackend === 'azure' && azureAvail === 'no') setLlmBackend('');
    }, [llmBackend, azureAvail]);
    // 진행 중 평가 — 창을 닫아도 유지 (컴포넌트는 버튼과 함께 상시 마운트)
    const [running, setRunning] = useState(null); // { qa_id, startedAt }
    const [elapsedSec, setElapsedSec] = useState(0);

    useEffect(() => {
        if (!toast) return undefined;
        const t = setTimeout(() => setToast(null), 8000);
        return () => clearTimeout(t);
    }, [toast]);

    // 경과 시간 타이머 — 평가 진행 중에만 1초 간격 갱신
    useEffect(() => {
        if (!running) {
            setElapsedSec(0);
            return undefined;
        }
        const t = setInterval(() => {
            setElapsedSec(Math.floor((Date.now() - running.startedAt) / 1000));
        }, 1000);
        return () => clearInterval(t);
    }, [running]);

    // 모달 열릴 때 브랜드 이름 맵 로드 — "활성 브랜드(코오롱)로 적재" 안내용 (실패 시 org_id 그대로 폴백)
    // 통합DB: 서버가 tenant_id 를 문자열로 내려주므로 키도 문자열로 맞춘다 (Number() 캐스팅 시 매칭 실패).
    useEffect(() => {
        if (!open) return undefined;
        let alive = true;
        fetchOrganizations()
            .then((rows) => {
                if (!alive || !Array.isArray(rows)) return;
                const map = {};
                for (const r of rows) map[String(r.id)] = r.name;
                setOrgNames(map);
            })
            .catch(() => { /* org_id 숫자 표시 폴백 */ });
        return () => { alive = false; };
    }, [open]);

    const reset = () => {
        setInputFile(null);
        setParsedInput(null);
        setParseError('');
        setResultMsg('');
    };

    const close = () => {
        // 평가가 돌고 있어도 닫기 허용 — 완료 시 토스트로 알림.
        reset();
        setOpen(false);
    };

    const handleInputFile = async (file) => {
        setInputFile(file);
        setParseError('');
        if (!file) {
            setParsedInput(null);
            return;
        }
        try {
            const json = await readJsonFile(file);
            setParsedInput(json);
        } catch (e) {
            setParsedInput(null);
            setParseError(`인풋 JSON 파싱 실패: ${e.message}`);
        }
    };

    const validation = (() => {
        if (!parsedInput) return { ready: false, notes: [] };
        const notes = [];
        const resolved = resolveConsultationId(parsedInput, inputFile?.name);
        if (!resolved.id) {
            notes.push({ kind: 'error', text: '콜 식별자를 찾을 수 없습니다 (consultation_id / id / session_id 키 또는 파일명 숫자 접두 필요).' });
        } else {
            notes.push({
                kind: 'ok',
                text: `콜 식별자 확인됨 (${resolved.id}${resolved.from === 'filename' ? ' — 파일명에서 추출' : ''})`,
            });
        }
        const transcript = String(parsedInput?.transcript || '').trim();
        if (!transcript) {
            notes.push({ kind: 'error', text: 'transcript가 비어 있어 평가를 실행할 수 없습니다.' });
        } else {
            const turns = parseTranscriptToTurns(transcript);
            notes.push({ kind: 'ok', text: `transcript 확인됨 (대화 ${turns.length}턴 파싱)` });
        }
        const orgId = activeTenantId();
        if (!orgId) {
            notes.push({ kind: 'error', text: '적재할 브랜드를 확인할 수 없습니다 (활성 브랜드 선택 필요).' });
        } else {
            const brandLabel = orgNames[orgId] ? `${orgNames[orgId]} (org_id=${orgId})` : `org_id=${orgId}`;
            notes.push({ kind: 'ok', text: `활성 브랜드 ${brandLabel} 로 적재됩니다 — 다른 브랜드면 사이드바에서 먼저 전환하세요.` });
        }
        const ready = !notes.some((n) => n.kind === 'error');
        return { ready, notes };
    })();

    const handleRunAi = () => {
        if (!validation.ready || running) return;
        const consultationId = resolveConsultationId(parsedInput, inputFile?.name).id;
        const orgId = activeTenantId();
        // 저장 PK(qa_calls."ID")는 브랜드+실행마다 유니크하게 만든다 — 같은 상담번호를 다른
        // 브랜드에 올리거나 같은 브랜드에서 두 번 돌려도 서로 덮어쓰지 않고 독립 레코드로 남는다.
        // (PK 가 ("ID") 단독이라, ID 를 유니크화하지 않으면 ingest 의 ON CONFLICT ("ID") DO UPDATE 가
        //  기존 브랜드 행을 하이재킹하거나 재실행분을 덮어써 버린다.)
        // 표시용 상담번호(CALL_SEQ)·UID 에는 원본 ID 를 넣어 리스트/상세 화면엔 원본만 보이게 한다.
        const storageId = `${orgId}__${consultationId}__${Date.now()}`;
        const transcript = String(parsedInput.transcript || '').trim();
        const call = {
            qa_id: storageId,
            consultation_id: storageId,
            // CALL_SEQ(화면 상담번호)·UID 는 원본 유지 — 서버: callSeq = call.call_seq || id.
            call_seq: consultationId,
            uid: consultationId,
            org_id: orgId,
            // pipeline_target: 서버 어댑터가 평가 백엔드 base URL 을 선택 (local | ec2)
            pipeline_target: pipelineTarget,
            // transcript: qa-pipeline /evaluate 전달용 원문 문자열.
            // conversation: 대화 탭(qa_call_transcript) 적재용 턴 배열 — 서버 표준 트랙이 분리 소비.
            transcript,
            conversation: parseTranscriptToTurns(transcript),
        };
        // ★ 2026-08-25 LLM 백엔드 — 빈 값이면 아예 안 실어 서버/파이프라인 기본값을 쓴다.
        if (llmBackend) {
            call.llm_backend = llmBackend;
            if (llmBackend === 'vllm') {
                const vl = {};
                if (vllmBaseUrl.trim()) vl.base_url = vllmBaseUrl.trim();
                if (vllmModel.trim()) vl.model = vllmModel.trim();
                if (Object.keys(vl).length > 0) call.vllm = vl;
            }
            // ★ 2026-08-27 Azure — 배포명만 싣는다(크리덴셜 없음). 비우면 파이프라인의
            //   AZURE_OPENAI_DEPLOYMENT 를 쓴다.
            if (llmBackend === 'azure' && azureDeployment.trim()) {
                call.azure = { deployment: azureDeployment.trim() };
            }
        }
        if (parsedInput.cdate || parsedInput.call_datetime) {
            call.cdate = String(parsedInput.cdate || parsedInput.call_datetime);
        }

        setRunning({ qa_id: consultationId, startedAt: Date.now(), target: pipelineTarget, jobId: null, progress: null });
        setResultMsg('');

        // 비동기 잡 시작 — 서버가 SSE 로 노드 진행을 추적, 모달은 폴링으로 표시. 창을 닫아도 계속.
        startQaPipelineJob(call, { track: 'standard' })
            .then((r) => {
                if (!r?.ok || !r.job_id) throw new Error(r?.message || 'AI 평가 잡 시작 실패');
                setRunning((prev) =>
                    prev && prev.qa_id === consultationId ? { ...prev, jobId: r.job_id } : prev
                );
            })
            .catch((e) => {
                setToast({ kind: 'error', text: `[${pipelineTarget === 'ec2' ? 'EC2' : '로컬'}] ${consultationId}: ${e.message}` });
                setRunning(null);
            });

        // 실행 직후 파일 선택은 초기화 (같은 파일 재실행 방지) — 창은 열어둔 채 진행 표시.
        setInputFile(null);
        setParsedInput(null);
    };

    // 잡 폴링 — 2.5초 간격으로 진행상황 갱신, 종료(done/error) 시 토스트.
    useEffect(() => {
        const jobId = running?.jobId;
        if (!jobId) return undefined;
        const qaId = running.qa_id;
        const targetLabel = running.target === 'ec2' ? 'EC2' : '로컬';
        let cancelled = false;
        let timer = null;

        const stop = () => {
            if (timer) clearInterval(timer);
            timer = null;
        };

        const poll = async () => {
            try {
                const r = await fetchQaPipelineJob(jobId);
                if (cancelled) return;
                const job = r?.job;
                if (!job) throw new Error(r?.message || '잡 상태 조회 실패');
                if (job.status === 'running') {
                    setRunning((prev) => (prev && prev.jobId === jobId ? { ...prev, progress: job.progress } : prev));
                    return;
                }
                stop();
                if (job.status === 'done') {
                    const d = job.result || {};
                    if (onUploaded) await onUploaded();
                    if (d.skipped) {
                        // 포기호/미응대 등 평가 산출물이 없어 적재되지 않은 경우 — 성공 토스트로
                        // 보이면 "완료됐는데 결과가 없다"는 혼란을 주므로 사유를 명확히 안내.
                        setToast({
                            kind: 'warn',
                            text: `[${targetLabel}] qa_id: ${d.qa_id ?? qaId} — ${d.reason || '포기호/미응대(평가 산출물 없음)'}. 평가 결과로 적재되지 않았습니다.`,
                        });
                    } else {
                        const warn = (d.warnings || []).join(' / ');
                        setToast({
                            kind: 'success',
                            text: `[${targetLabel}] qa_id: ${d.qa_id ?? qaId}, AI 점수: ${d.ai_score ?? '-'}${d.elapsed_sec ? `, 소요 ${d.elapsed_sec}초` : ''}${warn ? ` (경고: ${warn})` : ''}`,
                        });
                    }
                } else {
                    setToast({ kind: 'error', text: `[${targetLabel}] ${qaId}: ${job.error || 'AI 평가 실패'}` });
                }
                setRunning(null);
            } catch (e) {
                if (cancelled) return;
                stop();
                setToast({ kind: 'error', text: `[${targetLabel}] ${qaId}: ${e.message}` });
                setRunning(null);
            }
        };

        timer = setInterval(poll, 2500);
        poll();
        return () => {
            cancelled = true;
            stop();
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [running?.jobId]);

    return (
        <>
            <button
                type="button"
                onClick={() => setOpen(true)}
                className="flex items-center gap-2 px-4 py-2 bg-white border border-[var(--border-strong)] rounded-lg text-sm font-semibold text-[var(--ink-700)] hover:bg-[var(--background-soft)] transition-colors"
                title="input.json 업로드 → AI 평가 실행 → 적재"
            >
                {running ? <Loader2 size={16} className="animate-spin text-[var(--warning)]" /> : <Upload size={16} />}
                평가 업로드
            </button>

            {open ? (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
                    <div className="w-full max-w-2xl bg-white rounded-2xl shadow-2xl border border-[var(--border)]">
                        <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--border)] bg-[var(--background-soft)] rounded-t-2xl">
                            <div>
                                <h2 className="text-base font-bold text-[var(--ink-900)]">AI 평가 실행</h2>
                                <p className="text-xs text-[var(--ink-500)] mt-0.5">
                                    input.json 하나만 선택하면 서버가 qa-pipeline 평가를 실행 후 적재합니다.
                                </p>
                            </div>
                            <button
                                type="button"
                                onClick={close}
                                className="p-1.5 rounded-md text-[var(--ink-500)] hover:bg-[var(--background-soft)]"
                            >
                                <X size={18} />
                            </button>
                        </div>

                        <div className="px-6 py-5 space-y-5">
                            <FilePicker
                                label="인풋 (input.json)"
                                file={inputFile}
                                onFile={handleInputFile}
                                disabled={Boolean(running)}
                                hint="STT 전문·콜 정보 (transcript, consultation_id/id 등). 아웃풋 파일은 필요 없습니다."
                            />
                            <div className="flex items-start gap-2 px-3 py-2 bg-[var(--primary-soft)] border border-[var(--primary-soft-border)] rounded-lg text-xs text-[var(--primary)]">
                                <Sparkles size={14} className="mt-0.5 shrink-0" />
                                <span>
                                    활성 브랜드의 AI 평가항목 기준으로 평가·적재됩니다 (운영 데이터). 실행 후 창을 닫아도
                                    평가는 계속 진행되며, 완료되면 알림으로 알려드립니다.
                                </span>
                            </div>

                            {/* ★ 2026-08-25 LLM 백엔드 선택 — OpenAI(기본) / vLLM(자체 호스팅).
                                '서버 기본' 이면 call 에 아무것도 안 실어 파이프라인 설정을 그대로 따른다. */}
                            <div className="bg-[var(--background-soft)] border border-[var(--border)] rounded-lg px-3 py-2.5 space-y-2">
                                <div className="flex items-center gap-2">
                                    <label className="text-[11px] font-bold text-[var(--ink-500)] uppercase tracking-wider">
                                        LLM 백엔드
                                    </label>
                                    <select
                                        value={llmBackend}
                                        onChange={(e) => setLlmBackend(e.target.value)}
                                        disabled={!!running}
                                        className="text-xs border border-[var(--border)] rounded-md px-2 py-1 bg-[var(--background)] text-[var(--ink-900)] disabled:opacity-50"
                                    >
                                        <option value="">서버 기본</option>
                                        <option value="openai">OpenAI</option>
                                        <option value="vllm">vLLM (로컬)</option>
                                        {/* ★ 2026-08-27 Azure — 서버 env(AZURE_OPENAI_*) 미설정이면
                                            고를 수 없게 막는다. 그 상태로 실행하면 파이프라인이
                                            bedrock 으로 폴백하고 Bedrock 은 IAM 거부라 평가가
                                            통째로 실패한다(사유도 AccessDenied 로만 보인다). */}
                                        <option value="azure" disabled={azureAvail === 'no'}>
                                            Azure OpenAI
                                            {azureAvail === 'no' ? ' — 서버 미설정' : ''}
                                        </option>
                                    </select>
                                    <span className="text-[11px] text-[var(--ink-500)]">
                                        {llmBackend === 'vllm'
                                            ? '사내 vLLM 서버로 평가합니다.'
                                            : llmBackend === 'openai'
                                              ? 'OpenAI API 로 평가합니다.'
                                              : llmBackend === 'azure'
                                                ? 'Azure OpenAI 배포로 평가합니다.'
                                                : '파이프라인 서버 설정을 따릅니다.'}
                                    </span>
                                </div>
                                {llmBackend === 'vllm' ? (
                                    <div className="flex flex-wrap items-center gap-2">
                                        <input
                                            type="url"
                                            value={vllmBaseUrl}
                                            onChange={(e) => setVllmBaseUrl(e.target.value)}
                                            disabled={!!running}
                                            placeholder="http://10.13.6.237:8000/v1"
                                            title="비우면 파이프라인의 QA_VLLM_BASE_URL 을 사용합니다."
                                            spellCheck={false}
                                            autoComplete="off"
                                            className="flex-1 min-w-[240px] text-xs border border-[var(--border)] rounded-md px-2 py-1 bg-[var(--background)] text-[var(--ink-900)] disabled:opacity-50"
                                        />
                                        <input
                                            type="text"
                                            value={vllmModel}
                                            onChange={(e) => setVllmModel(e.target.value)}
                                            disabled={!!running}
                                            placeholder="모델명 (비우면 자동탐지)"
                                            title="비우면 파이프라인이 /v1/models 첫 항목을 사용합니다."
                                            spellCheck={false}
                                            autoComplete="off"
                                            className="flex-1 min-w-[180px] text-xs border border-[var(--border)] rounded-md px-2 py-1 bg-[var(--background)] text-[var(--ink-900)] disabled:opacity-50"
                                        />
                                    </div>
                                ) : null}
                                {/* ★ 2026-08-27 Azure — 배포명만 받는다. 엔드포인트·API 키는
                                    파이프라인 서버 env 전용이라 이 화면에 입력칸이 없다. */}
                                {llmBackend === 'azure' ? (
                                    <div className="space-y-1.5">
                                        <div className="flex flex-wrap items-center gap-2">
                                            <input
                                                type="text"
                                                value={azureDeployment}
                                                onChange={(e) => setAzureDeployment(e.target.value)}
                                                disabled={!!running}
                                                placeholder={
                                                    azureServerDeployment
                                                        ? `배포명 (비우면 ${azureServerDeployment})`
                                                        : '배포명 (비우면 서버 기본 배포)'
                                                }
                                                title="Azure 포털의 배포(deployment) 이름. 모델명이 아니라 배포명입니다. 비우면 파이프라인의 AZURE_OPENAI_DEPLOYMENT 를 사용합니다."
                                                spellCheck={false}
                                                autoComplete="off"
                                                className="flex-1 min-w-[240px] text-xs border border-[var(--border)] rounded-md px-2 py-1 bg-[var(--background)] text-[var(--ink-900)] disabled:opacity-50"
                                            />
                                        </div>
                                        <p className="text-[11px] text-[var(--ink-500)]">
                                            엔드포인트·API 키는 파이프라인 서버 설정(AZURE_OPENAI_*)을 사용합니다 — 이
                                            화면에서 입력하지 않습니다.
                                            {azureAvail === 'unknown'
                                                ? ' 서버 설정 상태를 확인하지 못했습니다.'
                                                : ''}
                                        </p>
                                    </div>
                                ) : null}
                                {azureAvail === 'no' && llmBackend !== 'azure' ? (
                                    <p className="text-[11px] text-[var(--ink-500)]">
                                        Azure OpenAI 는 파이프라인 서버에 엔드포인트·API 키·배포명이 설정되면 선택할 수
                                        있습니다.
                                    </p>
                                ) : null}
                            </div>

                            {parseError ? (
                                <div className="flex items-start gap-2 px-3 py-2 bg-[var(--destructive-soft)] border border-[var(--destructive-soft)] rounded-lg text-xs text-[var(--destructive)]">
                                    <AlertCircle size={14} className="mt-0.5 shrink-0" />
                                    <span>{parseError}</span>
                                </div>
                            ) : null}

                            {validation.notes.length > 0 ? (
                                <div className="bg-[var(--background-soft)] border border-[var(--border)] rounded-lg px-3 py-2.5 space-y-1.5">
                                    <p className="text-[11px] font-bold text-[var(--ink-500)] uppercase tracking-wider">검증 결과</p>
                                    {validation.notes.map((n, i) => (
                                        <div
                                            key={i}
                                            className={`flex items-start gap-2 text-xs ${n.kind === 'error'
                                                    ? 'text-[var(--destructive)]'
                                                    : n.kind === 'warn'
                                                        ? 'text-[var(--warning)]'
                                                        : 'text-[var(--primary)]'
                                                }`}
                                        >
                                            {n.kind === 'ok' ? (
                                                <CheckCircle2 size={14} className="mt-0.5 shrink-0" />
                                            ) : (
                                                <AlertCircle size={14} className="mt-0.5 shrink-0" />
                                            )}
                                            <span>{n.text}</span>
                                        </div>
                                    ))}
                                </div>
                            ) : null}

                            {running ? (
                                <div className="flex items-start gap-2 px-3 py-2 bg-[var(--warning-soft)] border border-[var(--warning-soft)] rounded-lg text-xs text-[var(--warning)]">
                                    <Loader2 size={14} className="mt-0.5 shrink-0 animate-spin" />
                                    <div className="space-y-1 min-w-0">
                                        <div>
                                            AI 평가 진행 중 (qa_id: {running.qa_id}, 백엔드: {running.target === 'ec2' ? 'EC2' : '로컬'}) —
                                            경과 {formatElapsed(elapsedSec)}. 창을 닫아도 계속 진행됩니다.
                                        </div>
                                        {running.progress ? (
                                            <>
                                                <div className="font-semibold">
                                                    완료 {running.progress.nodes_done ?? 0}단계
                                                    {nodeLabels(running.progress.running_nodes).length > 0
                                                        ? ` · 진행 중: ${nodeLabels(running.progress.running_nodes).join(', ')}`
                                                        : ''}
                                                </div>
                                                {nodeLabels(running.progress.recent_done).length > 0 ? (
                                                    <div className="text-[11px] text-[var(--warning)]/80 truncate">
                                                        최근 완료: {nodeLabels(running.progress.recent_done).slice(-4).join(' → ')}
                                                    </div>
                                                ) : null}
                                            </>
                                        ) : (
                                            <div className="text-[11px] text-[var(--warning)]/80">파이프라인 연결 중...</div>
                                        )}
                                    </div>
                                </div>
                            ) : null}

                            {resultMsg ? (
                                <div className="flex items-start gap-2 px-3 py-2 rounded-lg text-xs bg-[var(--destructive-soft)] border border-[var(--destructive-soft)] text-[var(--destructive)]">
                                    <AlertCircle size={14} className="mt-0.5 shrink-0" />
                                    <span>{resultMsg}</span>
                                </div>
                            ) : null}
                        </div>

                        <div className="flex items-center justify-end gap-2 px-6 py-4 border-t border-[var(--border)] bg-[var(--background-soft)] rounded-b-2xl">
                            <button
                                type="button"
                                onClick={close}
                                className="px-4 py-2 text-sm font-semibold text-[var(--ink-700)] border border-[var(--border-strong)] bg-white rounded-lg hover:bg-[var(--background-soft)]"
                            >
                                닫기
                            </button>
                            <button
                                type="button"
                                onClick={handleRunAi}
                                disabled={!validation.ready || Boolean(running)}
                                className="px-4 py-2 text-sm font-bold text-white bg-[var(--primary)] rounded-lg hover:bg-[var(--primary)] disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                                {running ? 'AI 평가 진행 중...' : 'AI 평가 실행'}
                            </button>
                        </div>
                    </div>
                </div>
            ) : null}

            {toast ? (
                <div className="fixed top-6 right-6 z-[60] animate-fade-in">
                    <div
                        className={`flex items-start gap-2.5 px-4 py-3 rounded-lg shadow-2xl border max-w-md ${
                            toast.kind === 'success'
                                ? 'bg-white border-[var(--primary)]/20 text-[var(--ink-900)]'
                                : toast.kind === 'warn'
                                    ? 'bg-white border-[var(--warning-soft)] text-[var(--warning)]'
                                    : 'bg-white border-[var(--destructive-soft)] text-[var(--destructive)]'
                        }`}
                    >
                        {toast.kind === 'success' ? (
                            <CheckCircle2 size={18} className="text-[var(--primary)] mt-0.5 flex-shrink-0" />
                        ) : toast.kind === 'warn' ? (
                            <AlertCircle size={18} className="text-[var(--warning)] mt-0.5 flex-shrink-0" />
                        ) : (
                            <AlertCircle size={18} className="text-[var(--destructive)] mt-0.5 flex-shrink-0" />
                        )}
                        <div className="text-sm leading-snug">
                            <div className="font-bold mb-0.5">
                                {toast.kind === 'success'
                                    ? 'AI 평가 완료'
                                    : toast.kind === 'warn'
                                        ? '평가 제외 (미적재)'
                                        : 'AI 평가 실패'}
                            </div>
                            <div className="text-xs text-[var(--ink-500)] break-words">{toast.text}</div>
                        </div>
                        <button
                            type="button"
                            onClick={() => setToast(null)}
                            className="ml-1 -mt-0.5 -mr-1 p-1 text-[var(--ink-500)] hover:text-[var(--ink-700)] rounded"
                            aria-label="알림 닫기"
                        >
                            <X size={14} />
                        </button>
                    </div>
                </div>
            ) : null}
        </>
    );
}
