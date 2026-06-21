// contacts kit - map a raw imported row (per source) to the canonical shape the
// resolution engine consumes: { externalId, displayName, attrs[] }, where each
// attr is { kind, value, norm_value, value_json?, label? }. value is canonical
// (email lowercased, url normalized); norm_value is the tier-3 matching key for
// name/company. Keep the original row untouched - it's stored in contact_sources.raw.
import { normEmail, normUrl, normName, normCompany } from './normalize.js';

function pushAttr(attrs, kind, value, { norm_value = '', value_json = null, label = null } = {}) {
  if (value == null || value === '') return;
  attrs.push({ kind, value: String(value), norm_value, value_json, label });
}

function fullName(raw) {
  const joined = [raw.first_name, raw.last_name].filter(Boolean).join(' ').trim();
  return joined || String(raw.name || '').trim() || '';
}

// LinkedIn connection row (parsed from Connections.csv): first_name, last_name,
// email, company, position, url, connected_on.
function mapLinkedIn(raw) {
  const attrs = [];
  const name = fullName(raw);
  const email = normEmail(raw.email);
  const url = normUrl(raw.url || raw.linkedin_url);
  const company = (raw.company || '').trim();
  const title = (raw.position || raw.title || '').trim();
  const connected = (raw.connected_on || '').trim();

  if (name) pushAttr(attrs, 'name', name, { norm_value: normName(name) });
  if (email) pushAttr(attrs, 'email', email);
  if (url) pushAttr(attrs, 'linkedin_url', url);
  if (company) pushAttr(attrs, 'company', company, { norm_value: normCompany(company) });
  if (title) pushAttr(attrs, 'title', title.slice(0, 200));
  // Compound employment: keeps title<->company paired so "many companies" each
  // retain their own title. Canonical key = normCompany|normTitle.
  if (company || title) {
    pushAttr(attrs, 'employment', `${normCompany(company)}|${title.toLowerCase()}`, {
      value_json: { company: company || null, title: title || null, connected_on: connected || null },
    });
  }
  return { externalId: url || email, displayName: name, attrs };
}

// Gmail harvest row: email, name (why/fit are app-scoring concerns, not kept here).
function mapGmail(raw) {
  const attrs = [];
  const name = fullName(raw);
  const email = normEmail(raw.email);
  if (name) pushAttr(attrs, 'name', name, { norm_value: normName(name) });
  if (email) pushAttr(attrs, 'email', email);
  return { externalId: raw.message_id || email, displayName: name, attrs };
}

// Manual / pasted row: best-effort over common fields.
function mapManual(raw) {
  const attrs = [];
  const name = fullName(raw);
  const email = normEmail(raw.email);
  const url = normUrl(raw.url || raw.linkedin_url);
  const company = (raw.company || '').trim();
  const title = (raw.title || raw.position || '').trim();
  const phone = (raw.phone || '').trim();
  const location = (raw.location || '').trim();

  if (name) pushAttr(attrs, 'name', name, { norm_value: normName(name) });
  if (email) pushAttr(attrs, 'email', email);
  if (url) pushAttr(attrs, 'linkedin_url', url);
  if (company) pushAttr(attrs, 'company', company, { norm_value: normCompany(company) });
  if (title) pushAttr(attrs, 'title', title.slice(0, 200));
  if (phone) pushAttr(attrs, 'phone', phone);
  if (location) pushAttr(attrs, 'location', location);
  return { externalId: email || url, displayName: name, attrs };
}

const MAPPERS = { linkedin: mapLinkedIn, gmail: mapGmail, manual: mapManual, paste: mapManual };

export function mapRow(source, raw) {
  const fn = MAPPERS[source] || mapManual;
  const mapped = fn(raw || {});
  return { ...mapped, externalId: mapped.externalId || null };
}
