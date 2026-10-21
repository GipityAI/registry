// send-ping - send a web push notification using Gipity Notify.
//
// Declares `services: ['notify']` in gipity.yaml, which injects the `notify()`
// capability. The platform encrypts + signs + delivers and bills the owner one
// flat credit per send. No keys, no crypto, no fetch_domains.
//
// Called from the browser as: await Gipity.fn('send-ping', { to: 'self' | 'all', message })
//
// `auth: user` means the platform rejects signed-out callers before this runs,
// so ctx.auth.userGuid is always set here. Broadcasting (`to: 'all'`) pushes to
// every subscriber on the owner's credits, so it is limited to the owner and
// project members: ctx.auth.role is null for any other signed-in user.
export default async function sendPing(ctx, { notify }) {
  const broadcast = ctx.body?.to === 'all';
  if (broadcast && !ctx.auth.role) {
    return { error: 'Only the app owner or a project member can ping everyone.' };
  }
  const to = broadcast ? 'all' : ctx.auth.userGuid;
  const message = (typeof ctx.body?.message === 'string' && ctx.body.message.trim())
    ? ctx.body.message.trim()
    : 'Hello from your app 👋';

  const result = await notify({
    to,
    notification: { title: 'Ping!', body: message, url: '/' },
  });

  return { ok: true, ...result };
}
