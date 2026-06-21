# Verifying the contacts kit

Two layers, because `ctx.fn.call` in `gipity test` is **unauthenticated** and the
contact functions are `auth: user`:

1. **Unit tests** (`tests/api/contacts.test.js`, run by `gipity test`) cover the
   pure `_lib` helpers (normalize, mappers, score) and assert every door rejects
   anonymous callers.
2. **End-to-end engine** — drive the live functions as a signed-in user with
   `gipity fn call` (it carries your CLI auth) and read back with `gipity db query`.
   This is the real proof of the resolution engine. All scenarios below were run
   green against a dev app (2026-06-21).

```bash
# Create + idempotent re-import + JOB CHANGE (same LinkedIn URL, new company)
gipity fn call contact-import '{"source":"linkedin","rows":[{"first_name":"Aaron","last_name":"Levie","email":"aaron@box.com","company":"Box","position":"CEO","url":"linkedin.com/in/aaronlevie"}]}'   # created:1
gipity fn call contact-import '{"source":"linkedin","rows":[{"first_name":"Aaron","last_name":"Levie","email":"aaron@box.com","company":"Box","position":"CEO","url":"linkedin.com/in/aaronlevie"}]}'   # folded:1, job_changes:[]
gipity fn call contact-import '{"source":"linkedin","rows":[{"first_name":"Aaron","last_name":"Levie","email":"aaron@box.com","company":"Box 2.0","position":"Founder","url":"linkedin.com/in/aaronlevie"}]}'  # folded:1, job_changes:[company Box->Box 2.0, employment ...]

# Cross-source tier-1 fold (Gmail, same email -> same contact, not a new one)
gipity fn call contact-import '{"source":"gmail","rows":[{"email":"aaron@box.com","name":"Aaron Levie"}]}'   # folded:1

# Tier-3 review queue: same name+company, no shared email/url -> NEW contact + pending candidate, existing untouched
gipity fn call contact-import '{"source":"linkedin","rows":[{"first_name":"Jane","last_name":"Smith","email":"jane@acme.com","company":"Acme","position":"VP","url":"linkedin.com/in/janesmith"}]}'  # created:1
gipity fn call contact-import '{"source":"manual","rows":[{"name":"Jane Smith","company":"Acme Inc"}]}'   # pending_merge:1
gipity fn call contact-read   '{"action":"candidates"}'                                # 1 pending, score 0.92

# Reversible merge
gipity fn call contact-write '{"action":"merge_confirm","candidate_id":"<id>"}'   # loser soft-deleted, merged_into set
gipity fn call contact-write '{"action":"merge_undo","candidate_id":"<id>"}'      # loser restored

# Enrich / tag / score / job-change feed
gipity fn call contact-write '{"action":"tag_create","label":"investor"}'
gipity fn call contact-write '{"action":"tag_apply","contact_id":"<id>","label":"investor"}'
gipity fn call contact-write '{"action":"enrich","contact_id":"<id>","kind":"seniority","value":"C-level"}'
gipity fn call contact-write '{"action":"score","contact_id":"<id>","score":92}'
gipity fn call contact-read  '{"action":"events","action_filter":"employment.changed"}'   # the lead-signal feed
```
