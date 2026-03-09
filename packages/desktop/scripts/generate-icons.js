#!/usr/bin/env node
/**
 * Generate all app icons from the SVG source.
 * Outputs PNG files at standard sizes for electron-builder + tray.
 * Also generates variant PNGs from SVGs in build/icon-variants/.
 *
 * Usage: node scripts/generate-icons.js
 */
const sharp = require('sharp');
const path = require('path');
const fs = require('fs');

const SVG_PATH = path.join(__dirname, '..', 'build', 'icon.svg');
const BUILD_DIR = path.join(__dirname, '..', 'build');
const VARIANTS_DIR = path.join(BUILD_DIR, 'icon-variants');

// Standard sizes for electron-builder + tray
const SIZES = [16, 24, 32, 48, 64, 128, 256, 512, 1024];
const TRAY_SIZES = [16, 22, 24, 32, 48]; // macOS Template icons + Linux tray

async function generateMain() {
    const svg = fs.readFileSync(SVG_PATH);

    // Main app icon (largest for electron-builder auto-conversion to .ico/.icns)
    await sharp(svg)
        .resize(1024, 1024)
        .png({ compressionLevel: 9 })
        .toFile(path.join(BUILD_DIR, 'icon.png'));

    console.log('  icon.png (1024x1024)');

    // Windows icons: render SVG at each target size individually.
    // The SVG circle has ~3% natural whitespace (radius 496 in 1024 viewBox).
    // Rendering per-size from SVG produces crisp results at all sizes.
    const WIN_SIZES = [16, 24, 32, 48, 64, 128, 256];
    const iconsWinDir = path.join(BUILD_DIR, 'icons-win');
    fs.mkdirSync(iconsWinDir, { recursive: true });

    for (const size of WIN_SIZES) {
        await sharp(svg)
            .resize(size, size)
            .png({ compressionLevel: 9 })
            .toFile(path.join(iconsWinDir, `${size}x${size}.png`));
        console.log(`  icons-win/${size}x${size}.png`);
    }

    console.log('  (Windows multi-size icons for .ico generation)');

    // All standard sizes
    const iconsDir = path.join(BUILD_DIR, 'icons');
    fs.mkdirSync(iconsDir, { recursive: true });

    for (const size of SIZES) {
        await sharp(svg)
            .resize(size, size)
            .png({ compressionLevel: 9 })
            .toFile(path.join(iconsDir, `${size}x${size}.png`));
        console.log(`  icons/${size}x${size}.png`);
    }

    // Tray icons — circle fills entire viewBox (r=512), just resize directly.
    const trayDir = path.join(BUILD_DIR, 'tray');
    fs.mkdirSync(trayDir, { recursive: true });

    for (const size of TRAY_SIZES) {
        await sharp(svg)
            .resize(size, size)
            .png({ compressionLevel: 9 })
            .toFile(path.join(trayDir, `tray-${size}.png`));
        console.log(`  tray/tray-${size}.png`);
    }

    // macOS template icons (white silhouette for dark menu bar)
    // Voice wave bars as white on transparent
    const templateSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024" fill="none">
  <g fill="white">
    <rect x="192" y="384" width="96" height="256" rx="48"/>
    <rect x="320" y="288" width="96" height="448" rx="48"/>
    <rect x="464" y="200" width="96" height="624" rx="48"/>
    <rect x="608" y="288" width="96" height="448" rx="48"/>
    <rect x="736" y="384" width="96" height="256" rx="48"/>
  </g>
</svg>`;

    // Crop to bar content area (bars span x=192..832, y=200..824)
    const templateBuf = await sharp(Buffer.from(templateSvg))
        .resize(1024, 1024)
        .extract({ left: 170, top: 178, width: 684, height: 668 })
        .png()
        .toBuffer();

    for (const size of [16, 22, 32]) {
        await sharp(templateBuf)
            .resize(size, size)
            .png({ compressionLevel: 9 })
            .toFile(path.join(trayDir, `trayTemplate-${size}.png`));

        // @2x for Retina
        await sharp(templateBuf)
            .resize(size * 2, size * 2)
            .png({ compressionLevel: 9 })
            .toFile(path.join(trayDir, `trayTemplate-${size}@2x.png`));
        console.log(`  tray/trayTemplate-${size}.png + @2x`);
    }
}

/**
 * Build a Windows .ico file from multiple PNG buffers.
 * ICO format: header + directory entries + PNG image data.
 */
function buildIco(pngBuffers) {
    const count = pngBuffers.length;
    const headerSize = 6;
    const dirEntrySize = 16;
    const dirSize = dirEntrySize * count;
    let dataOffset = headerSize + dirSize;

    // ICO header: reserved(2) + type(2, 1=icon) + count(2)
    const header = Buffer.alloc(headerSize);
    header.writeUInt16LE(0, 0);       // reserved
    header.writeUInt16LE(1, 2);       // type = icon
    header.writeUInt16LE(count, 4);   // image count

    const dirEntries = [];
    const imageData = [];

    for (const png of pngBuffers) {
        // Parse PNG header for dimensions (IHDR chunk at offset 16)
        const w = png.readUInt32BE(16);
        const h = png.readUInt32BE(20);

        const entry = Buffer.alloc(dirEntrySize);
        entry.writeUInt8(w >= 256 ? 0 : w, 0);   // width (0 = 256)
        entry.writeUInt8(h >= 256 ? 0 : h, 1);    // height (0 = 256)
        entry.writeUInt8(0, 2);                     // color palette
        entry.writeUInt8(0, 3);                     // reserved
        entry.writeUInt16LE(1, 4);                  // color planes
        entry.writeUInt16LE(32, 6);                 // bits per pixel
        entry.writeUInt32LE(png.length, 8);         // image data size
        entry.writeUInt32LE(dataOffset, 12);        // offset to image data

        dirEntries.push(entry);
        imageData.push(png);
        dataOffset += png.length;
    }

    return Buffer.concat([header, ...dirEntries, ...imageData]);
}

async function generateVariants() {
    if (!fs.existsSync(VARIANTS_DIR)) {
        console.log('\nNo icon-variants/ directory found, skipping variants.');
        return;
    }

    const svgFiles = fs.readdirSync(VARIANTS_DIR).filter(f => f.endsWith('.svg'));
    if (svgFiles.length === 0) {
        console.log('\nNo SVG files in icon-variants/, skipping variants.');
        return;
    }

    console.log(`\nGenerating variants (${svgFiles.length} found)...`);

    for (const file of svgFiles) {
        const name = path.basename(file, '.svg');
        const outDir = path.join(VARIANTS_DIR, name);
        fs.mkdirSync(outDir, { recursive: true });

        const svg = fs.readFileSync(path.join(VARIANTS_DIR, file));

        // Window icons at multiple sizes (Windows needs these for taskbar/alt-tab)
        for (const size of [16, 32, 48, 64, 256]) {
            await sharp(svg)
                .resize(size, size)
                .png({ compressionLevel: 9 })
                .toFile(path.join(outDir, `icon-${size}.png`));
            console.log(`  icon-variants/${name}/icon-${size}.png`);
        }

        // Build .ico (multi-size) for Windows setAppDetails({ appIconPath })
        const icoSizes = [16, 32, 48, 64, 256];
        const pngBuffers = [];
        for (const size of icoSizes) {
            pngBuffers.push(await sharp(svg)
                .resize(size, size)
                .png({ compressionLevel: 9 })
                .toBuffer());
        }
        const ico = buildIco(pngBuffers);
        fs.writeFileSync(path.join(outDir, 'icon.ico'), ico);
        console.log(`  icon-variants/${name}/icon.ico`);

        // Tray icons: resize directly (circles fill most of viewBox)
        for (const size of [16, 32, 48]) {
            await sharp(svg)
                .resize(size, size)
                .png({ compressionLevel: 9 })
                .toFile(path.join(outDir, `tray-${size}.png`));
            console.log(`  icon-variants/${name}/tray-${size}.png`);
        }
    }
}

async function generate() {
    console.log('Generating main icons...');
    await generateMain();

    await generateVariants();

    console.log('\nDone! All icons generated in build/');
}

generate().catch(err => {
    console.error('Icon generation failed:', err);
    process.exit(1);
});
