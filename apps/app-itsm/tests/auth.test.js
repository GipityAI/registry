// Every automation function is auth: member (run by workflows as the owner).
// Anonymous callers and signed-in non-members must be refused before the
// handler runs, so nobody with the URL can rewrite incidents, SLAs or KB data.

const MEMBER_FUNCTIONS = [
    'classify-incident',
    'smart-assign',
    'calculate-sla',
    'check-sla-breaches',
    'escalate-incident',
    'auto-close-resolved',
    'generate-kb-article',
    'notify-request-approver',
    'analyze-sentiment',
    'collect-kpis',
    'generate-weekly-digest',
];

for (const name of MEMBER_FUNCTIONS) {
    test(`${name} refuses anonymous callers`, async (ctx) => {
        await assert.rejects(() => ctx.fn.call(name, { incident_id: 1 }), /403 FORBIDDEN|401 LOGIN_REQUIRED/);
    });

    test(`${name} refuses signed-in non-members`, async (ctx) => {
        await assert.rejects(() => ctx.fn.callAs(ctx.users.alice, name, { incident_id: 1 }), /403 FORBIDDEN/);
    });
}
