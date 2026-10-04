import { defineConfig } from '@playwright/test';

export const SERVER_PASSWORD = 'e2e-server-password';

// Builds and starts the real stack: LiveKit, Redis, the API and the production web bundle
// served by `vite preview` (which proxies /api to :3001 like nginx does).
export default defineConfig({
    testDir: './tests',
    timeout: 90_000,
    workers: 1,
    reporter: [['list']],
    use: {
        baseURL: 'http://127.0.0.1:3000',
        permissions: ['microphone', 'camera'],
        launchOptions: {
            args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required'],
        },
    },
    webServer: [
        {
            command: './livekit.sh',
            url: 'http://127.0.0.1:7880',
            reuseExistingServer: false,
            timeout: 120_000,
        },
        {
            command: './redis.sh',
            port: 6380,
            reuseExistingServer: false,
            timeout: 300_000,
        },
        {
            command: 'npm ci && npm run build && node dist/index.js',
            cwd: '../packages/api',
            url: 'http://127.0.0.1:3001/api/health',
            reuseExistingServer: false,
            timeout: 120_000,
            env: {
                LALA_ACCESS_PASSWORD: SERVER_PASSWORD,
                LIVEKIT_URL: 'ws://127.0.0.1:7880',
                LIVEKIT_API_KEY: 'e2e-key',
                LIVEKIT_API_SECRET: 'e2e-secret-not-used-outside-tests-000',
                REDIS_URL: 'redis://127.0.0.1:6380',
            },
        },
        {
            command: 'npm ci && npm run build && npx vite preview --host 127.0.0.1 --port 3000 --strictPort',
            cwd: '../packages/web',
            url: 'http://127.0.0.1:3000',
            reuseExistingServer: false,
            timeout: 180_000,
            env: { VITE_LIVEKIT_URL: 'ws://127.0.0.1:7880' },
        },
    ],
});
