// servicenow kit - pure, fetch-injected ServiceNow-side setup logic for
// scripts/connect.mjs. Runs in plain Node (real fetch, real crypto) - NOT the
// deployed function sandbox, so this is deliberately separate from
// functions/_lib/servicenow-client.js (which runs inside the isolated-vm
// runtime with ambient secrets/env globals and an injected fetch).
//
// Every function here takes `fetch` and a pre-built Basic Auth header as
// arguments so the whole module is unit-testable with a mock fetch, exactly
// like functions/_lib/servicenow-client.js's own test.

export function basicAuthHeader(username, password) {
  return 'Basic ' + Buffer.from(`${username}:${password}`).toString('base64');
}

/** Confirms the given credentials actually authenticate against the Table API.
 *  A bare 401 here is the single most common failure mode we've hit testing
 *  this kit - the built-in `admin` account can be rejected by the Table API
 *  even when the exact same credentials work fine in the browser UI. */
export async function testAuth(fetch, instanceUrl, username, password) {
  const res = await fetch(`${instanceUrl}/api/now/table/sys_user?sysparm_limit=1&sysparm_fields=sys_id`, {
    headers: { Authorization: basicAuthHeader(username, password), Accept: 'application/json' },
  });
  if (res.status === 401) {
    throw new Error(
      `ServiceNow rejected '${username}' (HTTP 401 on the Table API). If this is the built-in "admin" `
      + 'account, note that some instances reject it via the Table API even when the same credentials '
      + 'work fine logging into the browser UI - create a dedicated service account instead and retry '
      + 'with that (see the kit README, setup step 1).',
    );
  }
  if (!res.ok) throw new Error(`ServiceNow auth check failed: HTTP ${res.status}`);
}

/** Looks up the sys_id for a username - needed to link the OAuth application
 *  to a specific ServiceNow identity. */
export async function getUserSysId(fetch, instanceUrl, auth, username) {
  const res = await fetch(
    `${instanceUrl}/api/now/table/sys_user?sysparm_query=user_name=${encodeURIComponent(username)}&sysparm_fields=sys_id,active`,
    { headers: { Authorization: auth, Accept: 'application/json' } },
  );
  if (!res.ok) throw new Error(`Could not look up ServiceNow user '${username}': HTTP ${res.status}`);
  const data = await res.json();
  const user = data.result?.[0];
  if (!user) throw new Error(`No ServiceNow user found with user_name '${username}'.`);
  if (user.active !== 'true') throw new Error(`ServiceNow user '${username}' exists but is not active.`);
  return user.sys_id;
}

const GRANT_PROPERTY = 'glide.oauth.inbound.client.credential.grant_type.enabled';

/** Ensures the property that silently gates the entire client_credentials
 *  grant is present and true. Off by default on every instance we've tested;
 *  without it every token request fails with a bare 401 and the system log
 *  shows an unrelated-looking PKCE error. Idempotent. */
export async function ensureGrantTypeProperty(fetch, instanceUrl, auth) {
  const getRes = await fetch(
    `${instanceUrl}/api/now/table/sys_properties?sysparm_query=name=${GRANT_PROPERTY}&sysparm_fields=sys_id,value`,
    { headers: { Authorization: auth, Accept: 'application/json' } },
  );
  if (!getRes.ok) {
    throw new Error(`Could not read system properties: HTTP ${getRes.status}. The service account may need the admin role.`);
  }
  const data = await getRes.json();
  const existing = data.result?.[0];
  if (existing?.value === 'true') return 'already-enabled';

  if (existing) {
    const patchRes = await fetch(`${instanceUrl}/api/now/table/sys_properties/${existing.sys_id}`, {
      method: 'PATCH',
      headers: { Authorization: auth, 'Content-Type': 'application/json' },
      body: JSON.stringify({ value: 'true' }),
    });
    if (!patchRes.ok) throw new Error(`Could not enable ${GRANT_PROPERTY}: HTTP ${patchRes.status}`);
    return 'enabled-existing';
  }

  const createRes = await fetch(`${instanceUrl}/api/now/table/sys_properties`, {
    method: 'POST',
    headers: { Authorization: auth, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: GRANT_PROPERTY,
      value: 'true',
      type: 'boolean',
      description: 'Enables the OAuth inbound Client Credentials grant type for external clients (set by the Gipity ServiceNow kit setup script).',
    }),
  });
  if (!createRes.ok) {
    throw new Error(`Could not create ${GRANT_PROPERTY}: HTTP ${createRes.status}. The service account may need the admin role.`);
  }
  return 'created';
}

async function findExistingEntity(fetch, instanceUrl, auth, name) {
  const res = await fetch(
    `${instanceUrl}/api/now/table/oauth_entity?sysparm_query=name=${encodeURIComponent(name)}&sysparm_fields=sys_id`,
    { headers: { Authorization: auth, Accept: 'application/json' } },
  );
  if (!res.ok) throw new Error(`Could not check for an existing OAuth application: HTTP ${res.status}`);
  const data = await res.json();
  return data.result?.[0] ?? null;
}

/** Creates (or fully rotates, if one with this name already exists) the OAuth
 *  Application + its companion Entity Profile. The profile is easy to miss by
 *  hand - every working client_credentials entity on the instances we've
 *  inspected has one, and without it the grant fails the same misleading way
 *  as the missing system property. Re-running this is always safe: a second
 *  run finds the existing entity by name and rotates client_id/client_secret
 *  on it rather than creating a duplicate. */
export async function createOrUpdateOAuthEntity(fetch, instanceUrl, auth, { name, clientId, clientSecret, userSysId }) {
  const existing = await findExistingEntity(fetch, instanceUrl, auth, name);
  const payload = {
    name, client_id: clientId, client_secret: clientSecret, type: 'client',
    default_grant_type: 'client_credentials', send_client_credentials_as: 'request_body_parameter',
    active: 'true', public_client: 'false', use_pkce: 'false', code_challenge_method: '',
    user: userSysId, token_format: 'opaque',
  };

  if (existing) {
    const res = await fetch(`${instanceUrl}/api/now/table/oauth_entity/${existing.sys_id}`, {
      method: 'PATCH',
      headers: { Authorization: auth, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!res.ok) throw new Error(`Could not update the existing OAuth application '${name}': HTTP ${res.status}`);
    return { reused: true };
  }

  const res = await fetch(`${instanceUrl}/api/now/table/oauth_entity`, {
    method: 'POST',
    headers: { Authorization: auth, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(`Could not create the OAuth application '${name}': HTTP ${res.status}`);
  const data = await res.json();

  const profileRes = await fetch(`${instanceUrl}/api/now/table/oauth_entity_profile`, {
    method: 'POST',
    headers: { Authorization: auth, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: `${name} default_profile`, oauth_entity: data.result.sys_id,
      grant_type: 'client_credentials', default: 'true',
    }),
  });
  if (!profileRes.ok) {
    throw new Error(
      `Created the OAuth application but could not create its entity profile: HTTP ${profileRes.status}. `
      + 'Without this profile, client_credentials will fail with a misleading PKCE error - re-run this script to retry.',
    );
  }
  return { reused: false };
}

/** The real proof this all worked: exchange for a token, then use it against
 *  the Table API. Never declare success on record creation alone - that's
 *  exactly the gap that cost the most time tracing this integration by hand. */
export async function verifyClientCredentials(fetch, instanceUrl, clientId, clientSecret) {
  const body = [
    'grant_type=client_credentials',
    `client_id=${encodeURIComponent(clientId)}`,
    `client_secret=${encodeURIComponent(clientSecret)}`,
  ].join('&');
  const tokenRes = await fetch(`${instanceUrl}/oauth_token.do`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  if (!tokenRes.ok) {
    throw new Error(
      `Token exchange verification failed: HTTP ${tokenRes.status}. If `
      + `${GRANT_PROPERTY} was just enabled, some instances take a minute to propagate it - `
      + 'wait a moment and re-run this script (it is safe to re-run).',
    );
  }
  const tokenData = await tokenRes.json();
  if (!tokenData.access_token) throw new Error('Token exchange returned no access_token.');

  const verifyRes = await fetch(`${instanceUrl}/api/now/table/sys_user?sysparm_limit=1`, {
    headers: { Authorization: `Bearer ${tokenData.access_token}`, Accept: 'application/json' },
  });
  if (!verifyRes.ok) throw new Error(`Got a token but it was rejected by the Table API: HTTP ${verifyRes.status}`);
}
