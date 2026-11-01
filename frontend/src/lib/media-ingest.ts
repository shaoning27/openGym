// Legacy dynamic types are explicit during the full language migration.
/* A picked file → what the state keeps (a MediaRef) and what the local store keeps (the blobs).
 *
 * Nothing leaves the device as it was picked:
 *  - A photo (JPEG, PNG, WebP, HEIC, AVIF) is decoded and drawn again on a canvas — WebP where
 *    the browser can really write it, else JPEG on white (Safari) — at most 1600 px on its long
 *    edge, plus a 480 px poster. EXIF, GPS and colour profiles do not survive a canvas, so the
 *    location a phone wrote into the photo is gone by construction, not by a scrub that could
 *    miss a field. Before decoding, the header's pixel count is checked: a 100-megapixel photo
 *    would need several hundred MB just to open.
 *  - A GIF keeps its frames and loses its comment and metadata blocks (media-sniff cleanGif). A
 *    GIF of one frame is a photo and goes down that path; an animation is held to the photo's
 *    pixel guard on its logical screen.
 *  - An MP4/MOV keeps its video and sound; its metadata boxes and the samples of any track that is
 *    neither (timed metadata, GPS telemetry) are zeroed in place (media-sniff scrubMp4), and a
 *    fragmented one with such a track is refused. A WebM is kept as it is — its scrub is
 *    deferred, and the docs say so.
 * Every video is then opened in a hidden <video> once (probeVideo) for its size, its length when
 * the file does not say, and a poster frame. A video this browser cannot play is still accepted
 * — another device may play it — with a warning and no poster.
 *
 * The original file name is never kept anywhere.
 */
import { sniffKind, imageDims, inspectGif, cleanGif, inspectMp4, scrubMp4, inspectWebm } from './media-sniff.ts';
import { normalizeMediaRef } from './media-refs.ts';
import { sha256Hex } from './sha256.ts';
import { MB, IMAGE_MAX_EDGE, POSTER_EDGE, MAX_PHOTO_MP, DEFAULT_LIMITS } from './media-limits.ts';
import { playType } from './media-store.ts';
/** A refusal the editor turns into a sentence: code 'type' | 'too-large' (mb) | 'too-long'
 *  (sec) | 'photo-too-big' | 'unreadable'. */
export class MediaError extends Error {
    [key: string]: any;
    constructor(code?: any, extra: any = {}) { super(code); this.code = code; Object.assign(this, extra); }
}
const WARN_CODEC: any = 'codec'; // the editor's "may not play on every device" line
const round1: any = (n?: any) => Math.round(n * 10) / 10;
/* ---------------------------------------------------------------- photos */
/**
 * A decoded picture to draw from: { source, width, height, close() }. createImageBitmap first,
 * which applies the photo's own orientation; an <img> otherwise (older Safari). Throws
 * MediaError('unreadable') when neither can read it — a HEIC on a browser without HEIC support.
 */
export async function decodeImage(blob?: any, mime?: any, { doc = globalThis.document }: any = {}) {
    if (typeof globalThis.createImageBitmap === 'function') {
        try {
            const bmp: any = await globalThis.createImageBitmap(blob, { imageOrientation: 'from-image' });
            return { source: bmp, width: bmp.width, height: bmp.height, close: () => { try {
                    bmp.close();
                }
                catch { /* gone */ } } };
        }
        catch { /* the <img> path below */ }
    }
    if (!doc)
        throw new MediaError('unreadable');
    // Typed with the sniffed image type, never the file's own: see media-store.ts on blob: URLs.
    const url: any = URL.createObjectURL(new Blob([blob], { type: mime }));
    const img: any = doc.createElement('img');
    try {
        img.src = url;
        await img.decode();
        if (!img.naturalWidth || !img.naturalHeight)
            throw new Error('empty');
        return { source: img, width: img.naturalWidth, height: img.naturalHeight, close: () => URL.revokeObjectURL(url) };
    }
    catch {
        URL.revokeObjectURL(url);
        throw new MediaError('unreadable');
    }
}
const toBlob: any = (canvas?: any, type?: any, q?: any) => new Promise((resolve?: any) => {
    try {
        canvas.toBlob((b?: any) => resolve(b), type, q);
    }
    catch {
        resolve(null);
    }
});
const isWebp: any = async (blob?: any) => {
    if (!blob || blob.type !== 'image/webp')
        return false;
    const h: any = new Uint8Array(await blob.slice(0, 16).arrayBuffer());
    return sniffKind(h)?.mime === 'image/webp';
};
/**
 * `pic` drawn at most `edge` px on its long side and encoded: { blob, mime, width, height }.
 * WebP when toBlob really returns WebP — checked on the bytes, since Safari silently hands back
 * a PNG for a WebP request, and a PNG would slip past the size cap and keep the alpha channel
 * nobody asked for — else JPEG drawn on white. The canvas is emptied afterwards: a phone keeps
 * canvas memory until it is.
 */
export async function encodeImage(pic?: any, edge?: any, quality?: any, { doc = globalThis.document }: any = {}) {
    const scale: any = Math.min(1, edge / Math.max(pic.width, pic.height));
    const w: any = Math.max(1, Math.round(pic.width * scale));
    const h: any = Math.max(1, Math.round(pic.height * scale));
    const canvas: any = doc.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    try {
        const ctx: any = canvas.getContext('2d');
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(pic.source, 0, 0, w, h);
        const webp: any = await toBlob(canvas, 'image/webp', quality);
        if (await isWebp(webp))
            return { blob: webp, mime: 'image/webp', width: w, height: h };
        ctx.globalCompositeOperation = 'destination-over';
        ctx.fillStyle = '#fff';
        ctx.fillRect(0, 0, w, h);
        const jpeg: any = await toBlob(canvas, 'image/jpeg', quality);
        const head: any = jpeg ? new Uint8Array(await jpeg.slice(0, 4).arrayBuffer()) : null;
        if (!jpeg || sniffKind(head)?.mime !== 'image/jpeg')
            throw new MediaError('unreadable');
        return { blob: jpeg, mime: 'image/jpeg', width: w, height: h };
    }
    finally {
        canvas.width = 0;
        canvas.height = 0;
    }
}
// The photo itself, under the image cap: a busy 1600 px photo can come out above 2 MB at 0.85,
// so the quality steps down once and then the size, before the photo is refused.
async function encodeMain(pic?: any, limits?: any, deps?: any) {
    const cap: any = limits.imageMB * MB;
    for (const [edge, q] of [[IMAGE_MAX_EDGE, 0.85], [IMAGE_MAX_EDGE, 0.7], [1200, 0.7], [960, 0.6]]) {
        const out: any = await deps.encodeImage(pic, edge, q, deps);
        if (out.blob.size <= cap)
            return out;
    }
    throw new MediaError('too-large', { mb: limits.imageMB });
}
async function photo(file?: any, sniffed?: any, limits?: any, deps?: any) {
    if (file.size > limits.rawPhotoMB * MB)
        throw new MediaError('too-large', { mb: limits.rawPhotoMB });
    if (!sniffed.input) {
        const head: any = new Uint8Array(await file.slice(0, 256 * 1024).arrayBuffer());
        let d: any = imageDims(head);
        // A JPEG's frame header can sit behind APP segments bigger than that (a camera's maker notes,
        // an embedded preview); the check that comes after the decode would come too late to save
        // the memory, so the whole file — at most rawPhotoMB — is read for it instead.
        if (!d && sniffed.mime === 'image/jpeg' && file.size > head.length)
            d = imageDims(new Uint8Array(await file.arrayBuffer()));
        if (d && d.width * d.height > MAX_PHOTO_MP * 1e6)
            throw new MediaError('photo-too-big');
    }
    const pic: any = await deps.decodeImage(file, sniffed.mime, deps);
    try {
        if (pic.width * pic.height > MAX_PHOTO_MP * 1e6)
            throw new MediaError('photo-too-big');
        const main: any = await encodeMain(pic, limits, deps);
        const poster: any = await deps.encodeImage(pic, POSTER_EDGE, 0.8, deps);
        return { kind: 'image', main, poster };
    }
    finally {
        pic.close();
    }
}
/* ---------------------------------------------------------------- GIFs */
async function gif(file?: any, limits?: any, deps?: any) {
    if (file.size > limits.gifMB * MB)
        throw new MediaError('too-large', { mb: limits.gifMB });
    const bytes: any = new Uint8Array(await file.arrayBuffer());
    const info: any = inspectGif(bytes);
    if (!info)
        throw new MediaError('unreadable');
    if (info.frames === 1)
        return photo(new Blob([bytes], { type: 'image/gif' }), { mime: 'image/gif' }, limits, deps);
    // The same pixel guard as a photo's, on the logical screen, before the poster's decode — and
    // before every device that shows it decodes the animation at full size.
    if (info.width * info.height > MAX_PHOTO_MP * 1e6)
        throw new MediaError('photo-too-big');
    let clean: any;
    try {
        clean = cleanGif(bytes);
    }
    catch {
        throw new MediaError('unreadable');
    }
    const main: any = { blob: new Blob([clean], { type: 'image/gif' }), mime: 'image/gif', width: info.width, height: info.height };
    // The poster is the first frame: a decode of a GIF gives exactly that.
    let poster: any = null;
    const pic: any = await deps.decodeImage(main.blob, 'image/gif', deps);
    try {
        poster = await deps.encodeImage(pic, POSTER_EDGE, 0.8, deps);
    }
    finally {
        pic.close();
    }
    return { kind: 'gif', main, poster, dur: round1(info.durMs / 1000) };
}
/* ---------------------------------------------------------------- videos */
const once: any = (el?: any, ok?: any, ms?: any) => new Promise((resolve?: any, reject?: any) => {
    const done: any = (v?: any) => { clearTimeout(t); el.removeEventListener(ok, onOk); el.removeEventListener('error', onErr); v instanceof Error ? reject(v) : resolve(v); };
    const onOk: any = () => done(true);
    const onErr: any = () => done(new Error('media error'));
    const t: any = setTimeout(() => done(new Error('timeout')), ms);
    el.addEventListener(ok, onOk);
    el.addEventListener('error', onErr);
});
/**
 * Opens a video once in a detached, muted <video>: { width, height, duration, poster } — or
 * null when this browser cannot play it. duration is NaN when even a seek to the end does not
 * tell (a recording that never wrote its length). The poster is a frame half a second in (or
 * half-way through a shorter clip), drawn after a muted play/pause, since iOS may otherwise draw
 * black. Everything it made is taken down again before it returns.
 */
export async function probeVideo(blob?: any, mime?: any, { doc = globalThis.document, timeoutMs = 8000, encode = encodeImage }: any = {}) {
    if (!doc)
        return null;
    const video: any = doc.createElement('video');
    const url: any = URL.createObjectURL(new Blob([blob], { type: mime }));
    video.muted = true;
    video.playsInline = true;
    video.setAttribute('playsinline', '');
    video.preload = 'auto';
    try {
        video.src = url;
        await once(video, 'loadedmetadata', timeoutMs);
        let duration: any = video.duration;
        if (!Number.isFinite(duration)) {
            // Chrome's MediaRecorder WebM and fragmented MP4s say Infinity until the end is reached.
            try {
                video.currentTime = 1e7;
                await once(video, 'seeked', 3000);
                duration = video.duration;
            }
            catch { /* unknown, then */ }
        }
        const width: any = video.videoWidth, height: any = video.videoHeight;
        let poster: any = null;
        try {
            await video.play().catch(() => { });
            video.pause();
            const at: any = Number.isFinite(duration) && duration > 0 ? Math.min(0.5, duration / 2) : 0.1;
            video.currentTime = at;
            // A slow device (an emulator, an older phone) can spend seconds on this seek right after a
            // play that took as long: it gets the probe's whole budget. One that still has not landed
            // draws the frame the element holds, if it holds one — a poster a little off the half
            // second beats none, which no other device would ever make up for.
            try {
                await once(video, 'seeked', timeoutMs);
            }
            catch (e: any) {
                if (e?.message !== 'timeout' || !(video.readyState >= 2))
                    throw e;
            }
            if (width && height)
                poster = await encode({ source: video, width, height }, POSTER_EDGE, 0.8, { doc });
        }
        catch {
            poster = null;
        }
        return { width, height, duration, poster };
    }
    catch {
        return null;
    }
    finally {
        try {
            video.pause();
        }
        catch { /* never played */ }
        video.removeAttribute('src');
        try {
            video.load();
        }
        catch { /* nothing loaded */ }
        URL.revokeObjectURL(url);
    }
}
async function video(file?: any, sniffed?: any, limits?: any, deps?: any) {
    if (file.size > limits.videoMB * MB)
        throw new MediaError('too-large', { mb: limits.videoMB });
    let bytes: any = new Uint8Array(await file.arrayBuffer());
    let info: any = null;
    let mime: any = sniffed.mime;
    if (mime === 'video/webm') {
        info = inspectWebm(bytes);
        if (!info)
            throw new MediaError('unreadable');
    }
    else {
        info = inspectMp4(bytes);
        if (!info)
            throw new MediaError('unreadable');
        // The same rule as the server: a length it says is checked, an unknown one passes.
        if (info.durationSec != null && info.durationSec > limits.videoSec + 1)
            throw new MediaError('too-long', { sec: limits.videoSec });
        try {
            bytes = scrubMp4(bytes);
        }
        catch {
            throw new MediaError('unreadable');
        }
        mime = info.brand === 'qt  ' ? 'video/quicktime' : 'video/mp4';
    }
    const blob: any = new Blob([bytes], { type: mime });
    bytes = null;
    const probe: any = await deps.probeVideo(blob, mime === 'video/quicktime' ? deps.playType(mime) : mime, deps);
    let dur: any = info.durationSec > 0 ? info.durationSec : (probe && Number.isFinite(probe.duration) && probe.duration > 0 ? probe.duration : null);
    if (dur != null && dur > limits.videoSec + 1)
        throw new MediaError('too-long', { sec: limits.videoSec });
    const width: any = info.width || probe?.width || 0;
    const height: any = info.height || probe?.height || 0;
    if (!width || !height)
        throw new MediaError('unreadable');
    const codec: any = info.codec || 'other';
    const warn: any = !probe || mime === 'video/webm' || codec !== 'avc1';
    return {
        kind: 'video',
        main: { blob, mime, width, height },
        poster: probe?.poster || null,
        dur: dur != null ? round1(dur) : null,
        codec,
        warnings: warn ? [WARN_CODEC] : []
    };
}
/* ---------------------------------------------------------------- the whole ingest */
const DEFAULT_DEPS: any = { decodeImage, encodeImage, probeVideo, playType: (m?: any) => playType(m) };
/**
 * A picked File → { media, blobs: [{ hash, blob, mime }], warnings }. `media` is a MediaRef that
 * passes normalizeMediaRef; `blobs` are the main file and its poster, to go into the local store
 * as pending. Throws MediaError. `deps` swaps the browser parts (decoding, encoding, the probe)
 * for the tests.
 */
export async function ingestMediaFile(file?: any, limits: any = DEFAULT_LIMITS, deps: any = {}) {
    const d: any = { ...DEFAULT_DEPS, ...deps };
    const lim: any = { ...DEFAULT_LIMITS, ...limits };
    const head: any = new Uint8Array(await file.slice(0, 64).arrayBuffer());
    const sniffed: any = sniffKind(head);
    if (!sniffed)
        throw new MediaError('type');
    const out: any = sniffed.kind === 'video' ? await video(file, sniffed, lim, d)
        : sniffed.kind === 'gif' ? await gif(file, lim, d)
            : await photo(file, sniffed, lim, d);
    const blobs: any = [];
    const withHash: any = async (part?: any) => {
        const hash: any = await sha256Hex(part.blob);
        if (!blobs.some((b?: any) => b.hash === hash))
            blobs.push({ hash, blob: part.blob, mime: part.mime });
        return hash;
    };
    const ref: any = {
        kind: out.kind,
        hash: await withHash(out.main),
        mime: out.main.mime,
        size: out.main.blob.size,
        width: out.main.width,
        height: out.main.height,
        at: Date.now()
    };
    if (out.dur != null)
        ref.dur = out.dur;
    if (out.codec)
        ref.codec = out.codec;
    if (out.poster) {
        ref.poster = { hash: await withHash(out.poster), mime: out.poster.mime, size: out.poster.blob.size, width: out.poster.width, height: out.poster.height };
    }
    const media: any = normalizeMediaRef(ref);
    if (!media)
        throw new MediaError('unreadable');
    return { media, blobs, warnings: out.warnings || [] };
}
