'use strict';

// Connection page script — extracted from an inline <script> in index.html so
// the page's CSP can use `script-src 'self'` without 'unsafe-inline'. Loaded
// via <script src="connection.js"> from the same origin (file://), so
// contextIsolation/sandbox on the BrowserWindow still applies normally.

const TRANSLATIONS = {
    en: {
        subtitle: 'Connect to server',
        connect: 'Connect',
        savedServers: 'Saved servers',
        addNewServer: 'Add new server',
        noAutoConnect: "Don't auto-connect",
        connecting: 'Connecting...',
        remove: 'Remove',
        editLabel: 'Edit label',
        connectionFailed: 'Server is unavailable',
        connectingTo: 'Connecting to %s...',
        cancel: 'Cancel',
    },
    ru: {
        subtitle: 'Подключиться к серверу',
        connect: 'Подключиться',
        savedServers: 'Сохранённые серверы',
        addNewServer: 'Новый сервер',
        noAutoConnect: 'Не подключаться автоматически',
        connecting: 'Подключение...',
        remove: 'Удалить',
        editLabel: 'Изменить название',
        connectionFailed: 'Сервер недоступен',
        connectingTo: 'Подключение к %s...',
        cancel: 'Отмена',
    }
};

function detectLanguage() {
    const saved = localStorage.getItem('lala_language');
    if (saved) return saved;
    const nav = navigator.language || 'en';
    return nav.startsWith('ru') ? 'ru' : 'en';
}

function t(key) {
    const lang = detectLanguage();
    return (TRANSLATIONS[lang] || TRANSLATIONS.en)[key] || TRANSLATIONS.en[key] || key;
}

const urlParams = new URLSearchParams(window.location.search);
const returnedFromError = urlParams.get('error') === '1';

const SAVED_KEY = 'lala_saved_servers';
const LEGACY_KEY = 'lala_recent_servers';
const MAX_SAVED = 10;

const form = document.getElementById('connectForm');
const input = document.getElementById('urlInput');
const errorMsg = document.getElementById('errorMsg');
const connectBtn = document.getElementById('connectBtn');
const serversSection = document.getElementById('serversSection');
const serverList = document.getElementById('serverList');
const versionInfo = document.getElementById('versionInfo');
const mainLogo = document.getElementById('mainLogo');

// ─── Migration from lala_recent_servers ────────────────────
function migrateRecentServers() {
    if (localStorage.getItem(SAVED_KEY)) return;
    const legacy = localStorage.getItem(LEGACY_KEY);
    if (!legacy) return;
    try {
        const urls = JSON.parse(legacy);
        if (!Array.isArray(urls) || urls.length === 0) return;
        const now = Date.now();
        const migrated = urls.map((url, i) => {
            let label;
            try { label = new URL(url).hostname; } catch { label = url; }
            return { url, label, lastConnected: now - i * 1000 };
        });
        localStorage.setItem(SAVED_KEY, JSON.stringify(migrated));
        localStorage.removeItem(LEGACY_KEY);
    } catch {}
}
migrateRecentServers();

// ─── Saved servers ────────────────────────────────────────
function getSavedServers() {
    try {
        const arr = JSON.parse(localStorage.getItem(SAVED_KEY) || '[]');
        arr.sort((a, b) => b.lastConnected - a.lastConnected);
        return arr;
    } catch { return []; }
}

function saveServer(url) {
    const servers = getSavedServers();
    const idx = servers.findIndex(s => s.url === url);
    if (idx >= 0) {
        servers[idx].lastConnected = Date.now();
    } else {
        let label;
        try { label = new URL(url).hostname; } catch { label = url; }
        servers.push({ url, label, lastConnected: Date.now() });
    }
    servers.sort((a, b) => b.lastConnected - a.lastConnected);
    if (servers.length > MAX_SAVED) servers.length = MAX_SAVED;
    localStorage.setItem(SAVED_KEY, JSON.stringify(servers));
}

function removeServer(url) {
    const servers = getSavedServers().filter(s => s.url !== url);
    localStorage.setItem(SAVED_KEY, JSON.stringify(servers));
    renderServers();
}

function updateServerLabel(url, label) {
    const servers = getSavedServers();
    const server = servers.find(s => s.url === url);
    if (server) {
        server.label = label.trim() || server.label;
        localStorage.setItem(SAVED_KEY, JSON.stringify(servers));
    }
}

// ─── Health check (via IPC to bypass CORS) ─────────────
const pingCache = new Map(); // url → { ms: number|null, time: number }
const PING_CACHE_TTL = 15000; // 15s

async function pingServer(url, useCache = false) {
    if (useCache) {
        const cached = pingCache.get(url);
        if (cached && Date.now() - cached.time < PING_CACHE_TTL) return cached.ms;
    }
    try {
        const ms = await window.electronAPI.pingServer(url);
        pingCache.set(url, { ms, time: Date.now() });
        return ms;
    } catch {
        pingCache.set(url, { ms: null, time: Date.now() });
        return null;
    }
}

async function connectTo(url) {
    connectBtn.disabled = true;
    connectBtn.textContent = t('connecting');
    mainLogo.classList.add('logo--connecting');
    errorMsg.textContent = '';

    const ping = await pingServer(url);
    if (ping === null) {
        errorMsg.textContent = t('connectionFailed');
        connectBtn.disabled = false;
        connectBtn.textContent = t('connect');
        mainLogo.classList.remove('logo--connecting');
        return;
    }

    saveServer(url);
    window.electronAPI.loadUrl(url);
}

let isEditingLabel = false;

function startEditLabel(url, labelEl) {
    const servers = getSavedServers();
    const server = servers.find(s => s.url === url);
    if (!server) return;

    isEditingLabel = true;
    const currentLabel = server.label;
    const editInput = document.createElement('input');
    editInput.type = 'text';
    editInput.className = 'server-card-label-edit';
    editInput.value = currentLabel;

    labelEl.replaceWith(editInput);
    editInput.focus();
    editInput.select();

    function commit() {
        const newLabel = editInput.value.trim() || currentLabel;
        updateServerLabel(url, newLabel);
        isEditingLabel = false;
        renderServers();
    }

    editInput.addEventListener('blur', commit);
    editInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); editInput.blur(); }
        if (e.key === 'Escape') { editInput.value = currentLabel; editInput.blur(); }
    });
}

function renderServers() {
    const servers = getSavedServers();
    const divider = document.getElementById('addServerDivider');

    if (servers.length === 0) {
        serversSection.style.display = 'none';
        divider.style.display = 'none';
        return;
    }

    serversSection.style.display = 'block';
    divider.style.display = 'flex';
    serverList.innerHTML = '';

    servers.forEach(server => {
        const card = document.createElement('div');
        card.className = 'server-card';

        const info = document.createElement('div');
        info.className = 'server-card-info';

        const labelEl = document.createElement('div');
        labelEl.className = 'server-card-label';
        labelEl.textContent = server.label;

        const urlEl = document.createElement('div');
        urlEl.className = 'server-card-url';
        try {
            urlEl.textContent = new URL(server.url).host;
        } catch {
            urlEl.textContent = server.url;
        }

        info.appendChild(labelEl);
        info.appendChild(urlEl);

        // Status indicator (ping dot + latency)
        const status = document.createElement('div');
        status.className = 'server-card-status';
        const pingLabel = document.createElement('span');
        pingLabel.className = 'server-card-ping';
        const dot = document.createElement('div');
        dot.className = 'server-card-dot';
        status.appendChild(pingLabel);
        status.appendChild(dot);

        // Async ping (cached to avoid re-fetching on every render)
        pingServer(server.url, true).then(ms => {
            if (ms !== null) {
                dot.className = 'server-card-dot server-card-dot--online';
                pingLabel.textContent = ms + ' ms';
            } else {
                dot.className = 'server-card-dot server-card-dot--offline';
            }
        });

        const actions = document.createElement('div');
        actions.className = 'server-card-actions';

        // Edit button (pencil icon)
        const editBtn = document.createElement('button');
        editBtn.className = 'server-card-btn';
        editBtn.type = 'button';
        editBtn.innerHTML = '&#9998;';
        editBtn.title = t('editLabel');
        editBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            startEditLabel(server.url, labelEl);
        });

        // Remove button
        const removeBtn = document.createElement('button');
        removeBtn.className = 'server-card-btn server-card-btn--danger';
        removeBtn.type = 'button';
        removeBtn.textContent = '×';
        removeBtn.title = t('remove');
        removeBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            removeServer(server.url);
        });

        actions.appendChild(editBtn);
        actions.appendChild(removeBtn);

        card.appendChild(info);
        card.appendChild(status);
        card.appendChild(actions);
        card.addEventListener('click', () => {
            if (isEditingLabel) return;
            input.value = server.url;
            connectTo(server.url);
        });
        serverList.appendChild(card);
    });
}

// ─── Form submit ────────────────────────────────────────────
form.addEventListener('submit', (e) => {
    e.preventDefault();
    const url = input.value.trim();
    if (!url) return;
    connectTo(url);
});

// ─── Error handling ─────────────────────────────────────────
if (window.electronAPI?.onLoadUrlError) {
    window.electronAPI.onLoadUrlError((error) => {
        if (autoConnecting) {
            autoConnecting = false;
            document.getElementById('splashScreen').style.display = 'none';
            document.getElementById('mainContainer').style.display = '';
            renderServers();
        }
        errorMsg.textContent = error.message || t('connectionFailed');
        connectBtn.disabled = false;
        connectBtn.textContent = t('connect');
        mainLogo.classList.remove('logo--connecting');
    });
}

// ─── Auto-connect ────────────────────────────────────────────
let autoConnecting = false;
let autoConnectCancelled = false;
const AUTO_CONNECT_KEY = 'lala_no_auto_connect';

// Renders the "Connecting to <host>..." status via DOM construction instead
// of innerHTML — host comes from the server URL, so this avoids ever
// interpreting it (or the translated template) as HTML.
function renderConnectingTo(host) {
    const el = document.getElementById('splashStatus');
    el.textContent = '';
    const template = t('connectingTo');
    const idx = template.indexOf('%s');
    if (idx === -1) {
        el.textContent = template;
        return;
    }
    el.appendChild(document.createTextNode(template.slice(0, idx)));
    const strong = document.createElement('strong');
    strong.style.color = 'var(--text)';
    strong.textContent = host;
    el.appendChild(strong);
    el.appendChild(document.createTextNode(template.slice(idx + 2)));
}

async function showAutoConnect(url) {
    autoConnecting = true;
    const host = (() => { try { return new URL(url).host; } catch { return url.replace(/[<>&"']/g, ''); } })();

    document.getElementById('mainContainer').style.display = 'none';
    const splash = document.getElementById('splashScreen');
    splash.style.display = '';
    renderConnectingTo(host);
    const cancelBtn = document.getElementById('splashCancelBtn');
    cancelBtn.textContent = t('cancel');
    cancelBtn.onclick = () => {
        autoConnectCancelled = true;
        autoConnecting = false;
        splash.style.display = 'none';
        document.getElementById('mainContainer').style.display = '';
        renderServers();
    };

    const ping = await pingServer(url);
    if (autoConnectCancelled) return;
    if (ping === null) {
        autoConnecting = false;
        splash.style.display = 'none';
        document.getElementById('mainContainer').style.display = '';
        errorMsg.textContent = t('connectionFailed');
        renderServers();
        return;
    }

    saveServer(url);
    connectBtn.disabled = true;
    window.electronAPI.loadUrl(url);
}

// ─── Apply translations ──────────────────────────────────────
function applyTranslations() {
    document.documentElement.lang = detectLanguage();
    document.getElementById('subtitleText').textContent = t('subtitle');
    connectBtn.textContent = t('connect');
    document.getElementById('serversHeader').textContent = t('savedServers');
    document.getElementById('addServerDividerText').textContent = t('addNewServer');
    document.getElementById('noAutoConnectLabel').textContent = t('noAutoConnect');
    renderServers();
}

// ─── Init ───────────────────────────────────────────────────
applyTranslations();
renderServers();

// Auto-connect toggle
const noAutoCheckbox = document.getElementById('noAutoConnectCheckbox');
noAutoCheckbox.checked = localStorage.getItem(AUTO_CONNECT_KEY) === 'true';
noAutoCheckbox.addEventListener('change', () => {
    if (noAutoCheckbox.checked) {
        localStorage.setItem(AUTO_CONNECT_KEY, 'true');
    } else {
        localStorage.removeItem(AUTO_CONNECT_KEY);
    }
});

// Auto-connect to last server unless disabled
const saved = getSavedServers();
const noAutoConnect = localStorage.getItem(AUTO_CONNECT_KEY) === 'true';
if (returnedFromError) {
    document.getElementById('mainContainer').style.display = '';
} else if (saved.length > 0 && !noAutoConnect) {
    showAutoConnect(saved[0].url);
} else {
    document.getElementById('mainContainer').style.display = '';
}

// Show version
if (window.electronAPI?.getAppInfo) {
    window.electronAPI.getAppInfo().then(info => {
        versionInfo.textContent = `v${info.version} · ${info.platform}`;
    });
}
