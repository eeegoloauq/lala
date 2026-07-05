import js from '@eslint/js';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import tseslint from 'typescript-eslint';

export default tseslint.config(
    { ignores: ['dist'] },
    {
        files: ['**/*.{ts,tsx}'],
        extends: [js.configs.recommended, ...tseslint.configs.recommended],
        languageOptions: {
            ecmaVersion: 2022,
            globals: globals.browser,
        },
        plugins: {
            'react-hooks': reactHooks,
            'react-refresh': reactRefresh,
        },
        rules: {
            // eslint-plugin-react-hooks v7 folded in the "React Compiler" rule
            // set (purity/immutability/gating/set-state-in-render/...) under its
            // recommended config. Those rules assume compiler-oriented patterns
            // this codebase doesn't follow yet, and enabling them wholesale
            // would require structural refactors out of scope here. Wire up
            // only the two classic hooks-correctness rules every hooks
            // codebase needs — the "standard Vite+React+TS set".
            'react-hooks/rules-of-hooks': 'error',
            'react-hooks/exhaustive-deps': 'warn',
            ...reactRefresh.configs.vite.rules,
            // Non-type-checked mode (kept fast) flags unused vars via the base
            // rule; disable it in favor of the TS-aware version.
            'no-unused-vars': 'off',
            '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
        },
    },
);
