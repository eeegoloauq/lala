// Control characters (newlines and tabs included), line and paragraph separators, and bidi
// controls, which can disguise text (reversed words, fake file extensions). Zero-width
// joiners stay: emoji sequences need them.
const UNSAFE = /[\p{Cc}\p{Zl}\p{Zp}؜‎‏‪-‮⁦-⁩]/gu;

/** Cleans a user-supplied display string (room name, participant name) to at most `maxLen` characters. */
export function sanitizeDisplayText(input: string, maxLen: number): string {
    // Cut by code points so an emoji is never split into a lone surrogate.
    return Array.from(input.replace(UNSAFE, '').trim()).slice(0, maxLen).join('').trimEnd();
}
