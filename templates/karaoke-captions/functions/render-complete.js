/**
 * Fires automatically when a render job finishes (declared as
 * `on_complete: render-complete` on the render job in gipity.yaml).
 *
 * Expects the render job's `output` to be `{ video_url }` on success.
 */
export default async function renderComplete(ctx, { db }) {
  const { run_guid, status, output, error, duration_ms } = ctx.body || {};
  if (!run_guid) return { error: 'run_guid missing from on_complete payload' };

  const renderRes = await db.query(
    `SELECT short_guid FROM renders WHERE render_run_guid = $1`,
    [run_guid],
  );
  if (renderRes.rows.length === 0) {
    // Not ours — exit clean.
    return { ok: true, ignored: true };
  }
  const renderGuid = renderRes.rows[0].short_guid;

  // Two output shapes:
  //   1) Pure JSON from the job → `output = { video_url, ... }` directly.
  //   2) Mixed stdout (Remotion logs Chromium-download progress before our final
  //      JSON line) → the platform's parseOutput wraps it as `{stdout: "..."}`
  //      because the whole stream isn't valid JSON. Fish the last `{...}` line
  //      with a video_url out of the stdout text.
  // We keep the FULL result object (not just video_url) so we can persist the
  // render metrics (frames / fps / resolution / aspect) too.
  let result = output && typeof output.video_url === 'string' ? output : null;
  if (!result && output && typeof output.stdout === 'string') {
    const lines = output.stdout.split('\n').map(l => l.trim()).filter(l => l.startsWith('{') && l.endsWith('}'));
    for (let i = lines.length - 1; i >= 0; i--) {
      try {
        const parsed = JSON.parse(lines[i]);
        if (typeof parsed.video_url === 'string') { result = parsed; break; }
      } catch { /* keep scanning */ }
    }
  }
  const videoUrl = result ? result.video_url : null;

  if (status === 'success' && videoUrl) {
    await db.query(
      `UPDATE renders
          SET status = 'done',
              video_url = $1,
              duration_ms = $2,
              render_frames = $3,
              fps = $4,
              resolution = $5,
              aspect = $6,
              error_message = NULL,
              updated_at = NOW()
        WHERE short_guid = $7`,
      [
        videoUrl,
        duration_ms ?? null,
        Number.isFinite(result.render_frames) ? result.render_frames : null,
        Number.isFinite(result.fps) ? result.fps : null,
        typeof result.resolution === 'string' ? result.resolution : null,
        typeof result.aspect === 'string' ? result.aspect : null,
        renderGuid,
      ],
    );
    return { ok: true, render_guid: renderGuid, status: 'done' };
  }

  await db.query(
    `UPDATE renders
        SET status = 'failed',
            error_message = $1,
            duration_ms = $2,
            updated_at = NOW()
      WHERE short_guid = $3`,
    [error || `render run terminated with status=${status} (output: ${JSON.stringify(output)})`, duration_ms ?? null, renderGuid],
  );
  return { ok: true, render_guid: renderGuid, status: 'failed' };
}
