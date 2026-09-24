/**
 * Data > Browse: walk one project's files, read a file, see its version
 * history and restore an older version. The same routes as `gipity file` /
 * `gipity rollback`. Scoped to the project picked in the global filter.
 */
import { fmtBytes, fmtTime, fmtFullTime, escapeHtml, emptyRow } from '../format.js';
import { openDetail, openDetailAsync } from '../detail.js';

const $ = (id) => document.getElementById(id);
let bound = false;
let project = '';
let dir = '';

const TEXT_MIME = /^(text\/|application\/(json|javascript|xml|yaml|x-yaml|toml|sql|x-sh|typescript)|image\/svg)/;
const MAX_INLINE_BYTES = 512 * 1024;

function join(a, b) { return a ? `${a}/${b}` : b; }

function crumbs() {
  const parts = dir ? dir.split('/') : [];
  const links = [`<button type="button" class="link-btn" data-dir="">/</button>`];
  parts.forEach((p, i) => {
    links.push(`<button type="button" class="link-btn" data-dir="${escapeHtml(parts.slice(0, i + 1).join('/'))}">${escapeHtml(p)}</button>`);
  });
  return links.join('<span class="muted">/</span>');
}

function versionsHtml(versions) {
  if (!versions.length) return '<p class="muted">No version history.</p>';
  return `<table class="data-table compact"><thead><tr><th>Version</th><th>Saved</th><th>Source</th><th class="num">Size</th><th></th></tr></thead><tbody>
    ${versions.map((v) => `<tr>
      <td>v${v.version}${v.current ? ' <span class="pill ok">current</span>' : ''}</td>
      <td class="muted" title="${escapeHtml(fmtFullTime(v.created_at))}">${fmtTime(v.created_at)}</td>
      <td class="muted">${escapeHtml(v.source || '-')}</td>
      <td class="num">${fmtBytes(v.size)}</td>
      <td>${v.current ? '' : `<button type="button" class="link-btn" data-restore="${v.version}">Restore</button>`}</td>
    </tr>`).join('')}
  </tbody></table>`;
}

/** A file: its text (when it is text and not huge), a link, and its versions. */
function showFile(api, path, size) {
  const title = path;
  const load = async () => {
    const [versions, content] = await Promise.all([
      api.fileVersions(project, path).then((r) => r.data),
      size <= MAX_INLINE_BYTES ? api.readFile(project, path).then((r) => r.data) : Promise.resolve(null),
    ]);
    const isText = content && TEXT_MIME.test(content.mime || '');
    const body = isText
      ? `<pre class="detail-pre file-content">${escapeHtml(content.content)}</pre>`
      : `<p class="muted">${content ? escapeHtml(content.mime || 'Binary file') : 'Large file'}: not shown inline.</p>`;
    const html = `
      <div class="detail-meta"><span>${fmtBytes(size)}</span>${content?.mime ? `<span>${escapeHtml(content.mime)}</span>` : ''}
        <button type="button" class="link-btn" data-link>Get a shareable link</button></div>
      ${body}
      <h4>Versions</h4>
      <div data-versions>${versionsHtml(versions)}</div>
      <p class="muted small">CLI: <code>gipity file versions ${escapeHtml(path)}</code>, <code>gipity file restore ${escapeHtml(path)} &lt;version&gt;</code></p>`;
    return { html, wire: (el) => wireFile(api, el, path) };
  };
  openDetailAsync(title, load);
}

function wireFile(api, el, path) {
  el.querySelector('[data-link]')?.addEventListener('click', async (ev) => {
    const btn = ev.currentTarget;
    btn.disabled = true;
    try {
      const { url } = (await api.fileUrl(project, path)).data;
      btn.outerHTML = `<a href="${escapeHtml(url)}" target="_blank" rel="noopener">Open file</a>`;
    } catch (err) {
      btn.textContent = err.message;
    }
  });
  el.querySelector('[data-versions]').addEventListener('click', async (ev) => {
    const btn = ev.target.closest('button[data-restore]');
    if (!btn) return;
    // Two clicks: the first arms the button, the second restores.
    if (!btn.dataset.armed) {
      btn.dataset.armed = '1';
      btn.textContent = `Confirm restore v${btn.dataset.restore}`;
      return;
    }
    btn.disabled = true;
    try {
      await api.restoreVersion(project, path, Number(btn.dataset.restore));
      const versions = (await api.fileVersions(project, path)).data;
      el.querySelector('[data-versions]').innerHTML = versionsHtml(versions);
    } catch (err) {
      btn.textContent = err.message;
    }
  });
}

export async function renderBrowseSubtab(api, { projectId }) {
  if (!bound) {
    bound = true;
    $('browse-crumbs').addEventListener('click', (ev) => {
      const b = ev.target.closest('button[data-dir]');
      if (b) { dir = b.dataset.dir; renderBrowseSubtab(api, { projectId: project }); }
    });
    $('table-browse').addEventListener('click', (ev) => {
      const tr = ev.target.closest('tr[data-name]');
      if (!tr) return;
      const path = join(dir, tr.dataset.name);
      if (tr.dataset.type === 'directory') { dir = path; renderBrowseSubtab(api, { projectId: project }); }
      else showFile(api, path, Number(tr.dataset.size));
    });
  }
  if (projectId !== project) { project = projectId || ''; dir = ''; }
  const body = $('table-browse').querySelector('tbody');
  if (!project) {
    $('browse-crumbs').innerHTML = '';
    body.innerHTML = emptyRow(3, 'Pick a project in the Project filter above to browse its files.');
    return;
  }
  $('browse-crumbs').innerHTML = crumbs();
  const entries = (await api.listDir(project, dir)).data;
  entries.sort((a, b) => (a.type === b.type ? a.name.localeCompare(b.name) : a.type === 'directory' ? -1 : 1));
  body.innerHTML = entries.length ? entries.map((e) => `
    <tr class="clickable-row" data-name="${escapeHtml(e.name)}" data-type="${escapeHtml(e.type)}" data-size="${Number(e.size) || 0}">
      <td class="mono">${e.type === 'directory' ? '▸ ' : ''}${escapeHtml(e.name)}${e.type === 'directory' ? '/' : ''}</td>
      <td class="num">${e.type === 'directory' ? '' : fmtBytes(e.size)}</td>
      <td class="muted">${e.modified ? fmtTime(e.modified) : ''}</td>
    </tr>`).join('') : emptyRow(3, 'Empty folder.');
}
