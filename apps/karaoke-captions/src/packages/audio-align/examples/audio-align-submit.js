/**
 * Example wrapper function for submitting alignment jobs from a browser.
 *
 * Copy this file to your project's `functions/` directory and declare it in
 * `gipity.yaml` so the browser can call it:
 *
 *   - name: audio-align-submit
 *     handler: functions/audio-align-submit.js
 *     auth: user
 *
 * The browser (via `@gipity/audio-align`) POSTs here with the audio URL +
 * lyrics. This function then submits the GPU job and returns the runGuid.
 */
export default async function audioAlignSubmit(ctx, input) {
  const { audio_url, lyrics, skip_demucs, refine_onsets } = input;
  if (!audio_url || !lyrics) {
    throw new Error('audio_url and lyrics are required');
  }
  const r = await ctx.jobs.submit('audio-align', {
    audio_url,
    lyrics,
    skip_demucs: skip_demucs ?? false,
    refine_onsets: refine_onsets ?? true,
  });
  // ctx.jobs.submit returns { runGuid, status, replayed }
  return { run_guid: r.runGuid, status: r.status };
}
