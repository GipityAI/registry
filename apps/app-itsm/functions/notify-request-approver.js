// notify-request-approver.js - Tell the approver a service request is waiting
// Run by the "Request Approval" workflow when a request needing approval is
// created (auth: member). The approver is the fulfillment team's manager; they
// approve or reject it on the agent portal's Approvals page.

export default async function notifyRequestApprover(ctx, { db }) {
    const { request_id } = ctx.body;
    const { rows: [req] } = await db.query(
        `SELECT sr.id, sr.number, sr.requested_by_name, sr.quantity, sr.approval_state,
                ci.name AS item_name, t.manager_user_id
         FROM service_requests sr
         LEFT JOIN catalog_items ci ON ci.id = sr.catalog_item_id
         LEFT JOIN teams t ON t.id = ci.fulfillment_team_id
         WHERE sr.id = $1`,
        [request_id]
    );
    if (!req) return { error: 'Request not found' };
    if (req.approval_state !== 'pending') return { request_id, skipped: true, reason: 'Not awaiting approval' };
    if (!req.manager_user_id) return { request_id, notified: false, reason: 'No approver on the fulfillment team' };

    await db.query(
        `INSERT INTO notifications (user_id, title, body, link) VALUES ($1, $2, $3, '/agent/approvals')`,
        [
            req.manager_user_id,
            `Approval Required: ${req.number}`,
            `${req.requested_by_name || 'Someone'} requested ${req.item_name || 'a catalog item'} (qty: ${req.quantity}). Please review and approve or reject.`,
        ]
    );
    return { request_id, notified: true, approver: req.manager_user_id };
}
