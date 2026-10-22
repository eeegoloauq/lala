export const THEMES = ['dark', 'light', 'amoled', 'discord', 'winxp'] as const;
export type Theme = typeof THEMES[number];
