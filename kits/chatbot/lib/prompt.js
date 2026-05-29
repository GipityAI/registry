/**
 * @gipity/chatbot — system-prompt assembly.
 *
 * Compiles a validated config into a single system-prompt string. The order
 * matters: identity → knowledge → scope rules → refusal examples. Rules and
 * examples land closest to the user message so they dominate the model's
 * recent context.
 *
 * Pure function. No I/O. Tested in tests/prompt.test.js.
 */

/**
 * Build the system prompt from a validated config.
 *
 * @param {object} config — output of validateConfig()
 * @param {string} [knowledgeText] — pre-fetched URL-source content concatenated
 *   onto config.knowledge.inlineText (the engine fetches URLs at init time;
 *   tests can pass an empty string).
 * @returns {string}
 */
export function buildSystemPrompt(config, knowledgeText = '') {
  const sections = [];

  sections.push(buildIdentitySection(config.persona));

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
  return `## Knowledge\nThe following is your reference material. Answer from it. If the user asks something not covered here, say so plainly — do not invent details.\n\n${knowledge}`;
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
