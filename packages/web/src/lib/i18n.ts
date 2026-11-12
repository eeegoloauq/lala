import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import LanguageDetector from 'i18next-browser-languagedetector';

// Every file in locales/ is a language, named by its file (`de.json`, `pt-BR.json`):
// adding one needs no code change. English is the source and the fallback for any
// missing key; `npm run lint` checks each file against it (scripts/check-locales.mjs).
const files = import.meta.glob<Record<string, unknown>>('../locales/*.json', { eager: true, import: 'default' });

const resources = Object.fromEntries(
    Object.entries(files).map(([path, translation]) => [path.slice(path.lastIndexOf('/') + 1, -'.json'.length), { translation }]),
);

/** Language codes, English first, then by name. */
export const LANGUAGES: string[] = Object.keys(resources).sort((a, b) =>
    a === 'en' ? -1 : b === 'en' ? 1 : languageName(a).localeCompare(languageName(b)));

/** A language's name in that language ("Deutsch", "Русский"), from the browser, so files carry no name. */
export function languageName(code: string): string {
    let name = code;
    try {
        name = new Intl.DisplayNames([code], { type: 'language' }).of(code) ?? code;
    } catch {
        // An unknown code: show the code.
    }
    return name.charAt(0).toLocaleUpperCase(code) + name.slice(1);
}

// The page's language and writing direction follow the chosen language, for screen
// readers, hyphenation and right-to-left scripts.
i18n.on('languageChanged', () => {
    const lng = i18n.resolvedLanguage ?? 'en';
    document.documentElement.lang = lng;
    document.documentElement.dir = i18n.dir(lng);
});

i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources,
    supportedLngs: LANGUAGES,
    // "pt-BR" in the browser picks pt.json when there is no pt-BR.json.
    nonExplicitSupportedLngs: true,
    fallbackLng: 'en',
    detection: {
      order: ['localStorage', 'navigator'],
      lookupLocalStorage: 'lala_language',
      caches: ['localStorage'],
    },
    interpolation: {
      escapeValue: false,
    },
  });

export default i18n;
