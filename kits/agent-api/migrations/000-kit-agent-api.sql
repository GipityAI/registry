-- agent-api kit: named API keys. A key maps a machine caller to a named
-- AGENT/API actor, so machine writes carry attribution on the event spine
-- exactly like human writes. Keys are matched verbatim at v1; treat them like
-- passwords (revoke by setting revoked_at).

CREATE TABLE IF NOT EXISTS kit_api_keys (
    id            VARCHAR(20) PRIMARY KEY,
    name          TEXT NOT NULL,
    key           TEXT NOT NULL UNIQUE,
    role          VARCHAR(20) NOT NULL DEFAULT 'writer',  -- writer | readonly
    source        VARCHAR(20) NOT NULL DEFAULT 'API',     -- ACTOR source: API | AGENT
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_used_at  TIMESTAMPTZ,
    revoked_at    TIMESTAMPTZ
);

-- No keys are seeded. Mint one in your own migration or via gipity db query:
--   INSERT INTO kit_api_keys (id, name, key, role, source)
--   VALUES ('key-myagent', 'My agent', '<long random string>', 'writer', 'AGENT');
