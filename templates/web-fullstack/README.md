# {{TITLE}}

A full-stack web app on Gipity - frontend + serverless API + database. This
template is intentionally blank: the wiring is in place and deploys green, so you
build your app by adding to it, never by deleting a demo.

## Quick Start

```bash
gipity deploy dev        # Deploy frontend, create the database, deploy functions
gipity test              # Run all API tests
```

## Architecture

```
src/             Frontend (HTML/CSS/JS) → served from CDN
functions/       Serverless API endpoints
migrations/      SQL schema (idempotent, runs once per migration)
tests/           API tests (run with gipity test)
gipity.yaml      Deploy manifest - controls all three phases
```

## What ships

- `functions/example.js` - a one-line `{ ok: true }` function so the API works
  immediately. The homepage calls it via `Gipity.fn('example')` to confirm the
  backend is reachable.
- `migrations/001-example.sql` - a commented-out example table. Uncomment it or
  replace it to define your schema.
- `src/` - a blank page wired to the client SDK.

## Build your app

1. Add a table in `migrations/` (or edit `001-example.sql`).
2. Write functions in `functions/<name>.js` and declare them in `gipity.yaml`
   under `function_definitions`.
3. Call them from `src/js/main.js` with `Gipity.fn('<name>', body)`.
4. `gipity deploy dev`, then `gipity test`.

## Calling the API

```bash
curl -s -X POST https://a.gipity.ai/api/{{PROJECT_GUID}}/fn/example \
  -H 'Content-Type: application/json' -d '{}'
```

**Auth levels:** `public` (no auth), `user` (login required), `member` (project member required).
