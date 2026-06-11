// views kit - field formatting + form widgets, driven entirely by registry field
// definitions. Sealed kit: no app imports.
import { listRecords } from '../records/api.js';

export function formatValue(field, value) {
  if (value === null || value === undefined || value === '') return '—';
  switch (field.type) {
    case 'currency': {
      const units = (Number(value.amountMicros) || 0) / 1_000_000;
      return units.toLocaleString(undefined, { style: 'currency', currency: value.currencyCode || 'USD' });
    }
    case 'date':
      return String(value).slice(0, 10);
    case 'boolean':
      return value ? 'Yes' : 'No';
    case 'select':
      return prettyLabel(String(value));
    case 'relation':
      return value.label || value.id;
    case 'emails': {
      const extra = value.additionalEmails?.length;
      return (value.primaryEmail || '—') + (extra ? ` +${extra}` : '');
    }
    case 'phones':
      return value.primaryPhone || '—';
    case 'links': {
      try { return new URL(value.primaryLinkUrl).hostname.replace(/^www\./, ''); }
      catch { return value.primaryLinkUrl || '—'; }
    }
    case 'json': {
      const s = JSON.stringify(value);
      return s.length > 40 ? s.slice(0, 37) + '…' : s;
    }
    default:
      return String(value);
  }
}

export function prettyLabel(s) {
  return s.replace(/_/g, ' ').replace(/^\w/, c => c.toUpperCase());
}

// Debounced typeahead over a relation's target object - searches server-side
// (record-read full-text) instead of preloading every row into a <select>.
// Returns { control, read } where read() yields { id } | null.
function buildRelationTypeahead(field, current) {
  const targetObject = field.options?.object;
  const labelField = field.options?.labelField || 'name';
  let selected = current?.id ? { id: current.id, label: current.label || current.id } : null;

  const box = document.createElement('div');
  box.className = 'kit-typeahead';
  const input = document.createElement('input');
  input.type = 'text';
  input.autocomplete = 'off';
  input.placeholder = `Search ${prettyLabel(targetObject || 'record').toLowerCase()}…`;
  input.value = selected ? selected.label : '';
  const menu = document.createElement('div');
  menu.className = 'kit-typeahead-menu';
  menu.hidden = true;
  box.appendChild(input);
  box.appendChild(menu);

  let timer;
  const close = () => { menu.hidden = true; menu.innerHTML = ''; };

  function option(label, onPick, cls) {
    const opt = document.createElement('div');
    opt.className = 'kit-typeahead-opt' + (cls ? ` ${cls}` : '');
    opt.textContent = label;
    // mousedown (not click) so the pick lands before the input's blur closes the menu.
    opt.addEventListener('mousedown', (e) => { e.preventDefault(); onPick(); });
    return opt;
  }

  async function search(term) {
    let records = [];
    try {
      ({ records } = await listRecords(targetObject, term
        ? { q: term, limit: 8 }
        : { limit: 8, sort: { field: labelField, dir: 'asc' } }));
    } catch { return; /* widget degrades to free text the caller can't submit */ }
    menu.innerHTML = '';
    if (selected) {
      menu.appendChild(option('✕ Clear', () => { selected = null; input.value = ''; close(); }, 'kit-typeahead-clear'));
    }
    for (const r of records) {
      const label = r[labelField] ?? r.id;
      menu.appendChild(option(label, () => { selected = { id: r.id, label }; input.value = label; close(); }));
    }
    menu.hidden = menu.children.length === 0;
  }

  input.addEventListener('input', () => {
    selected = null;  // typing invalidates a prior pick until they choose again
    clearTimeout(timer);
    timer = setTimeout(() => search(input.value.trim()), 200);
  });
  input.addEventListener('focus', () => search(input.value.trim()));
  input.addEventListener('blur', () => setTimeout(close, 150));

  return { control: box, read: () => (selected ? { id: selected.id } : null) };
}

// Builds a labeled input element for a field; returns { wrapper, read() }.
export function buildWidget(field, current) {
  const wrapper = document.createElement('label');
  wrapper.className = 'kit-field';
  wrapper.textContent = field.label + (field.required ? ' *' : '');

  // Relation is its own control (typeahead box, not a bare input).
  if (field.type === 'relation') {
    const { control, read } = buildRelationTypeahead(field, current);
    wrapper.appendChild(control);
    return { wrapper, read };
  }

  let input;
  switch (field.type) {
    case 'textarea':
      input = document.createElement('textarea');
      input.rows = 3;
      input.value = current ?? '';
      break;
    case 'select': {
      input = document.createElement('select');
      const blank = new Option('—', '');
      input.add(blank);
      for (const v of field.options?.values || []) {
        input.add(new Option(prettyLabel(v), v, false, v === current));
      }
      if (current) input.value = current;
      break;
    }
    case 'boolean':
      input = document.createElement('input');
      input.type = 'checkbox';
      input.checked = !!current;
      break;
    case 'number':
      input = document.createElement('input');
      input.type = 'number';
      input.step = 'any';
      input.value = current ?? '';
      break;
    case 'date':
      input = document.createElement('input');
      input.type = 'date';
      input.value = current ? String(current).slice(0, 10) : '';
      break;
    case 'currency':
      input = document.createElement('input');
      input.type = 'number';
      input.step = '0.01';
      input.min = '0';
      input.placeholder = 'USD';
      input.value = current ? (Number(current.amountMicros) || 0) / 1_000_000 : '';
      break;
    case 'emails':
      input = document.createElement('input');
      input.type = 'email';
      input.placeholder = 'name@example.com';
      input.value = current?.primaryEmail ?? '';
      break;
    case 'phones':
      input = document.createElement('input');
      input.type = 'tel';
      input.value = current?.primaryPhone ?? '';
      break;
    case 'links':
      input = document.createElement('input');
      input.type = 'text';
      input.placeholder = 'https://…';
      input.value = current?.primaryLinkUrl ?? '';
      break;
    case 'json':
      input = document.createElement('textarea');
      input.rows = 4;
      input.value = current ? JSON.stringify(current, null, 2) : '';
      break;
    default: // text
      input = document.createElement('input');
      input.type = 'text';
      input.value = current ?? '';
  }
  input.name = field.name;
  wrapper.appendChild(input);

  const read = () => {
    if (field.type === 'boolean') return input.checked;
    if (field.type === 'currency') {
      return input.value === '' ? null
        : { amountMicros: Math.round(Number(input.value) * 1_000_000), currencyCode: 'USD' };
    }
    if (field.type === 'number') return input.value === '' ? null : Number(input.value);
    // Composites edit the primary value; extras survive an unchanged primary.
    if (field.type === 'emails') {
      if (input.value === '') return null;
      return current && input.value === current.primaryEmail ? current : input.value;
    }
    if (field.type === 'phones') {
      if (input.value === '') return null;
      return current && input.value === current.primaryPhone ? current : input.value;
    }
    if (field.type === 'links') {
      if (input.value === '') return null;
      return current && input.value === current.primaryLinkUrl ? current : input.value;
    }
    if (field.type === 'json') return input.value === '' ? null : input.value;
    return input.value;
  };
  return { wrapper, read };
}
