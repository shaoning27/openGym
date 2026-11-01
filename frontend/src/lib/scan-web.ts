// Legacy dynamic types are explicit during the full language migration.
// Browser-side QR decoding for the gym check-in — the PWA half of lib/scan.js. The app build
// hands scanning to ML Kit; here in a browser tab (installed PWA on a phone, most often) we do
// it ourselves: draw the source — an uploaded photo or a live <video> frame — onto an offscreen
// canvas and decode the pixels.
//
// Two decoders, tried in order:
//   1. BarcodeDetector — the browser's own (Chrome/Edge on Android, Samsung Internet). Native
//      speed and quality when it exists; asked for QR only.
//   2. jsQR (Apache-2.0, see NOTICE.md) — pure JS, works everywhere including iOS Safari, which
//      has no BarcodeDetector. Loaded with a dynamic import so it only ships when someone scans.
//
// decodeImageData is the pure core (pixels in, string out) and is what the unit test exercises;
// decodeSource wraps it with the canvas plumbing the browser paths need.
import { normalizeFmt } from './qr.ts';
let _jsqr: any = null;
async function loadJsQr() {
    if (!_jsqr)
        _jsqr = (await import('jsqr')).default;
    return _jsqr;
}
let _detector: any = null;
function nativeDetector() {
    if (_detector !== null)
        return _detector;
    try {
        _detector = (typeof BarcodeDetector === 'function') ? new BarcodeDetector({ formats: ['qr_code'] }) : false;
    }
    catch (e: any) {
        _detector = false;
    }
    return _detector;
}
// { data, width, height } (an ImageData or anything shaped like one) → { value, fmt } | null.
// jsQR only; the native detector wants a drawable, not raw pixels, so it lives in decodeSource.
export async function decodeImageData(img?: any) {
    if (!img || !img.data || !img.width || !img.height)
        return null;
    const jsQR: any = await loadJsQr();
    const hit: any = jsQR(img.data, img.width, img.height, { inversionAttempts: 'attemptBoth' });
    return hit && hit.data ? { value: hit.data, fmt: 'qrcode' } : null;
}
// Decode from anything drawImage accepts: <video>, <img>, ImageBitmap, canvas. The source is
// scaled down to at most MAX px on its long edge — plenty for a QR, and it keeps jsQR fast enough
// to run on every few video frames on a phone. Reuses one canvas across calls.
const MAX: any = 800;
let _canvas: any = null;
export async function decodeSource(source?: any) {
    const sw: any = source.videoWidth || source.naturalWidth || source.width || 0;
    const sh: any = source.videoHeight || source.naturalHeight || source.height || 0;
    if (!sw || !sh)
        return null;
    const k: any = Math.min(1, MAX / Math.max(sw, sh));
    const w: any = Math.max(1, Math.round(sw * k)), h: any = Math.max(1, Math.round(sh * k));
    if (!_canvas)
        _canvas = document.createElement('canvas');
    _canvas.width = w;
    _canvas.height = h;
    const ctx: any = _canvas.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(source, 0, 0, w, h);
    const det: any = nativeDetector();
    if (det) {
        try {
            const found: any = await det.detect(_canvas);
            const b: any = found && found.find((x?: any) => x.rawValue);
            if (b)
                return { value: b.rawValue, fmt: normalizeFmt(b.format) || 'qrcode' };
        }
        catch (e: any) { /* fall through to jsQR */ }
    }
    return decodeImageData(ctx.getImageData(0, 0, w, h));
}
// A picked File → { value, fmt } | null. createImageBitmap honours EXIF orientation where the
// browser supports it, which matters for photos of a card taken in portrait.
export async function importCodeFromImageWeb(file?: any) {
    if (!file)
        return null;
    let bmp: any;
    if (typeof createImageBitmap === 'function') {
        bmp = await createImageBitmap(file);
    }
    else {
        bmp = await new Promise((resolve?: any, reject?: any) => {
            const img: any = new Image();
            img.onload = () => resolve(img);
            img.onerror = () => reject(new Error('bad image'));
            img.src = URL.createObjectURL(file);
        });
    }
    try {
        return await decodeSource(bmp);
    }
    finally {
        if (bmp.close)
            bmp.close();
    }
}
