// Legacy dynamic types are explicit during the full language migration.
import { uid } from './format.ts';
import { modeOf, defaultConfig, isPerSide, entryRoutineId, setsFromRows } from './history.ts';
import { isSideSet, isWarmupRow, hasCompletedWork, modeForEntry } from './workout-model.ts';
// A saved workout is evidence of what was logged, not a live routine. Copy only its flat
// exercise setup on this explicit action; finishing a workout never calls this helper.
const sessionEntries: any = (session?: any) => Array.isArray(session?.entries) ? session.entries : [];
function groupIds(ex?: any) {
    const next: any = ex.map((entry?: any) => ({ ...entry }));
    let i: any = 0;
    while (i < next.length) {
        const raw: any = next[i].sg;
        if (raw == null || raw === '') {
            delete next[i].sg;
            i++;
            continue;
        }
        const start: any = i;
        while (i + 1 < next.length && next[i + 1].sg === raw)
            i++;
        const end: any = i;
        if (end === start)
            delete next[start].sg;
        else {
            const mapped: any = `sg-${uid()}`;
            for (let j: any = start; j <= end; j++)
                next[j].sg = mapped;
        }
        i++;
    }
    return next;
}
const scalarGroup: any = (value?: any) => {
    if (typeof value !== 'string' && typeof value !== 'number')
        return null;
    const text: any = String(value);
    return text ? text : null;
};
const finite: any = (value?: any) => Number.isFinite(Number(value)) ? Number(value) : null;
const positive: any = (value?: any) => {
    const n: any = finite(value);
    return n != null && n > 0 ? n : null;
};
// A flat per-side routine stores the total across both limbs. makeSideSet() then splits that
// total into two equal planned sides, so an odd/asymmetric logged total is rounded to the nearest
// representable even total. The copy keeps the target when only one limb was completed: a flat
// routine cannot encode partial completion or two different side prescriptions.
function perSideReps(row?: any, target?: any) {
    if (!isSideSet(row))
        return positive(row?.r);
    const done: any = ['L', 'R'].filter((key?: any) => row.sides[key]?.done === true);
    if (done.length === 1)
        return evenTotal(target?.reps) ?? evenTotal(row.sides[done[0]]?.r);
    if (done.length < 2)
        return null;
    return evenTotal(done.reduce((total?: any, key?: any) => total + (positive(row.sides[key]?.r) || 0), 0));
}
function evenTotal(value?: any) {
    const n: any = positive(value);
    return n == null ? null : Math.max(2, 2 * Math.round(n / 2));
}
function perSideWeight(row?: any) {
    if (!isSideSet(row))
        return finite(row?.w);
    const done: any = ['L', 'R'].filter((key?: any) => row.sides[key]?.done === true);
    const weights: any = done.map((key?: any) => finite(row.sides[key]?.w)).filter((value?: any) => value != null);
    return weights.length ? Math.max(...weights) : null;
}
function copiedEntry(entry?: any, source?: any) {
    const rows: any = Array.isArray(entry?.sets) ? entry.sets : [];
    const work: any = rows.filter((row?: any) => !isWarmupRow(row));
    // A saved entry can retain planned rows after an early finish. Match history.ts lastEntryFor:
    // only a fully completed work row may seed the copied target. A partially checked per-side row
    // is still retained by buildCompletedWorkout, but its two-limb state cannot fit a flat routine.
    const row: any = work.filter((candidate?: any) => candidate?.done === true).at(-1) || null;
    const target: any = entry?.target && typeof entry.target === 'object'
        ? structuredClone(entry.target)
        : {};
    // Copy the mode that was logged, even if the catalogue's default has since changed (#678).
    const defaults: any = defaultConfig(entry?.id, modeForEntry(entry, modeOf({ ...target, id: entry?.id })));
    const cfg: any = { ...defaults, ...target, id: entry?.id, sets: Math.max(1, setsFromRows({ ...defaults, ...target }, work.length) || 1), warmupSets: rows.filter(isWarmupRow).length };
    const mode: any = modeOf(cfg);
    if (mode === 'time' && row)
        Object.assign(cfg, { sec: row.sec ?? cfg.sec, weight: row.w ?? cfg.weight ?? 0 });
    else if (mode === 'cardio' && row)
        Object.assign(cfg, { min: row.min ?? cfg.min, speed: row.speed ?? cfg.speed });
    else if (mode === 'reps') {
        const reps: any = row && isPerSide(cfg) ? perSideReps(row, cfg) : positive(row?.r);
        if (reps != null)
            cfg.reps = reps;
        if (row) {
            const weight: any = perSideWeight(row);
            if (weight != null)
                cfg.weight = weight;
        }
        if (isPerSide(cfg) && row == null)
            cfg.reps = evenTotal(cfg.reps) ?? cfg.reps;
    }
    // A planned entry says what its routine asked for (`planned`, session-start.ts), and the plan
    // owns a planned session's sets and reps. Today's target is the prescription and the rows are
    // what was done with it: a double-progression aim inside the range, a set the bodyweight
    // ceiling added, a bonus set, or reps carried over from last time. Copied as the new plan,
    // each of those reads as an edited plan on the copy's first session (nextPrescription):
    // "Plan changed", a range narrowed to the reps of one day, the climb started again. The copy
    // takes the plan's sets and reps instead, so it continues from where the source routine
    // stands. The weight is still the one lifted — history decides it either way.
    const planned: any = entry?.planned && typeof entry.planned === 'object' ? entry.planned : null;
    if (planned) {
        cfg.sets = Math.max(1, positive(planned.sets) || 1);
        if (mode === 'reps' && positive(planned.reps) != null) {
            cfg.reps = planned.reps;
            // A plan with no range has no bottom to keep, whatever the target carried.
            if (positive(planned.repsMin) != null)
                cfg.repsMin = planned.repsMin;
            else
                delete cfg.repsMin;
        }
        if (mode === 'time' && positive(planned.sec) != null)
            cfg.sec = planned.sec;
    }
    // A rule set on the source routine rather than on the exercise decides how the plan is read:
    // a range is a double-progression aim there and a flat target under the default. A copy
    // without it would open 3 × 8–12 at 12. Each exercise keeps its own routine's rule, since a
    // combined session can hold routines that progress differently.
    if (!cfg.prog && typeof source?.prog === 'string' && source.prog)
        cfg.prog = source.prog;
    // buildCompletedWorkout carries setup.sg inside target, while older records may carry it on
    // the entry. Keep either form, but never copy session-only ownership fields such as rid.
    const sg: any = scalarGroup(entry?.sg ?? target.sg);
    if (sg)
        cfg.sg = sg;
    else
        delete cfg.sg;
    // What a session stamps on its entries describes that session, not a plan. None of it belongs
    // in a routine: a copied `planned` or `rid` would tell the next session it had been built from
    // another plan or another routine.
    for (const key of SESSION_ONLY)
        delete cfg[key];
    return cfg;
}
// `rowReps` is one session's per-set aim under triple progression (progression.ts), not a plan.
const SESSION_ONLY: any = ['planned', 'plan', 'carried', 'rid', 'noProg', 'muscleSnapshot', 'rowReps'];
// `routines` are the ones the session was built from, when they still exist: the rule each copied
// exercise is read under comes from there (see copiedEntry).
export function routineFromSession(session?: any, name: any = session?.name, routines: any = []) {
    const byId: any = new Map((Array.isArray(routines) ? routines : []).filter((r?: any) => r?.id != null).map((r?: any) => [r.id, r]));
    const ex: any = groupIds(sessionEntries(session).filter((entry?: any) => entry?.sets?.length)
        .map((entry?: any) => copiedEntry(entry, byId.get(entryRoutineId(session, entry)))));
    if (!ex.length)
        throw new Error('no exercises');
    return { id: uid(), name: String(name || 'Workout').trim() || 'Workout', ex };
}
export function saveSessionAsRoutine(state?: any, session?: any, name?: any) {
    const routine: any = routineFromSession(session, name, state.routines);
    state.routines.push(routine);
    return routine.id;
}
// An exercise added in the middle of a routine's session (#592) is stamped `addedInSession` by
// the workout screen's Add exercise. Finishing offers to keep it in that routine for next time,
// once, on the summary; nothing is written unless that offer is taken (addToRoutine).
// One group per routine (a combined day can add to two), only exercises the routine does not
// have yet and that had a completed set: a skipped one was not part of the workout. A swap keeps
// its slot and is not an addition.
export function routineAdditions(active?: any, routines: any = []) {
    const groups: any = new Map();
    for (const entry of sessionEntries(active)) {
        if (entry?.addedInSession !== true || !entry.rid || !(entry.sets || []).some(hasCompletedWork))
            continue;
        const routine: any = (Array.isArray(routines) ? routines : []).find((r?: any) => r?.id === entry.rid);
        if (!routine || !Array.isArray(routine.ex) || routine.ex.some((x?: any) => x?.id === entry.id))
            continue;
        if (!groups.has(routine.id))
            groups.set(routine.id, { routine, entries: [] });
        const list: any = groups.get(routine.id).entries;
        if (!list.some((e?: any) => e.id === entry.id))
            list.push(entry);
    }
    // The setup copied the way Save as routine copies it (copiedEntry): sets, reps and weight as
    // done today, never what only described today's session.
    return [...groups.values()].map(({ routine, entries }: any) => ({
        routineId: routine.id, name: routine.name, ex: groupIds(entries.map((e?: any) => copiedEntry(e, routine))),
    }));
}
/** Append those exercises to the routine (a store draft), skipping any it has by now. Returns how many. */
export function addToRoutine(routine?: any, ex?: any) {
    if (!routine || !Array.isArray(routine.ex))
        return 0;
    const fresh: any = (Array.isArray(ex) ? ex : []).filter((cfg?: any) => cfg?.id != null && !routine.ex.some((x?: any) => x?.id === cfg.id));
    // groupIds again: a superset tag of the copies must not collide with one the routine has.
    routine.ex.push(...groupIds(fresh.map((cfg?: any) => structuredClone(cfg))));
    return fresh.length;
}
