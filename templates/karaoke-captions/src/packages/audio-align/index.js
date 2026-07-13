/**
 * @gipity/audio-align — browser-side helpers
 *
 * The kit's compute (demucs + MMS_FA) runs as a Modal GPU job. Browser code
 * can't directly submit jobs (no app-token job route yet), so the kit pattern
 * is: the app developer writes a thin wrapper function in `functions/`, the
 * browser calls that function. See `examples/wrapper-function.js`.
 *
 * These helpers know the wrapper's expected name + response shape so callers
 * get a typed API instead of raw fetches.
 */

const DEFAULT_SUBMIT_FN = 'audio-align-submit';
const DEFAULT_STATUS_FN = 'audio-align-status';

/** Resolve the API base: explicit opts.apiBase wins, then the deploy-stamped
 *  SDK tag (data-api-base) — a page deployed by a local dev server must call
 *  THAT server, not prod, where the app doesn't exist. Falls back to prod for
 *  pages older than the stamp. Matches the realtime kit's resolution. */
function apiBase(opts) {
  if (opts && opts.apiBase) return opts.apiBase.replace(/\/+$/, '');
  if (typeof document !== 'undefined') {
    const base = document.querySelector('script[data-api-base]')?.getAttribute('data-api-base');
    if (base) return base.replace(/\/+$/, '');
  }
  return 'https://a.gipity.ai';
}

async function callFn(opts, fnName, body) {
  const url = `${apiBase(opts)}/api/${opts.appGuid}/fn/${fnName}`;
  const headers = { 'Content-Type': 'application/json' };
  if (opts.userToken) headers.Authorization = `Bearer ${opts.userToken}`;
  const res = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body) });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`audio-align/${fnName}: HTTP ${res.status} ${detail.slice(0, 200)}`);
  }
  const json = await res.json();
  return json.data ?? json;
}

/**
 * Submit an alignment job. Returns { run_guid } once the job is queued.
 *
 *   const { run_guid } = await audioAlign.submit({
 *     appGuid: 'p_abc12345',
 *     audioUrl: 'https://...',
 *     lyrics: 'line one\nline two',
 *
 *     // Optional. Same word/line shape as `lyrics`, but each word respelled
 *     // phonetically so MMS_FA can align brand names / acronyms / slang
 *     // (e.g. lyrics: "Gipity" / phoneticLyrics: "Jip-ih-tee"). Output words
 *     // come from `lyrics`, not phoneticLyrics — the model just uses the
 *     // phonetic form to find timing. Mutually exclusive with `corrections`.
 *     phoneticLyrics: 'line one\nline two',
 *
 *     // Optional. Lighter alternative when only a handful of words need
 *     // respelling: list of {from, to} word swaps applied before alignment.
 *     // Ignored if `phoneticLyrics` is also passed.
 *     corrections: [{ from: 'Gipity', to: 'Jip-ih-tee' }, { from: 'AWS', to: 'A-W-S' }],
 *
 *     userToken,                       // optional - JWT for user-auth functions
 *     submitFn: 'audio-align-submit',  // optional - override the wrapper fn name
 *   });
 */
export async function submit(opts) {
  if (!opts.appGuid)  throw new Error('audio-align.submit: appGuid is required');
  if (!opts.audioUrl) throw new Error('audio-align.submit: audioUrl is required');
  if (!opts.lyrics)   throw new Error('audio-align.submit: lyrics is required');
  const body = {
    audio_url: opts.audioUrl,
    lyrics: opts.lyrics,
    skip_demucs: opts.skipDemucs ?? false,
    refine_onsets: opts.refineOnsets ?? true,
  };
  if (opts.phoneticLyrics) body.phonetic_lyrics = opts.phoneticLyrics;
  if (opts.corrections && opts.corrections.length) body.corrections = opts.corrections;
  return callFn(opts, opts.submitFn || DEFAULT_SUBMIT_FN, body);
}

/**
 * Get the current status of a submitted alignment run. Returns:
 *   { status: 'queued'|'running'|'success'|'failed'|'cancelled',
 *     progress_pct: number|null,
 *     progress_message: string|null,
 *     output?: AlignmentResult,      // present when status==='success'
 *     error?: string }                // present when status==='failed'
 */
export async function status(opts, runGuid) {
  return callFn(opts, opts.statusFn || DEFAULT_STATUS_FN, { run_guid: runGuid });
}

/**
 * Poll status until terminal state, return the parsed AlignmentResult.
 * Throws if the run failed/cancelled. Calls `onProgress({pct, message})`
 * with each non-terminal update so the UI can render a progress bar.
 */
export async function waitForResult(opts, runGuid, onProgress) {
  const pollIntervalMs = opts.pollIntervalMs ?? 1500;
  const maxWaitMs = opts.maxWaitMs ?? 15 * 60 * 1000; // 15 min cap
  const start = Date.now();
  let last = { pct: -1, message: '' };
  while (Date.now() - start < maxWaitMs) {
    const r = await status(opts, runGuid);
    if (onProgress && (r.progress_pct !== last.pct || r.progress_message !== last.message)) {
      onProgress({ pct: r.progress_pct, message: r.progress_message });
      last = { pct: r.progress_pct, message: r.progress_message };
    }
    if (r.status === 'success') return r.output;
    if (r.status === 'failed' || r.status === 'cancelled') {
      throw new Error(`audio-align job ${r.status}: ${r.error || 'no error message'}`);
    }
    await new Promise(res => setTimeout(res, pollIntervalMs));
  }
  throw new Error(`audio-align: run ${runGuid} did not complete within ${maxWaitMs}ms`);
}

/**
 * Convenience: submit and wait. For longer alignments callers may prefer
 * `submit()` + a separate `waitForResult()` so they can store the runGuid
 * and resume polling after a page reload.
 */
export async function align(opts) {
  const { run_guid } = await submit(opts);
  return waitForResult(opts, run_guid, opts.onProgress);
}

export default { submit, status, waitForResult, align };
