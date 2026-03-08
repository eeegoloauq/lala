import createRNNWasmModuleSync from '/rnnoise-sync.js';

const FRAME_SIZE = 480; // RNNoise: exactly 480 samples (10ms @ 48kHz)
const RING_SIZE = 2048; // ring buffer size, must be > 2 * FRAME_SIZE

class LalaAudioProcessor extends AudioWorkletProcessor {
    constructor() {
        super();
        // Ring buffers — no GC pressure, pre-allocated
        this._inRing  = new Float32Array(RING_SIZE);
        this._outRing = new Float32Array(RING_SIZE);
        this._inW = 0; this._inR = 0;
        this._outW = 0; this._outR = 0;
        // Reusable frame buffer
        this._frame = new Float32Array(FRAME_SIZE);

        this._rnnoiseEnabled = false;
        this._gateThreshold = 0;
        this._m = null;
        this._state = null;
        this._inBuf = null;
        this._outBuf = null;

        this.port.onmessage = (e) => {
            if (e.data.rnnoise !== undefined) this._setRNNoise(e.data.rnnoise);
            if (e.data.gateThreshold !== undefined) this._gateThreshold = e.data.gateThreshold;
        };
    }

    _avail(w, r) { return (w - r + RING_SIZE) % RING_SIZE; }

    _setRNNoise(enabled) {
        if (enabled && !this._m) {
            this._m = createRNNWasmModuleSync();
            this._state = this._m._rnnoise_create();
            this._inBuf  = this._m._malloc(FRAME_SIZE * 4);
            this._outBuf = this._m._malloc(FRAME_SIZE * 4);
        } else if (!enabled && this._m) {
            this._m._rnnoise_destroy(this._state);
            this._m._free(this._inBuf);
            this._m._free(this._outBuf);
            this._m = null; this._state = null;
            this._inBuf = null; this._outBuf = null;
        }
        this._rnnoiseEnabled = enabled;
    }

    _processFrame() {
        // Silence gate on the reusable frame buffer
        if (this._gateThreshold !== 0) {
            let sum = 0;
            for (let i = 0; i < FRAME_SIZE; i++) sum += this._frame[i] * this._frame[i];
            const db = 20 * Math.log10(Math.max(Math.sqrt(sum / FRAME_SIZE), 1e-9));
            if (db < this._gateThreshold) {
                this._frame.fill(0);
                return;
            }
        }

        if (!this._rnnoiseEnabled || !this._m) return;

        for (let i = 0; i < FRAME_SIZE; i++) {
            this._m.HEAPF32[(this._inBuf >> 2) + i] = this._frame[i] * 32768;
        }
        this._m._rnnoise_process_frame(this._state, this._outBuf, this._inBuf);
        for (let i = 0; i < FRAME_SIZE; i++) {
            this._frame[i] = this._m.HEAPF32[(this._outBuf >> 2) + i] / 32768;
        }
    }

    process(inputs, outputs) {
        const input  = inputs[0]?.[0];
        const output = outputs[0]?.[0];
        if (!input || !output) return true;

        // Write input samples into ring
        for (let i = 0; i < input.length; i++) {
            this._inRing[this._inW] = input[i];
            this._inW = (this._inW + 1) % RING_SIZE;
        }

        // Process complete 480-sample frames from input ring → output ring
        while (this._avail(this._inW, this._inR) >= FRAME_SIZE) {
            for (let i = 0; i < FRAME_SIZE; i++) {
                this._frame[i] = this._inRing[this._inR];
                this._inR = (this._inR + 1) % RING_SIZE;
            }
            this._processFrame();
            for (let i = 0; i < FRAME_SIZE; i++) {
                this._outRing[this._outW] = this._frame[i];
                this._outW = (this._outW + 1) % RING_SIZE;
            }
        }

        // Read output samples from ring (silence if not enough yet — first ~10ms only)
        for (let i = 0; i < output.length; i++) {
            if (this._avail(this._outW, this._outR) > 0) {
                output[i] = this._outRing[this._outR];
                this._outR = (this._outR + 1) % RING_SIZE;
            } else {
                output[i] = 0;
            }
        }

        return true;
    }
}

registerProcessor('lala-audio-processor', LalaAudioProcessor);
