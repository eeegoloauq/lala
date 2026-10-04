'use strict';

const { app } = require('electron');
const path = require('path');
const fs = require('fs');
const { USER_DATA } = require('./constants');

const CRASH_LOG_DIR = path.join(USER_DATA, 'crash-logs');
const RUNNING_LOCK = path.join(USER_DATA, 'running.lock');
const SESSION_FILE = path.join(USER_DATA, 'session.json');

function setupCrashHandling() {
    // Write running lock. Not currently read back by anything (no crash-based
    // session-restore flow is wired up — see saveSession()/loadSession() note
    // below); left in place as a cheap unclean-shutdown marker on disk.
    try {
        fs.writeFileSync(RUNNING_LOCK, String(Date.now()));
    } catch { /* ignore */ }

    // Ensure crash-logs directory exists
    try {
        fs.mkdirSync(CRASH_LOG_DIR, { recursive: true });
    } catch { /* ignore */ }

    process.on('uncaughtException', (err) => {
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const logPath = path.join(CRASH_LOG_DIR, `crash-${timestamp}.log`);
        try {
            fs.writeFileSync(logPath, `Uncaught Exception: ${err.stack || err.message}\n`);
        } catch { /* ignore write errors */ }
        console.error('[Lala] Uncaught exception:', err);
    });

    // Async errors that escape every try/catch (e.g. a throw inside an async
    // Electron handler) surface here instead of as a bare
    // UnhandledPromiseRejectionWarning with no [Lala] context.
    process.on('unhandledRejection', (reason) => {
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const logPath = path.join(CRASH_LOG_DIR, `rejection-${timestamp}.log`);
        const detail = reason instanceof Error ? (reason.stack || reason.message) : String(reason);
        try {
            fs.writeFileSync(logPath, `Unhandled Rejection: ${detail}\n`);
        } catch { /* ignore write errors */ }
        console.error('[Lala] Unhandled rejection:', reason);
    });

    app.on('render-process-gone', (_event, _webContents, details) => {
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const logPath = path.join(CRASH_LOG_DIR, `render-crash-${timestamp}.log`);
        try {
            fs.writeFileSync(logPath, `Render process gone: ${JSON.stringify(details)}\n`);
        } catch { /* ignore write errors */ }
        console.error('[Lala] Render process gone:', details.reason);
    });

    cleanupOldCrashLogs();
}

function cleanupOldCrashLogs() {
    try {
        const files = fs.readdirSync(CRASH_LOG_DIR);
        const now = Date.now();
        const MAX_AGE = 7 * 24 * 60 * 60 * 1000; // 7 days
        for (const file of files) {
            const filePath = path.join(CRASH_LOG_DIR, file);
            try {
                const stat = fs.statSync(filePath);
                if (now - stat.mtimeMs > MAX_AGE) fs.unlinkSync(filePath);
            } catch {}
        }
    } catch {}
}

function cleanupRunningLock() {
    try {
        if (fs.existsSync(RUNNING_LOCK)) fs.unlinkSync(RUNNING_LOCK);
    } catch { /* ignore */ }
}

// Writes the renderer's session snapshot (server + room) to disk. Nothing in
// the main process currently reads SESSION_FILE back — there's no crash/restart
// session-restore flow wired up despite this being written on every room
// join. Kept as-is (low cost, and a restore feature may consume it later);
// a previous `loadSession()` that was dead code (defined, never called) has
// been removed. See packages/desktop/CLAUDE.md.
function saveSession(data) {
    try {
        fs.writeFileSync(SESSION_FILE, JSON.stringify({ ...data, timestamp: Date.now() }));
    } catch { /* ignore */ }
}

function clearSession() {
    try {
        if (fs.existsSync(SESSION_FILE)) fs.unlinkSync(SESSION_FILE);
    } catch { /* ignore */ }
}

module.exports = { setupCrashHandling, cleanupRunningLock, saveSession, clearSession };
