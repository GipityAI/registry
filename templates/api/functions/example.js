// example.js - a minimal public endpoint so the API deploys green out of the box.
// Replace it with your own functions.
//
// Called via: POST /api/{app}/fn/example
// Declared `public` in gipity.yaml (no auth required).
//
// The (ctx, services) signature gives you everything a function needs:
//   ctx.body     parsed JSON request body
//   ctx.auth     { userId, userGuid, displayName, role } when auth is user/member
//   ctx.method   HTTP method (uppercase)
//   db           query your Gipity DB (declare tables in gipity.yaml)
//   fetch        call allow-listed URLs (declare them under fetch_domains)
//   guid         generate a short id:  guid('item')  ->  'item-a1b2c3d4'
export default async function example(ctx) {
  return { ok: true };
}
