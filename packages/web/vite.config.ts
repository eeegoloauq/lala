import { execFileSync } from 'node:child_process';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { fetchPinned } from './scripts/pinned.ts';
import { emojiData } from './scripts/emojiData.ts';

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

/** The model is not on npm: fetched once by pinned version and checksum, then cached. */
const loadModel = () => fetchPinned({ url: MODEL.url, sha256: MODEL.sha256, cache: `mediapipe/${MODEL.name}` });

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

const DEMO_DIR = fileURLToPath(new URL('./src/features/demo/', import.meta.url));
const DEMO_STUB = '\0lala-demo-stub';

/**
 * The demo code is reached only through dynamic imports behind IS_DEMO. Those calls fold
 * away in the regular build, but the bundler would still write their chunks (and the
 * screenshot they use), so outside demo mode the directory resolves to an empty module.
 */
function demoOnly(mode: string): Plugin {
    return {
        name: 'lala-demo-only',
        enforce: 'pre',
        resolveId(source, importer) {
            if (mode === 'demo' || !importer || !source.startsWith('.')) return null;
            return resolve(dirname(importer), source).startsWith(DEMO_DIR) ? DEMO_STUB : null;
        },
        load(id) {
            return id === DEMO_STUB ? 'export {};' : null;
        },
    };
}

/**
 * The demo's #announcements shows Lala's latest releases: the messages of the newest `v*`
 * tags, read from git when the demo is built (`virtual:lala-releases`). Without tags (a
 * shallow clone) the list is empty and the chat says so.
 */
const RELEASES_ID = 'virtual:lala-releases';
function demoReleases(): Plugin {
    return {
        name: 'lala-demo-releases',
        enforce: 'pre',
        resolveId(source) {
            return source === RELEASES_ID ? `\0${RELEASES_ID}` : null;
        },
        load(id) {
            if (id !== `\0${RELEASES_ID}`) return null;
            let releases: Array<{ version: string; date: string; notes: string }> = [];
            try {
                const out = execFileSync('git', ['for-each-ref', 'refs/tags/v*', '--sort=-creatordate', '--count=3',
                    '--format=%(refname:short)%00%(creatordate:iso-strict)%00%(contents)%00%00'], { encoding: 'utf8' });
                releases = out.split('\0\0').map((r: string) => r.replace(/^\n/, '')).filter(Boolean).map((r: string) => {
                    const [version, date, notes] = r.split('\0');
                    return { version, date, notes: notes.trim() };
                });
            } catch {
                // Not a git checkout: no releases to show.
            }
            return `export default ${JSON.stringify(releases)};`;
        },
    };
}

/**
 * Static hosts such as GitHub Pages have no SPA fallback; they serve 404.html for any
 * unknown path, so a copy of the app there makes room links like /room/<id> open.
 */
function spaFallback(): Plugin {
    return {
        name: 'lala-spa-fallback',
        // After the HTML plugin has written index.html with the hashed asset links.
        async writeBundle({ dir }) {
            if (dir) await writeFile(`${dir}/404.html`, await readFile(`${dir}/index.html`));
        },
    };
}

export default defineConfig(({ mode }) => ({
    // `--mode demo` builds the static demo: the API is answered in the page (src/lib/env.ts).
    plugins: [react(), mediapipeAssets(), emojiData(), demoOnly(mode), ...(mode === 'demo' ? [spaFallback(), demoReleases()] : [])],
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
        outDir: mode === 'demo' ? 'dist-demo' : 'dist',
        sourcemap: false,
    },
}));
