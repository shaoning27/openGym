// Legacy dynamic types are explicit during the full language migration.
/* Tiny synthetic media files for the media tests: just enough structure for the magic bytes, the
   header reads, the GIF block walk and the MP4 box walk, built in code so the repo carries no
   binary fixtures and every test says exactly which bytes it feeds in. The api side has its own
   (api/test/media-samples.mjs); these add what only the client reads — dimensions, GIF frames,
   tracks and sample tables. Not a *.test.js file, so vitest does not run it on its own. */
export const bytes: any = (...parts: any[]) => {
    const arrs: any = parts.map((p?: any) => (typeof p === 'string' ? latin1(p) : p instanceof Uint8Array ? p : Uint8Array.from(p)));
    const out: any = new Uint8Array(arrs.reduce((n?: any, a?: any) => n + a.length, 0));
    let o: any = 0;
    for (const a of arrs) {
        out.set(a, o);
        o += a.length;
    }
    return out;
};
export const latin1: any = (s?: any) => Uint8Array.from(s, (c?: any) => c.charCodeAt(0) & 0xff);
const u16be: any = (n?: any) => [(n >>> 8) & 0xff, n & 0xff];
const u16le: any = (n?: any) => [n & 0xff, (n >>> 8) & 0xff];
const u32be: any = (n?: any) => [(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff];
const u24le: any = (n?: any) => [n & 0xff, (n >>> 8) & 0xff, (n >>> 16) & 0xff];
export const fill: any = (n?: any, v: any = 0x55) => new Uint8Array(n).fill(v);
/* ---- stills ---- */
// A JPEG with an APP1 (EXIF-ish) segment before its SOF0 frame header.
export const jpeg: any = (w: any = 640, h: any = 480) => bytes([0xff, 0xd8], [0xff, 0xe1], u16be(2 + 12), 'Exif\0\0GPS...', [0xff, 0xc0], u16be(17), [8], u16be(h), u16be(w), [3], fill(9, 1), [0xff, 0xda], u16be(2), fill(20));
export const png: any = (w: any = 300, h: any = 200) => bytes([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], u32be(13), 'IHDR', u32be(w), u32be(h), [8, 6, 0, 0, 0], fill(20));
export const webpVp8: any = (w: any = 320, h: any = 240) => bytes('RIFF', [0, 0, 0, 0], 'WEBP', 'VP8 ', [0, 0, 0, 0], [0x10, 0x02, 0x00], [0x9d, 0x01, 0x2a], u16le(w), u16le(h), fill(10));
export const webpVp8l: any = (w: any = 100, h: any = 50) => {
    const bits: any = ((w - 1) & 0x3fff) | (((h - 1) & 0x3fff) << 14);
    return bytes('RIFF', [0, 0, 0, 0], 'WEBP', 'VP8L', [0, 0, 0, 0], [0x2f], [bits & 0xff, (bits >>> 8) & 0xff, (bits >>> 16) & 0xff, (bits >>> 24) & 0xff], fill(10));
};
export const webpVp8x: any = (w: any = 4000, h: any = 3000) => bytes('RIFF', [0, 0, 0, 0], 'WEBP', 'VP8X', [10, 0, 0, 0], [0x10, 0, 0, 0], u24le(w - 1), u24le(h - 1), fill(10));
/* ---- GIF ---- */
const subBlocks: any = (data?: any) => {
    const out: any = [];
    for (let i: any = 0; i < data.length; i += 255) {
        const part: any = data.subarray(i, i + 255);
        out.push([part.length], part);
    }
    out.push([0]);
    return bytes(...out);
};
export const gce: any = (delayCs?: any) => bytes([0x21, 0xf9, 4, 0x04], u16le(delayCs), [0, 0]);
export const frame: any = (w?: any, h?: any) => bytes([0x2c], u16le(0), u16le(0), u16le(w), u16le(h), [0], [2], subBlocks(fill(6, 0x11)));
export const appExt: any = (id?: any, data: any = fill(3, 1)) => bytes([0x21, 0xff, 11], id, subBlocks(data));
export const comment: any = (text?: any) => bytes([0x21, 0xfe], subBlocks(latin1(text)));
export const plainText: any = () => bytes([0x21, 0x01], subBlocks(fill(12, 0x20)));
/** A GIF: `delays` (in 1/100 s) makes one frame each; extra blocks go in the order given. */
export function gif({ w = 40, h = 30, delays = [10, 10], blocks = null, trailer = true }: any = {}) {
    const head: any = bytes('GIF89a', u16le(w), u16le(h), [0x80, 0, 0], fill(6, 0)); // a 2-colour global table
    const body: any = blocks || [appExt('NETSCAPE2.0', bytes([1], u16le(0))), ...delays.flatMap((d?: any) => [gce(d), frame(w, h)])];
    return bytes(head, ...body, trailer ? [0x3b] : []);
}
/* ---- ISO-BMFF ---- */
export function box(type?: any, ...parts: any[]) {
    const body: any = bytes(...parts);
    return bytes(u32be(8 + body.length), type, body);
}
const fullBox: any = (type?: any, ...parts: any[]) => box(type, [0, 0, 0, 0], ...parts);
export const ftyp: any = (brand: any = 'isom') => box('ftyp', brand, [0, 0, 0, 0], 'isommp41');
export const mvhd: any = (seconds: any = 5, timescale: any = 1000) => box('mvhd', [0, 0, 0, 0], u32be(0), u32be(0), u32be(timescale), u32be(Math.round(seconds * timescale)), fill(80, 0));
// A tkhd, version 0, with the display size in 16.16 and an identity (or a 90°) matrix.
export function tkhd(w?: any, h?: any, { rotate = false }: any = {}) {
    const matrix: any = rotate
        ? [...u32be(0), ...u32be(0x10000), ...u32be(0), ...u32be(0xffff0000), ...u32be(0), ...u32be(0), ...u32be(0), ...u32be(0), ...u32be(0x40000000)]
        : [...u32be(0x10000), ...u32be(0), ...u32be(0), ...u32be(0), ...u32be(0x10000), ...u32be(0), ...u32be(0), ...u32be(0), ...u32be(0x40000000)];
    return box('tkhd', [0, 0, 0, 3], fill(20, 0), fill(8, 0), fill(8, 0), matrix, u32be(w * 65536), u32be(h * 65536));
}
export const hdlr: any = (type?: any) => fullBox('hdlr', u32be(0), type, fill(12, 0), [0]);
const stsd: any = (fourcc?: any) => fullBox('stsd', u32be(1), box(fourcc, fill(6, 0), u16be(1), fill(16, 0), u16be(0), u16be(0), fill(50, 0)));
/**
 * A trak whose samples sit at `offsets` (one chunk each) with `sizes`. The offsets are absolute
 * file positions, so mp4() computes them after laying out ftyp and moov.
 */
export function trak({ handler = 'vide', fourcc = 'avc1', w = 0, h = 0, rotate = false, offsets = [], sizes = [], extra = [] }: any) {
    return box('trak', tkhd(w, h, { rotate }), box('mdia', hdlr(handler), box('minf', box('stbl', stsd(fourcc), fullBox('stsz', u32be(0), u32be(sizes.length), ...sizes.map(u32be)), fullBox('stsc', u32be(1), u32be(1), u32be(1), u32be(1)), fullBox('stco', u32be(offsets.length), ...offsets.map(u32be))))), ...extra);
}
/**
 * An MP4 (brand isom) or MOV (brand 'qt  '): ftyp, moov, then mdat holding one sample per track
 * in `tracks` ([{ handler, fourcc, w, h, payload: Uint8Array }]). `moovExtra` goes into moov
 * after the traks (udta, meta), `top` after mdat (uuid, meta). Returns { file, sampleAt } where
 * sampleAt[i] is the offset of track i's sample in the file.
 */
export function mp4({ brand = 'isom', seconds = 5, tracks = [{ handler: 'vide', fourcc: 'avc1', w: 1920, h: 1080, payload: fill(64, 0x77) }], moovExtra = [], top = [], rotate = false }: any = {}) {
    const build: any = (offsets?: any) => box('moov', mvhd(seconds), ...tracks.map((t?: any, i?: any) => trak({ ...t, rotate: t.handler === 'vide' && rotate, offsets: [offsets[i]], sizes: [t.payload.length] })), ...moovExtra);
    const head: any = ftyp(brand);
    // Lay moov out once to learn its size, then again with the real offsets (sizes do not change).
    const size: any = build(tracks.map(() => 0)).length;
    let at: any = head.length + size + 8;
    const offsets: any = tracks.map((t?: any) => { const o: any = at; at += t.payload.length; return o; });
    const moov: any = build(offsets);
    const mdat: any = box('mdat', ...tracks.map((t?: any) => t.payload));
    return { file: bytes(head, moov, mdat, ...top), sampleAt: offsets };
}
/* ---- WebM ---- */
const ebmlEl: any = (id?: any, body?: any) => {
    const b: any = body instanceof Uint8Array ? body : Uint8Array.from(body);
    const size: any = b.length < 0x7f ? [0x80 | b.length] : [0x40 | (b.length >>> 8), b.length & 0xff];
    return bytes(id, size, b);
};
export function webm({ docType = 'webm', w = 640, h = 360, codec = 'V_VP9', durationMs = 4000 }: any = {}) {
    const header: any = ebmlEl([0x1a, 0x45, 0xdf, 0xa3], bytes(ebmlEl([0x42, 0x86], [1]), ebmlEl([0x42, 0x82], latin1(docType))));
    const dur: any = new Uint8Array(8);
    new DataView(dur.buffer).setFloat64(0, durationMs);
    const info: any = ebmlEl([0x15, 0x49, 0xa9, 0x66], bytes(ebmlEl([0x2a, 0xd7, 0xb1], [0x0f, 0x42, 0x40]), durationMs == null ? [] : ebmlEl([0x44, 0x89], dur)));
    const video: any = ebmlEl([0xe0], bytes(ebmlEl([0xb0], u16be(w)), ebmlEl([0xba], u16be(h))));
    const audio: any = ebmlEl([0xae], bytes(ebmlEl([0x83], [2]), ebmlEl([0x86], latin1('A_OPUS'))));
    const vtrack: any = ebmlEl([0xae], bytes(ebmlEl([0x83], [1]), ebmlEl([0x86], latin1(codec)), video));
    const tracksEl: any = ebmlEl([0x16, 0x54, 0xae, 0x6b], bytes(audio, vtrack));
    // An unknown-size Segment, the way MediaRecorder writes it, then a cluster.
    const segment: any = bytes([0x18, 0x53, 0x80, 0x67, 0x01, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff], info, tracksEl, ebmlEl([0x1f, 0x43, 0xb6, 0x75], fill(20)));
    return bytes(header, segment);
}
