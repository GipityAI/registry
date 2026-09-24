/**
 * karaoke-captions orchestrator — sidebar + stepper + 4 tabs.
 *
 * Flow:
 *   URL ?song=<guid>  → loadSong → render whatever step the song is on
 *   sidebar click     → loadSong
 *   "+ New" sidebar   → reset state, show Tab 1
 *   Tab 1 generate    → song-create + song-align → poll → on aligned → flip to Tab 2
 *   Tab 2 save        → song-save-alignment (live)
 *   Tab 3 render      → song-render with render_options → poll → on done → flip to Tab 4
 *   Tab 4 history     → list of all renders, newest first
 *
 * Sidebar state is localStorage. No auth. See sidebar.js for the swap point.
 */
import { callFn } from './api.js';
import * as Sidebar from './sidebar.js';
import { STEP_KEYS, computeStepperStates, canEnter, nextStepAfter } from './stepper.js';
import { escapeHtml } from './util.js';
import { mountUploadTab } from './tabs/upload.js';
import { loadSong as loadEditTab, currentAlignment } from './tabs/edit.js';
import { mountStyleTab, prefill as prefillStyle, currentOptions, currentMode } from './tabs/style.js';
import { mountExportTab, renderHistory, resetPlayers } from './tabs/export.js';

const POLL_MS = 2000;
const $ = (id) => document.getElementById(id);
const $$ = (sel) => document.querySelectorAll(sel);

const TABS = [...STEP_KEYS, 'aligning', 'error'];
let currentSong = null;        // server's song row + renders
let currentStep = 'upload';
let pollTimer = null;
// The sidebar guid currently highlighted. Either a real song_guid or a local
// `draft:<seq>` placeholder for a "+ New" project that hasn't generated yet.
let activeGuid = null;
// If the user is sitting on a draft, its guid — so onCreated promotes that
// exact row in place (keeping its seq + position) instead of appending a new one.
let activeDraftGuid = null;
// Bumped every time we switch songs / hit "New". An in-flight poll tick checks
// this before touching the UI, so a slow song-get response from the PREVIOUS
// song can't hijack the view after the user has moved on.
let pollGeneration = 0;

// ─── View management ────────────────────────────────────────────────────────

function showStep(name) {
  if (!TABS.includes(name)) name = 'upload';
  // Entering the Render tab collapses any inline players so none auto-resumes
  // (re-entering the tab or starting a new render must never start a video).
  if (name === 'export' && currentStep !== 'export') resetPlayers();
  currentStep = name;
  for (const t of TABS) {
    const panel = document.querySelector(`.tab-panel[data-tab="${t}"]`);
    if (panel) panel.hidden = t !== name;
  }
  updateStepperUI();
  // Persist active step in URL so reload keeps you in place (combined with ?song=)
  const url = new URL(window.location.href);
  if (STEP_KEYS.includes(name)) url.searchParams.set('tab', name);
  else url.searchParams.delete('tab');
  window.history.replaceState({}, '', url.toString());
}

// Why each step might be locked — surfaced as a `title` tooltip so a hover
// explains the gate instead of just rendering a dead button.
const LOCK_REASON = {
  edit:   'Generate captions first (Step 1)',
  style:  'Generate captions first (Step 1)',
  export: 'Generate captions first (Step 1)',
};

function updateStepperUI() {
  const states = computeStepperStates(currentSong, currentStep);
  for (const k of STEP_KEYS) {
    const btn = document.querySelector(`.step[data-step="${k}"]`);
    if (!btn) continue;
    btn.dataset.state = states[k];
    btn.disabled = states[k] === 'locked';
    if (states[k] === 'locked' && LOCK_REASON[k]) btn.title = LOCK_REASON[k];
    else btn.removeAttribute('title');
  }
}

function showError(msg) {
  $('error-message').textContent = msg;
  showStep('error');
}

function setAligningStatus(msg, pct) {
  $('align-status-msg').textContent = msg;
  if (typeof pct === 'number') $('align-progress').value = pct;
}

// ─── Sidebar rendering ──────────────────────────────────────────────────────

function renderSidebar(list) {
  const ul = $('song-list');
  if (!list || list.length === 0) {
    ul.innerHTML = '<li class="song-list-empty muted small">No projects yet — start one →</li>';
    return;
  }
  ul.innerHTML = list.map(e => `
    <li class="song-item${e.song_guid === activeGuid ? ' active' : ''}"
        data-song-guid="${escapeHtml(e.song_guid)}">
      <span>${escapeHtml(Sidebar.displayLabel(e))}</span>
    </li>
  `).join('');
  ul.querySelectorAll('.song-item').forEach(li => {
    const guid = li.dataset.songGuid;
    li.addEventListener('click', () => {
      // A draft has no server song yet — selecting it just shows the upload tab.
      if (Sidebar.isDraftGuid(guid)) selectDraft(guid);
      else loadSong(guid);
    });
  });
}

function refreshSidebarFromStorage() {
  renderSidebar(Sidebar.read());
}

// ─── Song lifecycle ─────────────────────────────────────────────────────────

function stopPolling() {
  if (pollTimer) { clearTimeout(pollTimer); pollTimer = null; }
  // Invalidate any in-flight tick so its awaited response is ignored.
  pollGeneration++;
}

async function loadSong(songGuid) {
  stopPolling();
  if (!songGuid) {
    currentSong = null;
    activeGuid = null;
    showStep('upload');
    refreshSidebarFromStorage();
    return;
  }
  activeGuid = songGuid;
  activeDraftGuid = null;   // switching to a real song — no draft pending
  const myGeneration = pollGeneration;
  const url = new URL(window.location.href);
  url.searchParams.set('song', songGuid);
  window.history.replaceState({}, '', url.toString());

  try {
    const { song, renders } = await callFn('song-get', { song_guid: songGuid });
    // Dropped if the user switched away while this was in flight.
    if (myGeneration !== pollGeneration) return;
    if (!song) throw new Error('song not found');
    currentSong = { ...song, renders: renders || [] };

    // Update the sidebar entry's title. upsert() never downgrades, so passing
    // a resolved title here and a null title from the poll loop can't fight.
    Sidebar.upsert({ song_guid: songGuid, title: resolveTitle(song) });
    refreshSidebarFromStorage();

    // Bring step indicator into sync, then route to the right tab.
    if (song.status === 'aligning' || song.status === 'created') {
      $('aligning-song-guid').textContent = songGuid;
      showStep('aligning');
      pollSong(songGuid);
      return;
    }
    if (song.status === 'failed') {
      showError(`Alignment failed: ${song.error_message || 'unknown error'}`);
      return;
    }
    if (song.alignment_json) {
      loadEditTab(currentSong);
      $('song-title').textContent = song.title || 'Untitled song';
      // If the user just came back via ?tab= URL, honor it; otherwise default
      // to whatever makes sense for current state.
      const urlTab = new URL(window.location.href).searchParams.get('tab');
      const targetTab = (urlTab && canEnter(currentSong, urlTab))
        ? urlTab
        : 'edit';
      showStep(targetTab);
      renderHistory(currentSong.renders, { onUseStyle: useRenderStyle });
      // Pre-fill Style from the most recent render's options, if any.
      const mostRecent = [...currentSong.renders].sort((a,b) =>
        new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
      )[0];
      if (mostRecent && mostRecent.render_options) {
        prefillStyle(mostRecent.render_options, mostRecent.mode);
      }
      // Resume poll so renders-in-flight update live.
      pollSong(songGuid, { editorMode: true });
    }
  } catch (err) {
    showError(err.message);
  }
}

function pollSong(songGuid, opts = {}) {
  stopPolling();
  const myGeneration = pollGeneration;
  const tick = async () => {
    try {
      const { song, renders } = await callFn('song-get', { song_guid: songGuid });
      // The user switched songs / hit New while this request was in flight —
      // drop the result so it can't overwrite the new view.
      if (myGeneration !== pollGeneration) return;
      if (!song) return;

      const prev = currentSong;
      currentSong = { ...song, renders: renders || [] };

      if (song.status === 'aligning') {
        const v = Math.min(85, ($('align-progress').valueAsNumber || 15) + 4);
        setAligningStatus('Aligning words to audio…', v);
      }
      if (song.status === 'aligned') {
        // Re-render the editor ONLY on the transition into aligned (or the
        // very first tick when there's no prev). Re-rendering on every poll
        // blows away in-progress input edits — that was the bug where the
        // user's "Display" field changes wouldn't make it to Save.
        const justFinished = !prev || prev.status !== 'aligned';
        if (justFinished) {
          loadEditTab(currentSong);
          $('song-title').textContent = resolveTitle(song) || 'Untitled song';
        }
        // Pass the resolved title (lyrics-derived) so the sidebar shows the real
        // name; upsert never downgrades, so a later null-title poll can't revert
        // it to "Untitled" — that fight was the flicker.
        Sidebar.upsert({ song_guid: songGuid, title: resolveTitle(song) });
        refreshSidebarFromStorage();
        renderHistory(currentSong.renders, { onUseStyle: useRenderStyle });

        if (justFinished && opts.autoAdvance !== false) showStep(nextStepAfter('upload'));
        else updateStepperUI();
      }
      if (song.status === 'failed') {
        showError(`Alignment failed: ${song.error_message || 'unknown error'}`);
        return;
      }

      // If we're in editor mode + a render flipped to done since last tick,
      // auto-advance to Export.
      if (opts.editorMode && song.alignment_json) {
        const prevRender = prev && prev.renders ? prev.renders.find(r => r.status === 'rendering' || r.status === 'queued') : null;
        const nowDone = (renders || []).find(r => r.status === 'done' && (!prevRender || prevRender.short_guid === r.short_guid));
        if (prevRender && nowDone) {
          renderHistory(currentSong.renders, { onUseStyle: useRenderStyle });
          showStep('export');
        } else {
          renderHistory(currentSong.renders, { onUseStyle: useRenderStyle });
          updateStepperUI();
        }
      }

      // Only keep polling while something is actually in flight. Once alignment
      // is settled AND no render is queued/rendering, stop — otherwise the 2 s
      // loop keeps re-rendering the Export tab and restarts video playback
      // (that was the "page refreshes every couple seconds" bug). A new render
      // restarts polling via onRenderRequested / onRenderAgain.
      const songInFlight = song.status === 'aligning' || song.status === 'created';
      const renderInFlight = (renders || []).some(r => r.status === 'queued' || r.status === 'rendering');
      if (songInFlight || renderInFlight) {
        pollTimer = setTimeout(tick, POLL_MS);
      } else {
        stopPolling();
      }
    } catch (err) {
      // Network blip — stop polling rather than spamming the user with errors.
      console.warn('[poll]', err.message);
    }
  };
  tick();
}

// The one place that decides a song's display title, so loadSong and the poll
// loop can't disagree (that disagreement was the "Untitled ↔ real title"
// flicker). Server title wins if set; else first phrase preview; else first
// lyrics line; else '' (sidebar then falls back to "Untitled-<seq>").
function resolveTitle(song) {
  if (song?.title && song.title.trim()) return song.title.trim();
  const phrases = song?.alignment_json?.phrases;
  if (phrases && phrases.length) {
    const words = song.alignment_json.words || [];
    const slice = words.slice(phrases[0].word_idx_start, (phrases[0].word_idx_end ?? 0) + 1);
    const text = slice.map(w => w.display ?? w.word ?? '').join(' ').trim();
    if (text) return text.slice(0, 40);
  }
  if (song?.lyrics) return song.lyrics.split('\n')[0].slice(0, 40);
  return '';
}

function useRenderStyle(render) {
  if (!render || !render.render_options) return;
  prefillStyle(render.render_options, render.mode);
  showStep('style');
}

// ─── Wire up ────────────────────────────────────────────────────────────────

function wireStepperClicks() {
  $$('.step').forEach(btn => {
    btn.addEventListener('click', () => {
      const target = btn.dataset.step;
      if (!canEnter(currentSong, target)) return;
      showStep(target);
    });
  });
}

function wireNewSongButton() {
  $('btn-new-song').addEventListener('click', () => {
    // Create the project in the sidebar IMMEDIATELY (a draft), instead of
    // waiting until the user picks audio + generates. Selecting the draft shows
    // a clean upload tab; generating promotes it in place to the real song.
    const draft = Sidebar.createDraft();
    selectDraft(draft.song_guid);
    refreshSidebarFromStorage();
  });
}

/** Show the upload tab for a draft (or for the no-song initial state). Sets the
 *  draft as the active sidebar row but does NOT hit the server — there's no song
 *  yet. The draft guid is stashed so onCreated can promote it. */
function selectDraft(draftGuid) {
  stopPolling();
  currentSong = null;
  activeGuid = draftGuid || null;
  activeDraftGuid = draftGuid || null;
  const url = new URL(window.location.href);
  url.searchParams.delete('song');
  url.searchParams.delete('tab');
  window.history.replaceState({}, '', url.toString());
  showStep('upload');
  refreshSidebarFromStorage();
}

function wireRestartFromError() {
  $('btn-restart-from-error').addEventListener('click', () => {
    stopPolling();
    currentSong = null;
    const url = new URL(window.location.href);
    url.searchParams.delete('song');
    window.location.href = url.toString();
  });
}

function wireToStyleButton() {
  // Both the top and bottom "Continue to style →" buttons share one handler.
  const handler = () => showStep('style');
  $('btn-to-style').addEventListener('click', handler);
  $('btn-to-style-top').addEventListener('click', handler);
}

async function init() {
  refreshSidebarFromStorage();
  wireStepperClicks();
  wireNewSongButton();
  wireRestartFromError();
  wireToStyleButton();

  mountUploadTab({
    onAligningStatus: setAligningStatus,
    onError: showError,
    onCreated: (songGuid) => {
      // Promote the active draft in place (keeps its seq + sidebar position) if
      // the user came from "+ New"; otherwise just upsert a fresh entry.
      if (activeDraftGuid) Sidebar.promoteDraft(activeDraftGuid, songGuid);
      else Sidebar.upsert({ song_guid: songGuid, title: null });
      activeDraftGuid = null;
      activeGuid = songGuid;
      refreshSidebarFromStorage();
      $('aligning-song-guid').textContent = songGuid;
      const url = new URL(window.location.href);
      url.searchParams.set('song', songGuid);
      window.history.replaceState({}, '', url.toString());
      showStep('aligning');
      pollSong(songGuid);
    },
  });

  mountStyleTab({
    getSong: () => currentSong,
    onRenderRequested: () => {
      // Move user to Export so they can watch progress; the poll loop will
      // refresh the renders list as the new row flips queued → rendering → done.
      showStep('export');
      if (currentSong) pollSong(currentSong.short_guid, { editorMode: true });
    },
    onError: showError,
  });

  mountExportTab({
    getSong: () => currentSong,
    onBackToStyle: () => showStep('style'),
    onRenderAgain: async () => {
      if (!currentSong) return;
      await callFn('song-render', {
        song_guid: currentSong.short_guid,
        mode: currentMode(),
        render_options: currentOptions(),
      });
      pollSong(currentSong.short_guid, { editorMode: true });
    },
    onError: showError,
  });

  // Reconcile sidebar against the server in the background; drop stale entries.
  Sidebar.reconcile(async (guid) => {
    try { return (await callFn('song-get', { song_guid: guid })).song; }
    catch { return null; }
  }).then(refreshSidebarFromStorage).catch(() => {});

  // Resume song if URL has ?song=
  const songGuid = new URL(window.location.href).searchParams.get('song');
  if (songGuid) {
    loadSong(songGuid);
  } else {
    showStep('upload');
  }
}

init();
