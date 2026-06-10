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

// Builds a labeled input element for a field; returns { wrapper, read() }.
export function buildWidget(field, current) {
  const wrapper = document.createElement('label');
  wrapper.className = 'kit-field';
  wrapper.textContent = field.label + (field.required ? ' *' : '');

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
    case 'relation': {
      // Async-populated select over the target object; the current value is
      // available immediately so the form is usable before the list arrives.
      input = document.createElement('select');
      input.add(new Option('—', ''));
      if (current?.id) input.add(new Option(current.label || current.id, current.id, true, true));
      const labelField = field.options?.labelField || 'name';
      listRecords(field.options?.object, { limit: 200, sort: { field: labelField, dir: 'asc' } })
        .then(({ records }) => {
          for (const r of records) {
            if (r.id === current?.id) continue;
            input.add(new Option(r[labelField] ?? r.id, r.id));
          }
        })
        .catch(() => { /* widget degrades to the current value only */ });
      break;
    }
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
    if (field.type === 'relation') return input.value ? { id: input.value } : null;
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
