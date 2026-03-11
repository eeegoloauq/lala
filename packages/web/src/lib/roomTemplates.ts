export interface RoomTemplate {
    name: string;
    password?: string;
    maxParticipants?: number;
    lastVisited: number; // timestamp
}

const STORAGE_KEY = 'lala_room_templates';
const MAX_TEMPLATES = 3;

export function getTemplates(): RoomTemplate[] {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        return raw ? JSON.parse(raw) : [];
    } catch { return []; }
}

export function saveTemplate(t: Omit<RoomTemplate, 'lastVisited'>): void {
    const templates = getTemplates();
    // Dedup by name (case-insensitive)
    const filtered = templates.filter(x => x.name.toLowerCase() !== t.name.toLowerCase());
    filtered.unshift({ ...t, lastVisited: Date.now() });
    // Cap at MAX_TEMPLATES
    localStorage.setItem(STORAGE_KEY, JSON.stringify(filtered.slice(0, MAX_TEMPLATES)));
}

export function removeTemplate(name: string): void {
    const templates = getTemplates().filter(x => x.name !== name);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(templates));
}

export function clearTemplates(): void {
    localStorage.removeItem(STORAGE_KEY);
}
