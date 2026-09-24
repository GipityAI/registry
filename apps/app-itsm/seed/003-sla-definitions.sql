-- 003-sla-definitions.sql
-- Business calendars and SLA definitions

-- 24x7 calendar
INSERT INTO business_calendars (name, timezone, schedule, holidays) VALUES
    ('24x7', 'UTC', '"always"'::jsonb, '[]'::jsonb),
    ('US Business Hours', 'America/New_York',
     '{"monday": {"start": "09:00", "end": "17:00"}, "tuesday": {"start": "09:00", "end": "17:00"}, "wednesday": {"start": "09:00", "end": "17:00"}, "thursday": {"start": "09:00", "end": "17:00"}, "friday": {"start": "09:00", "end": "17:00"}}'::jsonb,
     '[{"date": "2026-01-01", "name": "New Year"}, {"date": "2026-01-19", "name": "MLK Day"}, {"date": "2026-02-16", "name": "Presidents Day"}, {"date": "2026-05-25", "name": "Memorial Day"}, {"date": "2026-07-04", "name": "Independence Day"}, {"date": "2026-09-07", "name": "Labor Day"}, {"date": "2026-11-26", "name": "Thanksgiving"}, {"date": "2026-12-25", "name": "Christmas"}]'::jsonb
    )
ON CONFLICT DO NOTHING;

-- SLA definitions: response targets
INSERT INTO sla_definitions (name, target_table, condition_priority, target_type, target_minutes, calendar_id, is_active)
SELECT def.name, 'incidents', def.priority, 'response', def.minutes,
    (SELECT id FROM business_calendars WHERE name = def.calendar), true
FROM (VALUES
    ('P1 Response', 1, 15, '24x7'),
    ('P2 Response', 2, 30, '24x7'),
    ('P3 Response', 3, 240, 'US Business Hours'),
    ('P4 Response', 4, 480, 'US Business Hours'),
    ('P5 Response', 5, 1440, 'US Business Hours')
) AS def(name, priority, minutes, calendar);

-- SLA definitions: resolution targets
INSERT INTO sla_definitions (name, target_table, condition_priority, target_type, target_minutes, calendar_id, is_active)
SELECT def.name, 'incidents', def.priority, 'resolution', def.minutes,
    (SELECT id FROM business_calendars WHERE name = def.calendar), true
FROM (VALUES
    ('P1 Resolution', 1, 240, '24x7'),
    ('P2 Resolution', 2, 480, '24x7'),
    ('P3 Resolution', 3, 4320, 'US Business Hours'),
    ('P4 Resolution', 4, 7200, 'US Business Hours'),
    ('P5 Resolution', 5, 14400, 'US Business Hours')
) AS def(name, priority, minutes, calendar);
