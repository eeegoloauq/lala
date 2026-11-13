/**
 * Pictures for the demo's bots: one friendly robot each, with something that says what it
 * does. The demo has no server to serve avatars from, so server.ts registers these with
 * `avatarUrl` (lib/avatarUtils.ts); people keep their initials.
 */

/** The shared robot: antenna, a round head, eyes with a shine, cheeks and a smile. */
const face = (head: string, eyes = '#2b2d42') => `
<line x1="32" y1="9" x2="32" y2="17" stroke="${head}" stroke-width="3" stroke-linecap="round"/>
<circle cx="32" cy="8" r="3.5" fill="#ffd166"/>
<rect x="13" y="17" width="38" height="33" rx="14" fill="${head}"/>
<rect x="18" y="23" width="28" height="20" rx="9" fill="#fff"/>
<circle cx="26" cy="32" r="3.6" fill="${eyes}"/><circle cx="38" cy="32" r="3.6" fill="${eyes}"/>
<circle cx="27.3" cy="30.6" r="1.2" fill="#fff"/><circle cx="39.3" cy="30.6" r="1.2" fill="#fff"/>
<circle cx="21.5" cy="38" r="2.2" fill="#ff8fab" opacity=".8"/><circle cx="42.5" cy="38" r="2.2" fill="#ff8fab" opacity=".8"/>
<path d="M28 38.5q4 3.5 8 0" stroke="${eyes}" stroke-width="2.2" fill="none" stroke-linecap="round"/>`;

const BOTS: Record<string, { bg: string; head: string; extra: string }> = {
    // Radio: headphones and a note.
    'bot-radio': {
        bg: '#ffd6a5', head: '#f4845f',
        extra: '<path d="M11 34v-4a21 21 0 0142 0v4" stroke="#3d405b" stroke-width="3.5" fill="none" stroke-linecap="round"/><rect x="7" y="31" width="8" height="12" rx="4" fill="#3d405b"/><rect x="49" y="31" width="8" height="12" rx="4" fill="#3d405b"/><path d="M46 50v-7l6-2v7" stroke="#3d405b" stroke-width="2" fill="none"/><circle cx="44.5" cy="50.5" r="2.2" fill="#3d405b"/><circle cx="50.5" cy="48.5" r="2.2" fill="#3d405b"/>',
    },
    // Minutes: round glasses and a notepad.
    'bot-minutes': {
        bg: '#bde0fe', head: '#5e8bdb',
        extra: '<circle cx="26" cy="32" r="6" stroke="#2b2d42" stroke-width="1.8" fill="none"/><circle cx="38" cy="32" r="6" stroke="#2b2d42" stroke-width="1.8" fill="none"/><path d="M32 32h0" stroke="#2b2d42" stroke-width="1.8"/><rect x="39" y="41" width="12" height="13" rx="2.5" fill="#fff" stroke="#2b2d42" stroke-width="1.5"/><path d="M42 45.5h6M42 49.5h4.5" stroke="#5e8bdb" stroke-width="1.6" stroke-linecap="round"/>',
    },
    // Scribe: a pencil behind the ear.
    'bot-scribe': {
        bg: '#caffbf', head: '#2a9d8f',
        extra: '<g transform="rotate(-35 50 20)"><rect x="46" y="10" width="6" height="22" rx="1.5" fill="#ffb703"/><path d="M46 32l3 6 3-6z" fill="#f4d6a0"/><path d="M48.2 36.5l.8 1.5.8-1.5z" fill="#2b2d42"/><rect x="46" y="8" width="6" height="4" rx="1.5" fill="#ff8fab"/></g>',
    },
    // Dice: a die in hand and a party hat.
    'bot-dice': {
        bg: '#e2c6ff', head: '#9b5de5',
        extra: '<path d="M22 17l10-13 10 13z" fill="#ffd166"/><circle cx="32" cy="4" r="2.5" fill="#ff8fab"/><rect x="40" y="40" width="13" height="13" rx="3" fill="#fff" stroke="#2b2d42" stroke-width="1.5"/><g fill="#9b5de5"><circle cx="43.5" cy="43.5" r="1.5"/><circle cx="49.5" cy="49.5" r="1.5"/><circle cx="46.5" cy="46.5" r="1.5"/></g>',
    },
    // Quiz: a question mark over its head.
    'bot-quiz': {
        bg: '#fdffb6', head: '#f9a03f',
        extra: '<path d="M15.5 6.5a4.5 4.5 0 119 0c0 2.8-4.5 3.2-4.5 6" stroke="#3d405b" stroke-width="2.6" fill="none" stroke-linecap="round"/><circle cx="20" cy="16" r="1.7" fill="#3d405b"/>',
    },
};

const cache = new Map<string, string>();

export function demoAvatar(identity: string): string | undefined {
    // Lala posts the release notes in #announcements, under the app's own icon.
    if (identity === 'bot-lala') return `${import.meta.env.BASE_URL}icons/icon-maskable.svg`;
    const bot = BOTS[identity];
    if (!bot) return demoPhoto(identity);
    let url = cache.get(identity);
    if (!url) {
        const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" fill="${bot.bg}"/>${face(bot.head)}${bot.extra}</svg>`;
        url = `data:image/svg+xml,${encodeURIComponent(svg)}`;
        cache.set(identity, url);
    }
    return url;
}

/** Photo-like pictures for a few demo people, so the profile banner has colors to take. */
const PHOTOS: Record<string, string> = {
    // A sunset over water.
    mira: '<defs><linearGradient id="s" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ff7e5f"/><stop offset=".55" stop-color="#feb47b"/><stop offset=".56" stop-color="#3a6073"/><stop offset="1" stop-color="#16222a"/></linearGradient></defs><rect width="64" height="64" fill="url(#s)"/><circle cx="32" cy="35" r="9" fill="#ffd27f"/><rect y="35" width="64" height="29" fill="#2c4a5a" opacity=".85"/>',
    // A forest under fog.
    theo: '<rect width="64" height="64" fill="#a8c3b5"/><path d="M0 46l10-18 8 12 9-20 10 18 9-14 18 26v14H0z" fill="#3e6b57"/><path d="M0 54l14-12 12 8 14-10 24 14v10H0z" fill="#1f3d33"/>',
    // A neon city at night.
    pia: '<rect width="64" height="64" fill="#1a1035"/><circle cx="46" cy="16" r="7" fill="#f72585" opacity=".8"/><path d="M4 64V34h10v30M18 64V22h12v42M34 64V30h9v34M47 64V38h12v26" fill="#4361ee"/><path d="M20 28h3M25 34h3M20 40h3M37 36h3M50 44h3" stroke="#4cc9f0" stroke-width="2"/>',
};

/** An album cover and a game icon for the demo's activities. */
export const DEMO_COVER = svgUrl('<defs><linearGradient id="c" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#5f2c82"/><stop offset="1" stop-color="#49a09d"/></linearGradient></defs><rect width="64" height="64" fill="url(#c)"/><circle cx="32" cy="32" r="16" fill="none" stroke="#fff" stroke-opacity=".7" stroke-width="2"/><circle cx="32" cy="32" r="4" fill="#fff" fill-opacity=".8"/>');
export const DEMO_COVER_2 = svgUrl('<rect width="64" height="64" fill="#f4d35e"/><path d="M0 44q16-14 32 0t32 0v20H0z" fill="#ee964b"/><path d="M0 52q16-10 32 0t32 0v12H0z" fill="#0d3b66"/>');
export const DEMO_GAME = svgUrl('<rect width="64" height="64" rx="12" fill="#0b132b"/><path d="M14 46l18-30 18 30z" fill="none" stroke="#5bc0be" stroke-width="4" stroke-linejoin="round"/><circle cx="32" cy="36" r="4" fill="#f4a259"/>');
export const DEMO_GAME_2 = svgUrl('<rect width="64" height="64" rx="12" fill="#3d1308"/><circle cx="32" cy="32" r="14" fill="#f9a03f"/><circle cx="32" cy="32" r="22" fill="none" stroke="#f9a03f" stroke-width="2" stroke-dasharray="4 5"/>');

function svgUrl(body: string): string {
    return `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">${body}</svg>`)}`;
}

export function demoPhoto(identity: string): string | undefined {
    const name = /^demo-([a-z]+)-/.exec(identity)?.[1];
    const body = name && PHOTOS[name];
    if (!body) return undefined;
    let url = cache.get(identity);
    if (!url) cache.set(identity, url = svgUrl(body));
    return url;
}
