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
    status: 'checking' | 'available' | 'not-available' | 'downloading' | 'installing' | 'ready' | 'error';
    version?: string;
    percent?: number;
    error?: string;
}

export interface SessionState {
    serverUrl: string;
    roomId?: string;
}

export type IconVariant = 'voice-wave' | 'dark-sphere' | 'single-wave' | 'double-wave';

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

    /** Update window title (e.g. with room name) */
    setTitleSuffix: (suffix: string) => void;

    /** Show / focus the main window */
    showWindow: () => void;

    /** Subscribe to URL load errors. Returns unsubscribe function. */
    onLoadUrlError: (callback: (error: { message: string }) => void) => () => void;

    /** Subscribe to back navigation request. Returns unsubscribe function. */
    onNavigateBack: (callback: () => void) => () => void;

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

    /** Save session state for crash recovery */
    saveSession: (data: SessionState | null) => void;

    /** Notify main process about call state (for power save blocker) */
    setInCall: (inCall: boolean) => void;

    /** Get current app icon variant name */
    getAppIcon: () => Promise<IconVariant>;

    /** Set app icon variant (saves preference, updates tray) */
    setAppIcon: (name: IconVariant) => Promise<boolean>;

    /** Relaunch the app */
    relaunch: () => void;

    /** Always true when running in Electron */
    isElectron: true;
}

declare global {
    interface Window {
        electronAPI?: ElectronAPI;
    }
}
