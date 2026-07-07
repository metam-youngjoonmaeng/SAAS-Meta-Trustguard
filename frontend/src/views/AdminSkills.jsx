// AI 스킬 관리 — 평가 항목별로 골든셋(정답 사례)과 스킬셋(높음/낮음 보정)을 관리.
// 골든셋: 평가리스트에서 '골든셋'으로 체크한 사례 → few-shot 주입
// 스킬셋: 수기평가에서 '동일'이 아닌(높음/낮음) 판정 누적 → 평가 프롬프트 보정 문구
// 실제 최종 프롬프트 = 기본 프롬프트(평가항목 관리) + 스킬셋 보정 + 골든셋 few-shot.
// 단, 이 화면의 '최종 평가 프롬프트' 박스는 기본 프롬프트를 중복 표시하지 않고 스킬셋 보정·골든셋 레이어만 보여준다.
// etc/pages-skills.jsx 프로토타입 이식(1단계 UI). 스타일은 .tg-eval 스코프(evalMgmt.css) 재사용.
import React, { useState as useState_sk, useMemo as useMemo_sk, useEffect } from 'react';
import { Icon, PageHead } from './evalMgmt/ui';
import { fetchEvalItemDefs, fetchGoldenCasesByItem, removeGoldenSet, fetchSkillset, removeSkillset, fetchSkillVersions, fetchSkillVersionDetail } from '../services/api';
import { HistoryModal } from './EvalItems';   // 변경이력(스킬 버전 이력 + 활성화/롤백) 재사용

// ── 실데이터 매핑 헬퍼 (서버 응답 → 화면 행) ─────────────
// CDATE 'YYYYMMDDHHMMSS'(ICS) 또는 ISO → 'YYYY-MM-DD HH:MM'
function fmtCdate(v) {
  if (!v) return '—';
  const s = String(v);
  const m = s.match(/^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]} ${m[4]}:${m[5]}`;
  const d = new Date(s);
  if (!Number.isNaN(d.getTime())) {
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
  }
  return s;
}
// 점수 → 골든셋 outcome(색): 90+ 모범 · 80+ 양호 · 60+ 주의 · 그 외 위반
function outcomeOf(score) {
  const n = Number(score);
  if (!Number.isFinite(n)) return 'mid';
  if (n >= 90) return 'good';
  if (n >= 80) return 'mid';
  if (n >= 60) return 'warn';
  return 'bad';
}
function mapSkillEntry(e) {
  return {
    id: `${e.qa_id}#${e.order_no}`,
    dim: e.order_no,
    sessionId: e.qa_id,
    date: fmtCdate(e.call_datetime),
    agent: e.display_name || e.login_id || '—',
    utterances: e.agent_utterance ? [e.agent_utterance] : [],
    aiScore: e.ai_eval,
    judgment: e.direction,          // '높음' | '낮음'
    reason: e.reason_text || '',
    judge: 'admin', judgeName: '검수자',
    qaId: e.qa_id, orderNo: e.order_no,
  };
}
function mapGoldEntry(e) {
  return {
    id: e.golden_id,
    dim: e.order_no,
    callId: e.qa_id,
    date: fmtCdate(e.call_datetime),
    agent: e.display_name || e.login_id || '—',
    utterances: e.agent_utterance ? [e.agent_utterance] : [],
    aiScore: e.score, manualScore: e.score,
    outcome: outcomeOf(e.score),
    reason: e.reason_text || '',
    addedBy: '검수자',
    qaId: e.qa_id, orderNo: e.order_no,
  };
}

const OUTCOME_META = {
  good: { label: '모범', color: 'var(--success)', bg: 'var(--success-soft)' },
  mid:  { label: '양호', color: 'var(--primary)', bg: 'var(--primary-soft-flat)' },
  warn: { label: '주의', color: 'var(--warning-ink)', bg: 'var(--warning-soft)' },
  bad:  { label: '위반', color: 'var(--destructive-ink)', bg: 'var(--destructive-soft)' },
};

// 항목명 정규화 — 스킬 버전(overlay)의 item_name 과 평가항목(item) 매칭용 (EvalItems 와 동일 규칙).
function normName(s) {
  return String(s || '').trim();

}

// 발화내용 헬퍼 — utterances 배열 또는 excerpt 문자열 모두 지원
function uttList(row) {
  if (Array.isArray(row.utterances)) return row.utterances;
  if (row.excerpt) return [row.excerpt];
  return [];
}
// 번호 매긴 발화 목록 (펼침 상세용)
function UtteranceList({ items }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      {items.map((u, i) => (
        <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
          <span className="mono" style={{ flexShrink: 0, fontSize: 10.5, fontWeight: 700, color: 'var(--primary)', marginTop: 2, minWidth: 14 }}>{i + 1}</span>
          <span style={{ fontSize: 12.5, color: 'var(--ink-900)', lineHeight: 1.6, fontStyle: 'italic' }}>“{u}”</span>
        </div>
      ))}
    </div>
  );
}

// ── 페이지네이션 (하루 수천 건 대비) ──────────────────
const PAGE_SIZE = 20;
function Pager({ total, page, setPage }) {
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  if (total <= PAGE_SIZE) return (
    <div style={{ fontSize: 11.5, color: 'var(--ink-400)', textAlign: 'right' }}>총 {total.toLocaleString()}건</div>
  );
  const from = page * PAGE_SIZE + 1, to = Math.min(total, (page + 1) * PAGE_SIZE);
  const btn = (dir, disabled, label) => (
    <button onClick={() => setPage(p => Math.min(pages - 1, Math.max(0, p + dir)))} disabled={disabled}
            style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 26, height: 26, borderRadius: 7, border: '1px solid var(--border)', background: 'white', color: disabled ? 'var(--ink-300)' : 'var(--ink-600)', cursor: disabled ? 'default' : 'pointer' }}>
      <Icon name={label} size={14} />
    </button>
  );
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, justifyContent: 'flex-end', paddingTop: 4 }}>
      <span style={{ fontSize: 11.5, color: 'var(--ink-400)', whiteSpace: 'nowrap' }}>총 {total.toLocaleString()}건 · {from.toLocaleString()}–{to.toLocaleString()}</span>
      <div style={{ display: 'flex', gap: 4 }}>
        {btn(-1, page === 0, 'chevron-left')}
        <span style={{ display: 'inline-flex', alignItems: 'center', padding: '0 8px', fontSize: 12, fontWeight: 700, color: 'var(--ink-700)', whiteSpace: 'nowrap' }}>{page + 1} / {pages}</span>
        {btn(1, page >= pages - 1, 'chevron-right')}
      </div>
    </div>
  );
}

// 테두리 없는 작은 삭제 아이콘
function DeleteIcon({ onClick, title = '삭제' }) {
  return (
    <button onClick={onClick} title={title}
            className="icon-del"
            style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 24, height: 24, border: 0, background: 'transparent', color: 'var(--ink-300)', cursor: 'pointer', borderRadius: 6, padding: 0 }}>
      <Icon name="trash-2" size={14} />
    </button>
  );
}

// ── 스킬셋 탭 ─────────────────────────────────────────
function SkillsetTab({ judgments, onDelete }) {
  const [openId, setOpenId] = useState_sk(null);
  const [page, setPage] = useState_sk(0);
  const total = judgments.length;
  const pageRows = judgments.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  if (!total) {
    return (
      <div style={{ padding: '48px 0', textAlign: 'center', color: 'var(--ink-400)' }}>
        <Icon name="inbox" size={34} style={{ color: 'var(--ink-300)' }} />
        <div style={{ fontSize: 13, marginTop: 8 }}>이 항목에는 '동일'이 아닌 수기평가가 아직 없습니다.</div>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: 'var(--ink-500)', lineHeight: 1.5 }}>
        <Icon name="info" size={13} style={{ color: 'var(--primary)', flexShrink: 0 }} />
        <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}><strong>높음</strong>(AI 과소평가) · <strong>낮음</strong>(AI 과대평가) 판정 누적 목록</span>
      </div>

      <table className="row-table">
        <colgroup>
          <col style={{ width: 24 }} /><col style={{ width: 222 }} /><col style={{ width: 118 }} /><col style={{ width: 84 }} /><col /><col style={{ width: 96 }} /><col style={{ width: 34 }} />
        </colgroup>
        <thead>
          <tr>
            <th></th><th style={{ textAlign: 'left' }}>상담번호</th><th style={{ textAlign: 'left' }}>일시</th><th style={{ textAlign: 'left' }}>담당자</th><th style={{ textAlign: 'left' }}>발화내용</th><th>AI평가 · 점수</th><th></th>
          </tr>
        </thead>
        <tbody>
          {pageRows.map(j => {
            const isUp = j.judgment === '높음';
            const dirColor = isUp ? 'var(--success)' : 'var(--destructive-ink)';
            const dirBg = isUp ? 'var(--success-soft)' : 'var(--destructive-soft)';
            const open = openId === j.id;
            return (
              <React.Fragment key={j.id}>
                <tr className="row-tr" onClick={() => setOpenId(open ? null : j.id)}>
                  <td style={{ textAlign: 'center' }}><Icon name={open ? 'chevron-down' : 'chevron-right'} size={13} style={{ color: 'var(--ink-300)' }} /></td>
                  <td style={{ textAlign: 'left', overflow: 'hidden' }}><span className="mono" title={j.sessionId} style={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', fontSize: 12, fontWeight: 700, color: 'var(--ink-900)' }}>{j.sessionId}</span></td>
                  <td style={{ textAlign: 'left' }}><span style={{ fontSize: 11.5, color: 'var(--ink-500)', whiteSpace: 'nowrap' }}>{j.date}</span></td>
                  <td style={{ textAlign: 'left' }}><span style={{ fontSize: 12, color: 'var(--ink-700)', whiteSpace: 'nowrap' }}>{j.agent}</span></td>
                  <td style={{ textAlign: 'left' }}>
                    <span style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
                      <span style={{ fontSize: 12, color: 'var(--ink-600)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 260 }}>“{uttList(j)[0]}”</span>
                      {uttList(j).length > 1 && <span style={{ flexShrink: 0, fontSize: 10, fontWeight: 700, color: 'var(--primary)', background: 'var(--primary-soft)', padding: '1px 6px', borderRadius: 9999 }}>+{uttList(j).length - 1}</span>}
                    </span>
                  </td>
                  <td style={{ textAlign: 'center', whiteSpace: 'nowrap' }}>
                    <span className="mono" style={{ fontSize: 12, fontWeight: 700, color: 'var(--ink-400)' }}>{j.aiScore}</span>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 2, marginLeft: 5, fontSize: 10.5, fontWeight: 800, padding: '1px 6px', borderRadius: 9999, background: dirBg, color: dirColor }}><Icon name={isUp ? 'trending-up' : 'trending-down'} size={10} />{j.judgment}</span>
                  </td>
                  <td style={{ textAlign: 'center' }} onClick={e => e.stopPropagation()}><DeleteIcon onClick={() => onDelete(j)} /></td>
                </tr>
                {open && (
                  <tr className="row-sub">
                    <td></td>
                    <td colSpan={6} style={{ textAlign: 'left', padding: '2px 14px 14px' }}>
                      <div style={{ background: 'var(--background-soft)', border: '1px solid var(--border)', borderRadius: 9, padding: '12px 14px' }}>
                        <div style={{ fontSize: 10.5, fontWeight: 700, color: 'var(--ink-400)', marginBottom: 7 }}>발화내용 ({uttList(j).length})</div>
                        <UtteranceList items={uttList(j)} />
                        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 7, fontSize: 12, color: 'var(--ink-600)', marginTop: 11, paddingTop: 11, borderTop: '1px solid var(--border-soft)', lineHeight: 1.6 }}>
                          <Icon name={j.judge === 'admin' ? 'shield' : 'headset'} size={12} style={{ color: 'var(--ink-400)', flexShrink: 0, marginTop: 2 }} />
                          <span><span style={{ fontWeight: 700, color: 'var(--ink-700)' }}>{j.judgeName}</span> · AI 평가사유: {j.reason}</span>
                        </div>
                      </div>
                    </td>
                  </tr>
                )}
              </React.Fragment>
            );
          })}
        </tbody>
      </table>
      <Pager total={total} page={page} setPage={setPage} />
    </div>
  );
}

// ── 골든셋 탭 ─────────────────────────────────────────
function GoldenTab({ cases, onDelete }) {
  const [openId, setOpenId] = useState_sk(null);
  const [page, setPage] = useState_sk(0);
  const total = cases.length;
  const pageRows = cases.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  if (!total) {
    return (
      <div style={{ padding: '48px 0', textAlign: 'center', color: 'var(--ink-400)' }}>
        <Icon name="star" size={34} style={{ color: 'var(--ink-300)' }} />
        <div style={{ fontSize: 13, marginTop: 8 }}>이 항목의 골든셋 사례가 아직 없습니다.</div>
        <div style={{ fontSize: 11.5, marginTop: 4, color: 'var(--ink-300)' }}>평가리스트 상세에서 '동일 + 골든셋'으로 등록하면 여기에 쌓입니다.</div>
      </div>
    );
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: 'var(--ink-500)', lineHeight: 1.5 }}>
        <Icon name="star" size={13} style={{ color: 'var(--gold-ink)', fill: 'var(--gold-fill)', flexShrink: 0 }} />
        <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>검수자가 <strong>정답 확정(동일 + 골든셋)</strong>한 사례 · 평가 시 few-shot 주입</span>
      </div>
      <table className="row-table">
        <colgroup>
          <col style={{ width: 24 }} /><col style={{ width: 222 }} /><col style={{ width: 118 }} /><col style={{ width: 84 }} /><col /><col style={{ width: 72 }} /><col style={{ width: 34 }} />
        </colgroup>
        <thead>
          <tr>
            <th></th><th style={{ textAlign: 'left' }}>상담번호</th><th style={{ textAlign: 'left' }}>일시</th><th style={{ textAlign: 'left' }}>담당자</th><th style={{ textAlign: 'left' }}>발화내용</th><th>점수</th><th></th>
          </tr>
        </thead>
        <tbody>
          {pageRows.map(c => {
            const o = OUTCOME_META[c.outcome] || OUTCOME_META.mid;
            const open = openId === c.id;
            return (
              <React.Fragment key={c.id}>
                <tr className="row-tr" onClick={() => setOpenId(open ? null : c.id)}>
                  <td style={{ textAlign: 'center' }}><Icon name={open ? 'chevron-down' : 'chevron-right'} size={13} style={{ color: 'var(--ink-300)' }} /></td>
                  <td style={{ textAlign: 'left', overflow: 'hidden' }}><span className="mono" title={c.callId} style={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', fontSize: 12, fontWeight: 700, color: 'var(--ink-900)' }}>{c.callId}</span></td>
                  <td style={{ textAlign: 'left' }}><span style={{ fontSize: 11.5, color: 'var(--ink-500)', whiteSpace: 'nowrap' }}>{c.date}</span></td>
                  <td style={{ textAlign: 'left' }}><span style={{ fontSize: 12, color: 'var(--ink-700)', whiteSpace: 'nowrap' }}>{c.agent}</span></td>
                  <td style={{ textAlign: 'left' }}>
                    <span style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
                      <span style={{ fontSize: 12, color: 'var(--ink-600)', fontStyle: 'italic', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 260 }}>“{uttList(c)[0]}”</span>
                      {uttList(c).length > 1 && <span style={{ flexShrink: 0, fontSize: 10, fontWeight: 700, color: 'var(--primary)', background: 'var(--primary-soft)', padding: '1px 6px', borderRadius: 9999 }}>+{uttList(c).length - 1}</span>}
                    </span>
                  </td>
                  <td style={{ textAlign: 'center', whiteSpace: 'nowrap' }}>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                      <span style={{ width: 7, height: 7, borderRadius: 9999, background: o.color, display: 'inline-block' }}></span>
                      <span className="mono" style={{ fontSize: 12, fontWeight: 700, color: 'var(--ink-900)' }}>{c.manualScore}</span>
                    </span>
                  </td>
                  <td style={{ textAlign: 'center' }} onClick={e => e.stopPropagation()}><DeleteIcon onClick={() => onDelete(c)} /></td>
                </tr>
                {open && (
                  <tr className="row-sub">
                    <td></td>
                    <td colSpan={6} style={{ textAlign: 'left', padding: '2px 14px 14px' }}>
                      <div style={{ background: 'var(--background-soft)', border: '1px solid var(--border)', borderRadius: 9, padding: '12px 14px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 9, flexWrap: 'wrap' }}>
                          <span style={{ fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 9999, background: o.bg, color: o.color }}>{o.label}</span>
                          <span style={{ fontSize: 11.5, color: 'var(--ink-500)' }}>AI {c.aiScore} · 검수 {c.manualScore} · 등록 {c.addedBy}</span>
                        </div>
                        <div style={{ fontSize: 10.5, fontWeight: 700, color: 'var(--ink-400)', marginBottom: 7 }}>발화내용 ({uttList(c).length})</div>
                        <UtteranceList items={uttList(c)} />
                        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 7, fontSize: 12, color: 'var(--ink-600)', marginTop: 11, paddingTop: 11, borderTop: '1px solid var(--border-soft)', lineHeight: 1.6 }}>
                          <Icon name="lightbulb" size={12} style={{ color: 'var(--gold-ink)', flexShrink: 0, marginTop: 2 }} /><span>{c.reason}</span>
                        </div>
                      </div>
                    </td>
                  </tr>
                )}
              </React.Fragment>
            );
          })}
        </tbody>
      </table>
      <Pager total={total} page={page} setPage={setPage} />
    </div>
  );
}

// ── 최종 프롬프트 탭 ──────────────────────────────────
// 기본 프롬프트(criterion + prompt_template)는 평가항목 관리에서 확인 가능하므로 여기서 중복 표시하지 않고,
// 배치가 학습해 '활성 버전'에 저장한 학습된 보완 룰(overlay_md) — 평가 시 실제 주입되는 내용 — 만 보여준다.
// 배치가 새 버전을 활성화하면 이 화면도 그 overlay 를 그대로 반영한다.
function FinalPromptTab({ overlay, changed, goldenCount, version, skillLoading, skillErr }) {
  const hasOverlay = Boolean(overlay && overlay.trim());

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ fontSize: 12, color: 'var(--ink-500)', lineHeight: 1.5 }}>
        기본 프롬프트(<strong>평가항목 관리</strong>)에 더해지는 <strong>학습된 보완 룰(overlay)</strong>입니다. 스킬 학습 배치가 활성 버전을 갱신하면 자동 반영됩니다.
      </div>

      {version && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', fontSize: 11 }}>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontWeight: 700, padding: '2px 8px', borderRadius: 9999, background: 'var(--success-soft)', color: 'var(--success)' }}>
            <Icon name="check-circle" size={11} />활성 버전 {version.id}{version.createdAt ? ` · ${fmtCdate(version.createdAt)}` : ''}
          </span>
          {hasOverlay && (
            <span style={{ fontSize: 10.5, fontWeight: 700, padding: '2px 8px', borderRadius: 9999, background: changed ? 'var(--success-soft)' : 'var(--muted)', color: changed ? 'var(--success)' : 'var(--ink-500)' }}>
              {changed ? '이번 버전 갱신' : '이전 버전 룰 승계'}
            </span>
          )}
        </div>
      )}

      <div style={{
        border: '1px solid var(--border)', borderRadius: 12, background: 'var(--background-soft)',
        padding: '16px 18px', fontFamily: 'var(--font-mono, monospace)', fontSize: 12.5, lineHeight: 1.7,
        color: hasOverlay ? 'var(--ink-800, var(--ink-900))' : 'var(--ink-400)', whiteSpace: 'pre-wrap',
        fontStyle: hasOverlay ? 'normal' : 'italic',
      }}>
        {skillLoading
          ? '학습된 보완 룰 불러오는 중…'
          : skillErr
            ? `스킬 버전을 불러오지 못했습니다: ${skillErr}`
            : hasOverlay
              ? overlay
              : version
                ? '이 항목은 활성 버전에 학습된 보완 룰이 없습니다. 검수 정정(높음/낮음)이 쌓여 배치가 돌면 생성됩니다.'
                : '학습된 스킬 버전이 없습니다. 검수 정정(높음/낮음)이 쌓인 뒤 스킬 학습 배치를 돌리면 생성됩니다.'}
      </div>

      {goldenCount > 0 && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11.5, color: 'var(--ink-500)' }}>
          <Icon name="star" size={12} style={{ color: 'var(--gold-ink)', fill: 'var(--gold-fill)' }} />
          이 항목의 골든셋 {goldenCount}건이 few-shot 예시로 함께 주입됩니다.
        </div>
      )}
    </div>
  );
}

// ── 메인 페이지 ───────────────────────────────────────
function AdminSkills() {
  const [items, setItems] = useState_sk([]);        // 평가항목(좌측) — /api/admin/eval-items
  const [selDim, setSelDim] = useState_sk(null);    // 선택 항목 order_no
  const [tab, setTab] = useState_sk('skillset');
  const [skillAll, setSkillAll] = useState_sk([]);  // 스킬셋 전체(항목 무관) — /api/skillset
  const [goldAll, setGoldAll] = useState_sk([]);    // 골든셋 전체 — /api/golden-set
  const [loading, setLoading] = useState_sk(true);
  const [err, setErr] = useState_sk('');
  // 학습된 보완 룰(overlay) — 활성 스킬 버전. item_name → { overlay, changed } 맵.
  const [overlayByName, setOverlayByName] = useState_sk({});
  const [skillVer, setSkillVer] = useState_sk(null);   // { id, createdAt } | null
  const [skillLoading, setSkillLoading] = useState_sk(true);
  const [skillErr, setSkillErr] = useState_sk('');
  const [showHistory, setShowHistory] = useState_sk(false);   // 변경이력 모달(스킬 버전 이력)

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        setLoading(true); setErr('');
        const [ev, sk, gd] = await Promise.all([
          // 채점 대상과 동일한 부서('기본')만. 부서 미지정 시 KSQI 항목이 섞여 order_no 가 충돌한다.
          fetchEvalItemDefs({ department: '기본' }),  // { items: [{ order_no, category, item }] }
          fetchSkillset(),            // { entries: [...] }  (전 항목)
          fetchGoldenCasesByItem(),   // { entries: [...] }  (전 항목)
        ]);
        if (!alive) return;
        const evItems = (ev?.items || []).map(r => ({ key: r.order_no, label: r.item, group: r.category }));
        setItems(evItems);
        setSkillAll((sk?.entries || []).map(mapSkillEntry));
        setGoldAll((gd?.entries || []).map(mapGoldEntry));
        setSelDim(cur => (cur != null ? cur : (evItems[0]?.key ?? null)));
      } catch (e) {
        if (alive) setErr(e?.message || '데이터를 불러오지 못했습니다.');
      } finally {
        if (alive) setLoading(false);
      }
    })();
    // 활성 스킬 버전(학습된 보완 룰 overlay) — 파이프라인 프록시. 실패해도 본문은 유지(폴백 안내).
    (async () => {
      try {
        setSkillLoading(true); setSkillErr('');
        const vlist = await fetchSkillVersions();     // { versions:[{version_id,created_at}], active_version_id }
        const activeId = vlist?.active_version_id || null;
        if (!activeId) { if (alive) { setOverlayByName({}); setSkillVer(null); } return; }
        const detail = await fetchSkillVersionDetail(activeId);   // { items:[{item_name,overlay_md,changed}] }
        if (!alive) return;
        const map = {};
        (detail?.items || []).forEach(it => {
          map[normName(it.item_name)] = { overlay: it.overlay_md || '', changed: Boolean(it.changed) };
        });
        const v = (vlist.versions || []).find(x => x.version_id === activeId);
        setOverlayByName(map);
        setSkillVer({ id: activeId, createdAt: v?.created_at || null });
      } catch (e) {
        if (alive) setSkillErr(e?.message || '스킬 버전 조회 실패');
      } finally {
        if (alive) setSkillLoading(false);
      }
    })();
    return () => { alive = false; };
  }, []);

  const dim = items.find(d => d.key === selDim) || null;
  const dimJudgments = skillAll.filter(j => j.dim === selDim);
  const dimGolden = goldAll.filter(g => g.dim === selDim);
  // 이 항목의 학습된 보완 룰(overlay) — 활성 버전에서 item_name 매칭.
  const dimOverlay = (dim && overlayByName[normName(dim.label)]) || null;

  const deleteSkill = async (row) => {
    try { await removeSkillset(row.qaId, row.orderNo); setSkillAll(s => s.filter(x => x.id !== row.id)); }
    catch (e) { /* 무시(다음 진입 시 재조회로 정합) */ }
  };
  const deleteGold = async (row) => {
    try { await removeGoldenSet(row.qaId, row.orderNo); setGoldAll(g => g.filter(x => x.id !== row.id)); }
    catch (e) { /* 무시 */ }
  };

  const countFor = (key) => ({
    skill: skillAll.filter(j => j.dim === key).length,
    gold: goldAll.filter(g => g.dim === key).length,
  });

  const TABS = [
    { k: 'skillset', label: `스킬셋 ${dimJudgments.length}` },
    { k: 'golden',   label: `골든셋 ${dimGolden.length}` },
  ];

  const HEAD_SUB = '평가 항목별로 골든셋(정답 사례)과 스킬셋(높음/낮음 보정)을 관리해 LLM 평가 정확도를 높입니다.';
  if (loading || err || !dim) {
    return (
      <div className="tg-eval">
        <PageHead title="AI 스킬 관리" sub={HEAD_SUB} />
        <div style={{ padding: '64px 0', textAlign: 'center', color: 'var(--ink-400)', fontSize: 13 }}>
          {loading ? '불러오는 중…' : err ? `오류: ${err}` : '평가 항목이 없습니다.'}
        </div>
      </div>
    );
  }

  return (
    <div className="tg-eval">
      <PageHead title="AI 스킬 관리" sub={HEAD_SUB} />

      <div className="grid grid-list-detail" style={{ gridTemplateColumns: '290px minmax(0, 1fr)', alignItems: 'stretch', height: 'calc(100vh - 230px)', minHeight: 560 }}>
        {/* 좌측: 평가 항목 목록 */}
        <div className="panel" style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          <div className="panel-head" style={{ flexShrink: 0 }}>
            <h3 style={{ whiteSpace: 'nowrap' }}>평가 항목</h3>
            <span className="muted-text" style={{ whiteSpace: 'nowrap' }}>{items.length}개</span>
          </div>
          <div style={{ padding: '8px', flex: 1, overflowY: 'auto' }}>
            {items.map((d, idx) => {
              const on = selDim === d.key;
              const c = countFor(d.key);
              return (
                <button key={d.key} onClick={() => setSelDim(d.key)}
                        style={{
                          display: 'flex', alignItems: 'center', gap: 8, width: '100%', textAlign: 'left',
                          padding: '9px 10px 9px 11px', border: 0, borderLeft: `3px solid ${on ? 'var(--primary)' : 'transparent'}`,
                          borderRadius: on ? '0 9px 9px 0' : 9, marginBottom: 1,
                          background: on ? 'var(--primary-soft)' : 'transparent', cursor: 'pointer', fontFamily: 'inherit',
                          transition: 'background var(--t-base)',
                        }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}>
                      <span className="mono" style={{ fontSize: 10.5, fontWeight: 700, color: 'var(--ink-400)' }}>#{String(idx + 1).padStart(2, '0')}</span>
                      <span style={{ fontSize: 10.5, fontWeight: 600, color: 'var(--ink-400)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{d.group}</span>
                    </div>
                    <div style={{ fontSize: 13.5, fontWeight: on ? 700 : 600, color: on ? 'var(--primary)' : 'var(--ink-900)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{d.label}</div>
                  </div>
                  <span style={{ flexShrink: 0, display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                    {c.gold > 0 && (
                      <span title="골든셋" style={{ display: 'inline-flex', alignItems: 'center', gap: 2, fontSize: 10.5, fontWeight: 700, color: 'var(--gold-ink)' }}>
                        <Icon name="star" size={10} style={{ fill: 'var(--gold-fill)', color: 'var(--gold)' }} />{c.gold}
                      </span>
                    )}
                    {c.skill > 0 && (
                      <span title="스킬셋(수기 정정)" style={{ minWidth: 18, textAlign: 'center', fontSize: 10.5, fontWeight: 700, padding: '1px 6px', borderRadius: 9999, background: on ? 'var(--primary-soft-flat)' : 'var(--muted)', color: on ? 'var(--primary)' : 'var(--ink-500)' }}>{c.skill}</span>
                    )}
                    <Icon name="chevron-right" size={15} style={{ color: on ? 'var(--primary)' : 'var(--ink-300)' }} />
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        {/* 우측: 상세 (탭형) */}
        <div className="panel" style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          <div className="panel-head" style={{ flexShrink: 0 }}>
            <h3>{dim.label}</h3>
            <span style={{ fontSize: 12, color: 'var(--ink-400)', fontWeight: 600, whiteSpace: 'nowrap' }}>{dim.group}</span>
            {dimOverlay && dimOverlay.overlay && (
              <span style={{ marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11, fontWeight: 700, padding: '3px 10px', borderRadius: 9999, background: 'var(--primary-soft)', color: 'var(--primary)', whiteSpace: 'nowrap' }}>
                <Icon name="refresh-cw" size={11} />보완 룰 적용 중
              </span>
            )}
          </div>

          {/* Tabs */}
          <div style={{ flexShrink: 0, display: 'flex', alignItems: 'center', gap: 22, padding: '0 22px', borderBottom: '1px solid var(--border)' }}>
            {TABS.map(t => {
              const on = tab === t.k;
              return (
                <button key={t.k} onClick={() => setTab(t.k)}
                        style={{ background: 'transparent', border: 0, borderBottom: `2px solid ${on ? 'var(--primary)' : 'transparent'}`, padding: '13px 2px', margin: '0 0 -1px', cursor: 'pointer', fontFamily: 'inherit', fontSize: 13, fontWeight: on ? 700 : 600, color: on ? 'var(--primary)' : 'var(--ink-500)', whiteSpace: 'nowrap' }}>
                  {t.label}
                </button>
              );
            })}
            {/* 변경이력 — 스킬 버전 이력(활성화/롤백)을 LLM 스킬 관리 모드로 연다. */}
            <button onClick={() => setShowHistory(true)}
                    style={{ marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: 5, height: 30, padding: '0 12px', border: '1px solid var(--border)', borderRadius: 8, background: 'white', cursor: 'pointer', fontFamily: 'inherit', fontSize: 12, fontWeight: 700, color: 'var(--ink-600)', whiteSpace: 'nowrap' }}>
              <Icon name="history" size={13} />변경이력
            </button>
          </div>

          {/* Content */}
          {tab === 'skillset' && (
            <React.Fragment>
              <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '18px 22px 22px' }}>
                <SkillsetTab key={selDim} judgments={dimJudgments} onDelete={deleteSkill} />
              </div>
              {/* 최종 평가 프롬프트 — 하단 고정 (절반) */}
              <div style={{ flex: 1, minHeight: 0, borderTop: '1px solid var(--border)', background: 'var(--background-soft)', padding: '14px 22px 18px', overflowY: 'auto', display: 'flex', flexDirection: 'column' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 12 }}>
                  <Icon name="file-text" size={14} style={{ color: 'var(--primary)' }} />
                  <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--ink-900)', whiteSpace: 'nowrap' }}>최종 평가 프롬프트</span>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11, color: 'var(--ink-400)', marginLeft: 4 }}><Icon name="refresh-cw" size={11} />자동 반영</span>
                </div>
                <FinalPromptTab
                  overlay={dimOverlay?.overlay}
                  changed={dimOverlay?.changed}
                  goldenCount={dimGolden.length}
                  version={skillVer}
                  skillLoading={skillLoading}
                  skillErr={skillErr}
                />
              </div>
            </React.Fragment>
          )}
          {tab === 'golden' && (
            <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '18px 22px 22px' }}>
              <GoldenTab key={selDim} cases={dimGolden} onDelete={deleteGold} />
            </div>
          )}
        </div>
      </div>

      {showHistory && (
        <HistoryModal initialSkillMode departments={['기본']} onClose={() => setShowHistory(false)} />
      )}
    </div>
  );
}

export default AdminSkills;
