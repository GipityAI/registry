# {{TITLE}}

A full-stack web app on Gipity - frontend + serverless API + database. This
template is empty by design: every deploy phase is already wired and deploys
green with zero functions, zero migrations and zero tests. Nothing here is a
demo you have to clean up - there is only code to add.

## Quick Start

```bash
gipity deploy dev        # Deploy frontend, create the database, deploy functions
gipity test              # Run all API tests
```

## Architecture

```
src/             Frontend (HTML/CSS/JS) → served from CDN
functions/       Serverless API endpoints (create files as you need them)
migrations/      SQL schema - each file runs once, in filename order
workflows/       Scheduled/triggered YAML workflows (create it when you add one)
tests/           API tests in tests/api/<name>.test.js (run with gipity test)
gipity.yaml      Deploy manifest - every phase is already wired
```

Every phase is declared and every directory is optional: a phase whose directory
is empty is simply skipped, so `gipity deploy dev` is green from the first
minute and stays green as you fill them in.

## Tests

`gipity test` runs `tests/api/*.test.js`. `test` and `assert` are globals - do
not import them. Three things to know before writing DB tests:

- Tests run against a throwaway copy of your database, reset once per RUN, not
  per test - rows an earlier test inserted are still there. Assert on rows you
  can identify (your own marker), never on a table's total contents.
- `ctx.testId` is stable per FILE, so it keeps files from colliding; add your
  own suffix when one test needs exclusive rows.
- `ctx.fn.call()` is unauthenticated and THROWS on an `auth: user` function
  (assert that gate with `assert.rejects`); use `ctx.fn.callAs(ctx.users.alice,
  name, params)` for the signed-in path.

## Build your app

1. Define your schema as `migrations/001-<name>.sql`. Give each table a
   `short_guid VARCHAR(20) PRIMARY KEY` (make one with `guid('item')` in a
   function); arrays and nested objects go in a `JSONB` column.
2. Write functions in `functions/<name>.js`. Deploy auto-declares each new file
   in `gipity.yaml` as `auth: public` - you only edit that entry to change auth,
   tables, fetch_domains, or services.
3. Call them from `src/js/main.js` with `Gipity.fn('<name>', body)`.
4. To run something on a schedule, drop a `workflows/<name>.yaml` with
   `trigger: schedule` + `cron:` - the `workflows` phase is already declared, so
   `gipity deploy` creates it and arms the schedule (see the `workflow` skill).
5. `gipity deploy dev`, then `gipity test`.

## Calling the API

```bash
curl -s -X POST {{API_BASE}}/api/{{PROJECT_GUID}}/fn/<function_name> \
  -H 'Content-Type: application/json' -d '{}'
```

`auth: public` functions accept calls from anywhere on the internet, so this URL
is what you give to external callers (webhooks, devices, third-party services).
Exception: a localhost/docker host means a local dev platform instance - that
URL only works from the dev environment; don't hand it out externally.

**Auth levels:** `public` (no auth), `user` (login required), `member` (project member required).
