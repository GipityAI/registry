-- contacts kit: source-agnostic contact data layer.
-- People + keep-everything multi-valued attributes + raw-source provenance +
-- user tags + a merge-review queue + a transactional event spine.
--
-- Conventions mirror the records kit (VARCHAR(20) ids, JSONB ACTOR provenance,
-- soft delete, an in-transaction event spine, generated search_vector for FTS)
-- but the schema is STANDALONE: the multi-valued keep-all attribute model does
-- not fit records' one-value-per-field registry.
--
-- NOTE: no pg_trgm / CREATE EXTENSION - the managed DB forbids it. Tier-3 fuzzy
-- name+company matching buckets candidates by the normalized `norm_value` key
-- (btree index below) and scores similarity in JS (see _lib/contacts/resolve.js).

-- Authorization layer: maps a Gipity identity to an app-level role. Standalone
-- copy of records' kit_members so the contacts kit never couples to records.
CREATE TABLE IF NOT EXISTS contact_members (
    id            VARCHAR(20) PRIMARY KEY,
    user_guid     TEXT NOT NULL UNIQUE,
    display_name  TEXT NOT NULL DEFAULT '',
    role          VARCHAR(20) NOT NULL DEFAULT 'member',  -- owner | member | readonly
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- One resolved real person. primary_email and search_text are denormalized by
-- the write path from the is_primary attributes so lists/FTS need no joins.
CREATE TABLE IF NOT EXISTS contacts (
    id            VARCHAR(20) PRIMARY KEY,
    display_name  TEXT NOT NULL DEFAULT '',
    primary_email TEXT,                          -- = email attribute where is_primary
    score         INTEGER,                       -- kit STORES only; policy lives in the app
    search_text   TEXT NOT NULL DEFAULT '',      -- folded names/companies/emails, write-path maintained
    merged_into   VARCHAR(20) REFERENCES contacts(id),  -- loser of a confirmed merge (reversible)
    created_by    JSONB NOT NULL DEFAULT '{}',   -- ACTOR { source, memberId, name }
    updated_by    JSONB NOT NULL DEFAULT '{}',
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at    TIMESTAMPTZ,
    search_vector tsvector GENERATED ALWAYS AS (
        to_tsvector('simple', coalesce(display_name,'') || ' ' || coalesce(search_text,''))
    ) STORED
);
CREATE INDEX IF NOT EXISTS idx_contacts_search ON contacts USING GIN (search_vector);
CREATE INDEX IF NOT EXISTS idx_contacts_email  ON contacts(primary_email) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_contacts_merged ON contacts(merged_into) WHERE merged_into IS NOT NULL;

-- THE HEART: multi-valued, keep-everything attributes. Every distinct value from
-- every source survives as its own row with provenance. is_primary marks the
-- current value per (contact, kind). value is canonical (email lowercased;
-- compound kinds keep a canonical key in value + structured payload in value_json).
-- norm_value is the normalized matching key for name/company (tier-3 candidate
-- bucketing), maintained by the fold path; empty for other kinds.
CREATE TABLE IF NOT EXISTS contact_attributes (
    id               VARCHAR(20) PRIMARY KEY,
    contact_id       VARCHAR(20) NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
    kind             VARCHAR(30) NOT NULL,   -- email|company|title|employment|phone|linkedin_url|location|name|seniority|company_size|contact_recency|has_replied_before|...
    value            TEXT NOT NULL DEFAULT '',
    norm_value       TEXT NOT NULL DEFAULT '', -- normalized matching key (name/company); '' otherwise
    value_json       JSONB,                  -- compound kinds e.g. employment { company, title, connected_on }
    label            TEXT,                   -- optional, e.g. "work" | "personal"
    source           VARCHAR(20) NOT NULL,   -- linkedin|gmail|manual|paste|enrichment|app|agent
    source_record_id VARCHAR(20),            -- FK -> contact_sources (added below, after that table exists)
    is_primary       BOOLEAN NOT NULL DEFAULT FALSE,
    created_by       JSONB NOT NULL DEFAULT '{}',
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (contact_id, kind, value)          -- idempotent folding: never overwrite, never duplicate
);
CREATE INDEX IF NOT EXISTS idx_cattr_contact ON contact_attributes(contact_id, kind);
CREATE INDEX IF NOT EXISTS idx_cattr_lookup  ON contact_attributes(kind, value);       -- tier-1/2 exact match (email, linkedin_url)
CREATE INDEX IF NOT EXISTS idx_cattr_norm    ON contact_attributes(kind, norm_value)
    WHERE norm_value <> '';                                                            -- tier-3 candidate bucketing (name/company)
-- exactly one current value per (contact, kind):
CREATE UNIQUE INDEX IF NOT EXISTS uq_cattr_primary
    ON contact_attributes(contact_id, kind) WHERE is_primary;

-- Untouched original imported rows + dedupe key. contact_id is null until resolved.
CREATE TABLE IF NOT EXISTS contact_sources (
    id            VARCHAR(20) PRIMARY KEY,
    contact_id    VARCHAR(20) REFERENCES contacts(id) ON DELETE SET NULL,
    source        VARCHAR(20) NOT NULL,     -- linkedin | gmail | manual | paste
    external_id   TEXT,                     -- dedupe key: linkedin_url | gmail email | message id
    raw           JSONB NOT NULL DEFAULT '{}',
    status        VARCHAR(20) NOT NULL DEFAULT 'resolved', -- resolved | pending_merge | unresolved
    imported_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_csource_ext
    ON contact_sources(source, external_id) WHERE external_id IS NOT NULL;  -- re-import is idempotent
CREATE INDEX IF NOT EXISTS idx_csource_contact ON contact_sources(contact_id);

ALTER TABLE contact_attributes
    ADD CONSTRAINT fk_cattr_source FOREIGN KEY (source_record_id)
    REFERENCES contact_sources(id) ON DELETE SET NULL;

-- User-definable tags.
CREATE TABLE IF NOT EXISTS tags (
    id          VARCHAR(20) PRIMARY KEY,
    label       TEXT NOT NULL UNIQUE,
    color       VARCHAR(20),
    created_by  JSONB NOT NULL DEFAULT '{}',
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS contact_tags (
    contact_id  VARCHAR(20) NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
    tag_id      VARCHAR(20) NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
    source      VARCHAR(20) NOT NULL DEFAULT 'manual',  -- manual | rule | llm
    created_by  JSONB NOT NULL DEFAULT '{}',
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (contact_id, tag_id)
);

-- MERGE-REVIEW QUEUE. Tier-3 (name+company fuzzy) NEVER auto-applies: the import
-- becomes its own new contact (candidate_contact_id, immediately usable) AND a
-- pending row is filed here pointing at the existing contact. A human confirms
-- (fold candidate -> existing, reversible) or rejects (both stand).
CREATE TABLE IF NOT EXISTS merge_candidates (
    id                   VARCHAR(20) PRIMARY KEY,
    contact_id           VARCHAR(20) NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,  -- existing survivor
    candidate_contact_id VARCHAR(20) NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,  -- provisional new contact
    source_id            VARCHAR(20) REFERENCES contact_sources(id) ON DELETE SET NULL,
    reason               VARCHAR(30) NOT NULL,        -- name_company_fuzzy
    score                REAL NOT NULL DEFAULT 0,     -- similarity 0..1
    evidence             JSONB NOT NULL DEFAULT '{}', -- { matched_on, incoming, existing }
    status               VARCHAR(20) NOT NULL DEFAULT 'pending', -- pending | confirmed | rejected | undone
    resolved_by          JSONB,
    created_by           JSONB NOT NULL DEFAULT '{}',
    created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    resolved_at          TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_mc_status  ON merge_candidates(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_mc_contact ON merge_candidates(contact_id);

-- Event spine: every mutation lands here via the single write path, in-transaction.
-- action='employment.changed' is the job-change signal feed (indexed below).
CREATE TABLE IF NOT EXISTS contact_events (
    id          VARCHAR(20) PRIMARY KEY,
    object_name VARCHAR(30) NOT NULL,    -- contact | tag | merge_candidate
    record_id   VARCHAR(20) NOT NULL,
    action      VARCHAR(30) NOT NULL,    -- create|update|delete|resolve.merge|attribute.added|employment.changed|title.changed|attribute.set_primary|enriched|score.set|tag.add|tag.remove|merge.suggested|merge.confirmed|merge.rejected|merge.undone
    actor       JSONB NOT NULL DEFAULT '{}',
    changes     JSONB NOT NULL DEFAULT '{}',
    summary     TEXT NOT NULL DEFAULT '',
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_cevents_record  ON contact_events(object_name, record_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_cevents_action  ON contact_events(action, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_cevents_created ON contact_events(created_at DESC);
