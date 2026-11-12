// Control characters (newlines and tabs included), line and paragraph separators, and bidi
// controls, which can disguise text (reversed words, fake file extensions). Zero-width
// joiners stay: emoji sequences need them.
const UNSAFE = /[\p{Cc}\p{Zl}\p{Zp}؜‎‏‪-‮⁦-⁩]/gu;

/** Cleans a user-supplied display string (room name, participant name) to at most `maxLen` characters. */
export function sanitizeDisplayText(input: string, maxLen: number): string {
    // Cut by code points so an emoji is never split into a lone surrogate.
    return Array.from(input.replace(UNSAFE, '').trim()).slice(0, maxLen).join('').trimEnd();
}

// The same, but a message keeps its line breaks and tabs.
const UNSAFE_IN_TEXT = /[\u0000-\u0008\u000b-\u001f\u007f-\u009f\p{Zl}\p{Zp}\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/gu;

/** Cleans a chat message: line breaks as \n, no other control or bidi characters, trimmed. */
export function sanitizeMessageText(input: string): string {
    return input.replace(/\r\n?/g, '\n').replace(UNSAFE_IN_TEXT, '').trim();
}
