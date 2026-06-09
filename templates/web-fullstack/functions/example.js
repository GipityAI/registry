// example.js - a minimal serverless function so the API is wired and deploys
// green out of the box. Replace it with your own functions.
//
// Called via: POST /api/{app}/fn/example
//   from the frontend:  await Gipity.fn('example')
// Declared `public` in gipity.yaml (no auth required).
//
// The (ctx, services) signature gives you everything a function needs:
//   ctx.body     parsed JSON request body
//   ctx.auth     { userId, userGuid, displayName, role } when auth is user/member
//   ctx.method   HTTP method (uppercase)
//   db           query your Gipity DB:  const { rows } = await db.query('SELECT NOW() AS now')
//   fetch        call allow-listed URLs (declare them under fetch_domains in gipity.yaml)
//   guid         generate a short id:   guid('item')  ->  'item-a1b2c3d4'
export default async function example(ctx) {
  return { ok: true };
}
