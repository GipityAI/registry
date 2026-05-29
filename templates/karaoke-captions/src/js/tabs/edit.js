/**
 * Tab 2 · Edit — clause-card timing + display editor.
 *
 * Renders one card per phrase, each card has a row per word with controls
 * for display text, trailing punctuation, start/end timing, type (standard
 * or code), and an emoji/icon override. Audio playhead drives live word
 * highlighting + clause auto-scroll. Save button persists alignment_json.
 *
 * Lifted as-is from the original monolithic main.js — same DOM IDs, same
 * delegated handlers, same recompute helpers.
 */
import { callFn } from '../api.js';
import { escapeHtml, escapeAttr, msToSec } from '../util.js';

let currentSong = null;
let currentWords = [];
let currentPhrases = [];
let bound = false;
let lastActiveCi = -1;

const $ = (id) => document.getElementById(id);

export function loadSong(song) {
  currentSong = song;
  currentWords = (song.alignment_json && song.alignment_json.words) || [];
  currentPhrases = (song.alignment_json && song.alignment_json.phrases) || [];

  const audio = $('audio');
  if (audio.src !== song.audio_url) audio.src = song.audio_url;

  const container = $('clauses');
  container.innerHTML = currentPhrases.map((p, ci) => {
    const slice = currentWords.slice(p.word_idx_start, p.word_idx_end + 1);
    const rows = slice.map((w, localIdx) =>
      renderWordRow(w, p.word_idx_start + localIdx)
    ).join('');
    return `<div class="clause" data-clause="${ci}" data-start="${p.start_ms}" data-end="${p.end_ms}">
      <div class="clause-header">
        <span class="idx">[${ci + 1}]</span>
        <span class="range" data-range-for="${ci}">${msToSec(p.start_ms)} → ${msToSec(p.end_ms)}</span>
        <span class="preview" data-preview-for="${ci}">${escapeHtml(buildPreview(slice))}</span>
      </div>
      ${rows}
    </div>`;
  }).join('') || '<p class="muted small">No alignment data yet.</p>';

  if (!bound) hookHandlers();
  bound = true;
}

export function currentAlignment() {
  return { ...(currentSong?.alignment_json || {}), words: currentWords, phrases: currentPhrases };
}

function renderWordRow(w, idx) {
  const aligned = w.aligned !== false;
  const conf = w.confidence ?? 0;
  const rowClasses = [];
  if (!aligned) rowClasses.push('unaligned');
  else if (conf < 0.5) rowClasses.push('low-confidence');
  const cls = rowClasses.length ? ` ${rowClasses.join(' ')}` : '';
  const display = w.display ?? w.word ?? '';
  const source = w.source ?? w.word ?? '';
  const punct = w.trailing_punct ?? '';
  const anim = w.anim || {};
  const wType = anim.type ?? 'standard';
  const icon = anim.icon ?? '';

  return `<div class="word-row${cls}" data-idx="${idx}">
    <button type="button" class="tiny" data-action="play" title="Jump to this word">▶</button>
    <span class="src" title="from your script">${escapeHtml(source)}</span>
    <input class="display" type="text" value="${escapeAttr(display)}" data-idx="${idx}" data-field="display" name="display-${idx}" autocomplete="off" title="What the renderer shows">
    <input class="punct" type="text" value="${escapeAttr(punct)}" data-idx="${idx}" data-field="punct" name="punct-${idx}" autocomplete="off" placeholder=",">
    <input type="number" step="0.01" value="${msToSec(w.start_ms)}" data-idx="${idx}" data-field="start" name="start-${idx}" autocomplete="off">
    <input type="number" step="0.01" value="${msToSec(w.end_ms)}" data-idx="${idx}" data-field="end" name="end-${idx}" autocomplete="off">
    <select data-idx="${idx}" data-field="type" name="type-${idx}" title="Render style for this word">
      <option value="standard"${wType === 'standard' ? ' selected' : ''}>standard</option>
      <option value="code"${wType === 'code' ? ' selected' : ''}>code</option>
    </select>
    <input class="icon" type="text" value="${escapeAttr(icon)}" data-idx="${idx}" data-field="icon" name="icon-${idx}" autocomplete="off" placeholder="🥚" title="Optional emoji or icon to render above this word">
    <div class="controls">
      <button type="button" class="tiny" data-action="set-start" title="Set start to current playhead">⇤now</button>
      <button type="button" class="tiny" data-action="set-end" title="Set end to current playhead">now⇥</button>
    </div>
  </div>`;
}

function buildPreview(words) {
  return words.map(w => (w.display ?? w.word ?? '') + (w.trailing_punct ?? '')).join(' ');
}

function recomputePhraseForWord(wordIdx) {
  for (let ci = 0; ci < currentPhrases.length; ci++) {
    const p = currentPhrases[ci];
    if (wordIdx >= p.word_idx_start && wordIdx <= p.word_idx_end) {
      const slice = currentWords.slice(p.word_idx_start, p.word_idx_end + 1);
      p.start_ms = slice[0].start_ms;
      p.end_ms = slice[slice.length - 1].end_ms;
      const rangeEl = document.querySelector(`[data-range-for="${ci}"]`);
      if (rangeEl) rangeEl.textContent = `${msToSec(p.start_ms)} → ${msToSec(p.end_ms)}`;
      const prevEl = document.querySelector(`[data-preview-for="${ci}"]`);
      if (prevEl) prevEl.textContent = buildPreview(slice);
      return;
    }
  }
}

function hookHandlers() {
  const container = $('clauses');
  const audio = $('audio');

  container.addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-action]');
    if (!btn) return;
    const row = btn.closest('.word-row');
    const idx = parseInt(row.dataset.idx, 10);
    const action = btn.dataset.action;

    if (action === 'play') {
      audio.currentTime = (currentWords[idx]?.start_ms ?? 0) / 1000;
      audio.play().catch(() => {});
    } else if (action === 'set-start') {
      const t = audio.currentTime;
      currentWords[idx].start_ms = Math.round(t * 1000);
      row.querySelector('input[data-field="start"]').value = t.toFixed(3);
      recomputePhraseForWord(idx);
    } else if (action === 'set-end') {
      const t = audio.currentTime;
      currentWords[idx].end_ms = Math.round(t * 1000);
      row.querySelector('input[data-field="end"]').value = t.toFixed(3);
      recomputePhraseForWord(idx);
    }
  });

  container.addEventListener('change', (e) => {
    const inp = e.target.closest('[data-field]');
    if (!inp) return;
    const idx = parseInt(inp.dataset.idx, 10);
    const f = inp.dataset.field;
    const w = currentWords[idx];
    if (!w) return;

    if (f === 'display')    w.display = inp.value;
    else if (f === 'punct') w.trailing_punct = inp.value;
    else if (f === 'start') w.start_ms = Math.round(parseFloat(inp.value || '0') * 1000);
    else if (f === 'end')   w.end_ms   = Math.round(parseFloat(inp.value || '0') * 1000);
    else if (f === 'type')  { w.anim = w.anim || {}; if (inp.value === 'standard') delete w.anim.type; else w.anim.type = inp.value; }
    else if (f === 'icon')  { w.anim = w.anim || {}; if (inp.value) w.anim.icon = inp.value; else delete w.anim.icon; }

    if (['start', 'end', 'display', 'punct'].includes(f)) recomputePhraseForWord(idx);
  });

  $('btn-save').addEventListener('click', async () => {
    const status = $('save-status');
    try {
      status.className = ''; status.textContent = 'Saving…';
      const updated = {
        ...currentSong.alignment_json,
        words: currentWords,
        phrases: currentPhrases,
      };
      await callFn('song-save-alignment', { song_guid: currentSong.short_guid, alignment_json: updated });
      currentSong.alignment_json = updated;
      status.textContent = 'Saved ✓'; status.className = 'ok';
      setTimeout(() => { status.textContent = ''; status.className = ''; }, 2500);
    } catch (err) {
      status.textContent = `Error: ${err.message}`; status.className = 'err';
    }
  });

  audio.addEventListener('timeupdate', () => {
    const t = audio.currentTime;
    $('audio-time').textContent = `${t.toFixed(3)} / ${(audio.duration || 0).toFixed(3)}`;
    if (!currentPhrases.length) return;

    const tMs = t * 1000;
    let activeCi = -1;
    for (let i = 0; i < currentPhrases.length; i++) {
      if (tMs >= currentPhrases[i].start_ms && tMs <= currentPhrases[i].end_ms) { activeCi = i; break; }
    }

    document.querySelectorAll('.clause.active').forEach(el => el.classList.remove('active'));
    document.querySelectorAll('.word-row.active, .word-row.past').forEach(el => el.classList.remove('active', 'past'));

    if (activeCi >= 0) {
      const ph = currentPhrases[activeCi];
      const cEl = document.querySelector(`.clause[data-clause="${activeCi}"]`);
      if (cEl) cEl.classList.add('active');
      for (let i = ph.word_idx_start; i <= ph.word_idx_end; i++) {
        const w = currentWords[i];
        if (!w) continue;
        const row = document.querySelector(`.word-row[data-idx="${i}"]`);
        if (!row) continue;
        if (tMs >= w.start_ms && tMs < w.end_ms) row.classList.add('active');
        else if (tMs >= w.end_ms) row.classList.add('past');
      }
      if (activeCi !== lastActiveCi) {
        cEl?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        lastActiveCi = activeCi;
      }
    }
  });
}
