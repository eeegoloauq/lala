import { createContext, useContext, useEffect, useState } from 'react';

export type Theme = 'dark' | 'light' | 'amoled' | 'discord' | 'retro' | 'winxp';

interface ThemeContextType {
    theme: Theme;
    setTheme: (theme: Theme) => void;
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

export function ThemeProvider({ children }: { children: React.ReactNode }) {
    const [theme, setTheme] = useState<Theme>(() => {
        return (localStorage.getItem('lala_theme') as Theme) || 'dark';
    });

    useEffect(() => {
        localStorage.setItem('lala_theme', theme);
        // Apply to body dataset for global CSS targeting
        document.documentElement.dataset.theme = theme;
    }, [theme]);

    return (
        <ThemeContext.Provider value={{ theme, setTheme }}>
            {children}
        </ThemeContext.Provider>
    );
}

export function useTheme() {
    const context = useContext(ThemeContext);
    if (context === undefined) {
        throw new Error('useTheme must be used within a ThemeProvider');
    }
    return context;
}
