-- 004-knowledge.sql
-- Knowledge base articles

CREATE SEQUENCE IF NOT EXISTS knowledge_articles_number_seq START WITH 1000;

CREATE TABLE IF NOT EXISTS knowledge_articles (
    id SERIAL PRIMARY KEY,
    number VARCHAR(20) NOT NULL UNIQUE DEFAULT 'KB' || LPAD(nextval('knowledge_articles_number_seq')::text, 7, '0'),
    title VARCHAR(500) NOT NULL,
    body TEXT,
    category VARCHAR(100),
    state VARCHAR(30) NOT NULL DEFAULT 'draft',
    author_user_id VARCHAR(50),
    source_incident_id INTEGER REFERENCES incidents(id) ON DELETE SET NULL,
    view_count INTEGER NOT NULL DEFAULT 0,
    helpful_count INTEGER NOT NULL DEFAULT 0,
    not_helpful_count INTEGER NOT NULL DEFAULT 0,
    visibility VARCHAR(30) NOT NULL DEFAULT 'public',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_knowledge_articles_fts
    ON knowledge_articles
    USING GIN (to_tsvector('english', COALESCE(title, '') || ' ' || COALESCE(body, '')));

CREATE INDEX IF NOT EXISTS idx_knowledge_articles_state ON knowledge_articles(state);
CREATE INDEX IF NOT EXISTS idx_knowledge_articles_category ON knowledge_articles(category);
