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

export function startMockServer() {
  const state = { calls: [], players: new Map(), tokens: new Map(), submissions: [], failNextAuthOn: new Set(), failNextDelete: false };
  let n = 0;
  const issue = (provider, id, name) => {
    const key = `${provider}:${id}`;
    let p = state.players.get(key);
    if (!p) { p = { guid: `u_test${++n}`, displayName: name || null, provider, providerUserId: id, isNew: true }; state.players.set(key, p); }
    else p = { ...p, isNew: false };
    const token = `tok_${n}_${Math.random().toString(36).slice(2)}`;
    state.tokens.set(token, p);
    return { token, expiresIn: 86400, user: p };
  };
  const server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', c => { raw += c; });
    req.on('end', () => {
      const body = raw ? JSON.parse(raw) : null;
      const auth = (req.headers.authorization || '').replace('Bearer ', '');
      state.calls.push({ method: req.method, url: req.url, body, auth });
      const send = (code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)); };
      if (req.url === '/__control') {
        for (const f of body.failNextAuthOn || []) state.failNextAuthOn.add(f);
        if (body.failNextDelete) state.failNextDelete = true;
        return send(200, { ok: true });
      }
      const m = req.url.match(/^\/api\/app_test(\/.*)$/);
      if (!m) return send(404, { error: { code: 'NOT_FOUND', message: 'no app' } });
      const path = m[1];
      if (path === '/auth/guest') {
        if (!body.deviceSecret || body.deviceSecret.length < 32) return send(400, { error: { code: 'VALIDATION', message: 'deviceSecret too short' } });
        if (rejectedName(body.displayName)) return send(400, nameRejected);
        return send(200, { data: issue('guest', body.deviceSecret, body.displayName) });
      }
      if (path === '/auth/steam') {
        if (body.ticket !== 'deadbeef01') return send(401, { error: { code: 'UNAUTHORIZED', message: 'Steam sign-in failed: Invalid ticket' } });
        if (body.link) {
          const guest = state.tokens.get(auth);
          if (!guest) return send(401, { error: { code: 'UNAUTHORIZED', message: 'no guest' } });
          // Like the server: the guest's player now answers to Steam, with the persona name.
          const p = { ...guest, displayName: 'Racer X', provider: 'steam', providerUserId: '76561190000000001', isNew: false };
          state.players.set('steam:76561190000000001', p);
          const token = `tok_linked_${Math.random().toString(36).slice(2)}`;
          state.tokens.set(token, p);
          return send(200, { data: { token, expiresIn: 86400, user: p } });
        }
        return send(200, { data: issue('steam', '76561190000000001', 'Racer X') });
      }
      const player = state.tokens.get(auth);
      if (path === '/auth/player' && req.method === 'PATCH') {
        if (!player) return send(401, { error: { code: 'UNAUTHORIZED', message: 'Session expired' } });
        if (player.provider === 'steam') return send(409, { error: { code: 'CONFLICT', message: 'This player signs in with Steam, so their name is their Steam name. Change it on Steam.' } });
        if (rejectedName(body.displayName)) return send(400, nameRejected);
        const name = body.displayName == null || String(body.displayName).trim() === '' ? null : String(body.displayName).trim();
        // Every stored copy of the player (sign-in record and live tokens) takes the new name.
        for (const p of [...state.players.values(), ...state.tokens.values()]) if (p.guid === player.guid) p.displayName = name;
        return send(200, { data: { guid: player.guid, displayName: name } });
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
        if (name === 'echo') return send(200, { data: { you: state.tokens.get(auth).guid, got: body } });
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
