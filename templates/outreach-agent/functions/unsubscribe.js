// Public one-click unsubscribe. The footer link on every email points at
// unsubscribe.html?t=<unsub_token>, which calls this (unauthenticated) function.
// It flips the contact to 'unsubscribed', halts their cadence, and cancels any
// still-pending or approved messages so nothing further goes out.
//
// Unknown tokens return {ok:true, unsubscribed:false} rather than an error, so the
// endpoint never confirms or denies whether a token exists.
export default async function unsubscribe(ctx, { db }) {
    const token = String(ctx.body?.t || '').trim();
    if (!token) return { error: 'Missing unsubscribe token.' };

    const contact = await db.findOne('contacts', { unsub_token: token });
    if (!contact) return { ok: true, unsubscribed: false };

    await db.query(
        `UPDATE contacts SET status='unsubscribed', cadence='paused', next_contact_at=NULL, updated_at=NOW()
         WHERE short_guid=$1`,
        [contact.short_guid]);
    await db.query(
        `UPDATE messages SET status='rejected', reject_reason='unsubscribed'
         WHERE contact_guid=$1 AND status IN ('draft','pending_approval','revising','approved','sending')`,
        [contact.short_guid]);

    return { ok: true, unsubscribed: true };
}
