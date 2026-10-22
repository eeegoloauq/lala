import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// Serves the production web build the way nginx does where it matters to the app: under
// the same Content-Security-Policy, read from the nginx template so the two cannot drift.
const template = readFileSync(new URL('../packages/web/default.conf.template', import.meta.url), 'utf8');
const csp = template.match(/add_header Content-Security-Policy\s+"([^"]+)"/)[1]
    .replace('${CSP_CONNECT_SRC}', 'ws://127.0.0.1:7880 http://127.0.0.1:7880');

export default {
    root: fileURLToPath(new URL('../packages/web', import.meta.url)),
    preview: {
        host: '127.0.0.1',
        port: 3000,
        strictPort: true,
        headers: { 'Content-Security-Policy': csp },
        proxy: { '/api': { target: 'http://127.0.0.1:3001', changeOrigin: true } },
    },
};
