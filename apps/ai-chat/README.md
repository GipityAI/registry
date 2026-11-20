# AI chat assistant

A complete AI chat app: people sign in, chat with an assistant that answers from **your app's own data**, and come back to their saved conversations. Built on the [`@gipity/chatbot`](../../kits/chatbot/README.md) kit, which does all the chat work; the app itself is one page, one config file and four small functions.

```bash
gipity add ai-chat --title "Shop Analyst"
gipity deploy dev
```

Out of the box the assistant is an analyst for a demo outdoor-gear shop (80 customers, 12 products, 900 orders). Ask it "how did sales do last month?" and it writes SQL, runs it through the `query_data` tool, and answers with a table and the takeaways.

## What you get

- **Sign-in and private pages**: `auth: { mode: app }` and `access: { mode: app-users }` in `gipity.yaml`. People sign in with Google or an email code (no Gipity account), and the app never handles a signed-out visitor.
- **Saved conversations** per user in a sidebar: new, rename, delete, automatic titles. Stored in the app's database by `functions/chats.js`.
- **Tools over your data**, called as the signed-in user:
  - `query_data`: read-only SQL over the shop tables (a `READ ONLY` transaction, and the function is granted only those tables).
  - `save_note`: asks the user first ("Allow save_note?"), then saves.
  - `list_notes`, and the kit's built-in `generate_image`.
- **Streaming Markdown answers** with tables, code with copy buttons, and live tool steps you can expand to see the exact query and result.
- **Attachments**: photos and screenshots (the model sees them) and text files like CSV, logs and JSON (pick, drag in, or paste).
- **Voice**: a mic button (Gipity transcribe) and read aloud (Gipity TTS).
- **Model picker** (Fast, Balanced, Smartest), stop, regenerate, edit your last message, copy.

All AI calls are `owner_pays`: you pay in credits, your users never see a payment step.

## The files

| File | What it does |
|---|---|
| `src/js/chatbot.config.js` | **The one to edit.** Persona, starters, the schema notes the model reads, the tools, features, model choices. |
| `src/index.html`, `src/js/main.js` | The page: a top bar and the chat widget. |
| `functions/chats.js` | The conversation store (`functionStore('chats')`). |
| `functions/query-data.js` | The `query_data` tool. |
| `functions/save-note.js`, `functions/list-notes.js` | The note tools. |
| `migrations/` | Conversations, the shop tables, notes. |
| `seeds/shop.sql` | The demo shop data. |
| `tests/` | Function tests: `gipity test`. |

## Make it yours

1. **Your data.** Replace `migrations/002-shop.sql` and `seeds/shop.sql` with your tables, grant them to `query-data` in `gipity.yaml`, and rewrite the schema notes in `knowledge` in `chatbot.config.js`. The model only knows what those notes say.
2. **Your actions.** Add a function, declare it in `gipity.yaml` with `auth: user`, and add it to `tools` with a clear `description` and `parameters`. Set `confirm: true` for anything that writes, sends or spends.
3. **Your assistant.** Change `persona` (name, instructions, tone, greeting, starters).
4. **Who gets in.** Add `emails: [...]` under `access` to limit it to known people, or set `mode: public` and handle sign-in yourself.

## Cost

Each answer is one model call per tool round (at most `model.maxToolSteps`, 8 by default), billed from your credits at the model's rates. Turn on `ui.showUsage` to see the credits each answer cost while you build.
