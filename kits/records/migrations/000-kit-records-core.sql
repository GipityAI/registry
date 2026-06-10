-- Records kit: core tables (registry, members, events).
-- Canonical definitions live in schema/*.json; these migrations are the
-- generated build artifact (see PLAN.md "Fix 1 - definition is files, never rows").

-- Object registry: one row per object type the records kit manages.
CREATE TABLE IF NOT EXISTS kit_objects (
    name          VARCHAR(60) PRIMARY KEY,        -- 'asset'
    table_name    VARCHAR(60) NOT NULL,           -- 'assets'
    label         VARCHAR(100) NOT NULL,
    label_plural  VARCHAR(100) NOT NULL,
    icon          VARCHAR(16) DEFAULT '',         -- emoji is fine
    app           VARCHAR(60) NOT NULL,           -- which mini app owns it
    membership    VARCHAR(10) NOT NULL DEFAULT 'open',  -- open | invite
    title_field   VARCHAR(60) NOT NULL DEFAULT 'name',  -- field used as record title
    config        JSONB NOT NULL DEFAULT '{}'
);

-- Field registry: one row per field, drives validation + UI rendering.
CREATE TABLE IF NOT EXISTS kit_fields (
    object_name   VARCHAR(60) NOT NULL REFERENCES kit_objects(name) ON DELETE CASCADE,
    name          VARCHAR(60) NOT NULL,           -- column name
    label         VARCHAR(100) NOT NULL,
    type          VARCHAR(20) NOT NULL,           -- text|textarea|number|select|date|boolean|currency
    options       JSONB NOT NULL DEFAULT '{}',    -- { values: [...] } for select, etc.
    required      BOOLEAN NOT NULL DEFAULT FALSE,
    in_list       BOOLEAN NOT NULL DEFAULT TRUE,  -- shown as a table column by default
    position      REAL NOT NULL DEFAULT 0,
    PRIMARY KEY (object_name, name)
);

-- Members: authorization layer. Authentication is platform-provided (Gipity auth);
-- this maps a Gipity identity to an app-level role.
CREATE TABLE IF NOT EXISTS kit_members (
    id            VARCHAR(20) PRIMARY KEY,
    user_guid     TEXT NOT NULL UNIQUE,
    display_name  TEXT NOT NULL DEFAULT '',
    role          VARCHAR(20) NOT NULL DEFAULT 'member',  -- owner | member | readonly
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Event spine: every mutation lands here, via the single write path only.
CREATE TABLE IF NOT EXISTS kit_events (
    id            VARCHAR(20) PRIMARY KEY,
    object_name   VARCHAR(60) NOT NULL,
    record_id     VARCHAR(20) NOT NULL,
    action        VARCHAR(20) NOT NULL,           -- create | update | delete
    actor         JSONB NOT NULL,                 -- { source, memberId, name } (ACTOR pattern)
    changes       JSONB NOT NULL DEFAULT '{}',    -- { field: { from, to } }
    summary       TEXT NOT NULL,                  -- human-readable one-liner (prompt-ready)
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_kit_events_record  ON kit_events(object_name, record_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_kit_events_created ON kit_events(created_at DESC);
