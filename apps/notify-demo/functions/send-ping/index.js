// send-ping - send a web push notification using Gipity Notify.
//
// Declares `services: ['notify']` in gipity.yaml, which injects the `notify()`
// capability. The platform encrypts + signs + delivers and bills the owner one
// flat credit per send. No keys, no crypto, no fetch_domains.
//
// Called from the browser as: await Gipity.fn('send-ping', { to: 'self' | 'all', message })
export default async function sendPing(ctx, { notify }) {
  const me = ctx.auth?.userGuid;
  if (!me) return { error: 'Sign in first to receive a notification.' };

  const to = ctx.body?.to === 'all' ? 'all' : me;
  const message = (typeof ctx.body?.message === 'string' && ctx.body.message.trim())
    ? ctx.body.message.trim()
    : 'Hello from your app 👋';

  const result = await notify({
    to,
    notification: { title: 'Ping!', body: message, url: '/' },
  });

  return { ok: true, ...result };
}
