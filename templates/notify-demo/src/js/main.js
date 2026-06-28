// Importing the kit defines <gipity-notify-button> and self-heals any existing
// subscription on load. Everything push-related is handled by the kit + platform.
import '@gipity/notify';

const statusEl = document.getElementById('status');
function setStatus(msg, isError) {
  statusEl.textContent = msg;
  statusEl.style.color = isError ? 'var(--error, #ef4444)' : '';
}

async function ping(to) {
  setStatus('Sending…');
  try {
    const message = document.getElementById('message').value;
    const res = await window.Gipity.fn('send-ping', { to, message });
    if (res.error) { setStatus(res.error, true); return; }
    if (res.sent > 0) setStatus(`Sent to ${res.sent} device${res.sent === 1 ? '' : 's'} — check your notifications.`);
    else setStatus('No devices yet — turn on notifications above first.', true);
  } catch (err) {
    setStatus(err?.message || 'Failed to send.', true);
  }
}

document.getElementById('ping-me').addEventListener('click', () => ping('self'));
document.getElementById('ping-all').addEventListener('click', () => ping('all'));
