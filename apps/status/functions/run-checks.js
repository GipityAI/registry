// Probe every component once and record the results. Runs every minute from
// workflows/checks.yaml; `auth: member`, so only the owner (or the workflow)
// can run it. A probe never throws: a failure is recorded as a down check.
import { COMPONENTS, STORAGE_PROBE_SOURCE, classifyCheck } from './_lib/status.js';

export default async function (ctx, { db, fetch, storage, guid }) {
  const results = await Promise.all(COMPONENTS.map(c => probe(c, { db, fetch, storage, ctx })));

  const values = [];
  const params = [];
  for (const r of results) {
    const base = params.length;
    params.push(guid('chk'), r.component, r.state, r.latency_ms, r.http_status, r.error);
    values.push(`($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6})`);
  }
  await db.query(
    `INSERT INTO status_checks (short_guid, component, state, latency_ms, http_status, error) VALUES ${values.join(', ')}`,
    params,
  );
  return { checked: results.length, results };
}

async function probe(component, services) {
  let started = Date.now();
  let ok = false;
  let httpStatus = null;
  let error = null;
  try {
    if (component.kind === 'db') {
      await services.db.query('SELECT 1 AS ok');
      ok = true;
    } else if (component.kind === 'storage') {
      const fileGuid = await storageProbeFile(services);
      started = Date.now(); // time the read, not the one-time setup
      const text = await services.storage.read(fileGuid, { encoding: 'utf8' });
      ok = typeof text === 'string' && text.length > 0;
      if (!ok) error = 'probe file read back empty';
      if (services.ctx.isTest) await removeProbeFile(services, fileGuid);
    } else {
      const res = await services.fetch(component.url, { method: component.method || 'GET' });
      httpStatus = res.status;
      ok = res.ok;
      if (!ok) error = `HTTP ${res.status}`;
    }
  } catch (err) {
    error = String(err?.message || err).slice(0, 300);
  }
  const latencyMs = Date.now() - started;
  return {
    component: component.key,
    state: classifyCheck(component, { ok, latencyMs }),
    latency_ms: latencyMs,
    http_status: httpStatus,
    error,
  };
}

/**
 * This app's own probe file in Gipity Storage. The first run copies a tiny
 * public file in with storage.importUrl and remembers its guid in
 * status_settings, so the check needs no setup.
 */
async function storageProbeFile({ db, storage }) {
  const { rows } = await db.query("SELECT value FROM status_settings WHERE key = 'storage_probe'");
  if (rows[0]) return rows[0].value;
  const file = await storage.importUrl(STORAGE_PROBE_SOURCE, { filename: 'status-probe.html', path: 'status' });
  await db.query(
    "INSERT INTO status_settings (key, value) VALUES ('storage_probe', $1) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value",
    [file.guid],
  );
  return file.guid;
}

/** A test run's database is thrown away after the file, which would orphan
 *  its probe copy, so a test run removes it straight away. */
async function removeProbeFile({ db, storage }, fileGuid) {
  await storage.delete(fileGuid);
  await db.query("DELETE FROM status_settings WHERE key = 'storage_probe'");
}
