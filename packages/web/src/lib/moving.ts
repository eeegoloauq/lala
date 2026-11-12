import type { TFunction } from 'i18next';
import { ApiError, type RoomInfo } from './types';
import { errorMessage } from './errorMessage';
import { isBotIdentity } from './bots';
import { createStore } from './store';

export interface MoveTarget { id: string; name: string }

/**
 * Rooms a moderator can move someone in `fromId` to: the caller moderates both, and the
 * destination has no password (the server never has a room's key to give anyone). The
 * server checks the rest (bans, members only, a full room) and says why it refuses.
 * Bots join by their config, so they aren't moved.
 */
export function moveTargets(rooms: readonly RoomInfo[], fromId: string, identity: string): MoveTarget[] {
    if (isBotIdentity(identity) || !rooms.find(r => r.id === fromId)?.canModerate) return [];
    return rooms
        .filter(r => r.id !== fromId && r.canModerate && !r.passwordSalt)
        .map(r => ({ id: r.id, name: r.displayName }));
}

// The room list for menus in the call, which don't get it as a prop; written by App.
const roomsStore = createStore<readonly RoomInfo[]>([]);
export const setListedRooms = (rooms: readonly RoomInfo[]) => roomsStore.set(rooms);
export const moveTargetsInList = (fromId: string, identity: string) => moveTargets(roomsStore.get(), fromId, identity);

// Who moved this client, shown once in the room it was moved to.
let movedBy: { roomId: string; name: string } | null = null;
export function noteMovedBy(roomId: string, name: string): void { movedBy = { roomId, name }; }
export function takeMovedBy(roomId: string): string | null {
    const moved = movedBy;
    movedBy = null;
    return moved?.roomId === roomId ? moved.name : null;
}

const MOVE_ERRORS = ['banned', 'not_allowed', 'room_full', 'not_found'];

/** Why a move was refused: these codes are about the person moved, not the caller. */
export function moveErrorMessage(t: TFunction, err: unknown): string {
    return err instanceof ApiError && MOVE_ERRORS.includes(err.code) ? t(`moveErrors.${err.code}`) : errorMessage(t, err);
}
