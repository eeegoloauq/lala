import { useSyncExternalStore } from 'react';
import type { PresenceActivityUpdate } from './types';
import type { DetectedActivity } from '../types/electron';
import { uploadActivityImage } from './api';
import { createStore } from './store';

/**
 * What the desktop app sees played on this computer (main/activity.js), and its conversion
 * into what the server takes: durations instead of this computer's times, and the image as a
 * version uploaded to the server instead of a data URL.
 */
const detectedStore = createStore<DetectedActivity | null>(null);
export const setDetectedActivity = (activity: DetectedActivity | null) => detectedStore.set(activity);
export const useDetectedActivity = () => useSyncExternalStore(detectedStore.subscribe, detectedStore.get);

// Image data URL -> version on the server; one upload per picture while the app runs.
const uploaded = new Map<string, Promise<string | undefined>>();

/** Uploads an image again next time, after the server said it no longer has it. */
export const forgetUploadedImage = (dataUrl: string) => uploaded.delete(dataUrl);

function imageVersion(dataUrl: string): Promise<string | undefined> {
    let version = uploaded.get(dataUrl);
    if (!version) {
        // A failed upload shows the activity without its picture and tries again next time.
        version = uploadActivityImage(dataUrl).catch(() => { uploaded.delete(dataUrl); return undefined; });
        uploaded.set(dataUrl, version);
    }
    return version;
}

/** The activity as the server takes it, relative to now. */
export async function activityUpdate(activity: DetectedActivity, now = Date.now()): Promise<PresenceActivityUpdate> {
    const image = activity.image ? await imageVersion(activity.image) : undefined;
    if (activity.kind === 'playing') {
        return { kind: 'playing', name: activity.name, elapsedMs: Math.max(0, now - activity.startedAt), image, url: activity.url };
    }
    const moved = activity.paused ? 0 : now - activity.positionAt;
    return {
        kind: 'listening', title: activity.title, artist: activity.artist, album: activity.album, player: activity.player,
        image, url: activity.url, durationMs: activity.durationMs, paused: activity.paused,
        positionMs: Math.max(0, Math.min(activity.positionMs + moved, activity.durationMs ?? Infinity)),
    };
}
