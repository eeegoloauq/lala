'use strict';

// The desktop app's own text: the connection page, tray, edit menu and crash messages.
// Everything inside a call comes from the web app's packages/web/src/locales/.
// Each file in locales/ is a language named by its code (de.json, pt-BR.json), with the
// same keys as en.json; Weblate edits them. A missing key falls back to English.
// The main process reads them here; the connection page asks for its part over IPC
// (GET_STRINGS), because a file:// page cannot read files itself.

const fs = require('fs');
const path = require('path');

const DIR = path.join(__dirname, 'locales');

/** Nested JSON to flat "group.key" entries. */
function flatten(obj, prefix = '', out = {}) {
    for (const [key, value] of Object.entries(obj)) {
        if (value && typeof value === 'object') flatten(value, `${prefix}${key}.`, out);
        else if (typeof value === 'string') out[prefix + key] = value;
    }
    return out;
}

const STRINGS = Object.fromEntries(
    fs.readdirSync(DIR)
        .filter(f => f.endsWith('.json'))
        .map(f => [f.slice(0, -'.json'.length), flatten(JSON.parse(fs.readFileSync(path.join(DIR, f), 'utf8')))]),
);

/** The language for a locale such as "pt-BR": that exact code, then its language, then English. */
function languageFor(locale) {
    const code = String(locale || 'en');
    if (STRINGS[code]) return code;
    const base = code.split('-')[0];
    return STRINGS[base] ? base : 'en';
}

function translate(locale, key) {
    return STRINGS[languageFor(locale)][key] ?? STRINGS.en[key] ?? key;
}

/** Every key under `group.` for a locale, English filling the gaps, keyed without the group. */
function stringsFor(locale, group) {
    const lang = languageFor(locale);
    const merged = { ...STRINGS.en, ...STRINGS[lang] };
    const prefix = `${group}.`;
    const strings = Object.fromEntries(
        Object.entries(merged).filter(([k]) => k.startsWith(prefix)).map(([k, v]) => [k.slice(prefix.length), v]),
    );
    return { lang, strings };
}

module.exports = { STRINGS, languageFor, translate, stringsFor };
