# contacts kit

A source-agnostic **contact data layer** for B2B / lead-gen apps. Ingest people
from LinkedIn, Gmail, or pasted lists; resolve duplicates into one person while
**keeping every value from every source** with provenance; tag and segment; and
get a clean query/update surface. Outreach and scoring *policy* are out of scope —
they belong to your app. This is the "who do I know and what do I know about
them" substrate.

```
gipity add contacts        # needs a database template (web-fullstack or api)
gipity deploy dev
```

Backend-bearing: installs four functions (`contact-import`, `contact-read`,
`contact-write`, `contact-harvest`), one migration, and a client module at
`@gipity/contacts`. All data functions are `auth: user` — contacts are PII.

## The model (why it's not just a table)

- **Keep-all attributes.** Every distinct value from every source survives as its
  own row in `contact_attributes` (multiple companies, emails, titles coexist).
  Nothing is ever overwritten. An `is_primary` flag per `(contact, kind)` marks the
  current value — flip it by hand with `set_primary`.
- **Identity resolution.** Imports are matched into existing people, in priority:
  (1) exact email, (2) exact LinkedIn URL — both auto-apply; (3) fuzzy name+company —
  **never auto-merges.** Tier 3 creates an independent new contact *and* files a
  suggestion in the **merge-review queue** for a human to confirm or reject. Bias:
  when uncertain, create new rather than risk a wrong merge. Confirmed merges are
  reversible (`merge_undo`).
- **Job-change signals.** Re-importing an updated LinkedIn export is *not* a no-op.
  When a contact gains a new company/employment value, the old one is kept and an
  `employment.changed` event fires — the highest-value lead-gen trigger there is.
  Read the feed with `jobChanges()` / `contact-read { action:'events',
  action_filter:'employment.changed' }`.
- **Provenance + event spine.** Every raw imported row is stored untouched in
  `contact_sources`; every mutation emits a `contact_events` row in the same
  transaction, attributed to an ACTOR (`HUMAN | IMPORT | AGENT | API`).

## Client usage

```js
import { parseLinkedInCSV, parseAddressBook, backfillEmails,
         importContacts, listContacts, listCandidates, confirmMerge } from '@gipity/contacts';

// 1. Parse the LinkedIn export in the browser (deterministic, no AI).
const connections = parseLinkedInCSV(connectionsCsvText);
backfillEmails(connections, parseAddressBook(importedContactsCsvText)); // fills missing emails

// 2. Import (auto-chunked). Returns { created, folded, pending_merge, job_changes }.
await importContacts('linkedin', connections, { onProgress: (d, t) => console.log(d, '/', t) });

// 3. Triage.
const { contacts } = await listContacts({ q: 'founder', has_email: true, sort: 'score' });
const { candidates } = await listCandidates();   // review-queue
await confirmMerge(candidates[0].id);
```

Pasted lists: `importContacts('manual', [{ email, name, company }, ...])`.

## Gmail harvest (optional, cost-flagged — fast-follow)

`contact-harvest` is the **save side** and works today: POST a JSON blob of found
people and they fold in as `source='gmail'`. The **read side** — an LLM that scans
the connected inbox — is an app-level workflow you add, e.g.:

```yaml
# workflows/harvest-contacts.yaml  (you add this in your app)
steps:
  - id: harvest
    type: llm
    tool_filter: [gmail_search, gmail_read]
    prompt: |
      Search Gmail (e.g. 'in:sent newer_than:90d') for real human contacts —
      founders/builders/operators, not newsletters or automated senders. Return
      strict JSON: {"contacts":[{"email":string,"name":string}]}. Max 25.
  - id: save
    type: function
    function: contact-harvest
    body: { harvest: "{{ steps.harvest.output }}" }
```

**Cost:** the inbox scan costs LLM tokens per run, so trigger it **manually**
(`gipity workflow run harvest-contacts`), not on a schedule. Gmail's own API is
free (quota-limited). A cheaper deterministic sender-frequency pre-pass is a good
future optimization.

## Optional scoring helper

`functions/_lib/contacts/score.js` exports `fitFromTitle(title)` — a free regex
heuristic (founders/builders rank above recruiters/students). The kit never
auto-applies it; opt in from your app, then persist via
`contact-write { action:'score' }`. Real scoring policy is yours to define.

## Notes / limits (v1)

- Tier-3 candidate bucketing is by *exact normalized name* then company (the
  managed DB forbids `pg_trgm`, so similarity is computed in JS). Name typos won't
  bucket together — a conservative miss, not a wrong merge.
- Identical values from two sources collapse to one attribute row (loses
  second-source provenance on that exact value).
- A brand-new email imported by two concurrent calls could create two contacts —
  resolve with a follow-up pass if you import in parallel.
