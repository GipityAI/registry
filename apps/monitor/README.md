# Monitor

The Gipity web app you sign in to: your projects, deploys, logs, compute, files, spend and account in one place. Every account gets its own copy at signup, a normal project served at `https://monitor--<account>.gipity.app/`.

Everything Monitor shows or changes goes through a documented REST route that the `gipity` CLI also calls. If Monitor can do it, the CLI can, and `platform/scripts/check-route-parity.ts` checks every call in `src/js/api.js` against the server's routes.

## Tabs

- **Projects** (landing): every project, its prod URL, each of its environments, custom domains, deploy phases, and the last deploy's result.
- **Overview**: health verdict, what needs attention, recent deploys.
- **Observe**: Traffic, Activity, Errors, Chats (recorded coding-agent sessions), Audit.
- **Project**: Compute (Functions, Jobs, Sandbox, Workflows, Tests; job, workflow and test runs open a detail view with output, logs and per-step or per-test results), Data (storage, a file browser with version restore, databases), Services, Hosting, AI connections (for the picked project and one of its environments: the keys people made for their own AI and the chat apps they connected through its MCP server, with per-function call counts and revoke; plus its MCP server and key profiles).
- **Account**: Plan (balance, limits, billing through Stripe), Usage, Alerts, Secrets, Account (profile, API tokens: list and revoke, passkeys).

## Auth

Monitor acts as your whole account, so its dashboard runs only on its own origin, `https://monitor--<account>.gipity.app/` (app hosting `own`). It signs in through the Gipity SDK with the owner-only Account scope: a popup, an explicit consent, then a one-time hand-off that sets a host-only `__Host-gipity_session` cookie. Every API call goes same-origin to `/__gipity/...`, and the platform allows only the routes on its owner-app table (`platform/server/src/middleware/owner-app-host.ts`). Creating an API token and deleting the account are not on that table: use `gipity token create` and `gipity account delete`. On `app.gipity.ai` the page shows a link to the own address, or a pointer to the CLI if this Monitor has not moved yet.

The page carries a strict Content-Security-Policy in a meta tag (scripts: this origin, the pinned Chart.js with SRI, the Gipity SDK; connections: this origin). `frame-ancestors` can't be set from a meta tag; the host's response headers set it. Escape every server or visitor string that goes into HTML with `escapeHtml` (`src/js/format.js`).

## Files

```
src/
  index.html        - layout, tab panels, dialogs
  css/styles.css    - theme (Gipity orange #fea60b)
  js/
    main.js         - orchestrator: sign-in gate, tab routing, filters, refresh
    api.js          - the REST client (every route Monitor calls)
    auth.js         - where Monitor is running, and sign-in through the Gipity SDK
    theme-boot.js   - applies the saved theme before the stylesheet loads
    detail.js       - the shared detail dialog
    format.js       - number, time and status helpers
    tabs/           - one module per tab or sub-tab
```

## Editing

This app is the source of every account's own Monitor (each account gets a copy at signup). To try a change, install it into a throwaway account's Monitor (`gipity add <path-to-this-dir> --force`), set that Monitor to `gipity project hosting own`, run `gipity deploy prod`, and sign in as its owner on its own address: the account path works only on a prod Monitor on its own origin, so a `dev` deploy can't load the dashboard. After a server deploy ships a change, `scripts/update-app-copies.ts monitor --apply` (platform) updates every copy its owner hasn't edited.
