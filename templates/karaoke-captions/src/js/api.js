/**
 * Thin REST client for the karaoke app's serverless functions + presigned
 * upload flow. APP_GUID is substituted at install time by `installTemplate`
 * (or at `gipity init` time by the CLI's substituteDir helper). Falls back to
 * window.GIPITY_APP_GUID if some other code path injects it.
 */

export const APP_GUID = window.GIPITY_APP_GUID || '{{PROJECT_GUID}}';
const API_BASE = 'https://a.gipity.ai';

export async function callFn(name, body, method = 'POST') {
  const url = `${API_BASE}/api/${APP_GUID}/fn/${name}`;
  const res = await fetch(url, {
    method,
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: method === 'GET' ? undefined : JSON.stringify(body || {}),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = (json.error && (json.error.message || json.error)) || `HTTP ${res.status}`;
    throw new Error(`${name}: ${msg}`);
  }
  return json.data ?? json;
}

/** Two-step presigned upload — kicks off init, PUTs to S3, calls complete.
 *  Returns the public CDN URL of the uploaded file. */
export async function uploadAudio(file, onProgressMsg) {
  if (onProgressMsg) onProgressMsg('Uploading audio…');
  const initRes = await fetch(`${API_BASE}/api/${APP_GUID}/uploads/init`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      filename: file.name,
      content_type: file.type || 'audio/mpeg',
      size: file.size,
      public: true,
    }),
  });
  if (!initRes.ok) throw new Error(`upload init: HTTP ${initRes.status}`);
  const { data: init } = await initRes.json();

  const putRes = await fetch(init.url, {
    method: 'PUT',
    headers: { 'Content-Type': file.type || 'audio/mpeg' },
    body: file,
  });
  if (!putRes.ok) throw new Error(`S3 PUT: HTTP ${putRes.status}`);

  const completeRes = await fetch(`${API_BASE}/api/${APP_GUID}/uploads/complete`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ upload_guid: init.upload_guid }),
  });
  if (!completeRes.ok) throw new Error(`upload complete: HTTP ${completeRes.status}`);
  const { data: completed } = await completeRes.json();
  return completed.url;
}

export function bundledSampleUrl() {
  return new URL('./assets/sample.mp3', window.location.href).toString();
}
