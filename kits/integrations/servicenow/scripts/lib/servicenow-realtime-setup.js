// servicenow kit - pure, fetch-injected ServiceNow-side REALTIME setup logic
// for scripts/connect-realtime.mjs. Companion to scripts/lib/servicenow-setup.js
// (Phase 1's OAuth/pull setup) - imports its basicAuthHeader/testAuth/getUserSysId
// rather than duplicating them. Same rules as that module: everything takes
// `fetch` and a pre-built auth header as arguments, so it's unit-testable
// with a mock fetch.

const SCRIPT_INCLUDE_NAME = 'GipitySync';

/** The Script Include's script body. Written in ServiceNow's conservative
 *  ES5-style scripting dialect (Business Rules/Script Includes run in
 *  ServiceNow's own server-side JS engine, not Node) - live-verified against
 *  a real PDI, including the outbound sn_ws.RESTMessageV2 call, the
 *  async_always business rule timing, and the loop-prevention condition. */
export const SCRIPT_INCLUDE_BODY = `var ${SCRIPT_INCLUDE_NAME} = Class.create();
${SCRIPT_INCLUDE_NAME}.prototype = {
    initialize: function() {},

    pushRecord: function(gr) {
        var webhookUrl = gs.getProperty('gipity.webhook.url');
        var webhookSecret = gs.getProperty('gipity.webhook.secret');
        if (!webhookUrl || !webhookSecret) {
            gs.error('${SCRIPT_INCLUDE_NAME}: gipity.webhook.url or gipity.webhook.secret not set - skipping push for ' + gr.getTableName() + ' ' + gr.getUniqueValue());
            return;
        }

        // The shared secret travels inside the JSON body, not a header -
        // Gipity's function runtime only forwards a small header allowlist to
        // function code, so a custom header here would be silently dropped.
        var record = {};
        var fields = gr.getFields();
        for (var i = 0; i < fields.size(); i++) {
            var name = fields.get(i).getName();
            record[name] = '' + gr.getValue(name);
        }
        record.sys_table = gr.getTableName();

        try {
            var request = new sn_ws.RESTMessageV2();
            request.setEndpoint(webhookUrl);
            request.setHttpMethod('POST');
            request.setRequestHeader('Content-Type', 'application/json');
            request.setRequestBody(JSON.stringify({ secret: webhookSecret, record: record }));
            var response = request.execute();
            var status = response.getStatusCode();
            if (status < 200 || status >= 300) {
                gs.error('${SCRIPT_INCLUDE_NAME}: webhook push failed (' + status + ') for ' + gr.getTableName() + ' ' + gr.getUniqueValue() + ': ' + response.getBody());
            }
        } catch (ex) {
            gs.error('${SCRIPT_INCLUDE_NAME}: webhook push threw: ' + ex.getMessage());
        }
    },

    type: '${SCRIPT_INCLUDE_NAME}'
};`;

async function findByName(fetch, instanceUrl, auth, table, name) {
  const res = await fetch(
    `${instanceUrl}/api/now/table/${table}?sysparm_query=name=${encodeURIComponent(name)}&sysparm_fields=sys_id`,
    { headers: { Authorization: auth, Accept: 'application/json' } },
  );
  if (!res.ok) throw new Error(`Could not check for an existing ${table} named '${name}': HTTP ${res.status}`);
  const data = await res.json();
  return data.result?.[0] ?? null;
}

async function findPropertyByName(fetch, instanceUrl, auth, name) {
  const res = await fetch(
    `${instanceUrl}/api/now/table/sys_properties?sysparm_query=name=${encodeURIComponent(name)}&sysparm_fields=sys_id`,
    { headers: { Authorization: auth, Accept: 'application/json' } },
  );
  if (!res.ok) throw new Error(`Could not read system property '${name}': HTTP ${res.status}`);
  const data = await res.json();
  return data.result?.[0] ?? null;
}

/** Idempotent create-or-update of a single system property by name (always
 *  set to `value`, unlike Phase 1's ensureGrantTypeProperty which is a no-op
 *  once true - these two rotate freely on every setup run). */
async function ensureProperty(fetch, instanceUrl, auth, { name, value, description }) {
  const existing = await findPropertyByName(fetch, instanceUrl, auth, name);
  if (existing) {
    const res = await fetch(`${instanceUrl}/api/now/table/sys_properties/${existing.sys_id}`, {
      method: 'PATCH',
      headers: { Authorization: auth, 'Content-Type': 'application/json' },
      body: JSON.stringify({ value }),
    });
    if (!res.ok) throw new Error(`Could not update system property '${name}': HTTP ${res.status}`);
    return 'updated';
  }
  const res = await fetch(`${instanceUrl}/api/now/table/sys_properties`, {
    method: 'POST',
    headers: { Authorization: auth, 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, value, type: 'string', description }),
  });
  if (!res.ok) throw new Error(`Could not create system property '${name}': HTTP ${res.status}`);
  return 'created';
}

/** Sets both gipity.webhook.url and gipity.webhook.secret. */
export async function ensureWebhookProperties(fetch, instanceUrl, auth, { webhookUrl, webhookSecret }) {
  const url = await ensureProperty(fetch, instanceUrl, auth, {
    name: 'gipity.webhook.url', value: webhookUrl,
    description: 'Gipity ServiceNow kit - the sn-webhook function URL that GipitySync pushes changed records to.',
  });
  const secret = await ensureProperty(fetch, instanceUrl, auth, {
    name: 'gipity.webhook.secret', value: webhookSecret,
    description: 'Gipity ServiceNow kit - shared secret verified by sn-webhook. Matches the SERVICENOW_WEBHOOK_SECRET Gipity secret.',
  });
  return { url, secret };
}

/** Idempotent create-or-update of the GipitySync Script Include. */
export async function ensureScriptInclude(fetch, instanceUrl, auth) {
  const existing = await findByName(fetch, instanceUrl, auth, 'sys_script_include', SCRIPT_INCLUDE_NAME);
  const payload = {
    name: SCRIPT_INCLUDE_NAME, api_name: `global.${SCRIPT_INCLUDE_NAME}`, script: SCRIPT_INCLUDE_BODY,
    client_callable: 'false', access: 'public', active: 'true',
    description: 'Gipity ServiceNow kit - pushes a changed record to the Gipity webhook. See registry/kits/integrations/servicenow.',
  };
  if (existing) {
    const res = await fetch(`${instanceUrl}/api/now/table/sys_script_include/${existing.sys_id}`, {
      method: 'PATCH', headers: { Authorization: auth, 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
    });
    if (!res.ok) throw new Error(`Could not update the ${SCRIPT_INCLUDE_NAME} Script Include: HTTP ${res.status}`);
    return 'updated';
  }
  const res = await fetch(`${instanceUrl}/api/now/table/sys_script_include`, {
    method: 'POST', headers: { Authorization: auth, 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(`Could not create the ${SCRIPT_INCLUDE_NAME} Script Include: HTTP ${res.status}`);
  return 'created';
}

/** Idempotent create-or-update of a Business Rule for one table, wired to
 *  push via GipitySync. The condition is the loop-prevention mechanism: a
 *  change made BY the integration user (the same one sn-write authenticates
 *  as) is never pushed back to Gipity - live-verified both directions.
 *  `when: async_always` so the outbound HTTP call never blocks the
 *  triggering user's save (the deprecated plain `async` value is a trap -
 *  ServiceNow's own choice list flags it "not run during upgrade"). Deletes
 *  are out of scope, same as Phase 1's pull - sn_records has no tombstone
 *  concept yet. */
export async function ensureBusinessRule(fetch, instanceUrl, auth, { table, integrationUsername }) {
  const name = `Gipity Sync - ${table}`;
  const existing = await findByName(fetch, instanceUrl, auth, 'sys_script', name);
  const escapedUser = integrationUsername.replace(/'/g, "\\'");
  const payload = {
    name, collection: table, when: 'async_always',
    action_insert: 'true', action_update: 'true', action_delete: 'false',
    active: 'true', advanced: 'true',
    condition: `gs.getUserName() != '${escapedUser}'`,
    script: `(function executeRule(current, previous /*null when async*/) {\n\n\tnew ${SCRIPT_INCLUDE_NAME}().pushRecord(current);\n\n})(current, previous);`,
  };
  if (existing) {
    const res = await fetch(`${instanceUrl}/api/now/table/sys_script/${existing.sys_id}`, {
      method: 'PATCH', headers: { Authorization: auth, 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
    });
    if (!res.ok) throw new Error(`Could not update the '${name}' Business Rule: HTTP ${res.status}`);
    return 'updated';
  }
  const res = await fetch(`${instanceUrl}/api/now/table/sys_script`, {
    method: 'POST', headers: { Authorization: auth, 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(`Could not create the '${name}' Business Rule: HTTP ${res.status}`);
  return 'created';
}
