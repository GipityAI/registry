-- servicenow kit - generic mirror of ServiceNow table rows.
--
-- One row per (sn_table, sys_id): the ServiceNow record's raw fields live in
-- `data` (jsonb), not typed columns. ServiceNow tables are arbitrary and their
-- schema is unknown at kit-build time (admins add custom fields per instance),
-- so this deliberately departs from a typed-column design - the app queries
-- `data->>'field_name'` rather than a dedicated column per field.
CREATE TABLE sn_records (
  sn_table      text NOT NULL,
  sys_id        text NOT NULL,
  data          jsonb NOT NULL,
  sn_updated_on timestamptz,
  origin        text NOT NULL CHECK (origin IN ('pull', 'webhook', 'write')),
  synced_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (sn_table, sys_id)
);

-- Drives both "changed since last sync" pull queries and table-scoped reads.
CREATE INDEX sn_records_table_updated_idx ON sn_records (sn_table, sn_updated_on);
