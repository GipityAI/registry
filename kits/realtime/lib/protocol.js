/**
 * @gipity/realtime - Protocol (pure functions)
 *
 * Dependency-free helpers: quantization, host evaluation, chunk split /
 * assembly, drift math. No browser, networking, or engine code - safe to
 * unit-test from Node (see ../tests/protocol.test.js).
 */

// --- Quantization ---

export function quantize(value, precision) {
  return Math.round(value / precision) * precision;
}

export function quantizeVec3(v, p) {
  return { x: quantize(v.x, p), y: quantize(v.y, p), z: quantize(v.z, p) };
}

export function quantizeQuat(q, p) {
  return { x: quantize(q.x, p), y: quantize(q.y, p), z: quantize(q.z, p), w: quantize(q.w, p) };
}

// --- Host evaluation ---
// Deterministic alphabetical-sort tiebreaker used when the 3-phase claim
// election falls back to a fast resolve.

export function evaluateHost(myId, remoteIds) {
  const allIds = [myId, ...remoteIds].sort();
  const isHost = allIds[0] === myId;
  const playerNumber = allIds.indexOf(myId) + 1;
  return { isHost, playerNumber, totalPlayers: allIds.length };
}

// --- Chunking ---
// Rows are opaque arrays produced by an adapter. The protocol only splits
// and reassembles them; it never inspects their contents.

export function chunkInit(rows, chunkSize) {
  const totalChunks = Math.max(1, Math.ceil(rows.length / chunkSize));
  const chunks = [];
  for (let i = 0; i < rows.length; i += chunkSize) {
    chunks.push({
      kind: 'init',
      chunk: Math.floor(i / chunkSize),
      totalChunks,
      total: rows.length,
      rows: rows.slice(i, i + chunkSize),
    });
  }
  if (chunks.length === 0) {
    chunks.push({ kind: 'init', chunk: 0, totalChunks: 1, total: 0, rows: [] });
  }
  return chunks;
}

export function assembleChunks(chunkData, accumulator) {
  accumulator.set(chunkData.chunk, chunkData.rows);
  if (accumulator.size === chunkData.totalChunks) {
    const allRows = [];
    for (let i = 0; i < chunkData.totalChunks; i++) allRows.push(...accumulator.get(i));
    accumulator.clear();
    return allRows;
  }
  return null;
}

// --- Drift ---

export function computeDrift(a, b) {
  const dx = a.x - b.x, dy = a.y - b.y, dz = a.z - b.z;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}
