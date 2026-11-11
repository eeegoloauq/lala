import type { Participant } from 'livekit-client';

/**
 * Bots get identities starting with `bot-` from the server, and nothing else can: device
 * identities are hex. So the prefix is what marks a bot, and a bot can't hide it.
 */
export const isBotIdentity = (identity: string) => identity.startsWith('bot-');

/**
 * Whether a bot receives the call's audio and video. Read from the permission LiveKit
 * enforces, not from anything the bot says about itself.
 */
export const botListens = (participant: Participant) =>
    isBotIdentity(participant.identity) && participant.permissions?.canSubscribe === true;
