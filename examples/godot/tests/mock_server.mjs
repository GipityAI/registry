// A stand-in for the Gipity API, just enough to drive the addon's tests.
import http from 'node:http';

// Like the server's display-name filter, reduced to one word for tests.
const rejectedName = (name) => typeof name === 'string' && /darn/i.test(name);
const nameRejected = { error: { code: 'DISPLAY_NAME_REJECTED', message: 'That display name is not allowed. Please choose another.' } };

// The leaderboard kit's semver check, reduced to major.minor.patch.
const parseVersion = (v) => { const m = /^v?(\d+)(?:\.(\d+))?(?:\.(\d+))?(?:-[0-9A-Za-z.-]+)?$/.exec(String(v).trim()); return m ? [+m[1], +(m[2] || 0), +(m[3] || 0)] : null; };
const older = (a, b) => { for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] < b[i]; return false; };
const MIN_VERSIONS = { 'versioned:lap': '2.0.0' };
function versionRefusal(board, gameVersion) {
  const min = MIN_VERSIONS[board];
  if (!min) return null;
  if (gameVersion == null || String(gameVersion).trim() === '') return { code: 'GAME_VERSION_TOO_OLD', reason: `This board needs game version ${min} or newer; send gameVersion with the run.` };
  const v = parseVersion(gameVersion);
  if (!v) return { code: 'GAME_VERSION_INVALID', reason: `gameVersion '${gameVersion}' is not a version like 1.4.2.` };
  if (older(v, parseVersion(min))) return { code: 'GAME_VERSION_TOO_OLD', reason: `Game version ${gameVersion} is too old for this board; update to ${min} or newer.` };
  return null;
}

// Like the server's name folding for unique names, reduced to case and NFKC.
const nameKey = (name) => String(name).normalize('NFKC').trim().toLowerCase();
const STEAM_ID = '76561190000000001';

export function startMockServer() {
  const state = {
    calls: [], players: new Map(), identities: new Map(), tokens: new Map(), submissions: [],
    failNextAuthOn: new Set(), failNextDelete: false, uniqueNames: false, persona: 'Racer X',
  };
  let n = 0;
  const nameTaken = (name, exceptGuid) => state.uniqueNames && name != null
    && [...state.players.values()].some(p => p.guid !== exceptGuid && p.displayName != null && nameKey(p.displayName) === nameKey(name));
  const userOf = (p, isNew = false) => ({
    guid: p.guid, displayName: p.displayName, provider: p.provider, providerUserId: p.providerUserId, isNew, nameConflict: p.nameConflict,
  });
  const tokenFor = (p) => { const token = `tok_${p.guid}_${Math.random().toString(36).slice(2)}`; state.tokens.set(token, p.guid); return token; };
  // Like the server: a player without a name of their own takes the persona; a
  // taken persona gets a SteamID suffix and nameConflict instead of failing.
  const namePersona = (p) => {
    if (p.custom) { p.nameConflict = false; return; }
    const suffixed = `${state.persona} #${STEAM_ID.slice(-4)}`;
    if (!nameTaken(state.persona, p.guid)) { p.displayName = state.persona; p.nameConflict = false; }
    else { p.displayName = suffixed; p.nameConflict = true; }
  };
  const server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', c => { raw += c; });
    req.on('end', () => {
      const body = raw ? JSON.parse(raw) : null;
      const auth = (req.headers.authorization || '').replace('Bearer ', '');
      state.calls.push({ method: req.method, url: req.url, body, auth });
      const send = (code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)); };
      if (req.url === '/__last_call') {
        const last = [...state.calls].reverse().find(c => !c.url.startsWith('/__'));
        return send(200, last);
      }
      if (req.url === '/__control') {
        for (const f of body.failNextAuthOn || []) state.failNextAuthOn.add(f);
        if (body.failNextDelete) state.failNextDelete = true;
        if ('uniqueNames' in body) state.uniqueNames = body.uniqueNames;
        if ('persona' in body) state.persona = body.persona;
        // A player on another device who already has a name.
        if (body.addPlayer) {
          const guid = `u_other${++n}`;
          state.players.set(guid, { guid, displayName: body.addPlayer, custom: true, provider: 'guest', providerUserId: guid, nameConflict: false });
        }
        return send(200, { ok: true });
      }
      const url = new URL(req.url, 'http://mock');
      const m = url.pathname.match(/^\/api\/app_test(\/.*)$/);
      if (!m) return send(404, { error: { code: 'NOT_FOUND', message: 'no app' } });
      const path = m[1];
      const nameTakenError = { error: { code: 'DISPLAY_NAME_TAKEN', message: 'Another player already has that name. Please choose another.' } };
      if (path === '/auth/guest') {
        if (!body.deviceSecret || body.deviceSecret.length < 32) return send(400, { error: { code: 'VALIDATION', message: 'deviceSecret too short' } });
        if (rejectedName(body.displayName)) return send(400, nameRejected);
        const key = `guest:${body.deviceSecret}`;
        const existing = state.identities.get(key);
        if (existing) { const p = state.players.get(existing); return send(200, { data: { token: tokenFor(p), expiresIn: 86400, user: userOf(p) } }); }
        const name = body.displayName ? String(body.displayName).trim() : null;
        if (nameTaken(name)) return send(409, nameTakenError);
        const p = { guid: `u_test${++n}`, displayName: name, custom: !!name, provider: 'guest', providerUserId: body.deviceSecret, nameConflict: false };
        state.players.set(p.guid, p);
        state.identities.set(key, p.guid);
        return send(200, { data: { token: tokenFor(p), expiresIn: 86400, user: userOf(p, true) } });
      }
      if (path === '/auth/steam') {
        if (body.ticket !== 'deadbeef01') return send(401, { error: { code: 'UNAUTHORIZED', message: 'Steam sign-in failed: Invalid ticket' } });
        let p;
        let isNew = false;
        if (body.link) {
          p = state.players.get(state.tokens.get(auth));
          if (!p) return send(401, { error: { code: 'UNAUTHORIZED', message: 'no guest' } });
          // Like the server: the guest's player now answers to Steam.
          Object.assign(p, { provider: 'steam', providerUserId: STEAM_ID });
          state.identities.set(`steam:${STEAM_ID}`, p.guid);
        } else {
          p = state.players.get(state.identities.get(`steam:${STEAM_ID}`));
          if (!p) {
            isNew = true;
            p = { guid: `u_test${++n}`, displayName: null, custom: false, provider: 'steam', providerUserId: STEAM_ID, nameConflict: false };
            state.players.set(p.guid, p);
            state.identities.set(`steam:${STEAM_ID}`, p.guid);
          }
        }
        namePersona(p);
        return send(200, { data: { token: tokenFor(p), expiresIn: 86400, user: userOf(p, isNew) } });
      }
      const player = state.players.get(state.tokens.get(auth));
      if (path === '/auth/player/name-available' && req.method === 'GET') {
        const name = String(url.searchParams.get('name') || '').trim();
        if (auth && !player) return send(401, { error: { code: 'UNAUTHORIZED', message: 'That player token is not valid for this app.' } });
        if (rejectedName(name)) return send(400, nameRejected);
        const available = !nameTaken(name, player?.guid);
        const suggestions = available ? [] : [27, 418, 7031].map(d => `${name}${d}`).filter(s => !nameTaken(s));
        return send(200, { data: { name, available, uniqueNames: state.uniqueNames, suggestions } });
      }
      if (path === '/auth/player' && req.method === 'PATCH') {
        if (!player) return send(401, { error: { code: 'UNAUTHORIZED', message: 'Session expired' } });
        if (rejectedName(body.displayName)) return send(400, nameRejected);
        const name = body.displayName == null || String(body.displayName).trim() === '' ? null : String(body.displayName).trim();
        if (name === null && player.provider === 'steam') {
          // Clearing a Steam player's own name goes back to the persona.
          player.custom = false;
          namePersona(player);
        } else {
          if (nameTaken(name, player.guid)) return send(409, nameTakenError);
          Object.assign(player, { displayName: name, custom: name !== null, nameConflict: false });
        }
        return send(200, { data: { guid: player.guid, displayName: player.displayName, nameConflict: player.nameConflict } });
      }
      if (path === '/auth/player' && req.method === 'DELETE') {
        if (!player) return send(401, { error: { code: 'UNAUTHORIZED', message: 'Session expired' } });
        if (state.failNextDelete) {
          state.failNextDelete = false;
          return send(502, { error: { code: 'PLAYER_CLEANUP_FAILED', message: "The app could not erase this player's data (leaderboard-player-deleted failed), so the account was not deleted. Try again." } });
        }
        state.tokens.delete(auth);
        return send(200, { data: { deleted: true } });
      }
      const fn = path.match(/^\/fn\/(.+)$/);
      if (fn) {
        const name = decodeURIComponent(fn[1]);
        if (state.failNextAuthOn.has(name)) { state.failNextAuthOn.delete(name); state.tokens.delete(auth); }
        if (!state.tokens.get(auth)) return send(401, { error: { code: 'UNAUTHORIZED', message: 'Session expired' } });
        if (name === 'echo') return send(200, { data: { you: state.tokens.get(auth), got: body } });
        if (name === 'leaderboard-submit') {
          state.submissions.push(body);
          const refused = versionRefusal(body.board, body.gameVersion);
          if (refused) return send(200, { data: { accepted: false, ...refused } });
          if (body.score < 1000) return send(200, { data: { accepted: false, reason: 'score below minimum' } });
          return send(200, { data: { accepted: true, improved: { all: true, week: true }, personalBest: body.score, rank: 1, entryId: 'lbe_1' } });
        }
        if (name === 'leaderboard-read') {
          if (body.action === 'ghost') {
            const last = [...state.submissions].reverse().find(s => s.ghost);
            return send(200, { data: { entryId: body.entryId, ghost: last ? last.ghost : '', bytes: 0 } });
          }
          if (body.action === 'friends') return send(200, { data: { entries: [], echoIds: body.ids, provider: body.provider } });
          if (!body.board) return send(200, { data: { error: "'board' is required." } });
          return send(200, { data: { board: body.board, period: body.period || 'all', entries: [{ rank: 1, score: 31250, displayName: 'Racer X' }], total: 1 } });
        }
        return send(404, { error: { code: 'NOT_FOUND', message: `Function '${name}' not found` } });
      }
      return send(404, { error: { code: 'NOT_FOUND', message: 'no route' } });
    });
  });
  return new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve({ server, state, port: server.address().port })));
}
