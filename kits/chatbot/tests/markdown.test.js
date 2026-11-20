/**
 * Tests for lib/markdown.js: what renders, and that nothing a reply says can
 * inject markup or script.
 * Run: node tests/markdown.test.js
 */
import assert from 'node:assert/strict';
import { renderMarkdown, renderInline } from '../lib/markdown.js';

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('  ok   -', name); }
  catch (e) { failed++; console.error('  FAIL -', name, '\n        ', e.message); }
}

test('inline formatting', () => {
  assert.equal(renderInline('**bold** and *it* and `x < y` and ~~old~~'),
    '<strong>bold</strong> and <em>it</em> and <code>x &lt; y</code> and <del>old</del>');
});

test('code spans are not formatted inside', () => {
  assert.equal(renderInline('`**not bold**`'), '<code>**not bold**</code>');
});

test('snake_case words are not italicized', () => {
  assert.equal(renderInline('call get_order_status now'), 'call get_order_status now');
});

test('headings, paragraphs and line breaks', () => {
  assert.equal(renderMarkdown('# Title\n\nline one\nline two'), '<h3>Title</h3><p>line one<br>line two</p>');
});

test('nested bullet and numbered lists', () => {
  assert.equal(
    renderMarkdown('- a\n  - a1\n- b\n\n1. one\n2. two'),
    '<ul><li>a<ul><li>a1</li></ul></li><li>b</li></ul><ol><li>one</li><li>two</li></ol>',
  );
});

test('tables', () => {
  const html = renderMarkdown('| Order | Status |\n|---|:--:|\n| A-17 | **shipped** |\n| B-2 | late |');
  assert.equal(html, '<div class="table-wrap"><table><thead><tr><th>Order</th><th>Status</th></tr></thead><tbody>'
    + '<tr><td>A-17</td><td><strong>shipped</strong></td></tr><tr><td>B-2</td><td>late</td></tr></tbody></table></div>');
});

test('fenced code keeps its text exactly and escapes it', () => {
  assert.equal(renderMarkdown('```js\nif (a < b) { **x** }\n```'), '<pre data-lang="js"><code>if (a &lt; b) { **x** }</code></pre>');
});

test('an unclosed fence (mid-stream) still renders as code', () => {
  assert.equal(renderMarkdown('Here:\n```\nSELECT 1'), '<p>Here:</p><pre><code>SELECT 1</code></pre>');
});

test('blockquotes and rules', () => {
  assert.equal(renderMarkdown('> quoted\n\n---'), '<blockquote><p>quoted</p></blockquote><hr>');
});

test('links and images accept only safe URLs', () => {
  assert.equal(renderInline('[docs](https://gipity.ai/docs)'), '<a href="https://gipity.ai/docs" target="_blank" rel="noopener noreferrer">docs</a>');
  assert.equal(renderInline('![fox](https://media.gipity.ai/f.png)'), '<img src="https://media.gipity.ai/f.png" alt="fox" loading="lazy">');
  assert.equal(renderInline('[x](javascript:alert(1))'), '[x](javascript:alert(1))');
  assert.equal(renderInline('![x](data:text/html;base64,PHNjcmlwdD4=)'), '![x](data:text/html;base64,PHNjcmlwdD4=)');
});

test('bare URLs become links', () => {
  assert.equal(renderInline('see https://gipity.ai/x.'), 'see <a href="https://gipity.ai/x" target="_blank" rel="noopener noreferrer">https://gipity.ai/x</a>.');
});

test('raw HTML in a reply is shown as text, never run', () => {
  const html = renderMarkdown('<img src=x onerror=alert(1)><script>alert(2)</script>');
  assert.ok(!html.includes('<img src=x'));
  assert.ok(!html.includes('<script>'));
  assert.ok(html.includes('&lt;script&gt;'));
});

test('a quote in a link URL cannot break out of the attribute', () => {
  const html = renderInline('[x](https://a.b/"onmouseover="alert(1))');
  assert.ok(!html.includes('" onmouseover'));
  assert.ok(!/href="[^"]*"onmouseover/.test(html));
});

console.log('');
console.log(`markdown.test.js: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
