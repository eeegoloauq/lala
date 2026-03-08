/** Deterministic color per participant identity. */

const PALETTE = [
    '#7c3aed', '#2563eb', '#0891b2', '#16a34a',
    '#d97706', '#dc2626', '#c026d3', '#0d9488',
];

export function colorForName(name: string): string {
    let hash = 0;
    for (let i = 0; i < name.length; i++) {
        hash = name.charCodeAt(i) + ((hash << 5) - hash);
    }
    return PALETTE[Math.abs(hash) % PALETTE.length];
}
