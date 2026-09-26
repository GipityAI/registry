# Monitor

The Gipity web app you sign in to: your projects, deploys, logs, compute, files, spend and account in one place. Gipity serves it from the platform's own origin, deployed from this template.

Everything Monitor shows or changes goes through a documented REST route that the `gipity` CLI also calls. If Monitor can do it, the CLI can, and `platform/scripts/check-route-parity.ts` checks every call in `src/js/api.js` against the server's routes.

## Tabs

- **Projects** (landing): every project, its dev/prod/custom URLs, per-target deploy phases, and the last deploy's result.
- **Overview**: health verdict, what needs attention, recent deploys.
- **Observe**: Traffic, Activity, Errors, Chats (recorded coding-agent sessions), Audit.
- **Project**: Compute (Functions, Jobs, Sandbox, Workflows, Tests; job, workflow and test runs open a detail view with output, logs and per-step or per-test results), Data (storage, a file browser with version restore, databases), Services, Hosting.
- **Account**: Plan (balance, limits, billing through Stripe), Usage, Devices, Alerts, Secrets, Account (profile, API tokens, delete account).

## Auth

Monitor signs in with the Gipity popup, which sets the session cookie on the API host. The API accepts that cookie as the account only on requests from the platform's own origin. Hosted apps all share `app.gipity.ai`, so a copy served from there can sign in but can't read account data through the cookie.

## Files

```
src/
  index.html        - layout, tab panels, dialogs
  css/styles.css    - theme (Gipity orange #fea60b)
  js/
    main.js         - orchestrator: sign-in gate, tab routing, filters, refresh
    api.js          - the REST client (every route Monitor calls)
    auth.js         - Sign in with Gipity popup flow
    detail.js       - the shared detail dialog
    format.js       - number, time and status helpers
    tabs/           - one module per tab or sub-tab
```

## Editing

This app is the source of every account's own Monitor (each account gets a copy at signup). To try a change, install it into a test project (`gipity add <path-to-this-dir> --force`, then `gipity deploy dev`) and sign in as that project's owner: Monitor reads the account through the owner-only Account scope, so it loads data only for the owner. After a server deploy ships a change, `scripts/update-app-copies.ts monitor --apply` (platform) updates every copy its owner hasn't edited.
