/**
 * Wire contract between the Lala API (packages/api) and its clients
 * (packages/web, packages/desktop). Types only — this package has no runtime
 * code and is consumed as a `file:` devDependency, so it never ships in a
 * bundle or image.
 *
 * If you change a response shape in the API, change it here; both packages
 * typecheck against this file, so drift fails CI instead of failing users.
 */

/** Room info returned by GET /api/rooms and GET /api/rooms/:id */
export interface RoomInfo {
    id: string;            // opaque room ID, also the LiveKit room name
    displayName: string;
    numParticipants: number;
    maxParticipants: number; // 0 = unlimited
    passwordSalt?: string;   // present when the room has a password; input to the client-side key derivation
    creationTime: number;    // ms since epoch
    participants: Array<{ identity: string; name: string; avatar?: string }>; // avatar: version, see avatarUrl in the web client
    adminIdentity?: string;          // creator's identity, shown as crown in UI
    permanent: boolean;              // listed in the server config; exists even when empty, can't be deleted
    canModerate: boolean;            // whether the caller (X-Lala-Device) may kick, ban, mute and delete
    canJoin: boolean;                // whether the caller may join (the config can limit a room to members)
    screenSharingParticipants: string[];
    mutedParticipants: string[];         // mic muted by the participant
    deafenedParticipants: string[];      // from participant metadata
    serverMutedParticipants: string[];   // muted by a moderator
    voicedParticipants: string[];        // given the floor by a moderator
    cannotSpeakParticipants: string[];   // people (not bots) the room's rights don't let speak; a moderator can give them the floor
    listeningParticipants: string[];     // bots in the room that receive its audio and video
    canAddBots: boolean;                 // whether the caller may add a bot here (see GET /api/rooms/:id/bots)
    addedBots: AddedBot[];               // bots people added to this room, joined or not
}

/** A bot someone added to a room; the invitation lasts until it is removed or the room ends. */
export interface AddedBot {
    identity: string;     // `bot-<key>`
    addedBy: string;      // identity of the person who added it
    addedByName: string;
}

/** One bot the caller may add to a room, from GET /api/rooms/:id/bots. */
export interface RoomBot {
    key: string;          // for POST and DELETE /api/rooms/:id/bots/:key
    identity: string;
    name: string;
    avatar?: string;      // avatar version (GET /api/avatars/<identity>?v=<version>)
    listens: boolean;     // it would hear and see everyone in the call
    online: boolean;      // the bot is connected to the server and can be added now
    added: boolean;       // someone already added it to this room
}

/** Response from GET /api/rooms/:id/bots */
export interface RoomBotsResponse { bots: RoomBot[]; }

/**
 * Events on GET /api/bot/events (server-sent events, with a bot credential). On connect the
 * stream sends `invited` for every room the bot is already added to.
 */
export interface BotInvitedEvent {
    room: { id: string; name: string };
    byName: string;
}
export interface BotRemovedEvent {
    room: { id: string };
}

/** One banned participant, from GET /api/rooms/:id/admin/bans. */
export interface RoomBan { identity: string; name: string; }
/** Response from GET /api/rooms/:id/admin/bans */
export interface BansResponse { bans: RoomBan[]; }

/**
 * Keys derived on the client from a room password (see the web client's roomKeys): the
 * server checks `key` and never sees the password or the encryption key.
 */
export interface RoomPassword {
    salt: string;
    key: string;
}

/**
 * Payload for POST /api/rooms. The caller (X-Lala-Device) becomes the creator. When a live
 * room already has this name, the response is that room and nothing is created.
 */
export interface CreateRoomRequest {
    name: string;
    password?: RoomPassword;
    maxParticipants?: number;
    stage?: boolean;   // only the creator and admins speak, show video or share a screen; others can be given the floor
}

/** One server ban, from GET /api/admin/bans; the address the person last used is banned for a day. */
export interface ServerBan { identity: string; name: string; ipBannedUntil?: number; }
/** Response from GET /api/admin/bans */
export interface ServerBansResponse { bans: ServerBan[]; }

/** The built-in themes of the web client. */
export type ThemeId = 'dark' | 'light' | 'amoled' | 'discord' | 'winxp';
export type ThemeColor = 'accent' | 'background' | 'surface' | 'sidebar' | 'text' | 'textSecondary' | 'textMuted' | 'border';
export type ThemeSize = 'radius' | 'radiusLarge' | 'avatarRadius';

/**
 * The server's default theme, from `theme:` in the config: a built-in theme with some
 * colors (#rrggbb) and sizes (px, avatarRadius also %) changed. No CSS: rules sent to
 * every client could hide what must stay visible, such as the BOT badge.
 */
export interface ServerTheme {
    base: ThemeId;
    colors: Partial<Record<ThemeColor, string>>;
    sizes: Partial<Record<ThemeSize, string>>;
}

/** Response from GET /api/me */
export interface Me {
    identity: string;   // public; what goes into the server config to make someone a member or admin
    role: 'admin' | 'member' | 'guest';
    allowed: boolean;   // false when the config turns guests away
    canCreateRooms: boolean;
    serverName: string; // `name` in the server config, "Lala" without one
    theme?: ServerTheme; // the server's default theme, when the config sets one
    avatar?: string;     // version of the caller's avatar; none stored when absent
    textChats?: boolean; // the server has text chats (and maybe rules); the client asks for them only then
}

/** The status someone picks. `invisible` reaches no one else: they see the person offline. */
export type PresenceChoice = 'online' | 'idle' | 'dnd' | 'invisible';
/** What others see; `idle` also when the person's app has had no input for a while. */
export type PresenceStatus = 'online' | 'idle' | 'dnd' | 'offline';

/**
 * One person in GET /api/presence. Everyone with the app open is listed; people who aren't
 * are listed only when the config names them (`users:`), as members who are offline.
 */
export interface PresencePerson {
    identity: string;   // the device a member used last, for one with several
    name: string;       // the display name the person used last; the config key before they ever did
    avatar?: string;    // avatar version
    status: PresenceStatus;
    profile?: PresenceProfile;
}

/** What a person shares about themselves; every field is opt-in on their own device. */
export interface PresenceProfile {
    about?: string;                     // a few lines, plain text
    timeZone?: string;                  // IANA name such as "Europe/Berlin"; viewers format the time in their own locale
    device?: 'desktop' | 'web' | 'phone';
    activity?: PresenceActivity;
}

/**
 * What the desktop app detected on its own device. Only this summary leaves it: never the
 * process list or a player's raw metadata. `image` is a version the sender uploaded
 * (cover or game icon), served by this server so viewers never reach a third party.
 */
export type PresenceActivity =
    | { kind: 'playing'; name: string; startedAt: number; image?: string; url?: string } // startedAt: server clock (ms)
    | {
        kind: 'listening';
        title: string;
        artist?: string;
        album?: string;
        player: string;                 // "Spotify", "Legato", …
        image?: string;
        url?: string;                   // the track on a public service; https on an allowlisted host only
        durationMs?: number;
        positionMs: number;             // at `positionAt` (server clock, ms); viewers move it forward while playing
        positionAt: number;
        paused?: boolean;
    };
/** Response from GET /api/presence */
export interface PresenceResponse { people: PresencePerson[]; }
/** Response from POST /api/presence/ticket: opens GET /api/events?ticket=… as the caller, for about 5 minutes. */
export interface PresenceTicketResponse { ticket: string; }
/**
 * Payload for PUT /api/presence: the caller's own status and the name to show; sent every
 * 30 seconds as the heartbeat and at once when something changes. Without `profile` the
 * stored one is dropped.
 */
export interface PresenceUpdate {
    status: PresenceChoice;
    idle: boolean;      // no input for a while; shows as idle when the status is online
    name: string;
    profile?: PresenceProfileUpdate;
}

/** The profile as a client sends it: times are relative to the request, so its clock doesn't matter. */
export interface PresenceProfileUpdate {
    about?: string;                     // at most 190 characters and 5 lines
    timeZone?: string;
    device?: 'desktop' | 'web' | 'phone';
    activity?: PresenceActivityUpdate;
}

export type PresenceActivityUpdate =
    | { kind: 'playing'; name: string; elapsedMs: number; image?: string; url?: string }
    | {
        kind: 'listening';
        title: string;
        artist?: string;
        album?: string;
        player: string;
        image?: string;
        url?: string;
        durationMs?: number;
        positionMs: number;             // now
        paused?: boolean;
    };

/** PUT /api/presence answers 204, or 200 with this when an image it names is gone: upload it again. */
export interface PresenceUpdateResponse { missing: Array<'image'>; }

/** POST /api/presence/images (the picture as the body): its version, for `image` in an activity. GET /api/presence/images/<version> serves it. */
export interface ActivityImageResponse { image: string; }

/** POST /api/me/avatar: the version of the image just stored. */
export interface AvatarResponse { avatar: string; }

/** Payload for POST /api/token; the identity comes from the X-Lala-Device header. */
export interface TokenRequest {
    room: string;
    name?: string;        // display name shown to others
    passwordKey?: string; // RoomPassword.key derived with the room's passwordSalt
}

/** Response from POST /api/token */
export interface TokenResponse {
    token: string;
    identity: string; // derived from the device ID; public
    url: string;      // LiveKit WebSocket URL to connect with this token
    canModerate: boolean;
}

/** A chat command a bot answers to, such as `!play`. */
export interface BotCommand {
    name: string;        // `!` and 1 to 24 of a-z, 0-9, `_` and `-`
    description: string; // at most 80 characters; may be empty
}

/**
 * Payload of POST /api/bot/profile (fields left out keep their value) and its response.
 * The server sets it on the bot as the lala.bot-status and lala.bot-commands attributes.
 */
export interface BotProfile {
    status: string;          // at most 100 characters; empty clears it
    commands: BotCommand[];  // at most 20, names unique
}

/** Response from GET /api/bot, for a request with a bot credential. */
export interface BotInfo extends BotProfile {
    identity: string;   // `bot-<key>`
    name: string;
    rooms: Array<{ id: string; name: string }>;
    rights: { speak: boolean; chat: boolean; listen: boolean };
}

/** Payload for POST /api/rooms/:id/admin/{kick,ban,unban} */
export interface ModerationRequest { identity: string; }
/** Payload for POST /api/rooms/:id/admin/mute */
export interface MuteRequest { identity: string; muted: boolean; }
/** Payload for POST /api/rooms/:id/admin/voice: give or take the floor */
export interface VoiceRequest { identity: string; allowed: boolean; }

/**
 * A card a bot attaches to a chat message, as the `lala.card` attribute (JSON) of the
 * `lk.chat` text stream. Clients show it only from `bot-` identities and check the lengths.
 */
export interface BotCard {
    title: string;       // at most 60 characters
    text?: string;       // at most 120 characters
    icon?: BotCardIcon;
}
export type BotCardIcon = 'bot' | 'music' | 'note' | 'star' | 'dice' | 'check';

/**
 * Participant attributes. The server sets lala.server-muted and lala.voice ('1' or
 * absent); a participant sets lala.hand on itself to ask for the floor. On a bot
 * (identity `bot-…`, which can't change its own attributes) the server also sets
 * lala.avatar, lala.bot-status and lala.bot-commands (BotCommand[] as JSON).
 */
export type ParticipantAttribute = 'lala.server-muted' | 'lala.voice' | 'lala.hand' | 'lala.bot-status' | 'lala.bot-commands';

/** Data topic of moderation events. Only the server publishes on it. */
export type ModerationTopic = 'lala.moderation';

/**
 * Sent by the server to everyone in the room after a moderation action succeeds, and when
 * someone adds a bot (`added`), removes one (`removed`) or a bot leaves for good (`left`,
 * where `byName` is the bot's own name). Clients ignore actions they don't know.
 */
export interface ModerationEvent {
    action: 'kicked' | 'banned' | 'muted' | 'unmuted' | 'voiced' | 'unvoiced' | 'added' | 'removed' | 'left' | 'moved';
    target: string;     // identity
    targetName: string;
    byName: string;
    listens?: boolean;  // on `added`: the bot will hear and see the call
    to?: { id: string; name: string };  // on `moved`: the room the target's client switches to
}

/** Response from GET /api/access. POST /api/access takes `{ password }` or `{ invite }` and sets the session cookie. */
export interface AccessStatus {
    required: boolean; // the instance has LALA_ACCESS_PASSWORD set
    granted: boolean;  // this client has a valid session (always true when not required)
}

/** Response from POST /api/access/invite: `<expiry>.<signature>`, valid for 7 days. */
export interface InviteResponse {
    invite: string;
}

// ─── Text chats ───
// Chats are named in the server config; history lives in Redis and expires (by age and
// count, both from the config). Message IDs sort in time order and are the paging cursor.

/** One text chat, from GET /api/chats. */
export interface TextChannel {
    id: string;
    name: string;
    /** A line under the name, from the config. */
    topic?: string;
    /** False in a chat only admins post in (`post: admins`). */
    canPost: boolean;
    /** The newest message's ID; the client compares it with what it has read. */
    lastMessageId?: string;
}

/** The server's rules: text from the config, shown like a chat that nobody writes in. */
export interface ServerRules {
    text: string;
    /** Changes with the text, so an edit asks everyone to agree again. */
    version: string;
    /** Whether people must agree before they can do anything else. */
    required: boolean;
    /** Whether the caller agreed to this version. */
    accepted: boolean;
    /** When this version first appeared on the server (ms): the date the rules show. */
    updatedAt: number;
}

/** Response from GET /api/chats */
export interface ChannelsResponse {
    channels: TextChannel[];
    rules?: ServerRules;
    /** Messages that mention the caller, newest last (the server keeps the latest 50). */
    mentions: Array<{ channel: string; id: string }>;
}

/** A file kept with a message, deleted with it or when the server's file space runs out. */
export interface ChatAttachment {
    id: string;
    name: string;
    /** The type the server detected from the content, not the uploader's claim. */
    type: string;
    size: number;
    /** Images and videos: the size to reserve before it loads. */
    width?: number;
    height?: number;
    /** Hidden behind a blur until the viewer clicks it. */
    spoiler?: boolean;
    /** Absent once the file was removed to make space. */
    url?: string;
}

/** Reactions on a message: emoji to who reacted (at most 20 different emoji per message). */
export type ChatReactions = Record<string, string[]>;

export interface ChatMessage {
    id: string;
    channel: string;
    identity: string;
    /** The sender's name when they sent it. */
    name: string;
    /** With formatting marks; a mention is `<@identity>`. */
    text: string;
    /** Milliseconds since the epoch. */
    at: number;
    attachments?: ChatAttachment[];
    reactions?: ChatReactions;
    /** The message this one answers, as it was then (the original may be gone since). */
    reply?: ChatReplyPreview;
    /** Pinned messages are kept when the history around them expires. */
    pinned?: boolean;
}

/** What a reply shows of its original: who wrote it and its text, cut to 200 characters. */
export interface ChatReplyPreview {
    id: string;
    identity: string;
    name: string;
    text: string;
}

/** Response from GET /api/chats/:id/pins (at most 50, newest pin first). */
export interface PinsResponse { messages: ChatMessage[]; }

/** Response from GET /api/chats/:id/messages?before=<id>&limit=<n>; oldest first. */
export interface MessagesResponse {
    messages: ChatMessage[];
    /** Whether older messages exist. */
    more: boolean;
}

/** Body of POST /api/chats/:id/files is the file itself; this is the answer. */
export interface UploadResponse { attachment: ChatAttachment; }

/** Body of POST /api/chats/:id/messages */
export interface SendMessageRequest {
    text: string;
    /** Uploaded attachment IDs, each with whether it is a spoiler. */
    attachments?: Array<{ id: string; spoiler?: boolean }>;
    /** The ID of the message this answers. */
    replyTo?: string;
}

/** Event stream: `chat_message`, `chat_deleted`, `chat_reactions` and `chat_pinned`. */
export type ChatEvent =
    | { type: 'chat_message'; message: ChatMessage }
    | { type: 'chat_deleted'; channel: string; id: string }
    | { type: 'chat_reactions'; channel: string; id: string; reactions: ChatReactions }
    | { type: 'chat_pinned'; channel: string; message: ChatMessage };

/**
 * Error codes in API `{ error: <code> }` responses, plus two codes the web
 * client synthesizes locally: 'rate_limited' (HTTP 429 from the rate
 * limiter, which sends no body code) and 'server_unavailable' (network
 * failure — no response at all).
 */
export type ApiErrorCode =
    | 'access_required'
    | 'banned'
    | 'channel_not_found'
    | 'bot_not_found'
    | 'bot_offline'
    | 'forbidden'
    | 'invalid_bot_credential'
    | 'invalid_input'
    | 'invalid_invite'
    | 'invalid_json'
    | 'invalid_signature'
    | 'invalid_ticket'
    | 'identity_required'
    | 'not_allowed'
    | 'not_found'
    | 'password_required'
    | 'password_room'
    | 'payload_too_large'
    | 'rate_limited'
    | 'room_full'
    | 'room_not_found'
    | 'room_required'
    | 'rules_required'
    | 'server_error'
    | 'server_unavailable'
    | 'too_many_connections'
    | 'wrong_password';
