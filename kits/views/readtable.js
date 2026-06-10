// views kit - read-only data table for introspected sources (no registry needed).
// Sealed kit: no app imports.
import { prettyLabel } from './fields.js';

export function renderDataTable({ mount, columns, rows, title }) {
  mount.innerHTML = '';
  if (title) {
    const h = document.createElement('h3');
    h.textContent = title;
    mount.appendChild(h);
  }
  const wrap = document.createElement('div');
  wrap.className = 'kit-table-wrap';
  const table = document.createElement('table');
  table.className = 'kit-table kit-readonly';

  const thead = table.createTHead();
  const hr = thead.insertRow();
  for (const c of columns) {
    const th = document.createElement('th');
    th.textContent = prettyLabel(c);
    hr.appendChild(th);
  }

  const tbody = table.createTBody();
  if (!rows.length) {
    const td = tbody.insertRow().insertCell();
    td.colSpan = columns.length || 1;
    td.textContent = 'No rows.';
  }
  for (const row of rows) {
    const tr = tbody.insertRow();
    for (const c of columns) {
      tr.insertCell().textContent = format(row[c]);
    }
  }

  wrap.appendChild(table);
  mount.appendChild(wrap);
}

function format(v) {
  if (v === null || v === undefined || v === '') return '—';
  if (typeof v === 'object') return JSON.stringify(v);
  // timestamps come back ISO; keep them short
  if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(v)) {
    return v.slice(0, 16).replace('T', ' ');
  }
  return String(v);
}
