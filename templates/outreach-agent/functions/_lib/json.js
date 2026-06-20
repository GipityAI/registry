// Tolerant JSON parsing for LLM-step outputs + a deep array finder. Pure.

// Extract a JSON value from an LLM response that may contain stray prose/fences.
export function extractJson(text) {
    if (text == null) return null;
    if (typeof text === 'object') return text; // already parsed by the runtime
    let t = String(text).trim();
    const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fence) t = fence[1].trim();
    // Try a whole-string parse first (covers bare arrays/objects), then fall back
    // to the first {...last } span.
    try { return JSON.parse(t); } catch { /* fall through */ }
    const start = t.indexOf('{');
    const end = t.lastIndexOf('}');
    if (start === -1 || end === -1 || end < start) return null;
    try { return JSON.parse(t.slice(start, end + 1)); } catch { return null; }
}

// Find the first array under `key` anywhere in a parsed object - the agent
// sometimes wraps it ({result:{facts:[...]}}), so scan defensively. If the value
// itself is already an array of the right shape, return it.
export function findArray(obj, key, depth = 0) {
    if (obj == null || typeof obj !== 'object' || depth > 5) return [];
    if (Array.isArray(obj)) return obj;
    if (Array.isArray(obj[key])) return obj[key];
    for (const v of Object.values(obj)) {
        const found = findArray(v, key, depth + 1);
        if (found.length) return found;
    }
    return [];
}
