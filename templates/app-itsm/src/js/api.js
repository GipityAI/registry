// api.js - GipITSM API client using Gipity Records API, Functions, and Services

import config from './config.js';

// ---- Token Management ----

let appToken = '';
let tokenExpiry = 0;

/** Get or refresh the app token */
async function ensureToken() {
  if (appToken && Date.now() < tokenExpiry) return appToken;
  const res = await fetch(`${config.API_BASE}/api/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ app: config.APP_GUID }),
    credentials: 'include',
  });
  if (!res.ok) throw new Error('Failed to get app token');
  const data = await res.json();
  appToken = data.data.token;
  tokenExpiry = Date.now() + (data.data.expiresIn - 60) * 1000;
  return appToken;
}

/** Make an authenticated API request */
async function request(path, options = {}) {
  const token = await ensureToken();
  const url = `${config.API_BASE}/api/${config.APP_GUID}${path}`;
  const headers = {
    'X-App-Token': token,
    ...options.headers,
  };
  // Only set Content-Type for non-FormData bodies
  if (!(options.body instanceof FormData)) {
    headers['Content-Type'] = 'application/json';
  }

  const res = await fetch(url, { ...options, headers, credentials: 'include' });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    const err = new Error(body.error?.message || `API error ${res.status}`);
    err.status = res.status;
    err.body = body;
    throw err;
  }
  if (res.status === 204) return { data: [] };
  return res.json();
}

/** Extract rows array from API response (normalizes different shapes) */
function rows(result) {
  return result?.data || result?.rows || [];
}

// ---- Records API (GET/POST/PATCH/DELETE /records/:table) ----

export async function listRecords(table, params = {}) {
  const qs = new URLSearchParams();
  if (params.filter) qs.set('filter', params.filter);
  if (params.sort) qs.set('sort', params.sort);
  if (params.q) qs.set('q', params.q);
  if (params.limit != null) qs.set('limit', String(params.limit));
  if (params.offset != null) qs.set('offset', String(params.offset));
  const result = await request(`/records/${table}?${qs}`);
  return { data: rows(result), total: result.total ?? rows(result).length };
}

export async function getRecord(table, id) {
  const result = await request(`/records/${table}/${id}`);
  return { data: result.data || result };
}

export async function createRecord(table, fields) {
  return request(`/records/${table}`, {
    method: 'POST',
    body: JSON.stringify(fields),
  });
}

export async function updateRecord(table, id, fields) {
  return request(`/records/${table}/${id}`, {
    method: 'PUT',
    body: JSON.stringify(fields),
  });
}

export async function deleteRecord(table, id) {
  return request(`/records/${table}/${id}`, { method: 'DELETE' });
}

export async function aggregateRecords(table, params = {}) {
  const qs = new URLSearchParams();
  if (params.group_by) qs.set('group_by', params.group_by);
  if (params.aggregate) qs.set('aggregate', params.aggregate);
  if (params.filter) qs.set('filter', params.filter);
  const result = await request(`/records/${table}/aggregate?${qs}`);
  return { data: rows(result) };
}

// ---- Comments (uses Records API on comments table) ----

export async function listComments(targetTable, targetId) {
  return listRecords('comments', {
    filter: `target_table:eq:${targetTable},target_id:eq:${targetId}`,
    sort: 'created_at',
    limit: 200,
  });
}

export async function addComment(targetTable, targetId, body, commentType = 'comment') {
  return createRecord('comments', {
    target_table: targetTable,
    target_id: targetId,
    body,
    comment_type: commentType,
    author_user_id: 'current',
  });
}

// ---- Functions (POST /fn/:name) ----

export async function callFunction(name, params = {}) {
  return request(`/fn/${name}`, {
    method: 'POST',
    body: JSON.stringify(params),
  });
}

// ---- LLM Service (POST /services/llm) ----

export async function callLLM(prompt, options = {}) {
  return request('/services/llm', {
    method: 'POST',
    body: JSON.stringify({
      prompt,
      model: options.model || 'claude-haiku-4-5',
      max_tokens: options.maxTokens || 1024,
    }),
  });
}

// ---- File Upload (presigned S3) ----

export async function uploadFile(file, table = null, recordId = null, isPublic = false) {
  // Step 1: Init - get presigned URL
  const initBody = {
    filename: file.name,
    content_type: file.type || 'application/octet-stream',
    size: file.size,
  };
  if (table) initBody.table = table;
  if (recordId) initBody.record_id = String(recordId);
  if (isPublic) initBody.public = true;

  const init = await request('/uploads/init', {
    method: 'POST',
    body: JSON.stringify(initBody),
  });

  // Step 2: PUT directly to S3
  const putRes = await fetch(init.data.url, {
    method: 'PUT',
    headers: { 'Content-Type': file.type || 'application/octet-stream' },
    body: file,
  });
  if (!putRes.ok) throw new Error('S3 upload failed: ' + putRes.status);

  // Step 3: Complete
  return request('/uploads/complete', {
    method: 'POST',
    body: JSON.stringify({ upload_guid: init.data.upload_guid }),
  });
}

export async function listFiles(table, recordId) {
  const qs = new URLSearchParams();
  if (table) qs.set('table', table);
  if (recordId) qs.set('record_id', String(recordId));
  return request(`/files?${qs}`);
}

// ---- Auth ----

export async function getAuthStatus(permissions = 1) {
  const token = await ensureToken();
  const res = await fetch(
    `${config.API_BASE}/api/${config.APP_GUID}/auth/status?permissions=${permissions}`,
    { headers: { 'X-App-Token': token }, credentials: 'include' },
  );
  return res.json();
}

// ---- SSE (Server-Sent Events for live record updates) ----

export function subscribeSSE(table, onEvent) {
  const url = `${config.API_BASE}/api/${config.APP_GUID}/records/${table}/stream?token=${encodeURIComponent(appToken)}`;
  const es = new EventSource(url);
  es.onmessage = (e) => {
    try { onEvent(JSON.parse(e.data)); } catch (err) { console.error('SSE parse error:', err); }
  };
  es.onerror = () => { /* EventSource auto-reconnects */ };
  return { close: () => es.close() };
}

// ---- Search (KB full-text via Records API q param) ----

export async function searchKB(query) {
  return listRecords('knowledge_articles', {
    q: query,
    filter: 'state:eq:published',
    limit: 5,
  });
}

// ---- Settings ----

export async function getSettings() {
  return listRecords('app_settings', { limit: 100 });
}

export async function updateSetting(key, value) {
  return updateRecord('app_settings', key, { value: JSON.stringify(value) });
}
