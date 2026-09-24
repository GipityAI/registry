-- Outreach Agent V4: funnels + stages as first-class, app-defined DATA (not a fixed
-- enum). Many funnels per app; each funnel has an ordered set of stages; each stage
-- owns OUR goal (advance them) + the email ASK + (via topics) what to talk about.
-- Recipients (contacts past the add-gate) live in a funnel at a stage. Additive and
-- idempotent - safe to re-run every deploy.

-- A funnel: a named campaign with an ordered set of stages.
CREATE TABLE IF NOT EXISTS funnels (
    short_guid  VARCHAR(20)  PRIMARY KEY,
    name        VARCHAR(200) NOT NULL,
    description TEXT,
    is_default  BOOLEAN      NOT NULL DEFAULT false,  -- where new recipients land by default
    active      BOOLEAN      NOT NULL DEFAULT true,
    created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- Ordered stages within a funnel.
CREATE TABLE IF NOT EXISTS funnel_stages (
    short_guid  VARCHAR(20)  PRIMARY KEY,
    funnel_guid VARCHAR(20)  NOT NULL REFERENCES funnels(short_guid) ON DELETE CASCADE,
    order_index SMALLINT     NOT NULL DEFAULT 0,
    key         VARCHAR(40)  NOT NULL,   -- stable slug within the funnel (e.g. no_account)
    label       VARCHAR(120) NOT NULL,
    goal        TEXT,                    -- what WE want here (move them to the next stage)
    ask         TEXT,                    -- the email CTA for recipients at this stage
    created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    UNIQUE (funnel_guid, key)
);
CREATE INDEX IF NOT EXISTS idx_stages_funnel ON funnel_stages(funnel_guid, order_index);

-- Recipients live in a funnel at a stage (supersedes the old contacts.stage enum,
-- which is kept for now as a display/back-compat mirror).
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS funnel_guid VARCHAR(20);
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS stage_guid  VARCHAR(20);
CREATE INDEX IF NOT EXISTS idx_contacts_funnel ON contacts(funnel_guid, stage_guid);

-- Topics now hang off a stage (what to say to recipients at that stage). The old
-- audience_stage / audience_persona targeting is retired (columns left, unused).
ALTER TABLE topics ADD COLUMN IF NOT EXISTS stage_guid VARCHAR(20);
CREATE INDEX IF NOT EXISTS idx_topics_stage ON topics(stage_guid, active);

-- Seed the default re-engagement funnel + its 4 stages (stable guids -> idempotent).
INSERT INTO funnels (short_guid, name, description, is_default, active) VALUES
 ('fn_gipity0001', 'Gipity re-engagement',
  'Win back signups and waitlist and move each one stage forward.', true, true)
ON CONFLICT (short_guid) DO NOTHING;

INSERT INTO funnel_stages (short_guid, funnel_guid, order_index, key, label, goal, ask) VALUES
 ('fs_noacct0001','fn_gipity0001',0,'no_account','No account',
   'Get them to create a Gipity account and sign in.',
   'Come try Gipity - point them at the single easiest way in.'),
 ('fs_signup0001','fn_gipity0001',1,'signed_up','Signed up, no app',
   'Get them to build and deploy their first app.',
   'Help them get their first app live - name the easiest first thing to build.'),
 ('fs_build00001','fn_gipity0001',2,'building','Building',
   'Get them building more, toward a paid plan.',
   'Give one concrete next step for something they already built.'),
 ('fs_paid000001','fn_gipity0001',3,'paid','Paid',
   'Keep them active and expand what they run on Gipity.',
   'Check in like a peer and offer a hand with a concrete next thing.')
ON CONFLICT (short_guid) DO UPDATE SET
  label=EXCLUDED.label, goal=EXCLUDED.goal, ask=EXCLUDED.ask, order_index=EXCLUDED.order_index;

-- Migrate existing contacts onto the default funnel + map their enum stage to a stage.
UPDATE contacts SET funnel_guid='fn_gipity0001' WHERE funnel_guid IS NULL;
UPDATE contacts SET stage_guid = CASE stage
    WHEN 'cold'      THEN 'fs_noacct0001'
    WHEN 'signed_up' THEN 'fs_signup0001'
    WHEN 'active'    THEN 'fs_build00001'
    WHEN 'paid'      THEN 'fs_paid000001'
    ELSE 'fs_signup0001' END
 WHERE stage_guid IS NULL;

-- Move the two starter topics onto stages.
UPDATE topics SET stage_guid='fs_signup0001' WHERE short_guid='tp_welcome00' AND stage_guid IS NULL;
UPDATE topics SET stage_guid='fs_build00001' WHERE short_guid='tp_buildmore' AND stage_guid IS NULL;
