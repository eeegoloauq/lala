import { useEffect, useRef } from 'react';
import type { PresenceChoice, PresenceProfileUpdate } from '../lib/types';
import { getPresence, putPresence } from '../lib/api';
import { ApiError } from '../lib/types';
import { presenceChanged, setMyStatus, setPresence, shownStatus, usePresenceChanges } from '../lib/presence';
import { IS_DEMO, IS_ELECTRON } from '../lib/env';
import { activityUpdate, forgetUploadedImage, setDetectedActivity, useDetectedActivity } from '../lib/activity';
import { useIdle } from './useIdle';

/** No input for this long shows someone as idle; shorter in the demo, so a visitor sees it happen. */
const IDLE_AFTER_MS = IS_DEMO ? 60_000 : 10 * 60_000;
/** The heartbeat: the server drops a device that stops sending it (a computer put to sleep). */
const BEAT_MS = 30_000;

/** What this device shares with its status (Settings, Profile). */
export interface ProfileSettings {
    about: string;
    shareLocalTime: boolean;
    shareActivity: 'ask' | 'on' | 'off';
    shareBrowserMedia: boolean;
}

/** A change waits this long for others right after it (a track skipped twice is one update). */
const SETTLE_MS = 1500;

function deviceKind(): PresenceProfileUpdate['device'] {
    if (IS_ELECTRON) return 'desktop';
    return window.matchMedia('(pointer: coarse) and (max-width: 900px)').matches ? 'phone' : 'web';
}

/**
 * Tells the server this device's status and profile, every 30 seconds and shortly after each
 * change, and keeps the presence store current: fetched again on every `presence_updated`
 * event (see useRooms). In the desktop app it also starts detection while it may be shown.
 */
export function usePresenceSync(identity: string | undefined, name: string, choice: PresenceChoice, paused: boolean, profile: ProfileSettings): void {
    const idle = useIdle(IDLE_AFTER_MS, identity);
    const { about, shareLocalTime, shareActivity, shareBrowserMedia } = profile;

    // Detection runs while sharing is on or not yet decided: the question comes when it first
    // sees something. Nothing it sees leaves the device before the answer.
    useEffect(() => {
        const api = window.electronAPI;
        if (!api?.watchActivity || !api.onActivity || shareActivity === 'off') return;
        const unsubscribe = api.onActivity(setDetectedActivity);
        api.watchActivity({ browsers: shareBrowserMedia });
        return () => {
            unsubscribe();
            api.watchActivity?.(null);
            setDetectedActivity(null);
        };
    }, [shareActivity, shareBrowserMedia]);
    const detected = useDetectedActivity();

    // Paused while the server's rules wait to be agreed to (it refuses presence until then);
    // agreeing sends at once, so others see the name and status right away.
    const sentOnce = useRef(false);
    useEffect(() => {
        setMyStatus(shownStatus(choice, idle));
        if (!identity || !name || paused) return;
        let alive = true;
        const send = async (retried = false) => {
            const activity = shareActivity === 'on' && choice !== 'invisible' && detected ? await activityUpdate(detected) : undefined;
            if (!alive) return;
            const shared: PresenceProfileUpdate = {
                about: about.trim() || undefined,
                timeZone: shareLocalTime ? Intl.DateTimeFormat().resolvedOptions().timeZone : undefined,
                device: deviceKind(),
                activity,
            };
            try {
                const answer = await putPresence({ status: choice, idle, name, profile: shared });
                // The server lost the picture (it keeps unused ones only briefly): upload it again, once.
                if (answer?.missing.includes('image') && detected?.image && !retried) {
                    forgetUploadedImage(detected.image);
                    await send(true);
                }
            } catch { /* the next beat tries again */ }
        };
        const first = setTimeout(() => void send(), sentOnce.current ? SETTLE_MS : 0);
        sentOnce.current = true;
        const timer = setInterval(() => void send(), BEAT_MS);
        return () => { alive = false; clearTimeout(first); clearInterval(timer); };
    }, [identity, name, choice, idle, paused, about, shareLocalTime, shareActivity, detected]);

    // The demo announces its people's changes with its room changes.
    useEffect(() => {
        if (!IS_DEMO) return;
        let unsubscribe: (() => void) | undefined;
        let active = true;
        import('../features/demo/server').then(demo => {
            if (active) unsubscribe = demo.onRoomsChanged(presenceChanged);
        });
        return () => { active = false; unsubscribe?.(); };
    }, []);

    // A burst of events is one request in flight and at most one after it.
    const changes = usePresenceChanges();
    const loading = useRef<Promise<void> | null>(null);
    const stale = useRef(false);
    useEffect(() => {
        if (loading.current) {
            stale.current = true;
            return;
        }
        const run = async () => {
            do {
                stale.current = false;
                try {
                    setPresence(await getPresence());
                } catch (err) {
                    // A server without presence answers 404; the people list then stays away.
                    if (err instanceof ApiError && err.status === 404) setPresence(null);
                }
            } while (stale.current);
            loading.current = null;
        };
        loading.current = run();
    }, [changes, identity]);
}
