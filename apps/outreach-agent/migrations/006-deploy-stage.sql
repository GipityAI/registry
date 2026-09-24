-- Outreach Agent V5: the funnel matches what people actually did on the platform.
-- "Building" conflated two very different moments - CREATED a project vs actually
-- DEPLOYED an app live - so split it (the platform export now carries a per-app
-- `deployed` signal). Also: contacts.stage now stores the funnel stage KEY, stage
-- changes are tracked so the drip can react to advancement, and settings gains the
-- app's public URL (used to build unsubscribe links). Additive and idempotent.

-- 1) Restage the default funnel: 5 stages.
--    no_account(0) -> signed_up(1) -> created(2) -> deployed(3) -> paid(4)
UPDATE funnel_stages SET key='created', label='Created a project', order_index=2,
  goal='Get their project deployed - a live URL they can open and share.',
  ask='Help them ship what they started: the one step to get it live, and an offer to do it together.'
 WHERE short_guid='fs_build00001';

INSERT INTO funnel_stages (short_guid, funnel_guid, order_index, key, label, goal, ask) VALUES
 ('fs_deploy0001','fn_gipity0001',3,'deployed','Deployed an app',
  'Keep them building and getting real value - on the path to a paid plan.',
  'Give one concrete next capability for the app they shipped (a database, a workflow, multiplayer, notifications).')
ON CONFLICT (short_guid) DO UPDATE SET
  label=EXCLUDED.label, goal=EXCLUDED.goal, ask=EXCLUDED.ask, order_index=EXCLUDED.order_index;

UPDATE funnel_stages SET order_index=4 WHERE short_guid='fs_paid000001';

-- signed_up narrows: its goal is now just "create a project" (deploy is the next stage).
UPDATE funnel_stages SET label='Signed up',
  goal='Get them to create their first project.',
  ask='Point at the single easiest first thing to build and offer to help them start.'
 WHERE short_guid='fs_signup0001';

-- 2) contacts.stage stores the stage KEY now (was the old cold/signed_up/active enum).
UPDATE contacts SET stage='no_account' WHERE stage='cold';
UPDATE contacts SET stage='created'    WHERE stage='active';

-- 3) Track advancement: when a contact moves stage, the drip resets their sequence and
--    the next draft acknowledges the progress instead of writing to a dormant stranger.
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS stage_changed_at TIMESTAMPTZ;

-- 4) Topics follow the split: "build on what you deployed" belongs to the deployed
--    stage; the created stage gets a "ship it" topic.
UPDATE topics SET stage_guid='fs_deploy0001' WHERE short_guid='tp_buildmore';
INSERT INTO topics (short_guid, title, body, stage_guid, active) VALUES
 ('tp_shipit000', 'Ship what you started',
  'They created a project but never deployed it. One tiny concrete step to get it live at a real URL - and an offer to do it together.',
  'fs_build00001', true)
ON CONFLICT (short_guid) DO NOTHING;

-- 5) The app's own public URL (no trailing slash) - used to build the unsubscribe link
--    in every outgoing email. Set it in Settings; while unset, emails fall back to a
--    reply-to-opt-out line instead of a link.
ALTER TABLE settings ADD COLUMN IF NOT EXISTS app_url VARCHAR(500);
