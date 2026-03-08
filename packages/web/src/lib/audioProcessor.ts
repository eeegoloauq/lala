import type { AudioProcessorOptions, TrackProcessor } from 'livekit-client';
import { Track } from 'livekit-client';

const WORKLET_URL = '/lala-audio-worklet.js';

export interface AudioProcessorConfig {
    rnnoise: boolean;
    gateThreshold: number; // 0 = disabled, otherwise dBFS (e.g. -40)
}

export class LalaAudioProcessor implements TrackProcessor<Track.Kind.Audio, AudioProcessorOptions> {
    name = 'lala-audio';
    processedTrack?: MediaStreamTrack;

    private ctx?: AudioContext;
    private sourceNode?: MediaStreamAudioSourceNode;
    private workletNode?: AudioWorkletNode;
    private destinationNode?: MediaStreamAudioDestinationNode;
    private config: AudioProcessorConfig;

    constructor(config: AudioProcessorConfig) {
        this.config = config;
    }

    async init(opts: AudioProcessorOptions): Promise<void> {
        this.ctx = new AudioContext();
        await this.ctx.audioWorklet.addModule(WORKLET_URL, { credentials: 'omit' });

        this.sourceNode = this.ctx.createMediaStreamSource(new MediaStream([opts.track]));
        this.workletNode = new AudioWorkletNode(this.ctx, 'lala-audio-processor');
        this.destinationNode = this.ctx.createMediaStreamDestination();

        this.sourceNode.connect(this.workletNode);
        this.workletNode.connect(this.destinationNode);

        // Send initial config
        this.workletNode.port.postMessage({ rnnoise: this.config.rnnoise });
        this.workletNode.port.postMessage({ gateThreshold: this.config.gateThreshold });

        this.processedTrack = this.destinationNode.stream.getAudioTracks()[0];
    }

    updateConfig(config: Partial<AudioProcessorConfig>) {
        this.config = { ...this.config, ...config };
        if (!this.workletNode) return;
        if (config.rnnoise !== undefined) this.workletNode.port.postMessage({ rnnoise: config.rnnoise });
        if (config.gateThreshold !== undefined) this.workletNode.port.postMessage({ gateThreshold: config.gateThreshold });
    }

    async restart(opts: AudioProcessorOptions): Promise<void> {
        await this.destroy();
        await this.init(opts);
    }

    async destroy(): Promise<void> {
        this.workletNode?.port.postMessage({ rnnoise: false });
        this.sourceNode?.disconnect();
        this.workletNode?.disconnect();
        this.destinationNode?.disconnect();
        await this.ctx?.close();
        this.ctx = undefined;
        this.sourceNode = undefined;
        this.workletNode = undefined;
        this.destinationNode = undefined;
        this.processedTrack = undefined;
    }
}
