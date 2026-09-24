/**
 * Sidebar project list backed by localStorage.
 *
 * Without auth, the user's "list of my projects" is the songs they've created
 * in this browser. We persist `[{ song_guid, title, seq, created_at }, ...]`
 * under one key and render it into #song-list.
 *
 * Two wrinkles this module owns:
 *   1. seq — a monotonic per-browser counter so untitled projects are still
 *      distinguishable ("Untitled-1", "Untitled-2", …). Stored separately so
 *      numbers are never reused even after deletes.
 *   2. drafts — a project can exist in the sidebar BEFORE it has a server-side
 *      song (the moment the user clicks "+ New"). A draft's `song_guid` is a
 *      local placeholder `draft:<seq>`; once the user generates captions we
 *      promote it in place to the real `song_guid`, keeping its seq + position.
 *
 * Future auth swap: replace `read()` / `write()` with a server fetch — every
 * other piece of this module stays the same.
 */

const STORAGE_KEY = 'karaoke.recent_songs';
const SEQ_KEY = 'karaoke.seq_counter';
const DRAFT_PREFIX = 'draft:';

export function isDraftGuid(guid) {
  return typeof guid === 'string' && guid.startsWith(DRAFT_PREFIX);
}

/** Human label for a sidebar row: the real title if it has one, else a stable
 *  "Untitled-<seq>" so multiple untitled projects stay distinguishable. */
export function displayLabel(entry) {
  if (entry && typeof entry.title === 'string' && entry.title.trim()) return entry.title.trim();
  return entry && entry.seq != null ? `Untitled-${entry.seq}` : 'Untitled';
}

export function read() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr.filter(x => x && typeof x.song_guid === 'string') : [];
  } catch {
    return [];
  }
}

export function write(entries) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
  } catch { /* quota / private-mode — silent best-effort */ }
}

/** Next sequence number. Monotonic: seeded from the max of (stored counter,
 *  highest seq currently in the list) so existing users keep counting up and
 *  deletes never recycle a number. */
function nextSeq() {
  const stored = parseInt(localStorage.getItem(SEQ_KEY) || '', 10);
  const fromList = read().reduce((m, e) => Math.max(m, e.seq || 0), 0);
  const next = Math.max(Number.isFinite(stored) ? stored : 0, fromList) + 1;
  try { localStorage.setItem(SEQ_KEY, String(next)); } catch { /* best-effort */ }
  return next;
}

/**
 * Add or update an entry. If a record for `song_guid` exists, merges + bumps it
 * to the top. Title is never DOWNGRADED: passing a falsy title keeps whatever
 * meaningful title is already stored (this is what kills the "Untitled ↔ real
 * title" flicker — the poll loop can call upsert with no title and not clobber
 * the title loadSong resolved). Returns the new full list.
 */
export function upsert(entry) {
  if (!entry || !entry.song_guid) return read();
  const list = read();
  const idx = list.findIndex(e => e.song_guid === entry.song_guid);
  const existing = idx >= 0 ? list[idx] : null;
  const incomingTitle = (typeof entry.title === 'string' && entry.title.trim()) ? entry.title.trim() : null;
  let seq = existing?.seq ?? entry.seq;
  if (seq == null) seq = nextSeq();
  const merged = {
    song_guid: entry.song_guid,
    title: incomingTitle ?? existing?.title ?? null,
    seq,
    created_at: existing?.created_at ?? entry.created_at ?? new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
  const next = [merged, ...list.filter(e => e.song_guid !== entry.song_guid)];
  write(next);
  return next;
}

/** Create a fresh draft project at the top of the list and return it. Has a
 *  placeholder `draft:<seq>` guid until the user generates captions. */
export function createDraft() {
  const seq = nextSeq();
  const entry = {
    song_guid: `${DRAFT_PREFIX}${seq}`,
    title: null,
    seq,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
  write([entry, ...read()]);
  return entry;
}

/** Promote a draft to a real song in place — swap its guid, keep seq/position/
 *  title. No-op (falls back to a plain upsert) if the draft is already gone. */
export function promoteDraft(draftGuid, realGuid) {
  const list = read();
  const idx = list.findIndex(e => e.song_guid === draftGuid);
  if (idx < 0) return upsert({ song_guid: realGuid, title: null });
  list[idx] = { ...list[idx], song_guid: realGuid, updated_at: new Date().toISOString() };
  write(list);
  return list;
}

/** Drop one entry by guid. Returns the new list. */
export function remove(songGuid) {
  const next = read().filter(e => e.song_guid !== songGuid);
  write(next);
  return next;
}

/**
 * Reconcile against the server: drop entries the server no longer knows about.
 * `fetcher` is `(guid) => Promise<song | null>` so the caller controls the API
 * surface. Draft entries (no server song yet) are kept as-is — they're not on
 * the server by definition. Returns the surviving list.
 */
export async function reconcile(fetcher) {
  const list = read();
  const survivors = [];
  for (const entry of list) {
    if (isDraftGuid(entry.song_guid)) { survivors.push(entry); continue; }
    try {
      const song = await fetcher(entry.song_guid);
      if (song) {
        survivors.push({
          ...entry,
          // Server title wins only when it's meaningful; never downgrade.
          title: (song.title && song.title.trim()) ? song.title : entry.title,
        });
      }
    } catch {
      // Network failure — keep the entry so a transient outage doesn't wipe
      // the user's sidebar. They can still click and try again later.
      survivors.push(entry);
    }
  }
  write(survivors);
  return survivors;
}
