/**
 * Tests for lib/runtime.js - the pure i18n lookup engine.
 * Run: node src/packages/i18n/tests/runtime.test.js  (or via `gipity sandbox run`)
 */
import assert from 'node:assert/strict';
import { createI18n, pickInitialLang } from '../lib/runtime.js';

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('  ok   -', name); }
  catch (e) { failed++; console.error('  FAIL -', name, '\n        ', e.message); }
}

const strings = {
  welcome: 'Welcome',
  greeting: 'Hello, {name}!',
  items_one: '{count} item',
  items_other: '{count} items',
};
const translations = {
  es: { welcome: 'Bienvenido', greeting: 'Hola, {name}!', items_one: '{count} artículo', items_other: '{count} artículos' },
  ar: { welcome: 'مرحبا' },
};

test('returns base string by key', () => {
  const { t } = createI18n({ strings });
  assert.equal(t('welcome'), 'Welcome');
});

test('interpolates {placeholder} vars', () => {
  const { t } = createI18n({ strings });
  assert.equal(t('greeting', { name: 'Sam' }), 'Hello, Sam!');
});

test('leaves unknown placeholders intact', () => {
  const { t } = createI18n({ strings });
  assert.equal(t('greeting', {}), 'Hello, {name}!');
});

test('missing key returns the key itself, never blank', () => {
  const { t } = createI18n({ strings });
  assert.equal(t('nope'), 'nope');
});

test('switching language uses translations', () => {
  const i18n = createI18n({ strings, translations });
  i18n.setLang('es');
  assert.equal(i18n.t('welcome'), 'Bienvenido');
  assert.equal(i18n.t('greeting', { name: 'Sam' }), 'Hola, Sam!');
});

test('falls back to base string when a key is untranslated', () => {
  const i18n = createI18n({ strings, translations });
  i18n.setLang('ar'); // ar only translates `welcome`
  assert.equal(i18n.t('welcome'), 'مرحبا');
  assert.equal(i18n.t('greeting', { name: 'Sam' }), 'Hello, Sam!');
});

test('plurals pick _one / _other by count (English)', () => {
  const { tn } = createI18n({ strings });
  assert.equal(tn('items', 1), '1 item');
  assert.equal(tn('items', 5), '5 items');
});

test('plurals localize when translated', () => {
  const i18n = createI18n({ strings, translations });
  i18n.setLang('es');
  assert.equal(i18n.tn('items', 1), '1 artículo');
  assert.equal(i18n.tn('items', 3), '3 artículos');
});

test('availableLangs is English plus translated languages', () => {
  const i18n = createI18n({ strings, translations });
  assert.deepEqual(i18n.availableLangs().sort(), ['ar', 'en', 'es']);
});

test('isRtl true for Arabic, false for English/Spanish', () => {
  const i18n = createI18n({ strings, translations });
  assert.equal(i18n.isRtl('ar'), true);
  assert.equal(i18n.isRtl('en'), false);
  assert.equal(i18n.isRtl('es'), false);
});

test('pickInitialLang prefers a stored choice the app ships', () => {
  assert.equal(pickInitialLang({ supported: ['en', 'es'], stored: 'es', navLang: 'en' }), 'es');
});

test('pickInitialLang uses browser language when shipped', () => {
  assert.equal(pickInitialLang({ supported: ['en', 'es'], navLang: 'es' }), 'es');
});

test('pickInitialLang ignores an unsupported browser language (no surprise RTL)', () => {
  // Arabic-locale browser, English-only app -> stays English, not 'ar'.
  assert.equal(pickInitialLang({ supported: ['en'], navLang: 'ar' }), 'en');
});

test('pickInitialLang ignores a stale stored language the app no longer ships', () => {
  assert.equal(pickInitialLang({ supported: ['en', 'es'], stored: 'ar' }), 'en');
});

test('pickInitialLang defaults to en with no signals', () => {
  assert.equal(pickInitialLang({ supported: ['en', 'es'] }), 'en');
});

console.log('');
console.log(`runtime.test.js: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
