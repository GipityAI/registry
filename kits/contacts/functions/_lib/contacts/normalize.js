// contacts kit - pure normalization + similarity helpers. No service access.
// These define the canonical/matching keys the resolution engine relies on, and
// the JS-side fuzzy scoring that replaces pg_trgm (the managed DB forbids
// CREATE EXTENSION, so trigram similarity is unavailable - see resolve.js).

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Lowercased, trimmed email or null when it isn't a plausible address.
export function normEmail(s) {
  const e = String(s || '').trim().toLowerCase();
  return EMAIL_RE.test(e) ? e : null;
}

// Canonical LinkedIn URL: drop protocol, www, query/fragment, trailing slash,
// lowercase. So http://www.linkedin.com/in/jane-doe/?x=1 == linkedin.com/in/jane-doe.
export function normUrl(s) {
  let u = String(s || '').trim().toLowerCase();
  if (!u) return null;
  u = u.replace(/^https?:\/\//, '').replace(/^www\./, '');
  u = u.split(/[?#]/)[0].replace(/\/+$/, '');
  return u || null;
}

function stripAccents(s) {
  // Decompose, then drop combining diacritical marks (U+0300..U+036F).
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '');
}

// Normalized person name: accent-folded, punctuation-stripped, single-spaced,
// lowercased. The tier-3 candidate-bucketing key for kind='name'.
export function normName(s) {
  return stripAccents(String(s || '').toLowerCase())
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Legal suffixes/filler that shouldn't make two spellings of one company differ.
const COMPANY_STOP = new Set([
  'inc', 'incorporated', 'llc', 'l l c', 'ltd', 'limited', 'corp', 'corporation',
  'co', 'company', 'gmbh', 'plc', 'lp', 'llp', 'group', 'holdings', 'the',
]);

// Normalized company key: accent-folded, punctuation-stripped, legal suffixes and
// filler words removed, single-spaced. Bucketing key for kind='company'.
export function normCompany(s) {
  const base = stripAccents(String(s || '').toLowerCase())
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const kept = base.split(' ').filter(t => t && !COMPANY_STOP.has(t));
  return kept.join(' ') || base; // if every token was filler, fall back to base
}

export function nameTokens(s) {
  return normName(s).split(' ').filter(Boolean);
}

// Jaccard overlap of two token sets, 0..1.
export function jaccard(aTokens, bTokens) {
  const a = new Set(aTokens);
  const b = new Set(bTokens);
  if (!a.size && !b.size) return 0;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter++;
  return inter / (a.size + b.size - inter);
}

export function nameSimilarity(a, b) {
  return jaccard(nameTokens(a), nameTokens(b));
}

export { EMAIL_RE };
