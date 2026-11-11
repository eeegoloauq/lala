import type { Participant } from 'livekit-client';
import type { BotCommand } from './types';

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

/** What a bot in the call shows and may do; the rights come from its LiveKit permission. */
export interface BotDetails {
    name: string;
    status: string;
    commands: BotCommand[];
    speaks: boolean;
    chats: boolean;
    listens: boolean;
}

// The server checks these before setting them; a client still reads nothing it can't show.
const MAX_STATUS = 100;
const MAX_COMMANDS = 20;
const COMMAND = /^![a-z0-9][a-z0-9_-]{0,23}$/;

export function parseBotStatus(value: string | undefined): string {
    return typeof value === 'string' ? Array.from(value).slice(0, MAX_STATUS).join('') : '';
}

export function parseBotCommands(value: string | undefined): BotCommand[] {
    if (!value) return [];
    let parsed: unknown;
    try { parsed = JSON.parse(value); } catch { return []; }
    if (!Array.isArray(parsed)) return [];
    return parsed.slice(0, MAX_COMMANDS).flatMap((c: unknown) => {
        const { name, description } = (c ?? {}) as Record<string, unknown>;
        return typeof name === 'string' && COMMAND.test(name)
            ? [{ name, description: typeof description === 'string' ? description.slice(0, 80) : '' }]
            : [];
    });
}

// TrackSource.MICROPHONE from @livekit/protocol, which livekit-client does not re-export.
const MICROPHONE = 2;

/** A bot participant's details, or undefined for people. */
export function botDetailsOf(participant: Participant): BotDetails | undefined {
    if (!isBotIdentity(participant.identity)) return undefined;
    const permission = participant.permissions;
    return {
        name: participant.name || participant.identity,
        status: parseBotStatus(participant.attributes['lala.bot-status']),
        commands: parseBotCommands(participant.attributes['lala.bot-commands']),
        speaks: !!permission?.canPublish && (permission.canPublishSources.length === 0 || permission.canPublishSources.includes(MICROPHONE)),
        chats: !!permission?.canPublishData,
        listens: permission?.canSubscribe === true,
    };
}
