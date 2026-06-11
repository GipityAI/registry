// views kit - list/table view. Registry-driven: columns, filters, and search come
// from the object's field definitions. Sealed kit: no app imports.
import { listRecords, updateRecord } from '../records/api.js';
import { formatValue, prettyLabel, buildWidget } from './fields.js';

// Field types editable in place; textarea/json want a form, relation labels
// resolve server-side so the async select widget works in a cell too.
const INLINE_TYPES = new Set(['text', 'number', 'date', 'select', 'currency', 'relation', 'emails', 'phones', 'links']);

// Renders a table for `object` into `mount`. Returns { refresh, getState }.
// `initial` ({ q, filters, sort }) pre-applies a saved view's configuration.
// `editable` () => bool enables double-click inline cell editing; saves carry
// the row's updated_at so a concurrent edit comes back as a clean conflict.
export function renderTable({ mount, object, onRowClick, initial = {}, editable = () => false }) {
  const state = {
    q: initial.q || '',
    filters: { ...(initial.filters || {}) },
    sort: initial.sort || null,
    records: [], total: 0,
  };
  const listFields = object.fields.filter(f => f.in_list);

  mount.innerHTML = '';
  const toolbar = document.createElement('div');
  toolbar.className = 'kit-toolbar';

  const search = document.createElement('input');
  search.type = 'search';
  search.placeholder = `Search ${object.label_plural.toLowerCase()}…`;
  search.value = state.q;
  search.addEventListener('input', debounce(() => { state.q = search.value.trim(); refresh(); }, 250));
  toolbar.appendChild(search);

  // One dropdown filter per select field - generated, not hand-written.
  for (const f of object.fields.filter(f => f.type === 'select')) {
    const sel = document.createElement('select');
    sel.add(new Option(`All ${f.label.toLowerCase()}`, ''));
    for (const v of f.options?.values || []) sel.add(new Option(prettyLabel(v), v));
    if (state.filters[f.name]) sel.value = state.filters[f.name];
    sel.addEventListener('change', () => {
      if (sel.value) state.filters[f.name] = sel.value; else delete state.filters[f.name];
      refresh();
    });
    toolbar.appendChild(sel);
  }

  const count = document.createElement('span');
  count.className = 'kit-count';
  toolbar.appendChild(count);

  const table = document.createElement('table');
  table.className = 'kit-table';
  const wrap = document.createElement('div');
  wrap.className = 'kit-table-wrap';
  wrap.appendChild(table);
  mount.appendChild(toolbar);
  mount.appendChild(wrap);

  async function refresh() {
    const filters = Object.entries(state.filters).map(([field, value]) => ({ field, op: 'eq', value }));
    const opts = { q: state.q || undefined, filters, limit: 200 };
    if (state.sort) opts.sort = state.sort;
    const { records, total } = await listRecords(object.name, opts);
    state.records = records;
    state.total = total;
    count.textContent = `${total} ${total === 1 ? object.label.toLowerCase() : object.label_plural.toLowerCase()}`;
    draw();
  }

  function draw() {
    table.innerHTML = '';
    const thead = table.createTHead();
    const hr = thead.insertRow();
    for (const f of listFields) {
      const th = document.createElement('th');
      th.textContent = f.label + (state.sort?.field === f.name ? (state.sort.dir === 'desc' ? ' ↓' : ' ↑') : '');
      th.addEventListener('click', () => {
        const dir = state.sort?.field === f.name && state.sort.dir === 'asc' ? 'desc' : 'asc';
        state.sort = { field: f.name, dir };
        refresh();
      });
      hr.appendChild(th);
    }
    const tbody = table.createTBody();
    if (!state.records.length) {
      const tr = tbody.insertRow();
      const td = tr.insertCell();
      td.colSpan = listFields.length;
      td.textContent = `No ${object.label_plural.toLowerCase()} found.`;
      return;
    }
    for (const rec of state.records) {
      const tr = tbody.insertRow();
      // With inline editing on, delay row navigation one beat so a double-click
      // starts an edit instead of navigating away on its first click.
      let clickTimer = null;
      tr.addEventListener('click', () => {
        if (!editable()) { onRowClick?.(rec); return; }
        clearTimeout(clickTimer);
        clickTimer = setTimeout(() => onRowClick?.(rec), 250);
      });
      tr.addEventListener('dblclick', () => clearTimeout(clickTimer));
      for (const f of listFields) {
        const td = tr.insertCell();
        td.textContent = formatValue(f, rec[f.name]);
        if (f.type === 'select' && rec[f.name]) td.dataset.value = rec[f.name];
        if (INLINE_TYPES.has(f.type)) {
          td.addEventListener('dblclick', (e) => {
            if (!editable()) return;
            e.stopPropagation();
            startCellEdit(td, rec, f);
          });
        }
      }
    }
  }

  // Double-click a cell -> swap in the field's form widget; Enter/blur saves,
  // Escape cancels. The save passes expect_updated_at: a concurrent edit is
  // rejected server-side with a "changed since you loaded it" error.
  function startCellEdit(td, rec, field) {
    if (td.classList.contains('kit-editing')) return;
    td.classList.add('kit-editing');
    const prior = td.textContent;
    const { wrapper, read } = buildWidget(field, rec[field.name]);
    const input = wrapper.querySelector('input, select, textarea');
    td.textContent = '';
    td.appendChild(input);
    input.addEventListener('click', (e) => e.stopPropagation());
    input.focus();
    let done = false;
    const finish = (text) => { done = true; td.classList.remove('kit-editing'); td.textContent = text; };
    const cancel = () => finish(prior);
    const commit = async () => {
      if (done) return;
      try {
        await updateRecord(object.name, rec.id, { [field.name]: read() }, { expect_updated_at: rec.updated_at });
        finish('');
        await refresh();
      } catch (err) {
        cancel();
        alert(err.message);
        await refresh();
      }
    };
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); commit(); }
      if (e.key === 'Escape') cancel();
    });
    input.addEventListener('blur', () => { if (!done) commit(); });
  }

  refresh();
  return {
    refresh,
    getState: () => ({ q: state.q, filters: { ...state.filters }, sort: state.sort }),
  };
}

function debounce(fn, ms) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}
