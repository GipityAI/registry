# @gipity/servicenow

Use ServiceNow tables as a data source in a Gipity app: OAuth-authenticated
polling pulls rows into a local Postgres mirror (`sn_records`), and your app
can write records back into ServiceNow. Any table, configurable per app - not
a fixed ITSM table list.

**Pull mode** (scheduled read + on-demand write, both over ServiceNow's REST
Table API) works standalone. **Real-time sync** (a ServiceNow Business Rule
pushing changes to a Gipity webhook the instant they happen, instead of
waiting for the next poll) is additive on top of it - see "Setup (real-time
sync, optional)" below.

## Setup (ServiceNow admin, once)

1. **Create a dedicated service account** (e.g. `gipity.integration`) with
   read/write access to the tables you want synced. **Do not use the built-in
   `admin` account** - on the instance we tested this against, `admin` was
   rejected by the Table API (`401`, generic "not authenticated") even though
   the exact same credentials worked fine logging into the browser UI. A
   freshly created account with the same role worked immediately. This is
   also the identity the OAuth application will authenticate as below, so
   create it first.

2. **Enable the inbound Client Credentials grant type** (required, and easy to
   miss - it is NOT on by default on any instance we've tested). System
   Properties > All Properties > New (or the `sys_properties` table directly):
   ```
   name:  glide.oauth.inbound.client.credential.grant_type.enabled
   type:  true | false
   value: true
   ```
   Without this property, every token request for `grant_type=client_credentials`
   fails with a generic `401 access_denied`, and the system log shows a
   misleading `unsupported_grant_type_for_pkce: ... PKCE only supports
   authorization code flow` error that has nothing to do with the real cause.

3. **Register an OAuth application**: System OAuth > Application Registry >
   New > "Create an OAuth API endpoint for external clients". Grant type
   **Client Credentials**, bound to the dedicated service account from step 1.
   Note the **Client ID** and **Client Secret** - you'll need both below.

   > That service account matters beyond auth: a future real-time sync phase
   > will use it to distinguish "ServiceNow changed this" from "Gipity wrote
   > this" (so a write-back doesn't get immediately re-synced as if it were an
   > external change). Keep it dedicated to this integration.

4. **Note your instance URL**, e.g. `https://mycompany.service-now.com`.

## Setup (this app)

```bash
gipity add servicenow
node src/packages/servicenow/scripts/connect.mjs \
  --instance https://mycompany.service-now.com --username gipity.integration
```

`scripts/connect.mjs` (installed with the kit) does steps 2-3 above for you
against the ServiceNow instance - the dedicated service account from step 1
still has to exist first, since it authenticates as that account. It checks
the system property (creating it if missing), registers or rotates the OAuth
application + its entity profile, verifies a real token exchange end to end,
then runs `gipity secrets set` for you (or prints the commands with
`--no-secrets` / if the `gipity` CLI isn't on PATH). It prompts for the
username/password if you omit the flags, with the password entry masked; the
password is used directly against your instance and never sent anywhere else
- not to Gipity, not logged, not stored. Safe to re-run any time (it rotates
credentials on the existing OAuth application rather than duplicating it).
Or do it by hand:

```bash
gipity secrets set SERVICENOW_INSTANCE_URL https://mycompany.service-now.com
gipity secrets set SERVICENOW_CLIENT_ID <client id>
gipity secrets set SERVICENOW_CLIENT_SECRET <client secret>
gipity secrets set SERVICENOW_TABLES incident,problem   # comma-separated, any ServiceNow table
```

**Required manual step**: add your instance's hostname to `fetch_domains` for
both `sn-pull` and `sn-write` in `gipity.yaml` (the kit can't know your
instance's hostname ahead of time, and the platform requires every outbound
domain to be explicitly declared - no wildcards):

```yaml
- name: sn-pull
  auth: user
  tables: ['sn_records']
  fetch_domains: ['mycompany.service-now.com']
- name: sn-write
  auth: user
  tables: ['sn_records']
  fetch_domains: ['mycompany.service-now.com']
```

Then `gipity deploy`.

## Setup (real-time sync, optional)

Once pull mode is deployed (sn-webhook has to exist before ServiceNow can push
to it), add real-time push on top:

```bash
node src/packages/servicenow/scripts/connect-realtime.mjs \
  --instance https://mycompany.service-now.com --username gipity.integration \
  --tables incident,problem
```

This creates (or idempotently updates, safe to re-run) three things on the
ServiceNow side, then stores the webhook secret as a Gipity secret:

- **System properties** `gipity.webhook.url` / `gipity.webhook.secret` - the
  webhook URL is auto-derived from `.gipity.json` in your app directory (or
  pass `--webhook-url` explicitly).
- **A Script Include** (`GipitySync`) that POSTs a changed record's fields to
  the webhook URL.
- **A Business Rule per table** (`async_always`, so the push never blocks the
  ServiceNow user's save), wired to call `GipitySync`. The condition
  `gs.getUserName() != '<your service account>'` is the loop-prevention
  mechanism: a write Gipity itself made (via `writeRecord()`, which
  authenticates as that same service account) is never pushed back - only
  changes made by other ServiceNow users/processes are. **This means the
  service account from setup step 1 must be dedicated to this integration** -
  if it's shared with real users doing real work, their changes won't sync
  either. Deletes are out of scope (`sn_records` has no tombstone concept).

The shared secret travels inside the JSON body (`{ secret, record }`), not a
header - Gipity's function runtime only forwards a small allowlist of headers
to function code, so a custom header would be silently dropped before
`sn-webhook` ever saw it.

ServiceNow Business Rules are inherently per-table, so adding a new table
later means re-running this script with the fuller `--tables` list (existing
rules are matched by name and updated in place, not duplicated).

## Use it

```js
import { pullNow, writeRecord } from '@gipity/servicenow';

// Manually trigger a pull cycle (the same work the 5-minute cron runs).
await pullNow();

// Create a ServiceNow incident (omit sysId), or update one (pass sysId).
const { record } = await writeRecord('incident', null, { short_description: 'VPN down' });
await writeRecord('incident', record.sys_id, { state: '2' });
```

Read mirrored data with your own function against `sn_records` directly
(a plain table: `sn_table`, `sys_id`, `data jsonb`, `sn_updated_on`, `origin`,
`synced_at`) - this kit ships no generic read endpoint, since the shape of
what you want back (filtered, joined, paginated) is app-specific:

```sql
SELECT sys_id, data->>'short_description' AS short_description, data->>'state' AS state
FROM sn_records
WHERE sn_table = 'incident'
ORDER BY sn_updated_on DESC;
```

## What it ships

- **Frontend** (`@gipity/servicenow`): `pullNow()`, `writeRecord(table, sysId, fields)`.
- **Functions**: `sn-pull` (`auth: user`, invoked by the cron workflow below -
  the cron dispatch runs server-side and bypasses the HTTP auth gate entirely;
  `auth: user` only closes the direct-HTTP path so a random caller can't
  trigger repeated polls against your instance), `sn-write` (`auth: user`,
  called from your app code), and `sn-webhook` (`auth: public` - the real-time
  sync receiver; verifies the shared secret embedded in the request body
  before writing anything).
- **Workflow**: `01-poll-servicenow.yaml` - cron, every 5 minutes, calls `sn-pull`.
  Table selection and credentials are runtime config (secrets), so this file
  needs no per-app editing; it's kit-owned (re-adding the kit at a newer
  version overwrites it, same as `functions/`/`migrations/`).
- **Table**: `sn_records` - one row per `(sn_table, sys_id)`, raw ServiceNow
  fields in `data jsonb` (not typed columns - ServiceNow tables are arbitrary
  and their schema is unknown ahead of time; admins add custom fields per
  instance). `origin` records how each row arrived (`pull`, `write`, or `webhook`).
- **Setup scripts**: `scripts/connect.mjs` (OAuth/pull setup - grant-type
  property, OAuth application + entity profile, live token-exchange
  verification) and `scripts/connect-realtime.mjs` (real-time sync setup -
  Script Include, Business Rule per table, webhook properties). Both store
  their resulting secrets automatically. See "Setup" above.

## Notes

- `SERVICENOW_TABLES` accepts any ServiceNow table name, comma-separated -
  standard (`incident`, `problem`, `change_request`, `cmdb_ci`, `sys_user`) or custom.
- The pull cycle is incremental: each table's `MAX(sn_updated_on)` in
  `sn_records` is the low-water mark for the next query, so only changed rows
  are re-fetched.
- Needs a database - install into a `web-fullstack` or `api` app.
