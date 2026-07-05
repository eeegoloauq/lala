import { createContext, useContext } from 'react';
import type { ReactNode } from 'react';
import type { AppSettings } from '../settings/types';
import type { ParticipantAdminActions } from './hooks/useParticipantContextMenu';

export interface RoomUIContextValue {
    /** Local participant's own deafen toggle — only meaningful for the local tile. */
    audioMuted: boolean;
    avatarCache: Map<string, string>;
    volumes: Map<string, number>;
    onVolumeChange: (identity: string, vol: number) => void;
    screenVolumes: Map<string, number>;
    onScreenVolumeChange: (identity: string, vol: number) => void;
    admin?: ParticipantAdminActions;
    settings: AppSettings;
    onOpenSettings?: () => void;
}

const RoomUIContext = createContext<RoomUIContextValue | null>(null);

/**
 * Stable bundle of room-wide UI plumbing — volumes, avatar cache, admin actions,
 * settings — needed by the layout components and their context menus. Provided once
 * by RoomShell around whichever of VideoGrid/FocusLayout is active, so those two
 * (and useParticipantContextMenu, shared by both) don't have to each accept and
 * forward the same 8 props.
 *
 * Deliberately NOT consumed by ParticipantTile: that component is `memo`-ized per
 * participant and stays driven by narrow props (`avatarUrl`, `audioMuted`) passed down
 * by VideoGrid/FocusLayout, so a volume-slider drag (debounced every 400ms) only
 * re-renders the one tile whose volume actually changed, not the whole grid.
 */
export function RoomUIProvider({ value, children }: { value: RoomUIContextValue; children: ReactNode }) {
    return <RoomUIContext.Provider value={value}>{children}</RoomUIContext.Provider>;
}

// eslint-disable-next-line react-refresh/only-export-components -- context hook lives alongside its provider by design; splitting into a separate file would be pure ceremony here
export function useRoomUIContext(): RoomUIContextValue {
    const ctx = useContext(RoomUIContext);
    if (!ctx) throw new Error('useRoomUIContext must be used within a RoomUIProvider');
    return ctx;
}
