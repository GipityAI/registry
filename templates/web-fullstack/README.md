# {{TITLE}}

A full-stack web app on Gipity - frontend + serverless API + database.

## Quick Start

```bash
gipity deploy dev        # Deploy frontend, run migrations, deploy functions
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

## What it does

A weather lookup app. The user enters a US zip code on the homepage. The frontend
calls the `get-weather` API function, which fetches current weather from the free
Open-Meteo API and stores the lookup in the `weather_lookups` table. The page
also shows recent lookups via the `get-recent` function.

## Endpoints

| Function | Description |
|----------|-------------|
| `get-weather` | Fetches weather for a zip and persists the lookup |
| `get-recent`  | Returns the most recent weather lookups |

## Calling the API

```bash
# Get weather for a zip code
curl -s -X POST https://a.gipity.ai/api/{{PROJECT_GUID}}/fn/get-weather \
  -H 'Content-Type: application/json' -d '{"zip": "90210"}'

# List recent lookups
curl -s -X POST https://a.gipity.ai/api/{{PROJECT_GUID}}/fn/get-recent \
  -H 'Content-Type: application/json' -d '{}'
```

**Auth levels:** `public` (no auth), `user` (login required), `member` (project member required).
