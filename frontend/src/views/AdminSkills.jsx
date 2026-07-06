// AI 스킬 관리 — 평가 항목별로 골든셋(정답 사례)과 스킬셋(높음/낮음 보정)을 관리.
// 골든셋: 평가리스트에서 '골든셋'으로 체크한 사례 → few-shot 주입
// 스킬셋: 수기평가에서 '동일'이 아닌(높음/낮음) 판정 누적 → 평가 프롬프트 보정 문구
// 최종 프롬프트 = 기본 프롬프트 + (반영된) 스킬셋 보정 + 골든셋 few-shot
// etc/pages-skills.jsx 프로토타입 이식(1단계 UI). 스타일은 .tg-eval 스코프(evalMgmt.css) 재사용.
import React, { useState as useState_sk, useMemo as useMemo_sk } from 'react';
import { Icon, PageHead } from './evalMgmt/ui';
import { DIM_GROUPS, DIMENSIONS, MANUAL_JUDGMENTS, GOLDEN_SET, BASE_PROMPTS } from './skills/skillsData';

const OUTCOME_META = {
  good: { label: '모범', color: 'var(--success)', bg: 'var(--success-soft)' },
  mid:  { label: '양호', color: 'var(--primary)', bg: 'var(--primary-soft-flat)' },
  warn: { label: '주의', color: 'var(--warning-ink)', bg: 'var(--warning-soft)' },
  bad:  { label: '위반', color: 'var(--destructive-ink)', bg: 'var(--destructive-soft)' },
};

// 반영된 판정 → 보정 문구 초안 생성
function buildCorrections(judgments) {
  const reflected = judgments.filter(j => j.reflected);
  const up = reflected.filter(j => j.judgment === '높음');   // AI가 낮게 줌 → 더 후하게
  const down = reflected.filter(j => j.judgment === '낮음'); // AI 과대평가 → 더 엄격하게
  const lines = [];
  if (up.length) {
    lines.push({
      dir: 'up',
      title: '다음과 같은 경우 과소평가하지 마세요 (점수를 낮게 주지 말 것)',
      items: up.map(j => j.reason),
    });
  }
  if (down.length) {
    lines.push({
      dir: 'down',
      title: '다음과 같은 경우 관대하게 평가하지 마세요 (점수를 높게 주지 말 것)',
      items: down.map(j => j.reason),
    });
  }
  return lines;
}

function composeFinalPrompt(base, corrections, goldenCount) {
  let out = base || '';
  if (corrections.length) {
    out += '\n\n[검수자 보정 기준 — 수기평가 학습 반영]';
    corrections.forEach(c => {
      out += `\n\n· ${c.title}`;
      c.items.forEach(it => { out += `\n   - ${it}`; });
    });
  }
  if (goldenCount > 0) {
    out += `\n\n[참고 사례]\n유사한 골든셋 사례 ${goldenCount}건이 few-shot 예시로 자동 주입됩니다.`;
  }
  return out;
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
          <col style={{ width: 24 }} /><col style={{ width: 112 }} /><col style={{ width: 118 }} /><col style={{ width: 84 }} /><col /><col style={{ width: 96 }} /><col style={{ width: 34 }} />
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
                  <td style={{ textAlign: 'left' }}><span className="mono" style={{ fontSize: 12, fontWeight: 700, color: 'var(--ink-900)' }}>{j.sessionId}</span></td>
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
                  <td style={{ textAlign: 'center' }} onClick={e => e.stopPropagation()}><DeleteIcon onClick={() => onDelete(j.id)} /></td>
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
          <col style={{ width: 24 }} /><col style={{ width: 112 }} /><col style={{ width: 118 }} /><col style={{ width: 84 }} /><col /><col style={{ width: 72 }} /><col style={{ width: 34 }} />
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
                  <td style={{ textAlign: 'left' }}><span className="mono" style={{ fontSize: 12, fontWeight: 700, color: 'var(--ink-900)' }}>{c.callId}</span></td>
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
                  <td style={{ textAlign: 'center' }} onClick={e => e.stopPropagation()}><DeleteIcon onClick={() => onDelete(c.id)} /></td>
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
function FinalPromptTab({ base, corrections, goldenCount }) {
  const finalText = useMemo_sk(() => composeFinalPrompt(base, corrections, goldenCount), [base, corrections, goldenCount]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ fontSize: 12, color: 'var(--ink-500)', lineHeight: 1.5 }}>
        기본 프롬프트에 <strong>스킬셋 보정</strong>과 <strong>골든셋 few-shot</strong>이 합쳐진 프롬프트로, 목록 변경 시 자동 갱신됩니다.
      </div>

      <div style={{
        border: '1px solid var(--border)', borderRadius: 12, background: 'var(--background-soft)',
        padding: '16px 18px', fontFamily: 'var(--font-mono, monospace)', fontSize: 12.5, lineHeight: 1.7,
        color: 'var(--ink-800, var(--ink-900))', whiteSpace: 'pre-wrap',
      }}>
        {renderPromptWithHighlights(base, finalText)}
      </div>
    </div>
  );
}

// 기본 프롬프트 부분은 일반색, 보정/사례 부분은 강조 배경
function renderPromptWithHighlights(base, finalText) {
  if (!finalText.startsWith(base)) return finalText;
  const rest = finalText.slice(base.length);
  return (
    <React.Fragment>
      <span>{base}</span>
      <span style={{ display: 'block', background: 'var(--primary-soft-flat)', margin: '10px -18px -16px', padding: '12px 18px 16px', borderTop: '1px dashed var(--primary-soft-border)', color: 'var(--ink-800, var(--ink-900))' }}>{rest.replace(/^\n+/, '')}</span>
    </React.Fragment>
  );
}

// ── 메인 페이지 ───────────────────────────────────────
function AdminSkills() {
  const [selDim, setSelDim] = useState_sk(DIMENSIONS[0].key);
  const [tab, setTab] = useState_sk('skillset');
  const [delSkill, setDelSkill] = useState_sk(() => new Set());
  const [delGold, setDelGold] = useState_sk(() => new Set());

  const allJudgments = (MANUAL_JUDGMENTS || []).filter(j => !delSkill.has(j.id));
  const allGolden = (GOLDEN_SET || []).filter(g => !delGold.has(g.id));

  const dim = DIMENSIONS.find(d => d.key === selDim);
  const dimGroup = DIM_GROUPS.find(g => g.key === dim.group);
  const dimJudgments = allJudgments.filter(j => j.dim === selDim);
  const dimGolden = allGolden.filter(g => g.dim === selDim);
  const corrections = buildCorrections(dimJudgments.filter(j => j.reflected));
  const base = (BASE_PROMPTS || {})[selDim] || '이 항목을 평가 기준에 따라 0~100점으로 평가하세요.';

  const deleteSkill = (id) => setDelSkill(s => new Set(s).add(id));
  const deleteGold = (id) => setDelGold(s => new Set(s).add(id));

  const countFor = (key) => ({
    skill: allJudgments.filter(j => j.dim === key).length,
    reflected: allJudgments.filter(j => j.dim === key && j.reflected).length,
    gold: allGolden.filter(g => g.dim === key).length,
  });

  const TABS = [
    { k: 'skillset', label: `스킬셋 ${dimJudgments.length}` },
    { k: 'golden',   label: `골든셋 ${dimGolden.length}` },
  ];

  return (
    <div className="tg-eval">
      <PageHead title="AI 스킬 관리"
                sub="평가 항목별로 골든셋(정답 사례)과 스킬셋(높음/낮음 보정)을 관리해 LLM 평가 정확도를 높입니다." />

      <div className="grid grid-list-detail" style={{ gridTemplateColumns: '290px minmax(0, 1fr)', alignItems: 'stretch', height: 'calc(100vh - 230px)', minHeight: 560 }}>
        {/* 좌측: 평가 항목 목록 */}
        <div className="panel" style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          <div className="panel-head" style={{ flexShrink: 0 }}>
            <h3 style={{ whiteSpace: 'nowrap' }}>평가 항목</h3>
            <span className="muted-text" style={{ whiteSpace: 'nowrap' }}>{DIMENSIONS.length}개</span>
          </div>
          <div style={{ padding: '8px', flex: 1, overflowY: 'auto' }}>
            {DIMENSIONS.map((d, idx) => {
              const on = selDim === d.key;
              const g = DIM_GROUPS.find(x => x.key === d.group);
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
                      <span style={{ fontSize: 10.5, fontWeight: 600, color: 'var(--ink-400)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{g?.label}</span>
                    </div>
                    <div style={{ fontSize: 13.5, fontWeight: on ? 700 : 600, color: on ? 'var(--primary)' : 'var(--ink-900)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{d.label}</div>
                  </div>
                  <span style={{ flexShrink: 0, display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                    {c.gold > 0 && (
                      <span title="골든셋" style={{ display: 'inline-flex', alignItems: 'center', gap: 2, fontSize: 10.5, fontWeight: 700, color: 'var(--gold-ink)' }}>
                        <Icon name="star" size={10} style={{ fill: 'var(--gold-fill)', color: 'var(--gold)' }} />{c.gold}
                      </span>
                    )}
                    {c.reflected > 0 && (
                      <span title="반영된 스킬셋" style={{ minWidth: 18, textAlign: 'center', fontSize: 10.5, fontWeight: 700, padding: '1px 6px', borderRadius: 9999, background: on ? 'var(--primary-soft-flat)' : 'var(--muted)', color: on ? 'var(--primary)' : 'var(--ink-500)' }}>{c.reflected}</span>
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
            <span style={{ fontSize: 12, color: 'var(--ink-400)', fontWeight: 600, whiteSpace: 'nowrap' }}>{dimGroup?.label}</span>
            {corrections.length > 0 && (
              <span style={{ marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11, fontWeight: 700, padding: '3px 10px', borderRadius: 9999, background: 'var(--primary-soft)', color: 'var(--primary)', whiteSpace: 'nowrap' }}>
                <Icon name="refresh-cw" size={11} />프롬프트 자동 반영 중
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
                <FinalPromptTab base={base} corrections={corrections} goldenCount={dimGolden.length} />
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
    </div>
  );
}

export default AdminSkills;
