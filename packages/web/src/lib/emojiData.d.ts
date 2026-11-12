/** Generated at build time from Unicode's data (scripts/emojiData.ts). */
declare module 'virtual:lala-emoji' {
    /** Unicode's groups in order, each its emoji (skin tone variants left out). */
    export const GROUPS: Array<{ id: string; emoji: string[] }>;
    /** Per emoji: "name\tsearch words" in the language, English for a language without its own. */
    export function loadNames(language: string): Promise<Record<string, string>>;
}
