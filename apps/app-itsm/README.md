# ITSM

AI-native IT Service Management built on Gipity: incidents, knowledge, SLAs, a service catalog, and separate agent and employee portals. An alternative to ServiceNow, Jira Service Management and Freshservice for mid-market IT teams.

Hidden from `gipity add --list`; install it by key.

## Quick start

```bash
gipity add app-itsm --title "Acme IT"
gipity deploy dev
```

`gipity deploy` creates the database, applies `migrations/`, and deploys `functions/` and `workflows/` from `gipity.yaml`.

## What's Included

### V1 Modules
- **Incident Management** - Full lifecycle with AI auto-categorization, smart assignment, resolution suggestions, major incident management
- **Knowledge Management** - Article lifecycle (draft -> review -> published -> retired), AI auto-generation from resolved incidents
- **SLA Management** - Response + resolution SLAs by priority, business calendars, breach detection
- **Service Catalog & Requests** - Catalog items with approval workflows and fulfillment tracking
- **Employee Self-Service Portal** - Search-first portal with AI-powered issue reporting and KB deflection
- **Reporting & Analytics** - Pre-built dashboards with natural language query
- **AI Features** - Auto-categorize, smart assign, resolution suggest, KB gen, sentiment analysis, shift summary, command palette

### Two Portals
- **Agent Portal** (`/agent/`) - Split-pane workspace, command palette (Cmd+K), SLA timers, AI assist
- **Employee Portal** (`/portal/`) - Self-service: report issues, browse catalog, track requests, search KB

## Project Structure

```
src/                    # Vanilla JS SPA frontend
  index.html            # Entry point + router outlet
  js/
    main.js             # Router setup & page registration
    config.js           # API base URL, app GUID, tokens
    api.js              # API client (fetch wrapper with auth)
    router.js           # Client-side History API routing
    command-palette.js  # Cmd+K command interface
    utils.js            # Shared utilities
    components/         # Reusable UI components (data-list, filter-chips, tabs, kb-deflection)
    pages/
      agent/            # Agent portal pages (9 pages)
      portal/           # Employee portal pages (4 pages)
  css/
    tokens.css          # Design tokens (colors, spacing, typography)
    layout.css          # Layout primitives
    components.css      # Component styles
migrations/             # schema, applied by `gipity deploy`
seed/                   # default data (SLA policies, categories, catalog)
functions/              # 9 V8 serverless functions (AI + SLA + reporting)
workflows/              # 10 YAML automation workflows
```

## Key Files

| File | Purpose |
|------|---------|
| `src/js/config.js` | API base URL, app GUID, auth tokens |
| `src/js/api.js` | All API calls to Gipity platform |
| `src/js/router.js` | Page routing (agent/* and portal/*) |
| `functions/classify-incident.js` | AI auto-categorization engine |
| `functions/smart-assign.js` | AI-powered ticket assignment |
| `functions/suggest-resolution.js` | AI resolution suggestions |
| `workflows/01-auto-categorize-assign.yaml` | Auto-classify + assign on new incidents |
| `workflows/03-sla-breach-check.yaml` | SLA breach detection (runs every 5 min) |

## SLA Defaults (from seed data)

| Priority | Response | Resolution | Calendar |
|----------|----------|------------|----------|
| P1 Critical | 15 min | 4 hours | 24x7 |
| P2 High | 30 min | 8 hours | 24x7 |
| P3 Moderate | 4 hours | 3 days | Business hours |
| P4 Low | 8 hours | 5 days | Business hours |
