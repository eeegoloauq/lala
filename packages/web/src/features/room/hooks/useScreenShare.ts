import { useState } from 'react';
import i18next from 'i18next';
import { useLocalParticipant, useTracks, isTrackReference } from '@livekit/components-react';
import { Track } from 'livekit-client';
import type { VideoEncoding, VideoResolution } from 'livekit-client';
import { SCREEN_SHARE_FPS_STEPS, SCREEN_SHARE_BITRATE_STEPS } from '../../../lib/constants';

export interface ScreenShareQuality {
    id: string;
    label: string;
    description: string;
    encoding: VideoEncoding;
    resolution?: VideoResolution;
}

export function getScreenShareQuality(fpsIdx: number, brIdx: number): ScreenShareQuality {
    const fps = SCREEN_SHARE_FPS_STEPS[fpsIdx] ?? 30;
    const mbps = SCREEN_SHARE_BITRATE_STEPS[brIdx] ?? 5;

    let resolution: VideoResolution | undefined;
    if (mbps <= 1) resolution = { width: 854, height: 480 };
    else if (mbps <= 2) resolution = { width: 1280, height: 720 };
    else if (mbps <= 5) resolution = { width: 1920, height: 1080 };
    else if (mbps <= 8) resolution = { width: 2560, height: 1440 };
    else resolution = undefined; // original / 4K

    return {
        id: `${mbps}mbps${fps}fps`,
        label: i18next.t('screenShare.qualityLabel', { mbps, fps }),
        description: '',
        encoding: { maxBitrate: mbps * 1_000_000, maxFramerate: fps },
        resolution,
    };
}

export function useScreenShare() {
    const { localParticipant } = useLocalParticipant();
    const screenTracks = useTracks([Track.Source.ScreenShare]);
    const [pending, setPending] = useState(false);

    const enabled = screenTracks.some(
        (t) =>
            t.participant.identity === localParticipant.identity &&
            isTrackReference(t) &&
            !t.publication.isMuted,
    );

    const start = async (quality: ScreenShareQuality, sourceId?: string, audio = true) => {
        setPending(true);
        try {
            const isElectron = typeof window !== 'undefined' && !!window.electronAPI?.isElectron;
            if (isElectron && sourceId) {
                console.log('[Lala] Screen share: setting source via IPC:', sourceId);
                await window.electronAPI!.setScreenShareSource(sourceId);
            } else if (isElectron && !sourceId) {
                console.warn('[Lala] Screen share: Electron detected but no sourceId! This will cancel in main process.');
            }
            await localParticipant.setScreenShareEnabled(
                true,
                { audio, systemAudio: audio ? 'include' : 'exclude', resolution: quality.resolution },
                { videoEncoding: quality.encoding, simulcast: false, dtx: false, red: false },
            );
        } finally {
            setPending(false);
        }
    };

    const stop = async () => {
        setPending(true);
        try {
            await localParticipant.setScreenShareEnabled(false);
        } finally {
            setPending(false);
        }
    };

    return { enabled, pending, start, stop };
}
