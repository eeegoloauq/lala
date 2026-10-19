'use strict';

const { app, Menu } = require('electron');

// Electron shows no context menu by default: build the usual edit menu for
// text fields and selected text, enabling items from Chromium's editFlags.
function setupContextMenu(webContents) {
    const isRu = app.getLocale().startsWith('ru');
    const label = (ru, en) => (isRu ? ru : en);

    webContents.on('context-menu', (_event, params) => {
        const { editFlags, isEditable, selectionText } = params;
        let template;
        if (isEditable) {
            template = [
                { role: 'undo', label: label('Отменить', 'Undo'), enabled: editFlags.canUndo },
                { role: 'redo', label: label('Повторить', 'Redo'), enabled: editFlags.canRedo },
                { type: 'separator' },
                { role: 'cut', label: label('Вырезать', 'Cut'), enabled: editFlags.canCut },
                { role: 'copy', label: label('Копировать', 'Copy'), enabled: editFlags.canCopy },
                { role: 'paste', label: label('Вставить', 'Paste'), enabled: editFlags.canPaste },
                { type: 'separator' },
                { role: 'selectAll', label: label('Выделить всё', 'Select all'), enabled: editFlags.canSelectAll },
            ];
        } else if (selectionText.trim()) {
            template = [{ role: 'copy', label: label('Копировать', 'Copy') }];
        } else {
            return;
        }
        Menu.buildFromTemplate(template).popup();
    });
}

module.exports = { setupContextMenu };
