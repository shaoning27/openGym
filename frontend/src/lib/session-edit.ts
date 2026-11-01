// Legacy dynamic types are explicit during the full language migration.
// Editing a workout that is already in history (#143): its exercises, sets and notes.
//
// The editor is the ordinary workout screen working on a copy in S.active (`editingWorkoutId`
// says whose), so a reload, a closed tab or an offline spell keeps the draft, and the saved
// record stays exactly as it was until Save. When the session happened — its day, start and
// length — is not edited here: WorkoutDetail has its own rows for that (lib/workout-date.ts).
//
// Save replaces the record by id. Getting that replacement onto every device is the sync's job,
// not this file's: the record is stamped with the time of the edit (stampWorkout), and a conflict
// between two copies keeps the version edited last (lib/sync-merge.ts). So the edit replaces the
// old copy wherever it is, is never joined by it as a duplicate, and an older copy cannot come
// back over it on a 409.
import { buildCompletedWorkout } from './finish-workout.ts';
import { beatsWeight } from './exercises.ts';
import { bestWeightForEntry, workoutVolume } from './history.ts';
import { hasCompletedWork } from './workout-model.ts';
import { stampWorkout } from './sync-merge.ts';
import { legacySyncKey, rebuildPrHistory } from './workout-date.ts';
const clone: any = (value?: any) => structuredClone(value);
const list: any = (v?: any) => (Array.isArray(v) ? v : []);
// Which record the editor works on. A workout logged before ids existed is keyed by its day and
// start, the way the sync keys it; Save freezes that key as its id (as a date move does), so the
// other device's untouched copy is still recognised as the same record.
const keyOf: any = (w?: any) => (w?.id != null ? w.id : legacySyncKey(w));
// The fields of the whole workout the editor can change — its note, its name (renamed, or derived
// again when a routine is added) and the body weight it was logged with — which the history can
// change too while the editor is open: WorkoutDetail writes the note, and a sync brings in what
// another device wrote. Save takes the draft's value only where the editor changed it, so an
// editor opened on an old note does not write that old note back over a newer one, or delete a
// note written meanwhile. The note is compared as the finish writes it, trimmed.
const SESSION_FIELDS: any = ['note', 'name', 'bw'];
const sessionField: any = (w?: any, k?: any) => (k === 'note' ? (w?.note || '').trim() : (w?.[k] ?? null));
// The same data whatever order its keys were written in. A key holding undefined is no key, as it
// is once the record is stored.
function sameData(a?: any, b?: any) {
    if (a === b)
        return true;
    if (!a || !b || typeof a !== 'object' || typeof b !== 'object' || Array.isArray(a) !== Array.isArray(b))
        return false;
    const keys: any = (o?: any) => Object.keys(o).filter((k?: any) => o[k] !== undefined);
    const ka: any = keys(a);
    return ka.length === keys(b).length && ka.every((k?: any) => sameData(a[k], b[k]));
}
// What Save would write, apart from what it works out again (the volume and the badges), the stamp
// and the id it freezes for a workout from before ids.
const DERIVED: any = ['id', 'vol', 'prs', '_ts'];
const savedData: any = (w?: any) => Object.fromEntries(Object.entries(w).filter(([k]: any) => !DERIVED.includes(k)));
// …compared the way the data reads, for asking whether closing loses anything: a record that never
// had `routineIds` or a `topW` (an import, a workout from an older build) holds nothing a Save
// would add beyond [] / null / the top set its sets already say. (Save itself still writes those.)
const comparable: any = (w?: any) => {
    const out: any = Object.fromEntries(Object.entries(savedData(w)).filter(([, v]: any) => v !== null && !(Array.isArray(v) && !v.length)));
    if (Array.isArray(out.entries))
        out.entries = out.entries.map((e?: any) => (e && typeof e === 'object' ? (({ topW, ...rest }: any) => rest)(e) : e));
    return out;
};
// The best load one workout logged for an exercise, across every occurrence of it.
function bestIn(workout?: any, id?: any) {
    let best: any = 0;
    for (const e of list(workout?.entries)) {
        if (e?.id !== id)
            continue;
        const w: any = bestWeightForEntry(e);
        if (beatsWeight(id, w, best))
            best = w;
    }
    return best;
}
// The kept working weight of an exercise is lowered only when it came from this session and the
// edit took it away — a typed 1000 corrected to 100, or deleted with the rest of the workout. Then
// it is the best set left in history, or gone. One confirmed anywhere else ("Tracked — next time
// starts at…") is left as it is. `saved` is the record after the edit, null once it is deleted.
function lowerKeptWeights(state?: any, ids?: any, current?: any, saved?: any) {
    for (const id of ids) {
        const kept: any = state.exWeights?.[id];
        const before: any = bestIn(current, id);
        if (!kept || !(kept.w > 0) || kept.w !== before || !beatsWeight(id, before, bestIn(saved, id)))
            continue;
        let best: any = null;
        for (const w of state.workouts) {
            const top: any = bestIn(w, id);
            if (beatsWeight(id, top, best?.w || 0))
                best = { w: top, d: w.d };
        }
        if (best)
            state.exWeights[id] = best;
        else
            delete state.exWeights[id];
    }
}
/**
 * Whether the editor holds nothing Save could keep: not one set ticked done. Save drops an
 * exercise without one (buildCompletedWorkout), so this draft would save as a workout with no
 * exercises in it — an empty row in the history that counts as a training day.
 */
export const editLeftEmpty: any = (active?: any) => !list(active?.entries).some((entry?: any) => list(entry?.sets).some(hasCompletedWork));
/**
 * Opens the editor on a saved workout: a copy of it becomes S.active. `ref` is the workout or its
 * id. Throws while another session is running, or when the workout is gone.
 */
export function editCompletedSession(state?: any, ref?: any) {
    if (state.active)
        throw new Error('Finish the current workout first.');
    const key: any = ref && typeof ref === 'object' ? keyOf(ref) : ref;
    const original: any = key == null ? null : list(state.workouts).find((w?: any) => keyOf(w) === key);
    if (!original)
        throw new Error('Workout deleted');
    const active: any = clone(original);
    active.cur = 0;
    active.editingWorkoutId = key;
    active.editBase = Object.fromEntries(SESSION_FIELDS.map((k?: any) => [k, sessionField(original, k)]));
    // A workout saved before exclusion moved onto the entries (ENG-11) carries only the whole-workout
    // flag. The editor rebuilds that flag from the entries (buildCompletedWorkout), so it is written
    // onto each of them here, the way a session starts since: the edited workout stays out of
    // progression, and a swap in the editor keeps its replacement out too. A workout out as a whole
    // opens with the header's "Don't count for progression" on (lib/session-noprog.ts), so it can
    // be switched off there, and an exercise added in the editor stays out with the rest.
    if (original.excludeFromProgression === true) {
        for (const entry of list(active.entries))
            if (entry && entry.noProg !== true)
                entry.noProg = true;
        active.noProg = true;
    }
    // Worked out again on Save, from the edited sets.
    for (const k of ['vol', 'prs', '_ts'])
        delete active[k];
    // The workout's photos and videos are not the editor's: they stay on the saved record, which
    // Save spreads under the edit, and the detail sheet adds or removes them there meanwhile.
    delete active.media;
    state.active = active;
    return active;
}
/**
 * Saves the editor into history and closes it. Returns the saved record.
 *
 * The record is the one history holds now, not the one the editor opened: another device may have
 * moved it or corrected its note meanwhile, and what the editor does not edit stays as that left
 * it — the note and the name too, unless the editor changed them itself. The sets are the
 * editor's — the edit saved last wins, as it does between devices. A record deleted meanwhile
 * (the deletion already reached this device) is not brought back behind the person's back: Save
 * throws, and the draft stays open to keep editing or drop.
 */
export function saveWorkoutEdit(state?: any, now: any = Date.now()) {
    const active: any = state.active;
    const key: any = active?.editingWorkoutId;
    const index: any = key == null ? -1 : list(state.workouts).findIndex((w?: any) => keyOf(w) === key);
    if (index < 0)
        throw new Error('This workout was deleted on another device. Your edits are still here.');
    // Never saved empty: the editor asks to delete the workout instead (deleteEditedWorkout).
    if (editLeftEmpty(active))
        throw new Error('Nothing logged yet');
    const current: any = state.workouts[index];
    const record: any = draftRecord(active, current, key);
    // A Save that changed nothing closes the editor and leaves the record as it is. A new stamp
    // would outrank an edit another device made since and has not synced yet (sets added on the
    // phone), for nothing — the date and duration rows skip an unchanged save the same way.
    if (sameData(savedData(record), savedData(current))) {
        state.active = null;
        return current;
    }
    record.vol = workoutVolume(record);
    stampWorkout(record, now);
    state.workouts[index] = record;
    // Badges are a claim about the sessions before each one. The edited session can earn one it now
    // leads with, and a later one loses its own if the edit raised the bar above it — the same
    // asymmetric rule a date move follows, so imported history never sprouts trophies.
    const touched: any = [...new Set([...list(current.entries), ...record.entries].map((e?: any) => e?.id).filter((id?: any) => id != null))];
    state.workouts = rebuildPrHistory(state.workouts, touched, record);
    const saved: any = state.workouts.find((w?: any) => keyOf(w) === key);
    lowerKeptWeights(state, touched, current, saved);
    state.active = null;
    return saved;
}
/**
 * Whether closing the editor would lose nothing: Save would write the record exactly as history
 * holds it. Closing then just closes — asking "Save workout changes?" about a workout nobody
 * touched (QA 1.3.9) made every look at a past session end in a question. A record deleted
 * meanwhile, or a draft left empty, is a change: those still ask.
 */
export function editChangesNothing(state?: any) {
    const active: any = state?.active;
    const key: any = active?.editingWorkoutId;
    if (key == null || editLeftEmpty(active))
        return false;
    const current: any = list(state.workouts).find((w?: any) => keyOf(w) === key);
    if (!current)
        return false;
    return sameData(comparable(draftRecord(active, current, key)), comparable(current));
}
// The record Save would write for this draft over `current`, before its volume and stamp.
function draftRecord(active?: any, current?: any, key?: any) {
    const updated: any = buildCompletedWorkout(active, {
        end: current.end,
        prs: current.prs || [],
        snapshotFor: (entry?: any) => entry.muscleSnapshot,
    });
    // Carry occurrence metadata opaquely, by order rather than exercise id: the same exercise may
    // appear twice. Canonical completed-entry fields win, while live-only prescription data (the
    // plan's explanation, the "carried over" marker) stays out of history as it does after an
    // ordinary workout.
    const logged: any = active.entries.filter((entry?: any) => entry.sets.some(hasCompletedWork));
    updated.entries = updated.entries.map((entry?: any, i?: any) => {
        const merged: any = { ...clone(logged[i]), ...entry };
        delete merged.plan;
        delete merged.carried;
        for (const k of ['note', 'notePin', 'noProg', 'muscleSnapshot', 'rid', 'planned'])
            if (!(k in entry))
                delete merged[k];
        return merged;
    });
    const record: any = { ...current, ...updated, id: key, d: current.d, start: current.start, end: current.end };
    if (!('excludeFromProgression' in updated))
        delete record.excludeFromProgression;
    const base: any = active.editBase;
    for (const k of SESSION_FIELDS) {
        // A draft from before `editBase` existed has nothing to compare with, and keeps the editor's.
        const edited: any = !base || sessionField(updated, k) !== base[k];
        const value: any = edited ? sessionField(updated, k) : current[k];
        if (value == null || value === '')
            delete record[k];
        else
            record[k] = value;
    }
    return record;
}
/** The saved record the editor is open on, as history holds it now — or null (none open, or it
 *  was deleted meanwhile). */
export function editedRecord(state?: any) {
    const key: any = state?.active?.editingWorkoutId;
    return key == null ? null : list(state.workouts).find((w?: any) => keyOf(w) === key) || null;
}
/**
 * Deletes the workout the editor is open on and closes the editor: what an edit that took out
 * every set gets instead of Save (editLeftEmpty). The record is found the way Save finds it, and
 * goes the way History's Delete takes it out; a kept working weight that came from it is lowered
 * the way Save lowers one an edit took away. A record another device deleted meanwhile is already
 * gone, and the editor just closes. Returns whether a record was removed.
 */
export function deleteEditedWorkout(state?: any) {
    const current: any = editedRecord(state);
    state.active = null;
    if (!current)
        return false;
    state.workouts = state.workouts.filter((w?: any) => w !== current);
    lowerKeptWeights(state, [...new Set(list(current.entries).map((e?: any) => e?.id).filter((id?: any) => id != null))], current, null);
    return true;
}
