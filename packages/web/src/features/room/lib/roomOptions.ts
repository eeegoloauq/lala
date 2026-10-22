import { AudioPresets, ScreenSharePresets, VideoPresets } from 'livekit-client';
import type { AudioCaptureOptions, RoomOptions } from 'livekit-client';
import type { AppSettings } from '../../settings/types';

/**
 * Microphone capture from the settings.
 *
 * AEC defaults on — disabling it in a voice room creates echo that every other listener
 * hears (speakerphone/laptop speakers), so the settings UI warns to only turn it off
 * with headphones. Exposing the toggle matters because starting/stopping an
 * echoCancellation:true capture retriggers Chromium's ChromeWideEchoCancellation
 * feature: the audio service stops and reopens ALL of Chrome's currently-playing output
 * streams as one mixed stream (OutputDeviceMixerImpl::StartListening), then switches
 * back ~1s after the last AEC capture stops. On Linux/PipeWire that close/reopen is
 * audible as a harsh ~0.5-1s glitch in whatever's playing. The join-time occurrence is
 * mitigated in RoomView by pre-acquiring the mic track before any call audio plays;
 * toggling AEC or switching the mic device mid-call still pays this cost, and headphone
 * users gain quality with it off. Screen-share audio uses a separate path with AEC off.
 */
export function audioCaptureFrom(settings: AppSettings): AudioCaptureOptions {
    return {
        autoGainControl: settings.autoGainControl,
        noiseSuppression: settings.noiseSuppressionMode === 'browser',
        echoCancellation: settings.echoCancellation,
        deviceId: settings.audioInputDeviceId || undefined,
    };
}

const VIDEO_RESOLUTIONS: Record<string, typeof VideoPresets.h720.resolution> = {
    h1080: VideoPresets.h1080.resolution,
    h720: VideoPresets.h720.resolution,
    vga: VideoPresets.h360.resolution,
};

/** Capture, publishing and playout options from the settings; E2EE is added per join. */
export function mediaOptionsFrom(settings: AppSettings): RoomOptions {
    return {
        audioOutput: settings.audioOutputDeviceId ? { deviceId: settings.audioOutputDeviceId } : undefined,
        audioCaptureDefaults: audioCaptureFrom(settings),
        videoCaptureDefaults: {
            resolution: VIDEO_RESOLUTIONS[settings.videoResolution] ?? VideoPresets.h720.resolution,
            deviceId: settings.videoInputDeviceId || undefined,
        },
        publishDefaults: {
            audioPreset: AudioPresets[settings.audioQuality],
            // DTX (discontinuous transmission) stops sending audio packets during
            // silence. On the music-quality presets, receivers' Opus decoders fill those
            // gaps with comfort noise — audible as hiss right after a silent participant
            // joins. Only the speech preset (voice-tuned, mono, lower bitrate) is worth
            // the tradeoff; music presets keep the stream live.
            dtx: settings.audioQuality === 'speech',
            forceStereo: settings.audioQuality.includes('Stereo'),
            videoEncoding: { maxBitrate: 1_500_000, maxFramerate: 30 },
            screenShareEncoding: ScreenSharePresets.h1080fps30.encoding,
            simulcast: settings.simulcast,
        },
        adaptiveStream: true,
        dynacast: true,
    };
}
