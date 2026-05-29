/**
 * Example wrapper function for polling alignment job status from a browser.
 *
 * Copy this file to your project's `functions/` directory and declare it in
 * `gipity.yaml`:
 *
 *   - name: audio-align-status
 *     handler: functions/audio-align-status.js
 *     auth: user
 *
 * The browser (via `@gipity/audio-align`) polls this with the runGuid; when
 * status is 'success' the output field contains the full AlignmentResult JSON.
 */
export default async function audioAlignStatus(ctx, input) {
  const { run_guid } = input;
  if (!run_guid) throw new Error('run_guid is required');
  const run = await ctx.jobs.status(run_guid);
  return {
    status:           run.status,
    progress_pct:     run.progress_pct,
    progress_message: run.progress_message,
    output:           run.output,        // present when status === 'success'
    error:            run.error_message, // present when status === 'failed'
  };
}
