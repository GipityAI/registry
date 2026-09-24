-- Outreach Agent schema. Idempotent - safe to re-run on every deploy.
--
-- A personal outreach funnel governed by a dedicated "Outreach" agent. The agent's
-- soul + rules (its playbook) live on the Gipity platform and inject into every
-- drafting workflow; this app stores the people, their per-contact knowledge base,
-- the message pipeline, the touch sequence, and the settings the workflows read.

-- People you want to reach. One row per contact.
CREATE TABLE IF NOT EXISTS contacts (
    short_guid        VARCHAR(20)  PRIMARY KEY,
    email             VARCHAR(320) UNIQUE,                       -- nullable: imported contacts may have no email (never sequenced)
    name              VARCHAR(200),
    company           VARCHAR(200),
    title             VARCHAR(200),
    linkedin_url      VARCHAR(300),
    source            VARCHAR(40)  NOT NULL DEFAULT 'manual',    -- manual | gmail | linkedin | import
    status            VARCHAR(40)  NOT NULL DEFAULT 'to_qualify',-- to_qualify | new | in_sequence | replied | done | no_email | paused | unsubscribed | bounced | disqualified
    cadence           VARCHAR(20)  NOT NULL DEFAULT 'every3',    -- every3 | weekly | biweekly | monthly | paused
    fit_score         SMALLINT     NOT NULL DEFAULT 50,          -- 0-100 heuristic "is this a good person to reach" score
    fit_reason        TEXT,
    engagement_score  SMALLINT     NOT NULL DEFAULT 0,           -- bumps on send / reply
    seq_step          SMALLINT     NOT NULL DEFAULT 0,           -- which sequence_steps touch is next
    notes             TEXT,                                       -- what you (the human) know about this contact
    last_contacted_at TIMESTAMPTZ,
    next_contact_at   TIMESTAMPTZ,                                -- target send time for the next touch
    created_at        TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at        TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_contacts_status   ON contacts(status);
CREATE INDEX IF NOT EXISTS idx_contacts_next     ON contacts(next_contact_at);
CREATE INDEX IF NOT EXISTS idx_contacts_score    ON contacts((fit_score + engagement_score) DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_contacts_linkedin ON contacts(linkedin_url);

-- The per-contact knowledge base: one row per fact. Built once by the enrich
-- workflow (distilled from prior Gmail), appended on every reply, hand-editable.
-- Drafting reads this; nothing re-scans Gmail per draft.
CREATE TABLE IF NOT EXISTS contact_knowledge (
    short_guid   VARCHAR(20)  PRIMARY KEY,
    contact_guid VARCHAR(20)  NOT NULL REFERENCES contacts(short_guid) ON DELETE CASCADE,
    source       VARCHAR(20)  NOT NULL DEFAULT 'manual',   -- gmail | reply | web | linkedin | manual
    content      TEXT         NOT NULL,
    created_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_knowledge_contact ON contact_knowledge(contact_guid, created_at DESC);

-- Every message in or out: agent drafts, sent emails, and replies we log.
CREATE TABLE IF NOT EXISTS messages (
    short_guid       VARCHAR(20) PRIMARY KEY,
    contact_guid     VARCHAR(20) NOT NULL REFERENCES contacts(short_guid) ON DELETE CASCADE,
    direction        VARCHAR(12) NOT NULL DEFAULT 'outbound',   -- outbound | inbound
    status           VARCHAR(20) NOT NULL DEFAULT 'draft',       -- draft | pending_approval | revising | approved | sending | sent | rejected | logged
    seq_step         SMALLINT,                                   -- which touch this draft is for
    subject          TEXT,
    body             TEXT,
    body_original    TEXT,        -- the agent's first draft (kept so learn can compare against edits)
    reject_reason    TEXT,        -- the human's feedback on a rejected draft
    comment          TEXT,        -- the human's comment that steers a redraft (and teaches the agent)
    rationale        TEXT,        -- why the agent chose this angle (transparency)
    model            VARCHAR(60),
    scheduled_send_at TIMESTAMPTZ,                               -- when this approved message should go out (the cadence mark)
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    sent_at          TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_messages_contact   ON messages(contact_guid, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_messages_status    ON messages(status);
CREATE INDEX IF NOT EXISTS idx_messages_scheduled ON messages(scheduled_send_at);

-- The touch sequence: distinct instructions per touch so follow-ups don't repeat.
-- Timing comes from each contact's cadence; this drives WHAT each touch says.
CREATE TABLE IF NOT EXISTS sequence_steps (
    step_number SMALLINT    PRIMARY KEY,
    label       VARCHAR(80) NOT NULL,
    instruction TEXT        NOT NULL
);
INSERT INTO sequence_steps (step_number, label, instruction) VALUES
 (0, 'Intro',
  'First touch. Warm, personal intro from one human to another. Reference something specific from what you know about them, mention you have been building on Gipity and why it made you think of them, make the base ask once, and be candid that this email itself was drafted by an AI agent running on Gipity. One easy way to try it.'),
 (1, 'Follow-up',
  'Second touch, a few days later with no reply. Do NOT repeat the intro. Add one new, specific reason this person in particular would find Gipity useful or fun, tied to what you know about them. Keep it shorter than the intro. Still disclose it is AI-drafted.'),
 (2, 'Final nudge',
  'Third and final touch. Short, low-pressure. Offer to help them get started or point to the single first step, and make clear you will leave it there if now is not the time. One sentence is fine. Still disclose it is AI-drafted.')
ON CONFLICT (step_number) DO NOTHING;

-- Single-row settings the workflows + dashboard read.
CREATE TABLE IF NOT EXISTS settings (
    id              INT PRIMARY KEY DEFAULT 1,
    base_ask        TEXT,                                  -- the core thing every email asks for
    product_name    VARCHAR(120) DEFAULT 'Gipity',
    product_url     VARCHAR(500) DEFAULT 'https://gipity.ai',
    sender_name     VARCHAR(120),
    signature       TEXT,
    model           VARCHAR(60)  DEFAULT 'claude-sonnet-5',
    default_cadence VARCHAR(20)  DEFAULT 'every3',
    draft_lead_days SMALLINT     DEFAULT 1,                -- draft this many days before the send mark
    daily_send_cap  INT          DEFAULT 10,              -- max emails per send run (platform limit is 10/hr)
    draft_cap       INT          DEFAULT 20,              -- max drafts generated per draft run
    notify_email    VARCHAR(320),                          -- where reply alerts go (your personal inbox)
    agent_name      VARCHAR(120) DEFAULT 'Outreach',
    agent_guid      VARCHAR(20),                           -- the Outreach agent's short_guid (for the rules/learn bridge)
    webhook_secret  VARCHAR(120),                          -- reserved
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT settings_single CHECK (id = 1)
);

INSERT INTO settings (id, base_ask, sender_name, signature, notify_email)
VALUES (
    1,
    'Try Gipity and tell me honestly what you think - what worked, what did not, what you wish it did.',
    'Steve',
    'Steve',
    NULL
)
ON CONFLICT (id) DO NOTHING;
