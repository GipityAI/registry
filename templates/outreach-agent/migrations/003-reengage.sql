-- Outreach Agent V3: turn the funnel into an ongoing re-engagement drip aimed at
-- existing Gipity users + waitlist, sent from Steve's own Gmail. Additive and
-- idempotent - safe to re-run on every deploy.

-- One-click unsubscribe. A per-contact opaque token that a public /unsubscribe page
-- resolves to set status='unsubscribed'. Random, not derivable from the contact guid.
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS unsub_token VARCHAR(32);
UPDATE contacts
   SET unsub_token = substr(md5(random()::text || short_guid || clock_timestamp()::text), 1, 24)
 WHERE unsub_token IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_contacts_unsub ON contacts(unsub_token);

-- Re-engagement copy. 001 seeded the touch instructions for cold acquisition; retune
-- them to invite drifted users BACK (they already have accounts/apps), lead with
-- "we've shipped features + fixed bugs", and ask what they'd build or continue. These
-- UPDATEs run every deploy (idempotent - same values).
UPDATE sequence_steps SET label='Intro', instruction=
 'First touch, re-engaging someone who signed up for Gipity but drifted. Warm and personal, one human to another, signed by Steve. In one or two lines remind them what Gipity is: your own cloud agent (Gip) that builds and runs real apps for you. Say we have been shipping fast lately - new features and lots of bug fixes. Reference something specific you know about them (an app they built, or what they asked the agent to build) and invite them back to pick it up or try something new. Ask lightly what they would want to build or continue. Be candid that this email was drafted by an AI agent running on Gipity. Keep it short.'
 WHERE step_number=0;
UPDATE sequence_steps SET label='Follow-up', instruction=
 'Second touch a few days later, still no reply. Do NOT repeat the intro. Give one new, specific reason THIS person in particular would want to come back - tied to what they built or wanted to build. Shorter than the intro. Signed by Steve, still disclose it is AI-drafted.'
 WHERE step_number=1;
UPDATE sequence_steps SET label='Final nudge', instruction=
 'Third touch, short and low-pressure. Offer to help them get unstuck or point at the single easiest next step. Make clear you will ease off if now is not the time. One or two sentences. Signed Steve, AI-drafted disclosed.'
 WHERE step_number=2;

-- A fourth, ongoing keep-warm touch used once the fast phase backs off to monthly.
-- draft-load picks min(seq_step, count-1), so every touch past #3 reuses this one.
INSERT INTO sequence_steps (step_number, label, instruction) VALUES
 (3, 'Keep-warm',
  'Ongoing monthly check-in for someone who still has not replied. Fresh and brief every time: lead with one genuinely new thing since last time (a new feature, template, or fix) and a light invitation to come build. Never guilt-trip about the silence. Vary it from prior touches - you will be shown earlier subjects. Signed Steve, AI-drafted disclosed.')
ON CONFLICT (step_number) DO UPDATE SET label=EXCLUDED.label, instruction=EXCLUDED.instruction;

-- Retune the base ask for a win-back campaign.
UPDATE settings SET base_ask=
 'Invite them back to Gipity to build something or pick a project back up. We have been shipping new features and fixing bugs fast. Ask what they would like to build or continue, and offer to help them get started.'
 WHERE id=1;
