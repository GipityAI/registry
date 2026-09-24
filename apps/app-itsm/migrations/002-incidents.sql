-- 002-incidents.sql
-- Incident management tables

CREATE SEQUENCE IF NOT EXISTS incidents_number_seq START WITH 1000;

CREATE TABLE IF NOT EXISTS incidents (
    id SERIAL PRIMARY KEY,
    number VARCHAR(20) NOT NULL UNIQUE DEFAULT 'INC' || LPAD(nextval('incidents_number_seq')::text, 7, '0'),
    short_description VARCHAR(500) NOT NULL,
    description TEXT,
    state VARCHAR(30) NOT NULL DEFAULT 'new',
    impact INTEGER NOT NULL DEFAULT 3,
    urgency INTEGER NOT NULL DEFAULT 3,
    priority INTEGER NOT NULL DEFAULT 3,
    category_id INTEGER REFERENCES categories(id) ON DELETE SET NULL,
    subcategory_id INTEGER REFERENCES categories(id) ON DELETE SET NULL,
    team_id INTEGER REFERENCES teams(id) ON DELETE SET NULL,
    assigned_to VARCHAR(50),
    caller_id VARCHAR(50) NOT NULL,
    caller_name VARCHAR(200),
    contact_type VARCHAR(50),
    parent_id INTEGER REFERENCES incidents(id) ON DELETE SET NULL,
    is_major BOOLEAN NOT NULL DEFAULT false,
    severity INTEGER,
    resolution_code VARCHAR(50),
    resolution_notes TEXT,
    resolved_by VARCHAR(50),
    resolved_at TIMESTAMPTZ,
    closed_at TIMESTAMPTZ,
    hold_reason VARCHAR(200),
    reopen_count INTEGER NOT NULL DEFAULT 0,
    escalation_level INTEGER NOT NULL DEFAULT 0,
    ai_confidence DECIMAL(3,2),
    ai_suggested_category VARCHAR(200),
    ai_suggested_team VARCHAR(200),
    sla_response_due TIMESTAMPTZ,
    sla_resolution_due TIMESTAMPTZ,
    sla_response_breached BOOLEAN NOT NULL DEFAULT false,
    sla_resolution_breached BOOLEAN NOT NULL DEFAULT false,
    created_by VARCHAR(50),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_incidents_state_priority ON incidents(state, priority, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_incidents_team_state ON incidents(team_id, state);
CREATE INDEX IF NOT EXISTS idx_incidents_assigned_state ON incidents(assigned_to, state);
CREATE INDEX IF NOT EXISTS idx_incidents_caller_state ON incidents(caller_id, state);
CREATE INDEX IF NOT EXISTS idx_incidents_major_state ON incidents(is_major, state);
CREATE INDEX IF NOT EXISTS idx_incidents_parent ON incidents(parent_id);

CREATE TABLE IF NOT EXISTS major_incidents (
    id SERIAL PRIMARY KEY,
    incident_id INTEGER NOT NULL UNIQUE REFERENCES incidents(id) ON DELETE CASCADE,
    commander_user_id VARCHAR(50),
    bridge_url VARCHAR(500),
    slack_channel VARCHAR(200),
    next_update_at TIMESTAMPTZ,
    update_frequency_minutes INTEGER NOT NULL DEFAULT 30,
    business_impact TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS major_incident_updates (
    id SERIAL PRIMARY KEY,
    major_incident_id INTEGER NOT NULL REFERENCES major_incidents(id) ON DELETE CASCADE,
    update_type VARCHAR(50) NOT NULL,
    message TEXT NOT NULL,
    audience VARCHAR(50) NOT NULL DEFAULT 'internal',
    created_by VARCHAR(50),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_major_incident_updates_mi ON major_incident_updates(major_incident_id, created_at DESC);
