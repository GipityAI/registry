// Function-level tests. ctx.fn.call is unauthenticated, so it confirms every
// function is locked to the signed-in owner (auth: member) - this app has no public
// endpoint, so anonymous calls to any function must be rejected.
const MEMBER_FUNCTIONS = [
    ['dashboard', {}],
    ['contacts', { op: 'list' }],
    ['settings', { op: 'get' }],
    ['candidates', { op: 'list' }],
    ['knowledge', { op: 'list', contact_guid: 'x' }],
    ['review', { op: 'queue' }],
    ['linkedin-import', { rows: [{ email: 'a@b.co' }] }],
    ['signups-import', { rows: [{ email: 'a@b.co', short_guid: 'u_x' }] }],
    ['topics', { op: 'list' }],
    ['draft-list', {}],
    ['draft-load', { contact_guid: 'x' }],
    ['draft-save', { contact_guid: 'x', draft: '{}' }],
    ['send-list', {}],
    ['send-commit', {}],
    ['revise-list', {}],
    ['revise-load', { message_guid: 'x' }],
    ['revise-save', { message_guid: 'x', draft: '{}' }],
    ['enrich-list', {}],
    ['enrich-load', { contact_guid: 'x' }],
    ['save-knowledge', { contact_guid: 'x', research: '{}' }],
    ['ingest-reply', { replies: '{}' }],
];

for (const [name, body] of MEMBER_FUNCTIONS) {
    test(`${name} rejects anonymous callers`, async (ctx) => {
        await assert.rejects(() => ctx.fn.call(name, body), `${name} should require auth`);
    });
}
