// Legacy dynamic types are explicit during the full language migration.
// The day a photo was taken, from its EXIF DateTimeOriginal, to suggest the date a progress photo
// is filed under (#557). JPEG only, a few dozen lines rather than a library: the APP1 "Exif"
// segment, its TIFF header (either byte order), IFD0's pointer to the Exif IFD, and tag 0x9003
// there ("YYYY:MM:DD HH:MM:SS"). Anything it cannot read is null, and the person picks the date.
// It only reads bytes the person chose themselves, and only the date.
const DATE: any = /^(\d{4}):(\d{2}):(\d{2})/;
/** 'YYYY-MM-DD' from a JPEG's bytes (ArrayBuffer or Uint8Array), or null. */
export function exifDateOf(input?: any) {
    const b: any = input instanceof Uint8Array ? input : new Uint8Array(input || []);
    const v: any = new DataView(b.buffer, b.byteOffset, b.byteLength);
    if (b.length < 4 || b[0] !== 0xff || b[1] !== 0xd8)
        return null;
    let p: any = 2;
    while (p + 4 <= b.length) {
        if (b[p] !== 0xff)
            return null;
        const marker: any = b[p + 1];
        if (marker === 0xda || marker === 0xd9)
            return null; // the image data begins: no EXIF
        const len: any = v.getUint16(p + 2);
        if (len < 2 || p + 2 + len > b.length)
            return null;
        if (marker === 0xe1 && len >= 8 && b[p + 4] === 0x45 && b[p + 5] === 0x78 && b[p + 6] === 0x69 && b[p + 7] === 0x66) {
            return fromTiff(b, v, p + 10, p + 2 + len);
        }
        p += 2 + len;
    }
    return null;
}
function fromTiff(b?: any, v?: any, start?: any, end?: any) {
    if (start + 8 > end)
        return null;
    const le: any = b[start] === 0x49 && b[start + 1] === 0x49;
    if (!le && !(b[start] === 0x4d && b[start + 1] === 0x4d))
        return null;
    const u16: any = (o?: any) => (o + 2 <= end ? v.getUint16(o, le) : null);
    const u32: any = (o?: any) => (o + 4 <= end ? v.getUint32(o, le) : null);
    const tag: any = (ifd?: any, want?: any) => {
        const at: any = start + ifd;
        const n: any = u16(at);
        if (n == null || n > 1000)
            return null;
        for (let i: any = 0; i < n; i++) {
            const e: any = at + 2 + i * 12;
            if (u16(e) === want)
                return { type: u16(e + 2), count: u32(e + 4), value: e + 8 };
        }
        return null;
    };
    const ifd0: any = u32(start + 4);
    if (ifd0 == null)
        return null;
    const exifPtr: any = tag(ifd0, 0x8769);
    if (!exifPtr)
        return null;
    const exifIfd: any = u32(exifPtr.value);
    if (exifIfd == null)
        return null;
    const dt: any = tag(exifIfd, 0x9003) || tag(exifIfd, 0x9004);
    if (!dt || dt.type !== 2 || !(dt.count >= 10))
        return null;
    const off: any = dt.count > 4 ? start + u32(dt.value) : dt.value;
    if (off + 10 > end)
        return null;
    const text: any = String.fromCharCode(...b.subarray(off, off + 10));
    const m: any = DATE.exec(text);
    if (!m)
        return null;
    const [, y, mo, d]: any = m;
    if (+mo < 1 || +mo > 12 || +d < 1 || +d > 31 || +y < 1990)
        return null;
    return `${y}-${mo}-${d}`;
}
/** The same from a File or Blob (the first 256 KB, where EXIF lives). Never throws. */
export async function exifDateOfFile(file?: any) {
    try {
        if (!file || typeof file.slice !== 'function')
            return null;
        const head: any = await file.slice(0, 256 * 1024).arrayBuffer();
        return exifDateOf(head);
    }
    catch {
        return null;
    }
}
