// servicenow kit - shared ServiceNow Table API client.
//
// `secrets` and `env` are ambient globals inside every function's isolate, so
// this pure helper reads them directly. `fetch` is NOT ambient - it's injected
// per invocation based on the calling function's declared permissions, so
// every exported call here takes it as an explicit parameter from the entry.
//
// No URLSearchParams/Buffer here (isolated-vm has no Node/browser globals
// beyond what's explicitly injected) - form bodies and query strings are
// built with plain string concatenation + encodeURIComponent.

// Best-effort token cache: correctness never depends on this hitting - a cold
// isolate just means one extra token fetch. `expiresAt` includes a 60s buffer
// so a token doesn't expire mid-request.
let cachedToken = null;

async function requireConfig() {
  const [instanceUrl, clientId, clientSecret] = await Promise.all([
    secrets.get('SERVICENOW_INSTANCE_URL'),
    secrets.get('SERVICENOW_CLIENT_ID'),
    secrets.get('SERVICENOW_CLIENT_SECRET'),
  ]);
  if (!instanceUrl || !clientId || !clientSecret) {
    throw new Error(
      'ServiceNow is not configured. Set SERVICENOW_INSTANCE_URL, SERVICENOW_CLIENT_ID, ' +
      'SERVICENOW_CLIENT_SECRET via `gipity secrets set` (see the servicenow kit README).',
    );
  }
  return { instanceUrl: instanceUrl.replace(/\/+$/, ''), clientId, clientSecret };
}

function encodeForm(fields) {
  return Object.entries(fields)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join('&');
}

export async function getAccessToken(fetch) {
  if (cachedToken && cachedToken.expiresAt > Date.now()) return cachedToken.value;

  const { instanceUrl, clientId, clientSecret } = await requireConfig();
  const res = await fetch(`${instanceUrl}/oauth_token.do`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: encodeForm({ grant_type: 'client_credentials', client_id: clientId, client_secret: clientSecret }),
  });
  if (!res.ok) {
    // The most common cause of a bare 401 here: the instance has never enabled
    // inbound client_credentials at all (off by default on every instance we've
    // tested). ServiceNow's own system log shows a misleading PKCE error for
    // this case, so surface the real fix instead of a generic HTTP status.
    const hint = res.status === 401
      ? ' If this instance has never used client_credentials before, check that '
        + "System Properties has glide.oauth.inbound.client.credential.grant_type.enabled = true "
        + '(see this kit\'s README, "Setup" step 1).'
      : '';
    throw new Error(`ServiceNow OAuth token request failed: HTTP ${res.status}.${hint}`);
  }
  const data = await res.json();
  if (!data.access_token) throw new Error('ServiceNow OAuth response had no access_token.');

  const ttlSeconds = Number(data.expires_in) || 1800;
  cachedToken = { value: data.access_token, expiresAt: Date.now() + Math.max(ttlSeconds - 60, 30) * 1000 };
  return cachedToken.value;
}

async function authedFetch(fetch, path, opts = {}) {
  const { instanceUrl } = await requireConfig();
  const token = await getAccessToken(fetch);
  const res = await fetch(`${instanceUrl}${path}`, {
    ...opts,
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json', 'Content-Type': 'application/json', ...opts.headers },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`ServiceNow Table API HTTP ${res.status}: ${body.slice(0, 300)}`);
  }
  return res.json();
}

/** Rows changed since `sinceIso` (or all rows on first sync), oldest first. */
export async function tableQuery(fetch, table, { sinceIso, limit = 200 } = {}) {
  const query = sinceIso ? `sys_updated_on>${sinceIso}^ORDERBYsys_updated_on` : 'ORDERBYsys_updated_on';
  const path = `/api/now/table/${encodeURIComponent(table)}` +
    `?sysparm_query=${encodeURIComponent(query)}` +
    `&sysparm_limit=${encodeURIComponent(String(limit))}` +
    `&sysparm_exclude_reference_link=true`;
  const data = await authedFetch(fetch, path);
  return data.result ?? [];
}

/** Create (no sysId) or update (sysId given) a record; returns the resulting row. */
export async function tableWrite(fetch, table, sysId, fields) {
  const path = `/api/now/table/${encodeURIComponent(table)}${sysId ? `/${encodeURIComponent(sysId)}` : ''}`;
  const data = await authedFetch(fetch, path, {
    method: sysId ? 'PATCH' : 'POST',
    body: JSON.stringify(fields),
  });
  return data.result;
}
