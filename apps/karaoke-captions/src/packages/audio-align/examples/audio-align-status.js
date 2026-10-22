/**
 * Example wrapper function for polling alignment job status from a browser.
 *
 * Copy this file to your project's `functions/` directory and declare it in
 * `gipity.yaml` (under the functions phase's `functions`; the file
 * name is the function name):
 *
 *   - name: audio-align-status
 *     auth: user
 *
 * The browser (via `@gipity/audio-align`) polls this with the run guid; when
 * status is 'success' the output field contains the full AlignmentResult JSON.
 * `jobs` is a capability on the handler's second argument (not on ctx).
 */
export default async function audioAlignStatus(ctx, { jobs }) {
  const { run_guid } = ctx.body || {};
  if (!run_guid) throw new Error('run_guid is required');
  const run = await jobs.status(run_guid);
  return {
    status:           run.status,
    progress_pct:     run.progress_pct,
    progress_message: run.progress_message,
    output:           run.output, // present when status === 'success'
    error:            run.error,  // present when status === 'failed'
  };
}
