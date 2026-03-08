'use strict';

const fs = require('fs');
const path = require('path');

/**
 * electron-builder afterPack hook.
 * Copies AppStream metainfo into the unpacked app so it ends up inside
 * both AppImage and RPM packages. GNOME Software reads this for
 * screenshots, description, and other metadata.
 */
exports.default = async function afterPack(context) {
    if (context.electronPlatformName !== 'linux') return;

    const src = path.join(__dirname, '..', 'build', 'app.lala.desktop.metainfo.xml');
    if (!fs.existsSync(src)) return;

    const dest = path.join(context.appOutDir, 'usr', 'share', 'metainfo');
    fs.mkdirSync(dest, { recursive: true });
    fs.copyFileSync(src, path.join(dest, 'app.lala.desktop.metainfo.xml'));
};
