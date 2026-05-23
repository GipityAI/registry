-- 001-core-tables.sql
-- Core tables for GipITSM: teams, categories, priority matrix, comments, user profiles, settings

CREATE TABLE IF NOT EXISTS teams (
    id SERIAL PRIMARY KEY,
    name VARCHAR(200) NOT NULL,
    slug VARCHAR(100) NOT NULL UNIQUE,
    manager_user_id VARCHAR(50),
    email VARCHAR(300),
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS team_members (
    id SERIAL PRIMARY KEY,
    team_id INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
    user_id VARCHAR(50) NOT NULL,
    role VARCHAR(50) NOT NULL DEFAULT 'member',
    UNIQUE(team_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_team_members_user_id ON team_members(user_id);

CREATE TABLE IF NOT EXISTS categories (
    id SERIAL PRIMARY KEY,
    name VARCHAR(200) NOT NULL,
    parent_id INTEGER REFERENCES categories(id) ON DELETE SET NULL,
    module VARCHAR(50) NOT NULL DEFAULT 'incident',
    is_active BOOLEAN NOT NULL DEFAULT true,
    sort_order INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_categories_parent_id ON categories(parent_id);
CREATE INDEX IF NOT EXISTS idx_categories_module ON categories(module);

CREATE TABLE IF NOT EXISTS priority_matrix (
    id SERIAL PRIMARY KEY,
    impact INTEGER NOT NULL,
    urgency INTEGER NOT NULL,
    priority INTEGER NOT NULL,
    priority_label VARCHAR(50) NOT NULL,
    UNIQUE(impact, urgency)
);

CREATE TABLE IF NOT EXISTS comments (
    id SERIAL PRIMARY KEY,
    target_table VARCHAR(50) NOT NULL,
    target_id INTEGER NOT NULL,
    comment_type VARCHAR(50) NOT NULL DEFAULT 'comment',
    body TEXT NOT NULL,
    author_user_id VARCHAR(50),
    author_name VARCHAR(200),
    is_ai_generated BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_comments_target ON comments(target_table, target_id, created_at DESC);

CREATE TABLE IF NOT EXISTS user_profiles (
    id SERIAL PRIMARY KEY,
    gipity_user_id VARCHAR(50) NOT NULL UNIQUE,
    display_name VARCHAR(200),
    email VARCHAR(300),
    itsm_role VARCHAR(50) NOT NULL DEFAULT 'end_user',
    primary_team_id INTEGER REFERENCES teams(id) ON DELETE SET NULL,
    timezone VARCHAR(50) NOT NULL DEFAULT 'UTC',
    is_active BOOLEAN NOT NULL DEFAULT true,
    last_login_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_user_profiles_email ON user_profiles(email);

CREATE TABLE IF NOT EXISTS app_settings (
    key VARCHAR(100) PRIMARY KEY,
    value JSONB NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
