/**
 * @gipity/chatbot: voice in and out, on Gipity Speech.
 *
 *   const rec = await startRecording();   // asks for the mic
 *   const text = await rec.stop();         // transcribed by the app's transcribe service
 *   const audio = await speak('Hello!', { voice });  // plays the app's tts service
 *
 * Both services must be enabled for the app (gipity.yaml `services` phase:
 * `transcribe` and `tts`, usually owner_pays for a public bot).
 */

/** Longest text one read-aloud call speaks (the tts service limit). */
export const SPEAK_MAX_CHARS = 5000;

function sdk() {
  if (!globalThis.Gipity?.service) throw new Error('chatbot voice: the Gipity client SDK is not on this page');
  return globalThis.Gipity;
}

/** Start recording from the microphone. Resolves to { stop(): Promise<text>, cancel() }. */
export async function startRecording() {
  if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
    throw new Error("This browser can't record audio.");
  }
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  const type = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg'].find(t => MediaRecorder.isTypeSupported(t)) || '';
  const recorder = new MediaRecorder(stream, type ? { mimeType: type } : undefined);
  const chunks = [];
  recorder.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
  recorder.start();
  const release = () => stream.getTracks().forEach(t => t.stop());

  return {
    async stop() {
      const done = new Promise((resolve) => { recorder.onstop = resolve; });
      recorder.stop();
      await done;
      release();
      const mime = recorder.mimeType || 'audio/webm';
      const ext = mime.includes('mp4') ? 'm4a' : mime.includes('ogg') ? 'ogg' : 'webm';
      const form = new FormData();
      form.append('audio', new Blob(chunks, { type: mime }), `voice.${ext}`);
      const out = await sdk().service('transcribe', form);
      return String(out.text ?? '').trim();
    },
    cancel() {
      try { recorder.stop(); } catch { /* already stopped */ }
      release();
    },
  };
}

/** Markdown to plain words for speaking: drop code, links' URLs, markup. */
export function speakableText(markdown) {
  return String(markdown ?? '')
    .replace(/```[\s\S]*?(```|$)/g, ' (code omitted) ')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/^\s*[-*+]\s+/gm, '')
    .replace(/\|/g, ' ')
    .replace(/[*_~>#]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, SPEAK_MAX_CHARS);
}

/** Speak text aloud. Resolves with the playing HTMLAudioElement. */
export async function speak(text, { voice = null } = {}) {
  const words = speakableText(text);
  if (!words) throw new Error('Nothing to read aloud.');
  const out = await sdk().service('tts', { text: words, ...(voice && { voice_id: voice }) });
  const audio = new Audio(out.url);
  await audio.play();
  return audio;
}
