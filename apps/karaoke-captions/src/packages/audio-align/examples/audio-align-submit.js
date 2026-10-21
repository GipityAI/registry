/**
 * Example wrapper function for submitting alignment jobs from a browser.
 *
 * Copy this file to your project's `functions/` directory and declare it in
 * `gipity.yaml` (under the functions phase's `function_definitions`; the file
 * name is the function name) so the browser can call it:
 *
 *   - name: audio-align-submit
 *     auth: user
 *
 * The browser (via `@gipity/audio-align`) POSTs here with the audio URL +
 * lyrics. This function then submits the GPU job and returns the run guid.
 * `jobs` is a capability on the handler's second argument (not on ctx).
 */
export default async function audioAlignSubmit(ctx, { jobs }) {
  const { audio_url, lyrics, skip_demucs, refine_onsets, phonetic_lyrics, corrections } = ctx.body || {};
  if (!audio_url || !lyrics) {
    throw new Error('audio_url and lyrics are required');
  }
  const input = {
    audio_url,
    lyrics,
    skip_demucs: skip_demucs ?? false,
    refine_onsets: refine_onsets ?? true,
  };
  if (phonetic_lyrics) input.phonetic_lyrics = phonetic_lyrics;
  if (Array.isArray(corrections) && corrections.length) input.corrections = corrections;
  // jobs.submit returns { run_guid, status, replayed }
  const r = await jobs.submit('audio-align', input);
  return { run_guid: r.run_guid, status: r.status };
}
