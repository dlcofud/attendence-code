// scripts/check.mjs — PR 마다 GitHub Actions 가 실행하는 기본 검사
//  1) 모든 .js/.mjs 문법 검사 (node --check)
//  2) features 쪽 코드가 core 내부 모듈을 직접 import 하지 않는지 (ACS 만 사용)
//  3) data/courses.json 형식 검사
import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, extname } from 'node:path';

const SKIP = new Set(['node_modules', '.git']);
const files = [];
(function walk(dir) {
  for (const name of readdirSync(dir)) {
    if (SKIP.has(name)) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p);
    else if (['.js', '.mjs'].includes(extname(p))) files.push(p);
  }
})('.');

let failed = 0;
const fail = (msg) => { failed++; console.error(`✗ ${msg}`); };

for (const f of files) {
  try { execFileSync(process.execPath, ['--check', f], { stdio: 'pipe' }); }
  catch (err) { fail(`문법 오류: ${f}\n${String(err.stderr || err.message)}`); }
}
console.log(`문법 검사: ${files.length}개 파일`);

for (const f of files.filter((p) => p.startsWith('features'))) {
  const src = readFileSync(f, 'utf8');
  if (/from\s+['"][^'"]*core\//.test(src) || /import\(\s*['"][^'"]*core\//.test(src)) {
    fail(`${f}: features 는 core 모듈을 직접 import 하지 말고 mount(el, ACS) 로 받은 ACS 를 쓰세요.`);
  }
}

try {
  const j = JSON.parse(readFileSync('data/courses.json', 'utf8'));
  const need = ['code', 'section', 'name', 'prof', 'time', 'dept', 'type', 'credit'];
  if (JSON.stringify(j.fields) !== JSON.stringify(need)) fail('data/courses.json: fields 순서가 다릅니다.');
  if (!Array.isArray(j.rows) || !j.rows.length) fail('data/courses.json: rows 가 비었습니다.');
  const bad = j.rows.filter((r) => !Array.isArray(r) || r.length !== need.length || !/^[A-Z0-9]{3,12}$/.test(r[0]) || !/^[A-Z0-9]{1,4}$/.test(r[1]));
  if (bad.length) fail(`data/courses.json: 형식이 이상한 행 ${bad.length}개 (예: ${JSON.stringify(bad[0])})`);
  console.log(`개설과목: ${j.term} ${j.campus} ${j.rows.length}개 분반`);
} catch (err) {
  fail(`data/courses.json 을 읽지 못했습니다: ${err.message}`);
}

if (failed) { console.error(`\n${failed}개 문제`); process.exit(1); }
console.log('✓ 모두 통과');
