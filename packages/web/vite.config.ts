import { createHash } from 'node:crypto';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

// Background blur runs MediaPipe. The library would load its WebAssembly from a CDN and
// the segmentation model from Google; the app serves both from /mediapipe instead, so no
// third party sees who turns blur on and the CSP stays at 'self'. The WebAssembly comes
// from the installed @mediapipe/tasks-vision, the version the library is built against.
const WASM_DIR = fileURLToPath(new URL('./node_modules/@mediapipe/tasks-vision/wasm', import.meta.url));
const MODEL = {
    name: 'selfie_segmenter.tflite',
    url: 'https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_segmenter/float16/1/selfie_segmenter.tflite',
    sha256: '191ac9529ae506ee0beefa6b2c945a172dab9d07d1e802a290a4e4038226658b',
};
const MODEL_CACHE = fileURLToPath(new URL(`./node_modules/.cache/mediapipe/${MODEL.name}`, import.meta.url));

/** The model is not on npm: fetched once by pinned version and checksum, then cached. */
async function loadModel(): Promise<Buffer> {
    const sha256 = (data: Buffer) => createHash('sha256').update(data).digest('hex');
    const cached = await readFile(MODEL_CACHE).catch(() => null);
    if (cached && sha256(cached) === MODEL.sha256) return cached;
    const res = await fetch(MODEL.url);
    if (!res.ok) throw new Error(`Downloading ${MODEL.url} failed: ${res.status}`);
    const model = Buffer.from(await res.arrayBuffer());
    if (sha256(model) !== MODEL.sha256) throw new Error(`${MODEL.url} does not match its pinned checksum`);
    await mkdir(dirname(MODEL_CACHE), { recursive: true });
    await writeFile(MODEL_CACHE, model);
    return model;
}

async function mediapipeFiles(): Promise<Map<string, Buffer>> {
    const files = new Map<string, Buffer>();
    for (const name of await readdir(WASM_DIR)) files.set(name, await readFile(`${WASM_DIR}/${name}`));
    files.set(MODEL.name, await loadModel());
    return files;
}

function mediapipeAssets(): Plugin {
    let files: Promise<Map<string, Buffer>> | undefined;
    const getFiles = () => (files ??= mediapipeFiles());
    return {
        name: 'lala-mediapipe-assets',
        configureServer(server) {
            server.middlewares.use('/mediapipe', async (req, res, next) => {
                const file = (await getFiles()).get((req.url ?? '').replace(/^\//, ''));
                if (!file) return next();
                if (req.url?.endsWith('.wasm')) res.setHeader('Content-Type', 'application/wasm');
                res.end(file);
            });
        },
        async generateBundle() {
            for (const [name, source] of await getFiles()) {
                this.emitFile({ type: 'asset', fileName: `mediapipe/${name}`, source });
            }
        },
    };
}

export default defineConfig({
    plugins: [react(), mediapipeAssets()],
    server: {
        port: 3000,
        host: '0.0.0.0',
        proxy: {
            '/api': {
                target: 'http://localhost:3001',
                changeOrigin: true,
            },
        },
    },
    build: {
        outDir: 'dist',
        sourcemap: false,
    },
});
