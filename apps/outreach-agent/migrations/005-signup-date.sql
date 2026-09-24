-- Store each contact's Gipity signup date (from the /account/accounts export) as a
-- real column so the dashboard can show + sort by it. Additive and idempotent.
-- Existing rows fill in on the next signups import (the upsert refreshes it).
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS signup_at TIMESTAMPTZ;
