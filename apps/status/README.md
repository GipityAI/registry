# Gipity Status

Gipity's own status page, built on Gipity: every minute a scheduled workflow checks each Gipity service from the outside, records the result in the app's Gipity DB, and a public page shows the current state, uptime and 90 days of history for each one, plus incident notes the owner posts.

It runs live at https://status.gipity.ai. It is a hidden catalog entry (`gipity add status` in an empty project): Gipity's own app, not a template to suggest.

## What it checks

`functions/_lib/status.js` (`COMPONENTS`) is the list. All checks use public endpoints only, so the app holds no secrets:

| Component | Check |
|-----------|-------|
| API | `GET https://a.gipity.ai/health` |
| App hosting | `GET https://app.gipity.ai/_error/404.html` (a file the platform serves for every app) |
| Dev environments | `GET https://dev.gipity.ai/_error/404.html` |
| Gipity DB | `SELECT 1` on this app's own database |
| Gipity Storage | `storage.read` of a tiny file this app owns (copied in on the first run with `storage.importUrl`) |
| Gipity CDN | `HEAD https://media.gipity.ai/client/v1/gipity.js` |
| Gipity Realtime | `GET https://rt.gipity.ai/health` |
| AI services | `GET https://a.gipity.ai/health/ai` (503 while an upstream AI provider incident touches models, image, video, speech or audio; the body names only the affected Gipity services) |
| Docs | `GET https://docs.gipity.ai/` |
| Changelog | `GET https://a.gipity.ai/changelog?last=1` |

A function may fetch only these public Gipity endpoints (GET or HEAD to `a.gipity.ai/health`, `a.gipity.ai/health/ai`, `a.gipity.ai/changelog`, `rt.gipity.ai/health`, and any path on `app`, `dev`, `media` and `docs.gipity.ai`); every other `*.gipity.ai` URL is blocked. Each host must also be in the function's `fetch_domains` in `gipity.yaml`.

## States and uptime

- A check is **down** when it fails (error, timeout or non-2xx), **degraded** when it succeeds slower than the component's `slowMs` (500 ms for the DB, 1.5 s for most, 2 s for docs and the changelog), otherwise **operational**.
- A component's current state: two failed checks in a row is down; one failed or slow check is degraded. No checks in the last hour shows as no data.
- Uptime is the share of checks that were not down (degraded counts as up) over the last 24 hours, 7 days and 90 days. Days are UTC.
- A day's bar is down when 5% or more of its checks failed, degraded when any failed or 10% or more were slow.
- The headline is a major outage when half or more of the components are down, a partial outage when any is down or a major incident is open, degraded when any is slow or any incident is open.

## Data and retention

- `status_checks`: one row per component per minute (about 13,000 rows a day).
- `status_daily`: per component per UTC day: checks, degraded, down, average latency.
- `functions/maintain.js` runs nightly (`workflows/maintain.yaml`, 00:10 UTC): it rolls every finished day into `status_daily` first, then deletes checks older than 90 days. Re-running it is safe.

## Incidents

Post them as the owner with the member-only `incident-post` function (from the app's directory):

```bash
# open an incident (impact: minor | major; components: keys from COMPONENTS)
gipity fn call incident-post '{"title":"Slow deploys","components":["api"],"impact":"minor","body":"We are looking into slow deploys."}'
# add an update (status: investigating | identified | monitoring | resolved)
gipity fn call incident-post '{"incident":"inc_...","status":"monitoring","body":"A fix is out; watching it."}'
gipity fn call incident-post '{"incident":"inc_...","status":"resolved","body":"Deploys are back to normal."}'
# remove one posted by mistake
gipity fn call incident-delete '{"incident":"inc_..."}'
```

The page shows open incidents at the top and those resolved in the last 30 days at the bottom.

## JSON feed

`GET` (or `POST`) `https://a.gipity.ai/api/<app guid>/fn/status` returns the whole page as JSON, under `data` (the page itself reads it): `overall`, `components` (state, latest latency, uptime, 90 daily bars, hourly latency for the last 24 hours) and `incidents` with their updates. The footer links to it. There is no RSS or Atom feed: a function's HTTP response is always JSON (`{ "data": ... }`), so an XML feed would need a static file the app regenerates, which isn't worth it yet.

## Files

```
functions/
  _lib/status.js     components, thresholds, and the payload builder (pure, unit-tested)
  run-checks.js      probe everything, insert the results (auth: member; every minute)
  status.js          the public feed (auth: public)
  maintain.js        nightly rollup + 90-day prune (auth: member)
  incident-post.js   open or update an incident (auth: member)
  incident-delete.js remove an incident (auth: member)
migrations/001-status.sql
workflows/checks.yaml, workflows/maintain.yaml
src/                 the page (index.html, css/styles.css, js/main.js, js/config.js)
tests/api/           gipity test suites
```

## Deploying it as status.gipity.ai

Done once by a Gipity admin, from the `steve` account (a plan with no minimum schedule interval: the free plan allows one scheduled run a day, and the checks run every minute).

Step 1. Create the project and install the app:

```bash
mkdir -p ~/GipityProjects/status && cd ~/GipityProjects/status
gipity init status
gipity add /path/to/Gipity/registry/apps/status --force   # or `gipity add status` once the server ships the catalog entry
gipity project rename "Gipity Status"
```

Step 2. Check the page title: the `<h1>` in `src/index.html` and the page `<title>` come from the project name at install, so they should read `Gipity Status`; fix them there if not.

Step 3. Deploy and test on dev, then prod:

```bash
gipity deploy dev --inspect
gipity test
gipity deploy prod --inspect
```

The prod deploy arms both workflows. After a minute, `gipity fn call status` should show every component with a `checked_at`. Note: the HTTP checks of Gipity's own hosts need the platform server that allows functions to fetch the public Gipity endpoints (the 2026-11-18 change); on an older server they record as down.

Step 4. Add the custom domain to the project:

```bash
gipity domain add status.gipity.ai
```

It prints the DNS record to create: a **CNAME** named `status` (in the `gipity.ai` zone) pointing to `custom.gipity.ai`. `gipity.ai` DNS is in Route 53, so add it there:

```
status.gipity.ai.  300  IN  CNAME  custom.gipity.ai.
```

Step 5. Once DNS resolves (`getent hosts status.gipity.ai` shows 52.37.53.8), activate it:

```bash
gipity domain list               # note the domain id shown in [brackets]
gipity domain verify <domain id>
```

Verify checks the CNAME, adds the route to the custom-domain proxy, and Let's Encrypt issues the certificate on the first request. Then open https://status.gipity.ai.
