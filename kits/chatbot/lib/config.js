/**
 * @gipity/chatbot: config schema + validation.
 *
 * Kits run in the browser without npm install, so validation is hand-rolled,
 * narrow, and fails loudly on the first bad field. Every field here does
 * something: a setting the engine or widget ignores would be a lie.
 *
 * The knowledge-token budget is enforced at config-load time. Going over
 * budget throws; we never silently truncate, because a clipped knowledge base
 * makes the bot answer confidently about the missing parts.
 */

/** Hard cap on knowledge content. ~4 chars/token for English. */
export const DEFAULT_KNOWLEDGE_MAX_TOKENS = 20000;
const CHARS_PER_TOKEN = 4;

const VALID_FEATURE_KEYS = ['vision', 'files', 'voice', 'imageGen'];
const VALID_KNOWLEDGE_TYPES = ['text', 'url'];
const VALID_PLACEMENTS = ['bottom-right', 'bottom-left', 'inline', 'fullscreen'];
const VALID_THEMES = ['match-app', 'light', 'dark', 'auto'];
const TOOL_NAME_RE = /^[a-zA-Z0-9_-]{1,64}$/;
const STORE_METHODS = ['list', 'load', 'create', 'write', 'rename', 'remove'];

/** Estimate token count from a string. Char-count / 4 is fine for budget gating. */
export function estimateTokens(text) {
  if (typeof text !== 'string' || text.length === 0) return 0;
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

function isObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function requireField(parent, key, type, where) {
  const v = parent?.[key];
  const got = Array.isArray(v) ? 'array' : typeof v;
  if (type === 'array' && !Array.isArray(v)) {
    throw new ChatbotConfigError(`${where}.${key} must be an array (got ${got})`);
  }
  if (type !== 'array' && got !== type) {
    throw new ChatbotConfigError(`${where}.${key} must be ${type} (got ${got})`);
  }
  return v;
}

function rejectUnknownKeys(obj, allowed, where) {
  for (const key of Object.keys(obj)) {
    if (!allowed.includes(key)) {
      throw new ChatbotConfigError(`${where}.${key} is not a known setting (expected one of ${allowed.join(', ')})`);
    }
  }
}

export class ChatbotConfigError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ChatbotConfigError';
  }
}

/**
 * Validate and normalize a chatbot config. Returns a normalized config with
 * defaults filled in. Throws ChatbotConfigError on any structural problem,
 * knowledge over budget, or unknown setting.
 */
export function validateConfig(input) {
  if (!isObject(input)) throw new ChatbotConfigError('config must be an object');
  rejectUnknownKeys(input, ['persona', 'scope', 'knowledge', 'features', 'tools', 'ui', 'storage', 'model'], 'config');

  const features = validateFeatures(input.features);
  return {
    persona: validatePersona(input.persona),
    scope: validateScope(input.scope),
    knowledge: validateKnowledge(input.knowledge),
    features,
    tools: validateTools(input.tools),
    ui: validateUi(input.ui),
    storage: validateStorage(input.storage),
    model: validateModel(input.model),
  };
}

function validatePersona(p) {
  if (!isObject(p)) throw new ChatbotConfigError('config.persona is required (object)');
  requireField(p, 'name', 'string', 'persona');
  requireField(p, 'instructions', 'string', 'persona');
  if (p.starters !== undefined) {
    requireField(p, 'starters', 'array', 'persona');
    p.starters.forEach((s, i) => {
      if (typeof s !== 'string') throw new ChatbotConfigError(`persona.starters[${i}] must be string`);
    });
  }
  return {
    name: p.name,
    avatar: p.avatar ?? null,
    tone: p.tone ?? '',
    instructions: p.instructions,
    greeting: p.greeting ?? null,
    starters: p.starters ?? [],
  };
}

function validateScope(s) {
  if (s === undefined) return null; // optional: the bot is unrestricted without it
  if (!isObject(s)) throw new ChatbotConfigError('config.scope must be an object');
  for (const key of ['allowed', 'refused']) {
    if (s[key] === undefined) continue;
    requireField(s, key, 'array', 'scope');
    s[key].forEach((x, i) => {
      if (typeof x !== 'string') throw new ChatbotConfigError(`scope.${key}[${i}] must be string`);
    });
  }
  if (s.refusalExamples !== undefined) {
    requireField(s, 'refusalExamples', 'array', 'scope');
    s.refusalExamples.forEach((ex, i) => {
      if (!isObject(ex) || typeof ex.user !== 'string' || typeof ex.bot !== 'string') {
        throw new ChatbotConfigError(`scope.refusalExamples[${i}] must be { user: string, bot: string }`);
      }
    });
  }
  return {
    allowed: s.allowed ?? [],
    refused: s.refused ?? [],
    onRefusal: s.onRefusal ?? 'Politely decline and suggest a topic you can help with.',
    refusalExamples: s.refusalExamples ?? [],
  };
}

function validateKnowledge(k) {
  if (k === undefined) return { maxTokens: DEFAULT_KNOWLEDGE_MAX_TOKENS, sources: [], inlineText: '', fetchUrls: [] };
  if (!isObject(k)) throw new ChatbotConfigError('config.knowledge must be an object');

  const maxTokens = k.maxTokens ?? DEFAULT_KNOWLEDGE_MAX_TOKENS;
  if (typeof maxTokens !== 'number' || maxTokens <= 0) {
    throw new ChatbotConfigError('knowledge.maxTokens must be a positive number');
  }

  requireField(k, 'sources', 'array', 'knowledge');
  const inlineParts = [];
  const fetchUrls = [];
  k.sources.forEach((src, i) => {
    if (!isObject(src)) throw new ChatbotConfigError(`knowledge.sources[${i}] must be an object`);
    if (!VALID_KNOWLEDGE_TYPES.includes(src.type)) {
      throw new ChatbotConfigError(
        `knowledge.sources[${i}].type must be one of ${VALID_KNOWLEDGE_TYPES.join('|')} (got ${src.type})`,
      );
    }
    if (src.type === 'text') {
      if (typeof src.content !== 'string') throw new ChatbotConfigError(`knowledge.sources[${i}].content must be string`);
      inlineParts.push(src.content);
    } else {
      if (typeof src.url !== 'string' || !/^https?:\/\//.test(src.url)) {
        throw new ChatbotConfigError(`knowledge.sources[${i}].url must be an http(s) URL`);
      }
      fetchUrls.push(src.url);
    }
  });

  const inlineText = inlineParts.join('\n\n');
  const inlineTokens = estimateTokens(inlineText);
  if (inlineTokens > maxTokens) {
    throw new ChatbotConfigError(
      `knowledge inline content is ${inlineTokens} tokens (~${inlineText.length} chars), ` +
      `which exceeds maxTokens=${maxTokens}. Trim sources or raise the budget.`,
    );
  }
  return { maxTokens, sources: k.sources, inlineText, fetchUrls };
}

function validateFeatures(f) {
  const out = {
    // Attach photos; the model sees them (needs a model that reads images).
    vision: { enabled: false },
    // Attach text files (CSV, logs, JSON, code); their text goes into the message.
    files: { enabled: false, maxChars: 200000 },
    // Mic button (Gipity transcribe) and a read-aloud button (Gipity TTS).
    voice: { enabled: false, voice: null, autoPlay: false },
    // A generate_image tool the model can call (Gipity image service).
    imageGen: { enabled: false, quality: null },
  };
  if (f === undefined) return out;
  if (!isObject(f)) throw new ChatbotConfigError('config.features must be an object');
  rejectUnknownKeys(f, VALID_FEATURE_KEYS, 'features');
  for (const key of Object.keys(f)) {
    if (!isObject(f[key])) throw new ChatbotConfigError(`features.${key} must be an object`);
    rejectUnknownKeys(f[key], Object.keys(out[key]), `features.${key}`);
    out[key] = { ...out[key], ...f[key] };
  }
  if (typeof out.files.maxChars !== 'number' || out.files.maxChars <= 0) {
    throw new ChatbotConfigError('features.files.maxChars must be a positive number');
  }
  return out;
}

/**
 * A tool is something the model can ask to run mid-answer:
 *   { name, description, parameters?, function: 'app-function-name', confirm? }
 *   { name, description, parameters?, run: async (args) => result, confirm? }
 * `function` calls one of this app's functions as the signed-in visitor (the
 * function's own auth, table grants and limits apply). `run` is browser code.
 * `confirm: true` asks the visitor before it runs (use it for anything that
 * writes, sends or spends).
 */
function validateTools(t) {
  if (t === undefined) return [];
  if (!Array.isArray(t)) throw new ChatbotConfigError('config.tools must be an array');
  const seen = new Set();
  return t.map((tool, i) => {
    const where = `tools[${i}]`;
    if (!isObject(tool)) throw new ChatbotConfigError(`${where} must be an object`);
    rejectUnknownKeys(tool, ['name', 'description', 'parameters', 'function', 'run', 'confirm'], where);
    if (typeof tool.name !== 'string' || !TOOL_NAME_RE.test(tool.name)) {
      throw new ChatbotConfigError(`${where}.name must be 1-64 letters, digits, _ or -`);
    }
    if (seen.has(tool.name)) throw new ChatbotConfigError(`${where}.name '${tool.name}' is used twice`);
    seen.add(tool.name);
    if (typeof tool.description !== 'string' || !tool.description.trim()) {
      throw new ChatbotConfigError(`${where}.description is required: it is how the model decides when to call the tool`);
    }
    const hasFn = typeof tool.function === 'string' && tool.function.length > 0;
    const hasRun = typeof tool.run === 'function';
    if (hasFn === hasRun) {
      throw new ChatbotConfigError(`${where} needs exactly one of function: '<app function name>' or run: async (args) => result`);
    }
    if (tool.parameters !== undefined && (!isObject(tool.parameters) || tool.parameters.type !== 'object')) {
      throw new ChatbotConfigError(`${where}.parameters must be a JSON Schema object ({ type: 'object', properties: {...} })`);
    }
    return {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters ?? { type: 'object', properties: {} },
      function: hasFn ? tool.function : null,
      run: hasRun ? tool.run : null,
      confirm: tool.confirm === true,
    };
  });
}

function validateUi(u) {
  const out = {
    placement: 'bottom-right',
    theme: 'match-app',
    primaryColor: null,
    launcherIcon: null,
    // Conversation list beside the chat. Defaults on for inline/fullscreen when
    // conversations are saved.
    sidebar: null,
    // Show the credits each answer cost (handy for the app owner while building).
    showUsage: false,
    placeholder: 'Message…',
  };
  if (u === undefined) return out;
  if (!isObject(u)) throw new ChatbotConfigError('config.ui must be an object');
  rejectUnknownKeys(u, Object.keys(out), 'ui');
  if (u.placement !== undefined && !VALID_PLACEMENTS.includes(u.placement)) {
    throw new ChatbotConfigError(`ui.placement must be one of ${VALID_PLACEMENTS.join('|')} (got ${u.placement})`);
  }
  if (u.theme !== undefined && !VALID_THEMES.includes(u.theme)) {
    throw new ChatbotConfigError(`ui.theme must be one of ${VALID_THEMES.join('|')} (got ${u.theme})`);
  }
  return { ...out, ...u };
}

/**
 * Where conversations are kept:
 *   persist: 'none'   nothing is saved (default)
 *   persist: 'local'  this browser's localStorage
 *   persist: store    your own store, e.g. functionStore('chats') to keep them
 *                     in the app's database per signed-in user
 */
function validateStorage(s) {
  const out = { persist: 'none', autoTitle: true, localKey: 'gipity-chatbot' };
  if (s === undefined) return out;
  if (!isObject(s)) throw new ChatbotConfigError('config.storage must be an object');
  rejectUnknownKeys(s, Object.keys(out), 'storage');
  const merged = { ...out, ...s };
  const p = merged.persist;
  if (p !== 'none' && p !== 'local') {
    if (!isObject(p)) throw new ChatbotConfigError(`storage.persist must be 'none', 'local' or a store object`);
    const missing = STORE_METHODS.filter(m => typeof p[m] !== 'function');
    if (missing.length) {
      throw new ChatbotConfigError(`storage.persist store is missing ${missing.join(', ')} (see functionStore() in the README)`);
    }
  }
  if (typeof merged.autoTitle !== 'boolean') throw new ChatbotConfigError('storage.autoTitle must be boolean');
  return merged;
}

function validateModel(m) {
  const out = { route: 'default', temperature: 0.7, maxTokens: 2048, maxToolSteps: 8, choices: [] };
  if (m === undefined) return out;
  if (!isObject(m)) throw new ChatbotConfigError('config.model must be an object');
  rejectUnknownKeys(m, Object.keys(out), 'model');
  if (m.route !== undefined && (typeof m.route !== 'string' || !m.route.trim())) {
    throw new ChatbotConfigError('model.route must be a non-empty string (a tier alias like "medium", a concrete model id, or "default")');
  }
  if (m.maxToolSteps !== undefined && (!Number.isInteger(m.maxToolSteps) || m.maxToolSteps < 1 || m.maxToolSteps > 25)) {
    throw new ChatbotConfigError('model.maxToolSteps must be an integer from 1 to 25');
  }
  if (m.choices !== undefined) {
    requireField(m, 'choices', 'array', 'model');
    m.choices.forEach((c, i) => {
      if (!isObject(c) || typeof c.route !== 'string' || typeof c.label !== 'string') {
        throw new ChatbotConfigError(`model.choices[${i}] must be { route: string, label: string }`);
      }
    });
  }
  return { ...out, ...m };
}
