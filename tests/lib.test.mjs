import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractParts, buildHtml } from '../tools/lib.mjs';

// CSS/JS 안에 치환 패턴 문자($&, $')를 넣어 함수형 replacer가 동작하는지 확인
const sample = `<!doctype html><html><head><style>
a{content:"$&"}
</style></head><body><main></main><script>
const x = "$'";
</script></body></html>`;

test('추출 후 재생성하면 원본과 바이트가 같다', () => {
  assert.equal(buildHtml(extractParts(sample)), sample);
});

test('치환 패턴 문자는 그대로 보존된다', () => {
  const out = buildHtml(extractParts(sample));
  assert.ok(out.includes('content:"$&"'));
  assert.ok(out.includes(`"$'"`));
});

test('style 블록이 없으면 추출에 실패한다', () => {
  assert.throws(() => extractParts('<html><script></script></html>'), /style/);
});

test('플레이스홀더가 없으면 빌드에 실패한다', () => {
  assert.throws(() => buildHtml({ template: '<p></p>', css: '', js: '' }), /플레이스홀더|{{/);
});
