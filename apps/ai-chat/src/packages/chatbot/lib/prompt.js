/**
 * @gipity/chatbot: system-prompt assembly.
 *
 * Compiles a validated config into a single system-prompt string. The order
 * matters: identity, formatting, tools, knowledge, scope rules, refusal examples. Rules and
 * examples land closest to the user message so they dominate the model's
 * recent context.
 *
 * Pure function. No I/O. Tested in tests/prompt.test.js.
 */

/**
 * Build the system prompt from a validated config.
 *
 * @param {object} config - output of validateConfig()
 * @param {string} [knowledgeText] - pre-fetched URL-source content concatenated
 *   onto config.knowledge.inlineText (the engine fetches URLs at init time;
 *   tests can pass an empty string).
 * @param {{ tools?: Array<{ name: string, confirm?: boolean }> }} [extra] - the
 *   tools the model can call this conversation.
 * @returns {string}
 */
export function buildSystemPrompt(config, knowledgeText = '', extra = {}) {
  const sections = [];

  sections.push(buildIdentitySection(config.persona));
  sections.push(FORMATTING_SECTION);
  if (extra.tools?.length) sections.push(buildToolsSection(extra.tools));

  const knowledge = combineKnowledge(config.knowledge?.inlineText ?? '', knowledgeText);
  if (knowledge) sections.push(buildKnowledgeSection(knowledge));

  if (config.scope) sections.push(buildScopeSection(config.scope));

  if (config.scope?.refusalExamples?.length) {
    sections.push(buildRefusalExamplesSection(config.scope.refusalExamples));
  }

  if (config.persona.greeting) {
    sections.push(`## Greeting\nWhen the conversation starts (no prior user message), open with: ${JSON.stringify(config.persona.greeting)}`);
  }

  return sections.join('\n\n');
}

const FORMATTING_SECTION = `## Formatting
Replies render as Markdown: headings, **bold**, lists, tables, links, \`code\` and fenced code blocks all display properly. Use them when they make an answer easier to read; keep short answers short.`;

function buildToolsSection(tools) {
  const lines = [
    '## Tools',
    'You can call tools to look things up or take actions. Call one whenever the answer depends on data you do not already have; never guess a value a tool could give you.',
    'Tool results come from the app, not the user. If a tool fails, say so plainly and suggest what to try.',
  ];
  const confirmed = tools.filter(t => t.confirm).map(t => t.name);
  if (confirmed.length) {
    lines.push(`These ask the user to approve before they run: ${confirmed.join(', ')}. If the user declines, do not retry; ask what they want instead.`);
  }
  return lines.join('\n');
}

function buildIdentitySection(persona) {
  const lines = [`## Identity`, `You are ${persona.name}.`];
  if (persona.tone) lines.push(`Tone: ${persona.tone}`);
  lines.push(persona.instructions);
  return lines.join('\n');
}

function combineKnowledge(inline, fetched) {
  const parts = [inline, fetched].map((s) => (s || '').trim()).filter(Boolean);
  return parts.join('\n\n');
}

function buildKnowledgeSection(knowledge) {
  return `## Knowledge\nThe following is your reference material. Answer from it. If the user asks something not covered here, say so plainly; do not invent details.\n\n${knowledge}`;
}

function buildScopeSection(scope) {
  const lines = [`## Scope`];
  if (scope.allowed?.length) {
    lines.push(`You ONLY answer questions about:`);
    scope.allowed.forEach((a) => lines.push(`- ${a}`));
  }
  if (scope.refused?.length) {
    lines.push('');
    lines.push(`You REFUSE to:`);
    scope.refused.forEach((r) => lines.push(`- ${r}`));
  }
  if (scope.onRefusal) {
    lines.push('');
    lines.push(`When refusing: ${scope.onRefusal}`);
  }
  return lines.join('\n');
}

function buildRefusalExamplesSection(examples) {
  const lines = [`## Refusal Examples`, `These show the expected style and brevity when refusing.`, ''];
  examples.forEach((ex, i) => {
    lines.push(`Example ${i + 1}:`);
    lines.push(`User: ${ex.user}`);
    lines.push(`You: ${ex.bot}`);
    if (i < examples.length - 1) lines.push('');
  });
  return lines.join('\n');
}
