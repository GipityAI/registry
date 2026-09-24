# audio-align — tests

## Pure-helper unit tests

None today. The handler (`jobs/align/main.py`) imports heavy ML deps (torch, demucs, librosa) at module load, which makes pytest-style unit tests awkward — they'd have to mock those imports or load them into a venv to run.

If you fork the handler and add non-trivial pure helpers (e.g., a phrase-reconstruction algorithm, a tokenizer wrapper), extract them into a sibling module like `jobs/align/_helpers.py` and write pytest tests against that module specifically.

## End-to-end verification

The kit's full pipeline (demucs + MMS_FA + librosa) runs on a real GPU, so the only honest e2e test is **install the kit + submit a real job + assert the output**. See the kit's main `README.md` "Verify it works" section for the full procedure.

In short:
1. Upload `fixtures/sample.mp3` to any public URL.
2. `gipity add audio-align` into a fresh project.
3. Add the wrapper functions from `../examples/audio-align-submit.js` and `../examples/audio-align-status.js` to your project's `functions/`.
4. `gipity deploy dev`, then `gipity job submit audio-align '{"audio_url": "...", "lyrics": "..."}'`.
5. Confirm the resulting JSON has `unaligned_count: 0` and one word entry per input word.

## Fixtures

| File | Source | Notes |
|---|---|---|
| `fixtures/sample.mp3` | `gipity generate speech "Hello world. This is a forced alignment test sample." --provider elevenlabs` | Deterministic for the same voice; regenerate if voice changes |
| `fixtures/sample.txt` | The text passed to `generate speech` | Lyrics the verification pairs with the audio |

To regenerate the fixture (only needed if you change the test content):

```bash
gipity generate speech "Hello world. This is a forced alignment test sample." \
  --output tests/fixtures/sample.mp3
```

The transcript is intentionally short (~3 seconds, 10 words) so e2e verification is cheap to run. Don't replace it with a long clip without a good reason — every contributor pays the GPU credits to verify.
