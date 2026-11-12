'use strict';

const { app, Menu } = require('electron');
const { translate } = require('../strings');

// Electron shows no context menu by default: build the usual edit menu for
// text fields and selected text, enabling items from Chromium's editFlags.
function setupContextMenu(webContents) {
    const label = (key) => translate(app.getLocale(), `menu.${key}`);

    webContents.on('context-menu', (_event, params) => {
        const { editFlags, isEditable, selectionText } = params;
        let template;
        if (isEditable) {
            template = [
                { role: 'undo', label: label('undo'), enabled: editFlags.canUndo },
                { role: 'redo', label: label('redo'), enabled: editFlags.canRedo },
                { type: 'separator' },
                { role: 'cut', label: label('cut'), enabled: editFlags.canCut },
                { role: 'copy', label: label('copy'), enabled: editFlags.canCopy },
                { role: 'paste', label: label('paste'), enabled: editFlags.canPaste },
                { type: 'separator' },
                { role: 'selectAll', label: label('selectAll'), enabled: editFlags.canSelectAll },
            ];
        } else if (selectionText.trim()) {
            template = [{ role: 'copy', label: label('copy') }];
        } else {
            return;
        }
        Menu.buildFromTemplate(template).popup();
    });
}

module.exports = { setupContextMenu };
