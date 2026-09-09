// MTG server/ 전수 감사 — 미사용·중복·충돌 (acorn + eslint-scope).
//   node server_audit.mjs            # 리포트
//   node server_audit.mjs --json out.json
//
// 항목
//   A. 파일별 미사용 import 스펙(참조 0)
//   B. 파일별 참조 0 최상위 선언(export 아님) = 내부 데드코드
//   C. export 됐지만 어느 파일도 import 하지 않는 이름(데드 export 후보 — 스크립트/외부 사용 가능성은 사람이 판단)
//   D. 같은 이름의 최상위 함수/상수가 여러 파일에 정의 — 본문 동일(=중복) / 상이(=충돌 후보)
//   E. 라우트 중복 — 같은 (method, path) 가 2회 이상 등록 (app.* / router.*)
//   F. 백업·임시 파일(.bak*, .orig, ~)
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import * as acorn from 'acorn';
import * as eslintScope from 'eslint-scope';

const SERVER = 'C:/Users/META M/Desktop/SAAS-Meta-Trustguard/server';
const METHODS = new Set(['get', 'post', 'put', 'patch', 'delete', 'all']);

function listFiles(dir) {
    const out = [];
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) { if (e.name !== 'node_modules') out.push(...listFiles(p)); continue; }
        out.push(p);
    }
    return out;
}
const all = listFiles(SERVER);
const codeFiles = all.filter((f) => /\.(mjs|js)$/.test(f) && !/\.bak/.test(f));
const junk = all.filter((f) => /\.bak|\.orig$|~$|\.tmp$/.test(f));

function parse(src) {
    const ast = acorn.parse(src, { ecmaVersion: 'latest', sourceType: 'module', locations: true, ranges: true });
    const sm = eslintScope.analyze(ast, { ecmaVersion: 2022, sourceType: 'module' });
    const ms = sm.globalScope.childScopes.find((s) => s.type === 'module') || sm.globalScope.childScopes[0];
    return { ast, sm, ms };
}
function declaredNames(stmt) {
    if (stmt.type === 'FunctionDeclaration' || stmt.type === 'ClassDeclaration') return [stmt.id.name];
    if (stmt.type === 'VariableDeclaration') {
        const out = [];
        for (const d of stmt.declarations) (function pat(p) {
            if (!p) return;
            if (p.type === 'Identifier') out.push(p.name);
            else if (p.type === 'ObjectPattern') p.properties.forEach((pr) => pat(pr.type === 'RestElement' ? pr.argument : pr.value));
            else if (p.type === 'ArrayPattern') p.elements.forEach(pat);
            else if (p.type === 'AssignmentPattern') pat(p.left);
            else if (p.type === 'RestElement') pat(p.argument);
        })(d.id);
        return out;
    }
    return [];
}
function norm(s) { return s.replace(/\s+/g, ' ').trim(); }

const files = {};
const exportsByFile = {};   // file → Set(names)
const importsOf = {};       // file → [{source, names[]}]
const defs = {};            // name → [{file, kind, hash, line, len}]
const routes = [];          // {method, path, file, line}
const report = { unusedImports: [], deadDecls: [], deadExports: [], dupDefs: [], dupRoutes: [], junk: junk.map((f) => path.relative(SERVER, f)) };

for (const f of codeFiles) {
    const src = fs.readFileSync(f, 'utf8');
    let parsed;
    try { parsed = parse(src); } catch (e) { console.log('parse fail', f, e.message); continue; }
    const { ast, ms } = parsed;
    const rel = path.relative(SERVER, f).replace(/\\/g, '/');
    files[rel] = { src, ast, ms };
    exportsByFile[rel] = new Set();
    importsOf[rel] = [];
    for (const s of ast.body) {
        if (s.type === 'ImportDeclaration') {
            importsOf[rel].push({ source: s.source.value, names: s.specifiers.map((sp) => (sp.type === 'ImportSpecifier' ? (sp.imported.name ?? sp.imported.value) : sp.type === 'ImportDefaultSpecifier' ? 'default' : '*')) });
            for (const sp of s.specifiers) {
                const v = ms.set.get(sp.local.name);
                if (v && v.references.length === 0) report.unusedImports.push({ file: rel, name: sp.local.name, line: s.loc.start.line });
            }
        }
        if (s.type === 'ExportNamedDeclaration') {
            if (s.declaration) declaredNames(s.declaration).forEach((n) => exportsByFile[rel].add(n));
            for (const sp of s.specifiers || []) exportsByFile[rel].add(sp.exported.name ?? sp.exported.value);
        }
        if (s.type === 'ExportDefaultDeclaration') exportsByFile[rel].add('default');
        const declStmt = s.type === 'ExportNamedDeclaration' && s.declaration ? s.declaration : s;
        if (['FunctionDeclaration', 'ClassDeclaration', 'VariableDeclaration'].includes(declStmt.type)) {
            const exported = s.type === 'ExportNamedDeclaration';
            for (const n of declaredNames(declStmt)) {
                const v = ms.set.get(n);
                const outsideRefs = v ? v.references.filter((r) => !(r.identifier.range[0] >= declStmt.start && r.identifier.range[0] < declStmt.end)) : [];
                if (!exported && outsideRefs.length === 0) report.deadDecls.push({ file: rel, name: n, line: declStmt.loc.start.line, kind: declStmt.type });
                // 중복 정의 후보 — 함수/상수 본문 해시(선언자 단위)
                let body = null;
                if (declStmt.type === 'FunctionDeclaration') body = src.slice(declStmt.start, declStmt.end);
                else if (declStmt.type === 'VariableDeclaration') { const d = declStmt.declarations.find((dd) => declaredNames({ type: 'VariableDeclaration', declarations: [dd] }).includes(n)); if (d?.init) body = src.slice(d.init.start, d.init.end); }
                if (body !== null) {
                    (defs[n] ||= []).push({ file: rel, kind: declStmt.type, hash: crypto.createHash('md5').update(norm(body)).digest('hex').slice(0, 8), line: declStmt.loc.start.line, len: body.length });
                }
            }
        }
    }
    // 라우트 등록 전수
    (function walk(n) {
        if (!n || typeof n.type !== 'string') return;
        if (n.type === 'CallExpression' && n.callee.type === 'MemberExpression' && ['app', 'router', 'r'].includes(n.callee.object.name) && METHODS.has(n.callee.property.name) && n.arguments[0]?.type === 'Literal' && typeof n.arguments[0].value === 'string') {
            routes.push({ method: n.callee.property.name.toUpperCase(), path: n.arguments[0].value, file: rel, line: n.loc.start.line, mounted: n.callee.object.name === 'router' || n.callee.object.name === 'r' });
        }
        for (const k of Object.keys(n)) { if (k === 'loc' || k === 'range') continue; const v = n[k]; if (Array.isArray(v)) v.forEach(walk); else if (v && typeof v.type === 'string') walk(v); }
    })(ast);
}

// C. 데드 export — 다른 파일이 import 하지 않는 export
const importedNames = {}; // file → Set(names imported from it)
for (const [rel, ims] of Object.entries(importsOf)) {
    for (const im of ims) {
        if (!im.source.startsWith('.')) continue;
        const target = path.relative(SERVER, path.resolve(path.join(SERVER, path.dirname(rel)), im.source)).replace(/\\/g, '/');
        (importedNames[target] ||= new Set());
        im.names.forEach((n) => importedNames[target].add(n));
    }
}
for (const [rel, exps] of Object.entries(exportsByFile)) {
    for (const n of exps) {
        const used = importedNames[rel]?.has(n) || importedNames[rel]?.has('*');
        if (used) continue;
        // 파일 내부 참조 수(선언 자신 제외) — 0 이면 완전 데드, >0 이면 export 만 불필요
        const v = files[rel].ms.set.get(n);
        let internal = 0;
        if (v) {
            const defRanges = v.defs.map((d) => [d.node.start, d.node.end]);
            internal = v.references.filter((r) => !defRanges.some(([s, e]) => r.identifier.range[0] >= s && r.identifier.range[0] < e)).length;
        }
        report.deadExports.push({ file: rel, name: n, internal });
    }
}
// D. 중복 정의
for (const [name, list] of Object.entries(defs)) {
    if (list.length < 2) continue;
    const hashes = new Set(list.map((d) => d.hash));
    report.dupDefs.push({ name, same: hashes.size === 1, where: list.map((d) => `${d.file}:${d.line}(${d.kind === 'FunctionDeclaration' ? 'fn' : 'var'},${d.len}자,${d.hash})`) });
}
// E. 라우트 중복 — 라우터 파일의 router.* 는 index 가 prefix 없이(app.use(fn(...))) 또는 '/api' prefix 로 마운트. brandRoutes 류는 '/api' prefix + 경로가 '/admin/...' 형태.
function fullPath(r) {
    if (!r.mounted) return r.path;
    if (r.file.startsWith('routes/')) return r.path; // 분리 라우터: 절대 경로 그대로
    return r.path.startsWith('/api/') ? r.path : '/api' + r.path; // 기존 서브라우터: app.use('/api', …)
}
const seen = new Map();
for (const r of routes) {
    const key = `${r.method} ${fullPath(r)}`;
    if (seen.has(key)) report.dupRoutes.push({ key, a: seen.get(key), b: `${r.file}:${r.line}` });
    else seen.set(key, `${r.file}:${r.line}`);
}

// 출력
const rel = (f) => f;
console.log(`파일 ${codeFiles.length}개 · 라우트 등록 ${routes.length}개 · export ${Object.values(exportsByFile).reduce((a, s) => a + s.size, 0)}개`);
console.log(`\nA. 미사용 import ${report.unusedImports.length}`);
for (const u of report.unusedImports) console.log(`  ${u.file}:${u.line}  ${u.name}`);
console.log(`\nB. 참조 0 최상위 선언(비-export) ${report.deadDecls.length}`);
for (const d of report.deadDecls) console.log(`  ${d.file}:${d.line}  ${d.name}`);
console.log(`\nC. 어디서도 import 되지 않는 export ${report.deadExports.length}`);
const byFile = {};
for (const e of report.deadExports) (byFile[e.file] ||= []).push(`${e.name}${e.internal ? `(내부 ${e.internal})` : '(내부 0 ★완전 데드)'}`);
for (const [f, ns] of Object.entries(byFile)) console.log(`  ${f}: ${ns.join(', ')}`);
console.log(`\nD. 동명 최상위 정의 ${report.dupDefs.length} (same=본문 동일)`);
for (const d of report.dupDefs) console.log(`  ${d.same ? '중복' : '충돌?'} ${d.name}: ${d.where.join(' | ')}`);
console.log(`\nE. 라우트 (method,path) 중복 ${report.dupRoutes.length}`);
for (const d of report.dupRoutes) console.log(`  ${d.key}: ${d.a} ↔ ${d.b}`);
console.log(`\nF. 백업/임시 파일 ${report.junk.length}`);
for (const j of report.junk) console.log(`  ${j}  (${(fs.statSync(path.join(SERVER, j)).size / 1024).toFixed(0)}KB)`);
const jsonIdx = process.argv.indexOf('--json');
if (jsonIdx > 0) fs.writeFileSync(process.argv[jsonIdx + 1], JSON.stringify(report, null, 2), 'utf8');
