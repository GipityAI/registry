// views kit - list/table view. Registry-driven: columns, filters, and search come
// from the object's field definitions. Sealed kit: no app imports.
import { listRecords } from '../records/api.js';
import { formatValue, prettyLabel } from './fields.js';

// Renders a table for `object` into `mount`. Returns { refresh, getState }.
// `initial` ({ q, filters, sort }) pre-applies a saved view's configuration.
export function renderTable({ mount, object, onRowClick, initial = {} }) {
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
      tr.addEventListener('click', () => onRowClick?.(rec));
      for (const f of listFields) {
        const td = tr.insertCell();
        td.textContent = formatValue(f, rec[f.name]);
        if (f.type === 'select' && rec[f.name]) td.dataset.value = rec[f.name];
      }
    }
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
