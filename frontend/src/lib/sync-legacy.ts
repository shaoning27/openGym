// Legacy dynamic types are explicit during the full language migration.
/* The first sync after an update from v1.3.9, when that app still owed the server a change.
 *
 * v1.3.9 stamped its workouts, routines, custom exercises and weigh-ins, but not its settings,
 * plan days, notes or removals. When another device synced meanwhile, the merge kept the other
 * device's stamped settings and undid what the old app changed offline: its rest time, its plan
 * day, its note went back. Nothing says which side changed a setting, except one thing the old
 * app left behind: the fingerprint of the copy it last agreed on with the server
 * (lib/sync-changes.ts, `gym_synced_fp`), with one hash (`s`) over everything but the lists.
 *
 * Each setting the two copies hold differently was changed on one side or the other since that
 * copy (or on both). Trying every way round and hashing it the way v1.3.9 did finds the copy they
 * both started from, when exactly one way round matches: what differs from it on this device is
 * this device's change, stamped here so the merge keeps it (stampEdits). When no way round
 * matches (both sides changed the same setting, or there is no fingerprint) nothing is stamped
 * and the caller keeps the device's copy aside instead, so nothing the old app held is lost.
 *
 * Removals are left alone on purpose: v1.3.9 kept no record of them, so a workout it deleted
 * offline comes back after the merge. One tap removes it again; a wanted entry dropped by a wrong
 * guess would be gone.
 */
import { stampEdits } from './sync-merge.ts';
// v1.3.9's fingerprint left these out of `s` (lib/sync-changes.ts at v1.3.9).
const NOT_CONTENT_139: any = new Set(['_ts', '_rev', 'active', 'workouts', 'bodyweight', 'routines', 'customEx']);
// Records v1.3.9 never changes: whatever this device holds is what the copy it agreed on held.
const KEEP_LOCAL: any = new Set(['deleted', 'edited', '_wid', '_wids']);
// Past this many settings that differ, the search is not worth it (2^n ways round).
const MAX_KEYS: any = 12;
const FNV0: any = 0x811c9dc5;
const fnv: any = (h?: any, s?: any) => {
    for (let i: any = 0; i < s.length; i++) {
        h ^= s.charCodeAt(i);
        h = Math.imul(h, 0x01000193) >>> 0;
    }
    return h;
};
/** v1.3.9's `s` hash of a copy: the rest of it, keys sorted, FNV-1a over the JSON. */
export function restHash139(S?: any) {
    const rest: any = {};
    for (const f of Object.keys(S || {}).sort())
        if (!NOT_CONTENT_139.has(f))
            rest[f] = S[f];
    return fnv(FNV0, JSON.stringify(rest) ?? '').toString(36);
}
/**
 * The copy `local` and `server` both started from, as far as their settings go: per key, the
 * value of the side that did not change it. null when no way round, or more than one, matches
 * `fpS`, or too many settings differ to try.
 */
export function legacyBase(local?: any, server?: any, fpS?: any) {
    if (typeof fpS !== 'string' || !local || !server)
        return null;
    const keys: any = [...new Set([...Object.keys(local), ...Object.keys(server)])].filter((k?: any) => !NOT_CONTENT_139.has(k)).sort();
    // Per key: the candidates for its value in the start copy, as [value, JSON] (JSON undefined: absent).
    const opts: any = keys.map((k?: any) => {
        const l: any = local[k], lj: any = JSON.stringify(l);
        if (KEEP_LOCAL.has(k))
            return [[l, lj]];
        const s: any = server[k], sj: any = JSON.stringify(s);
        return lj === sj ? [[l, lj]] : [[l, lj], [s, sj]];
    });
    if (opts.filter((o?: any) => o.length > 1).length > MAX_KEYS)
        return null;
    const found: any = [];
    const pick: any = [];
    const walk: any = (i?: any, h?: any, first?: any) => {
        if (found.length > 1)
            return;
        if (i === keys.length) {
            if (fnv(h, '}').toString(36) === fpS)
                found.push([...pick]);
            return;
        }
        for (const [v, j] of opts[i]) {
            pick[i] = v;
            if (j === undefined)
                walk(i + 1, h, first);
            else
                walk(i + 1, fnv(h, (first ? '' : ',') + JSON.stringify(keys[i]) + ':' + j), false);
        }
    };
    walk(0, fnv(FNV0, '{'), true);
    if (found.length !== 1)
        return null;
    const base: any = {};
    keys.forEach((k?: any, i?: any) => { if (found[0][i] !== undefined)
        base[k] = found[0][i]; });
    return base;
}
/**
 * `local` (an old app's owed copy) ready to merge with `server`: every setting and plan day this
 * device changed since the copy `fp` was taken of is stamped at `now`. `resolved` false when that
 * could not be told and the device changed something besides its lists: the caller keeps the
 * copy aside. Returns a new object for `state`.
 */
export function liftLegacy(local?: any, server?: any, fp?: any, now: any = Date.now()) {
    const state: any = JSON.parse(JSON.stringify(local));
    const fpS: any = fp && typeof fp === 'object' ? fp.s : null;
    // Nothing besides the lists changed here: there is nothing to stamp, and nothing to lose.
    if (typeof fpS === 'string' && restHash139(local) === fpS)
        return { state, resolved: true };
    const base: any = legacyBase(local, server || {}, fpS);
    if (!base)
        return { state, resolved: false };
    stampEdits(base, state, now);
    return { state, resolved: true };
}
