/**
 * One reusable detail dialog: a run's steps, a job's log tail, a test run's
 * results, a file's content and versions. Callers pass a title and HTML they
 * have already escaped; `wire` gets the body element to bind buttons after
 * the HTML is in the DOM.
 */
import { escapeHtml } from './format.js';

const $ = (id) => document.getElementById(id);
let bound = false;

function bind() {
  if (bound) return;
  bound = true;
  $('detail-close').addEventListener('click', () => $('detail-dialog').close());
  // Click on the backdrop closes it too.
  $('detail-dialog').addEventListener('click', (ev) => {
    if (ev.target === $('detail-dialog')) $('detail-dialog').close();
  });
}

export function openDetail(title, html, wire) {
  bind();
  $('detail-title').textContent = title;
  $('detail-body').innerHTML = html;
  if (wire) wire($('detail-body'));
  if (!$('detail-dialog').open) $('detail-dialog').showModal();
}

/** Show a loading state, run `load`, then render what it returns (or the error). */
export async function openDetailAsync(title, load) {
  openDetail(title, '<p class="muted">Loading...</p>');
  try {
    const { html, wire } = await load();
    openDetail(title, html, wire);
  } catch (err) {
    openDetail(title, `<p class="detail-error">${escapeHtml(err.message || String(err))}</p>`);
  }
}

/** A JSON value as an indented, escaped block. */
export function jsonBlock(value) {
  if (value === null || value === undefined) return '<span class="muted">none</span>';
  const text = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
  return `<pre class="detail-pre">${escapeHtml(text)}</pre>`;
}
