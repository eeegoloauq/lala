import type { ParticipantInfo } from 'livekit-server-sdk';
import { botOf, isBotIdentity } from './bots';
import { getProfile, dropProfilesExcept, publishProfile } from './botProfile';
import { config } from './config';
import { getRoomService, isNotFound } from './livekit';
import { attributesFor, can, permissionFor } from './rights';
import { flagsOf, getRoom } from './rooms';
import { dropStaleInvitations } from './botInvites';

const ignoreNotFound = (err: unknown) => { if (!isNotFound(err)) throw err; };

/**
 * Brings a bot in a room in line with the config: removed, with the tokens it holds
 * revoked, when it may no longer be there; otherwise given its current rights, name,
 * avatar, status and commands.
 */
export async function applyBotConfig(roomId: string, participant: Pick<ParticipantInfo, 'identity' | 'name'>): Promise<void> {
    const bot = botOf(participant.identity);
    const room = await getRoom(roomId);
    const service = getRoomService();
    const flags = await flagsOf(roomId, participant.identity);
    if (!bot || !room || !can(bot.identity, room, 'join', flags.invited)) {
        const revokeTokenTs = BigInt(Math.floor(Date.now() / 1000) + 1);
        await service.removeParticipant(roomId, participant.identity, { revokeTokenTs }).catch(ignoreNotFound);
        console.log(`[bots] removed ${participant.identity} from ${roomId}: not allowed there by the config`);
        return;
    }
    await service.updateParticipant(roomId, bot.identity, {
        permission: permissionFor(bot.identity, room, flags),
        attributes: attributesFor(flags),
        ...(participant.name !== bot.name && { name: bot.name }),
    }).catch(ignoreNotFound);
    await publishProfile(bot, await getProfile(bot.identity), [roomId]);
}

/** At startup: the config may have dropped a bot or changed what it may do since it joined. */
export async function syncBots(): Promise<void> {
    await dropProfilesExcept(new Set(config().bots.keys()));
    await dropStaleInvitations();
    const service = getRoomService();
    for (const room of await service.listRooms()) {
        const participants = await service.listParticipants(room.name).catch((err) => {
            if (isNotFound(err)) return [];
            throw err;
        });
        for (const p of participants.filter((p) => isBotIdentity(p.identity))) await applyBotConfig(room.name, p);
    }
}
