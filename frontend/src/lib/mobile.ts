// Legacy dynamic types are explicit during the full language migration.
// Mobile build (VITE_MOBILE=1) — the standalone app-store version (Capacitor native shell).
//
// There is no backend: nothing to sign in to, everything lives on the phone. Unlike guest
// mode in a browser, this is the user's only copy of their training log, so it can't depend
// on WebView localStorage alone (iOS evicts that under storage pressure). Every persist()
// therefore also lands in a JSON file in the app's private data directory, and boot()
// restores from it. The workout reminder uses native local notifications scheduled per future
// calendar date — no server involved, unlike Web Push in the self-hosted version.
//
// Like the demo build, MOBILE is replaced at build time, so all of this folds away in
// web bundles; the Capacitor plugins are only ever imported behind it.
import { t, tn } from './i18n-core.ts';
import { isoOf, todayISO } from './format.ts';
import { effectiveRoutineIds } from './history.ts';
import { NUDGE_COPY, lineIndex, nudgeFor, nudgeMinute, toneOf } from './nudge.ts';
import { excusedOn } from './day-notes.ts';
import { stateJson } from './state-json.ts';
export const MOBILE: any = import.meta.env.VITE_MOBILE === '1';
// Some features only make sense on Android. The in-app updater downloads an .apk and hands it
// to the system package installer — there is no equivalent on iOS (App Store only) or on the
// web build. On anything but a native Android shell this must stay off.
//
// @capacitor/core is imported dynamically (like every other Capacitor dependency here) so it
// never lands in the web bundle. Capacitor.getPlatform() returns 'android' | 'ios' | 'web'.
export async function isAndroid() {
    if (!MOBILE)
        return false;
    try {
        const { Capacitor }: any = await import('@capacitor/core');
        return Capacitor.getPlatform() === 'android';
    }
    catch (e: any) {
        return false;
    }
}
// 'android' or 'ios' inside the phone app, null anywhere else: for what both native shells do,
// each its own way (the rest alert: RestAlertPlugin.java and RestAlertPlugin.swift).
export async function nativePlatform() {
    if (!MOBILE)
        return null;
    try {
        const { Capacitor }: any = await import('@capacitor/core');
        const p: any = Capacitor.getPlatform();
        return p === 'android' || p === 'ios' ? p : null;
    }
    catch (e: any) {
        return null;
    }
}
const FILE: any = 'opengym-state.json';
// Written whole to a second file first and then moved over the first, so a write cut short (the
// app killed mid-write, the battery gone) never leaves a half file where the last good copy was.
// A move that did not finish leaves the new copy under FILE_NEW: whichever of the two parses and
// is the later one (`_ts`) is the copy.
const FILE_NEW: any = 'opengym-state.next.json';
export async function nativeLoad() {
    try {
        const { Filesystem, Directory, Encoding }: any = await import('@capacitor/filesystem');
        const read: any = async (path?: any) => {
            try {
                return JSON.parse((await Filesystem.readFile({ path, directory: Directory.Data, encoding: Encoding.UTF8 })).data);
            }
            catch {
                return null;
            }
        };
        const main: any = await read(FILE);
        const next: any = typeof Filesystem.rename === 'function' ? await read(FILE_NEW) : null;
        if (next && typeof next === 'object' && (!main || (Number(next._ts) || 0) > (Number(main._ts) || 0)))
            return next;
        return main;
    }
    catch (e: any) {
        return null;
    } // first launch, or unreadable — localStorage copy takes over
}
export async function nativeSave(state?: any) {
    try {
        const { Filesystem, Directory, Encoding }: any = await import('@capacitor/filesystem');
        const data: any = stateJson(state);
        if (typeof Filesystem.rename === 'function') {
            try {
                await Filesystem.writeFile({ path: FILE_NEW, directory: Directory.Data, data, encoding: Encoding.UTF8 });
                await Filesystem.rename({ from: FILE_NEW, to: FILE, directory: Directory.Data, toDirectory: Directory.Data });
                return;
            }
            catch { /* the plain write below */ }
        }
        await Filesystem.writeFile({ path: FILE, directory: Directory.Data, data, encoding: Encoding.UTF8 });
    }
    catch (e: any) { /* keep the localStorage copy */ }
}
// "Connect to my server" mode (lib/remote.ts): which of local-only / a paired remote account this
// device chose, kept in its own file — never inside opengym-state.json, since that file's content
// is exactly what pushState() PUTs to a server, and a device's own connection secret must never
// travel as if it were training data.
const REMOTE_FILE: any = 'opengym-remote.json';
// Small JSON files in the app's private data directory, for device facts that must not ride
// in S (which syncs and exports): the pairing, and how the Coach runs on this phone.
export async function readJsonFile(name?: any) {
    try {
        const { Filesystem, Directory, Encoding }: any = await import('@capacitor/filesystem');
        const r: any = await Filesystem.readFile({ path: name, directory: Directory.Data, encoding: Encoding.UTF8 });
        return JSON.parse(r.data);
    }
    catch (e: any) {
        return null;
    }
}
export async function writeJsonFile(name?: any, data?: any) {
    try {
        const { Filesystem, Directory, Encoding }: any = await import('@capacitor/filesystem');
        await Filesystem.writeFile({ path: name, directory: Directory.Data, data: JSON.stringify(data), encoding: Encoding.UTF8 });
    }
    catch (e: any) { /* not a Capacitor build, or the write failed — the caller's in-memory copy stands */ }
}
// Where the pairing lives. It holds the session token, so on iOS it stays out of iCloud and
// computer backups: Library/NoCloud (Directory.LibraryNoCloud) is excluded from them, where
// Documents (Directory.Data on iOS) is not. Android keeps it in the app's files and excludes it
// by name in backup_rules.xml / data_extraction_rules.xml. A restored iPhone is paired again,
// the same as an Android phone moved through a cloud backup.
async function remoteDir() {
    const { Directory }: any = await import('@capacitor/filesystem');
    return (await nativePlatform()) === 'ios' ? Directory.LibraryNoCloud : Directory.Data;
}
export async function loadRemoteFile() {
    try {
        const { Filesystem, Directory, Encoding }: any = await import('@capacitor/filesystem');
        const directory: any = await remoteDir();
        try {
            const r: any = await Filesystem.readFile({ path: REMOTE_FILE, directory, encoding: Encoding.UTF8 });
            return JSON.parse(r.data);
        }
        catch (e: any) {
            if (directory === Directory.Data)
                throw e;
        }
        // An iPhone paired before the move: its pairing is still in Documents. Moved once, then the
        // backed-up copy is gone.
        const r: any = await Filesystem.readFile({ path: REMOTE_FILE, directory: Directory.Data, encoding: Encoding.UTF8 });
        const data: any = JSON.parse(r.data);
        await Filesystem.writeFile({ path: REMOTE_FILE, directory, data: JSON.stringify(data), encoding: Encoding.UTF8, recursive: true });
        try {
            await Filesystem.deleteFile({ path: REMOTE_FILE, directory: Directory.Data });
        }
        catch { /* moved; the old copy is only stale */ }
        return data;
    }
    catch (e: any) {
        return null;
    } // never decided yet
}
export async function saveRemoteFile(data?: any) {
    try {
        const { Filesystem, Encoding }: any = await import('@capacitor/filesystem');
        const directory: any = await remoteDir();
        await Filesystem.writeFile({ path: REMOTE_FILE, directory, data: JSON.stringify(data), encoding: Encoding.UTF8, recursive: true });
        // The plugin marks Library/NoCloud as excluded from backup each time it looks the folder up,
        // which does nothing while the folder does not exist yet: the first write creates it, so
        // one more lookup marks it now rather than on the next launch.
        if (directory !== (await import('@capacitor/filesystem')).Directory.Data)
            await Filesystem.stat({ path: REMOTE_FILE, directory });
    }
    catch (e: any) { /* worst case: onboarding asks again next launch */ }
}
// Keep enough dates queued to cover normal app use between foregrounds without creating an
// unbounded notification list. The next sync cancels and replaces this whole window.
export const REMINDER_WINDOW_DAYS: any = 60;
const REMINDER_ID_BASE: any = 1000;
const LEGACY_REMINDER_IDS: any = Array.from({ length: 7 }, (_?: any, d?: any) => ({ id: 100 + d }));
// Pure date expansion for the native reminder. `now` is injectable so the calendar boundary,
// completed-day suppression, and today's past-time rule stay deterministic in tests.
export function buildReminderNotifications(S?: any, now: any = new Date()) {
    const r: any = S?.reminder;
    if (!r?.on)
        return [];
    const routines: any = Array.isArray(S.routines) ? S.routines : [];
    const completed: any = new Set((S.workouts || []).map((w?: any) => w.d));
    const state: any = { ...S, routines, week: S.week || {}, dayPlan: S.dayPlan || {} };
    const [hour, minute]: any = (r.time || '08:00').split(':').map(Number);
    if (!Number.isInteger(hour) || !Number.isInteger(minute))
        return [];
    const date: any = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 12);
    const notifications: any = [];
    for (let offset: any = 0; offset < REMINDER_WINDOW_DAYS; offset++) {
        const day: any = new Date(date);
        day.setDate(date.getDate() + offset);
        const iso: any = isoOf(day);
        // A day you noted as sick or away (lib/day-notes.ts) is off the hook, reminder included.
        if (completed.has(iso) || excusedOn(S, iso))
            continue;
        // A weekday can hold several routines; name them all, or fall back to a count. Each day is
        // asked as if it were today: a coach week's next session is due every day until it is done,
        // so it is reminded every day (the app re-syncs these after every workout and on open).
        const dayRoutines: any = effectiveRoutineIds(state, iso, iso).map((id?: any) => routines.find((x?: any) => x.id === id)).filter(Boolean);
        if (!dayRoutines.length)
            continue;
        const label: any = dayRoutines.length <= 2 ? dayRoutines.map((r?: any) => r.name).join(' + ') : tn('{0} routine', '{0} routines', dayRoutines.length);
        const at: any = new Date(day);
        at.setHours(hour, minute, 0, 0);
        if (at <= now)
            continue;
        notifications.push({
            id: REMINDER_ID_BASE + offset,
            title: t('Workout day'),
            body: t('{0} is on the plan today. Let’s go!', label),
            schedule: { at, allowWhileIdle: true },
        });
    }
    return notifications;
}
// The missed-workout nudge (lib/nudge.ts) as native notifications: one per future date that would
// be a missed day if nothing gets logged before its evening. nudgeFor() reads only workouts up to
// that date, so asking about tomorrow and the day after already applies the back-off of a break
// that goes on — at most 3 of these are ever queued past the last workout. Logging a workout
// resyncs (every persist does), which drops the day and resets the count.
export const NUDGE_WINDOW_DAYS: any = 7;
const NUDGE_ID_BASE: any = 2000;
export function buildNudgeNotifications(S?: any, now: any = new Date()) {
    const r: any = S?.reminder;
    if (!r?.on || !r.nudge)
        return [];
    const at: any = nudgeMinute(r.time || '08:00');
    if (at == null)
        return [];
    const routines: any = Array.isArray(S.routines) ? S.routines : [];
    const copy: any = NUDGE_COPY[toneOf(r)];
    const date: any = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 12);
    const notifications: any = [];
    for (let offset: any = 0; offset < NUDGE_WINDOW_DAYS; offset++) {
        const day: any = new Date(date);
        day.setDate(date.getDate() + offset);
        const iso: any = isoOf(day);
        // a session on screen right now is today's workout in the making, not a miss
        if (offset === 0 && S.active)
            continue;
        const ids: any = nudgeFor(S, iso);
        if (!ids)
            continue;
        const names: any = ids.map((id?: any) => routines.find((x?: any) => x.id === id)?.name).filter(Boolean);
        const label: any = names.length && names.length <= 2 ? names.join(' + ') : tn('{0} routine', '{0} routines', ids.length);
        const when: any = new Date(day);
        when.setHours(Math.floor(at / 60), at % 60, 0, 0);
        if (when <= now)
            continue;
        notifications.push({
            id: NUDGE_ID_BASE + offset,
            title: t(copy.title),
            body: t(copy.lines[lineIndex(iso, copy.lines.length)], label),
            schedule: { at: when, allowWhileIdle: true },
        });
    }
    return notifications;
}
// (Re)schedule the workout-day reminder: one one-off notification per future calendar date in
// the bounded window. Cheap enough to run after any state change — the plan or the reminder time
// may just have been edited. `interactive` gates the OS permission prompt to the Settings toggle;
// a background resync never pops a dialog.
export async function syncReminder(S?: any, interactive: any = false) {
    // The gym reminder (lib/gym-reminder.ts) decides on the phone whether to go off, from what it
    // was last told about today: told again here, after every save and on every return to the app.
    if (MOBILE)
        import('./gym-reminder.ts').then((m?: any) => m.pushGymStatus(S)).catch(() => { });
    try {
        const { LocalNotifications }: any = await import('@capacitor/local-notifications');
        await LocalNotifications.cancel({ notifications: [
                ...LEGACY_REMINDER_IDS,
                ...Array.from({ length: REMINDER_WINDOW_DAYS }, (_?: any, d?: any) => ({ id: REMINDER_ID_BASE + d })),
                ...Array.from({ length: NUDGE_WINDOW_DAYS }, (_?: any, d?: any) => ({ id: NUDGE_ID_BASE + d })),
            ] }).catch(() => { });
        const r: any = S.reminder;
        // The background check (lib/nudge-check.ts) follows what is scheduled: nothing, nothing to check.
        const check: any = (notifications?: any) => import('./nudge-check.ts').then((m?: any) => m.armNudgeCheck(S, notifications)).catch(() => { });
        if (!r?.on) {
            await check([]);
            return true;
        }
        let perm: any = await LocalNotifications.checkPermissions();
        if (perm.display !== 'granted' && interactive)
            perm = await LocalNotifications.requestPermissions();
        if (perm.display !== 'granted') {
            await check([]);
            return false;
        }
        const notifications: any = [...buildReminderNotifications(S), ...buildNudgeNotifications(S)];
        if (notifications.length)
            await LocalNotifications.schedule({ notifications });
        await check(notifications);
        return true;
    }
    catch (e: any) {
        return false;
    }
}
// Capacitor emits appStateChange when the native shell returns to the foreground. The visibility
// listener also covers WebView/browser transitions, and both are harmless on a non-mobile build.
let reminderSyncStarted: any = false;
export function initReminderSync(getState?: any) {
    if (!MOBILE || reminderSyncStarted)
        return;
    reminderSyncStarted = true;
    const resync: any = () => {
        if (document.visibilityState === 'hidden')
            return;
        syncReminder(getState()).catch(() => { });
    };
    document.addEventListener('visibilitychange', resync);
    // addListener is a promise of its own — it rejects when the App plugin is not behind the bridge
    // (a native project cap sync never updated, a custom platform) — so it is returned into the
    // catch below. Dropped inside a block, as it was before, that rejection went unhandled.
    import('@capacitor/app').then(({ App }: any) => App.addListener('appStateChange', ({ isActive }: any) => { if (isActive)
        resync(); })).catch(() => { });
}
// Runs cb whenever the native shell returns to the foreground — the store pulls the account's
// state then, so a phone that sat in a pocket all afternoon shows what the desktop did. No-op
// off mobile; the store's own visibility/focus listeners cover the browser.
export function onAppActive(cb?: any) {
    if (!MOBILE)
        return;
    // Returned, not dropped, for the same reason as in initReminderSync.
    import('@capacitor/app').then(({ App }: any) => App.addListener('appStateChange', ({ isActive }: any) => { if (isActive)
        cb(); })).catch(() => { });
}
// WKWebView can't do blob-URL downloads, so the backup goes out through the OS share sheet
// (Files, AirDrop, mail, …) from a temp file instead.
export async function shareExport(json?: any, filename?: any) {
    const { Filesystem, Directory, Encoding }: any = await import('@capacitor/filesystem');
    const { Share }: any = await import('@capacitor/share');
    const w: any = await Filesystem.writeFile({ path: filename, directory: Directory.Cache, data: json, encoding: Encoding.UTF8 });
    await Share.share({ title: filename, url: w.uri });
}
// The same for a binary export — the backup with photos and videos (lib/backup-media.ts). The
// file crosses the native bridge as base64 in 3 MB pieces, never as one string the size of the
// whole zip, which could be a few hundred MB.
export async function shareExportBlob(blob?: any, filename?: any) {
    const { Filesystem, Directory }: any = await import('@capacitor/filesystem');
    const { Share }: any = await import('@capacitor/share');
    const { toBase64 }: any = await import('./media-store-fs.ts');
    const CHUNK: any = 3 * 1024 * 1024;
    for (let o: any = 0; o < blob.size || o === 0; o += CHUNK) {
        const data: any = toBase64(new Uint8Array(await blob.slice(o, o + CHUNK).arrayBuffer()));
        if (o === 0)
            await Filesystem.writeFile({ path: filename, directory: Directory.Cache, data });
        else
            await Filesystem.appendFile({ path: filename, directory: Directory.Cache, data });
        if (!blob.size)
            break;
    }
    const { uri }: any = await Filesystem.getUri({ path: filename, directory: Directory.Cache });
    await Share.share({ title: filename, url: uri });
}
// Hand a self-contained HTML document (lib/plan-share.ts planPrintHTML) to the OS print flow.
// Android routes it through the system PrintManager — "Save as PDF", "Save to Drive", a real
// printer; iOS through the print sheet — "Save to Files" (as PDF), share, print. Either way the
// platform renders the PDF, so no PDF library rides in the bundle. The local `Print` plugin is
// registered natively (android MainActivity, ios PrintPlugin.m); on the web build this file's
// callers gate on MOBILE and never reach here.
// `paper` ('a4' | 'letter') is the size the sheet starts on (lib/print-doc.ts paperFor); Android
// uses it, iOS takes the printer's or the region's own default. `footer` is the bottom line the
// iOS plugin draws itself, since WebKit has no @page margin boxes: { left, page } with {0}/{1}
// in `page` for the page number and the page count.
export async function printHtml(html?: any, name?: any, { paper = 'a4', footer }: any = {}) {
    const { registerPlugin }: any = await import('@capacitor/core');
    const Print: any = registerPlugin('Print');
    await Print.printHtml({ html, name, paper, ...(footer ? { footer } : {}) });
}
// "Auto-backup on changes" (Settings): a dated snapshot dropped into Documents/openGym/ —
// visible in Files (iOS) / a file manager (Android), unlike the private mirror nativeSave keeps
// — so whatever the user points at that folder (a sync app, a manual copy) always has something
// recent. One file per day; later triggers the same day just overwrite it.
//
// The folder is ours alone (#161): until v1.3.9 the files landed in the Documents root, so a
// sync app pointed at them had to carry the whole Documents folder along, and a year of daily
// copies piled up there. Now each write keeps only the newest AUTO_BACKUP_KEEP in the folder.
// The root is never pruned: a manual export saved there carries the same name, and nothing
// tells it apart from an old automatic copy, so those stay for the person to clear (Import
// backup still reads either kind).
export const AUTO_BACKUP_DIR: any = 'openGym';
export const AUTO_BACKUP_KEEP: any = 14;
// Only the exact names writeAutoBackup gives its files are ever pruned; anything else someone
// keeps in the folder is theirs.
const AUTO_BACKUP_NAME: any = /^opengym-backup-\d{4}-\d{2}-\d{2}(-[2-9])?\.json$/;
// Android's scoped storage lets an install write over, list and delete only the files it wrote
// itself. After a reinstall, or with the test build beside the real one, today's name can belong
// to the other install: writing it fails with EACCES, and that day went without a copy, silently.
// The copy then goes under the day's next name (-2 up to -9), which this install owns after its first write.
// The other install's files stay where they are; this one cannot see them to prune them.
export async function writeAutoBackup(state?: any) {
    const day: any = todayISO();
    // A folder the person chose (Android, #161) comes first. When it can no longer be written —
    // the permission revoked, the folder deleted, the sync app gone — the copy goes to the default
    // folder after all, and Settings says so: a backup that silently stops is the one thing this
    // feature must not do.
    if (await writeToChosenFolder(state, day))
        return;
    let fs: any;
    try {
        fs = await import('@capacitor/filesystem');
    }
    catch (e: any) {
        return;
    }
    const write: any = (name?: any) => fs.Filesystem.writeFile({
        path: `${AUTO_BACKUP_DIR}/${name}`,
        directory: fs.Directory.Documents,
        data: JSON.stringify(state),
        encoding: fs.Encoding.UTF8,
        recursive: true,
    });
    // The day's names in turn: a second earlier install (or a third) can own the first two, and that
    // day then went without a copy, silently, while the newest file there was another install's.
    let name: any = null;
    for (const suffix of ['', '-2', '-3', '-4', '-5', '-6', '-7', '-8', '-9']) {
        const n: any = `opengym-backup-${day}${suffix}.json`;
        try {
            await write(n);
            name = n;
            break;
        }
        catch (e: any) { /* owned by another install, or the disk said no: the next name */ }
    }
    if (!name)
        return; // best effort — the private mirror in Directory.Data still has the data
    // Pruning waits for a successful write: a full disk must never cost the copies already there.
    await pruneAutoBackups(fs, name);
}
async function pruneAutoBackups({ Filesystem, Directory }: any, written?: any) {
    let files: any;
    try {
        files = (await Filesystem.readdir({ path: AUTO_BACKUP_DIR, directory: Directory.Documents })).files || [];
    }
    catch (e: any) {
        return;
    }
    const older: any = files
        // Capacitor before 4 listed bare names; since then an object that also says what it is.
        .filter((f?: any) => typeof f === 'string' || f?.type !== 'directory')
        .map((f?: any) => (typeof f === 'string' ? f : f?.name))
        // The copy just written is never a candidate, even if a clock set back makes it sort
        // below the others: it is one of the AUTO_BACKUP_KEEP whatever its date says.
        .filter((n?: any) => AUTO_BACKUP_NAME.test(n || '') && n !== written)
        // Newest first by the date in the name, which a sync app or a copy cannot disturb the way
        // it can a modification time.
        .sort().reverse();
    for (const n of older.slice(AUTO_BACKUP_KEEP - 1)) {
        try {
            await Filesystem.deleteFile({ path: `${AUTO_BACKUP_DIR}/${n}`, directory: Directory.Documents });
        }
        catch (e: any) { /* one stuck file does not stop the rest */ }
    }
}
/* ------------------------------------------------- the backup folder (#161) --
   Android only: the system folder picker (Storage Access Framework) through the local
   BackupFolder plugin (android/.../BackupFolderPlugin.java), since @capacitor/filesystem cannot
   write into a picked folder. The choice is a fact of this phone, kept in its own private file
   and never in S: S syncs and exports, and a content:// address means nothing anywhere else.

   { uri, label }       the chosen folder, and its name as the picker showed it
   { lost, lostLabel }  the folder stopped accepting copies; they go to Documents/openGym again
   {}                   the default, Documents/openGym */
export const BACKUP_FOLDER_FILE: any = 'opengym-backup-folder.json';
// The plugin proxy lives here and is never handed through a promise: a Capacitor plugin proxy
// answers every property, `then` included, so a promise resolving to it never settles (#42/#58).
let folderPlugin: any = null;
async function loadFolderPlugin() {
    if (folderPlugin)
        return;
    const { registerPlugin }: any = await import('@capacitor/core');
    folderPlugin = registerPlugin('BackupFolder');
}
let folderState: any = null; // the file's content once read; {} for the default
const folderListeners: any = new Set();
const setFolderState: any = async (next?: any) => {
    folderState = next;
    await writeJsonFile(BACKUP_FOLDER_FILE, next);
    folderListeners.forEach((fn?: any) => { try {
        fn(next);
    }
    catch (e: any) { /* a listener's problem */ } });
};
/** Where auto-backup writes on this phone: { uri, label } | { lost, lostLabel } | {}. */
export async function backupFolder() {
    if (!folderState) {
        const saved: any = await readJsonFile(BACKUP_FOLDER_FILE);
        folderState = saved && typeof saved === 'object' ? saved : {};
    }
    return folderState;
}
/** Settings listens, so a fallback in the middle of a backup shows without a reload. */
export function onBackupFolderChange(fn?: any) {
    folderListeners.add(fn);
    return () => folderListeners.delete(fn);
}
/** Opens the system folder picker. Resolves to the new state, or null when cancelled. */
export async function chooseBackupFolder() {
    await loadFolderPlugin();
    const picked: any = await folderPlugin.pick();
    if (!picked?.uri)
        return null;
    const before: any = await backupFolder();
    if (before.uri && before.uri !== picked.uri)
        await releaseFolder(before.uri);
    const next: any = { uri: picked.uri, label: picked.label || null };
    await setFolderState(next);
    return next;
}
/** Back to Documents/openGym; also how the warning about a lost folder is put away. */
export async function resetBackupFolder() {
    const before: any = await backupFolder();
    if (before.uri)
        await releaseFolder(before.uri);
    await setFolderState({});
    return folderState;
}
async function releaseFolder(uri?: any) {
    try {
        await loadFolderPlugin();
        await folderPlugin.release({ uri });
    }
    catch (e: any) { /* already gone */ }
}
// True when today's copy is in the chosen folder. False with no folder chosen, and after a
// failure, which is recorded so Settings can say the copies went to the default folder.
async function writeToChosenFolder(state?: any, day?: any) {
    const folder: any = await backupFolder();
    if (!folder.uri)
        return false;
    const name: any = `opengym-backup-${day}.json`;
    try {
        await loadFolderPlugin();
        const { ok }: any = await folderPlugin.check({ uri: folder.uri });
        if (!ok)
            throw new Error('permission lost');
        await folderPlugin.write({ uri: folder.uri, name, data: JSON.stringify(state) });
    }
    catch (e: any) {
        await setFolderState({ lost: true, lostLabel: folder.label || null });
        await releaseFolder(folder.uri);
        return false;
    }
    // Pruning waits for a successful write, and only ever touches the app's own dated names.
    try {
        await folderPlugin.prune({ uri: folder.uri, keep: AUTO_BACKUP_KEEP, pattern: AUTO_BACKUP_NAME.source, written: name });
    }
    catch (e: any) { /* housekeeping */ }
    return true;
}
// Tests only: forget the cached choice, as a fresh start of the app would.
export function _resetBackupFolder() { folderState = null; folderPlugin = null; folderListeners.clear(); }
