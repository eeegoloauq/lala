export type ImageType = 'jpeg' | 'png' | 'webp';

/** The image type from the file's first bytes, so a renamed file can't pass for an image. */
export function imageType(data: Buffer): ImageType | undefined {
    if (data.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]))) return 'jpeg';
    if (data.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'png';
    if (data.subarray(0, 4).toString('latin1') === 'RIFF' && data.subarray(8, 12).toString('latin1') === 'WEBP') return 'webp';
    return undefined;
}
