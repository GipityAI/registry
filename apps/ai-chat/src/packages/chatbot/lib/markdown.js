/**
 * @gipity/chatbot: a small, safe Markdown renderer for model replies.
 *
 * Covers what models actually write: headings, paragraphs, bold, italic,
 * strikethrough, inline code, fenced code (with a copy button hook), bullet
 * and numbered lists (nested by indent), tables, blockquotes, rules, links and
 * images. All text is HTML-escaped first; links and images only accept
 * http(s) URLs (and data:image for images), so a reply can never inject markup
 * or script. Streaming-safe: an unclosed code fence renders as code so far.
 *
 * Pure function, no DOM. Tested in tests/markdown.test.js.
 */

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function safeUrl(url, { image = false } = {}) {
  const u = String(url).trim();
  if (/^https?:\/\//i.test(u)) return u;
  if (image && /^data:image\/(png|jpe?g|gif|webp);base64,[a-z0-9+/=]+$/i.test(u)) return u;
  return null;
}

/** Inline formatting on one already-split line of text (escapes it first). */
export function renderInline(text) {
  // Pull code spans out first so nothing inside them is formatted.
  const codes = [];
  let s = String(text).replace(/`([^`\n]+)`/g, (_, code) => {
    codes.push(code);
    return `\u0000${codes.length - 1}\u0000`;
  });
  s = escapeHtml(s);
  // Images, then links. URLs are matched on the escaped text, so a literal
  // quote can't break out of the attribute.
  s = s.replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, (m, alt, url) => {
    const safe = safeUrl(url.replace(/&amp;/g, '&'), { image: true });
    return safe ? `<img src="${escapeHtml(safe)}" alt="${alt}" loading="lazy">` : m;
  });
  s = s.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (m, label, url) => {
    const safe = safeUrl(url.replace(/&amp;/g, '&'));
    return safe ? `<a href="${escapeHtml(safe)}" target="_blank" rel="noopener noreferrer">${label}</a>` : m;
  });
  // Bare URLs not already inside a tag.
  s = s.replace(/(^|[\s(])(https?:\/\/[^\s<)]+[^\s<).,;:!?'"])/g, (m, pre, url) =>
    `${pre}<a href="${url}" target="_blank" rel="noopener noreferrer">${url}</a>`);
  s = s
    .replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>')
    .replace(/__([^_\n]+)__/g, '<strong>$1</strong>')
    .replace(/(^|[^*\w])\*([^*\s][^*\n]*?)\*(?!\w)/g, '$1<em>$2</em>')
    .replace(/(^|[^_\w])_([^_\s][^_\n]*?)_(?!\w)/g, '$1<em>$2</em>')
    .replace(/~~([^~\n]+)~~/g, '<del>$1</del>');
  return s.replace(/\u0000(\d+)\u0000/g, (_, i) => `<code>${escapeHtml(codes[Number(i)])}</code>`);
}

const FENCE_RE = /^\s*(```|~~~)\s*([\w+-]*)\s*$/;
const HEADING_RE = /^(#{1,6})\s+(.*)$/;
const RULE_RE = /^\s*([-*_])(\s*\1){2,}\s*$/;
const LIST_RE = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/;
const QUOTE_RE = /^\s*>\s?(.*)$/;
const TABLE_SEP_RE = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/;

function splitRow(line) {
  let s = line.trim();
  if (s.startsWith('|')) s = s.slice(1);
  if (s.endsWith('|')) s = s.slice(0, -1);
  return s.split('|').map(c => c.trim());
}

function renderList(items) {
  // items: [{ indent, ordered, text }]; nest by indent.
  let html = '';
  const stack = []; // [{ indent, tag }]
  for (const item of items) {
    while (stack.length && item.indent < stack[stack.length - 1].indent) {
      html += `</li></${stack.pop().tag}>`;
    }
    const top = stack[stack.length - 1];
    if (!top || item.indent > top.indent) {
      const tag = item.ordered ? 'ol' : 'ul';
      html += `<${tag}>`;
      stack.push({ indent: item.indent, tag });
    } else {
      html += '</li>';
    }
    html += `<li>${renderInline(item.text)}`;
  }
  while (stack.length) html += `</li></${stack.pop().tag}>`;
  return html;
}

/** Render a Markdown string to safe HTML. */
export function renderMarkdown(text) {
  const lines = String(text ?? '').replace(/\r\n?/g, '\n').split('\n');
  const out = [];
  let para = [];
  const flushPara = () => {
    if (para.length) out.push(`<p>${para.map(renderInline).join('<br>')}</p>`);
    para = [];
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    const fence = FENCE_RE.exec(line);
    if (fence) {
      flushPara();
      const code = [];
      i++;
      while (i < lines.length && !new RegExp(`^\\s*${fence[1]}\\s*$`).test(lines[i])) code.push(lines[i++]);
      const lang = fence[2] ? ` data-lang="${escapeHtml(fence[2])}"` : '';
      out.push(`<pre${lang}><code>${escapeHtml(code.join('\n'))}</code></pre>`);
      continue;
    }

    if (!line.trim()) { flushPara(); continue; }

    const heading = HEADING_RE.exec(line);
    if (heading) {
      flushPara();
      const level = Math.min(heading[1].length + 2, 6); // inside a chat bubble, # renders as h3
      out.push(`<h${level}>${renderInline(heading[2])}</h${level}>`);
      continue;
    }

    if (RULE_RE.test(line)) { flushPara(); out.push('<hr>'); continue; }

    if (line.includes('|') && i + 1 < lines.length && TABLE_SEP_RE.test(lines[i + 1])) {
      flushPara();
      const head = splitRow(line);
      i += 2;
      const rows = [];
      while (i < lines.length && lines[i].includes('|') && lines[i].trim()) rows.push(splitRow(lines[i++]));
      i--;
      out.push(
        '<div class="table-wrap"><table><thead><tr>'
        + head.map(c => `<th>${renderInline(c)}</th>`).join('')
        + '</tr></thead><tbody>'
        + rows.map(r => `<tr>${head.map((_, j) => `<td>${renderInline(r[j] ?? '')}</td>`).join('')}</tr>`).join('')
        + '</tbody></table></div>',
      );
      continue;
    }

    if (LIST_RE.test(line)) {
      flushPara();
      const items = [];
      while (i < lines.length) {
        const m = LIST_RE.exec(lines[i]);
        if (m) {
          items.push({ indent: m[1].replace(/\t/g, '    ').length, ordered: /\d/.test(m[2]), text: m[3] });
          i++;
        } else if (lines[i].trim() && /^\s+/.test(lines[i]) && items.length) {
          items[items.length - 1].text += ` ${lines[i].trim()}`; // wrapped continuation line
          i++;
        } else break;
      }
      i--;
      out.push(renderList(items));
      continue;
    }

    if (QUOTE_RE.test(line)) {
      flushPara();
      const quoted = [];
      while (i < lines.length && QUOTE_RE.test(lines[i])) quoted.push(QUOTE_RE.exec(lines[i++])[1]);
      i--;
      out.push(`<blockquote>${renderMarkdown(quoted.join('\n'))}</blockquote>`);
      continue;
    }

    para.push(line);
  }
  flushPara();
  return out.join('');
}
