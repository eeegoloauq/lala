/**
 * Strip characters that could be used for spoofing/injection in user-supplied
 * display strings: null bytes, control characters, and RTL/LTR bidi override
 * characters (which can be used to visually disguise text, e.g. fake file
 * extensions or reversed slurs). Shared by room displayName and participant name.
 */
export function sanitizeDisplayText(input: string, maxLen: number): string {
    return input.trim().replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\u200E\u200F\u202A-\u202E\u2066-\u2069]/g, '').slice(0, maxLen);
}
