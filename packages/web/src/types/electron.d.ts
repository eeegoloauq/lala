export interface DesktopSource {
    id: string;
    name: string;
    thumbnail: string; // Base64 data URL
    appIcon: string | null; // Base64 data URL of the app icon
    displayId: string;
}

export interface AppInfo {
    version: string;
    name: string;
    platform: string;
    arch: string;
    isWayland?: boolean;
}

export interface UpdateStatus {
    status: 'checking' | 'available' | 'not-available' | 'downloading' | 'installing' | 'ready' | 'error' | 'package-manager' | 'manual';
    version?: string;
    /** 'manual': where new versions are downloaded */
    url?: string;
    percent?: number;
    error?: string;
}

export interface ElectronAPI {
    /** Navigate the window to a server URL */
    loadUrl: (url: string) => void;

    /** Get list of capturable desktop sources with thumbnails */
    getDesktopSources: () => Promise<DesktopSource[]>;

    /**
     * Pre-select a desktop source before getDisplayMedia fires.
     * Returns a promise that resolves when the main process has received the source ID.
     * This eliminates the race condition between IPC and getDisplayMedia.
     */
    setScreenShareSource: (id: string) => Promise<boolean>;

    /** Get app version and platform info */
    getAppInfo: () => Promise<AppInfo>;

    /** Subscribe to URL load errors. Returns unsubscribe function. */
    onLoadUrlError: (callback: (error: { message: string }) => void) => () => void;

    /** Check for updates */
    checkForUpdate: () => Promise<unknown>;

    /** Install downloaded update and restart */
    installUpdate: () => void;

    /** Subscribe to update status events. Returns unsubscribe function. */
    onUpdateStatus: (callback: (status: UpdateStatus) => void) => () => void;

    /** Set unread badge count for tray/taskbar */
    setBadgeCount: (count: number) => void;

    /** Get auto-launch status */
    getAutoLaunch: () => Promise<boolean>;

    /** Set auto-launch on system startup */
    setAutoLaunch: (enabled: boolean) => Promise<boolean>;

    /** Notify main process about call state (for power save blocker) */
    setInCall: (inCall: boolean) => void;
    /** Seconds without input on the whole computer; absent in desktop versions before presence. */
    getSystemIdleTime?: () => Promise<number | null>;

    /**
     * Starts or stops looking at what plays on this computer (null stops). Absent in desktop
     * versions before activities. Detection stays in the main process; only the summary comes here.
     */
    watchActivity?: (options: { browsers: boolean } | null) => void;
    /** Games added by hand, stored only in the desktop app. Absent before "Add game". */
    getGames?: () => Promise<AddedGame[]>;
    /** Shows a native menu of running programs; the one picked becomes a game, or null. */
    addGame?: () => Promise<AddedGame | null>;
    renameGame?: (id: string, name: string) => Promise<boolean>;
    removeGame?: (id: string) => Promise<boolean>;
    /** What the app sees now, or null; called on each change. Returns unsubscribe function. */
    onActivity?: (callback: (activity: DetectedActivity | null) => void) => () => void;

    /** Ping a server (health check via Node.js, bypasses CORS) */
    pingServer: (url: string) => Promise<number | null>;

    /** Navigate back to the connection page (server switching) */
    navigateBack: () => void;

    /** Always true when running in Electron */
    isElectron: true;
}

declare global {
    interface Window {
        electronAPI?: ElectronAPI;
    }
}

/**
 * A game or song as the desktop app saw it. Times are this computer's clock (ms); the web
 * client turns them into durations for the server. `image` is a small JPEG data URL.
 */
/** A game added by hand; the desktop app keeps which program it is. */
export interface AddedGame {
    id: string;
    name: string;
}

export type DetectedActivity =
    | { kind: 'playing'; name: string; startedAt: number; image?: string; url?: string }
    | { kind: 'listening'; title: string; artist?: string; album?: string; player: string; image?: string; url?: string; durationMs?: number; positionMs: number; positionAt: number; paused?: boolean };
