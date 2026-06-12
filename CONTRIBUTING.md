# Contributing to the Gipity Registry

Templates and kits are designed to be edited and added to. This guide covers the inner loop, the catalog wiring, and the tests we expect.

## Prerequisites

- A Gipity account and the CLI (`npm install -g gipity && gipity init`)
- A clone of the main Gipity repo alongside this one — the catalog metadata (`TEMPLATES` and `KITS` arrays) and the dev/sync scripts live there. This repo holds only the source files for each template and kit.

## Editing an existing template

From inside the linked dev app directory, run `gipity add <path-to-the-template> --force` followed by `gipity deploy dev`. The CLI walks the template directory, POSTs a payload, and the server runs the same `installTemplate` pipeline a real user hits — placeholder substitution (`{{TITLE}}`, `{{PROJECT_GUID}}`, `{{DESCRIPTION_META}}`...), favicon generation, deploy-checksum tracking. ~1-2 s round trip.

```bash
cd ~/GipityProjects/my-test-app
gipity add /home/me/Gipity/registry/templates/3d-world --force
gipity deploy dev
```

For multi-client / realtime work, after the deploy use `just multi-test <url>` from the main Gipity repo to spin staggered headless clients at the deployed URL and check host election, world sync, presence, and reconnection.

### Editing a kit

Kits still install through the server's bundled catalog via `gipity add <kit-name>`. A kit edit requires the server to be redeployed (`just deploy-server-fast` from `platform/`) before `gipity add <kit-name>` picks up the new version. If the kit is bundled inside a template (e.g. `audio-align` inside `karaoke-captions`), iterate on the template instead — the kit ships as part of the template payload.

## Adding a new template

1. Create the directory under `registry/templates/<key>/`. Pick a short, literal key (`web-simple`, `3d-engine`) — no `-template` / `-starter` suffix.
2. In the main Gipity repo, add an entry to `TEMPLATES` in `platform/packages/shared/src/constants.ts`:
   ```ts
   {
     key: 'your-key',
     label: 'Display name',
     description: 'One-line description shown in help text.',
     pickHint: 'Concrete examples a user might describe in their own words.',
     dir: 'your-key',     // matches the directory you created
     visible: true,
     kind: 'template',    // or 'starter' for a working demo
   },
   ```
3. Add the user-facing copy in `registry/templates/README.md`.
4. Add tests — the [Testing](#testing) section below details what's required.
5. The `registry-layout.test.ts` guard will verify the directory exists and is non-empty. If you forget step 1, this fails immediately.

### `kind: 'template'` vs `'starter'`

- **template** — blank wiring only. No gameplay, no business logic. The user (or their agent) writes everything on top. Use for new builds.
- **starter** — a complete, working demo. The user can run it as-is, then replace or extend pieces. Use as a playable reference.

Keep keys flat. The `kind` field carries the distinction — don't bake it into the key name.

## Adding a new kit

A kit is an npm-style package that gets copied into an app's `src/packages/<key>/`. It needs:

1. A directory under `registry/kits/<key>/` with at minimum an `index.js` (the entry point) and a `package.json` containing a `gipity.install` block describing import-map entries and any deploy phase.
2. An entry in `KITS` in `platform/packages/shared/src/constants.ts` (same shape as templates, minus `kind` / `visible` / `pickHint`).
3. A `README.md` in the kit directory explaining the kit's API.
4. Tests covering kit-install behavior. See `platform/server/src/__tests__/kit-install.test.ts` for the unit test pattern; e2e behavior is exercised by `add-e2e.test.ts`.

If a kit is meant to ship pre-installed in a specific template (like `realtime` in the 3D templates), wire that up in `platform/scripts/sync-registry.ts` so the kit is mirrored into the template at sync time.

## The sync gate

`registry/templates/_shared/` is the canonical source for non-kit code reused across templates (currently the `gipity-theme.css` brand theme used by the Water.css templates `web-simple` and `web-fullstack`). Same for kits that are pre-installed in templates (`realtime` → 3D templates, `web-vision-mediapipe` → `web-vision-cam`).

After any edit to `_shared/` or to a synced kit:

```bash
npx tsx platform/scripts/sync-registry.ts          # write copies
npx tsx platform/scripts/sync-registry.ts --check  # CI gate — fail on drift
```

The `--check` mode runs in CI and will block a merge if a synced file is out of date.

## Testing

We require tests for every new template or kit. The relevant suites:

| Test | What it checks |
|---|---|
| `platform/server/src/__tests__/template.test.ts` | File presence + structural assertions per template. Add a `describe('<your-key> template directory', …)` block. |
| `platform/server/src/__tests__/registry-layout.test.ts` | Layout guard — passes automatically once your catalog entry + directory exist. |
| `platform/server/src/__tests__/add-e2e.test.ts` | Full `gipity add <name>` flow against a live server. Extend with a block for new visible entries. |
| `platform/server/src/__tests__/kit-install.test.ts` | Unit tests for kit install plumbing. Cover any new install-time logic your kit introduces. |

Run them from `platform/server/`:

```bash
npm run test:fast                               # all unit + integration tests
E2E_BASE_URL=https://a.gipity.ai \
  npx jest --forceExit --testPathPatterns='add-e2e'   # against deployed server
```

## House style

- File structure mirrors what a deployed app looks like — `src/` (web root), `functions/` (serverless API), `migrations/` (database), `tests/`.
- Code uses standard JavaScript / HTML with no proprietary dependencies. Third-party libraries (Three.js, Rapier, Colyseus, Phaser, MediaPipe) are loaded from CDN via import maps.
- Templates use `{{VARIABLE}}` substitution for per-app values (title, project GUID, etc.) — see existing templates for the convention.
- Strings the user might want to translate live in `js/strings.js` so they're easy to find.

## Pull request checklist

- [ ] Catalog entry added in `platform/packages/shared/src/constants.ts`
- [ ] Directory created under `registry/templates/` or `registry/kits/`
- [ ] User-facing docs updated (`registry/templates/README.md` or `registry/kits/<kit>/README.md`)
- [ ] Tests added (file-presence assertions for templates; install behavior for kits)
- [ ] `npx tsx platform/scripts/sync-registry.ts --check` passes
- [ ] `npm run test:fast` passes (from `platform/server/`)
- [ ] Verified locally via `gipity add <path> --force` + `gipity deploy dev` against a real dev app
