// Legacy dynamic types are explicit during the full language migration.
/* Two copies of the account state, one merged copy.
 *
 * The server refuses a push over a document the device never saw (PUT /api/data with a stale
 * `baseRev` answers 409 and hands back the current document). Before revisions the newer `_ts`
 * simply replaced the other copy wholesale — which is exactly how a desktop tab that sat open
 * all day dropped the workout the phone logged in the meantime. The merge keeps both sides'
 * entries and lets the newer copy decide everything that has no natural union.
 *
 * Rules, by field:
 *   - scalars and settings, `week`, `dayPlan`, `wc`, `reminder`, `queue`, `rotation`, …: each from
 *     the copy that changed it last by its own stamp in `edited` (stampEdits; `week`, `dayPlan`,
 *     exNotes and barWeights per day or per exercise), from the copy with the newer `_ts` when
 *     neither side stamped it or on a tie
 *   - equipProfiles, gymCards: union by id; of an id that both have, field by field as below
 *   - workouts, routines, customEx, equipProfiles, gymCards: of an id that both have, each field
 *     from the side that changed it last by its own stamp (`_f`, stampEntry / mergeEntry), the
 *     version edited last for every field neither side stamped
 *   - customEx: union by id; of an id that both have, the version edited last by its own `_ts`
 *     (stampCustomEx), the newer copy's on a tie — a photo or link added on one device must not
 *     be lost to the other's copy just because that one logged a set since
 *   - workouts: union by id; of an id that both have, the version edited last by its own `_ts`
 *     (stampWorkout — a workout changed after it was logged: its sets edited, moved to another
 *     day, its length or note corrected), the newer copy's on a tie; sorted by day and start
 *     like every other writer. Its `media` list is the exception: the union by hash of both
 *     copies' lists (the kept version's in its order, then the other's extras), so a photo added
 *     on one device survives the other's edit of the same workout — or its own photo
 *     (mergeWorkoutMedia)
 *   - routines: union by id in the newer copy's order, a routine only the older copy has next to
 *     its neighbour there (unionByNeighbours); of an id that both have, the version
 *     edited last by its own `_ts` (stampRoutines), the newer copy's on a tie
 *   - bodyweight, measurements: union by day, the later-edited (`t`) entry of a day that both have
 *   - favEx: ordered set union, the newer copy first
 *   - exWeights: union by exercise, the better `w` for that exercise — larger for an ordinary
 *     lift, smaller on an assistance machine (a PR logged on the other device must not be
 *     forgotten, whichever way it runs). An exercise in a workout whose edited version was kept
 *     is the exception: the edit may have taken away the set the kept weight came from, so it
 *     is the best of the merged history and of the editing copy's own, and the other copy's
 *     can no longer bring a corrected typo back. exNotes, barWeights: key union
 *   - balanceOverrides, loadKind, plates, dbLoad, dumbbells, stackWeights, dayNotes, dayPhotos: key union; of a key both
 *     have, the entry set last by its own `_ts`, a clear included (mergeStampedMap), the newer
 *     copy's on a tie. For plates and dumbbells the key is the unit, so the inventory of one unit
 *     is kept whole, as last edited; for dayNotes the key is the date, so each day's note is its own
 *   - `_ts`: the later of the two; `_rev` dropped (the server sets it); `active` left to the caller
 *
 * Two rules come before all of these:
 *
 *   - Units. Every weight in a copy is in its `unit`, so two copies in different units are never
 *     merged number by number: one is brought into the other's unit first (sameUnit). The unit
 *     that stays is the one chosen last — `unitSet.at`, stamped by a unit switch — or, with no
 *     stamp to tell, the newer copy's; with `prefer`, the preferred side's. A switch that only
 *     changed the label (`unitSet.convert === false`: the numbers were in the new unit all along)
 *     relabels the other copy instead of converting it. A copy converted to lb on one device used
 *     to meet the other device's kg copy and come back as kg with lb numbers under it.
 *   - Reset. "Reset everything" stamps the empty copy with `resetAt` and with `resetIds`: the keys
 *     of every entry it wiped — workouts, routines, custom exercises, weigh-ins (day and entry
 *     time), gym cards, equipment profiles, favourites, notes, bar weights and the stamped
 *     settings maps — of this device's copy and of the server's (resetIdsOf). A copy that has not
 *     seen that reset (an older or no `resetAt`) loses exactly those entries and keeps everything
 *     else, whatever its dates say: a CSV or Apple Health import of old sessions, a device whose
 *     clock runs behind, an entry with no date at all (sinceReset). Only a reset stamped before
 *     `resetIds` existed falls back to judging by time. The reset copy's settings and plan win
 *     whatever the `_ts`. `resetAt` only ever moves forward: the merge keeps the later one (with
 *     its ids; the union of both for the same reset; with `prefer`, the preferred side's), and so do a replace in
 *     the store and the server's PUT — a restored backup that carried no stamp would otherwise be
 *     taken for a copy older than the reset and wiped again. Before, a device with an unsent
 *     change got the 409, merged, and its union brought the whole wiped profile back. Not with
 *     `prefer`: a sign-in adds what a device logged signed out, which is not a copy of this
 *     account's history.
 *
 * After all of these, removals: an entry either copy records in `deleted` (stampDeletions) as
 * removed after it was last edited is left out, whatever the other copy still holds. With
 * `prefer` the reset stamp and the removals are the preferred side's only. Without it a
 * device that came back online after any time away brought back every workout, routine, custom
 * exercise, weigh-in or favourite the other device had removed meanwhile.
 */
import { beatsWeight } from './exercises.ts';
import { bestWeightForEntry } from './history.ts';
import { convertStateUnit, convertBodyWeight } from './units.ts';
import { sanitizeAccent } from './accent.ts';
import { readDayNote as readNote } from './day-notes.ts';
const clone: any = (o?: any) => JSON.parse(JSON.stringify(o));
const list: any = (v?: any) => (Array.isArray(v) ? v : []);
// The maps whose every entry carries its own edit time (mergeStampedMap). dayNotes is a day's
// note on a day off (lib/day-notes.ts), one entry per date.
// dayPhotos is a progress photo filed under a day (lib/day-photos.ts), one entry per photo.
export const STAMPED_MAPS: any = ['balanceOverrides', 'loadKind', 'plates', 'dbLoad', 'dumbbells', 'stackWeights', 'dayNotes', 'dayPhotos'];
/** The copy with the later `_ts`; on a tie the first argument (callers pass local first). */
export const newerOf: any = (a?: any, b?: any) => ((b?._ts || 0) > (a?._ts || 0) ? b : a);
/**
 * Entries of `newer` in their order, then those of `older` whose key nothing in `newer` has.
 * Same key → `newer`'s entry. Duplicate keys within one list are dropped (first wins).
 */
export function unionById(newer: any = [], older: any = [], key: any = (x?: any) => x?.id) {
    const seen: any = new Set();
    const out: any = [];
    for (const x of [...list(newer), ...list(older)]) {
        const k: any = key(x);
        if (k == null) {
            out.push(x);
            continue;
        }
        if (seen.has(k))
            continue;
        seen.add(k);
        out.push(x);
    }
    return out;
}
/**
 * unionById for a list whose order the user set (routines): `newer`'s entries in their order, and
 * each entry only `older` has goes in right after its nearest earlier neighbour in `older` (at
 * the start when it has none there). Appending them sent a routine that one device put back
 * (Plan's Undo) to the end of the list whenever the other device's copy was the newer one.
 */
export function unionByNeighbours(newer: any = [], older: any = [], key: any = (x?: any) => x?.id) {
    const out: any = unionById(newer, [], key);
    const at: any = new Set(out.map(key).filter((k?: any) => k != null));
    const keyless: any = [];
    let prev: any = null;
    for (const x of list(older)) {
        const k: any = key(x);
        if (k == null) {
            keyless.push(x);
            continue;
        }
        if (!at.has(k)) {
            const i: any = prev == null ? -1 : out.findIndex((y?: any) => key(y) === prev);
            out.splice(i + 1, 0, x);
            at.add(k);
        }
        prev = k;
    }
    return out.concat(keyless);
}
const workoutKey: any = (w?: any) => (w?.id != null ? w.id : `${w?.d}|${w?.start}`);
/**
 * The photos and videos of a workout both copies have: `kept`'s list as it stands (its order,
 * its refs), then every ref of `other`'s list whose hash `kept` lacks. Whole-record merging lost a
 * photo added on one device whenever the other edited that workout's note, date or length, or
 * added a photo of its own, later — the other copy's version was kept, and with it its list.
 *
 * The price is the file's known limit, one field in: with no record of what was removed, a photo
 * taken off on one device inside the conflict window comes back from the other copy that still
 * lists it — a resurrected photo is one tap to remove again, a lost one is gone. A removal the
 * other device has already pulled sticks, since neither copy lists it any more. Refs are carried
 * as they are; readers normalise and cap (workoutMediaOf). Mutates and returns `kept`.
 */
export function mergeWorkoutMedia(kept?: any, other?: any) {
    if (!kept || typeof kept !== 'object')
        return kept;
    const mine: any = list(kept.media);
    const theirs: any = list(other?.media);
    if (!theirs.length)
        return kept;
    const hashOf: any = (m?: any) => (m && typeof m === 'object' && typeof m.hash === 'string' ? m.hash : null);
    const seen: any = new Set(mine.map(hashOf).filter(Boolean));
    const extra: any = [];
    for (const m of theirs) {
        const h: any = hashOf(m);
        if (!h || seen.has(h))
            continue;
        seen.add(h);
        extra.push(clone(m));
    }
    if (extra.length)
        kept.media = [...(Array.isArray(kept.media) ? kept.media : []), ...extra];
    return kept;
}
const byDayStart: any = (a?: any, b?: any) => (a.d === b.d ? (a.start || 0) - (b.start || 0) : a.d < b.d ? -1 : 1);
/** One entry per day; where both have a day, the one edited later (`t`); sorted by day. */
export function mergeBodyweight(a: any = [], b: any = []) {
    const byDay: any = new Map();
    for (const e of [...list(a), ...list(b)]) {
        if (!e || e.d == null)
            continue;
        const cur: any = byDay.get(e.d);
        // A weigh-in typed into openGym beats one read from the phone's health hub (`src`, lib/health-read.ts)
        // whichever is newer: the scale's reading is the fallback, never a correction of the user's own.
        if (!cur || (!!cur.src !== !!e.src ? !e.src : (e.t || 0) > (cur.t || 0)))
            byDay.set(e.d, e);
    }
    return [...byDay.values()].sort((x?: any, y?: any) => (x.d < y.d ? -1 : 1));
}
// The kept load per exercise. "The larger one wins" held while the app only ever raised it —
// but an assistance machine progresses downwards, so there the smaller number is the newer,
// harder setting and taking the larger would hand back the help the other device just dropped
// (issue #232). `beatsWeight` knows which way round each exercise runs; the date breaks a tie
// on an exercise where both sides moved in the same direction.
function mergeExWeights(n: any = {}, o: any = {}) {
    const out: any = { ...(o || {}), ...(n || {}) };
    for (const k of Object.keys(o || {})) {
        if (!(n && n[k] && o[k]))
            continue;
        if (beatsWeight(k, o[k].w || 0, n[k].w || 0))
            out[k] = o[k];
    }
    return out;
}
// The kept load of an exercise that a kept workout edit touched (see mergeStates): the best set in
// the merged history, or the editing copy's own kept load when that is better still — the other
// copy's may be the very typo the edit corrected. `sources` are the exWeights of each copy whose
// edit was kept. Nothing left to read removes the key, as the edit itself did.
function correctedExWeight(id?: any, workouts?: any, sources?: any) {
    let best: any = null;
    const consider: any = (c?: any) => { if (c && c.w > 0 && (!best || beatsWeight(id, c.w, best.w)))
        best = c; };
    for (const w of workouts) {
        for (const e of list(w?.entries))
            if (e?.id === id)
                consider({ w: bestWeightForEntry(e), d: w.d });
    }
    for (const src of sources)
        consider(src?.[id]);
    return best;
}
/**
 * Stamps `_ts` on a saved workout changed after it was logged — its sets edited, moved to another
 * day or time, its length or its note corrected — the edit time mergeStates needs to keep the
 * version edited last, the way stampRoutines does for a plan. Without it the copy that was newer
 * as a whole decided: a phone that logged a weigh-in after the desktop corrected a workout brought
 * the uncorrected one back on the next conflict. Mutates and returns `w`.
 */
export function stampWorkout(w?: any, now: any = Date.now()) {
    if (w && typeof w === 'object')
        w._ts = now;
    return w;
}
const stampOf: any = (v?: any) => (v && typeof v === 'object' ? Number(v._ts) || 0 : 0);
const isMap: any = (v?: any) => !!v && typeof v === 'object' && !Array.isArray(v);
// ---- The Coach's history (`coach.chat`, `coach.log`, `coach.snapshots`) -----------------------
//
// `coach` is one setting to the stamps (`edited.coach`), so the copy that changed it last used to
// win it whole: a device that had sat on the Coach screen wrote one line into its older copy, and
// the other device's messages, log entries and Undo snapshots were gone (#779). These three lists
// only ever grow at the end, so they are joined instead: every entry of either copy once (by `id`,
// a snapshot by when it was taken and for which proposal), in the order they were written (`at`),
// and the newest few kept as lib/coach.ts keeps them. The rest of `coach` (consent, profile,
// cadence) still comes from the copy that changed it last.
//
// An Undo takes a snapshot off the ring. Its log entry names the snapshot it used (`snap`, or for
// an older app the proposal it put back), and a snapshot so named never comes back from the copy
// that still holds it: that would offer the same Undo twice.
// The bounds of lib/coach.ts (SNAPSHOT_MAX, LOG_MAX, CHAT_MAX, NAMESPACE_MAX), copied rather than
// imported: coach.ts pulls in the plan code, the merge must not. sync-merge.test.js checks them.
export const COACH_CAPS: any = { chat: 40, log: 50, snapshots: 3 };
const COACH_NAMESPACE_MAX: any = 256 * 1024;
export const snapshotKey: any = (x?: any) => (isMap(x) ? (x.id != null ? String(x.id) : `${Number(x.at) || 0}|${x.proposalId ?? ''}`) : null);
const coachKey: any = { chat: (x?: any) => (isMap(x) && x.id != null ? String(x.id) : null), log: (x?: any) => (isMap(x) && x.id != null ? String(x.id) : null), snapshots: snapshotKey };
// `xs` then `ys`, each key once (first wins), in the order written: by `at`, and an entry without
// one where it stood after its predecessor. Keyless entries stay, from `xs` only.
function unionInTime(xs?: any, ys?: any, key?: any) {
    const seen: any = new Set(), out: any = [];
    let i: any = 0;
    for (const [from, l] of [[0, list(xs)], [1, list(ys)]]) {
        let at: any = 0;
        for (const x of l) {
            if (x == null)
                continue;
            const k: any = key(x);
            if (Number(x?.at) > 0)
                at = Number(x.at);
            if (k == null) {
                if (!from)
                    out.push({ x, at, from, i: i++ });
                continue;
            }
            if (seen.has(k))
                continue;
            seen.add(k);
            out.push({ x, at, from, i: i++ });
        }
    }
    out.sort((a?: any, b?: any) => a.at - b.at || a.from - b.from || a.i - b.i);
    return out.map((e?: any) => e.x);
}
/**
 * The Coach namespace of two copies: `win`'s (the copy that changed it last), with its chat, log
 * and Undo snapshots joined with `other`'s (see above). Returns a new object, or `win` as it is
 * when either side has no namespace to join.
 */
export function mergeCoach(win?: any, other?: any) {
    if (!isMap(win) || !isMap(other))
        return win === undefined ? win : clone(win);
    const out: any = clone(win);
    for (const f of ['chat', 'log', 'snapshots']) {
        if (!Array.isArray(win[f]) && !Array.isArray(other[f]))
            continue;
        out[f] = clone(unionInTime(win[f], other[f], coachKey[f]));
    }
    // Snapshots an Undo on either side already used.
    const used: any = new Set(), byProposal: any = [];
    for (const e of list(out.log)) {
        if (!isMap(e) || e.kind !== 'revert')
            continue;
        if (e.snap != null)
            used.add(String(e.snap));
        else if (e.proposalId != null)
            byProposal.push(e);
    }
    if (out.snapshots) {
        out.snapshots = out.snapshots.filter((x?: any) => !used.has(snapshotKey(x)) &&
            !byProposal.some((e?: any) => x?.proposalId === e.proposalId && (Number(x?.at) || 0) <= (Number(e.at) || 0)));
    }
    for (const [f, max] of Object.entries(COACH_CAPS))
        if (Array.isArray(out[f]) && out[f].length > (max as any))
            out[f] = out[f].slice(-(max as any));
    // The namespace's own size guard (lib/coach.ts trim), the same oldest-first order.
    let guard: any = 0;
    while (JSON.stringify(out).length > COACH_NAMESPACE_MAX && guard++ < 60) {
        if (list(out.chat).length > 8)
            out.chat.shift();
        else if (list(out.snapshots).length > 1)
            out.snapshots.shift();
        else if (list(out.log).length > 1)
            out.log.shift();
        else
            break;
    }
    return out;
}
// ---- Entries merged field by field ----------------------------------------------------------
//
// A workout, routine, custom exercise, equipment profile or gym card edited on two devices kept
// the version edited last as a whole: a set corrected from 100 to 110 on one device was reverted
// by a note added on the other, a routine's 3 sets turned 5 lost to a rename, a custom exercise's
// photo to a rename. Each edit now records, per field, when it changed it (`_f`, stampEntry), and
// the merge takes every field from the side that changed it last (mergeEntry). A field neither
// side stamped follows the version edited last, as before.
const ENTRY_META: any = new Set(['id', '_ts', '_f', '_u']);
const fieldTime: any = (x?: any, k?: any) => Number(x?._f?.[k]) || 0;
const sameJSON: any = (x?: any, y?: any) => JSON.stringify(x) === JSON.stringify(y);
// ---- Undo ---------------------------------------------------------------------------------------
//
// An Undo that puts a field back exactly as it was before one change (a swipe's removal) is itself
// a change, stamped after the removal so it beats it on every device that already took the
// removal. But it also beat a change another device made to the same field before the removal
// and never saw: a set count edited offline in the routine whose exercise was swiped away and put
// back, a loop reordered offline while one routine was taken out of it and put back. The Undo
// meant "as if nothing happened", and that edit was lost.
//
// So such an Undo marks the field with what it undid: `[base, del, at]`, the field's stamp before
// the removal, the removal's stamp and the Undo's own (in an entry's `_u`, per field; in the
// copy's `undone`, per setting or plan day, as `edited` is). A merge then lets the other side's
// value win when its stamp falls strictly between `base` and `del`: a change made after the value
// the Undo put back, and before the removal it took back, which this device never saw. The value
// that wins is stamped just after the Undo, so every copy settles on it. A removal or edit seen
// after the removal (a stamp from `del` on) still loses to the Undo, as before.
// The marker of field `k` (`marks` is `_u` or `undone`) when it still describes the value stamped `at`.
const undoOf: any = (marks?: any, k?: any, at?: any) => {
    const u: any = isMap(marks) ? marks[k] : null;
    return Array.isArray(u) && u.length === 3 && at > 0 && Number(u[2]) === at ? u : null;
};
// Between two stamps of one field, `x` (marked `ux`) and `y` (marked `uy`): which side's value
// stays ('x', 'y' or '' on a tie) and the stamp it carries. See above.
// An Undo and a change made on the removal can carry the same stamp when both clocks were lifted
// from the removal's (stampChange: one past the highest stamp). The Undo wins that tie, whichever
// copy is first: a first-wins tie kept a different value on each device, for good.
function undoPick(tx?: any, ux?: any, ty?: any, uy?: any) {
    if (tx > ty)
        return ux && ty > Number(ux[0]) && ty < Number(ux[1]) ? ['y', tx + 1] : ['x', tx];
    if (ty > tx)
        return uy && tx > Number(uy[0]) && tx < Number(uy[1]) ? ['x', ty + 1] : ['y', ty];
    return ux && !uy ? ['x', tx] : uy && !ux ? ['y', ty] : ['', tx];
}
// `marks` brought up to date with `stamps` after a change stamped `now`: a pending marker
// (`[base, del]`, set by the Undo itself) of a field this change stamped gets `now`; one whose field
// has moved on since is dropped. Returns the markers left, or null.
function settleMarks(marks?: any, stamps?: any, now?: any) {
    if (!isMap(marks))
        return null;
    const out: any = {};
    for (const [k, m] of (Object.entries(marks) as [string, any][])) {
        if (!Array.isArray(m))
            continue;
        const at: any = Number(stamps?.[k]) || 0;
        if (m.length === 2 && at === now)
            out[k] = [Number(m[0]) || 0, Number(m[1]) || 0, now];
        else if (m.length === 3 && at > 0 && Number(m[2]) === at)
            out[k] = m;
    }
    return Object.keys(out).length ? out : null;
}
/**
 * What an Undo needs to mark what it put back (see above), taken right after the change it may
 * undo: for every stamped setting or plan day that change moved, its stamp before and after, and
 * its value before. `before` and `after` are the copies around the change.
 */
export function undoMarks(before?: any, after?: any) {
    const eb: any = isMap(before?.edited) ? before.edited : {}, ea: any = isMap(after?.edited) ? after.edited : {};
    const out: any = {};
    for (const [k, at] of Object.entries(ea)) {
        if (Number(at) === Number(eb[k] || 0))
            continue;
        out[k] = [Number(eb[k]) || 0, Number(at) || 0, JSON.stringify(editedValue(before, k) ?? null)];
    }
    return out;
}
const editedValue: any = (S?: any, k?: any) => {
    const dot: any = k.indexOf('.');
    return dot < 0 ? S?.[k] : (isMap(S?.[k.slice(0, dot)]) ? S[k.slice(0, dot)][k.slice(dot + 1)] : undefined);
};
/**
 * In an Undo's draft `s`, after it put things back: marks every setting and plan day of `marks`
 * (undoMarks) that is now exactly what it was before the change, and that nothing changed since.
 */
export function markUndone(s?: any, marks?: any) {
    if (!s || !isMap(marks))
        return s;
    const ed: any = isMap(s.edited) ? s.edited : {};
    for (const [k, [base, del, was]] of (Object.entries(marks) as [string, any][])) {
        if ((Number(ed[k]) || 0) !== del || JSON.stringify(editedValue(s, k) ?? null) !== was)
            continue;
        s.undone = { ...(isMap(s.undone) ? s.undone : {}), [k]: [base, del] };
    }
    return s;
}
/**
 * The same for one field `k` of an entry `x` in an Undo's draft: `base` and `del` are the field's
 * stamps before and after the change it undid. Only when nothing changed the field since.
 */
export function markEntryUndone(x?: any, k?: any, base?: any, del?: any) {
    if (!x || typeof x !== 'object' || !(del > 0) || fieldTime(x, k) !== del)
        return x;
    x._u = { ...(isMap(x._u) ? x._u : {}), [k]: [Number(base) || 0, del] };
    return x;
}
/**
 * Stamps `x`, the new version of an entry whose previous version is `old`, as edited at `now`:
 * its `_ts`, and in `_f` every field that differs from `old`. A new entry gets its `_ts` only.
 * Mutates and returns `x`.
 */
export function stampEntry(old?: any, x?: any, now?: any) {
    if (!x || typeof x !== 'object')
        return x;
    x._ts = now;
    if (!old || typeof old !== 'object')
        return x;
    const f: any = isMap(old._f) ? { ...old._f } : {};
    for (const k of new Set([...Object.keys(old), ...Object.keys(x)])) {
        if (ENTRY_META.has(k))
            continue;
        if ((k in old) !== (k in x) || !sameJSON(old[k], x[k]))
            f[k] = now;
    }
    if (Object.keys(f).length)
        x._f = f;
    else
        delete x._f;
    const u: any = settleMarks(x._u, f, now);
    if (u)
        x._u = u;
    else
        delete x._u;
    return x;
}
/**
 * Two versions of one entry: the version edited last (`_ts`; `a` on a tie), with every field the
 * other side changed later (`_f`) taken from that side, removal included. Returns a new object.
 */
export function mergeEntry(a?: any, b?: any) {
    const [n, o]: any = (Number(b?._ts) || 0) > (Number(a?._ts) || 0) ? [b, a] : [a, b];
    const out: any = clone(n);
    const f: any = { ...(isMap(o._f) ? o._f : {}) };
    for (const [k, v] of Object.entries(isMap(n._f) ? n._f : {}))
        if (!((Number(f[k]) || 0) > (Number(v) || 0)))
            f[k] = v;
    const u: any = {};
    let bumped: any = 0;
    for (const k of new Set([...Object.keys(n), ...Object.keys(o), ...Object.keys(f)])) {
        if (ENTRY_META.has(k))
            continue;
        const tn: any = fieldTime(n, k), to: any = fieldTime(o, k);
        const [side, at]: any = undoPick(tn, undoOf(n._u, k, tn), to, undoOf(o._u, k, to));
        if (side === 'y') {
            if (k in o)
                out[k] = clone(o[k]);
            else
                delete out[k];
        }
        if (at > Math.max(tn, to)) {
            f[k] = at;
            bumped = Math.max(bumped, at);
        }
        const kept: any = side === 'y' ? undoOf(o._u, k, at) : side === 'x' ? undoOf(n._u, k, at) : undoOf(n._u, k, at) || undoOf(o._u, k, at);
        if (kept)
            u[k] = clone(kept);
    }
    if (Object.keys(f).length)
        out._f = f;
    else
        delete out._f;
    if (Object.keys(u).length)
        out._u = u;
    else
        delete out._u;
    const ts: any = Math.max(Number(a?._ts) || 0, Number(b?._ts) || 0, bumped);
    if (ts)
        out._ts = ts;
    return out;
}
/**
 * A settings map whose entries carry their own edit time (`{ …, _ts }`), such as the Structural
 * Balance overrides or the plate-loading choices: every key of either side, and of a key both have, the entry set last — the
 * same rule a routine follows. Taking the newer copy's entry lost a choice made on one device
 * whenever the other had since logged a set; a plain key union brought a cleared entry back
 * from the side that still had it. So a clear is written as a stamped entry, not a delete, and
 * wins like any other edit. On a tie, or with `prefer`, the newer (preferred) side's entry stays.
 */
export function mergeStampedMap(newer?: any, older?: any, prefer?: any) {
    const n: any = isMap(newer) ? newer : {};
    const o: any = isMap(older) ? older : {};
    const out: any = { ...o, ...n };
    if (!prefer)
        for (const k of Object.keys(o))
            if (k in n && stampOf(o[k]) > stampOf(n[k]))
                out[k] = o[k];
    return out;
}
const unitOf: any = (S?: any) => (S?.unit === 'lb' ? 'lb' : 'kg');
const unitStamp: any = (S?: any) => Number(S?.unitSet?.at) || 0;
/**
 * `follow` in the unit of `lead`: converted, or only relabelled when `lead`'s last switch kept the
 * numbers (see the file's header). Returns `follow` itself when the units already agree.
 */
export function inUnitOf(follow?: any, lead?: any) {
    const to: any = unitOf(lead);
    if (!follow || unitOf(follow) === to)
        return follow;
    if (lead?.unitSet?.convert === false)
        return { ...follow, unit: to };
    return convertStateUnit({ ...follow, unit: unitOf(follow) }, to);
}
/** When the entries of a copy were made — what sinceReset holds against a reset without ids. */
const workoutTime: any = (w?: any) => Number(w?._ts) || Number(w?.end) || Number(w?.start) || 0;
// What a reset records of the entries it wiped (resetIds), by field: how an entry is named.
const bodyweightKey: any = (e?: any) => `${e?.d}|${e?.t ?? ''}`;
const RESET_LISTS: any = {
    workouts: workoutKey, routines: (x?: any) => x?.id, customEx: (x?: any) => x?.id, bodyweight: bodyweightKey,
    measurements: bodyweightKey, gymCards: (x?: any) => x?.id, equipProfiles: (x?: any) => x?.id, favEx: (x?: any) => x,
};
const RESET_MAPS: any = ['exNotes', 'barWeights', 'exAliases', ...STAMPED_MAPS];
/** An entry's name in resetIds: a workout's id (or day and start), a weigh-in's day and time, … */
export const entryKey: any = (field?: any, x?: any) => String(RESET_LISTS[field](x));
// Per field, the most names a reset keeps — far more workouts than anyone logs, and a bound on
// the document all the same. Past it the oldest names go first.
export const RESET_ID_MAX: any = 20000;
const capIds: any = (xs?: any) => (xs.length > RESET_ID_MAX ? xs.slice(xs.length - RESET_ID_MAX) : xs);
/** Every field's names from `a` then `b`, each once, capped (see RESET_ID_MAX). */
export function mergeResetIds(a?: any, b?: any) {
    const out: any = {};
    for (const f of [...Object.keys(RESET_LISTS), ...RESET_MAPS]) {
        const xs: any = [...new Set([...list(a?.[f]), ...list(b?.[f])].filter((k?: any) => k != null).map(String))];
        if (xs.length)
            out[f] = capIds(xs);
    }
    return out;
}
/** The names of every entry the given copies hold — what a reset wipes (see the file's header). */
export function resetIdsOf(...copies: any[]) {
    let out: any = {};
    for (const S of copies) {
        if (!S || typeof S !== 'object')
            continue;
        const one: any = {};
        for (const [f, key] of Object.entries(RESET_LISTS))
            one[f] = list(S[f]).filter((x?: any) => x != null).map(key);
        for (const f of RESET_MAPS)
            one[f] = Object.keys(isMap(S[f]) ? S[f] : {});
        out = mergeResetIds(out, one);
    }
    return out;
}
/**
 * What a copy that has not seen a reset still contributes after it (see the file's header): with
 * the reset's `ids`, everything but the entries it wiped; without (a reset from before ids were
 * kept), only the entries made after `at`. The kept loads are those of the workouts that remain.
 */
export function sinceReset(S?: any, at?: any, ids?: any) {
    const out: any = clone(S);
    if (ids && typeof ids === 'object') {
        for (const [f, key] of Object.entries(RESET_LISTS)) {
            const gone: any = new Set(list(ids[f]).map(String));
            if (Array.isArray(S[f]))
                out[f] = clone(S[f].filter((x?: any) => x == null || !gone.has(String((key as any)(x)))));
        }
        for (const f of RESET_MAPS) {
            const gone: any = new Set(list(ids[f]).map(String));
            if (isMap(S[f]))
                out[f] = clone(Object.fromEntries(Object.entries(S[f]).filter(([k]: any) => !gone.has(k))));
        }
    }
    else {
        const after: any = (v?: any) => (Number(v) || 0) > at;
        out.workouts = list(S.workouts).filter((w?: any) => w && after(workoutTime(w)));
        out.routines = list(S.routines).filter((r?: any) => r && after(r._ts));
        out.customEx = list(S.customEx).filter((c?: any) => c && after(c._ts));
        out.bodyweight = list(S.bodyweight).filter((e?: any) => e && after(e.t));
        out.measurements = list(S.measurements).filter((e?: any) => e && after(e.t));
        // No time of their own: taken for what they were before the reset, which cleared them.
        out.equipProfiles = [];
        out.gymCards = [];
        out.favEx = [];
        out.exNotes = {};
        out.exAliases = {};
        out.barWeights = {};
        for (const f of STAMPED_MAPS) {
            out[f] = Object.fromEntries(Object.entries(isMap(S[f]) ? S[f] : {}).filter(([, v]: any) => after(stampOf(v))));
        }
    }
    const ex: any = {};
    for (const w of out.workouts) {
        for (const e of list(w.entries)) {
            if (e?.id == null)
                continue;
            const wt: any = bestWeightForEntry(e);
            if (wt > 0 && (!ex[e.id] || beatsWeight(e.id, wt, ex[e.id].w)))
                ex[e.id] = { w: wt, d: w.d };
        }
    }
    out.exWeights = ex;
    // The Coach's history is joined, not replaced (mergeCoach), so what this copy said to the Coach
    // before the reset goes here: only lines, log entries and snapshots from after it stay.
    if (isMap(out.coach)) {
        for (const f of ['chat', 'log', 'snapshots']) {
            if (Array.isArray(out.coach[f]))
                out.coach[f] = out.coach[f].filter((x?: any) => (Number(x?.at) || 0) > at);
        }
    }
    // The reset copy's settings, plan and unit win whatever this copy's own stamps say (the file's
    // header): stamps from before the reset would otherwise outrank the fresh profile's defaults,
    // a unit switch made long ago would bring the old unit back over the reset's.
    delete out.edited;
    delete out.undone;
    delete out.unitSet;
    return out;
}
// ---- Deletions (`deleted`) ------------------------------------------------------------------
//
//   S.deleted = { workouts: { <key>: at }, routines: {…}, customEx, bodyweight, gymCards,
//                 equipProfiles, favEx }
//
// A positive `at` is when the entry was removed on some device; a negative one (-at) is when it
// was added back after such a removal (a favourite starred again). The store writes them on every
// change (stampDeletions, useStore update) and the merge honours them (applyDeletions): a removal
// beats any copy of the entry edited before it, so a device that was offline for a week no longer
// brings back the workout, routine or custom exercise deleted meanwhile. An edit made after the
// removal (the entry's own `_ts`, a weigh-in's `t`) keeps it, as does an add-back stamped later.
const DEL_LISTS: any = {
    workouts: workoutKey, routines: (x?: any) => x?.id, customEx: (x?: any) => x?.id, bodyweight: (e?: any) => e?.d,
    measurements: (e?: any) => e?.d, gymCards: (x?: any) => x?.id, equipProfiles: (x?: any) => x?.id, favEx: (x?: any) => x,
};
// When an entry was last edited, to hold against a removal. Entries with no time of their own
// (favourites, and cards and profiles saved before they were stamped) count as older than any
// removal.
const DEL_TIME: any = {
    workouts: workoutTime, routines: (x?: any) => Number(x?._ts) || 0, customEx: (x?: any) => Number(x?._ts) || 0,
    bodyweight: (e?: any) => Number(e?.t) || 0, measurements: (e?: any) => Number(e?.t) || 0,
    gymCards: (x?: any) => Number(x?._ts) || 0, equipProfiles: (x?: any) => Number(x?._ts) || 0,
};
// Per field, the most stamps kept; past it the oldest go first.
export const DELETED_MAX: any = 5000;
const capStamps: any = (m?: any) => {
    const ks: any = Object.keys(m);
    if (ks.length <= DELETED_MAX)
        return m;
    ks.sort((x?: any, y?: any) => Math.abs(m[x]) - Math.abs(m[y]));
    for (const k of ks.slice(0, ks.length - DELETED_MAX))
        delete m[k];
    return m;
};
/**
 * Records in `next.deleted` every entry `prev` had and `next` no longer has, at `now`, and marks
 * as added back (`-now`) any entry `next` brought in again whose removal was on record (and any
 * favourite starred). Mutates and returns `next`; adds no `deleted` when there is nothing to record.
 */
export function stampDeletions(prev?: any, next?: any, now: any = Date.now()) {
    if (!next || typeof next !== 'object')
        return next;
    const del: any = isMap(next.deleted) ? next.deleted : {};
    let touched: any = false;
    for (const [f, key] of Object.entries(DEL_LISTS)) {
        const before: any = list(prev?.[f]), after: any = list(next[f]);
        if (before === after)
            continue;
        const have: any = new Set(after.filter((x?: any) => x != null).map((x?: any) => String((key as any)(x))));
        const m: any = isMap(del[f]) ? del[f] : {};
        let changed: any = false;
        const time: any = DEL_TIME[f] || (() => 0);
        for (const x of before) {
            if (x == null)
                continue;
            const k: any = String((key as any)(x));
            // Never stamped before the entry's own time: a removal is always after what it removed,
            // whatever this device's clock says (stampChange).
            if (!have.has(k)) {
                m[k] = Math.max(now, time(x) + 1);
                changed = true;
            }
        }
        // Added back: only a key this change brought in, not every key the copy merely still holds.
        // A copy keeps an entry whose removal it has on record when that entry was edited after the
        // removal (applyDeletions); re-stamping it as added back on any unrelated change made the
        // stale copy outrank a later removal from another device, and the entry came back everywhere.
        // A favourite has no edit time of its own, so a star is always stamped: a device that never
        // saw the earlier unstar must still win against it with the star it set later.
        const had: any = new Set(before.filter((x?: any) => x != null).map((x?: any) => String((key as any)(x))));
        for (const k of have) {
            if (had.has(k))
                continue;
            if (k in m ? m[k] > 0 : f === 'favEx') {
                m[k] = -now;
                changed = true;
            }
        }
        if (changed) {
            del[f] = capStamps(m);
            touched = true;
        }
    }
    if (touched)
        next.deleted = del;
    return next;
}
// Whether removal record `v` replaces `cur`: the later stamp, and on a tie the add-back.
const laterDel: any = (v?: any, cur?: any) => {
    const x: any = Number(v) || 0, y: any = Number(cur) || 0;
    return Math.abs(x) > Math.abs(y) || (Math.abs(x) === Math.abs(y) && x < y);
};
/** Both copies' records of removals: per entry, the later stamp. */
export function mergeDeletions(a?: any, b?: any) {
    const out: any = {};
    for (const f of Object.keys(DEL_LISTS)) {
        const x: any = isMap(a?.[f]) ? a[f] : {}, y: any = isMap(b?.[f]) ? b[f] : {};
        const m: any = { ...x };
        // On equal stamps the add-back (negative) wins, whichever copy is first: two devices whose
        // clocks were lifted from the same stamp can record an Undo and a removal at the same time,
        // and a first-wins tie kept a different record on each side (QA 2026-10-06).
        for (const [k, v] of Object.entries(y))
            if (!(k in m) || laterDel(v, m[k]))
                m[k] = v;
        if (Object.keys(m).length)
            out[f] = capStamps(m);
    }
    return Object.keys(out).length ? out : null;
}
/**
 * `S` without the entries `deleted` says were removed after they were last edited. Returns the
 * removed workouts too (their kept loads need a second look). Mutates `S`.
 */
function applyDeletions(S?: any, deleted?: any) {
    const gone: any = [];
    if (!deleted)
        return gone;
    for (const [f, key] of Object.entries(DEL_LISTS)) {
        const m: any = deleted[f];
        if (!isMap(m) || !Array.isArray(S[f]))
            continue;
        const time: any = DEL_TIME[f] || (() => 0);
        S[f] = S[f].filter((x?: any) => {
            if (x == null)
                return true;
            const at: any = Number(m[String((key as any)(x))]) || 0;
            const drop: any = at > 0 && at >= time(x);
            if (drop && f === 'workouts')
                gone.push(x);
            return !drop;
        });
    }
    return gone;
}
// ---- Edit stamps (`edited`) -----------------------------------------------------------------
//
//   S.edited = { restSec: at, queue: at, rotation: at, 'week.3': at, 'dayPlan.2026-10-08': at, … }
//
// When each setting, and each day of the plan, was last changed on some device. The store writes
// them on every change (stampEdits, useStore update) and the merge takes each one from the copy
// that changed it last (applyEdits) rather than the whole lot from the copy that changed anything
// last: Wednesday set on an offline phone survives the weigh-in the desktop logged meanwhile, and
// a rotation pass refilled on the phone survives a setting flipped on the desktop. Fields with a
// merge of their own are not stamped here; a field nobody stamped follows the newer copy, as before.
const OWN_MERGE: any = new Set([
    '_ts', '_rev', '_wid', '_wids', '_unstamped', '_prior', 'active', 'unit', 'unitSet', 'resetAt', 'resetIds', 'deleted', 'edited', 'undone', 'routineOrder',
    'workouts', 'routines', 'customEx', 'equipProfiles', 'gymCards', 'bodyweight', 'measurements', 'favEx',
    'exWeights', 'balanceOverrides', 'loadKind', 'plates', 'dbLoad', 'dumbbells', 'stackWeights', 'dayNotes', 'dayPhotos',
]);
// Stamped per key instead of whole: one day of the plan, one exercise's note or bar.
const PER_KEY: any = new Set(['week', 'dayPlan', 'exNotes', 'barWeights', 'exAliases']);
// The order of the routines, as the list shows them, is a choice of its own (`edited.routineOrder`):
// a reorder on one device was lost to the other's whole copy whenever that one was newer.
export const ORDER_KEY: any = 'routineOrder';
// Whether two lists hold the routines both have in a different order (added or removed ones aside).
export function orderMoved(a?: any, b?: any) {
    const ida: any = list(a).map((r?: any) => r?.id).filter((id?: any) => id != null), idb: any = list(b).map((r?: any) => r?.id).filter((id?: any) => id != null);
    const inA: any = new Set(ida), inB: any = new Set(idb);
    return JSON.stringify(ida.filter((id?: any) => inB.has(id))) !== JSON.stringify(idb.filter((id?: any) => inA.has(id)));
}
// A per-key stamp of a key neither copy holds any more is dropped after this long.
const EDIT_KEEP_MS: any = 180 * 86400000;
const same: any = (x?: any, y?: any) => JSON.stringify(x) === JSON.stringify(y);
/**
 * Stamps in `next.edited` every field (and every day of the plan, note, bar weight) that differs
 * from `prev`, at `now`. Mutates and returns `next`.
 */
export function stampEdits(prev?: any, next?: any, now: any = Date.now()) {
    if (!next || typeof next !== 'object')
        return next;
    const ed: any = isMap(next.edited) ? next.edited : {};
    let touched: any = false;
    for (const k of new Set([...Object.keys(prev || {}), ...Object.keys(next)])) {
        if (OWN_MERGE.has(k))
            continue;
        const p: any = prev?.[k], n: any = next[k];
        if (PER_KEY.has(k)) {
            const pm: any = isMap(p) ? p : {}, nm: any = isMap(n) ? n : {};
            if (p === n)
                continue;
            for (const s of new Set([...Object.keys(pm), ...Object.keys(nm)])) {
                if ((s in pm) !== (s in nm) || !same(pm[s], nm[s])) {
                    ed[`${k}.${s}`] = now;
                    touched = true;
                }
            }
        }
        else if (p !== n && !same(p, n)) {
            ed[k] = now;
            touched = true;
        }
    }
    if (prev && prev.routines !== next.routines && orderMoved(prev.routines, next.routines)) {
        ed[ORDER_KEY] = now;
        touched = true;
    }
    // An own accent colour is one choice made in two fields: picking a new colour while the own
    // colour is already on changes only accentCustom, and a preset picked earlier on another device
    // then kept `accent` and won (QA 2026-10-06). Either one changed to an own colour stamps both.
    if (touched && next.accent === 'custom' && (ed.accent === now || ed.accentCustom === now)) {
        ed.accent = now;
        ed.accentCustom = now;
    }
    if (touched) {
        for (const [k, at] of Object.entries(ed)) {
            const dot: any = k.indexOf('.');
            if (dot < 0 || now - (at as any) < EDIT_KEEP_MS)
                continue;
            const m: any = next[k.slice(0, dot)];
            if (!isMap(m) || !(k.slice(dot + 1) in m))
                delete ed[k];
        }
        next.edited = ed;
    }
    // An Undo's markers (see "Undo" above): completed with this change's stamp, or dropped once
    // their setting moved on.
    if ('undone' in next) {
        const u: any = settleMarks(next.undone, ed, now);
        if (u)
            next.undone = u;
        else
            delete next.undone;
    }
    return next;
}
/** Both copies' edit stamps: per key, the later one. */
export function mergeEdits(a?: any, b?: any) {
    const x: any = isMap(a) ? a : {}, y: any = isMap(b) ? b : {};
    const out: any = { ...x };
    for (const [k, v] of Object.entries(y))
        if (!((Number(out[k]) || 0) >= (Number(v) || 0)))
            out[k] = v;
    return Object.keys(out).length ? out : null;
}
/**
 * Into `out` (a merge built from `n`, the newer copy), every stamped field and plan day from the
 * copy that changed it last, removal included. A tie (but one an Undo wins, undoPick) or a field
 * nobody stamped stays as it is.
 */
function applyEdits(out?: any, n?: any, o?: any) {
    const en: any = isMap(n.edited) ? n.edited : {}, eo: any = isMap(o.edited) ? o.edited : {};
    const bumps: any = {};
    for (const k of new Set([...Object.keys(en), ...Object.keys(eo)])) {
        const tn: any = Number(en[k]) || 0, to: any = Number(eo[k]) || 0;
        const un: any = undoOf(n.undone, k, tn), uo: any = undoOf(o.undone, k, to);
        if (tn === to && !un === !uo)
            continue;
        // An Undo's marker can hand the field to the side whose stamp is older (see "Undo" above).
        const [side, at]: any = undoPick(tn, un, to, uo);
        if (at > Math.max(tn, to))
            bumps[k] = at;
        const src: any = side === 'y' ? o : n;
        const dot: any = k.indexOf('.');
        if (dot < 0) {
            if (OWN_MERGE.has(k) || PER_KEY.has(k))
                continue;
            if (k in src)
                out[k] = clone(src[k]);
            else
                delete out[k];
            continue;
        }
        const f: any = k.slice(0, dot), s: any = k.slice(dot + 1);
        if (!PER_KEY.has(f))
            continue;
        const from: any = isMap(src[f]) ? src[f] : {};
        const into: any = isMap(out[f]) ? out[f] : (out[f] = {});
        if (s in from)
            into[s] = clone(from[s]);
        else
            delete into[s];
    }
    return bumps;
}
// `prefer` names the side whose settings, plan and per-exercise config win regardless of `_ts`:
// on sign-in the server's profile is the truth and the device only contributes the entries it
// logged while signed out. Without it the newer copy decides, as for a conflict between devices.
export function mergeStates(a0?: any, b0?: any, { prefer }: any = {}) {
    if (!a0)
        return b0 ? clone(b0) : b0;
    if (!b0)
        return clone(a0);
    let a: any = a0, b: any = b0;
    // A reset seen by one copy only: the other keeps what was made after it, and the reset copy
    // decides the rest (the file's header).
    let side: any = prefer === 'a' || prefer === 'b' ? prefer : newerOf(a, b) === a ? 'a' : 'b';
    const ra: any = Number(a.resetAt) || 0, rb: any = Number(b.resetAt) || 0;
    if (!prefer) {
        if (ra > rb) {
            b = sinceReset(b, ra, a.resetIds);
            side = 'a';
        }
        else if (rb > ra) {
            a = sinceReset(a, rb, b.resetIds);
            side = 'b';
        }
    }
    // The reset stamp only moves forward, with the names it wiped. With `prefer` it is the
    // preferred side's: a reset made on a guest copy, or on a phone in local mode, wiped that copy,
    // not the account it signs in to — carried over, it made every other device of the account drop
    // its unsent settings and plan as if the account had been reset (a backup import keeps the
    // stamp of the copy it replaces on its own, keepReset).
    const resetAt: any = prefer ? (prefer === 'a' ? ra : rb) : Math.max(ra, rb);
    const resetIds: any = prefer ? (prefer === 'a' ? a0 : b0).resetIds || null
        : ra === rb ? (a0.resetIds || b0.resetIds ? mergeResetIds(a0.resetIds, b0.resetIds) : null)
            : (ra > rb ? a0 : b0).resetIds || null;
    // One unit before anything is compared.
    let lead: any = null;
    if (unitOf(a) !== unitOf(b)) {
        lead = prefer || unitStamp(a) === unitStamp(b) ? (side === 'a' ? a : b) : unitStamp(a) > unitStamp(b) ? a : b;
        if (lead === a)
            b = inUnitOf(b, a);
        else
            a = inUnitOf(a, b);
    }
    const n: any = side === 'a' ? a : b;
    const o: any = n === a ? b : a;
    const out: any = clone(n);
    // The unit is the lead's by now; so is the record of choosing it.
    const unitBy: any = lead || (unitStamp(a) >= unitStamp(b) ? a : b);
    if (unitBy.unitSet)
        out.unitSet = clone(unitBy.unitSet);
    out.workouts = unionById(n.workouts, o.workouts, workoutKey).map(clone);
    // A workout edited after it was logged keeps the version edited last, whichever copy is newer
    // as a whole — the same rule as a routine's. `editedBy` notes, per exercise, the copies whose
    // edit of its sets was kept, for the kept loads below. `prefer` (sign-in) keeps the preferred
    // side's version as it is.
    const editedBy: any = new Map();
    if (!prefer) {
        const mine: any = new Set(list(n.workouts).map(workoutKey));
        const other: any = new Map(list(o.workouts).map((w?: any) => [workoutKey(w), w]));
        out.workouts = out.workouts.map((w?: any) => {
            const key: any = workoutKey(w);
            const alt: any = mine.has(key) ? other.get(key) : null;
            if (!alt)
                return w;
            // Field by field (mergeEntry): the sets from the side that edited them last, the note from
            // the side that edited it last.
            const kept: any = mergeEntry(w, alt);
            const [last, first, byLast, byFirst]: any = (alt._ts || 0) > (w._ts || 0) ? [alt, w, o, n] : [w, alt, n, o];
            if ((last._ts || 0) !== (first._ts || 0) && JSON.stringify(last.entries) !== JSON.stringify(first.entries)) {
                const by: any = JSON.stringify(kept.entries) === JSON.stringify(first.entries) ? byFirst : byLast;
                for (const e of [...list(kept.entries), ...list(w.entries), ...list(alt.entries)]) {
                    if (e?.id == null)
                        continue;
                    if (!editedBy.has(e.id))
                        editedBy.set(e.id, new Set());
                    editedBy.get(e.id).add(by.exWeights);
                }
            }
            return kept;
        });
    }
    // Of a workout both copies have, the kept version's media list gains the other's extras — with
    // `prefer` too: signing in must not drop a photo added while signed out any more than a
    // conflict may.
    {
        const nBy: any = new Map(list(n.workouts).map((w?: any) => [workoutKey(w), w]));
        const oBy: any = new Map(list(o.workouts).map((w?: any) => [workoutKey(w), w]));
        for (const w of out.workouts) {
            const key: any = workoutKey(w);
            const x: any = nBy.get(key), y: any = oBy.get(key);
            if (x && y) {
                mergeWorkoutMedia(w, x);
                mergeWorkoutMedia(w, y);
            }
        }
    }
    out.workouts.sort(byDayStart);
    for (const f of ['routines', 'customEx', 'equipProfiles', 'gymCards']) {
        if (list(n[f]).length || list(o[f]).length)
            out[f] = (f === 'routines' ? unionByNeighbours : unionById)(n[f], o[f]).map(clone);
    }
    // The routines in the order chosen last (`edited.routineOrder`), the newer copy's without a
    // stamp to tell; one only the other copy has still goes next to its neighbour there. Each entry
    // is still the newer copy's version here, merged with the other's below.
    if (!prefer && out.routines && (Number(o.edited?.[ORDER_KEY]) || 0) > (Number(n.edited?.[ORDER_KEY]) || 0)) {
        const mine: any = new Map(list(n.routines).filter((r?: any) => r?.id != null).map((r?: any) => [r.id, r]));
        out.routines = unionByNeighbours(o.routines, n.routines).map((r?: any) => clone(r?.id != null && mine.has(r.id) ? mine.get(r.id) : r));
    }
    // A routine edited on both sides keeps the version edited last. Taking the newer copy's
    // version dropped a plan edit made on one device whenever the other had since logged a set or
    // flipped a setting — its whole copy was newer, its version of that routine was not. `prefer`
    // (sign-in) keeps the preferred side's plan as it is.
    // Field by field (mergeEntry): a routine's sets changed on one device and its name on the other
    // are both kept. The same for a custom exercise (a photo added on one device survives a rename
    // on the other), an equipment profile and a gym card.
    if (!prefer) {
        for (const f of ['routines', 'customEx', 'equipProfiles', 'gymCards']) {
            if (!out[f])
                continue;
            const other: any = new Map(list(o[f]).filter((x?: any) => x?.id != null).map((x?: any) => [x.id, x]));
            out[f] = out[f].map((x?: any) => {
                const alt: any = x?.id != null && other.get(x.id);
                return alt ? mergeEntry(x, alt) : x;
            });
        }
    }
    out.bodyweight = mergeBodyweight(n.bodyweight, o.bodyweight).map(clone);
    // A day's body measurements are one check-in, kept and merged the way a weigh-in is.
    if (list(n.measurements).length || list(o.measurements).length)
        out.measurements = mergeBodyweight(n.measurements, o.measurements).map(clone);
    if (list(n.favEx).length || list(o.favEx).length)
        out.favEx = [...new Set([...list(n.favEx), ...list(o.favEx)])];
    // What either device removed stays removed (the `deleted` section above). A workout taken out
    // this way leaves its exercises' kept loads to be read again, as an edit of it would: from the
    // merged history and from the deleting copy's own, which already let go of what it held.
    // With `prefer` only the preferred side's removals count: a guest's are about the guest's own
    // entries, and keyed by day (weigh-ins) or exercise (favourites) they also named the account's
    // weigh-in of that day and its favourite, which the guest never had.
    const deleted: any = prefer ? mergeDeletions(prefer === 'a' ? a.deleted : b.deleted, null) : mergeDeletions(a.deleted, b.deleted);
    for (const w of applyDeletions(out, deleted)) {
        const k: any = String(workoutKey(w));
        const by: any = [n, o].filter((S?: any) => Number(S.deleted?.workouts?.[k]) > 0).map((S?: any) => S.exWeights);
        for (const e of list(w.entries)) {
            if (e?.id == null)
                continue;
            if (!editedBy.has(e.id))
                editedBy.set(e.id, new Set());
            for (const src of by)
                editedBy.get(e.id).add(src);
        }
    }
    out.exWeights = clone(mergeExWeights(n.exWeights, o.exWeights));
    for (const [id, sources] of editedBy) {
        const kept: any = correctedExWeight(id, out.workouts, sources);
        if (kept)
            out.exWeights[id] = clone(kept);
        else
            delete out.exWeights[id];
    }
    for (const f of ['exNotes', 'barWeights', 'exAliases']) {
        if (n[f] || o[f])
            out[f] = clone({ ...(o[f] || {}), ...(n[f] || {}) });
    }
    // The plate-loading choices (lib/plates.ts) are stamped the same way: an exercise's loading and
    // a unit's plate inventory are each one choice, made on one device, that a later set logged on
    // the other must not undo.
    for (const f of STAMPED_MAPS) {
        if (n[f] || o[f])
            out[f] = clone(mergeStampedMap(n[f], o[f], prefer));
    }
    // Each stamped setting and plan day from the copy that changed it last (the `edited` section
    // above). `prefer` (sign-in) keeps the preferred side's, stamps and all.
    if (!prefer) {
        const bumps: any = applyEdits(out, n, o);
        const edited: any = mergeEdits(n.edited, o.edited);
        if (edited) {
            Object.assign(edited, bumps);
            out.edited = edited;
        }
        else
            delete out.edited;
        // An Undo's markers that still describe the merged stamp of their setting.
        const undone: any = {};
        for (const k of new Set([...Object.keys(isMap(n.undone) ? n.undone : {}), ...Object.keys(isMap(o.undone) ? o.undone : {})])) {
            const at: any = Number(edited?.[k]) || 0;
            const m: any = undoOf(n.undone, k, at) || undoOf(o.undone, k, at);
            if (m && !(k in bumps))
                undone[k] = clone(m);
        }
        if (Object.keys(undone).length)
            out.undone = undone;
        else
            delete out.undone;
        // The Coach's conversation, log and Undo snapshots from both copies (mergeCoach), whichever
        // changed `coach` last.
        if (isMap(out.coach)) {
            const other: any = sameJSON(out.coach, n.coach) ? o.coach : n.coach;
            if (isMap(other))
                out.coach = mergeCoach(out.coach, other);
        }
    }
    if (deleted)
        out.deleted = deleted;
    else
        delete out.deleted;
    out._ts = Math.max(a._ts || 0, b._ts || 0);
    if (resetAt)
        out.resetAt = resetAt;
    if (resetIds)
        out.resetIds = resetIds;
    else
        delete out.resetIds;
    delete out._rev;
    delete out._wid;
    delete out._wids;
    delete out._unstamped; // the server's own notes (api/sync-stamps.ts), never a client's
    delete out._prior;
    // The accent fields end up in CSS: whatever either copy brought, only a clean value goes on.
    sanitizeAccent(out);
    return out;
}
/**
 * `next` replacing `cur` wholesale (a backup import, a reset) never takes the reset stamp back:
 * the later `resetAt` stays, with its names — a restored backup that carried none would otherwise
 * be taken, on every device that saw the reset, for a copy from before it and wiped again.
 * Mutates and returns `next`.
 */
export function keepReset(cur?: any, next?: any) {
    if (!next || typeof next !== 'object')
        return next;
    const rc: any = Number(cur?.resetAt) || 0, rn: any = Number(next.resetAt) || 0;
    if (rc > rn) {
        next.resetAt = cur.resetAt;
        if (cur.resetIds)
            next.resetIds = clone(cur.resetIds);
        else
            delete next.resetIds;
    }
    else if (rc && rc === rn && (cur.resetIds || next.resetIds)) {
        next.resetIds = mergeResetIds(cur.resetIds, next.resetIds);
    }
    return next;
}
// ---- A restored backup ------------------------------------------------------------------------
//
// A backup brought back over the profile (Settings, Import) is a deliberate add-back: the main way
// to undo a mistake. Its entries are older than any removal recorded since it was made, so the
// merge used to delete them again (the removal record outlived the restore), at once with "Merge
// them in" and on the next conflict of any other device with "Replace". And a device with an older
// unsent setting change won over the restored settings, which carried no stamp. So a restore marks
// every entry it holds whose removal is on record (here or in `others`) as added back at `now`,
// stamps its settings, plan days and plans as changed at `now`, and keeps the record of removals.
/** Stamps `next`, a restored backup, as described above. Mutates and returns `next`. */
export function stampRestore(next?: any, others: any = [], now: any = Date.now()) {
    if (!next || typeof next !== 'object')
        return next;
    let del: any = mergeDeletions(next.deleted, null);
    for (const o of others)
        del = mergeDeletions(del, o?.deleted);
    del = del || {};
    for (const [f, key] of Object.entries(DEL_LISTS)) {
        const m: any = del[f];
        if (!isMap(m))
            continue;
        for (const x of list(next[f])) {
            if (x == null)
                continue;
            const k: any = String((key as any)(x));
            if (Number(m[k]) > 0)
                m[k] = -now;
        }
    }
    if (Object.keys(del).length)
        next.deleted = del;
    else
        delete next.deleted;
    const ed: any = isMap(next.edited) ? { ...next.edited } : {};
    for (const k of Object.keys(next))
        if (!OWN_MERGE.has(k) && !PER_KEY.has(k))
            ed[k] = now;
    for (const f of PER_KEY) {
        for (const S of [next, ...others])
            for (const s of Object.keys(isMap(S?.[f]) ? S[f] : {}))
                ed[`${f}.${s}`] = now;
    }
    ed[ORDER_KEY] = now;
    next.edited = ed;
    for (const f of ['routines', 'customEx'])
        for (const x of list(next[f]))
            if (x && typeof x === 'object')
                x._ts = now;
    return next;
}
/**
 * A backup that replaces the profile ("Replace anyway", or an import with nothing to ask about) is
 * stamped like a reset of what it replaced, on top of stampRestore: every entry this device or the
 * server held that the backup lacks is recorded as removed at `now`, and every field of an entry
 * the backup holds in another version is stamped at `now`, and so is a stamped settings entry
 * (balance, loading, plates) it sets differently. A device that still had an unsent change from
 * before the replace used to bring the replaced workouts back with its merge, and its older edit
 * of an entry won over the backup's version. A change made after the replace (a later stamp) still
 * wins, and an entry only that device knew of is not named, so it stays. `others` are the copies
 * the replace knew: this device's and the server's. Mutates and returns `next`.
 */
export function stampReplace(next?: any, others: any = [], now: any = Date.now()) {
    if (!next || typeof next !== 'object')
        return next;
    const known: any = {};
    for (const f of Object.keys(DEL_LISTS))
        known[f] = others.flatMap((o?: any) => list(o?.[f])).filter((x?: any) => x != null);
    stampDeletions(known, next, now);
    for (const f of ['workouts', 'routines', 'customEx', 'equipProfiles', 'gymCards']) {
        const versions: any = new Map();
        for (const o of others)
            for (const x of list(o?.[f]))
                if (x && typeof x === 'object' && x.id != null)
                    versions.set(x.id, [...(versions.get(x.id) || []), x]);
        for (const x of list(next[f])) {
            if (!x || typeof x !== 'object' || x.id == null || !versions.has(x.id))
                continue;
            const fields: any = isMap(x._f) ? { ...x._f } : {};
            let moved: any = false;
            for (const old of versions.get(x.id)) {
                for (const k of new Set([...Object.keys(old), ...Object.keys(x)])) {
                    if (ENTRY_META.has(k))
                        continue;
                    if ((k in old) !== (k in x) || !sameJSON(old[k], x[k])) {
                        fields[k] = now;
                        moved = true;
                    }
                }
            }
            if (!moved)
                continue;
            x._f = fields;
            delete x._u;
            x._ts = Math.max(Number(x._ts) || 0, now);
        }
    }
    for (const f of STAMPED_MAPS) {
        if (!isMap(next[f]))
            continue;
        for (const [k, v] of Object.entries(next[f])) {
            if (!isMap(v))
                continue;
            if (others.some((o?: any) => isMap(o?.[f]) && k in o[f] && !sameJSON({ ...o[f][k], _ts: 0 }, { ...(v as any), _ts: 0 })))
                (v as any)._ts = Math.max(stampOf(v), now);
        }
    }
    return next;
}
// ---- One causal time per change ---------------------------------------------------------------
//
// Every stamp above is a wall-clock time, compared between devices. A phone whose clock runs
// behind stamped its later change before the change it had already seen, and lost to it on the
// next merge: its setting, its routine edit, its delete reverted, silently, on every device. So a
// change is stamped after every stamp the copy it was made on carries (stampChange): a change
// made after seeing another always wins over it, whatever either clock says. Only changes neither
// device had seen are still ordered by their clocks.
/** The latest stamp a copy carries: its `_ts`, every setting, removal and entry stamp. */
export function highestStamp(S?: any) {
    let m: any = 0;
    const see: any = (v?: any) => { const n: any = Math.abs(Number(v) || 0); if (n > m)
        m = n; };
    if (!S || typeof S !== 'object')
        return 0;
    see(S._ts);
    see(S.unitSet?.at);
    see(S.resetAt);
    if (isMap(S.edited))
        for (const v of Object.values(S.edited))
            see(v);
    if (isMap(S.deleted))
        for (const f of Object.values(S.deleted))
            if (isMap(f))
                for (const v of (Object.values as any)(f))
                    see(v);
    for (const f of ['workouts', 'routines', 'customEx', 'equipProfiles', 'gymCards']) {
        for (const x of list(S[f])) {
            if (!x || typeof x !== 'object')
                continue;
            see(x._ts);
            if (isMap(x._f))
                for (const v of Object.values(x._f))
                    see(v);
        }
    }
    for (const f of STAMPED_MAPS)
        if (isMap(S[f]))
            for (const v of Object.values(S[f]))
                see(stampOf(v));
    for (const e of [...list(S.bodyweight), ...list(S.measurements)])
        if (e && typeof e === 'object')
            see(e.t);
    return m;
}
/**
 * Stamps everything the change from `prev` to `next` touched, at one time that comes after every
 * stamp `prev` carries (and `wall`, this device's clock): routines, custom exercises, workouts a
 * screen re-stamped (stampWorkout), removals, settings and plan days. Mutates `next`; returns
 * the time used, for the copy's own `_ts`.
 */
export function stampChange(prev?: any, next?: any, wall: any = Date.now()) {
    const now: any = Math.max(Number(wall) || 0, highestStamp(prev) + 1);
    if (!next || typeof next !== 'object')
        return now;
    const before: any = new Map(list(prev?.workouts).filter((w?: any) => w && w.id != null).map((w?: any) => [w.id, w]));
    for (const w of list(next.workouts)) {
        if (!w || typeof w !== 'object' || w.id == null || w._ts == null)
            continue;
        const old: any = before.get(w.id);
        if (old && w._ts !== old._ts)
            stampEntry(old, w, now);
    }
    // Settings maps whose entries carry their own stamp (mergeStampedMap): an entry the change
    // re-stamped takes the change's time.
    for (const f of STAMPED_MAPS) {
        const p: any = isMap(prev?.[f]) ? prev[f] : {}, n: any = isMap(next[f]) ? next[f] : null;
        if (!n)
            continue;
        for (const [k, v] of Object.entries(n))
            if (isMap(v) && (v as any)._ts != null && stampOf(v) !== stampOf(p[k]))
                (v as any)._ts = now;
    }
    // A weigh-in the change logged or corrected (its `t` moved): the newer entry of a day wins the
    // merge (mergeBodyweight), so it takes the change's time like any other stamp. One whose weight
    // only a unit switch converted keeps its own.
    for (const f of ['bodyweight', 'measurements']) {
        const before: any = new Map(list(prev?.[f]).filter((e?: any) => e && e.d != null).map((e?: any) => [e.d, e]));
        for (const e of list(next[f])) {
            if (!e || typeof e !== 'object' || e.d == null || e.t == null)
                continue;
            const old: any = before.get(e.d);
            if (!old || old.t !== e.t)
                e.t = Math.max(Number(e.t) || 0, now);
        }
    }
    // A routine put back by an Undo keeps the edit time it had: what puts it back is the add-back
    // on record (stampDeletions), not an edit of it. Stamped as edited now, it was the newer version
    // to an older app's merge (v1.3.9 keeps a routine whole, by `_ts`), and a rename made there
    // offline was lost to the Undo. Only a routine removed after its last edit counts, and one that
    // never had an edit time (the seed's, a template's, one from before stamps) stays without one.
    const gone: any = isMap(prev?.deleted?.routines) ? prev.deleted.routines : {};
    const putBack: any = (r?: any) => Number(gone[r.id]) > 0 && (!(Number(r._ts) > 0) || Number(r._ts) < Number(gone[r.id])) &&
        !list(prev?.routines).some((x?: any) => x?.id === r.id);
    stampRoutines(prev?.routines, next.routines, now, putBack);
    stampCustomEx(prev?.customEx, next.customEx, now);
    stampEntries(prev?.equipProfiles, next.equipProfiles, now);
    stampEntries(prev?.gymCards, next.gymCards, now);
    stampDeletions(prev, next, now);
    stampEdits(prev, next, now);
    return now;
}
const sameRoutine: any = (a?: any, b?: any) => JSON.stringify({ ...a, _ts: 0, _f: 0, _u: 0 }) === JSON.stringify({ ...b, _ts: 0, _f: 0, _u: 0 });
/**
 * Stamps `_ts` on every routine of `next` that is new or differs from its version in `prev` — the
 * edit time mergeStates needs to keep the routine edited last. The store runs it on every change
 * (useStore update), so no screen that edits a plan has to remember to. Mutates and returns `next`.
 */
export function stampRoutines(prev: any = [], next: any = [], now: any = Date.now(), putBack: any = () => false) {
    const before: any = new Map(list(prev).filter((r?: any) => r?.id != null).map((r?: any) => [r.id, r]));
    for (const r of list(next)) {
        if (!r || r.id == null)
            continue;
        const old: any = before.get(r.id);
        if (!old && putBack(r))
            continue;
        if (!old || (old !== r && !sameRoutine(old, r)))
            stampEntry(old, r, now);
    }
    return next;
}
const sameEntry: any = (a?: any, b?: any) => JSON.stringify({ ...a, _ts: 0, _f: 0, _u: 0 }) === JSON.stringify({ ...b, _ts: 0, _f: 0, _u: 0 });
/**
 * Stamps `_ts` on every custom exercise of `next` that is new or differs from its version in
 * `prev`, the way stampRoutines does for a plan — the edit time mergeStates needs to keep the
 * version edited last. The store runs it on every change (useStore update). Mutates and returns
 * `next`.
 */
export function stampCustomEx(prev: any = [], next: any = [], now: any = Date.now()) {
    const before: any = new Map(list(prev).filter((c?: any) => c?.id != null).map((c?: any) => [c.id, c]));
    for (const c of list(next)) {
        if (!c || typeof c !== 'object' || c.id == null)
            continue;
        const old: any = before.get(c.id);
        if (!old || (old !== c && !sameEntry(old, c)))
            stampEntry(old, c, now);
    }
    return next;
}
/** stampCustomEx for any list of entries with ids: equipment profiles, gym cards. */
export function stampEntries(prev: any = [], next: any = [], now: any = Date.now()) { return stampCustomEx(prev, next, now); }
// What `local` holds that `server` does not: the workouts and weigh-ins a device logged while it
// was signed out, and the custom exercises they use. Sign-in asks about these before the server's
// profile replaces the local copy; zero of each means there is nothing to ask about.
// A weigh-in on a day the server has one too counts when it differs and was entered later — the
// one "Add them" keeps (mergeBodyweight). Counted only on days the server lacked, a weigh-in
// made on the phone on a day the profile already had one was dropped without the question ever
// being asked. Weights are compared in the server's unit.
export function localExtras(local?: any, server?: any) {
    const have: any = new Set(list(server?.workouts).map(workoutKey));
    const days: any = new Map(list(server?.bodyweight).filter((e?: any) => e && e.d != null).map((e?: any) => [e.d, e]));
    const ex: any = new Set(list(server?.customEx).map((e?: any) => e?.id));
    const from: any = unitOf(local), to: any = unitOf(server);
    const differs: any = (mine?: any, theirs?: any) => (Number(mine.t) || 0) > (Number(theirs.t) || 0) && Number(convertBodyWeight(mine.w, from, to)) !== Number(theirs.w);
    // Routines, and the rest of what a device sets up (plan days, exercise notes, gym cards,
    // equipment profiles), count too: a guest who only built a plan was never asked, and signing in
    // dropped it. Present only when there are any.
    const ids: any = (f?: any) => new Set(list(server?.[f]).map((x?: any) => x?.id));
    const routines: any = list(local?.routines).filter((r?: any) => r && r.id != null && !ids('routines').has(r.id)).length;
    const keysNew: any = (f?: any) => Object.entries(isMap(local?.[f]) ? local[f] : {})
        .filter(([k, v]: any) => v != null && !(Array.isArray(v) && !v.length) && !(isMap(server?.[f]) && k in server[f])).length;
    const measured: any = new Set(list(server?.measurements).map((e?: any) => e?.d));
    const setup: any = ['gymCards', 'equipProfiles'].reduce((n?: any, f?: any) => n + list(local?.[f]).filter((x?: any) => x && x.id != null && !ids(f).has(x.id)).length, 0) +
        list(local?.measurements).filter((e?: any) => e && e.d != null && !measured.has(e.d)).length +
        Object.entries(isMap(local?.dayNotes) ? local.dayNotes : {}).filter(([k, v]: any) => readNote(v) && !readNote(server?.dayNotes?.[k])).length +
        keysNew('week') + keysNew('dayPlan') + keysNew('exNotes') + keysNew('exAliases');
    return {
        workouts: list(local?.workouts).filter((w?: any) => !have.has(workoutKey(w))).length,
        bodyweight: list(local?.bodyweight).filter((e?: any) => e && e.d != null && (!days.has(e.d) || differs(e, days.get(e.d)))).length,
        customEx: list(local?.customEx).filter((e?: any) => e && !ex.has(e.id)).length,
        ...(routines ? { routines } : {}),
        ...(setup ? { setup } : {}),
    };
}
