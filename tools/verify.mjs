#!/usr/bin/env node
// 검수: 구조·문법·정합성·보안 위험·재생성 무결성을 점검한다.
//  FAIL → 종료 코드 1
//  WARN → --strict 에서만 종료 코드 1
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import vm from 'node:vm';
import { parse } from 'parse5';
import { readSource, buildHtml, extractParts, sha256, FILES } from './lib.mjs';

const SRC = 'src-ui';
const DIST = 'dist/health-inspection-preview.html';
const strict = process.argv.includes('--strict');
const results = [];
const add = (id, level, ok, msg) => results.push({ id, status: ok ? 'PASS' : level, msg });

function main() {
  // V01 소스 구조
  let src, html;
  try {
    src = readSource(SRC);
    html = buildHtml(src);
  } catch (e) {
    console.log(`[FAIL] V01 소스 구조: ${e.message}`);
    process.exit(1);
  }
  add('V01', 'FAIL', true, '소스 파일 존재, 플레이스홀더 1회씩 확인');

  // V02 dist 최신성
  const dist = existsSync(DIST) ? readFileSync(DIST, 'utf8') : null;
  add(
    'V02', 'FAIL', dist === html,
    dist === null ? 'dist가 없습니다 → npm run build'
      : dist === html ? 'dist가 소스와 일치'
      : 'dist가 오래되었습니다 → npm run build',
  );

  // V03 미치환 플레이스홀더
  add('V03', 'FAIL', !/\{\{[A-Z_]+\}\}/.test(html), '미치환 플레이스홀더 없음');

  // V04 HTML 파싱 오류
  const parseErrors = [];
  parse(html, {
    onParseError: e => parseErrors.push(`${e.code}@${e.startLine}:${e.startCol}`),
  });
  add(
    'V04', 'FAIL', parseErrors.length === 0,
    parseErrors.length
      ? `파싱 오류 ${parseErrors.length}건: ${parseErrors.slice(0, 5).join(', ')}`
      : 'HTML 파싱 오류 없음',
  );

  // V05 인라인 스크립트가 HTML을 깨뜨리지 않는지
  add(
    'V05', 'FAIL', !/<\/script/i.test(src.js) && !/<!--/.test(src.js),
    'JS 안에 </script 또는 <!-- 없음',
  );

  // V06 JS 문법
  let syntaxOk = true;
  let syntaxMsg = 'JS 문법 컴파일 성공';
  try {
    new vm.Script(src.js, { filename: 'app.js' });
  } catch (e) {
    syntaxOk = false;
    syntaxMsg = `JS 문법 오류: ${e.message}`;
  }
  add('V06', 'FAIL', syntaxOk, syntaxMsg);

  // V07 CSS 중괄호 균형 (주석 제외)
  const cssNoComments = src.css.replace(/\/\*[\s\S]*?\*\//g, '');
  const open = (cssNoComments.match(/\{/g) || []).length;
  const close = (cssNoComments.match(/\}/g) || []).length;
  add('V07', 'FAIL', open === close, `CSS 중괄호 균형 (열림 ${open}, 닫힘 ${close})`);

  // V08 라우트 정합성: 링크 대상이 실제 페이지에 존재하는지
  const pagesBlock = src.js.match(/const pages = \{([^}]*)\}/);
  const routes = pagesBlock
    ? pagesBlock[1].split(',').map(s => s.trim()).filter(Boolean)
    : [];
  const REQUIRED = ['dashboard', 'inspections', 'upload', 'analysis', 'report', 'template'];
  const missingRoutes = REQUIRED.filter(r => !routes.includes(r));
  const targets = new Set([
    ...[...html.matchAll(/href="#([a-z]+)"/g)].map(m => m[1]),
    ...[...src.js.matchAll(/location\.hash\s*=\s*'([a-z]+)'/g)].map(m => m[1]),
    ...[...src.js.matchAll(/hash\s*===?\s*'#([a-z]+)'/g)].map(m => m[1]),
  ]);
  const broken = [...targets].filter(t => !routes.includes(t));
  add(
    'V08', 'FAIL', missingRoutes.length === 0 && broken.length === 0,
    missingRoutes.length || broken.length
      ? `라우트 불일치: 누락 [${missingRoutes}] / 존재하지 않는 대상 [${broken}]`
      : `라우트 ${routes.length}개, 링크 대상 ${targets.size}개 정합`,
  );

  // V09 아이콘 정합성
  const pathsBlock = src.js.match(/const paths = \{([\s\S]*?)\n\};/);
  const iconNames = new Set(
    pathsBlock ? [...pathsBlock[1].matchAll(/^\s*(\w+):/gm)].map(m => m[1]) : [],
  );
  const used = new Set([
    ...[...html.matchAll(/data-icon="(\w+)"/g)].map(m => m[1]),
    ...[...src.js.matchAll(/icon\('(\w+)'\)/g)].map(m => m[1]),
  ]);
  for (const arr of src.js.matchAll(/icon\(\[([^\]]+)\]/g)) {
    for (const name of arr[1].matchAll(/'(\w+)'/g)) used.add(name[1]);
  }
  const unknownIcons = [...used].filter(n => !iconNames.has(n));
  const dynamicIcons = (src.js.match(/icon\((?!\[|')/g) || []).length;
  add(
    'V09', 'FAIL', unknownIcons.length === 0,
    unknownIcons.length
      ? `정의되지 않은 아이콘: ${unknownIcons.join(', ')}`
      : `아이콘 ${used.size}종 정합 (동적 호출 ${dynamicIcons}곳은 수동 확인)`,
  );

  // V10 외부 자원·네트워크 호출 금지 (시안은 오프라인 전용)
  const forbidden = [
    [/<script\b[^>]*\bsrc=/i, '외부 script'],
    [/<link\b(?![^>]*rel="icon")[^>]*>/i, '외부 link (아이콘 제외)'],
    [/@import\b/, 'CSS @import'],
    [/\bfetch\s*\(/, 'fetch 호출'],
    [/XMLHttpRequest|WebSocket|sendBeacon/, '네트워크 API'],
    [/https?:\/\/(?!www\.w3\.org\/2000\/svg)/, '외부 URL'],
  ];
  const hits = forbidden.filter(([re]) => re.test(html)).map(([, label]) => label);
  add(
    'V10', 'FAIL', hits.length === 0,
    hits.length ? `금지된 외부 의존/네트워크: ${hits.join(', ')}` : '외부 자원·네트워크 호출 없음',
  );

  // V11 이스케이프되지 않은 값의 HTML 삽입 (경고)
  const risky = [...src.js.matchAll(/\$\{([^}]*)\}/g)]
    .filter(m =>
      /\b(?:r|g|form|state|f)\.(?:site|author|date|file|draft|health|name)\b|\.value\b/.test(m[1]) &&
      !/escapeHtml/.test(m[1]),
    )
    .map(m => `L${src.js.slice(0, m.index).split('\n').length} ${m[0]}`);
  add(
    'V11', 'WARN', risky.length === 0,
    risky.length
      ? `이스케이프 없이 삽입되는 값 ${risky.length}곳 검토 필요 (텍스트 출력은 오탐 가능): ${risky.slice(0, 6).join(' | ')}`
      : '사용자 입력 값 이스케이프 확인',
  );

  // V12 재생성 무결성: 원본 → 추출 → 재생성이 바이트 단위로 같은지
  const originFile = join(SRC, FILES.origin);
  if (!existsSync(originFile)) {
    add('V12', 'WARN', false, 'origin.json 없음 → 재생성 무결성 검사 생략');
  } else {
    const origin = JSON.parse(readFileSync(originFile, 'utf8'));
    if (!existsSync(origin.source)) {
      add('V12', 'WARN', false, `원본 파일 없음(${origin.source}) → 검사 생략`);
    } else {
      const original = readFileSync(origin.source, 'utf8');
      const rebuilt = buildHtml(extractParts(original));
      add(
        'V12', 'FAIL',
        rebuilt === original && sha256(original) === origin.sha256,
        rebuilt === original
          ? '원본 → 추출 → 재생성 바이트 동일'
          : '재생성 결과가 원본과 다름 (추출기/빌더 손실)',
      );
    }
  }

  // 출력
  const icon = { PASS: '✓', WARN: '!', FAIL: '✗' };
  for (const r of results) console.log(`${icon[r.status]} [${r.status}] ${r.id} ${r.msg}`);
  const fails = results.filter(r => r.status === 'FAIL').length;
  const warns = results.filter(r => r.status === 'WARN').length;
  console.log(`\n결과: 실패 ${fails}, 경고 ${warns}, 통과 ${results.length - fails - warns}`);
  process.exit(fails || (strict && warns) ? 1 : 0);
}

main();
