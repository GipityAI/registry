# @gipity/i18n

Multi-language for any Gipity web app — a language picker, locale persistence, RTL, and plural/translation lookup. It **transparently upgrades** the app's existing copy calls: every `import { t } from '@gipity/i18n'` becomes translation-aware and a picker mounts itself. **No app code changes.**

```
i18n/
  index.js         the @gipity/i18n runtime (overrides the app's monolingual default)
  lib/runtime.js   pure lookup engine (createI18n) — unit-tested
  picker.js        the <select> language switcher (auto-mounted)
  translations.js  per-language data (agent fills this)
  examples/        worked drop-in
  tests/           Node-runnable (`gipity sandbox run`)
```

## How it works

Web starter apps keep all copy in `src/js/strings.js` and read it via `t('key')`, importing the runtime from `@gipity/i18n`. Out of the box that specifier points at a tiny **monolingual** runtime — `t()` just returns your string with `{placeholder}` interpolation.

`gipity add i18n` overrides the `@gipity/i18n` import to this kit. Because your app already routes copy through `t()`, every call site lights up at once — translation lookup, a language `<select>`, `localStorage` persistence, and automatic `<html dir>` flipping for RTL scripts. The kit reads your existing copy via the `@app/strings` alias (`src/js/strings.js`), so nothing in your app has to move.

> Add i18n **early** — while you're writing UI. Routing copy through `t('key')` as you build is what makes this a zero-edit install. Bolting it onto an app with hard-coded strings means rewriting that copy first.

## Use it

Nothing to import or call — installing the kit is the integration. Keep writing UI text as:

```js
import { t, getLang } from '@gipity/i18n';
el.textContent = t('welcome');
el.textContent = t('greeting', { name: 'Sam' });       // "Hello, Sam!"
el.textContent = tn('items', cart.length);             // plural-aware
```

For your text to re-render when the user switches language, re-pull it on the `i18n:changed` event (the web starter's `main.js` already wires this):

```js
function render() { /* your t('key') → DOM assignments */ }
document.addEventListener('i18n:changed', render);
```

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
| `setLang(code)` | Switch + persist; fires `i18n:changed`. |
| `availableLangs()` | `['en', ...translated]`. |
| `isRtl(code?)` | Whether a language is right-to-left. |
| `mountLangPicker(i18n, parent?)` | Mount a picker yourself (already auto-mounted). |

Number/date/currency formatting isn't wrapped — `Intl.*` is a one-liner with `getLang()`:

```js
new Intl.NumberFormat(getLang(), { style: 'currency', currency: 'USD' }).format(99.5);
new Intl.DateTimeFormat(getLang(), { dateStyle: 'medium' }).format(new Date());
```
