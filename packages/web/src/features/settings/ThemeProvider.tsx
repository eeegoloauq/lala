import { createContext, useContext, useEffect, useState } from 'react';
import { STORAGE_KEYS } from '../../lib/constants';

export type Theme = 'dark' | 'light' | 'amoled' | 'discord' | 'retro' | 'winxp';

interface ThemeContextType {
    theme: Theme;
    setTheme: (theme: Theme) => void;
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

export function ThemeProvider({ children }: { children: React.ReactNode }) {
    const [theme, setTheme] = useState<Theme>(() => {
        return (localStorage.getItem(STORAGE_KEYS.theme) as Theme) || 'dark';
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
