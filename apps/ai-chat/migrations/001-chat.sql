-- Saved conversations, one row per message, per signed-in user.
-- The chatbot kit's functionStore('chats') reads and writes these through
-- functions/chats.js.
CREATE TABLE IF NOT EXISTS chat_conversations (
  short_guid VARCHAR(20) PRIMARY KEY,
  user_guid  TEXT NOT NULL,
  title      TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS chat_conversations_user_idx ON chat_conversations (user_guid, updated_at DESC);

CREATE TABLE IF NOT EXISTS chat_messages (
  conversation_guid VARCHAR(20) NOT NULL REFERENCES chat_conversations (short_guid) ON DELETE CASCADE,
  seq               INTEGER NOT NULL,
  message           JSONB NOT NULL,
  PRIMARY KEY (conversation_guid, seq)
);
