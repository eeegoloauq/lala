// Checks every file in src/locales/ against en.json, the source: no missing or unknown
// keys, and the same {{placeholders}} as English. Plural forms differ by language (English
// has _one/_other, Russian adds _few/_many), so they are compared by their base key.
// Runs as part of `npm run lint`. Exits 1 on any problem.
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const DIR = fileURLToPath(new URL('../src/locales/', import.meta.url));
const PLURAL = /_(zero|one|two|few|many|other)$/;

/** Flattens to base key -> set of placeholders across its plural forms. */
function flatten(obj, prefix = '', out = new Map()) {
    for (const [key, value] of Object.entries(obj)) {
        const path = prefix + key;
        if (value && typeof value === 'object') { flatten(value, `${path}.`, out); continue; }
        if (typeof value !== 'string') throw new Error(`${path}: not a string`);
        const base = path.replace(PLURAL, '');
        const vars = out.get(base) ?? new Set();
        for (const [, name] of value.matchAll(/\{\{\s*([\w.]+)[^}]*\}\}/g)) vars.add(name);
        out.set(base, vars);
    }
    return out;
}

const read = (file) => {
    try { return flatten(JSON.parse(readFileSync(DIR + file, 'utf8'))); }
    catch (err) { console.error(`${file}: ${err.message}`); process.exit(1); }
};

const source = read('en.json');
let problems = 0;
const report = (file, msg) => { problems++; console.error(`${file}: ${msg}`); };

for (const file of readdirSync(DIR).filter(f => f.endsWith('.json') && f !== 'en.json').sort()) {
    if (!/^[a-z]{2,3}(-[A-Z][A-Za-z]+|-[A-Z]{2})?\.json$/.test(file)) report(file, 'name it by language code, like de.json or pt-BR.json');
    const target = read(file);
    for (const [key, vars] of source) {
        const theirs = target.get(key);
        if (!theirs) { report(file, `missing ${key}`); continue; }
        const lost = [...vars].filter(v => !theirs.has(v));
        const added = [...theirs].filter(v => !vars.has(v));
        if (lost.length) report(file, `${key} lacks {{${lost.join('}}, {{')}}}`);
        if (added.length) report(file, `${key} has {{${added.join('}}, {{')}}}, which English doesn't pass`);
    }
    for (const key of target.keys()) if (!source.has(key)) report(file, `${key} is not in en.json`);
}

if (problems) {
    console.error(`\n${problems} problem(s) in translations.`);
    process.exit(1);
}
console.log(`Translations match en.json (${source.size} keys).`);
