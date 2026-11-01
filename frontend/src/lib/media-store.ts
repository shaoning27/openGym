// Legacy dynamic types are explicit during the full language migration.
/* The one local store for the photos, GIFs and videos of custom exercises.
 *
 * Every mode shows media from here: a signed-in browser, a paired phone, a phone in local mode, a
 * guest and the demo. A file gets here either from the editor (picked on this device) or from the
 * server (lib/media-sync.ts fetchToStore, checked against its sha256 first); it is then shown from
 * here, offline included. That one path is also what lets a paired phone show a file at all — an
 * <img src> cannot carry the phone's Authorization header, a fetch can.
 *
 * Backends: IndexedDB in a browser (media-store-idb.ts), the app's own folder on a phone
 * (media-store-fs.ts), and memory — for the tests, and for display only when IndexedDB is
 * blocked (a private window in some browsers). The store says which through `persistent`: the
 * editor refuses new files when nothing here would outlive the tab.
 *
 * A record is { hash, mime, size, putAt, shownAt, pending, rejected }:
 *   pending   the server has not confirmed it holds the file (picked here, or imported)
 *   rejected  the server refused it for good (too large, wrong type): it stays here, still
 *             pending, and is not offered again until someone asks (Settings → Photos & videos)
 *   shownAt   when it was last displayed, written at most once an hour — what eviction reads
 *
 * url(hash) hands out an object URL (browser) or a file URL (phone), counted per hash: each
 * caller releases it when done, and an object URL is revoked 30 s after the last release, so a
 * list scrolling back and forth does not decode the same file again and again. Object URLs are
 * only ever made from `new Blob([blob], { type })` with the stored, allowlisted media type: a
 * blob: URL typed text/html would run as this origin if anyone navigated to it.
 */
import { MEDIA_MIMES } from './media-refs.ts';
import { MOBILE } from './mobile.ts';
import { idbBackend } from './media-store-idb.ts';
import { fsBackend } from './media-store-fs.ts';
const HOUR: any = 3600000;
/** A backend that forgets everything with the page — the tests', and the fallback's. */
export function memoryBackend() {
    const recs: any = new Map();
    const blobs: any = new Map();
    return {
        name: 'memory',
        persistent: false,
        async open() { return true; },
        async all() { return [...recs.values()].map((r?: any) => ({ ...r })); },
        async getBlob(hash?: any) { return blobs.get(hash) || null; },
        async put(rec?: any, blob?: any) { recs.set(rec.hash, { ...rec }); if (blob)
            blobs.set(rec.hash, blob); },
        async patch(hash?: any, fields?: any) { const r: any = recs.get(hash); if (r)
            recs.set(hash, { ...r, ...fields }); },
        async remove(hash?: any) { recs.delete(hash); blobs.delete(hash); },
        async clear() { recs.clear(); blobs.clear(); }
    };
}
// The type a <video> can play a file as. A MOV is an MP4 in all that matters to a browser, and
// most refuse "video/quicktime" outright (Chrome, Firefox, Android) while playing the same bytes
// typed video/mp4. Safari plays it as what it is.
export function playType(mime?: any, canPlayType: any = defaultCanPlay) {
    if (mime !== 'video/quicktime')
        return mime;
    return canPlayType('video/quicktime') ? mime : 'video/mp4';
}
function defaultCanPlay(type?: any) {
    try {
        return typeof document !== 'undefined' ? document.createElement('video').canPlayType(type) : '';
    }
    catch {
        return '';
    }
}
export function createMediaStore(backend?: any, { fallback = memoryBackend, now = () => Date.now(), objectURL = globalThis.URL, revokeDelayMs = 30000, canPlayType = defaultCanPlay }: any = {}) {
    let be: any = backend;
    let opening: any = null;
    let persistent: any = !!backend.persistent;
    const index: any = new Map();
    const listeners: any = new Set();
    // hash → { url, refs, timer, file }  (file: a phone's file URL, which is never revoked)
    const urls: any = new Map();
    const making: any = new Map(); // hash → the url() in progress, so two callers make one
    const held: any = new Map(); // hash → how many open editors hold it as their draft (hold)
    const emit: any = () => { for (const fn of listeners) {
        try {
            fn();
        }
        catch { /* a listener's own problem */ }
    } };
    const ready: any = () => {
        if (!opening) {
            opening = (async () => {
                let ok: any = false;
                try {
                    ok = await be.open();
                }
                catch {
                    ok = false;
                }
                if (!ok) {
                    be = fallback();
                    persistent = false;
                    await be.open();
                }
                else
                    persistent = !!be.persistent;
                try {
                    for (const r of await be.all())
                        index.set(r.hash, r);
                }
                catch { /* an empty index then */ }
                emit();
            })();
        }
        return opening;
    };
    const revokeNow: any = (hash?: any) => {
        const u: any = urls.get(hash);
        if (!u)
            return;
        clearTimeout(u.timer);
        urls.delete(hash);
        if (!u.file) {
            try {
                objectURL.revokeObjectURL(u.url);
            }
            catch { /* already gone */ }
        }
    };
    const store: any = {
        ready,
        /** Marks files as a draft's (an editor that is open) until the returned function is called.
         *  The local clean-up keeps what is held however long ago it was put: its one-hour grace is
         *  for a draft abandoned, not for one still being written. In memory only — a draft does not
         *  outlive its tab. */
        hold(hashes?: any) {
            const hs: any = [...new Set(hashes)].filter(Boolean);
            for (const h of hs)
                held.set(h, (held.get(h) || 0) + 1);
            let done: any = false;
            return () => {
                if (done)
                    return;
                done = true;
                for (const h of hs) {
                    const n: any = (held.get(h) || 0) - 1;
                    if (n > 0)
                        held.set(h, n);
                    else
                        held.delete(h);
                }
            };
        },
        isHeld: (hash?: any) => held.has(hash),
        get persistent() { return persistent; },
        get backendName() { return be.name; },
        subscribe(fn?: any) { listeners.add(fn); return () => listeners.delete(fn); },
        async has(hash?: any) { await ready(); return index.has(hash); },
        /** The record with its blob, or null. */
        async get(hash?: any) {
            await ready();
            const r: any = index.get(hash);
            if (!r)
                return null;
            const blob: any = await be.getBlob(hash).catch(() => null);
            if (!blob)
                return null;
            return { blob, mime: r.mime, size: r.size, pending: !!r.pending, rejected: !!r.rejected };
        },
        /** Keeps `blob` under `hash`. The same hash is the same bytes, so a second put only updates
         *  the record — `pending` as the caller says: false when the server has just sent it. */
        async put(hash?: any, blob?: any, { mime, pending = true }: any = {}) {
            if (!MEDIA_MIMES[mime])
                throw new Error('media-store: not a media type: ' + mime);
            await ready();
            const t: any = now();
            const cur: any = index.get(hash);
            if (cur) {
                const fields: any = { pending: !!pending, rejected: pending ? !!cur.rejected : false, putAt: t };
                index.set(hash, { ...cur, ...fields });
                await be.patch(hash, fields);
            }
            else {
                const rec: any = { hash, mime, size: blob.size, putAt: t, shownAt: 0, pending: !!pending, rejected: false };
                await be.put(rec, blob);
                index.set(hash, rec);
            }
            emit();
        },
        /** A URL to show the file by, or null when it is not here. Release it when done. */
        async url(hash?: any) {
            await ready();
            const have: any = urls.get(hash);
            if (have) {
                have.refs++;
                clearTimeout(have.timer);
                have.timer = null;
                return have.url;
            }
            if (making.has(hash)) {
                const u: any = await making.get(hash);
                if (u) {
                    const e: any = urls.get(hash);
                    if (e) {
                        e.refs++;
                        clearTimeout(e.timer);
                        e.timer = null;
                    }
                }
                return u;
            }
            const r: any = index.get(hash);
            if (!r)
                return null;
            const job: any = (async () => {
                let url: any = null, file: any = false;
                if (typeof be.fileUrl === 'function') {
                    url = await be.fileUrl(hash, r).catch(() => null);
                    file = !!url;
                }
                if (!url) {
                    const blob: any = await be.getBlob(hash).catch(() => null);
                    if (!blob)
                        return null;
                    url = objectURL.createObjectURL(new Blob([blob], { type: playType(r.mime, canPlayType) }));
                }
                urls.set(hash, { url, refs: 0, timer: null, file });
                return url;
            })();
            making.set(hash, job);
            let url: any;
            try {
                url = await job;
            }
            finally {
                making.delete(hash);
            }
            const entry: any = url && urls.get(hash);
            if (!entry)
                return null; // not here, or removed while the URL was being made
            entry.refs++;
            // When it was last shown decides what goes first when the cache is full; an hour is
            // precise enough, and a write per display would be one per scroll.
            if (!t0(r.shownAt) || t0(r.shownAt) + HOUR <= now()) {
                r.shownAt = now();
                be.patch(hash, { shownAt: r.shownAt }).catch(() => { });
            }
            return url;
        },
        release(hash?: any) {
            const u: any = urls.get(hash);
            if (!u)
                return;
            u.refs = Math.max(0, u.refs - 1);
            if (u.refs || u.timer)
                return;
            u.timer = setTimeout(() => { const cur: any = urls.get(hash); if (cur && !cur.refs)
                revokeNow(hash); }, revokeDelayMs);
        },
        async markSynced(hash?: any) {
            await ready();
            const r: any = index.get(hash);
            if (!r || (!r.pending && !r.rejected))
                return;
            Object.assign(r, { pending: false, rejected: false });
            await be.patch(hash, { pending: false, rejected: false });
            emit();
        },
        async markRejected(hash?: any) {
            await ready();
            const r: any = index.get(hash);
            if (!r || r.rejected)
                return;
            r.rejected = true;
            await be.patch(hash, { rejected: true });
            emit();
        },
        async remove(hash?: any) {
            await ready();
            if (!index.has(hash))
                return;
            revokeNow(hash);
            index.delete(hash);
            await be.remove(hash).catch(() => { });
            emit();
        },
        /** Deletes every record not in `keep`, except those put at or after `keepPutAfter` — a file
         *  picked meanwhile in an editor that is still open, or by another tab. */
        async retainOnly(keep?: any, { keepPutAfter = now() }: any = {}) {
            await ready();
            let removed: any = 0;
            for (const [hash, r] of [...index]) {
                if (keep.has(hash) || (r.putAt || 0) >= keepPutAfter)
                    continue;
                revokeNow(hash);
                index.delete(hash);
                await be.remove(hash).catch(() => { });
                removed++;
            }
            if (removed)
                emit();
            return removed;
        },
        async clearAll() {
            await ready();
            for (const hash of [...urls.keys()])
                revokeNow(hash);
            index.clear();
            await be.clear().catch(() => { });
            emit();
        },
        async list() { await ready(); return [...index.values()].map((r?: any) => ({ ...r })); },
        async usage() {
            await ready();
            let bytes: any = 0;
            for (const r of index.values())
                bytes += r.size || 0;
            return { bytes, count: index.size };
        },
        async pendingHashes() { await ready(); return store.pendingNow(); },
        /** The pending hashes as the index holds them right now — empty before it has loaded. For
         *  the sign-out check (lib/media-owed.ts), which cannot wait. */
        pendingNow() { return new Set([...index.values()].filter((r?: any) => r.pending).map((r?: any) => r.hash)); },
        /** The rejected hashes, for Settings to say what the server would not take. */
        rejectedNow() { return new Set([...index.values()].filter((r?: any) => r.rejected).map((r?: any) => r.hash)); }
    };
    return store;
}
const t0: any = (v?: any) => (typeof v === 'number' ? v : 0);
let shared: any = null;
/** The app's store: the phone's folder in the mobile build, IndexedDB everywhere else. Made on
 *  first use, so importing this module opens nothing. */
export function getMediaStore() {
    if (!shared)
        shared = createMediaStore(MOBILE ? fsBackend() : idbBackend());
    return shared;
}
/** Whether anything in this session has used the store (the sync at start, the editor, a
 *  thumbnail) and so made and opened it. */
export const mediaStoreInUse: any = () => shared !== null;
/** Tests only: swap the shared store (null makes a fresh one on next use). */
export function _setMediaStore(s?: any) { shared = s; }
/** The shared store under the name the rest of the app uses. A thin forwarder, so that importing
 *  it is free and a test can swap what it forwards to (_setMediaStore). */
export const mediaStore: any = new Proxy({}, {
    get(_?: any, key?: any) {
        const s: any = getMediaStore();
        const v: any = s[key];
        return typeof v === 'function' ? v.bind(s) : v;
    }
});
