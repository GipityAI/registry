# {{TITLE}}

A REST API powered by Gipity. Starts as just functions and tests. This
template is intentionally blank: the wiring is in place and deploys green, so you
build your API by adding to it, never by deleting a demo.

## Quick Start

```bash
gipity deploy            # Deploy functions
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
5. Need a database? Write `migrations/001-<name>.sql` (and list its tables
   under the function's `tables:`). Deploy adds the `sql` phase and creates the
   database; no `gipity db create`, no manifest edit.
6. Need a page (a dashboard, a history view)? Write `src/index.html`. Deploy
   adds the `static` phase and the Gipity client SDK, so `Gipity.fn('<name>')`
   works from the page's scripts. Give the page a visible loading, empty and
   error state so a failed call can't look like it is still loading.
7. `gipity deploy`, then `gipity test`.

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
migrations/     SQL migrations (create it when you need a database)
src/            Web pages (create it when you need a frontend)
workflows/      Scheduled/triggered YAML workflows (create it when you add one)
tests/          Test files (run with gipity test)
gipity.yaml     Deploy manifest (auto-populated for new functions)
```
