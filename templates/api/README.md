# {{TITLE}}

A REST API powered by Gipity. No frontend - just functions and tests.

## Quick Start

```bash
gipity deploy dev        # Deploy functions
gipity test              # Run all tests
```

## Endpoints

| Function | Description |
|----------|-------------|
| `get-weather` | Current weather for a US zip code (via Open-Meteo) |

## Calling the API

Public functions need no authentication - just call them directly:

```bash
# Get weather for a zip code
curl -s -X POST https://a.gipity.ai/api/{{PROJECT_GUID}}/fn/get-weather \
  -H 'Content-Type: application/json' -d '{"zip": "90210"}'
```

**URL pattern:** `POST /api/{PROJECT_GUID}/fn/{name}`

**Auth levels:** `public` (no auth), `user` (login required), `member` (project member required).

Function permissions (tables, fetch_domains, services) are declared in `gipity.yaml` under `function_definitions`.

## Project Structure

```
functions/      Serverless functions (auto-deploy as public endpoints)
tests/          Test files (run with gipity test)
gipity.yaml     Deploy manifest (auto-populated for new functions)
```

Functions in `functions/` auto-deploy as public endpoints. Edit `gipity.yaml` to customize auth, database access, or HTTP permissions.
