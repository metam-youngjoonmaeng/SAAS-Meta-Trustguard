// MTG server/index.js → server/routes/*.mjs 도메인 분리 도구 (acorn + eslint-scope 정적 분석).
//
//   node split_index.mjs            # 분석만(dry-run) — 도메인별 라우트·이동 헬퍼·ctx·경고 출력
//   node split_index.mjs --write    # 실제 생성: server/routes/<domain>.mjs 작성 + index.js 재작성 (+ .bak)
//
// 원칙
//   · 라우트 문장(app.get/post/put/patch/delete)은 **원문 그대로** 옮긴다 — callee 의 `app` 만 `router` 로.
//   · 그 도메인 라우트에서만 참조되는 최상위 선언(함수·const·let)은 함께 옮긴다(참조 전수는 eslint-scope 로 계산).
//   · 남는 자유 식별자는 index.js 가 `create<X>Routes({ ... })` 로 넘기는 ctx 로 받는다. import 는 모듈이 직접 import.
//   · 원문 순서 보존: 옮긴 문장은 원래 순서대로, index.js 의 마운트는 그 도메인 첫 라우트 자리에 둔다.
//   · 재들여쓰기(+4) 는 템플릿 리터럴 내부 줄에는 적용하지 않는다(SQL·메시지 바이트 보존).
//   · 검증: 생성 모듈·index.js 각각 미해결 식별자 0(전역 제외), (method, path) 다중집합 동일, 섀도잉 검사.

import fs from 'node:fs';
import path from 'node:path';
import * as acorn from 'acorn';
import * as eslintScope from 'eslint-scope';

const REPO = 'C:/Users/META M/Desktop/SAAS-Meta-Trustguard';
const INDEX = path.join(REPO, 'server/index.js');
const ROUTES_DIR = path.join(REPO, 'server/routes');
const WRITE = process.argv.includes('--write');
const METHODS = new Set(['get', 'post', 'put', 'patch', 'delete']);

// 도메인 표 — 순서대로 첫 매치. (name, file, factory, label, test)
const DOMAINS = [
    { name: 'svc', file: 'svc.mjs', factory: 'createSvcRoutes', label: '서비스 연동 (health · svc · realtime · ipcc)', test: (p) => /^\/api\/(health$|svc\/|realtime\/|ipcc\/)/.test(p) },
    { name: 'auth', file: 'auth.mjs', factory: 'createAuthRoutes', label: '인증 · 세션 · 조직 전환', test: (p) => /^\/api\/auth\//.test(p) },
    { name: 'coaching', file: 'coaching.mjs', factory: 'createCoachingRoutes', label: '코칭 · 튜터 시나리오 · 상담사별 콜', test: (p) => /^\/api\/(coaching(\/|$)|tutor\/|agents\/:agentId\/calls)/.test(p) },
    { name: 'calls', file: 'calls.mjs', factory: 'createCallRoutes', label: '콜 목록 · 상담사 · 통계 · 평가 상세/수정 · 검수', test: (p) => /^\/api\/(calls(\/|$)|agents$|stats$|analysis\/|evaluations\/)/.test(p) },
    { name: 'golden', file: 'golden.mjs', factory: 'createGoldenRoutes', label: '골든셋 · 스킬셋 지정', test: (p) => /^\/api\/(golden-set|skillset)(\/|$)/.test(p) },
    { name: 'evalItems', file: 'evalItems.mjs', factory: 'createEvalItemRoutes', label: '평가항목 · 버전 · 이력 · 펜타곤 축 · KSQI 카탈로그', test: (p) => /^\/api\/(admin\/eval-items|admin\/eval-item-versions|admin\/eval-item-history|admin\/pentagon-axes|ksqi-stt\/catalog)/.test(p) },
    { name: 'kms', file: 'kms.mjs', factory: 'createKmsRoutes', label: 'KMS 업무 데이터 · 색인', test: (p) => /^\/api\/admin\/kms-/.test(p) },
    { name: 'ragLlm', file: 'ragLlm.mjs', factory: 'createRagLlmRoutes', label: 'LLM 백엔드 조회 · RAG 벡터 백엔드 전환 · RAG 로그/few-shot 설정', test: (p) => /^\/api\/(llm\/backends|rag\/backend|rag-log\/|rag-fewshot-config)/.test(p) },
    { name: 'ingest', file: 'ingest.mjs', factory: 'createIngestRoutes', label: '외부 적재 (AI Canvas · 컬렉션 콜 · QA 파이프라인 · 배치 job)', test: (p) => /^\/api\/ingest\//.test(p) },
    { name: 'ta', file: 'ta.mjs', factory: 'createTaRoutes', label: '내 TA 지표', test: (p) => /^\/api\/me\/ta-metrics/.test(p) },
    { name: 'batch', file: 'batch.mjs', factory: 'createBatchRoutes', label: '배치 설정 · 골든/스킬 학습 · 판정 프롬프트 · 재판정', test: (p) => /^\/api\/(batch\/|golden-learn\/|skill-learn\/|skill-log\/|skill-memory)/.test(p) },
];

const JS_GLOBALS = new Set([
    'console', 'process', 'Buffer', 'fetch', 'AbortSignal', 'AbortController', 'URL', 'URLSearchParams', 'JSON', 'Math', 'Date',
    'Number', 'String', 'Boolean', 'Array', 'Object', 'Promise', 'Error', 'TypeError', 'RangeError', 'Map', 'Set', 'WeakMap', 'WeakSet',
    'Symbol', 'RegExp', 'parseInt', 'parseFloat', 'isNaN', 'isFinite', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval',
    'setImmediate', 'queueMicrotask', 'structuredClone', 'encodeURIComponent', 'decodeURIComponent', 'encodeURI', 'decodeURI',
    'undefined', 'NaN', 'Infinity', 'globalThis', 'TextEncoder', 'TextDecoder', 'Intl', 'Reflect', 'Proxy', 'BigInt', 'Uint8Array',
    'ArrayBuffer', 'DataView', 'Response', 'Request', 'Headers', 'FormData', 'Blob', 'performance', 'crypto', 'atob', 'btoa', 'escape', 'unescape',
]);

// ── 파싱 ────────────────────────────────────────────────────────────────────────
function parse(src) {
    const comments = [];
    const ast = acorn.parse(src, { ecmaVersion: 'latest', sourceType: 'module', locations: true, ranges: true, onComment: comments });
    const sm = eslintScope.analyze(ast, { ecmaVersion: 2022, sourceType: 'module' });
    const moduleScope = sm.globalScope.childScopes.find((s) => s.type === 'module') || sm.globalScope.childScopes[0];
    return { ast, comments, sm, moduleScope };
}

function unresolvedNames(sm) {
    const names = new Set();
    for (const ref of sm.globalScope.through) names.add(ref.identifier.name);
    return names;
}

function templateRanges(ast) {
    const out = [];
    (function walk(n) {
        if (!n || typeof n.type !== 'string') return;
        if (n.type === 'TemplateElement') out.push([n.start, n.end]);
        for (const k of Object.keys(n)) {
            if (k === 'loc' || k === 'range') continue;
            const v = n[k];
            if (Array.isArray(v)) v.forEach(walk);
            else if (v && typeof v.type === 'string') walk(v);
        }
    })(ast);
    return out;
}

function routeInfo(stmt) {
    if (stmt.type !== 'ExpressionStatement') return null;
    const e = stmt.expression;
    if (e.type !== 'CallExpression' || e.callee.type !== 'MemberExpression') return null;
    if (e.callee.object.type !== 'Identifier' || e.callee.object.name !== 'app') return null;
    const m = e.callee.property.name;
    if (!METHODS.has(m)) return null;
    const a0 = e.arguments[0];
    if (!a0 || a0.type !== 'Literal' || typeof a0.value !== 'string') return null;
    return { method: m, path: a0.value, calleeObjRange: e.callee.object.range };
}

function leadingStart(src, comments, stmt) {
    // 문장 바로 위에 붙은 주석(사이에 공백만)을 거슬러 포함. 빈 줄 하나까지는 허용(섹션 주석 블록).
    let start = stmt.start;
    for (let i = comments.length - 1; i >= 0; i--) {
        const c = comments[i];
        if (c.end > start) continue;
        const gap = src.slice(c.end, start);
        if (gap.trim() !== '') break;
        if ((gap.match(/\n/g) || []).length > 2) break; // 빈 줄 2개 이상 떨어진 주석은 미포함
        // 앞 문장과 같은 줄에 붙은 후행 주석(`foo(); // …`)은 앞 문장 소유 — 여기서 끊는다(제거 범위 겹침 방지).
        const cls = src.lastIndexOf('\n', c.start - 1) + 1;
        if (src.slice(cls, c.start).trim() !== '') break;
        start = c.start;
    }
    // 줄 시작으로 정렬
    const ls = src.lastIndexOf('\n', start - 1) + 1;
    if (src.slice(ls, start).trim() === '') start = ls;
    return start;
}

function stmtEnd(src, stmt) {
    let end = stmt.end;
    // 같은 줄 끝의 후행 주석 포함
    const nl = src.indexOf('\n', end);
    const tail = nl === -1 ? src.slice(end) : src.slice(end, nl);
    if (tail.trim() === '' || tail.trim().startsWith('//')) end = nl === -1 ? src.length : nl + 1;
    return end;
}

function declaredNames(stmt) {
    if (stmt.type === 'FunctionDeclaration' || stmt.type === 'ClassDeclaration') return [stmt.id.name];
    if (stmt.type === 'VariableDeclaration') {
        const out = [];
        for (const d of stmt.declarations) {
            (function pat(p) {
                if (p.type === 'Identifier') out.push(p.name);
                else if (p.type === 'ObjectPattern') p.properties.forEach((pr) => pat(pr.type === 'RestElement' ? pr.argument : pr.value));
                else if (p.type === 'ArrayPattern') p.elements.filter(Boolean).forEach(pat);
                else if (p.type === 'AssignmentPattern') pat(p.left);
                else if (p.type === 'RestElement') pat(p.argument);
            })(d.id);
        }
        return out;
    }
    return [];
}

function inRanges(pos, ranges) {
    return ranges.some(([s, e]) => pos >= s && pos < e);
}

// ── 메인 ────────────────────────────────────────────────────────────────────────
const src = fs.readFileSync(INDEX, 'utf8');
const { ast, comments, sm, moduleScope } = parse(src);
const tplRanges = templateRanges(ast);
const varByName = new Map(moduleScope.variables.map((v) => [v.name, v]));
const stmts = ast.body;

// 최상위 문장 분류
const routes = [];
const decls = [];
const imports = [];
for (const s of stmts) {
    const ri = routeInfo(s);
    if (ri) { routes.push({ stmt: s, ...ri }); continue; }
    if (s.type === 'ImportDeclaration') { imports.push(s); continue; }
    if (s.type === 'FunctionDeclaration' || s.type === 'ClassDeclaration' || s.type === 'VariableDeclaration') decls.push(s);
}

// 도메인 배정
for (const r of routes) {
    r.domain = DOMAINS.find((d) => d.test(r.path))?.name || null;
    if (!r.domain) throw new Error(`도메인 미배정 라우트: ${r.method.toUpperCase()} ${r.path} (line ${r.stmt.loc.start.line})`);
}

// 참조 위치 도우미: 변수 → 선언 자신 범위 밖의 참조 위치들
function refsOf(name) {
    const v = varByName.get(name);
    if (!v) return [];
    return v.references.map((ref) => ({ pos: ref.identifier.range[0], write: ref.isWrite(), init: ref.init }));
}

// 도메인별 이동 선언 계산 (고정점)
const declOwner = new Map(); // decl stmt → domain
const declRange = (s) => [s.start, s.end];
for (const d of DOMAINS) {
    const routeRanges = routes.filter((r) => r.domain === d.name).map((r) => [r.stmt.start, r.stmt.end]);
    if (!routeRanges.length) continue;
    let changed = true;
    while (changed) {
        changed = false;
        const ownedRanges = decls.filter((s) => declOwner.get(s) === d.name).map(declRange);
        const allowed = routeRanges.concat(ownedRanges);
        for (const s of decls) {
            if (declOwner.has(s)) continue;
            const names = declaredNames(s);
            if (!names.length) continue;
            let total = 0;
            let ok = true;
            for (const n of names) {
                for (const ref of refsOf(n)) {
                    if (ref.pos >= s.start && ref.pos < s.end) continue; // 자기 선언/초기화/재귀
                    total++;
                    if (!inRanges(ref.pos, allowed)) { ok = false; break; }
                }
                if (!ok) break;
            }
            if (ok && total > 0) { declOwner.set(s, d.name); changed = true; }
        }
    }
}

// 도메인별 자유 식별자(ctx / import) 계산
const importBinding = new Map(); // local name → { source, imported, kind }
for (const im of imports) {
    for (const sp of im.specifiers) {
        importBinding.set(sp.local.name, {
            source: im.source.value,
            kind: sp.type,
            imported: sp.type === 'ImportSpecifier' ? (sp.imported.name ?? sp.imported.value) : null,
        });
    }
}

const report = [];
const plan = [];
for (const d of DOMAINS) {
    const rs = routes.filter((r) => r.domain === d.name);
    if (!rs.length) continue;
    const owned = decls.filter((s) => declOwner.get(s) === d.name);
    const moved = [...rs.map((r) => r.stmt), ...owned].sort((a, b) => a.start - b.start);
    const movedRanges = moved.map(declRange);
    const movedNames = new Set(owned.flatMap(declaredNames));
    // 이동 문장 안에서 참조되는 최상위 변수
    const ctxNames = new Set();
    const importNames = new Set();
    const mutableWarn = [];
    for (const v of moduleScope.variables) {
        const used = v.references.some((ref) => inRanges(ref.identifier.range[0], movedRanges));
        if (!used) continue;
        if (movedNames.has(v.name)) continue;
        if (v.name === 'app') continue; // callee 치환
        if (importBinding.has(v.name)) { importNames.add(v.name); continue; }
        ctxNames.add(v.name);
        const writesOutside = v.references.filter((ref) => ref.isWrite() && !ref.init && !inRanges(ref.identifier.range[0], movedRanges));
        const writesInside = v.references.filter((ref) => ref.isWrite() && inRanges(ref.identifier.range[0], movedRanges));
        const isLet = v.defs.some((df) => df.kind === 'let' || df.kind === 'var');
        if (writesInside.length) mutableWarn.push(`${v.name}: 이동 라우트 안에서 재대입(${writesInside.length}) — ctx 로 넘기면 깨짐`);
        else if (isLet && writesOutside.length) mutableWarn.push(`${v.name}: let 이고 index 쪽에서 재대입(${writesOutside.length}) — 값 복사 stale 위험`);
    }
    // ★ 마운트 위치 — 도메인 첫 라우트 자리. 단 ctx 로 넘길 const/let 이 그 뒤에 선언돼 있으면(TDZ) 그 선언 뒤로 민다.
    //   함수 선언은 호이스팅되므로 무관. 예: batch 첫 라우트 6003 < goldenLearnStatus(6090)·skillLearnStatus(6303).
    let ctxDeclEnd = -1;
    let ctxDeclStmt = null;
    for (const n of ctxNames) {
        const v = varByName.get(n);
        for (const df of v.defs) {
            if (df.type !== 'Variable') continue;
            const top = stmts.find((s) => s.start <= df.node.start && df.node.end <= s.end);
            if (top && top.end > ctxDeclEnd) { ctxDeclEnd = top.end; ctxDeclStmt = top; }
        }
    }
    const firstRoute = rs.reduce((a, r) => (r.stmt.start < a.stmt.start ? r : a), rs[0]);
    let mountPos;
    let mountNote = '';
    if (firstRoute.stmt.start > ctxDeclEnd) mountPos = leadingStart(src, comments, firstRoute.stmt);
    else {
        const later = rs.filter((r) => r.stmt.start > ctxDeclEnd).sort((a, b) => a.stmt.start - b.stmt.start)[0];
        mountPos = later ? leadingStart(src, comments, later.stmt) : stmtEnd(src, ctxDeclStmt);
        mountNote = ` (ctx 상수 ${declaredNames(ctxDeclStmt).join(',')} 선언(${ctxDeclStmt.loc.start.line}줄) 뒤로 이동 — TDZ 회피)`;
    }
    plan.push({ d, rs, owned, moved, ctxNames: [...ctxNames].sort(), importNames: [...importNames].sort(), mutableWarn, mountPos, mountNote });
}

// ── 리포트 ───────────────────────────────────────────────────────────────────────
console.log(`index.js ${src.split('\n').length}줄 · 라우트 ${routes.length} · 최상위 선언 ${decls.length} · import ${imports.length}`);
for (const p of plan) {
    console.log(`\n[${p.d.name}] ${p.d.label}`);
    console.log(`  라우트 ${p.rs.length}: ` + p.rs.map((r) => `${r.method.toUpperCase()} ${r.path}`).join(' | '));
    console.log(`  이동 선언 ${p.owned.length}: ` + p.owned.flatMap(declaredNames).join(', '));
    console.log(`  ctx ${p.ctxNames.length}: ` + p.ctxNames.join(', '));
    console.log(`  import ${p.importNames.length}: ` + p.importNames.join(', '));
    console.log(`  마운트 위치: ${src.slice(0, p.mountPos).split('\n').length}줄${p.mountNote}`);
    for (const w of p.mutableWarn) console.log(`  ★경고 ${w}`);
}
const unowned = decls.filter((s) => !declOwner.has(s));
console.log(`\nindex.js 잔류 선언 ${unowned.length}: ` + unowned.flatMap(declaredNames).slice(0, 80).join(', '));
const dead = decls.filter((s) => declaredNames(s).every((n) => refsOf(n).filter((r) => !(r.pos >= s.start && r.pos < s.end)).length === 0));
console.log(`참조 0 선언(잔류·미이동) ${dead.length}: ` + dead.flatMap(declaredNames).join(', '));

// 섀도잉 검사 — 도메인 마운트 순서(첫 라우트 위치)로 재배열했을 때, 앞 라우트 패턴이 뒤 라우트 리터럴을 삼키는지
function segMatch(pattern, literal) {
    const a = pattern.split('/'), b = literal.split('/');
    if (a.length !== b.length) return false;
    return a.every((s, i) => s.startsWith(':') || s === b[i]);
}
const newOrder = [...plan].sort((x, y) => x.mountPos - y.mountPos).flatMap((p) => p.rs);
const shadow = [];
for (let i = 0; i < newOrder.length; i++) {
    for (let j = i + 1; j < newOrder.length; j++) {
        const a = newOrder[i], b = newOrder[j];
        if (a.method !== b.method) continue;
        if (a.stmt.start < b.stmt.start) continue; // 원래도 a 가 앞 — 순서 무변경
        if (a.path.includes(':') && segMatch(a.path, b.path)) shadow.push(`${a.method.toUpperCase()} ${a.path} 가 ${b.path} 를 가림(순서 역전)`);
    }
}
console.log(`\n섀도잉(순서 역전으로 새로 생기는 것) ${shadow.length}: ` + shadow.join(' | '));

if (!WRITE) { console.log('\n(dry-run) --write 로 생성'); process.exit(0); }

// ── 생성 ────────────────────────────────────────────────────────────────────────
function relSource(s) {
    if (s.startsWith('./')) return '../' + s.slice(2);
    if (s.startsWith('../')) return '../' + s;
    return s;
}
function reindent(text, absStart) {
    // text 는 src.slice(absStart, …). 각 줄의 시작 절대 오프셋이 템플릿 리터럴 안이면 들여쓰기 생략.
    const lines = text.split('\n');
    let off = absStart;
    const out = lines.map((line) => {
        const lineStart = off;
        off += line.length + 1;
        if (line.trim() === '') return '';
        if (inRanges(lineStart, tplRanges)) return line;
        return '    ' + line;
    });
    return out.join('\n');
}

fs.mkdirSync(ROUTES_DIR, { recursive: true });
const removals = []; // [start, end]
const inserts = [];  // { pos, text }
for (const p of plan) {
    // 모듈 본문 — 원문 순서, 라우트는 app.→router.
    const parts = [];
    for (const s of p.moved) {
        const ls = leadingStart(src, comments, s);
        const le = stmtEnd(src, s);
        let text = src.slice(ls, le);
        const r = p.rs.find((x) => x.stmt === s);
        if (r) {
            const [cs, ce] = r.calleeObjRange;
            text = src.slice(ls, cs) + 'router' + src.slice(ce, le);
        }
        parts.push(reindent(text.replace(/\n+$/, ''), ls));
        removals.push([ls, le]);
    }
    // import 줄
    const bySource = new Map();
    for (const n of p.importNames) {
        const b = importBinding.get(n);
        const key = b.source;
        if (!bySource.has(key)) bySource.set(key, { def: null, ns: null, named: [] });
        const g = bySource.get(key);
        if (b.kind === 'ImportDefaultSpecifier') g.def = n;
        else if (b.kind === 'ImportNamespaceSpecifier') g.ns = n;
        else g.named.push(b.imported === n ? n : `${b.imported} as ${n}`);
    }
    const importLines = ["import express from 'express';"];
    for (const [source, g] of [...bySource.entries()].sort()) {
        const head = [];
        if (g.def) head.push(g.def);
        if (g.ns) head.push(`* as ${g.ns}`);
        if (g.named.length) head.push(`{ ${g.named.sort().join(', ')} }`);
        importLines.push(`import ${head.join(', ')} from '${relSource(source)}';`);
    }
    const header = [
        `// ${p.d.label} 라우트 — server/index.js 에서 분리 (2026-09-03).`,
        `//`,
        `// 라우트 ${p.rs.length}개 · 함께 옮긴 헬퍼/상태 ${p.owned.length}개. 본문은 index.js 원문 그대로(경로·메서드·순서·핸들러 무변경),`,
        `// callee 만 app→router. 이 파일 라우트에서만 쓰이던 선언만 여기로 왔고, 다른 곳도 쓰는 공통 헬퍼`,
        `// (pool·requireAdmin·resolveActiveOrgId 등)는 index.js 가 ctx 로 넘긴다 — 등록: app.use(${p.d.factory}({ ... })).`,
        `// 전역 인증 미들웨어(app.use, index.js)는 마운트 앞에 있으므로 종전과 같이 적용된다.`,
    ];
    const body = [
        ...header,
        '',
        ...importLines,
        '',
        `export function ${p.d.factory}(ctx) {`,
        p.ctxNames.length ? `    const { ${p.ctxNames.join(', ')} } = ctx;` : '    void ctx;',
        '    const router = express.Router();',
        '',
        parts.join('\n\n'),
        '',
        '    return router;',
        '}',
        '',
    ].join('\n');
    fs.writeFileSync(path.join(ROUTES_DIR, p.d.file), body, 'utf8');
    inserts.push({
        pos: p.mountPos,
        text: `// ── ${p.d.label} — server/routes/${p.d.file} 로 분리(2026-09-03). 경로·메서드·순서 무변경, 공통 헬퍼는 ctx 로 전달.` +
            (p.mountNote ? `\n//    ${p.mountNote.trim()}` : '') + '\n' +
            `app.use(${p.d.factory}({ ${p.ctxNames.join(', ')} }));\n\n`,
    });
}

// index.js 재작성 — 제거 + 마운트 삽입 (위치 정렬 이벤트 처리; 같은 위치면 삽입이 제거보다 먼저)
const events = [
    ...removals.map(([s, e]) => ({ pos: s, kind: 1, s, e })),
    ...inserts.map((i) => ({ pos: i.pos, kind: 0, text: i.text })),
].sort((a, b) => a.pos - b.pos || a.kind - b.kind);
let out = '';
let cursor = 0;
for (const ev of events) {
    if (ev.pos < cursor) throw new Error(`편집 겹침: pos=${ev.pos} cursor=${cursor}`);
    out += src.slice(cursor, ev.pos);
    if (ev.kind === 0) { out += ev.text; cursor = ev.pos; }
    else cursor = ev.e;
}
out += src.slice(cursor);

// 라우트 모듈 import 추가 — 마지막 import 문 뒤
const lastImport = imports[imports.length - 1];
const importText = plan.map((p) => `import { ${p.d.factory} } from './routes/${p.d.file}';`).join('\n');
const liEnd = stmtEnd(src, lastImport);
// out 에서 lastImport 의 위치는 그대로(그 앞에 제거 없음 — import 는 파일 상단)
const liEndInOut = liEnd; // 상단은 무변경 구간
out = out.slice(0, liEndInOut) + importText + '\n' + out.slice(liEndInOut);

// 미사용 import 정리 + 빈 줄 3개 이상 축약
let pass = parse(out);
const unusedSpecs = [];
for (const im of pass.ast.body.filter((s) => s.type === 'ImportDeclaration')) {
    for (const sp of im.specifiers) {
        const v = pass.moduleScope.set.get(sp.local.name);
        if (v && v.references.length === 0) unusedSpecs.push({ im, sp });
    }
}
if (unusedSpecs.length) {
    // 뒤에서부터 제거
    const edits = [];
    const byIm = new Map();
    for (const u of unusedSpecs) { if (!byIm.has(u.im)) byIm.set(u.im, []); byIm.get(u.im).push(u.sp); }
    for (const [im, sps] of byIm) {
        if (sps.length === im.specifiers.length) { edits.push([im.start, stmtEnd(out, im), '']); continue; }
        const keep = im.specifiers.filter((s) => !sps.includes(s));
        const named = keep.filter((s) => s.type === 'ImportSpecifier').map((s) => (s.imported.name === s.local.name ? s.local.name : `${s.imported.name} as ${s.local.name}`));
        const def = keep.find((s) => s.type === 'ImportDefaultSpecifier');
        const head = [];
        if (def) head.push(def.local.name);
        if (named.length) head.push(`{ ${named.join(', ')} }`);
        edits.push([im.start, im.end, `import ${head.join(', ')} from '${im.source.value}';`]);
    }
    edits.sort((a, b) => b[0] - a[0]);
    for (const [s, e, t] of edits) out = out.slice(0, s) + t + out.slice(e);
    console.log(`\n미사용 import 정리: ${unusedSpecs.map((u) => u.sp.local.name).join(', ')}`);
}
out = out.replace(/\n{4,}/g, '\n\n\n');

// 백업 + 쓰기
const bak = INDEX + '.bak_split_0903';
if (!fs.existsSync(bak)) fs.copyFileSync(INDEX, bak);
fs.writeFileSync(INDEX, out, 'utf8');
console.log(`\nindex.js ${src.split('\n').length} → ${out.split('\n').length}줄 · 백업 ${path.basename(bak)}`);

// ── 검증 ────────────────────────────────────────────────────────────────────────
let bad = 0;
function checkModule(file) {
    const text = fs.readFileSync(file, 'utf8');
    let parsed;
    try { parsed = parse(text); } catch (e) { console.log(`  ✗ ${path.basename(file)} 파싱 실패: ${e.message}`); bad++; return null; }
    const unresolved = [...unresolvedNames(parsed.sm)].filter((n) => !JS_GLOBALS.has(n));
    if (unresolved.length) { console.log(`  ✗ ${path.basename(file)} 미해결 식별자: ${unresolved.join(', ')}`); bad++; }
    else console.log(`  ✓ ${path.basename(file)} 미해결 식별자 0 (${text.split('\n').length}줄)`);
    return text;
}
console.log('\n검증:');
const newIndex = checkModule(INDEX);
const routeSig = (m, p) => `${m.toUpperCase()} ${p}`;
const before = routes.map((r) => routeSig(r.method, r.path)).sort();
const after = [];
for (const p of plan) {
    const text = checkModule(path.join(ROUTES_DIR, p.d.file));
    if (!text) continue;
    const parsed = parse(text);
    (function walk(n) {
        if (!n || typeof n.type !== 'string') return;
        if (n.type === 'CallExpression' && n.callee.type === 'MemberExpression' && n.callee.object.name === 'router' && METHODS.has(n.callee.property.name) && n.arguments[0]?.type === 'Literal') after.push(routeSig(n.callee.property.name, n.arguments[0].value));
        for (const k of Object.keys(n)) { if (k === 'loc' || k === 'range') continue; const v = n[k]; if (Array.isArray(v)) v.forEach(walk); else if (v && typeof v.type === 'string') walk(v); }
    })(parsed.ast);
}
if (newIndex) {
    const parsed = parse(newIndex);
    for (const s of parsed.ast.body) { const ri = routeInfo(s); if (ri) after.push(routeSig(ri.method, ri.path)); }
}
after.sort();
const same = JSON.stringify(before) === JSON.stringify(after);
console.log(`  ${same ? '✓' : '✗'} 라우트 (method,path) 다중집합 ${same ? '동일' : '불일치'} — 전 ${before.length} / 후 ${after.length}`);
if (!same) { bad++; console.log('   전-후:', before.filter((x) => !after.includes(x)).join(' | ')); console.log('   후-전:', after.filter((x) => !before.includes(x)).join(' | ')); }
process.exit(bad ? 1 : 0);
