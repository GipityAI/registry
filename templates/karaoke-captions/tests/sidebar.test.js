// Sidebar localStorage round-trip — no DOM, no server. Uses a tiny in-memory
// stub for localStorage so this runs in the sandbox harness without needing
// a browser. The reconcile() test exercises the prune-against-server path.

// Stub localStorage if the harness doesn't provide one (node environment).
if (typeof globalThis.localStorage === 'undefined') {
  let store = {};
  globalThis.localStorage = {
    getItem: (k) => Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null,
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: (k) => { delete store[k]; },
    clear: () => { store = {}; },
  };
}

import {
  read, write, upsert, remove, reconcile,
  createDraft, promoteDraft, isDraftGuid, displayLabel,
} from '../src/js/sidebar.js';

function reset() { globalThis.localStorage.clear(); }

test('read() on a clean store returns []', () => {
  reset();
  assert.deepEqual(read(), []);
});

test('write() then read() round-trips the list', () => {
  reset();
  const list = [
    { song_guid: 'p_aaa', title: 'First',  created_at: '2026-05-27T10:00:00Z' },
    { song_guid: 'p_bbb', title: 'Second', created_at: '2026-05-27T11:00:00Z' },
  ];
  write(list);
  assert.deepEqual(read(), list);
});

test('read() ignores entries without a song_guid (defensive)', () => {
  reset();
  globalThis.localStorage.setItem('karaoke.recent_songs', JSON.stringify([
    { song_guid: 'p_ok', title: 'good' },
    { title: 'no guid' },
    null,
  ]));
  const list = read();
  assert.equal(list.length, 1);
  assert.equal(list[0].song_guid, 'p_ok');
});

test('read() returns [] on malformed JSON instead of throwing', () => {
  reset();
  globalThis.localStorage.setItem('karaoke.recent_songs', '{not json');
  assert.deepEqual(read(), []);
});

test('upsert() adds a new entry to the top of the list', () => {
  reset();
  upsert({ song_guid: 'p_aaa', title: 'First' });
  upsert({ song_guid: 'p_bbb', title: 'Second' });
  const list = read();
  assert.equal(list.length, 2);
  assert.equal(list[0].song_guid, 'p_bbb', 'most-recent first');
  assert.equal(list[1].song_guid, 'p_aaa');
});

test('upsert() on an existing guid merges + bumps to top, keeps original created_at', () => {
  reset();
  upsert({ song_guid: 'p_aaa', title: 'First', created_at: '2026-05-27T10:00:00Z' });
  upsert({ song_guid: 'p_bbb', title: 'Second' });
  upsert({ song_guid: 'p_aaa', title: 'First (renamed)' });
  const list = read();
  assert.equal(list.length, 2);
  assert.equal(list[0].song_guid, 'p_aaa', 'updated entry bubbles to top');
  assert.equal(list[0].title, 'First (renamed)');
  assert.equal(list[0].created_at, '2026-05-27T10:00:00Z', 'original created_at preserved');
});

test('upsert() assigns a monotonic seq and keeps it stable across updates', () => {
  reset();
  upsert({ song_guid: 'p_aaa', title: 'A' });
  upsert({ song_guid: 'p_bbb', title: 'B' });
  const first = read().find(e => e.song_guid === 'p_aaa');
  const second = read().find(e => e.song_guid === 'p_bbb');
  assert.equal(first.seq, 1);
  assert.equal(second.seq, 2);
  upsert({ song_guid: 'p_aaa', title: 'A2' });
  assert.equal(read().find(e => e.song_guid === 'p_aaa').seq, 1, 'seq is stable across updates');
});

test('upsert() never downgrades a real title to null/blank (anti-flicker)', () => {
  reset();
  upsert({ song_guid: 'p_aaa', title: 'Real Title' });
  upsert({ song_guid: 'p_aaa', title: null });        // poll loop with no title
  upsert({ song_guid: 'p_aaa', title: '   ' });        // whitespace
  assert.equal(read()[0].title, 'Real Title', 'title survives null/blank upserts');
});

test('displayLabel(): real title wins; untitled falls back to Untitled-<seq>', () => {
  assert.equal(displayLabel({ title: 'Hello', seq: 3 }), 'Hello');
  assert.equal(displayLabel({ title: null, seq: 3 }), 'Untitled-3');
  assert.equal(displayLabel({ title: '   ', seq: 7 }), 'Untitled-7');
  assert.equal(displayLabel({ seq: null }), 'Untitled');
});

test('createDraft() adds a draft entry at the top with a draft: guid + seq', () => {
  reset();
  upsert({ song_guid: 'p_existing', title: 'old' });
  const d = createDraft();
  assert.ok(isDraftGuid(d.song_guid), 'draft guid is namespaced');
  assert.equal(read()[0].song_guid, d.song_guid, 'draft is at the top');
  assert.ok(d.seq > 1, 'draft seq continues the counter');
});

test('promoteDraft() swaps the guid in place, keeping seq + position', () => {
  reset();
  const d = createDraft();
  upsert({ song_guid: 'p_other', title: 'other' });   // now d is second
  promoteDraft(d.song_guid, 'song_real');
  const list = read();
  const promoted = list.find(e => e.song_guid === 'song_real');
  assert.ok(promoted, 'draft guid replaced by real guid');
  assert.equal(promoted.seq, d.seq, 'seq preserved through promotion');
  assert.equal(list.findIndex(e => e.song_guid === 'song_real'), 1, 'position preserved');
  assert.equal(list.filter(e => isDraftGuid(e.song_guid)).length, 0, 'no draft left behind');
});

test('seq counter does not recycle numbers after a delete', () => {
  reset();
  upsert({ song_guid: 'p_aaa' });   // seq 1
  upsert({ song_guid: 'p_bbb' });   // seq 2
  remove('p_bbb');
  upsert({ song_guid: 'p_ccc' });   // must be 3, not a reused 2
  assert.equal(read().find(e => e.song_guid === 'p_ccc').seq, 3);
});

test('remove() drops the matching entry, leaves the rest alone', () => {
  reset();
  upsert({ song_guid: 'p_aaa', title: 'A' });
  upsert({ song_guid: 'p_bbb', title: 'B' });
  remove('p_aaa');
  const list = read();
  assert.equal(list.length, 1);
  assert.equal(list[0].song_guid, 'p_bbb');
});

test('reconcile() drops entries the server doesn\'t recognise', async () => {
  reset();
  upsert({ song_guid: 'p_real', title: 'Real' });
  upsert({ song_guid: 'p_gone', title: 'Deleted' });

  const fetcher = async (guid) => guid === 'p_real' ? { title: 'Real (from server)' } : null;
  const survivors = await reconcile(fetcher);

  assert.equal(survivors.length, 1);
  assert.equal(survivors[0].song_guid, 'p_real');
  assert.equal(survivors[0].title, 'Real (from server)', 'server title wins');
});

test('reconcile() keeps an entry if the fetcher throws (transient network)', async () => {
  reset();
  upsert({ song_guid: 'p_aaa', title: 'A' });
  const fetcher = async () => { throw new Error('network is down'); };
  const survivors = await reconcile(fetcher);
  assert.equal(survivors.length, 1, 'transient failure must not wipe the user\'s sidebar');
  assert.equal(survivors[0].song_guid, 'p_aaa');
});
