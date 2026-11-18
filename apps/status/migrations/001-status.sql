-- One row per probe of one component, written every minute by run-checks.
-- Kept 90 days; maintain rolls each finished UTC day into status_daily first.
CREATE TABLE status_checks (
  short_guid  VARCHAR(20) PRIMARY KEY,
  component   VARCHAR(40) NOT NULL,
  checked_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  state       VARCHAR(12) NOT NULL CHECK (state IN ('operational', 'degraded', 'down')),
  latency_ms  INTEGER,
  http_status INTEGER,
  error       TEXT
);
CREATE INDEX status_checks_component_time ON status_checks (component, checked_at DESC);
CREATE INDEX status_checks_time ON status_checks (checked_at);

-- Daily rollup per component (UTC days). Survives the 90-day prune, so the
-- history bars and 90-day uptime never depend on raw rows.
CREATE TABLE status_daily (
  component      VARCHAR(40) NOT NULL,
  day            DATE NOT NULL,
  checks         INTEGER NOT NULL,
  degraded       INTEGER NOT NULL,
  down           INTEGER NOT NULL,
  avg_latency_ms INTEGER,
  PRIMARY KEY (component, day)
);

-- Incidents the owner posts (incident-post). components is a list of
-- component keys from functions/_lib/status.js.
CREATE TABLE status_incidents (
  short_guid  VARCHAR(20) PRIMARY KEY,
  title       VARCHAR(200) NOT NULL,
  components  TEXT[] NOT NULL DEFAULT '{}',
  impact      VARCHAR(12) NOT NULL CHECK (impact IN ('minor', 'major')),
  status      VARCHAR(16) NOT NULL CHECK (status IN ('investigating', 'identified', 'monitoring', 'resolved')),
  started_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at TIMESTAMPTZ,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX status_incidents_started ON status_incidents (started_at DESC);

-- The timeline of one incident: each post adds a row with the status it set.
CREATE TABLE status_incident_updates (
  short_guid    VARCHAR(20) PRIMARY KEY,
  incident_guid VARCHAR(20) NOT NULL REFERENCES status_incidents (short_guid) ON DELETE CASCADE,
  status        VARCHAR(16) NOT NULL,
  body          TEXT NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX status_incident_updates_incident ON status_incident_updates (incident_guid, created_at);

-- Small runtime settings (the Gipity Storage probe file's guid).
CREATE TABLE status_settings (
  key   VARCHAR(40) PRIMARY KEY,
  value TEXT NOT NULL
);
