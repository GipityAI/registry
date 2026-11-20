/**
 * Saved conversations for the signed-in user: the store behind the chatbot
 * kit's functionStore('chats'). One function, one `action` per call:
 *
 *   list                      -> { conversations: [{ id, title, updatedAt }] }
 *   load    { id }            -> { conversation: { id, title, messages } | null }
 *   create  { title, messages } -> { id }
 *   write   { id, from, messages } -> { ok }   drop messages from `from` on, add these
 *   rename  { id, title }     -> { ok }
 *   remove  { id }            -> { ok }
 */

const MAX_TITLE = 80;
const MAX_MESSAGES_PER_CALL = 300;
const MAX_PAYLOAD_CHARS = 4_000_000; // photos are kept with the chat, so allow a few

export default async function (ctx, { db, guid }) {
  const user = ctx.auth.userGuid;
  const { action, id, title, messages, from } = ctx.body ?? {};

  const cleanTitle = (t) => String(t ?? '').trim().slice(0, MAX_TITLE) || 'New chat';
  const checkMessages = (list) => {
    if (!Array.isArray(list)) return 'messages must be an array';
    if (list.length > MAX_MESSAGES_PER_CALL) return `at most ${MAX_MESSAGES_PER_CALL} messages per call`;
    if (JSON.stringify(list).length > MAX_PAYLOAD_CHARS) return 'that conversation is too large to save';
    return null;
  };
  const owned = async (q, convId) => {
    const { rows } = await q.query(
      'SELECT short_guid, title FROM chat_conversations WHERE short_guid = $1 AND user_guid = $2',
      [convId, user],
    );
    return rows[0] ?? null;
  };
  // One statement for any number of messages: the array goes in as JSON.
  const insertMessages = (q, convId, start, list) => q.query(
    `INSERT INTO chat_messages (conversation_guid, seq, message)
     SELECT $1, $2::int + ord::int - 1, msg FROM jsonb_array_elements($3::jsonb) WITH ORDINALITY AS t(msg, ord)`,
    [convId, start, JSON.stringify(list)],
  );

  switch (action) {
    case 'list': {
      const { rows } = await db.query(
        `SELECT short_guid AS id, title, updated_at AS "updatedAt" FROM chat_conversations
         WHERE user_guid = $1 ORDER BY updated_at DESC LIMIT 200`,
        [user],
      );
      return { conversations: rows };
    }

    case 'load': {
      const conv = await owned(db, id);
      if (!conv) return { conversation: null };
      const { rows } = await db.query(
        'SELECT message FROM chat_messages WHERE conversation_guid = $1 ORDER BY seq',
        [id],
      );
      return { conversation: { id: conv.short_guid, title: conv.title, messages: rows.map(r => r.message) } };
    }

    case 'create': {
      const problem = checkMessages(messages);
      if (problem) return { error: problem };
      const newId = guid('chat');
      await db.tx(async (tx) => {
        await tx.query(
          'INSERT INTO chat_conversations (short_guid, user_guid, title) VALUES ($1, $2, $3)',
          [newId, user, cleanTitle(title)],
        );
        if (messages.length) await insertMessages(tx, newId, 0, messages);
      });
      return { id: newId };
    }

    case 'write': {
      const problem = checkMessages(messages);
      if (problem) return { error: problem };
      if (!Number.isInteger(from) || from < 0) return { error: 'from must be a whole number of messages to keep' };
      const result = await db.tx(async (tx) => {
        if (!(await owned(tx, id))) return { error: 'Conversation not found.' };
        await tx.query('DELETE FROM chat_messages WHERE conversation_guid = $1 AND seq >= $2', [id, from]);
        if (messages.length) await insertMessages(tx, id, from, messages);
        await tx.query('UPDATE chat_conversations SET updated_at = NOW() WHERE short_guid = $1', [id]);
        return { ok: true };
      });
      return result;
    }

    case 'rename': {
      const { rowCount } = await db.query(
        'UPDATE chat_conversations SET title = $1 WHERE short_guid = $2 AND user_guid = $3',
        [cleanTitle(title), id, user],
      );
      return rowCount ? { ok: true } : { error: 'Conversation not found.' };
    }

    case 'remove': {
      await db.query('DELETE FROM chat_conversations WHERE short_guid = $1 AND user_guid = $2', [id, user]);
      return { ok: true };
    }

    default:
      return { error: 'action must be list, load, create, write, rename or remove' };
  }
}
