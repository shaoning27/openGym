// Legacy dynamic types are explicit during the full language migration.
/* The phone's backend for lib/media-store.ts: plain files in the app's own folder.
 *
 *   Library/opengym-media/<hash>.<playExt>   one file per photo, GIF or video
 *   Library/opengym-media/index.json          { hash: { mime, size, putAt, shownAt, pending, rejected } }
 *
 * Directory.Library is iOS's Library folder (kept in device backups, never shown in Files) and
 * Android's files directory. Android's cloud backup is told to leave the folder out
 * (res/xml/backup_rules.xml): Auto Backup skips an app's WHOLE backup once it passes 25 MB, and
 * that would take the state mirror down with the videos.
 *
 * Files are shown by their file URL through the WebView's local server — no copy into memory,
 * and a long video can seek. That server types a file by its extension and will not hand a
 * .mov to <video> as something it plays, so a MOV is stored as .mp4 (MEDIA_MIMES playExt).
 *
 * Crash safety: a file is written to <name>.part and renamed once complete, and the index is
 * written after the files it lists (1 s debounce, flushed when the app goes to the background).
 * At start the two are reconciled: an index entry without its file is dropped, and a file
 * without an entry is checked against its name's sha256 and kept as pending — the upload is
 * idempotent, and the server's /missing answer decides whether it is needed at all.
 *
 * Big files cross the native bridge as base64 in 3 MB pieces (writeFile, then appendFile), never
 * as one 50 MB string.
 */
import { MEDIA_MIMES } from './media-refs.ts';
import { sniffKind } from './media-sniff.ts';
import { sha256Hex } from './sha256.ts';
const DIR: any = 'opengym-media';
const INDEX: any = DIR + '/index.json';
const CHUNK: any = 3 * 1024 * 1024; // a multiple of 3, so no piece but the last has base64 padding
const FILE_RE: any = /^([0-9a-f]{64})\.(jpg|png|webp|gif|mp4|webm)$/;
/** Uint8Array → base64, in slices small enough for String.fromCharCode's argument limit. */
export function toBase64(u8?: any) {
    let s: any = '';
    for (let i: any = 0; i < u8.length; i += 0x8000)
        s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
    return btoa(s);
}
const fileName: any = (hash?: any, mime?: any) => hash + '.' + (MEDIA_MIMES[mime]?.playExt || 'bin');
export function fsBackend({ load = () => import('@capacitor/filesystem'), core = () => import('@capacitor/core'), app = () => import('@capacitor/app'), fetchImpl = (...a: any[]) => (globalThis.fetch as any)(...a), hash = sha256Hex, debounceMs = 1000 }: any = {}) {
    let FS: any = null, Directory: any = null, Encoding: any = null, convert: any = (s?: any) => s;
    let recs: any = {};
    let writeTm: any = null;
    let writing: any = Promise.resolve();
    const uris: any = new Map();
    const opts: any = (path?: any) => ({ path, directory: Directory.Library });
    const uriOf: any = async (name?: any) => {
        if (uris.has(name))
            return uris.get(name);
        const { uri }: any = await FS.getUri(opts(DIR + '/' + name));
        const u: any = convert(uri);
        uris.set(name, u);
        return u;
    };
    const readFileBlob: any = async (name?: any) => {
        const r: any = await fetchImpl(await uriOf(name));
        if (!r.ok)
            throw new Error('read ' + r.status);
        return r.blob();
    };
    const saveIndex: any = () => {
        writing = writing.then(() => FS.writeFile({ ...opts(INDEX), data: JSON.stringify(recs), encoding: Encoding.UTF8, recursive: true })).catch(() => { });
        return writing;
    };
    const scheduleIndex: any = () => {
        clearTimeout(writeTm);
        writeTm = setTimeout(() => { writeTm = null; saveIndex(); }, debounceMs);
    };
    const flush: any = () => { if (writeTm) {
        clearTimeout(writeTm);
        writeTm = null;
        return saveIndex();
    } return writing; };
    return {
        name: 'fs',
        persistent: true,
        flush,
        async open() {
            try {
                const m: any = await load();
                FS = m.Filesystem;
                Directory = m.Directory;
                Encoding = m.Encoding;
                try {
                    const c: any = await core();
                    if (c?.Capacitor?.convertFileSrc)
                        convert = (u?: any) => c.Capacitor.convertFileSrc(u);
                }
                catch { /* the raw URI then */ }
            }
            catch {
                return false;
            }
            try {
                await FS.mkdir({ ...opts(DIR), recursive: true });
            }
            catch { /* already there */ }
            try {
                const r: any = await FS.readFile({ ...opts(INDEX), encoding: Encoding.UTF8 });
                const parsed: any = JSON.parse(r.data);
                recs = parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
            }
            catch {
                recs = {};
            }
            let names: any = [];
            try {
                const r: any = await FS.readdir(opts(DIR));
                names = (r.files || []).map((f?: any) => (typeof f === 'string' ? f : f?.name)).filter(Boolean);
            }
            catch {
                names = [];
            }
            const present: any = new Set(names);
            let changed: any = false;
            // Entries whose file is gone: the file was never renamed into place, or was deleted.
            for (const [h, r] of Object.entries(recs)) {
                if (!r || !MEDIA_MIMES[(r as any).mime] || !present.has(fileName(h, (r as any).mime))) {
                    delete recs[h];
                    changed = true;
                }
            }
            for (const name of names) {
                if (name.endsWith('.part')) {
                    FS.deleteFile(opts(DIR + '/' + name)).catch(() => { });
                    continue;
                }
                const m: any = FILE_RE.exec(name);
                if (!m || recs[m[1]])
                    continue;
                // A file the index never got to list (the app died within the debounce). Its name is
                // its hash; one whose bytes do not match is half a write and goes.
                try {
                    const blob: any = await readFileBlob(name);
                    const head: any = new Uint8Array(await blob.slice(0, 64).arrayBuffer());
                    const sniffed: any = sniffKind(head);
                    if ((await hash(blob)) !== m[1] || !sniffed || !MEDIA_MIMES[sniffed.mime])
                        throw new Error('mismatch');
                    recs[m[1]] = { hash: m[1], mime: sniffed.mime, size: blob.size, putAt: Date.now(), shownAt: 0, pending: true, rejected: false };
                    changed = true;
                }
                catch {
                    FS.deleteFile(opts(DIR + '/' + name)).catch(() => { });
                }
            }
            if (changed)
                await saveIndex();
            app().then(({ App }: any) => App.addListener('appStateChange', ({ isActive }: any) => { if (!isActive)
                flush(); })).catch(() => { });
            return true;
        },
        async all() { return Object.entries(recs).map(([h, r]: any) => ({ ...r, hash: h })); },
        async getBlob(h?: any) {
            const r: any = recs[h];
            if (!r)
                return null;
            try {
                return await readFileBlob(fileName(h, r.mime));
            }
            catch {
                return null;
            }
        },
        async put(rec?: any, blob?: any) {
            const name: any = fileName(rec.hash, rec.mime);
            const part: any = DIR + '/' + name + '.part';
            for (let o: any = 0; o < blob.size || o === 0; o += CHUNK) {
                const data: any = toBase64(new Uint8Array(await blob.slice(o, o + CHUNK).arrayBuffer()));
                if (o === 0)
                    await FS.writeFile({ ...opts(part), data, recursive: true });
                else
                    await FS.appendFile({ ...opts(part), data });
                if (!blob.size)
                    break;
            }
            try {
                await FS.deleteFile(opts(DIR + '/' + name));
            }
            catch { /* not there, as expected */ }
            await FS.rename({ from: part, to: DIR + '/' + name, directory: Directory.Library, toDirectory: Directory.Library });
            uris.delete(name);
            recs[rec.hash] = { ...rec };
            scheduleIndex();
        },
        async patch(h?: any, fields?: any) {
            if (!recs[h])
                return;
            recs[h] = { ...recs[h], ...fields };
            scheduleIndex();
        },
        async remove(h?: any) {
            const r: any = recs[h];
            if (!r)
                return;
            delete recs[h];
            const name: any = fileName(h, r.mime);
            uris.delete(name);
            // The file first: a crash in between leaves an index entry without its file, which the
            // next start drops. The other order would leave a file without an entry, which that start
            // would take for an unlisted new one and keep.
            try {
                await FS.deleteFile(opts(DIR + '/' + name));
            }
            catch { /* already gone */ }
            scheduleIndex();
        },
        async clear() {
            recs = {};
            uris.clear();
            clearTimeout(writeTm);
            writeTm = null;
            await writing;
            try {
                await FS.rmdir({ ...opts(DIR), recursive: true });
            }
            catch { /* nothing there */ }
            try {
                await FS.mkdir({ ...opts(DIR), recursive: true });
            }
            catch { /* the next put makes it */ }
        },
        async fileUrl(h?: any) {
            const r: any = recs[h];
            return r ? uriOf(fileName(h, r.mime)) : null;
        }
    };
}
