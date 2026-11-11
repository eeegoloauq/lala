import type { ServerTheme, ThemeColor, ThemeSize } from '../lib/types';

/** CSS custom property and value; applied on the root element over the theme's own. */
export type Tokens = Record<string, string>;

const HEX = /^#[0-9a-f]{6}$/i;
const SIZE = /^(?:[12]?[0-9]|3[0-2])(?:\.5)?px$/;
const PERCENT = /^(?:[0-4]?[0-9]|50)%$/;

const COLOR_TOKENS: Record<ThemeColor, string> = {
    accent: '--accent',
    background: '--bg-primary',
    surface: '--bg-secondary',
    sidebar: '--bg-sidebar',
    text: '--text-primary',
    textSecondary: '--text-secondary',
    textMuted: '--text-muted',
    border: '--border-color',
};

const SIZE_TOKENS: Record<ThemeSize, string> = {
    radius: '--border-radius',
    radiusLarge: '--border-radius-lg',
    avatarRadius: '--avatar-radius',
};

/** An accent color and the shades derived from it. */
export function accentTokens(color: string): Tokens {
    if (!HEX.test(color)) return {};
    const [r, g, b] = [1, 3, 5].map(i => parseInt(color.slice(i, i + 2), 16));
    const hex = (n: number) => Math.round(n).toString(16).padStart(2, '0');
    const darker = (n: number) => hex(n * 0.82);
    const lighter = (n: number) => hex(Math.min(255, n + (255 - n) * 0.35));
    const light = `#${lighter(r)}${lighter(g)}${lighter(b)}`;
    return {
        '--accent': color,
        '--accent-hover': `#${darker(r)}${darker(g)}${darker(b)}`,
        '--accent-glow': `rgba(${r},${g},${b},0.3)`,
        '--accent-gradient': `linear-gradient(135deg,${color},${light})`,
        '--text-accent': light,
    };
}

/**
 * The server's colors and sizes as tokens. Checked again here, as anything from the
 * network is: only known tokens, only plain colors and lengths.
 */
export function serverThemeTokens(theme: ServerTheme): Tokens {
    const tokens: Tokens = {};
    for (const [key, value] of Object.entries(theme.colors ?? {})) {
        if (!(key in COLOR_TOKENS) || typeof value !== 'string' || !HEX.test(value)) continue;
        if (key === 'accent') Object.assign(tokens, accentTokens(value));
        else tokens[COLOR_TOKENS[key as ThemeColor]] = value;
    }
    for (const [key, value] of Object.entries(theme.sizes ?? {})) {
        if (!(key in SIZE_TOKENS) || typeof value !== 'string') continue;
        if (SIZE.test(value) || (key === 'avatarRadius' && PERCENT.test(value))) tokens[SIZE_TOKENS[key as ThemeSize]] = value;
    }
    return tokens;
}
