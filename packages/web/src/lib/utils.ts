/** Safely parse JSON with a fallback value. Returns fallback on null/undefined input or parse error. */
export function safeJsonParse<T>(str: string | null | undefined, fallback: T): T {
    if (!str) return fallback;
    try { return JSON.parse(str); } catch { return fallback; }
}
