/**
 * @gipity/chatbot: conversation stores.
 *
 * A store keeps conversations so a visitor can come back to them. The engine
 * talks to any object with these methods (all async):
 *
 *   list()                       -> [{ id, title, updatedAt }]   newest first
 *   load(id)                     -> { id, title, messages }       or null
 *   create({ title, messages })  -> { id }
 *   write(id, from, messages)    -> void   replace messages[from..] with these
 *                                         (from = how many earlier ones to keep;
 *                                         a new turn appends, a regenerate or
 *                                         edit rewrites the tail)
 *   rename(id, title)            -> void
 *   remove(id)                   -> void
 *
 * Two are built in:
 *   localStore()          this browser's localStorage (no backend, no sign-in)
 *   functionStore(name)   one app function holding conversations in the app's
 *                         database, per signed-in user (see README for the
 *                         function and its migration)
 */

/** Keep conversations in this browser's localStorage. */
export function localStore(key = 'gipity-chatbot') {
  function read() {
    try { return JSON.parse(localStorage.getItem(key) || '{}'); } catch { return {}; }
  }
  function saveAll(all) {
    try {
      localStorage.setItem(key, JSON.stringify(all));
    } catch (err) {
      // Quota exceeded: say so instead of losing the conversation silently.
      throw new Error(`chatbot: this browser is out of storage for saved chats (${err.name}). Delete a few conversations.`);
    }
  }
  const newId = () => `c_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
  return {
    async list() {
      return Object.values(read())
        .map(({ id, title, updatedAt }) => ({ id, title, updatedAt }))
        .sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));
    },
    async load(id) {
      return read()[id] ?? null;
    },
    async create({ title, messages }) {
      const all = read();
      const id = newId();
      all[id] = { id, title, messages, updatedAt: new Date().toISOString() };
      saveAll(all);
      return { id };
    },
    async write(id, from, messages) {
      const all = read();
      if (!all[id]) throw new Error(`chatbot: conversation ${id} is gone`);
      all[id].messages.length = from;
      all[id].messages.push(...messages);
      all[id].updatedAt = new Date().toISOString();
      saveAll(all);
    },
    async rename(id, title) {
      const all = read();
      if (all[id]) { all[id].title = title; saveAll(all); }
    },
    async remove(id) {
      const all = read();
      delete all[id];
      saveAll(all);
    },
  };
}

/**
 * Keep conversations in the app's database through one app function. The
 * function receives { action, ... } and answers as below; README has a
 * complete one (with its migration) to copy.
 *
 *   { action: 'list' }                         -> { conversations: [{ id, title, updatedAt }] }
 *   { action: 'load', id }                     -> { conversation: { id, title, messages } | null }
 *   { action: 'create', title, messages }      -> { id }
 *   { action: 'write', id, from, messages }    -> { ok: true }   (drop messages from position `from` on, then add these)
 *   { action: 'rename', id, title }            -> { ok: true }
 *   { action: 'remove', id }                   -> { ok: true }
 */
export function functionStore(functionName = 'chats') {
  async function call(body) {
    if (!globalThis.Gipity?.fn) {
      throw new Error('chatbot: functionStore needs the Gipity client SDK on the page (deployed pages get it automatically)');
    }
    const out = await globalThis.Gipity.fn(functionName, body);
    // Functions report expected failures as { error } on a 200.
    if (out && typeof out === 'object' && out.error) throw new Error(out.error);
    return out;
  }
  return {
    async list() { return (await call({ action: 'list' })).conversations; },
    async load(id) { return (await call({ action: 'load', id })).conversation; },
    async create({ title, messages }) { return call({ action: 'create', title, messages }); },
    async write(id, from, messages) { await call({ action: 'write', id, from, messages }); },
    async rename(id, title) { await call({ action: 'rename', id, title }); },
    async remove(id) { await call({ action: 'remove', id }); },
  };
}
