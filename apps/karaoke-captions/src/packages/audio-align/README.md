# @gipity/audio-align

Forced alignment as a kit. Hand it an audio URL + lyric text, get back word-level timings (start_ms, end_ms, confidence). Demucs vocal isolation + `torchaudio.pipelines.MMS_FA`, runs as a Modal L4 GPU job. Useful for **karaoke captions**, **subtitling**, **language learning**, **dubbing alignment**, **lyric videos**.

```
audio-align/
  package.json          install block (registers the `audio-align` job)
  index.js              browser-side helpers: submit() / status() / waitForResult() / align()
  jobs/align/main.py    GPU handler (Python, demucs + MMS_FA + librosa)
  examples/             worked example wrapper function
```

Cold start ~10s, run ~30-60s for a 3-min song on L4. Demucs + MMS_FA model weights cache in `/cache/` after first run, so subsequent jobs are fast.

## Install

```bash
gipity add audio-align
```

The installer copies the kit into `src/packages/audio-align/`, wires the import map (`import audioAlign from '@gipity/audio-align'`), and registers the `audio-align` job in your `gipity.yaml`. Next `gipity deploy dev` ships it.

## Pattern: wrapper function + browser helper

Browser code can't directly submit jobs (no app-token job endpoint yet), so the app developer writes a thin wrapper function in `functions/` that submits on behalf of the user. The browser calls the wrapper.

**1) Wrapper functions** (copy from `examples/audio-align-submit.js` and `examples/audio-align-status.js`):

```js
// functions/audio-align-submit.js
export default async function(ctx, input) {
  const { audio_url, lyrics, skip_demucs, refine_onsets } = input;
  const r = await ctx.jobs.submit('audio-align', {
    audio_url, lyrics, skip_demucs, refine_onsets,
  });
  return { run_guid: r.runGuid };
}
```

```js
// functions/audio-align-status.js
export default async function(ctx, input) {
  const run = await ctx.jobs.status(input.run_guid);
  return {
    status:           run.status,
    progress_pct:     run.progress_pct,
    progress_message: run.progress_message,
    output:           run.output,
    error:            run.error_message,
  };
}
```

Declare both functions in `gipity.yaml` with the auth level you want (typically `user`).

**2) Browser**:

```js
import audioAlign from '@gipity/audio-align';

const result = await audioAlign.align({
  appGuid:  'p_yourapp01',
  userToken,                          // JWT from your auth flow
  audioUrl: uploadedAudioUrl,
  lyrics:   document.querySelector('#lyrics').value,
  onProgress: ({ pct, message }) => {
    document.querySelector('#bar').style.width = (pct * 100) + '%';
    document.querySelector('#status').textContent = message;
  },
});

console.log(result.words);    // [{ word, start_ms, end_ms, confidence }, ...]
console.log(result.phrases);  // [{ text, start_ms, end_ms, word_idx_start, word_idx_end }, ...]
```

Or split the steps so you can store the runGuid and resume on page reload:

```js
const { run_guid } = await audioAlign.submit({ appGuid, userToken, audioUrl, lyrics });
localStorage.setItem('lastAlignRun', run_guid);
// ...later...
const result = await audioAlign.waitForResult({ appGuid, userToken }, run_guid, onProgress);
```

## Job input/output contract

**Input** (passed to the job as `GIPITY_RUN_INPUT`):
```json
{
  "audio_url":       "https://...",                   // required, audio file (mp3/wav/m4a/...)
  "lyrics":          "line one\nline two\n...",       // required, DISPLAY words; what shows in your output
  "phonetic_lyrics": "line one\nline two\n...",       // optional, same word/line shape as `lyrics` but
                                                       // respelled phonetically — used when MMS_FA can't
                                                       // align the display form (brand names, acronyms, slang).
                                                       // Output words come from `lyrics`; the model just
                                                       // uses this to find timing. Word count must match.
  "corrections":     [                                 // optional, lighter alternative to phonetic_lyrics:
    { "from": "Gipity", "to": "Jip-ih-tee" },         // a per-word swap dict, applied to `lyrics` before
    { "from": "AWS",    "to": "A-W-S" }               // alignment. Ignored if `phonetic_lyrics` is also set.
  ],
  "skip_demucs":     false,                            // optional, true = align on raw audio (faster, less accurate)
  "refine_onsets":   true                              // optional, snap word starts to nearest librosa onset (±50ms)
}
```

### Why phonetic respellings matter

MMS_FA ships an English character dictionary. It nails common words but fails on unusual proper nouns and acronyms — they come back with `aligned: false` and confidence 0. Two ways to fix:

- **`phonetic_lyrics`** when you have time to respell the whole transcript (high-control). The respelled words guide MMS_FA; output keeps your display words intact.
- **`corrections`** when only a handful of words trip the model (low-effort). The kit applies the swaps before alignment and emits the original words in the output.

The two are mutually exclusive — pass `phonetic_lyrics` *or* `corrections`, not both. If you pass both, `phonetic_lyrics` wins.

**Output** (the run's `output` field):
```json
{
  "words": [
    { "word": "hello", "start_ms": 1234, "end_ms": 1456, "confidence": 0.9512 },
    ...
  ],
  "phrases": [
    { "text": "line one", "start_ms": 1234, "end_ms": 2100, "word_idx_start": 0, "word_idx_end": 2 },
    ...
  ],
  "warnings": [],
  "metadata": {
    "duration_ms":    180000,
    "sample_rate":    16000,
    "used_demucs":    true,
    "refined_onsets": true,
    "low_confidence_count": 0,
    "low_confidence_ratio": 0.0
  }
}
```

`warnings` is non-empty when the alignment looks unreliable as a whole: if more than 40% of the words align with confidence below 0.5, the kit assumes the lyrics don't match what's actually sung and says so. Don't ship timings that carry a warning without listening first; transcribe the track and diff against your lyrics if in doubt.

## Verify it works

The kit ships a fixture audio + matching transcript under `tests/fixtures/` so anyone can confirm alignment works end-to-end on their own Gipity account. The handler is a real GPU job, so verification requires:

1. **A Gipity account with GPU credits.** A full verification run is one L4 cold start + ~10-15s of GPU = ~$0.005 in credits.
2. **A public URL** for the fixture audio (Modal fetches it). Upload `tests/fixtures/sample.mp3` to any host that serves it publicly — your own S3 bucket, your app's `app-files` API with `public: true`, etc.

Then in a fresh Gipity project:

```bash
gipity init audio-align-smoke
cd audio-align-smoke
gipity add audio-align
# Add the two wrapper functions from src/packages/audio-align/examples/ (audio-align-submit.js + audio-align-status.js)
# to your project's functions/ directory and declare them in gipity.yaml.
gipity deploy dev

# Submit a real alignment and stream the result
gipity job submit audio-align "$(cat <<EOF
{
  "audio_url": "https://YOUR-HOST/audio-align-sample.mp3",
  "lyrics": "$(cat src/packages/audio-align/tests/fixtures/sample.txt)",
  "skip_demucs": true
}
EOF
)"
gipity job logs <runGuid>          # stream live
gipity job status <runGuid>        # see final JSON in `output`
```

Expected output: `words[]` with ~10 entries (one per input word), `phrases[]` matching the lyric lines, `metadata.unaligned_count: 0`. Confidence values should all be > 0.7 since the fixture is clean TTS.

If you see `unaligned_count > 0` or `status: failed`, the kit's `main.py` regressed — file an issue at the kit's repo. The fixture is intentionally clean (TTS speech, no instrumentals, simple lyrics) so the alignment should be unambiguous; if it isn't, that's a bug to surface.

## What's in the fat image (zero deps required)

The kit's handler imports `torch`, `torchaudio`, `demucs`, `librosa`, `soundfile`. All are baked into the Modal image, so the job ships with no `requirements.txt`. If you fork the kit to add (e.g.) an LLM-based display-map step, add what you need to your job's deps file — the fat image is just a starting point.

## Cost

L4 at $0.80/hr underlying + 100% margin = ~$0.013 per minute of compute. A 3-min song that takes ~45 sec to align costs ~$0.01 in credits. Demucs weight download (~250 MB) happens once per Modal worker and is amortized; first run on a cold worker may take an extra ~20s.

## Limitations / known gaps

- **Lyric phrasing must match the audio.** MMS_FA assumes the lyrics ARE what's sung. If a singer ad-libs words not in the lyrics, alignment drifts after that point. The output's `confidence` field flags low-confidence words (< 0.5) — useful for surfacing edits in a UI. When most of the track comes back weak (over 40% of words under 0.5) the run's `warnings` array says so explicitly: treat that as "wrong lyrics", not "rough timings".
- **Demucs is opinionated.** If your input is already vocal-isolated (a cappella, dry vocal stem), set `skip_demucs: true` to avoid the unnecessary GPU work.
- **on_complete chaining** is supported — set `on_complete: <function-name>` in the job definition and the platform fires that function with `{ run_guid, status, output, error, duration_ms, job_name }` when the run terminates. Useful for chaining alignment → render pipelines without browser polling.

## See also

- `jobs.md` skill — the underlying job tier (CPU + GPU compute, billing, fat image)
- `app-files.md` skill — uploading audio files to get a URL for `audio_url`
- `app-llm.md` skill — if you want to add a display-map / lyric normalization step
