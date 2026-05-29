# Dashboard

Auto-installed per-account dashboard for every Gipity account — the visual admin surface paired with the terminal at `prompt.gipity.ai`. Covers observability (Traffic, Errors, Chats, Audit), project resources (Compute, Data, Services, Hosting), and account state (Plan, Spend, Devices, Alerts). Reads from `/account/logs/*` with the signed-in user's session cookie.

Template key stays `monitor` and the deployed slug stays `monitor` so existing URLs (`app.gipity.ai/<account>/monitor/`) don't break — only the user-visible display name is "Dashboard".

## Surface

- 5 cards: page views, errors, LLM cost (USD), service calls, function invocations
- Traffic panel: line chart + top referrers
- Errors panel: dedup'd errors with stack expand
- LLM/service panel: cost bar chart + top models
- Functions panel: recent invocations
- Chats panel: recent conversations
- Audit panel: tabbed auth / deploy / upload events

## Files

```
src/
  index.html        - layout + cards/panels markup
  css/styles.css    - theme matching Gipity Signal Orange
  js/
    main.js         - orchestrator (sign-in gate, filters, refresh)
    api.js          - thin /account/logs/* client (cookie auth)
    auth.js         - Sign-in-with-Gipity popup flow
    format.js       - fmtNum / fmtUsd / fmtTime helpers
    panels/         - one file per panel
functions/          - empty by default; add derived queries here
```

## Editing

Users own this app like any other starter — `gipity deploy dev` re-deploys after edits. To add custom logic (e.g. weekly summary email), drop a function in `functions/` and call it from `main.js`.

To rebuild from the latest published template:

```
gipity add monitor
```
