/** App name */
export const APP_NAME = 'Lala';


/** Max display name length */
export const MAX_NAME_LENGTH = 20;

/** Screen share quality steps */
export const SCREEN_SHARE_FPS_STEPS = [30, 60] as const;
export const SCREEN_SHARE_BITRATE_STEPS = [1, 2, 5, 8, 15] as const; // Mbps

export function screenShareBitrateLabel(mbps: number): string {
    if (mbps <= 1) return '480p';
    if (mbps <= 2) return '720p';
    if (mbps <= 5) return '1080p';
    if (mbps <= 8) return '1440p';
    return '4K';
}

/** LocalStorage keys */
export const STORAGE_KEYS = {
  displayName: 'lala-display-name',
  // Not 'lala-identity': IDs stored under that key were exposed, and a new key gives
  // every device a new ID (identity.ts deletes the old one).
  identity: 'lala-device-id',
  // Underscore, unlike its neighbours: the key users' saved themes are under.
  theme: 'lala_theme',
  settings: 'lala-settings',
} as const;
