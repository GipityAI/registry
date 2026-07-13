# @gipity/i18n

Multi-language for any Gipity web app — a language picker, locale persistence, RTL, and plural/translation lookup.

```
i18n/
  index.js         the @gipity/i18n runtime (lookup + auto-mounted picker)
  lib/runtime.js   pure lookup engine (createI18n) — unit-tested
  picker.js        the <select> language switcher (auto-mounted)
  translations.js  per-language data (agent fills this)
  examples/        worked drop-in (also the scaffolded strings.js starter)
  tests/           Node-runnable (`gipity sandbox run`)
```

## How it works

Gipity apps keep copy right in the page by default — no i18n machinery, nothing to learn. You add this kit only when an app actually needs more than one language.

`gipity add i18n`:

1. **Scaffolds `src/js/strings.js`** — a copy table (`export const strings = { ... }`), if the app doesn't already have one.
2. **Wires the import map** — `@gipity/i18n` → this kit's runtime, and `@app/strings` → your `src/js/strings.js`.
3. **Auto-mounts** a language `<select>`, persists the choice to `localStorage`, and flips `<html dir>` for RTL scripts.

Then you do the one-time migration: move your user-facing strings into `strings.js` as `key: 'text'` and swap hard-coded copy for `t('key')`. From then on every call site is translation-aware.

> The files this migration touches — `src/js/strings.js`, the kit's `translations.js`, and any page you re-route through `t()` — already exist on disk after `add`. Read each one with the Read tool before your first Write/Edit to it (a `cat` in Bash doesn't count), or the write fails with "File has not been read yet".

> Adding i18n means routing copy through `t('key')`. If the app already has hard-coded strings, that copy moves into `strings.js` as part of the install — a quick, mechanical pass. Most single-language apps never need this kit at all.

## Use it

Read copy through `t()` (and `tn()` for plurals):

```js
import { t, tn, getLang } from '@gipity/i18n';
el.textContent = t('welcome');
el.textContent = t('greeting', { name: 'Sam' });       // "Hello, Sam!"
el.textContent = tn('items', cart.length);             // plural-aware
```

For your text to re-render when the user switches language, re-pull it on the `i18n:changed` event:

```js
function render() { /* your t('key') → DOM assignments */ }
document.addEventListener('i18n:changed', render);
```

`setLang()` (and the picker's `change` handler) applies **synchronously**: by the time the call returns, `getLang()`, `<html lang>`/`<html dir>`, and any `i18n:changed` listeners have all run in the same tick. A read immediately after switching reflects the new language — no `setTimeout`/`await` needed.

## Translate

Ask the agent: **"translate strings to Spanish and Japanese"**. Translations land in `translations.js`:

```js
export const translations = {
  es: { welcome: 'Bienvenido', items_one: '{count} artículo', items_other: '{count} artículos' },
  ja: { welcome: 'ようこそ', items_other: '{count}個' },
};
```

The picker appears once at least one translation exists. English is the base (`strings.js`) and never appears in `translations.js`. Plurals use `_one`/`_other` (and `_zero`/`_two`/`_few`/`_many` where a language needs them) per `Intl.PluralRules`. RTL scripts (`ar`, `he`, `fa`, `ur`, `yi`) flip layout automatically.

## API

| Export | Description |
|--------|-------------|
| `t(key, vars?)` | Localized string; interpolates `{placeholder}` vars. Missing key → the key. |
| `tn(key, count, vars?)` | Plural-aware lookup; `count` is auto-merged into vars. |
| `getLang()` | Active 2-letter language code. |
| `setLang(code)` | Switch + persist; fires `i18n:changed` synchronously (state is live the moment it returns). |
| `availableLangs()` | `['en', ...translated]`. |
| `isRtl(code?)` | Whether a language is right-to-left. |
| `mountLangPicker(i18n, parent?)` | Mount a picker yourself (already auto-mounted). |

Number/date/currency formatting isn't wrapped — `Intl.*` is a one-liner with `getLang()`:

```js
new Intl.NumberFormat(getLang(), { style: 'currency', currency: 'USD' }).format(99.5);
new Intl.DateTimeFormat(getLang(), { dateStyle: 'medium' }).format(new Date());
```
