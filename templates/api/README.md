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

Exactly one disposable placeholder, in two files: `functions/example.js` (a
one-line `{ ok: true }` public endpoint) and `tests/api/example.test.js`. Delete
both plus the `example` entry in `gipity.yaml` once you write a real function:

```bash
rm functions/example.js tests/api/example.test.js
```

## Build your API

1. Write a function in `functions/<name>.js`.
2. It auto-registers as a public endpoint on deploy; edit `gipity.yaml` to set
   `auth`, `tables`, `fetch_domains`, or `services`.
3. Add a test in `tests/api/<name>.test.js`.
4. To run something on a schedule, drop a `workflows/<name>.yaml` with
   `trigger: schedule` + `cron:` - the `workflows` phase is already declared, so
   `gipity deploy` creates it and arms the schedule (see the `workflow` skill).
5. `gipity deploy dev`, then `gipity test`.

## Calling the API

Public functions need no authentication - just call them directly:

```bash
curl -s -X POST {{API_BASE}}/api/{{PROJECT_GUID}}/fn/example \
  -H 'Content-Type: application/json' -d '{}'
```

`auth: public` functions accept calls from anywhere on the internet, so this URL
is what you give to external callers (webhooks, devices, third-party services).
Exception: a localhost/docker host means a local dev platform instance - that
URL only works from the dev environment; don't hand it out externally.

**Response shape:** raw HTTP wraps the result as `{"data": ...}`. Everything else - `ctx.fn.call` in tests, `gipity fn call`, and the client `Gipity.fn` - returns it **unwrapped**: use `result.field`, never `result.data.field`.

**URL pattern:** `POST /api/{PROJECT_GUID}/fn/{name}`

**Auth levels:** `public` (no auth), `user` (login required), `member` (project member required).

## Project Structure

```
functions/      Serverless functions (auto-deploy as public endpoints)
workflows/      Scheduled/triggered YAML workflows (create it when you add one)
tests/          Test files (run with gipity test)
gipity.yaml     Deploy manifest (auto-populated for new functions)
```
