// Legacy dynamic types are explicit during the full language migration.
// Moving a workout that is already in history to another date or start time.
//
// Nothing about what was lifted changes here: the sets, the volume and the notes are the
// record. What changes is when it happened — which means the history has to be re-filed in
// date order, the session has to keep the length it had, and the PR badges have to be
// re-derived, because "this was a personal record" is a claim about what came before it.
//
// Kept pure and separate from backfill.ts (which is about logging a session that never
// existed) so the date arithmetic and the badge surgery are testable without the UI.
import { insertChronological, backfillStart } from './backfill.ts';
import { bestWeightForEntry } from './history.ts';
import { beatsWeight } from './exercises.ts';
import { stampWorkout } from './sync-merge.ts';
// Before ids existed a workout was keyed for sync by its day and start time
// (`workoutKey` in sync-merge.ts). That is exactly what this edit changes, so moving such a
// record would give it a new key and the other device's untouched copy would come back from
// the merge as a second workout. Freezing the old key as the id keeps both sides agreeing on
// which record this is, and the union-by-id then lets the newer copy win.
export const legacySyncKey: any = (w?: any) => `${w?.d}|${w?.start}`;
// `<input type="time">` wants the wall-clock start in the browser's zone — the same zone
// backfillStart() writes it in, so this round-trips.
export const startTimeOf: any = (w?: any) => {
    const d: any = new Date(w?.start || 0);
    const pad: any = (n?: any) => String(n).padStart(2, '0');
    return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
};
// Which workout an edit is about. Ids are the identity everywhere else, but a legacy record
// has none and `x.id === undefined` would happily match the wrong one, so it is compared by the
// key the sync gives it (`workoutKey` in sync-merge.ts). That is also what a move or an edit
// freezes as its id — so a sheet still holding the copy from before that (the detail sheet, when
// a sync brings the frozen record in while it is open) still finds its workout.
const syncKeyOf: any = (w?: any) => (w?.id != null ? w.id : legacySyncKey(w));
export const sameWorkout: any = (a?: any, b?: any) => syncKeyOf(a) === syncKeyOf(b);
// The workout as it is after the move: same session, new position in time. The duration is
// carried rather than recomputed, so a session that ran 47 minutes still ran 47 minutes.
export function retimeWorkout(w?: any, iso?: any, time?: any) {
    const duration: any = Math.max(0, (w.end ?? w.start) - w.start);
    const start: any = backfillStart(iso, time);
    const moved: any = { ...w, d: iso, start, end: start + duration };
    if (w.id == null)
        moved.id = legacySyncKey(w);
    return moved;
}
// `prs` is written once, at finish, against the all-time best (bestWeightFor) — which reads as
// chronological only because history normally grows forwards. Once a session moves, a badge it
// was given may no longer be true.
//
// The rule is deliberately asymmetric: a move can take a badge away from any session whose
// claim the new order breaks, but only the session that moved can gain one. Imported and
// backfilled history is filed with `prs: []` for every session on purpose, so awarding badges
// by pure chronology would make a year of imported workouts sprout trophies the user never
// earned the first time one date was nudged. Revoking a claim the order has falsified is a
// correction; handing out new ones is an invention.
//
// Only `exerciseIds` are reconsidered — every other badge in history is left exactly as it was.
export function rebuildPrHistory(workouts?: any, exerciseIds?: any, moved: any = null) {
    const ids: any = new Set(exerciseIds || []);
    if (!ids.size)
        return workouts;
    const best: any = new Map();
    return workouts.map((w?: any) => {
        const had: any = w.prs || [];
        const kept: any = [];
        let trains: any = false;
        for (const e of w.entries || []) {
            if (!ids.has(e.id))
                continue;
            trains = true;
            const top: any = bestWeightForEntry(e);
            // Leads everything dated before it. The running best grows whether or not a badge is
            // written, so a session that cannot gain one still raises the bar for the next. "Leads"
            // is the finish sheet's own test (beatsWeight): on an assistance machine the record is the
            // least help, so there a lighter load leads (issue #232).
            const leads: any = beatsWeight(e.id, top, best.get(e.id) || 0);
            if (leads)
                best.set(e.id, top);
            if (leads && (w === moved || had.includes(e.id)))
                kept.push(e.id);
        }
        if (!trains)
            return w;
        const prs: any = [...new Set([...had.filter((id?: any) => !ids.has(id)), ...kept])];
        if (prs.length === had.length && prs.every((id?: any, i?: any) => id === had[i]))
            return w;
        return { ...w, prs };
    });
}
// The history after a workout has been moved: the old copy is gone, the moved one sits where
// its new date and start time put it, and every exercise it touches has its badges rebuilt.
// Returns the new array, or `null` when there is nothing to move. The caller stores it.
//
// The moved workout carries the time of the move (stampWorkout): a conflict with a copy that
// still holds it where it was keeps the version edited last, not whichever copy is newer as a
// whole — a phone that logged a weigh-in since would otherwise put it back.
export function moveWorkout(workouts?: any, ref?: any, iso?: any, time?: any, now: any = Date.now()) {
    const list: any = Array.isArray(workouts) ? workouts : [];
    const current: any = list.find((w?: any) => sameWorkout(w, ref));
    if (!current)
        return null;
    const moved: any = stampWorkout(retimeWorkout(current, iso, time), now);
    const filed: any = insertChronological(list.filter((w?: any) => w !== current), moved);
    return rebuildPrHistory(filed, (current.entries || []).map((e?: any) => e.id), moved);
}
// The longest a session can be said to have run: a day. Past that it is a typo (99999 read as
// 1666 hours), and a session ending weeks from now throws off every stat that sums time.
export const MAX_DURATION_MIN: any = 24 * 60;
// Whether a session started on `iso` at `time` and running `minutes` would still be going on at
// `now`. Today's date with a later time passed the date check and filed the workout hours ahead.
export const endsInFuture: any = (iso?: any, time?: any, minutes?: any, now: any = Date.now()) => backfillStart(iso, time) + Math.max(0, Number(minutes) || 0) * 60000 > now;
// How long a saved session ran, in whole minutes — what the duration row starts from. At least a
// minute, the way a logged past session is at least one (backfillEnd).
export const durationMinOf: any = (w?: any) => Math.max(1, Math.round(Math.max(0, (w?.end ?? w?.start ?? 0) - (w?.start ?? 0)) / 60000));
// The history after a session's length is corrected — the workout nobody ended until they got
// home, and that now reads three hours. The start stays where it was and the end follows it;
// nothing else changes, since neither the order of history nor any badge depends on the length.
// Stamped like every edit of a saved workout (stampWorkout), for a conflict to keep it. Returns
// the new array, or `null` when the workout is not there or already runs that long.
export function setWorkoutDuration(workouts?: any, ref?: any, minutes?: any, now: any = Date.now()) {
    const list: any = Array.isArray(workouts) ? workouts : [];
    const current: any = list.find((w?: any) => sameWorkout(w, ref));
    const min: any = Math.min(MAX_DURATION_MIN, Math.max(1, Math.round(Number(minutes) || 0)));
    if (!current || !Number.isFinite(current.start) || (current.end != null && min === durationMinOf(current)))
        return null;
    // A record from before ids is keyed by its day and start, and neither moves here.
    const edited: any = stampWorkout({ ...current, end: current.start + min * 60000 }, now);
    return list.map((w?: any) => (w === current ? edited : w));
}
