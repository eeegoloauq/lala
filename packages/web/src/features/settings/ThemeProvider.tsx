import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { STORAGE_KEYS } from '../../lib/constants';
import type { ServerTheme } from '../../lib/types';
import { THEMES, type Theme } from '../../themes';
import { accentTokens, serverThemeTokens, type Tokens } from '../../themes/tokens';

/** A built-in theme, or the server's default theme. */
export type ThemeChoice = Theme | 'server';

/** What the theme depends on besides the user's choice: from the server and from settings. */
interface ThemeInputs {
    serverTheme?: ServerTheme;
    accent?: string;
}

interface ThemeContextType {
    /** The built-in theme in effect, as `data-theme`. */
    theme: Theme;
    /** What the user picked; null until they pick, which follows the server. */
    choice: ThemeChoice | null;
    setChoice: (choice: ThemeChoice) => void;
    serverTheme?: ServerTheme;
    /** Merges: a field left out keeps its value, one given as undefined clears it. */
    setInputs: (inputs: Partial<ThemeInputs>) => void;
    userCss: string;
    setUserCss: (css: string) => void;
}

const MAX_USER_CSS = 50_000;
const USER_CSS_ID = 'lala-user-css';

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

const isTheme = (value: unknown): value is Theme => THEMES.includes(value as Theme);

function read(key: string): string | null {
    try { return localStorage.getItem(key); } catch { return null; }
}

function readChoice(): ThemeChoice | null {
    const stored = read(STORAGE_KEYS.theme);
    // Unknown or removed values (the removed 'retro' theme, a stale build) count as no choice.
    return stored === 'server' || isTheme(stored) ? stored : null;
}

function readServerTheme(): ServerTheme | undefined {
    try {
        const parsed = JSON.parse(read(STORAGE_KEYS.serverTheme) ?? 'null');
        return parsed && isTheme(parsed.base) ? parsed : undefined;
    } catch { return undefined; }
}

/**
 * Applies the theme: `data-theme` for the built-in theme, the server's colors and sizes
 * and the user's accent as tokens on the root element, and the user's own CSS last.
 */
export function ThemeProvider({ children }: { children: React.ReactNode }) {
    const [choice, setChoiceState] = useState<ThemeChoice | null>(readChoice);
    const [inputs, setInputsState] = useState<ThemeInputs>(() => ({ serverTheme: readServerTheme() }));
    const setInputs = useCallback((patch: Partial<ThemeInputs>) => setInputsState(prev => ({ ...prev, ...patch })), []);
    const [userCss, setUserCssState] = useState(() => read(STORAGE_KEYS.userCss) ?? '');
    const { serverTheme, accent } = inputs;

    const followsServer = choice === null || choice === 'server';
    const theme: Theme = choice !== null && choice !== 'server' ? choice : serverTheme?.base ?? 'dark';

    const tokens = useMemo<Tokens>(() => ({
        ...(followsServer && serverTheme ? serverThemeTokens(serverTheme) : {}),
        ...(accent ? accentTokens(accent) : {}),
    }), [followsServer, serverTheme, accent]);

    useEffect(() => {
        document.documentElement.dataset.theme = theme;
    }, [theme]);

    // Tokens set last time are removed, so a changed or dropped server theme leaves nothing behind.
    const applied = useRef<string[]>([]);
    useEffect(() => {
        const root = document.documentElement;
        for (const name of applied.current) if (!(name in tokens)) root.style.removeProperty(name);
        for (const [name, value] of Object.entries(tokens)) root.style.setProperty(name, value);
        applied.current = Object.keys(tokens);
    }, [tokens]);

    useEffect(() => {
        try {
            if (serverTheme) localStorage.setItem(STORAGE_KEYS.serverTheme, JSON.stringify(serverTheme));
            else localStorage.removeItem(STORAGE_KEYS.serverTheme);
        } catch { /* only saves a flash on the next load */ }
    }, [serverTheme]);

    // The user's own CSS comes after everything else, so it can change anything; it never leaves the device.
    useEffect(() => {
        let style = document.getElementById(USER_CSS_ID);
        if (!userCss) { style?.remove(); return; }
        if (!style) {
            style = document.createElement('style');
            style.id = USER_CSS_ID;
            document.head.appendChild(style);
        }
        style.textContent = userCss;
    }, [userCss]);

    const value = useMemo<ThemeContextType>(() => ({
        theme,
        choice,
        setChoice: (next) => {
            setChoiceState(next);
            try { localStorage.setItem(STORAGE_KEYS.theme, next); } catch { /* the choice lasts this session */ }
        },
        serverTheme,
        setInputs,
        userCss,
        setUserCss: (css) => {
            const next = css.slice(0, MAX_USER_CSS);
            setUserCssState(next);
            try {
                if (next) localStorage.setItem(STORAGE_KEYS.userCss, next);
                else localStorage.removeItem(STORAGE_KEYS.userCss);
            } catch { /* applies this session */ }
        },
    }), [theme, choice, serverTheme, setInputs, userCss]);

    return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

// eslint-disable-next-line react-refresh/only-export-components -- context hook lives alongside its provider by design; splitting into a separate file would be pure ceremony here
export function useTheme() {
    const context = useContext(ThemeContext);
    if (context === undefined) {
        throw new Error('useTheme must be used within a ThemeProvider');
    }
    return context;
}
