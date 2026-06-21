// contacts kit tests. `test`/`assert` are harness globals - do not import them.
//
// ctx.fn.call is UNAUTHENTICATED, and all contacts functions are auth:user, so
// the harness can only (1) unit-test the pure _lib helpers directly and (2) prove
// the write/read doors reject anonymous callers. The full resolution engine is
// verified end-to-end against the real DB via authenticated `gipity fn call`
// scenarios - see registry/kits/contacts/VERIFY.md.
import { normEmail, normUrl, normName, normCompany, nameSimilarity } from '../../functions/_lib/contacts/normalize.js';
import { mapRow } from '../../functions/_lib/contacts/mappers.js';
import { fitFromTitle } from '../../functions/_lib/contacts/score.js';

// ---- normalize ----
test('normEmail lowercases and validates', () => {
  assert.equal(normEmail('  Aaron@BOX.com '), 'aaron@box.com');
  assert.equal(normEmail('not-an-email'), null);
});

test('normUrl canonicalizes LinkedIn URLs', () => {
  assert.equal(normUrl('https://www.linkedin.com/in/jane-doe/?x=1'), 'linkedin.com/in/jane-doe');
  assert.equal(normUrl('linkedin.com/in/jane-doe'), 'linkedin.com/in/jane-doe');
});

test('normName folds accents/punctuation/case', () => {
  assert.equal(normName('  José  Núñez! '), 'jose nunez');
});

test('normCompany strips legal suffixes so spellings converge', () => {
  assert.equal(normCompany('Acme Inc'), normCompany('Acme'));
  assert.equal(normCompany('Box, LLC'), 'box');
});

test('nameSimilarity is high for reordered tokens, low for different names', () => {
  assert.ok(nameSimilarity('Jane Smith', 'Smith Jane') === 1);
  assert.ok(nameSimilarity('Jane Smith', 'John Doe') === 0);
});

// ---- mappers ----
test('mapRow(linkedin) builds name/email/url/company/employment with norm keys', () => {
  const m = mapRow('linkedin', { first_name: 'Aaron', last_name: 'Levie', email: 'Aaron@Box.com', company: 'Box', position: 'CEO', url: 'https://linkedin.com/in/aaronlevie', connected_on: '01 Jan 2020' });
  assert.equal(m.externalId, 'linkedin.com/in/aaronlevie'); // url preferred as dedupe key
  assert.equal(m.displayName, 'Aaron Levie');
  const byKind = Object.fromEntries(m.attrs.map(a => [a.kind, a]));
  assert.equal(byKind.email.value, 'aaron@box.com');
  assert.equal(byKind.name.norm_value, 'aaron levie');
  assert.equal(byKind.company.norm_value, 'box');
  assert.equal(byKind.employment.value_json.title, 'CEO');
});

test('mapRow(gmail) keeps email as dedupe key; mapRow(manual) tolerates sparse rows', () => {
  assert.equal(mapRow('gmail', { email: 'x@y.com', name: 'X Y' }).externalId, 'x@y.com');
  const man = mapRow('manual', { name: 'Jane Smith', company: 'Acme Inc' });
  assert.equal(man.externalId, null); // no email/url -> goes to fuzzy matching, not dedup
  assert.equal(man.attrs.find(a => a.kind === 'company').norm_value, 'acme');
});

// ---- optional scoring helper ----
test('fitFromTitle ranks founders above recruiters', () => {
  assert.ok(fitFromTitle('Co-Founder & CEO') > fitFromTitle('Technical Recruiter'));
  assert.equal(fitFromTitle(''), 45);
});

// ---- auth: contacts are PII, every door rejects anonymous callers ----
// auth:user calls without a token are rejected by the platform (the call throws),
// so the resolution engine is never reachable anonymously.
test('contacts functions reject anonymous callers', async (ctx) => {
  await assert.rejects(() => ctx.fn.call('contact-import', { source: 'manual', rows: [{ email: 'a@b.co' }] }));
  await assert.rejects(() => ctx.fn.call('contact-read', { action: 'list' }));
  await assert.rejects(() => ctx.fn.call('contact-write', { action: 'update', id: 'x', values: {} }));
  await assert.rejects(() => ctx.fn.call('contact-harvest', { harvest: '{"contacts":[]}' }));
});
