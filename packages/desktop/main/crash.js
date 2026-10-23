'use strict';

const { app, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const { USER_DATA } = require('./constants');

const CRASH_LOG_DIR = path.join(USER_DATA, 'crash-logs');
const MAX_LOG_AGE_MS = 7 * 24 * 60 * 60 * 1000;

/** Writes `text` to a new file in the crash log folder and returns its path. */
function writeLog(kind, text) {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const logPath = path.join(CRASH_LOG_DIR, `${kind}-${timestamp}.log`);
    try {
        fs.writeFileSync(logPath, `${text}\n`);
    } catch { /* nowhere left to report it */ }
    return logPath;
}

function setupCrashHandling() {
    try {
        fs.mkdirSync(CRASH_LOG_DIR, { recursive: true });
    } catch { /* writeLog fails quietly then */ }

    // After an uncaught exception the main process state can't be trusted, so the app
    // says what happened and quits instead of running on half-broken.
    process.on('uncaughtException', (err) => {
        const logPath = writeLog('crash', `Uncaught Exception: ${err.stack || err.message}`);
        console.error('[Lala] Uncaught exception:', err);
        dialog.showErrorBox('Lala has to close', `An unexpected error stopped the app. Details: ${logPath}`);
        app.exit(1);
    });

    // Async errors that escape every try/catch (e.g. a throw inside an async Electron
    // handler) fail only their own operation, so they are logged and the app runs on.
    process.on('unhandledRejection', (reason) => {
        writeLog('rejection', `Unhandled Rejection: ${reason instanceof Error ? (reason.stack || reason.message) : String(reason)}`);
        console.error('[Lala] Unhandled rejection:', reason);
    });

    app.on('render-process-gone', (_event, _webContents, details) => {
        writeLog('render-crash', `Render process gone: ${JSON.stringify(details)}`);
        console.error('[Lala] Render process gone:', details.reason);
    });

    removeOldLogs();
}

function removeOldLogs() {
    let files;
    try {
        files = fs.readdirSync(CRASH_LOG_DIR);
    } catch {
        return;
    }
    const now = Date.now();
    for (const file of files) {
        const filePath = path.join(CRASH_LOG_DIR, file);
        try {
            if (now - fs.statSync(filePath).mtimeMs > MAX_LOG_AGE_MS) fs.unlinkSync(filePath);
        } catch { /* gone already */ }
    }
}

module.exports = { setupCrashHandling };
