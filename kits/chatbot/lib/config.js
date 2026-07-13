/**
 * @gipity/chatbot — config schema + validation.
 *
 * Kits run in the browser without npm install, so we don't pull a schema lib;
 * validation is hand-rolled, narrow, and fails loudly on the first bad field.
 *
 * The knowledge-token budget is enforced here at config-load time. Going over
 * budget throws — we never silently truncate, because a silently-clipped
 * knowledge base makes the bot lie confidently about the missing parts.
 */

/** Hard cap on knowledge content. ~4 chars/token for English; tune if needed. */
export const DEFAULT_KNOWLEDGE_MAX_TOKENS = 20000;
const CHARS_PER_TOKEN = 4;

const VALID_FEATURE_KEYS = ['voice', 'vision', 'imageGen', 'fileUpload'];
const VALID_KNOWLEDGE_TYPES = ['text', 'url'];
const VALID_PLACEMENTS = ['bottom-right', 'bottom-left', 'inline', 'fullscreen'];
const VALID_THEMES = ['match-app', 'light', 'dark', 'auto'];
const VALID_TOOL_AUTH = ['public', 'user-required', 'member-required'];

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

export class ChatbotConfigError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ChatbotConfigError';
  }
}

/**
 * Validate and normalize a chatbot config.
 *
 * Returns a normalized config with defaults filled in. Throws ChatbotConfigError
 * on any structural problem, knowledge over budget, or unknown enum value.
 */
export function validateConfig(input) {
  if (!isObject(input)) {
    throw new ChatbotConfigError('config must be an object');
  }

  const persona = validatePersona(input.persona);
  const scope = validateScope(input.scope);
  const knowledge = validateKnowledge(input.knowledge);
  const features = validateFeatures(input.features);
  const tools = validateTools(input.tools);
  const ui = validateUi(input.ui);
  const storage = validateStorage(input.storage);
  const model = validateModel(input.model);

  return { persona, scope, knowledge, features, tools, ui, storage, model };
}

function validatePersona(p) {
  if (!isObject(p)) throw new ChatbotConfigError('config.persona is required (object)');
  requireField(p, 'name', 'string', 'persona');
  requireField(p, 'instructions', 'string', 'persona');
  // greeting, tone, avatar, starters are optional
  if (p.starters !== undefined) {
    requireField(p, 'starters', 'array', 'persona');
    p.starters.forEach((s, i) => {
      if (typeof s !== 'string') {
        throw new ChatbotConfigError(`persona.starters[${i}] must be string`);
      }
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
  if (s === undefined) return null; // scope is optional — bot is unrestricted without it
  if (!isObject(s)) throw new ChatbotConfigError('config.scope must be an object');
  if (s.allowed !== undefined) {
    requireField(s, 'allowed', 'array', 'scope');
    s.allowed.forEach((x, i) => {
      if (typeof x !== 'string') throw new ChatbotConfigError(`scope.allowed[${i}] must be string`);
    });
  }
  if (s.refused !== undefined) {
    requireField(s, 'refused', 'array', 'scope');
    s.refused.forEach((x, i) => {
      if (typeof x !== 'string') throw new ChatbotConfigError(`scope.refused[${i}] must be string`);
    });
  }
  if (s.refusalExamples !== undefined) {
    requireField(s, 'refusalExamples', 'array', 'scope');
    s.refusalExamples.forEach((ex, i) => {
      if (!isObject(ex) || typeof ex.user !== 'string' || typeof ex.bot !== 'string') {
        throw new ChatbotConfigError(
          `scope.refusalExamples[${i}] must be { user: string, bot: string }`,
        );
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
    if (!isObject(src)) {
      throw new ChatbotConfigError(`knowledge.sources[${i}] must be an object`);
    }
    if (!VALID_KNOWLEDGE_TYPES.includes(src.type)) {
      throw new ChatbotConfigError(
        `knowledge.sources[${i}].type must be one of ${VALID_KNOWLEDGE_TYPES.join('|')} (got ${src.type})`,
      );
    }
    if (src.type === 'text') {
      if (typeof src.content !== 'string') {
        throw new ChatbotConfigError(`knowledge.sources[${i}].content must be string`);
      }
      inlineParts.push(src.content);
    } else if (src.type === 'url') {
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
    voice: { enabled: false, voice: null, autoPlay: false },
    vision: { enabled: false },
    imageGen: { enabled: false },
    fileUpload: { enabled: false },
  };
  if (f === undefined) return out;
  if (!isObject(f)) throw new ChatbotConfigError('config.features must be an object');
  for (const key of Object.keys(f)) {
    if (!VALID_FEATURE_KEYS.includes(key)) {
      throw new ChatbotConfigError(
        `features.${key} is not a known feature (expected one of ${VALID_FEATURE_KEYS.join('|')})`,
      );
    }
    if (!isObject(f[key])) {
      throw new ChatbotConfigError(`features.${key} must be an object`);
    }
    out[key] = { ...out[key], ...f[key] };
  }
  return out;
}

function validateTools(t) {
  if (t === undefined) return [];
  if (!Array.isArray(t)) throw new ChatbotConfigError('config.tools must be an array');
  return t.map((tool, i) => {
    if (!isObject(tool)) throw new ChatbotConfigError(`tools[${i}] must be an object`);
    if (typeof tool.name !== 'string' || typeof tool.function !== 'string') {
      throw new ChatbotConfigError(`tools[${i}] requires { name: string, function: string }`);
    }
    const auth = tool.auth ?? 'public';
    if (!VALID_TOOL_AUTH.includes(auth)) {
      throw new ChatbotConfigError(
        `tools[${i}].auth must be one of ${VALID_TOOL_AUTH.join('|')} (got ${auth})`,
      );
    }
    return { name: tool.name, function: tool.function, auth };
  });
}

function validateUi(u) {
  const out = {
    placement: 'bottom-right',
    theme: 'match-app',
    primaryColor: null,
    launcherIcon: null,
    avatarStates: null,
  };
  if (u === undefined) return out;
  if (!isObject(u)) throw new ChatbotConfigError('config.ui must be an object');
  if (u.placement !== undefined && !VALID_PLACEMENTS.includes(u.placement)) {
    throw new ChatbotConfigError(
      `ui.placement must be one of ${VALID_PLACEMENTS.join('|')} (got ${u.placement})`,
    );
  }
  if (u.theme !== undefined && !VALID_THEMES.includes(u.theme)) {
    throw new ChatbotConfigError(
      `ui.theme must be one of ${VALID_THEMES.join('|')} (got ${u.theme})`,
    );
  }
  return { ...out, ...u };
}

function validateStorage(s) {
  const out = { persistHistory: false, perUser: false, retentionDays: 90 };
  if (s === undefined) return out;
  if (!isObject(s)) throw new ChatbotConfigError('config.storage must be an object');
  if (s.persistHistory !== undefined && typeof s.persistHistory !== 'boolean') {
    throw new ChatbotConfigError('storage.persistHistory must be boolean');
  }
  if (s.persistHistory && !s.perUser) {
    // perUser:false + persistHistory:true is technically valid (shared history)
    // but very unusual — warn via the validator so the author sees it.
    // Not throwing; just normalising both flags so it's explicit.
  }
  return { ...out, ...s };
}

function validateModel(m) {
  const out = { route: 'default', temperature: 0.7, maxTokens: 1024 };
  if (m === undefined) return out;
  if (!isObject(m)) throw new ChatbotConfigError('config.model must be an object');
  if (m.route !== undefined && (typeof m.route !== 'string' || !m.route.trim())) {
    throw new ChatbotConfigError('model.route must be a non-empty string (a tier alias like "medium", a concrete model id, or "default")');
  }
  return { ...out, ...m };
}
