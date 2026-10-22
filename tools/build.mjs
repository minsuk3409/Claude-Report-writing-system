#!/usr/bin/env node
// 소스 → 단일 HTML 재생성. --check 는 dist가 소스와 같은지만 확인한다.
import { writeFileSync, readFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { readSource, buildHtml, sha256 } from './lib.mjs';

const SRC = 'src-ui';
const OUT = 'dist/health-inspection-preview.html';
const MANIFEST = 'dist/build-manifest.json';
const checkOnly = process.argv.includes('--check');

const src = readSource(SRC);
const html = buildHtml(src);

const manifest = {
  output: OUT,
  sha256: sha256(html),
  inputs: {
    template: sha256(src.template),
    css: sha256(src.css),
    js: sha256(src.js),
  },
};

if (checkOnly) {
  const current = existsSync(OUT) ? readFileSync(OUT, 'utf8') : null;
  if (current !== html) {
    console.error('✗ dist가 소스와 다릅니다. `npm run build`를 실행하세요.');
    process.exit(1);
  }
  console.log('✓ dist가 소스와 일치합니다.');
  process.exit(0);
}

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, html, 'utf8');
writeFileSync(MANIFEST, JSON.stringify(manifest, null, 2) + '\n', 'utf8');
console.log(`✓ 빌드 완료: ${OUT} (${Buffer.byteLength(html)} bytes)`);
