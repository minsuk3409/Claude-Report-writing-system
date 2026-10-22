#!/usr/bin/env node
// 원본 단일 HTML을 소스 파일(템플릿·CSS·JS)로 분해한다.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { extractParts, buildHtml, sha256, FILES } from './lib.mjs';

const [input, outDir = 'src-ui'] = process.argv.slice(2);
if (!input) {
  console.error('사용법: node tools/extract.mjs <원본.html> [출력폴더=src-ui]');
  process.exit(1);
}

const original = readFileSync(input, 'utf8');
const parts = extractParts(original);

// 자가검증: 분해한 것을 다시 합쳤을 때 원본과 바이트 단위로 같아야 한다
if (buildHtml(parts) !== original) {
  console.error('✗ 추출 자가검증 실패: 재생성 결과가 원본과 다릅니다.');
  process.exit(1);
}

const write = (rel, content) => {
  const file = join(outDir, rel);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, content, 'utf8');
};

write(FILES.template, parts.template);
write(FILES.css, parts.css);
write(FILES.js, parts.js);
write(
  FILES.origin,
  JSON.stringify(
    { source: input, sha256: sha256(original), bytes: Buffer.byteLength(original) },
    null,
    2,
  ) + '\n',
);

console.log(`✓ 추출 완료 → ${outDir}/`);
console.log(`  template ${parts.template.length}자 / css ${parts.css.length}자 / js ${parts.js.length}자`);
console.log('  자가검증 통과: 재생성 결과가 원본과 바이트 단위로 동일합니다.');
