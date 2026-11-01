// Legacy dynamic types are explicit during the full language migration.
// Which picture an exercise animation is drawn from in the store apps: the quality the person
// picked (Settings → Animations), the asset packs this device has, and the files built into the
// app. Pure: no plugin, no store, no DOM, so every rule here is a unit test (anim-quality.test.js).
//
// LICENCE. The animations are licensed from Gym visual. The repository, the web build and every
// self-hosted server only ever have the 180 px files; anything larger reaches people only inside
// the official store apps: built into the package, or in an Apple-hosted asset pack (Background
// Assets) / a Play asset pack that the store itself delivers. Never from a server of ours, never as
// a URL anyone can fetch. This file only ever names files by drawing id; it never reads one.
//
// The packs: one per quality and figure, `anim-<px>-male` / `anim-<px>-female`. A figure's pack
// holds every drawing that figure shows: each catalogue exercise's drawing for that figure, or its
// own when it is drawn once (those are in both packs). scripts/media/make-pack-manifests.mjs writes
// them from the catalogue with the same rule (packDrawingId below). Inside a pack a drawing sits at
// `<packId>/<drawing id>.webp`, so two packs installed side by side never share a path.
//
// Custom exercises never come here: their media are their own (components/CustomMedia.tsx).
// The qualities a pack exists in, smallest first. The built-in files are BUILTIN_PX.
export const PACK_QUALITIES: any = [240, 360, 480, 720, 1080];
export const FIGURES: any = ['male', 'female'];
// What the app package carries itself. The repository's 180 px unless the release build says
// otherwise (VITE_BUILTIN_CLIP_PX, set together with APP_MEDIA_DIR).
const ENV: any = import.meta.env || {};
export const BUILTIN_PX: any = Number(ENV.VITE_BUILTIN_CLIP_PX) > 0 ? Number(ENV.VITE_BUILTIN_CLIP_PX) : 180;
// The choices: 'auto', 'still' (no animation), 'builtin', or a pack quality in px.
export const DEFAULT_CHOICE: any = 'auto';
/** The qualities offered as packs: only those sharper than what is built in. */
export const packQualities: any = (builtin: any = BUILTIN_PX) => PACK_QUALITIES.filter((px?: any) => px > builtin);
export const packId: any = (px?: any, figure?: any) => `anim-${px}-${figure === 'female' ? 'female' : 'male'}`;
/** { px, figure } of a pack id, or null for anything else. */
export function parsePackId(id?: any) {
    const m: any = /^anim-(\d+)-(male|female)$/.exec(String(id || ''));
    return m && PACK_QUALITIES.includes(+m[1]) ? { px: +m[1], figure: m[2] } : null;
}
/** Auto: 360 on a phone, 720 on a tablet (a short side of 600 CSS px or more). */
export const autoPx: any = ({ shortSide = 0 }: any = {}) => (shortSide >= 600 ? 720 : 360);
/** A stored choice read back: anything unknown is Auto. */
export function readChoice(v?: any) {
    if (v === 'auto' || v === 'still' || v === 'builtin')
        return v;
    const n: any = Number(v);
    return PACK_QUALITIES.includes(n) ? n : DEFAULT_CHOICE;
}
/**
 * The quality a choice stands for: a px, 'still' or 'builtin'. A pack quality no sharper than the
 * built-in files is the built-in files.
 */
export function wantedQuality(choice?: any, device: any = {}, builtin: any = BUILTIN_PX) {
    const c: any = readChoice(choice);
    if (c === 'still' || c === 'builtin')
        return c;
    const px: any = c === 'auto' ? autoPx(device) : c;
    return px > builtin ? px : 'builtin';
}
/**
 * The drawing an exercise shows for a figure, the same rule as lib/exercises.ts gifSrc: its twin
 * drawn on that figure when it has one, else its own. The file name, without its extension.
 */
export function packDrawingId(ex?: any, figure?: any) {
    const twin: any = figure === 'female' ? ex?.fv : figure === 'male' ? ex?.mv : null;
    if (twin)
        return twin;
    const own: any = typeof ex?.gif === 'string' && ex.gif ? ex.gif.replace(/\.[a-z0-9]+$/i, '') : ex?.id;
    return own ? String(own) : null;
}
/**
 * Where an animation comes from, best first, never empty:
 *   1. the chosen quality's pack for this figure, if installed,
 *   2. every smaller pack of this figure that is installed, sharpest first,
 *   3. the built-in file (`builtin`, lib/exercises.ts gifSrc).
 * `installed` maps a pack id to the base its files are read from (Capacitor.convertFileSrc of the
 * native path); a pack not in it, or without a base, is not there. 'still' gives no animation at
 * all: `{ still: true, sources: [] }`, and the caller shows the still.
 */
export function clipSources({ ex, figure, choice, device, installed = {}, builtin, builtinPx = BUILTIN_PX }: any) {
    const want: any = wantedQuality(choice, device, builtinPx);
    if (want === 'still')
        return { still: true, sources: [] };
    const sources: any = [];
    const id: any = packDrawingId(ex, figure);
    if (id && want !== 'builtin') {
        for (const px of [...PACK_QUALITIES].reverse()) {
            if (px > want || px <= builtinPx)
                continue;
            const base: any = installed[packId(px, figure)];
            if (typeof base === 'string' && base)
                sources.push(base.replace(/\/$/, '') + '/' + id + '.webp');
        }
    }
    if (builtin)
        sources.push(builtin);
    return { still: false, sources };
}
/** The pack a choice wants downloaded for a figure, or null (still, built in). */
export function wantedPack(choice?: any, figure?: any, device?: any, builtin: any = BUILTIN_PX) {
    const want: any = wantedQuality(choice, device, builtin);
    return typeof want === 'number' ? packId(want, figure) : null;
}
