// Legacy dynamic types are explicit during the full language migration.
// Progress photos filed under a day rather than a workout (#557): a photo for a day you did not
// train, or one taken on an earlier day and added later. A photo for a day that has a logged
// workout goes onto that workout as before (lib/workout-media.ts); this is the place for the
// rest.
//
//   S.dayPhotos = { '<hash>': { d: '2026-10-08', m: <MediaRef>, _ts }, … }
//
// One entry per photo, keyed by its file, with the time it was last written, the way day notes
// are kept per day (lib/day-notes.ts): two devices that each added a photo keep both, and the
// same photo keeps its later version (lib/sync-merge.ts mergeStampedMap, STAMPED_MAPS). Taking one
// away writes a stamped empty entry (`{ _ts }`), never a deleted key: a deleted key would come
// straight back from the other device's copy on the next sync. The field is optional: a profile
// that never filed a photo under a day has none, and nothing else in it changes.
//
// The files are kept like every other photo: media-refs.ts stateMediaRefs and api/media.ts
// referencedHashes walk dayPhotos too, so the sync uploads them, the backups carry them and the
// clean-ups leave them be. A server from before that would sweep them, so the app files a photo
// under a day only where the server says it keeps them (GET /api/config media.days), or where
// there is no server at all.
import { normalizeMediaRef, workoutMediaOf, WORKOUT_MEDIA_MAX } from './media-refs.ts';
import { addWorkoutMedia } from './workout-media.ts';
const isMap: any = (v?: any) => !!v && typeof v === 'object' && !Array.isArray(v);
const ISO: any = /^\d{4}-\d{2}-\d{2}$/;
/** One stored entry read back: { d, m } or null for a cleared or malformed one. */
export function readDayPhoto(entry?: any) {
    if (!isMap(entry) || !ISO.test(String(entry.d || '')))
        return null;
    const m: any = normalizeMediaRef(entry.m);
    return m ? { d: entry.d, m } : null;
}
/** Every photo filed under a day, as { hash, d, m }. */
export function dayPhotosOf(S?: any) {
    const map: any = isMap(S?.dayPhotos) ? S.dayPhotos : {};
    const out: any = [];
    for (const [hash, e] of Object.entries(map)) {
        const p: any = readDayPhoto(e);
        if (p && p.m.hash === hash)
            out.push({ hash, ...p });
    }
    return out;
}
/** Whether a server keeps photos filed under a day: none at all (local), or one that says so. */
export const serverTakesDayPhotos: any = (user?: any, config?: any) => !user || (!!config && !!config.media && config.media.days === true);
/**
 * Files `ref` under day `d`. 'added', or why not: 'invalid' (no valid date or MediaRef), 'dup'
 * (that file is filed already). Mutates `state`, made for useStore's update().
 */
export function addDayPhoto(state?: any, d?: any, ref?: any, now: any = Date.now()) {
    if (!ISO.test(String(d || '')))
        return 'invalid';
    const m: any = normalizeMediaRef(ref);
    if (!m)
        return 'invalid';
    const map: any = isMap(state.dayPhotos) ? state.dayPhotos : {};
    if (readDayPhoto(map[m.hash]))
        return 'dup';
    state.dayPhotos = { ...map, [m.hash]: { d, m, _ts: now } };
    return 'added';
}
/** Takes the photo `hash` away (a stamped empty entry). Returns whether it was there. */
export function removeDayPhoto(state?: any, hash?: any, now: any = Date.now()) {
    const map: any = isMap(state.dayPhotos) ? state.dayPhotos : {};
    if (!readDayPhoto(map[hash]))
        return false;
    state.dayPhotos = { ...map, [hash]: { _ts: now } };
    return true;
}
/** The Undo of a removal: the entry as it was, stamped now. Returns whether it changed anything. */
export function restoreDayPhoto(state?: any, hash?: any, entry?: any, now: any = Date.now()) {
    const p: any = readDayPhoto(entry);
    if (!p || p.m.hash !== hash)
        return false;
    const map: any = isMap(state.dayPhotos) ? state.dayPhotos : {};
    if (readDayPhoto(map[hash]))
        return false;
    state.dayPhotos = { ...map, [hash]: { d: p.d, m: p.m, _ts: now } };
    return true;
}
/** The latest workout logged on day `d`, or null. */
export function workoutOn(S?: any, d?: any) {
    const day: any = (Array.isArray(S?.workouts) ? S.workouts : []).filter((w?: any) => w && w.d === d);
    return day.length ? day.reduce((a?: any, b?: any) => ((b.start || 0) > (a.start || 0) ? b : a)) : null;
}
/**
 * Where a new progress photo for day `d` goes, and puts it there: onto that day's latest workout
 * while it has room ('workout'), else under the day ('day') when `canDay` (the server keeps those,
 * or there is none). 'no-room' when neither, 'dup' for a file already there, 'invalid' for a bad
 * date or ref. Mutates `state`.
 */
export function fileProgressPhoto(state?: any, d?: any, ref?: any, { canDay = true, now = Date.now() }: any = {}) {
    const w: any = workoutOn(state, d);
    if (w && workoutMediaOf(w).length < WORKOUT_MEDIA_MAX) {
        const r: any = addWorkoutMedia(state, w, ref, now);
        if (r === 'added')
            return 'workout';
        if (r === 'dup' || r === 'invalid')
            return r;
    }
    if (!canDay)
        return 'no-room';
    const r: any = addDayPhoto(state, d, ref, now);
    return r === 'added' ? 'day' : r;
}
