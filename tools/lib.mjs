// 추출·재생성·검수가 공유하는 순수 함수 모음
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';

export const FILES = Object.freeze({
  template: 'index.html',
  css: 'styles/main.css',
  js: 'scripts/app.js',
  origin: 'origin.json',
});

export const PLACEHOLDER = Object.freeze({
  css: '{{STYLE}}',
  js: '{{SCRIPT}}',
});

export const sha256 = text => createHash('sha256').update(text, 'utf8').digest('hex');

const countOf = (text, needle) => text.split(needle).length - 1;

/** 원본 HTML → 템플릿 + CSS + JS. 블록 내용은 한 글자도 바꾸지 않고 분리한다. */
export function extractParts(html) {
  const styles = [...html.matchAll(/<style>([\s\S]*?)<\/style>/g)];
  const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)];

  if (styles.length !== 1) {
    throw new Error(`<style> 블록은 1개여야 합니다 (현재 ${styles.length}개)`);
  }
  if (scripts.length !== 1) {
    throw new Error(`인라인 <script> 블록은 1개여야 합니다 (현재 ${scripts.length}개)`);
  }

  const edits = [
    { match: styles[0], replacement: `<style>${PLACEHOLDER.css}</style>` },
    { match: scripts[0], replacement: `<script>${PLACEHOLDER.js}</script>` },
  ];

  // 뒤쪽 블록부터 치환해야 앞쪽 인덱스가 밀리지 않는다
  let template = html;
  for (const edit of edits.sort((a, b) => b.match.index - a.match.index)) {
    const end = edit.match.index + edit.match[0].length;
    template = template.slice(0, edit.match.index) + edit.replacement + template.slice(end);
  }

  return { template, css: styles[0][1], js: scripts[0][1] };
}

/** 템플릿 + CSS + JS → 단일 HTML */
export function buildHtml({ template, css, js }) {
  for (const token of Object.values(PLACEHOLDER)) {
    const n = countOf(template, token);
    if (n !== 1) {
      throw new Error(`템플릿의 ${token} 는 정확히 1번 있어야 합니다 (현재 ${n}번)`);
    }
  }
  // 함수형 replacer를 써서 CSS/JS 안의 "$&", "$'" 같은 문자열이
  // 치환 패턴으로 해석되지 않도록 한다
  return template
    .replace(PLACEHOLDER.css, () => css)
    .replace(PLACEHOLDER.js, () => js);
}

/** 소스 디렉터리에서 세 파일을 읽는다 */
export function readSource(dir) {
  const read = rel => {
    const file = join(dir, rel);
    if (!existsSync(file)) throw new Error(`필수 소스 파일이 없습니다: ${file}`);
    return readFileSync(file, 'utf8');
  };
  return {
    template: read(FILES.template),
    css: read(FILES.css),
    js: read(FILES.js),
  };
}
