import { safeJsonParse } from './utils';

// The full list is generated at build time (virtual:lala-emoji, scripts/emojiData.ts).

const RECENT_KEY = 'lala_recent_emoji';
const MAX_RECENT = 16;

export function getRecentEmoji(): string[] {
    return safeJsonParse<string[]>(localStorage.getItem(RECENT_KEY), []);
}

export function addRecentEmoji(emoji: string): void {
    const recent = getRecentEmoji().filter(e => e !== emoji);
    recent.unshift(emoji);
    localStorage.setItem(RECENT_KEY, JSON.stringify(recent.slice(0, MAX_RECENT)));
}
