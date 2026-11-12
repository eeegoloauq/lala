import { defineConfig } from '@playwright/test';

export const ADMIN_CLAIM = 'e2e-admin-claim-not-used-outside-tests';
export const SERVER_PASSWORD = 'e2e-server-password';
export const LIVEKIT_KEY = 'e2e-key';
export const LIVEKIT_SECRET = 'e2e-secret-not-used-outside-tests-000';

// Builds and starts the real stack: LiveKit, Redis, the API and the production web bundle
// served by `vite preview` with the production CSP, proxying /api to :3001 like nginx does.
export default defineConfig({
    testDir: './tests',
    timeout: 90_000,
    // Tests share one LiveKit, Redis and API and keep apart by room name and client address.
    fullyParallel: true,
    // Each test runs two or three browsers with fake media, so the suite is CPU-bound: on
    // 3 cores two at a time beat three (2.5 against 2.7 min, 3.4 one by one), and CI's
    // 4-core runners default to two as well. `--workers` overrides it.
    workers: 2,
    // In CI, failures also become annotations on the run, readable without its log.
    reporter: process.env.CI ? [['github'], ['list']] : [['list']],
    projects: [
        { name: 'web', testIgnore: /desktop\.spec\.ts/ },
        { name: 'desktop', testMatch: /desktop\.spec\.ts/ },
    ],
    use: {
        baseURL: 'http://127.0.0.1:3000',
        permissions: ['microphone', 'camera'],
        trace: 'retain-on-failure',
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
            command: '../../e2e/prepare.sh . && node dist/index.js',
            cwd: '../packages/api',
            url: 'http://127.0.0.1:3001/api/health',
            reuseExistingServer: false,
            timeout: 120_000,
            env: {
                LALA_ACCESS_PASSWORD: SERVER_PASSWORD,
                LIVEKIT_URL: 'ws://127.0.0.1:7880',
                LIVEKIT_API_KEY: LIVEKIT_KEY,
                LIVEKIT_API_SECRET: LIVEKIT_SECRET,
                REDIS_URL: 'redis://127.0.0.1:6380',
                LALA_CONFIG: '../../e2e/lala-e2e.yaml',
                // A server with admins in its config: the link must not make anyone admin.
                LALA_ADMIN_CLAIM: ADMIN_CLAIM,
            },
        },
        {
            command: '../../e2e/prepare.sh . && npx vite preview --config ../../e2e/preview.config.mjs',
            cwd: '../packages/web',
            url: 'http://127.0.0.1:3000',
            reuseExistingServer: false,
            timeout: 180_000,
        },
    ],
});
