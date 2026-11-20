/**
 * @gipity/chatbot: system-prompt assembly.
 *
 * Where each kind of information goes:
 *  - Knowledge documents with load: 'always' come first, wrapped in
 *    <knowledge><document> tags. Long reference text above the instructions
 *    is the layout models answer best from, and it keeps the big stable part
 *    at the front of the prompt, where prompt caching reuses it.
 *  - Then who the assistant is and how it behaves (persona), how replies
 *    render, how to use tools in general, and scope rules.
 *  - What a tool does, when to call it and the facts needed to call it well
 *    (a database schema, valid values) belong in that tool's description,
 *    not here: the model reads it at the moment it decides to call. Large
 *    reference text belongs in load: 'lookup' documents, which the
 *    read_knowledge tool lists by title and reads on demand.
 *  - The one thing that changes (today's date) goes last, so everything
 *    before it stays byte-identical between requests and caches.
 *
 * Pure function. No I/O. Tested in tests/prompt.test.js.
 */

/**
 * Build the system prompt from a validated config.
 *
 * @param {object} config - output of validateConfig()
 * @param {object} [extra]
 * @param {Array<{ title: string|null, content: string|null }>} [extra.documents] -
 *   the load: 'always' knowledge documents, URL ones already fetched.
 * @param {Array<{ name: string, confirm?: boolean }>} [extra.tools] - the tools
 *   the model can call.
 * @param {Date} [extra.now] - the current time (tests pass a fixed one).
 * @returns {string}
 */
export function buildSystemPrompt(config, extra = {}) {
  const { documents = [], tools = [], now = new Date() } = extra;
  const docs = documents.filter(d => d.content && d.content.trim());
  const sections = [];

  if (docs.length) sections.push(buildKnowledgeSection(docs, tools.length > 0));
  sections.push(buildIdentitySection(config.persona));
  sections.push(buildChatSection(config.features));
  if (tools.length) sections.push(buildToolsSection(tools));
  if (config.scope) sections.push(buildScopeSection(config.scope));
  if (config.scope?.refusalExamples?.length) sections.push(buildRefusalExamplesSection(config.scope.refusalExamples));
  if (config.persona.greeting) {
    sections.push(`## Greeting\nThe chat opened with this greeting from you, so the user may be replying to it: ${JSON.stringify(config.persona.greeting)}`);
  }
  sections.push(buildContextSection(now));

  return sections.join('\n\n');
}

function buildKnowledgeSection(docs, hasTools) {
  const body = docs.map(d => {
    const title = d.title ? ` title="${d.title.replace(/"/g, "'")}"` : '';
    return `<document${title}>\n${d.content.trim()}\n</document>`;
  }).join('\n');
  const rule = hasTools
    ? 'Answer from these documents and your tools before general knowledge. If neither covers a question, say so plainly; do not invent details.'
    : 'Answer from these documents before general knowledge. If they do not cover a question, say so plainly; do not invent details.';
  return `## Knowledge\nYour reference material:\n<knowledge>\n${body}\n</knowledge>\n${rule}`;
}

function buildIdentitySection(persona) {
  const lines = [`## Identity`, `You are ${persona.name}.`];
  if (persona.tone) lines.push(`Tone: ${persona.tone}`);
  lines.push(persona.instructions);
  return lines.join('\n');
}

function buildChatSection(features) {
  const lines = [
    '## The chat',
    'Replies render as Markdown: headings, **bold**, lists, tables, links, `code` and fenced code blocks all display properly. Use them when they make an answer easier to read; keep short answers short.',
  ];
  const kinds = [features.vision.enabled && 'photos', features.files.enabled && 'text files (CSV, JSON, logs, code)'].filter(Boolean);
  if (kinds.length) {
    lines.push(`The user can attach ${kinds.join(' and ')}; they arrive in their message${features.files.enabled ? ', each file inside <file name="..."> tags' : ''}.`);
  }
  return lines.join('\n');
}

function buildToolsSection(tools) {
  const lines = [
    '## Tools',
    'Call a tool whenever the answer depends on data you do not have; never guess a value a tool could give you. Each tool\'s description says what it does and when to use it.',
    'Tool results come from the app, not the user. If a tool fails, read the error, fix the call if you can, otherwise say plainly what went wrong.',
  ];
  const confirmed = tools.filter(t => t.confirm).map(t => t.name);
  if (confirmed.length) {
    lines.push(`These ask the user to approve before they run: ${confirmed.join(', ')}. If the user declines, do not retry; ask what they want instead.`);
  }
  return lines.join('\n');
}

function buildScopeSection(scope) {
  const lines = [`## Scope`];
  if (scope.allowed?.length) {
    lines.push(`Only answer questions about:`);
    scope.allowed.forEach((a) => lines.push(`- ${a}`));
  }
  if (scope.refused?.length) {
    lines.push('');
    lines.push(`Decline to:`);
    scope.refused.forEach((r) => lines.push(`- ${r}`));
  }
  if (scope.onRefusal) {
    lines.push('');
    lines.push(`When declining: ${scope.onRefusal}`);
  }
  return lines.join('\n');
}

function buildRefusalExamplesSection(examples) {
  const lines = [`## Refusal examples`, `The expected style and brevity when declining:`, ''];
  examples.forEach((ex, i) => {
    lines.push(`<example>\nUser: ${ex.user}\nYou: ${ex.bot}\n</example>`);
    if (i < examples.length - 1) lines.push('');
  });
  return lines.join('\n');
}

/** Today's date in the user's own time zone. Date only, so the prompt changes once a day. */
function buildContextSection(now) {
  let zone = 'UTC';
  try { zone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'; } catch { /* keep UTC */ }
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone: zone, weekday: 'long', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(now).map(p => [p.type, p.value]));
  return `## Context\nToday is ${parts.weekday}, ${parts.year}-${parts.month}-${parts.day} (the user's time zone is ${zone}).`;
}
