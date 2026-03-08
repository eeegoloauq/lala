import { safeJsonParse } from './utils';

export interface EmojiCategory {
    id: string;
    label: string;
    emoji: string[];
}

export const EMOJI_CATEGORIES: EmojiCategory[] = [
    {
        id: 'faces',
        label: '😀',
        emoji: ['😀','😂','🥲','😍','🥰','😊','😭','😤','😡','🤔','😏','😎','🤗','😅','🤣','😬'],
    },
    {
        id: 'hands',
        label: '👋',
        emoji: ['👍','👎','👋','🙌','🤝','✌️','👏','🤦','🤷','💪'],
    },
    {
        id: 'objects',
        label: '💡',
        emoji: ['💻','📱','🎮','🎵','🎉','💡','🔥','⚡','🌟','🚀'],
    },
    {
        id: 'food',
        label: '🍕',
        emoji: ['🍕','🍺','☕','🍔','🍣','🍭','🍿','💯'],
    },
    {
        id: 'hearts',
        label: '❤️',
        emoji: ['❤️','💛','💚','💙','💜','🖤','💔','🥹'],
    },
];

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
