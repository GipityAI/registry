// contacts kit - Gmail harvest SAVE door (scaffold). Takes the JSON a Gmail-
// reading LLM step produced and folds the people it found in through the same
// resolution engine as every other source (source='gmail').
//
// SCAFFOLD STATUS: this save side is live and testable today (POST a harvest JSON
// blob). The LLM step that READS the inbox is the documented fast-follow - an
// app-level workflow with tool_filter:[gmail_search, gmail_read] that calls this
// function. That step costs LLM tokens per run (the inbox scan) and is therefore
// MANUAL-trigger only; Gmail's own API is free/quota-limited. See README.
import { resolveMember, makeEnsureActor, assertCanWrite } from '../_lib/contacts/members.js';
import { importRows } from '../_lib/contacts/write-core.js';

// The harvest agent sometimes wraps its output ({ result: { contacts: [...] } }),
// so scan defensively for a contacts array anywhere in the parsed object.
function findContacts(obj, depth = 0) {
  if (!obj || typeof obj !== 'object' || depth > 4) return [];
  if (Array.isArray(obj)) return obj.some((x) => x && x.email) ? obj : [];
  if (Array.isArray(obj.contacts)) return obj.contacts;
  for (const v of Object.values(obj)) {
    const found = findContacts(v, depth + 1);
    if (found.length) return found;
  }
  return [];
}

function parseHarvest(input) {
  if (input && typeof input === 'object') return input;
  const s = String(input || '');
  try { return JSON.parse(s); } catch { /* fall through */ }
  const m = s.match(/[[{][\s\S]*[\]}]/); // first JSON-ish span (handles ```json fences)
  if (m) { try { return JSON.parse(m[0]); } catch { /* ignore */ } }
  return null;
}

export default async function contactHarvest(ctx, { db, guid }) {
  try {
    const parsed = parseHarvest(ctx.body?.harvest);
    if (!parsed) return { error: 'Could not parse harvest JSON.' };
    const found = findContacts(parsed);
    if (!found.length) return { results: [], created: 0, folded: 0, pending_merge: 0, job_changes: [], found: 0 };

    const resolved = await resolveMember(db, ctx.auth);
    assertCanWrite(resolved.member);
    const ensureActor = makeEnsureActor(resolved, guid, ctx.auth, 'IMPORT');

    const rows = found
      .slice(0, 500)
      .map(c => ({ email: c.email, name: c.name, message_id: c.message_id }));
    const out = await importRows({ db, guid, ensureActor, source: 'gmail', rows });
    return { ...out, found: found.length };
  } catch (err) {
    return { error: err.message };
  }
}
