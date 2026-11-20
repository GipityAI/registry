# docs/

Reference material for this project — UI/architecture diagrams, design decks,
notes, ADRs, anything you want to **keep but never ship**.

Files here are synced and versioned on Gipity (backed up, rollback-able) but are
**never deployed**: deploy only uploads `src/`. So this is the home for
keep-forever artifacts that should not reach the live site.

Buckets at a glance:

- `src/`   — the app. Synced **and** deployed to the CDN.
- `docs/`  — reference material. Synced, versioned, **not** deployed (this folder).
- `tmp/`   — throwaway scratch (conversions, intermediate output). Already
             ignored: never synced, never deployed. Do disposable work here.
             (`*_tmp/` and `.gipityscratch/` are auto-ignored too.)
- `tests/` — `*.test.js` suites. Synced, run by `gipity test`, not deployed.

Rule of thumb: shipping to users → `src/`; keep as reference → `docs/`; throwaway → `tmp/`.
