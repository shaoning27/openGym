// Legacy dynamic types are explicit during the full language migration.
// Health Connect on the Android app (#200): turning it on, and keeping it in step with the log.
// What gets written is worked out in lib/health-connect.ts; this file owns the native plugin
// (HealthConnectPlugin.java) and the phone's own record of what it wrote.
//
// It is a fact about this phone, not about the training log: kept in its own file in the app's
// data directory, never in S, so it does not sync to a server, ride in a backup, or switch on a
// second phone. Off until the user turns it on; nothing is asked of Health Connect before that.
//
// The iPhone app does the same with Apple Health (AppleHealthPlugin.swift): the same calls, the
// same records, the same file. There it also asks to read the heart rate and the body weight, for
// the Apple Watch app (its workout session shows the heart rate per set), and tells the watch
// whether it is on (setEnabled: the App Group's "healthEnabled", which the watch link passes on).
//
// Since v1.4.3 it can also read two things back (#544, #127), each behind a switch of its own and
// off by default: the heart rate during a finished workout (for any watch that saves to the hub,
// not just the Apple Watch), and weigh-ins other apps saved there. Only while the app is open, only
// the workouts of the last day and the weigh-ins since the last read (30 days the first time), so
// no background or history permission is asked for. What it decides is in lib/health-read.js.
//
// The web build never gets here (MOBILE is a build-time flag).
import { mergeHeartRate, mergeWeighIns, lacksHeartRate } from './health-read.ts';
import { MOBILE, nativePlatform, readJsonFile, writeJsonFile } from './mobile.ts';
import { healthRecords, planSync, writtenIds, goneIds } from './health-connect.ts';
import { exerciseNameFor } from './i18n-core.ts';
import { EXIDX } from './exercises.ts';
import { speedUnitOf } from './speed.ts';
export const HEALTH_FILE: any = 'opengym-health.json';
const OFF: any = { on: false, written: {}, at: 0, error: null, readHr: false, readWeight: false, wHistory: false, wCursor: 0, seen: {}, hrTried: {}, readError: null };
// Wrapped in an object, as in rest-alert.ts: a Capacitor plugin proxy answers `then`, so a
// promise resolved with the bare proxy never settles.
let pluginP: any = null;
const plugin: any = () => pluginP || (pluginP = (async () => {
    const platform: any = await nativePlatform();
    if (!platform)
        return null;
    const { registerPlugin }: any = await import('@capacitor/core');
    return { HC: registerPlugin(platform === 'ios' ? 'AppleHealth' : 'HealthConnect'), platform };
})().catch(() => null));
// iPhone: the switch as the watch reads it. Android has no watch to tell.
async function mirrorOn(on?: any) {
    const p: any = await plugin().catch(() => null);
    if (p?.platform === 'ios')
        await p.HC.setEnabled({ on: !!on }).catch(() => { });
}
// The file's content, read once and then kept here: a save while it is off (the usual case) must
// not cost a file read, and every change to it goes through saveHealth anyway.
let cached: any = null;
export async function loadHealth() {
    if (cached)
        return cached;
    const f: any = await readJsonFile(HEALTH_FILE);
    const map: any = (v?: any) => (v && typeof v === 'object' && !Array.isArray(v) ? v : {});
    cached = f && typeof f === 'object' ? { ...OFF, ...f, written: map(f.written), seen: map(f.seen), hrTried: map(f.hrTried) } : { ...OFF };
    return cached;
}
const saveHealth: any = (h?: any) => { cached = h; return writeJsonFile(HEALTH_FILE, h); };
/** { status: 'available' | 'update' | 'missing' | 'unsupported', granted, platform } */
export async function healthStatus() {
    if (!MOBILE)
        return { status: 'unsupported', granted: false, platform: null };
    try {
        const p: any = await plugin();
        if (!p)
            return { status: 'unsupported', granted: false, platform: null };
        return { ...(await p.HC.status()), platform: p.platform };
    }
    catch {
        return { status: 'unsupported', granted: false, platform: null };
    }
}
/** Health Connect's own screen for what apps wrote, or its store page where it is missing. */
export async function openHealthConnect() {
    const p: any = await plugin();
    if (p)
        await p.HC.openSettings();
}
const nameOf: any = (e?: any) => (EXIDX[e.id] ? exerciseNameFor(EXIDX[e.id]) : (e.n || e.id));
// One sync at a time. A change that comes in while one runs is not lost: the running one is
// followed by a single further pass with the newest state.
let running: any = null;
let again: any = null;
const listeners: any = new Set();
/** Called with the file's new content after every sync, for the Settings row. */
export function onHealthChange(cb?: any) { listeners.add(cb); return () => listeners.delete(cb); }
const told: any = (h?: any) => { listeners.forEach((cb?: any) => { try {
    cb(h);
}
catch { /* a closed screen */ } }); };
/**
 * Writes what changed since the last sync and removes what was deleted from openGym. A no-op
 * while it is off. Resolves with the file's content afterwards; `error` is 'permission' when
 * Health Connect refused (the user took the permission back), 'unavailable' when it is gone.
 */
export function syncHealth(S?: any) {
    if (!MOBILE)
        return Promise.resolve(null);
    // Not read yet: initHealthSync reads it at launch and syncs then, which covers a save made
    // before that; the save path itself never waits on the file.
    if (!cached || !cached.on)
        return Promise.resolve(cached);
    if (running) {
        again = S;
        return running;
    }
    again = null;
    running = (async () => {
        let h: any = await loadHealth();
        let next: any = S;
        while (next) {
            if (h.on)
                h = await syncOnce(next, h);
            // A state that came in meanwhile, taken only now: cleared before a pass, it would lose a
            // change made while the pass was starting.
            next = again;
            again = null;
        }
        return h;
    })().finally(() => { running = null; });
    return running;
}
async function syncOnce(S?: any, h?: any) {
    const p: any = await plugin();
    if (!p)
        return h;
    const plan: any = planSync(healthRecords(S, { nameOf, speedUnit: speedUnitOf(S) }), h.written, goneIds(S));
    const nothing: any = !plan.sessions.length && !plan.weights.length && !plan.remove.sessions.length && !plan.remove.weights.length;
    if (nothing) {
        if (!h.error)
            return h;
        // Nothing to write, but the last attempt failed: clear it once Health Connect says yes again.
        const st: any = await p.HC.status().catch(() => null);
        if (!(st?.status === 'available' && st.granted))
            return h;
        const out: any = { ...h, error: null };
        await saveHealth(out);
        told(out);
        return out;
    }
    let out: any = { ...h };
    try {
        if (plan.sessions.length || plan.weights.length) {
            await p.HC.write({ sessions: plan.sessions, weights: plan.weights });
            // Written but not yet removed: kept as written, so a failed remove is tried again.
            const kept: any = Object.fromEntries(Object.entries(h.written).filter(([id]: any) => !plan.written[id]));
            out.written = { ...kept, ...plan.written };
        }
        let written: any = plan.written;
        if (plan.remove.sessions.length || plan.remove.weights.length) {
            // Apple Health answers what it could not take out (`left`: one the watch saved that the
            // phone may not delete): kept as written, so the next sync tries again.
            const res: any = await p.HC.remove(plan.remove);
            const left: any = Array.isArray(res?.left) ? res.left : [];
            if (left.length)
                written = { ...written, ...Object.fromEntries(left.filter((id?: any) => h.written[id]).map((id?: any) => [id, h.written[id]])) };
        }
        out = { ...out, written, at: Date.now(), error: null };
    }
    catch (e: any) {
        out.error = e?.code === 'permission' ? 'permission' : e?.code === 'unavailable' ? 'unavailable' : 'failed';
    }
    await saveHealth(out);
    told(out);
    return out;
}
/**
 * Turning it on: asks for the two write permissions, then writes the whole log once. Resolves
 * with { ok, reason } — reason 'denied' when the user did not grant both, or the status when
 * Health Connect is not there to ask.
 */
export async function enableHealth(S?: any) {
    const p: any = await plugin();
    if (!p)
        return { ok: false, reason: 'unsupported' };
    const st: any = await p.HC.status().catch(() => ({ status: 'unsupported' }));
    if (st.status !== 'available')
        return { ok: false, reason: st.status };
    const granted: any = st.granted || (await p.HC.requestPermissions().catch(() => ({ granted: false }))).granted;
    if (!granted)
        return { ok: false, reason: 'denied' };
    const h: any = await loadHealth();
    await saveHealth({ ...h, on: true, error: null });
    await mirrorOn(true);
    const after: any = await syncHealth(S);
    return { ok: !after?.error, reason: after?.error || null, health: after };
}
/**
 * Turning it off stops the writing. With `removeWritten`, what openGym wrote is taken out of
 * Health Connect too; without it, it stays there as the user's own data. Rejects when the
 * removal fails, and then stays on, so nothing is left behind that the phone forgot it wrote.
 */
export async function disableHealth({ removeWritten = false }: any = {}) {
    if (running)
        await running.catch(() => { });
    const h: any = await loadHealth();
    if (removeWritten) {
        const ids: any = writtenIds(h.written);
        if (ids.sessions.length || ids.weights.length) {
            const p: any = await plugin();
            if (!p)
                throw new Error('unavailable');
            await p.HC.remove(ids);
        }
    }
    const out: any = { ...h, on: false, error: null, written: removeWritten ? {} : h.written };
    await saveHealth(out);
    await mirrorOn(false);
    told(out);
    return out;
}
// Back in the foreground: a change synced from another device while the phone was away, or a
// permission the user granted again in Health Connect's own settings, is picked up then.
let started: any = false;
export function initHealthSync(getState?: any, apply: any = null) {
    if (!MOBILE || started)
        return;
    started = true;
    applyRef = apply;
    import('@capacitor/app').then(({ App }: any) => {
        App.addListener('appStateChange', ({ isActive }: any) => {
            if (!isActive)
                return;
            syncHealth(getState()).catch(() => { });
            readHealth(getState, { force: true }).catch(() => { });
        });
    }).catch(() => { });
    // Once at launch, for a workout finished just before the app was closed. Reading the file here
    // also settles whether it is on, which the saves wait for (syncHealth).
    setTimeout(() => loadHealth().then((h?: any) => {
        mirrorOn(h.on);
        readHealth(getState, { force: true }).catch(() => { });
        return syncHealth(getState());
    }).catch(() => { }), 3000);
}
/* ------------------------------------------------------------------ reading back (v1.4.3) -- */
// How long after a workout its heart rate is still looked for: Garmin and Fitbit hand theirs to
// the hub when the watch next syncs, which can be hours later.
export const HR_WINDOW_MS: any = 24 * 3600e3;
// Between two reads of the same thing, at most this often while the app is in use, and this often
// when it comes back to the foreground.
const READ_EVERY_MS: any = 10 * 60e3;
const RESUME_EVERY_MS: any = 2 * 60e3;
// The first read of weigh-ins goes this far back (what Health Connect gives without the history
// permission); later ones from the newest seen, minus a margin for a scale that syncs late.
export const WEIGHT_FIRST_MS: any = 30 * 24 * 3600e3;
// With Health Connect's history permission (Android, idea from #801) the first read goes back a
// year instead, so a scale's weigh-ins from before openGym arrive too. Asked for with the weight;
// refused, the read simply stays at 30 days.
export const WEIGHT_HISTORY_MS: any = 365 * 24 * 3600e3;
const WEIGHT_MARGIN_MS: any = 2 * 24 * 3600e3;
const SEEN_KEEP_MS: any = 60 * 24 * 3600e3;
const srcOf: any = (platform?: any) => (platform === 'ios' ? 'ah' : 'hc');
// The store's update, given at launch (initHealthSync): a read result goes into the log the way any
// other change does, so it is saved, stamped and synced.
let applyRef: any = null;
let readRunning: any = null;
let lastWeightRead: any = 0;
/**
 * Turns one of the two reads on (`kind`: 'hr' | 'weight'): asks for that read permission only,
 * then reads once. Resolves with { ok, reason }; reason 'denied' when it was not granted.
 */
export async function enableRead(kind?: any, getState?: any, { apply = null }: any = {}) {
    const p: any = await plugin();
    if (!p)
        return { ok: false, reason: 'unsupported' };
    const st: any = await p.HC.status().catch(() => ({ status: 'unsupported' }));
    if (st.status !== 'available')
        return { ok: false, reason: st.status };
    const perm: any = kind === 'hr' ? 'heartRate' : 'weight';
    // The history permission only where Health Connect has it (status says so); Apple Health has none.
    const history: any = kind === 'weight' && p.platform !== 'ios' && st.history === true;
    const res: any = await p.HC.requestPermissions({ read: history ? [perm, 'history'] : [perm], write: [] }).catch(() => null);
    // Apple Health never says whether reading was allowed (that it was refused is itself private):
    // `read` is then missing, and a refusal just reads nothing.
    const ok: any = res && (res.read ? res.read[perm] !== false : true);
    if (!ok)
        return { ok: false, reason: 'denied' };
    const h: any = await loadHealth();
    const out: any = { ...h, [kind === 'hr' ? 'readHr' : 'readWeight']: true, readError: null };
    if (kind === 'weight')
        out.wHistory = history && res.read?.history === true;
    await saveHealth(out);
    told(out);
    if (getState)
        await readHealth(getState, { force: true, apply }).catch(() => { });
    return { ok: true, reason: null, health: cached };
}
/** Turns a read off. What it already brought in stays in the log, as the user's data. */
export async function disableRead(kind?: any) {
    if (readRunning)
        await readRunning.catch(() => { });
    const h: any = await loadHealth();
    const out: any = kind === 'hr' ? { ...h, readHr: false, hrTried: {} } : { ...h, readWeight: false };
    if (!out.readHr && !out.readWeight)
        out.readError = null;
    await saveHealth(out);
    told(out);
    return out;
}
/**
 * One read pass: the heart rate of every workout finished in the last day that still lacks some,
 * and the weigh-ins since the last read. A no-op while both switches are off; never runs twice at
 * once; reads the same thing at most every ten minutes (two after coming back to the foreground,
 * `force`). The log changes only when something new came in.
 */
export function readHealth(getState?: any, { force = false, now = Date.now(), apply = null }: any = {}) {
    if (!MOBILE || !cached || !(cached.readHr || cached.readWeight))
        return Promise.resolve(cached);
    if (readRunning)
        return readRunning;
    readRunning = readOnce(getState, force, now, apply || applyRef).finally(() => { readRunning = null; });
    return readRunning;
}
async function readOnce(getState?: any, force?: any, now?: any, applyFn?: any) {
    const p: any = await plugin();
    if (!p)
        return cached;
    const src: any = srcOf(p.platform);
    const every: any = force ? RESUME_EVERY_MS : READ_EVERY_MS;
    let h: any = { ...(await loadHealth()) };
    let error: any = null;
    // `decide` runs on a copy first: an update that changes nothing would still stamp and push.
    const apply: any = (decide?: any, fn: any = decide) => {
        const probe: any = JSON.parse(JSON.stringify(getState() || {}));
        if (!decide(probe))
            return false;
        if (applyFn)
            applyFn((s?: any) => { fn(s); });
        return true;
    };
    const fail: any = (e?: any) => { error = e?.code === 'permission' ? 'permission' : e?.code === 'unavailable' ? 'unavailable' : 'failed'; };
    if (h.readHr) {
        const S: any = getState();
        const tried: any = {};
        for (const [wid, at] of Object.entries(h.hrTried || {}))
            if (now - Number(at) < HR_WINDOW_MS * 2)
                tried[wid] = at;
        for (const w of S?.workouts || []) {
            const end: any = Number(w?.end), start: any = Number(w?.start);
            if (!w?.id || !(start > 0) || !(end > start) || now - end > HR_WINDOW_MS || end > now)
                continue;
            if (!lacksHeartRate(w) && w.hr?.src !== src)
                continue;
            if (tried[w.id] && now - Number(tried[w.id]) < every)
                continue;
            try {
                const res: any = await p.HC.readHeartRate({ from: start, to: end + 5 * 60e3 });
                tried[w.id] = now;
                const samples: any = Array.isArray(res?.samples) ? res.samples : [];
                if (samples.length)
                    apply((s?: any) => mergeHeartRate(s, w.id, samples, src, now));
            }
            catch (e: any) {
                fail(e);
                break;
            }
        }
        h.hrTried = tried;
    }
    if (h.readWeight && (force ? now - lastWeightRead >= RESUME_EVERY_MS : now - lastWeightRead >= READ_EVERY_MS)) {
        const sinceFor: any = (back?: any) => (h.wCursor > 0 ? Math.max(h.wCursor - WEIGHT_MARGIN_MS, now - back) : now - back);
        try {
            let res: any;
            try {
                res = await p.HC.readWeights({ since: sinceFor(h.wHistory ? WEIGHT_HISTORY_MS : WEIGHT_FIRST_MS) });
            }
            catch (e: any) {
                // The history permission taken back in Health Connect's settings: the 30 days still read.
                if (!(h.wHistory && e?.code === 'permission'))
                    throw e;
                h.wHistory = false;
                res = await p.HC.readWeights({ since: sinceFor(WEIGHT_FIRST_MS) });
            }
            lastWeightRead = now;
            const records: any = Array.isArray(res?.records) ? res.records : [];
            // The memo is filled in on the copy that decides; the store's update replays the same merge.
            const seen: any = { ...(h.seen || {}) };
            const before: any = { ...seen };
            if (records.length)
                apply((probe?: any) => mergeWeighIns(probe, records, { src, seen }).length > 0, (s?: any) => { mergeWeighIns(s, records, { src, seen: { ...before } }); });
            for (const [d, v] of Object.entries(seen))
                if (now - Number((v as any)?.t) > SEEN_KEEP_MS)
                    delete seen[d];
            h.seen = seen;
            const newest: any = records.reduce((m?: any, r?: any) => Math.max(m, Number(r?.t) || 0), 0);
            if (newest > h.wCursor)
                h.wCursor = newest;
        }
        catch (e: any) {
            fail(e);
        }
    }
    h.readError = error;
    await saveHealth(h);
    told(h);
    return h;
}
