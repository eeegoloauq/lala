/**
 * Links someone else's activity may carry: https on a public music or game store only. A
 * player can name any URL (a private Navidrome, a file, a phishing page), so anything else
 * shows as plain text. The server drops other links too; this is the client's own check.
 */
const HOSTS = [
    'open.spotify.com',
    'music.youtube.com',
    'www.youtube.com',
    'music.apple.com',
    'soundcloud.com',
    'tidal.com',
    'www.deezer.com',
    'store.steampowered.com',
];

export function safeActivityUrl(url: string | undefined): string | undefined {
    if (!url) return undefined;
    try {
        const parsed = new URL(url);
        const host = parsed.hostname;
        const known = HOSTS.includes(host) || host.endsWith('.bandcamp.com');
        return parsed.protocol === 'https:' && known && !parsed.username && !parsed.password ? parsed.href : undefined;
    } catch {
        return undefined;
    }
}
