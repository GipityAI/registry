# {{TITLE}}

A REST API powered by Gipity. No frontend - just functions and tests. This
template is intentionally blank: the wiring is in place and deploys green, so you
build your API by adding to it, never by deleting a demo.

## Quick Start

```bash
gipity deploy dev        # Deploy functions
gipity test              # Run all tests
```

## What ships

- `functions/example.js` - a one-line `{ ok: true }` public endpoint so the API
  works immediately.
- `tests/api/example.test.js` - a passing smoke test for it.

## Build your API

1. Write a function in `functions/<name>.js`.
2. It auto-registers as a public endpoint on deploy; edit `gipity.yaml` to set
   `auth`, `tables`, `fetch_domains`, or `services`.
3. Add a test in `tests/api/<name>.test.js`.
4. `gipity deploy dev`, then `gipity test`.

## Calling the API

Public functions need no authentication - just call them directly:

```bash
curl -s -X POST {{API_BASE}}/api/{{PROJECT_GUID}}/fn/example \
  -H 'Content-Type: application/json' -d '{}'
```

**Response shape:** raw HTTP wraps the result as `{"data": ...}`. Everything else - `ctx.fn.call` in tests, `gipity fn call`, and the client `Gipity.fn` - returns it **unwrapped**: use `result.field`, never `result.data.field`.

**URL pattern:** `POST /api/{PROJECT_GUID}/fn/{name}`

**Auth levels:** `public` (no auth), `user` (login required), `member` (project member required).

## Project Structure

```
functions/      Serverless functions (auto-deploy as public endpoints)
tests/          Test files (run with gipity test)
gipity.yaml     Deploy manifest (auto-populated for new functions)
```
