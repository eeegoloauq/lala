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

/** Label keys; a Record, so a theme added to ThemeId can't be left out here. */
export const THEME_LABELS: Record<Theme, string> = {
    dark: 'settings.themeDark',
    light: 'settings.themeLight',
    amoled: 'settings.themeAmoled',
    discord: 'settings.themeDiscord',
    winxp: 'settings.themeWinXP',
};

export const THEMES = Object.keys(THEME_LABELS) as Theme[];
