-- Outreach Agent V2: retarget from cold LinkedIn/Gmail contacts to Gipity platform
-- signups, with funnel-stage + persona segmentation and a topics library the drafts
-- pick from. Additive and idempotent - safe to re-run on every deploy, and safe to
-- apply on top of an app that already ran 001 with live contacts.

-- Funnel stage: where this person is on the Gipity journey. Drives the register the
-- draft writes in (cold = "here's what this is + why you"; signed_up/active = "new
-- thing / how's it going, tied to what you built").
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS stage VARCHAR(20) NOT NULL DEFAULT 'cold';
    -- cold | signed_up | active

-- Persona: who they are, inferred from their stored knowledge by the enrich step.
-- Pairs with stage to choose a matching topic.
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS persona VARCHAR(20) NOT NULL DEFAULT 'unknown';
    -- investor | developer | designer | games | enterprise | unknown

-- The platform user short_guid this contact maps to (reference + dedup against the
-- /account/accounts export). Nullable: a manual/LinkedIn contact has no account yet.
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS account_guid VARCHAR(20);

-- When the Gmail enrich pass last ran. The enrich queue gates on this (not on
-- "has no knowledge") so a signup that already carries imported account facts still
-- gets enriched + persona-classified exactly once.
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS enriched_at TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS idx_contacts_account ON contacts(account_guid);
CREATE INDEX IF NOT EXISTS idx_contacts_stage   ON contacts(stage);
CREATE INDEX IF NOT EXISTS idx_contacts_persona ON contacts(persona);

-- The topics library: the things outreach can be ABOUT. The draft step picks one
-- active topic matching a contact's (stage, persona) - a null audience_* means the
-- topic fits any stage / any persona.
CREATE TABLE IF NOT EXISTS topics (
    short_guid       VARCHAR(20)  PRIMARY KEY,
    title            VARCHAR(200) NOT NULL,
    body             TEXT,                          -- what to say about it / why it matters
    audience_stage   VARCHAR(20),                   -- null = any stage
    audience_persona VARCHAR(20),                   -- null = any persona
    active           BOOLEAN      NOT NULL DEFAULT true,
    created_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_topics_active ON topics(active, audience_stage, audience_persona);

-- Seed a couple of starter topics so a fresh install can draft immediately. Stable
-- short_guids keep this insert idempotent across redeploys.
INSERT INTO topics (short_guid, title, body, audience_stage, audience_persona, active) VALUES
 ('tp_welcome00', 'What Gipity is',
  'For someone who just signed up but has not built yet: in one or two lines, what a cloud agent on Gipity is and the single easiest first thing they can build today.',
  'signed_up', NULL, true),
 ('tp_buildmore', 'Build on what you started',
  'For an active builder: nudge them on the apps they have already deployed - one concrete next feature or capability (a database, a workflow, multiplayer) that fits what they built.',
  'active', NULL, true)
ON CONFLICT (short_guid) DO NOTHING;
