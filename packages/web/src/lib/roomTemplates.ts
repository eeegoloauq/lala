import { secureGet, secureSet, secureRemove } from './secureStore';

export interface RoomTemplate {
    name: string;
    password?: string;
    maxParticipants?: number;
    lastVisited: number; // timestamp
}

// Templates may carry a room password, so the whole blob lives in the
// encrypted store rather than plain localStorage.
const STORAGE_KEY = 'lala_room_templates';
const MAX_TEMPLATES = 3;

export function getTemplates(): RoomTemplate[] {
    try {
        const raw = secureGet(STORAGE_KEY);
        return raw ? JSON.parse(raw) : [];
    } catch { return []; }
}

export function saveTemplate(t: Omit<RoomTemplate, 'lastVisited'>): void {
    const templates = getTemplates();
    // Dedup by name (case-insensitive)
    const filtered = templates.filter(x => x.name.toLowerCase() !== t.name.toLowerCase());
    filtered.unshift({ ...t, lastVisited: Date.now() });
    // Cap at MAX_TEMPLATES
    secureSet(STORAGE_KEY, JSON.stringify(filtered.slice(0, MAX_TEMPLATES)));
}

export function removeTemplate(name: string): void {
    const templates = getTemplates().filter(x => x.name !== name);
    secureSet(STORAGE_KEY, JSON.stringify(templates));
}

export function clearTemplates(): void {
    secureRemove(STORAGE_KEY);
}

/** Drop stored passwords from all templates (keeps the templates themselves). */
export function stripTemplatePasswords(): void {
    const templates = getTemplates();
    if (!templates.some(t => t.password !== undefined)) return;
    secureSet(STORAGE_KEY, JSON.stringify(templates.map(({ password: _pw, ...rest }) => rest)));
}
