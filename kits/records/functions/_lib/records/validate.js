// Registry-driven validation. Errors are written for an agent reader:
// they state what was wrong AND what valid input looks like (self-correcting errors).
// Pure helper: no service access.

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function validateValues(object, values, { isCreate }) {
  const clean = {};
  const fieldNames = object.fields.map(f => f.name);

  for (const [key, raw] of Object.entries(values || {})) {
    const field = object.fields.find(f => f.name === key);
    if (!field) {
      throw new Error(`Unknown field '${key}' on ${object.name}. Valid fields: ${fieldNames.join(', ')}`);
    }
    clean[key] = coerce(object, field, raw);
  }

  if (isCreate) {
    for (const f of object.fields) {
      if (f.required && (clean[f.name] === undefined || clean[f.name] === null || clean[f.name] === '')) {
        throw new Error(`'${f.name}' is required to create a ${object.label}.`);
      }
    }
  }
  return clean;
}

function coerce(object, field, raw) {
  if (raw === null || raw === undefined || raw === '') return emptyFor(field);

  switch (field.type) {
    case 'text':
    case 'textarea': {
      const s = String(raw);
      if (s.length > 10000) throw new Error(`'${field.name}' is too long (max 10000 chars).`);
      return s;
    }
    case 'number': {
      const n = Number(raw);
      if (!Number.isFinite(n)) throw new Error(`'${field.name}' must be a number (got '${raw}').`);
      return n;
    }
    case 'boolean':
      return raw === true || raw === 'true';
    case 'date': {
      const s = String(raw);
      if (!DATE_RE.test(s)) throw new Error(`'${field.name}' must be a date formatted YYYY-MM-DD (got '${raw}').`);
      return s;
    }
    case 'select': {
      const valid = field.options?.values || [];
      if (!valid.includes(raw)) {
        throw new Error(`'${field.name}' must be one of: ${valid.join(', ')} (got '${raw}').`);
      }
      return raw;
    }
    case 'currency': {
      // Accept { amountMicros, currencyCode } or a plain number of whole units.
      if (typeof raw === 'number') {
        return { amountMicros: Math.round(raw * 1_000_000), currencyCode: 'USD' };
      }
      if (typeof raw === 'object' && Number.isFinite(Number(raw.amountMicros))) {
        return { amountMicros: Math.round(Number(raw.amountMicros)), currencyCode: String(raw.currencyCode || 'USD') };
      }
      throw new Error(`'${field.name}' must be a number of whole currency units or { amountMicros, currencyCode }.`);
    }
    case 'relation': {
      // Accept a record id string or { id }. The label is denormalized and the
      // target's existence verified inside the write transaction (write-core).
      const id = typeof raw === 'string' ? raw : (typeof raw === 'object' ? raw.id : null);
      if (!id || typeof id !== 'string') {
        throw new Error(`'${field.name}' must be the id of a ${field.options?.object || 'related'} record (a string, or { id }).`);
      }
      return { id };
    }
    case 'emails': {
      const v = typeof raw === 'string' ? { primaryEmail: raw } : raw;
      if (typeof v !== 'object' || typeof v.primaryEmail !== 'string') {
        throw new Error(`'${field.name}' must be an email address string or { primaryEmail, additionalEmails }.`);
      }
      const all = [v.primaryEmail, ...(Array.isArray(v.additionalEmails) ? v.additionalEmails : [])];
      for (const e of all) {
        if (!EMAIL_RE.test(String(e))) throw new Error(`'${field.name}': '${e}' is not a valid email address.`);
      }
      return { primaryEmail: all[0], additionalEmails: all.slice(1).map(String) };
    }
    case 'phones': {
      const v = typeof raw === 'string' ? { primaryPhone: raw } : raw;
      if (typeof v !== 'object' || typeof v.primaryPhone !== 'string' || !v.primaryPhone.trim()) {
        throw new Error(`'${field.name}' must be a phone number string or { primaryPhone, additionalPhones }.`);
      }
      return {
        primaryPhone: v.primaryPhone.trim(),
        additionalPhones: (Array.isArray(v.additionalPhones) ? v.additionalPhones : []).map(String),
      };
    }
    case 'links': {
      const v = typeof raw === 'string' ? { primaryLinkUrl: raw } : raw;
      if (typeof v !== 'object' || typeof v.primaryLinkUrl !== 'string' || !v.primaryLinkUrl.trim()) {
        throw new Error(`'${field.name}' must be a URL string or { primaryLinkUrl, primaryLinkLabel, secondaryLinks }.`);
      }
      return {
        primaryLinkUrl: withScheme(v.primaryLinkUrl.trim()),
        primaryLinkLabel: String(v.primaryLinkLabel || ''),
        secondaryLinks: (Array.isArray(v.secondaryLinks) ? v.secondaryLinks : []).map(s => withScheme(String(s))),
      };
    }
    case 'json': {
      if (typeof raw === 'string') {
        try { raw = JSON.parse(raw); } catch { throw new Error(`'${field.name}' must be valid JSON.`); }
      }
      if (typeof raw !== 'object' || Array.isArray(raw)) {
        throw new Error(`'${field.name}' must be a JSON object (not an array or scalar).`);
      }
      return raw;
    }
    default:
      throw new Error(`Field '${field.name}' has unsupported type '${field.type}'.`);
  }
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function withScheme(url) {
  return /^https?:\/\//i.test(url) ? url : `https://${url}`;
}

function emptyFor(field) {
  switch (field.type) {
    case 'boolean': return false;
    case 'number':
    case 'date':
    case 'currency':
    case 'relation':
    case 'emails':
    case 'phones':
    case 'links':
    case 'json': return null;
    default: return '';
  }
}
