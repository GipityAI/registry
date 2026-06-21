// contacts kit - client-side LinkedIn CSV parsing (ported from LeadPester).
// Runs in the browser: the app parses the export, optionally backfills emails
// from the synced address book, then posts parsed rows to the contact-import
// function. No AI - pure deterministic parsing.

// Minimal RFC-4180-ish parser. Handles quoted fields, escaped quotes (""), and
// newlines inside quotes.
export function parseCSVRows(text) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  const s = String(text || '').replace(/\r\n?/g, '\n');
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inQuotes) {
      if (c === '"') {
        if (s[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += c;
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ',') {
      row.push(field); field = '';
    } else if (c === '\n') {
      row.push(field); field = '';
      rows.push(row); row = [];
    } else field += c;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows.filter((r) => r.some((v) => v.trim() !== ''));
}

// LinkedIn's Connections.csv has a "Notes:" preamble before the real header.
const HEADER_MAP = {
  'first name': 'first_name',
  'last name': 'last_name',
  'email address': 'email',
  'email': 'email',
  'company': 'company',
  'position': 'position',
  'title': 'position',
  'url': 'url',
  'connected on': 'connected_on',
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Parse LinkedIn's ImportedContacts.csv (your synced address book) into
// {first_name, last_name, email}. Used to backfill emails on connections (only
// ~3% of connections carry an email natively).
export function parseAddressBook(text) {
  const rows = parseCSVRows(text);
  if (!rows.length) return [];
  const headerIdx = Math.max(0, rows.findIndex((r) => r.some((c) => /firstname|emails?/i.test(c.trim()))));
  const headers = rows[headerIdx].map((h) => h.trim().toLowerCase());
  const fi = headers.indexOf('firstname');
  const li = headers.indexOf('lastname');
  const ei = headers.findIndex((h) => h === 'emails' || h === 'email' || h === 'email address');
  if (ei === -1) return [];
  const out = [];
  for (let i = headerIdx + 1; i < rows.length; i++) {
    const r = rows[i];
    const email = String(r[ei] || '').split(/[;,]/)[0].trim().toLowerCase();
    if (!EMAIL_RE.test(email)) continue;
    out.push({ first_name: (r[fi] || '').trim(), last_name: (r[li] || '').trim(), email });
  }
  return out;
}

export function parseLinkedInCSV(text) {
  const rows = parseCSVRows(text);
  if (!rows.length) return [];
  let headerIdx = rows.findIndex((r) => r.some((c) => /first name|email|^url$/i.test(c.trim())));
  if (headerIdx === -1) headerIdx = 0;
  const headers = rows[headerIdx].map((h) => HEADER_MAP[h.trim().toLowerCase()] || h.trim().toLowerCase());
  const out = [];
  for (let i = headerIdx + 1; i < rows.length; i++) {
    const obj = {};
    rows[i].forEach((v, j) => { if (headers[j]) obj[headers[j]] = (v || '').trim(); });
    if (obj.email || obj.url || obj.first_name || obj.last_name) out.push(obj);
  }
  return out;
}

// Backfill missing connection emails from the address book by exact name match
// (case-insensitive, first occurrence wins). Mutates and returns connections.
export function backfillEmails(connections, addressBook) {
  const map = new Map();
  for (const b of addressBook) {
    const k = `${b.first_name} ${b.last_name}`.toLowerCase().trim();
    if (k && !map.has(k)) map.set(k, b.email);
  }
  for (const c of connections) {
    if (!c.email) {
      const e = map.get(`${c.first_name || ''} ${c.last_name || ''}`.toLowerCase().trim());
      if (e) c.email = e;
    }
  }
  return connections;
}
