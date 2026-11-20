-- Notes the assistant saves for a user (the save_note tool, which asks first).
CREATE TABLE IF NOT EXISTS notes (
  short_guid VARCHAR(20) PRIMARY KEY,
  user_guid  TEXT NOT NULL,
  title      TEXT NOT NULL,
  body       TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS notes_user_idx ON notes (user_guid, created_at DESC);
