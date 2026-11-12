'use strict';

// The desktop app's own text: the connection page, tray, edit menu and crash messages.
// Everything inside a call comes from the web app's packages/web/src/locales/.
// To add a language, add a block under its code ("de", "pt-BR"); a missing key falls
// back to English. Loaded with require() in the main process and with a <script> tag
// on the connection page (index.html), so it stays plain JavaScript.
(function (root) {
    const STRINGS = {
        en: {
            'connect.subtitle': 'Connect to server',
            'connect.connect': 'Connect',
            'connect.savedServers': 'Saved servers',
            'connect.addNewServer': 'Add new server',
            'connect.noAutoConnect': "Don't auto-connect",
            'connect.connecting': 'Connecting...',
            'connect.remove': 'Remove',
            'connect.editLabel': 'Edit label',
            'connect.connectionFailed': 'Server is unavailable',
            'connect.connectingTo': 'Connecting to %s...',
            'connect.cancel': 'Cancel',
            'tray.changeServer': 'Change server',
            'tray.quit': 'Quit',
            'menu.undo': 'Undo',
            'menu.redo': 'Redo',
            'menu.cut': 'Cut',
            'menu.copy': 'Copy',
            'menu.paste': 'Paste',
            'menu.selectAll': 'Select all',
            'crash.reloadedTitle': 'Lala reloaded after a crash',
            'crash.reloadedBody': 'If you were in a call, join it again.',
            'crash.fallback': 'The page crashed several times. Connect again to retry.',
            'crash.quitTitle': 'Lala has to close',
            'crash.quitBody': 'The window keeps crashing. Crash logs: %s',
        },
        ru: {
            'connect.subtitle': 'Подключиться к серверу',
            'connect.connect': 'Подключиться',
            'connect.savedServers': 'Сохранённые серверы',
            'connect.addNewServer': 'Новый сервер',
            'connect.noAutoConnect': 'Не подключаться автоматически',
            'connect.connecting': 'Подключение...',
            'connect.remove': 'Удалить',
            'connect.editLabel': 'Изменить название',
            'connect.connectionFailed': 'Сервер недоступен',
            'connect.connectingTo': 'Подключение к %s...',
            'connect.cancel': 'Отмена',
            'tray.changeServer': 'Сменить сервер',
            'tray.quit': 'Выход',
            'menu.undo': 'Отменить',
            'menu.redo': 'Повторить',
            'menu.cut': 'Вырезать',
            'menu.copy': 'Копировать',
            'menu.paste': 'Вставить',
            'menu.selectAll': 'Выделить всё',
            'crash.reloadedTitle': 'Lala перезагрузилась после сбоя',
            'crash.reloadedBody': 'Если вы были в звонке, зайдите в него снова.',
            'crash.fallback': 'Страница несколько раз завершилась со сбоем. Подключитесь снова.',
            'crash.quitTitle': 'Lala нужно закрыть',
            'crash.quitBody': 'Окно продолжает завершаться со сбоем. Журналы сбоев: %s',
        },
    };

    /** The block for a locale such as "pt-BR": that exact code, then its language, then English. */
    function languageFor(locale) {
        const code = String(locale || 'en');
        if (STRINGS[code]) return code;
        const base = code.split('-')[0];
        return STRINGS[base] ? base : 'en';
    }

    function translate(locale, key) {
        return STRINGS[languageFor(locale)][key] ?? STRINGS.en[key] ?? key;
    }

    const api = { STRINGS, languageFor, translate };
    if (typeof module === 'object' && module.exports) module.exports = api;
    else root.LalaStrings = api;
})(typeof window !== 'undefined' ? window : globalThis);
