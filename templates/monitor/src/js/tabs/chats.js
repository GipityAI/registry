/**
 * Chats tab — list of recent conversations on this account, click a row to
 * expand inline and see the message transcript.
 *
 * Two-stage load: the chats list comes from /account/logs/chats; clicking a
 * row fetches /account/logs/chats/<guid>/messages and renders the messages
 * directly underneath the clicked row. Re-clicking collapses without
 * re-fetching (messages are cached on the row's dataset).
 */
import { fmtExact, fmtTime, fmtFullTime, fmtTokens, fmtDuration, escapeHtml, truncate, emptyRow } from '../format.js';

const $ = (id) => document.getElementById(id);

let wired = false;

/**
 * Pull the user-readable text out of a message row. Older rows have a flat
 * `content` string; newer rows store `content_blocks` (array of typed blocks)
 * to support multimodal inputs. We render text blocks plus a tag for non-text
 * blocks (image, tool_use, etc.) so the transcript still reads sensibly.
 */
function messageText(m) {
  if (Array.isArray(m.content_blocks) && m.content_blocks.length) {
    return m.content_blocks.map((b) => {
      if (b.type === 'text' && typeof b.text === 'string') return b.text;
      if (b.type === 'tool_use') return `[tool: ${b.name || '?'}]`;
      if (b.type === 'tool_result') return '[tool result]';
      if (b.type === 'image') return '[image]';
      return `[${b.type || 'block'}]`;
    }).join('\n');
  }
  return m.content || '';
}

function renderMessages(messages) {
  if (!messages.length) return '<div class="muted small">No messages in this conversation.</div>';
  return `<div class="chat-thread">${messages.map((m) => {
    const role = (m.role || 'unknown').toLowerCase();
    const text = messageText(m);
    const meta = m.model_used ? `<span class="chat-msg-model">${escapeHtml(m.model_used)}</span>` : '';
    return `
      <div class="chat-msg chat-msg-${escapeHtml(role)}">
        <div class="chat-msg-head">
          <span class="chat-msg-role">${escapeHtml(role)}</span>
          ${meta}
          <span class="chat-msg-time muted small" title="${fmtFullTime(m.created_at)}">${fmtTime(m.created_at)}</span>
        </div>
        <div class="chat-msg-body">${escapeHtml(text)}</div>
      </div>
    `;
  }).join('')}</div>`;
}

async function toggleRow(api, headerRow, guid) {
  // Already expanded? Collapse.
  const next = headerRow.nextElementSibling;
  if (next && next.classList.contains('chat-thread-row')) {
    next.remove();
    headerRow.classList.remove('expanded');
    return;
  }

  // Insert loading placeholder + fetch.
  headerRow.classList.add('expanded');
  const tr = document.createElement('tr');
  tr.className = 'chat-thread-row';
  const td = document.createElement('td');
  td.colSpan = 5;
  td.innerHTML = '<div class="muted small">Loading messages…</div>';
  tr.appendChild(td);
  headerRow.after(tr);

  try {
    const res = await api.chatMessages(guid, 200);
    td.innerHTML = renderMessages(res.data || []);
  } catch (err) {
    td.innerHTML = `<div class="muted small">Could not load messages: ${escapeHtml(err.message || String(err))}</div>`;
  }
}

export async function renderChatsTab(api, { range, appGuid }) {
  const res = await api.chats(appGuid, range, 100);
  $('chats-count').textContent = fmtExact(res.data.length);

  const tbody = $('table-chats').querySelector('tbody');
  if (!res.data.length) {
    tbody.innerHTML = emptyRow(5, 'No chats yet.');
    return;
  }
  tbody.innerHTML = res.data.map((c) => {
    // Token + working-time counters (relay chats; 0 → "—"). BIGINTs arrive as
    // strings, so coerce before summing. Hover breaks tokens into in/out/total.
    const tin = Number(c.tokens_in ?? 0);
    const tout = Number(c.tokens_out ?? 0);
    const total = tin + tout;
    const tokTitle = total > 0 ? `In ${fmtExact(tin)} · Out ${fmtExact(tout)} · Total ${fmtExact(total)}` : '';
    const activeMs = Number(c.active_ms ?? 0);
    const timeTitle = activeMs > 0 ? `${fmtDuration(activeMs)} of agent working time (not wall-clock)` : '';
    return `
    <tr class="chat-row" data-guid="${escapeHtml(c.short_guid)}">
      <td title="${escapeHtml(c.short_guid)}">${escapeHtml(truncate(c.title || c.short_guid, 80))}</td>
      <td class="muted">${escapeHtml(c.project_name || '—')}</td>
      <td class="num" title="${escapeHtml(tokTitle)}">${fmtTokens(total)}</td>
      <td class="num" title="${escapeHtml(timeTitle)}">${fmtDuration(activeMs)}</td>
      <td class="muted">${fmtTime(c.updated_at || c.created_at)}</td>
    </tr>
  `;
  }).join('');

  // Delegated click handler — bound once per Monitor session, then ignored on
  // subsequent renders so we don't pile up listeners on tab refresh.
  if (!wired) {
    wired = true;
    tbody.addEventListener('click', (ev) => {
      const tr = ev.target.closest('tr.chat-row');
      if (!tr) return;
      const guid = tr.dataset.guid;
      if (!guid) return;
      toggleRow(api, tr, guid).catch((err) => console.error('[chats] expand failed', err));
    });
  }
}
