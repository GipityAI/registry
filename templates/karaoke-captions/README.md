# karaoke-captions

Upload audio + paste lyrics → tune word timings by ear → render a karaoke MP4. The full SupCap pipeline ported to Gipity.

Three layers:

1. **Forced alignment** on Modal L4 GPU (Demucs vocal isolation + MMS_FA), via the [@gipity/audio-align](src/packages/audio-align/README.md) kit pre-bundled at `src/packages/audio-align/`.
2. **Per-word editor** in the browser — audio player + editable timing per word + `⇤now` / `now⇥` shortcuts.
3. **MP4 render** on a cpu-large job — Remotion + ffmpeg. Three modes: preview (1280×720), HD (1920×1080), 4K (3840×2160).

All state — uploaded audio, lyrics, phonetic respellings, alignment JSON, render outputs — persists in a per-project Postgres database (`songs` + `renders` tables, see `migrations/`). Audio + MP4 binaries live on the project's S3-backed `media.gipity.ai` CDN. The browser only needs a `song_guid` to resume any flow on reload.

## What you get out of the box

```
src/
  index.html                    SPA shell: sidebar + 4-tab stepper (Upload · Edit · Style · Render)
  css/styles.css
  js/
    main.js                     orchestrator: tab routing, song lifecycle, sidebar
    api.js                      app GUID + callFn/upload helpers
    sidebar.js                  your project list (browser localStorage)
    stepper.js                  step-state machine
    tabs/upload.js              tab 1: audio + lyrics → generate
    tabs/edit.js                tab 2: per-word timing editor
    tabs/style.js               tab 3 "Split": colors, size/shape, phrasing + live preview
    tabs/export.js              tab 4 "Render": render list with inline players
  assets/
    sample.mp3                  23 s bundled Gipity rap (try the demo immediately)
    sample-lyrics.txt           display lyrics for the rap
    sample-phonetic.txt         phonetic respellings (same word count)
    sample-corrections.json     lighter alternative: {display → phonetic} pairs
  packages/
    audio-align/                @gipity/audio-align kit, pre-bundled
migrations/
  001-supcap-schema.sql         songs + renders tables (per-project DB)
  002-render-options.sql        renders.render_options (per-render style snapshot)
  003-render-metrics.sql        renders.render_frames / fps / resolution / aspect
functions/
  song-create.js                POST { audio_url, lyrics, ... } → INSERT, returns song_guid
  song-get.js                   GET ?guid= or POST { song_guid } → song row + renders[]
  song-align.js                 submit audio-align job (on_complete=song-align-complete)
  song-align-complete.js        platform fires this on align done → writes alignment_json
  song-save-alignment.js        editor save → UPDATE songs.alignment_json
  song-render/
    index.js                    INSERT render row + submit render job (on_complete=render-complete)
    sanitize.js                 validates the style snapshot before persisting
  render-complete.js            platform fires this on render done → writes video_url + metrics
jobs/
  render/
    main.js                     Remotion bundle + renderMedia + upload (composition inlined here)
    package.json                @remotion/bundler + @remotion/renderer + react
gipity.yaml                     static + database + functions + jobs phases
```

## Quick start

```bash
gipity init my-karaoke
cd my-karaoke
gipity add karaoke-captions
gipity deploy dev
```

First deploy installs the Remotion+Chromium toolchain in the render job's container (~5-10 min, cached after). The audio-align job's GPU image is already baked into the platform fat-image, so alignment starts cold in ~20 s.

Open the deployed URL → click **Use demo MP3** to align the included Gipity rap → wait ~30-60 s for the editor to load → tune any words that drifted on the **Edit** tab → set colors/size/aspect on the **Style** tab → **Render video** → watch it appear (and play inline) on the **Render** tab ~30 s later.

The **Advanced** section under the lyric box exposes two optional inputs the underlying audio-align kit understands:

- **Phonetic lyrics** — full phonetic respelling (e.g. `Gipity` → `Jip-ih-tee`). Same word count as Lyrics. MMS_FA aligns against the phonetic form; output keeps your display words.
- **Corrections** — lighter alternative: one `display = phonetic` per line. Applied before alignment; ignored if Phonetic lyrics is also filled.

## End-to-end flow

```
       browser              functions           jobs               storage
  ─────────────────    ──────────────────  ─────────────────  ─────────────────
  upload audio  ──►  POST /uploads/init ──────────────────► media.gipity.ai
                                                              (public CDN URL)
                  ──► song-create ──► INSERT songs row    ──► per-project DB

                  ──► song-align ──► jobs.submit('audio-align')
                                                ▼
                                         Modal L4 (~45 s)
                                                ▼
                  (on_complete) ◄── song-align-complete ──► UPDATE alignment_json

  edit / save ──► song-save-alignment ──► UPDATE alignment_json

  render      ──► song-render ──► INSERT renders row + jobs.submit('render')
                                                ▼
                                  cpu-large (Remotion + ffmpeg)
                                                ▼
                                       POST /uploads/init ──► media.gipity.ai
                                                ▼
                  (on_complete) ◄── render-complete ──► UPDATE video_url

  poll        ──► song-get ──► song + renders[]
```

No client polling against the job system — the editor + render UI just poll `song-get` every 2 s and watch the row state flip. The `on_complete` hooks land each result back in the DB exactly once.

## Cost

| Step | Compute | Wall clock | Credits |
|---|---|---|---|
| Forced alignment | gpu-small (Modal L4) | ~45 s for a 3-min song | ~0.013 |
| Render (preview) | cpu-large | ~30 s for a 3-min song | ~0.001 |
| Render (4K) | cpu-large | ~5-15 min | ~0.02 |
| File storage | S3 | per GB-month | per project |

All at 100% platform margin over provider rates.

## Customization

- **Style without code.** The **Style** tab covers most of what you'd want: caption colors, font size (fixed % or auto-fit "max"), edge padding, aspect ratio (16:9 / 9:16 / 1:1), phrase splitting (natural / fixed-length), and toggles for the upcoming-line preview and the "Powered by Gipity" footer. Each render keeps its own style snapshot, so the Render tab can re-apply any past look.
- **Resolution & aspect.** Choose the resolution tier (Preview 720p / HD 1080p / 4K) and aspect ratio in the Style tab — the frame size is the tier's short side × the aspect, so the same font size looks identical across both.
- **Composition design.** The Remotion composition is inlined in `jobs/render/main.js` as `COMP_SONGVIDEO_JSX` (a React component string). Edit it to change layout, animation, or per-word styling beyond what the Style tab exposes.
- **Skip demucs for clean audio.** Edit `functions/song-align.js` to pass `skip_demucs: true` (or extend the song row to expose it from the UI). Saves ~20 s of GPU per run on a cappella / dry stem inputs.
- **Different GPU class.** Edit the `compute:` field in `gipity.yaml` to `gpu-medium` / `gpu-large` / `gpu-huge`. Larger isn't faster for MMS_FA — L4 is the cheapest fit.
- **Auth.** Browser-facing functions are `auth: public` so the demo works without sign-in. Tighten to `auth: user` to gate behind Gipity sign-in (be mindful of GPU/render spend if you leave it open).

## Limitations

- **English only** — MMS_FA's default bundle ships an English character dictionary. Phonetic respellings buy you a lot, but non-Latin scripts need a different bundle.
- **Lyrics must approximate what's sung.** If the vocalist ad-libs words not in the lyrics, alignment drifts after that point. The kit returns `aligned: false` / `confidence: 0` on words it couldn't anchor — the editor flags these so you can fix them by hand.
- **10 in-flight render/align jobs per project.** Submit more and they queue at 10 concurrent (auto-scales above that on the compute side).
- **MP4 output only.** Three resolution tiers (preview 720p / HD 1080p / 4K) across 16:9, 9:16, or 1:1. Transparent-background (alpha) export isn't supported.

## Where things live

- **Alignment handler**: `src/packages/audio-align/jobs/align/main.py` (the kit). Demucs → MMS_FA → librosa. Don't edit in-place — fork the kit if you need different behavior.
- **Render handler**: `jobs/render/main.js`. Bundles Remotion, runs renderMedia, uploads the MP4. The composition lives here too, inlined as a React component string (`COMP_SONGVIDEO_JSX`) — the job tier ships a single handler file, so there are no separate `.jsx` files. Edit freely.
- **Database schema**: `migrations/001-supcap-schema.sql` (+ `002`, `003`). Add a new numbered migration (`004-*.sql`) for further schema changes; runs are idempotent so re-deploys are safe.

## See also

- [@gipity/audio-align](src/packages/audio-align/README.md) — the underlying alignment kit (reusable in any Gipity app)
- `gipity skill read jobs` — job tier reference (compute classes, billing, fat image contents)
- `gipity skill read app-files` — the presigned-upload flow used by both the browser audio upload + the render job's MP4 upload
