---
name: i18n
description: Add or update UI strings/translations. Use when adding user-visible text or when the user mentions i18n, translate, localization.
---

# i18n

Add/update translations in the Lala web app (react-i18next, en + ru).

## Locale files
- English: `packages/web/src/locales/en.json`
- Russian: `packages/web/src/locales/ru.json`

## Rules
1. ALWAYS update BOTH locale files.
2. Use nested keys matching feature structure (e.g. `settings.audio.quality`).
3. In components: `const { t } = useTranslation()` then `t('key')`.
4. Interpolation: `t('key', { name: value })` with `"key": "Hello {{name}}"`.
5. Never hardcode user-visible strings in JSX.

## Checking coverage
```bash
# Potential hardcoded strings in JSX (missing i18n)
grep -rn '>[A-Z][a-z]' packages/web/src/ --include='*.tsx' | grep -v 'import\|//'
# Keys present in en but missing in ru (and vice versa)
node -e "const f=p=>{const o=require(p),r={},w=(x,k='')=>Object.entries(x).forEach(([a,b])=>typeof b=='object'?w(b,k+a+'.'):r[k+a]=1);w(o);return r};const en=f('./packages/web/src/locales/en.json'),ru=f('./packages/web/src/locales/ru.json');console.log('missing in ru:',Object.keys(en).filter(k=>!ru[k]));console.log('missing in en:',Object.keys(ru).filter(k=>!en[k]))"
```
