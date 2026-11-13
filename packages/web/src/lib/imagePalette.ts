import { useEffect, useState } from 'react';

/**
 * Three colors taken from a picture, most prominent first, the way Legato colors its player
 * from a cover (legato src/core/palette.cpp): pixels go into coarse buckets, vivid ones count
 * more, and a color too close to one already picked is skipped. Grey pictures give grey.
 * Runs on a 24x24 copy, once per picture.
 */
const SIZE = 24;
const cache = new Map<string, string[] | null>();

function extract(img: HTMLImageElement): string[] | null {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = SIZE;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return null;
    ctx.drawImage(img, 0, 0, SIZE, SIZE);
    let data: Uint8ClampedArray;
    try {
        data = ctx.getImageData(0, 0, SIZE, SIZE).data;
    } catch {
        return null; // a picture from another origin taints the canvas
    }
    const buckets = new Map<number, { r: number; g: number; b: number; weight: number }>();
    for (let i = 0; i < data.length; i += 4) {
        if (data[i + 3] < 128) continue;
        const [r, g, b] = [data[i], data[i + 1], data[i + 2]];
        const max = Math.max(r, g, b), min = Math.min(r, g, b);
        // Saturation counts most; near-black and near-white count little.
        const weight = 0.15 + (max - min) / 255 + (max < 30 || min > 225 ? -0.1 : 0);
        const key = (r >> 5) << 6 | (g >> 5) << 3 | (b >> 5);
        const bucket = buckets.get(key) ?? { r: 0, g: 0, b: 0, weight: 0 };
        bucket.r += r * weight; bucket.g += g * weight; bucket.b += b * weight; bucket.weight += weight;
        buckets.set(key, bucket);
    }
    const ranked = [...buckets.values()]
        .filter(b => b.weight > 0)
        .sort((a, b) => b.weight - a.weight)
        .map(b => [b.r / b.weight, b.g / b.weight, b.b / b.weight]);
    const picked: number[][] = [];
    for (const c of ranked) {
        if (picked.every(p => Math.hypot(p[0] - c[0], p[1] - c[1], p[2] - c[2]) > 60)) picked.push(c);
        if (picked.length === 3) break;
    }
    if (!picked.length) return null;
    while (picked.length < 3) picked.push(picked[picked.length - 1]);
    return picked.map(([r, g, b]) => `rgb(${Math.round(r)} ${Math.round(g)} ${Math.round(b)})`);
}

/** The picture's palette, or null while it loads, without a picture, or when it can't be read. */
export function useImagePalette(url: string | undefined): string[] | null {
    const [palette, setPalette] = useState<string[] | null>(() => (url && cache.get(url)) || null);
    useEffect(() => {
        if (!url) { setPalette(null); return; }
        if (cache.has(url)) { setPalette(cache.get(url) ?? null); return; }
        let live = true;
        const img = new Image();
        img.decoding = 'async';
        img.onload = () => {
            const colors = extract(img);
            cache.set(url, colors);
            if (live) setPalette(colors);
        };
        img.onerror = () => { cache.set(url, null); if (live) setPalette(null); };
        img.src = url;
        return () => { live = false; };
    }, [url]);
    return palette;
}
