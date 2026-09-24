/**
 * Tab 1 · Upload — pick audio + paste optional lyrics → kick off alignment.
 * Returns the new song_guid via the onCreated callback so the orchestrator
 * can poll, update the sidebar, and auto-advance once aligned.
 */
import { callFn, uploadAudio, bundledSampleUrl } from '../api.js';

export function mountUploadTab({ onCreated, onError, onAligningStatus }) {
  const $ = (id) => document.getElementById(id);

  async function createAndStart({ audioUrl, file }) {
    const lyrics = $('lyrics').value.trim();
    if (!lyrics) {
      onError('Add a script first — the captions are aligned word-by-word against what you paste in step 2.');
      return;
    }
    onAligningStatus('Starting…', 5);
    let resolvedUrl = audioUrl;
    if (!resolvedUrl && file) resolvedUrl = await uploadAudio(file, msg => onAligningStatus(msg, 10));
    if (!resolvedUrl) resolvedUrl = bundledSampleUrl();

    const created = await callFn('song-create', { audio_url: resolvedUrl, lyrics });
    const songGuid = created.song_guid;
    onAligningStatus('Submitting…', 15);
    await callFn('song-align', { song_guid: songGuid });
    onCreated(songGuid);
  }

  $('btn-use-demo').addEventListener('click', async () => {
    try { await createAndStart({ audioUrl: bundledSampleUrl() }); }
    catch (err) { onError(err.message); }
  });

  $('btn-generate').addEventListener('click', async (ev) => {
    ev.preventDefault();
    const file = $('audio-file').files[0];
    try { await createAndStart({ file }); }
    catch (err) { onError(err.message); }
  });
}
