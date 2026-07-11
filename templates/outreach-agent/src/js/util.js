// Small DOM + formatting helpers shared by the views.
import { api } from './api.js';

export const $ = (id) => document.getElementById(id);

// stage_guid -> label map from the live funnel data (works for custom stages too).
// Cached per page-load; call stageLabels(true) to refresh after editing the funnel.
let stageLabelCache = null;
export async function stageLabels(force) {
    if (!stageLabelCache || force) {
        stageLabelCache = {};
        try {
            const { funnels } = await api.funnels.list();
            for (const f of funnels || []) for (const s of f.stages || []) stageLabelCache[s.short_guid] = s.label;
        } catch { /* views fall back to the raw stage key */ }
    }
    return stageLabelCache;
}

// Human label for one contact's stage: guid lookup first, else prettified key.
export function stageLabelFor(contact, labels) {
    return (labels && labels[contact.stage_guid]) || String(contact.stage || '-').replace(/_/g, ' ');
}

export function el(tag, attrs = {}, ...children) {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
        if (k === 'class') node.className = v;
        else if (k === 'html') node.innerHTML = v;
        else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2), v);
        else if (v != null && v !== false) node.setAttribute(k, v === true ? '' : v);
    }
    for (const c of children.flat()) {
        if (c == null || c === false) continue;
        node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
    }
    return node;
}

export function esc(s) {
    return String(s == null ? '' : s)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

let toastTimer;
export function toast(msg, ms = 2600) {
    const t = $('toast');
    if (!t) return;
    t.textContent = msg;
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { t.hidden = true; }, ms);
}

export function timeAgo(iso) {
    if (!iso) return '';
    const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
    if (s < 60) return 'just now';
    if (s < 3600) return `${Math.floor(s / 60)}m ago`;
    if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
    return `${Math.floor(s / 86400)}d ago`;
}

export function fmtDate(iso) {
    if (!iso) return '-';
    const d = new Date(iso);
    return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

// Render a loading/empty/error message into a view container.
export function setStatus(view, msg) {
    view.innerHTML = '';
    view.appendChild(el('p', { class: 'muted' }, msg));
}

// A table with click-to-sort headers. `columns` is an array of:
//   { label, cell(row) -> node|string, sort?(row) -> comparable, initial?: 'asc'|'desc', th? }
// A column with no `sort` is not sortable (e.g. an actions column). Sorting is stable
// and client-side; nulls sort last. Returns the <table> element.
export function sortableTable(columns, rows, startIdx = 0, startDir = 'asc') {
    let sortIdx = startIdx;
    let dir = startDir;
    const table = el('table', {});
    const thead = el('thead', {});
    const tbody = el('tbody', {});

    const cmp = (a, b) => {
        if (a == null && b == null) return 0;
        if (a == null) return 1;
        if (b == null) return -1;
        if (typeof a === 'number' && typeof b === 'number') return a - b;
        return String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: 'base' });
    };

    function draw() {
        const headers = columns.map((c, i) => {
            const canSort = typeof c.sort === 'function';
            const arrow = canSort && i === sortIdx ? (dir === 'asc' ? ' ▲' : ' ▼') : '';
            return el('th', canSort
                ? { style: 'cursor:pointer;user-select:none', onclick: () => {
                    if (i === sortIdx) dir = dir === 'asc' ? 'desc' : 'asc';
                    else { sortIdx = i; dir = c.initial || 'asc'; }
                    draw();
                } }
                : {}, (c.label || '') + arrow);
        });
        thead.innerHTML = '';
        thead.appendChild(el('tr', {}, ...headers));

        const col = columns[sortIdx];
        const ordered = col && col.sort
            ? [...rows].sort((a, b) => cmp(col.sort(a), col.sort(b)) * (dir === 'asc' ? 1 : -1))
            : rows;
        tbody.innerHTML = '';
        for (const r of ordered) {
            tbody.appendChild(el('tr', {}, ...columns.map((c) => el('td', c.th || {}, c.cell(r)))));
        }
    }

    table.appendChild(thead);
    table.appendChild(tbody);
    draw();
    return table;
}

// Short date like "Mar 5, 2026" (or "-"). For signup / created columns.
export function fmtDay(iso) {
    if (!iso) return '-';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '-';
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}
