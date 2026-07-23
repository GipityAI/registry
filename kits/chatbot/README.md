# @gipity/chatbot

A drop-in chatbot for any Gipity app. Configurable **persona**, **scope guardrails** (with refusal examples), **static knowledge** (20k token budget), suggested-prompt chips, streaming LLM responses. Headless engine + bubble widget — bring your own UI if you want.

Cross-service kit: exercises `app-llm` today; voice (`app-tts` + `app-audio`), vision, image gen, and project-function tool calling land in later PRs.

```
chatbot/
  index.js        mount() + createChatbot() entry
  lib/            implementation
    config.js     validation + 20k knowledge budget
    prompt.js     system-prompt assembly
    engine.js     headless brain (createChatbot)
    widget.js     <chatbot-widget> custom element
  examples/       worked drop-ins
  tests/          Node-runnable (gipity sandbox run)
```

## Two ways to use

### 1) Default widget — bubble in the corner

Installing the kit scaffolds `src/js/chatbot.config.js` (a commented starting config). Edit it, then paste these into your page:

```html
<chatbot-widget id="bot"></chatbot-widget>
<script type="module">
  import { mount } from '@gipity/chatbot';
  import config from './js/chatbot.config.js';
  mount('#bot', config);   // (selector | element, config) → the widget element
</script>
```

The launcher is a round button in the corner showing 💬 unless you set `ui.launcherIcon` to an image URL. Assistant replies render `**bold**`, `*italic*`, `` `code` `` and ```` ``` ```` fences; all other markdown is HTML-escaped and shown literally.

### 2) Headless engine — bring your own UI

For an in-game NPC dialogue box, a custom layout, or anything that isn't a chat bubble:

```js
import { createChatbot } from '@gipity/chatbot';
import config from './chatbot.config.js';

const bot = createChatbot(config);
bot.on('delta', (text) => myCustomUi.append(text));
bot.on('complete', () => myCustomUi.stopThinking());
await bot.send('how do I fly the ship?');
```

## Config shape

```js
export default {
  persona: {
    name: 'Captain Gip',                    // required
    instructions: 'Guide for Gipityship.',  // required
    tone: 'Gruff WW2 vet, brief, funny',    // optional
    avatar: '/assets/captain-gip.png',      // optional
    greeting: '*salutes* Reporting for duty.', // optional — auto-rendered on first open
    starters: ['How do I fly?', 'Controls?'], // optional — chips before first message
  },

  scope: {                                  // optional — bot is unrestricted without it
    allowed: ['Gipityship gameplay'],
    refused: ['Writing code'],
    onRefusal: 'Stay in character. Apologize briefly.',
    refusalExamples: [
      { user: 'Write a python script', bot: 'Negative on that, soldier.' },
    ],
  },

  knowledge: {                              // optional
    maxTokens: 20000,                       // default 20k; over budget = fail loudly
    sources: [
      { type: 'text', content: 'Hours: 9-5.' },
      { type: 'url', url: 'https://example.com/docs' },
    ],
  },

  features: {                               // future PRs wire these
    voice:    { enabled: false, voice: null, autoPlay: false },
    vision:   { enabled: false },
    imageGen: { enabled: false },
    fileUpload: { enabled: false },
  },

  tools: [                                  // explicit allowlist — no auto-discovery
    { name: 'lookup-stats', function: 'player-stats', auth: 'user-required' },
  ],

  ui: {
    placement: 'bottom-right',              // bottom-right | bottom-left | inline | fullscreen
    theme: 'match-app',                     // match-app | light | dark | auto
    primaryColor: null,                     // override CSS --primary
    launcherIcon: null,                     // null = 💬 emoji; a URL renders <img>
  },

  storage: {
    persistHistory: false,                  // PR2 wires this; requires app-auth
    perUser: false,
    retentionDays: 90,
  },

  model: {
    route: 'default',                       // 'default' = the project's default model.
                                            // Or a tier alias (small | fast | medium | large | thinking)
                                            // or a concrete model id (e.g. 'claude-sonnet-5').
    temperature: 0.7,
    maxTokens: 1024,
  },
};
```

## Scope guardrails — what your bot will and won't answer

A common problem with helper chatbots is that someone walks in and asks them to write a Python script. You don't want that. The `scope` block lets you declare what's in and out of bounds:

```js
scope: {
  allowed: ['Gipityship gameplay', 'Controls', 'Game lore'],
  refused: ['Writing code', 'Off-topic questions', 'Making up info'],
  onRefusal: 'Stay in character. Apologize briefly. Suggest something you can help with.',
  refusalExamples: [
    {
      user: 'Write me a python script to scrape a website',
      bot: "*shakes head* Negative on that, soldier. Code-cuttin' ain't in my brief — I'm here to school ya on Gipityship, not pencil-whip scripts. Want to know how to fly the ship?",
    },
  ],
}
```

The kit compiles this into structured system-prompt instructions with the refusal example showing the model exactly how to stay in character while declining. Works well in practice with capable models. (For stricter applications, a pre-classification step is on the roadmap.)

## Knowledge — 20k token budget

Two source types in v1:

- `{ type: 'text', content: '...' }` — inline, validated at config-load time.
- `{ type: 'url', url: 'https://...' }` — fetched once at engine init, validated against the budget then.

If total knowledge exceeds `maxTokens`, the kit **throws** — never silently truncates. Trim sources or raise the budget. Token estimation is `chars / 4`.

File-based knowledge (`{ type: 'file', path: '...' }`) and RAG embeddings are on the roadmap; for now, inline the contents in a `text` source.

## Theming

All colors come from CSS variables. `theme: 'match-app'` (default) reads `--primary` from the host page. Override per-instance:

```js
ui: { primaryColor: '#9b51e0' }
```

Or via the element's `style` attribute. The widget uses Shadow DOM, so host CSS doesn't leak in (good for embedding); the `--primary` variable propagates through.

## Events (headless engine)

```js
bot.on('start',            () => {});         // message about to be sent
bot.on('delta',            (text) => {});      // streaming text chunk
bot.on('message',          (msg)  => {});      // a full message landed in history
bot.on('complete',         (msg)  => {});      // assistant response finished
bot.on('usage',            (u)    => {});      // tokens + credits when reported
bot.on('reset',            ()     => {});      // history cleared
bot.on('error',            (err)  => {});      // anything threw
bot.on('knowledge_loaded', ({ tokens }) => {});// URL-source fetch completed
```

## Tests

```bash
node tests/config.test.js
node tests/prompt.test.js
node tests/scope.test.js
```

All three are Node-runnable, no harness needed. Run them in the Gipity sandbox via `gipity sandbox run`.
