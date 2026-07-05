/**
 * Bridges the room-scoped admin action broadcast (data-channel "lala_admin" event +
 * local system message + TTS) to admin actions triggered from OUTSIDE the room UI —
 * specifically ChannelSidebar, which can show/right-click participants of rooms the
 * user is not currently connected to.
 *
 * Plain module state (not a React store): only ever read at click time inside an
 * event handler, never during render, so no subscription/re-render machinery is
 * needed. Set by useAdminActions while its owning RoomShell is mounted (i.e. while
 * connected to a room), cleared on unmount.
 */
export interface AdminBridge {
    /** Room this client currently has a live LiveKit connection to. */
    roomId: string;
    broadcast: (action: string, targetIdentity: string) => void;
    onError: (err: unknown) => void;
}

let activeBridge: AdminBridge | null = null;

export function setAdminBridge(bridge: AdminBridge | null): void {
    activeBridge = bridge;
}

export function getAdminBridge(): AdminBridge | null {
    return activeBridge;
}
