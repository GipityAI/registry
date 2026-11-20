/**
 * @gipity/chatbot: turn a picked or dropped File into an attachment for
 * bot.send(text, { attachments }).
 *
 *   image/*  -> { kind: 'image', name, dataUrl }  shrunk to at most 1280 px
 *               on the long side as JPEG, so it is small enough to send and
 *               to save with the conversation
 *   text     -> { kind: 'file', name, text }      CSV, logs, JSON, Markdown,
 *               code: anything that reads as UTF-8 text
 *
 * Anything else (PDF, Office, archives) is refused with a clear message.
 */

const IMAGE_MAX_SIDE = 1280;
const IMAGE_QUALITY = 0.85;
const TEXT_TYPES = /^(text\/|application\/(json|xml|x-ndjson|csv|javascript|x-yaml|yaml|sql|x-sh))/;
const TEXT_EXTENSIONS = /\.(txt|csv|tsv|log|json|jsonl|ndjson|md|markdown|xml|yaml|yml|ini|toml|sql|html|css|js|mjs|ts|py|rb|go|rs|java|c|h|cpp|sh|env|conf|cfg)$/i;

/** Is this file something readAttachment() can take? */
export function isSupportedFile(file) {
  return /^image\/(png|jpeg|gif|webp)$/.test(file.type) || TEXT_TYPES.test(file.type) || TEXT_EXTENSIONS.test(file.name);
}

export async function readAttachment(file) {
  if (/^image\/(png|jpeg|gif|webp)$/.test(file.type)) {
    return { kind: 'image', name: file.name || 'image', dataUrl: await shrinkImage(file) };
  }
  if (TEXT_TYPES.test(file.type) || TEXT_EXTENSIONS.test(file.name)) {
    const text = await file.text();
    if (text.includes('\u0000')) throw new Error(`"${file.name}" looks like a binary file, not text.`);
    return { kind: 'file', name: file.name, text };
  }
  throw new Error(`"${file.name}" can't be attached: attach a photo (PNG, JPEG, GIF, WebP) or a text file (CSV, log, JSON, code).`);
}

async function shrinkImage(file) {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, IMAGE_MAX_SIDE / Math.max(bitmap.width, bitmap.height));
  const w = Math.round(bitmap.width * scale);
  const h = Math.round(bitmap.height * scale);
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff'; // transparent PNGs become white, not black, as JPEG
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(bitmap, 0, 0, w, h);
  bitmap.close?.();
  return canvas.toDataURL('image/jpeg', IMAGE_QUALITY);
}
