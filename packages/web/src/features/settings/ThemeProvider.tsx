import { createContext, useContext, useEffect, useState } from 'react';
import { STORAGE_KEYS } from '../../lib/constants';

export type Theme = 'dark' | 'light' | 'amoled' | 'discord' | 'winxp';

const VALID_THEMES: Theme[] = ['dark', 'light', 'amoled', 'discord', 'winxp'];

interface ThemeContextType {
    theme: Theme;
    setTheme: (theme: Theme) => void;
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

export function ThemeProvider({ children }: { children: React.ReactNode }) {
    const [theme, setTheme] = useState<Theme>(() => {
        const stored = localStorage.getItem(STORAGE_KEYS.theme) as Theme | null;
        // Explicit fallback: unknown/removed values (e.g. the removed 'retro'
        // theme, or a stale value from an older build) fall back to 'dark'
        // instead of applying a data-theme attribute with no matching CSS.
        return stored && VALID_THEMES.includes(stored) ? stored : 'dark';
    });

    useEffect(() => {
        localStorage.setItem(STORAGE_KEYS.theme, theme);
        // Apply to body dataset for global CSS targeting
        document.documentElement.dataset.theme = theme;
    }, [theme]);

    return (
        <ThemeContext.Provider value={{ theme, setTheme }}>
            {children}
        </ThemeContext.Provider>
    );
}

// eslint-disable-next-line react-refresh/only-export-components -- context hook lives alongside its provider by design; splitting into a separate file would be pure ceremony here
export function useTheme() {
    const context = useContext(ThemeContext);
    if (context === undefined) {
        throw new Error('useTheme must be used within a ThemeProvider');
    }
    return context;
}
