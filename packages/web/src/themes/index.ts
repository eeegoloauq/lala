/**
 * The built-in themes, one file each. A theme is tokens (colors and sizes as CSS custom
 * properties) and, where tokens can't express the look, its own rules, as Windows XP has.
 * dark.css defines every token on :root and is loaded first; the others override it.
 */
import type { ThemeId } from '../lib/types';
import './dark.css';
import './light.css';
import './amoled.css';
import './discord.css';
import './winxp.css';

export type Theme = ThemeId;

/**
 * Label keys, in the order the theme list and the sidebar's theme button offer them; a
 * Record, so a theme added to ThemeId can't be left out here.
 */
export const THEME_LABELS: Record<Theme, string> = {
    discord: 'settings.themeDiscord',
    winxp: 'settings.themeWinXP',
    dark: 'settings.themeDark',
    amoled: 'settings.themeAmoled',
    light: 'settings.themeLight',
};

/** The look for someone who hasn't picked one, on a server that sets none (index.html matches it). */
export const DEFAULT_THEME: Theme = 'discord';

export const THEMES = Object.keys(THEME_LABELS) as Theme[];
