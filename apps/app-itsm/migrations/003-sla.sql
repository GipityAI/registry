-- 003-sla.sql
-- SLA management: calendars, definitions, and tracking tasks

CREATE TABLE IF NOT EXISTS business_calendars (
    id SERIAL PRIMARY KEY,
    name VARCHAR(200) NOT NULL,
    timezone VARCHAR(50) NOT NULL DEFAULT 'UTC',
    schedule JSONB NOT NULL,
    holidays JSONB NOT NULL DEFAULT '[]'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS sla_definitions (
    id SERIAL PRIMARY KEY,
    name VARCHAR(200) NOT NULL,
    target_table VARCHAR(50) NOT NULL DEFAULT 'incidents',
    condition_priority INTEGER,
    target_type VARCHAR(20) NOT NULL,
    target_minutes INTEGER NOT NULL,
    calendar_id INTEGER REFERENCES business_calendars(id) ON DELETE SET NULL,
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS sla_tasks (
    id SERIAL PRIMARY KEY,
    sla_definition_id INTEGER NOT NULL REFERENCES sla_definitions(id) ON DELETE CASCADE,
    incident_id INTEGER NOT NULL REFERENCES incidents(id) ON DELETE CASCADE,
    state VARCHAR(30) NOT NULL DEFAULT 'in_progress',
    start_time TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    end_time TIMESTAMPTZ,
    target_time TIMESTAMPTZ NOT NULL,
    paused_at TIMESTAMPTZ,
    paused_duration_minutes INTEGER NOT NULL DEFAULT 0,
    is_breached BOOLEAN NOT NULL DEFAULT false,
    percentage DECIMAL(5,2) NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sla_tasks_incident ON sla_tasks(incident_id);
CREATE INDEX IF NOT EXISTS idx_sla_tasks_active ON sla_tasks(state, target_time) WHERE state = 'in_progress';
