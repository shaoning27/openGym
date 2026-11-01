// Legacy dynamic types are explicit during the full language migration.
import { metricEntriesForExercise, metricRowsForEntry, bestWeightForEntry, completedRepsOf, modeOf, workoutAt, countsWarmups } from './history.ts';
import { completedVolumeOf, isWarmupRow } from './workout-model.ts';
import { bestSetOf } from './onerm.ts';
import { beatsWeight } from './exercises.ts';
import { currentDbLoad, historyAs, volumeFactor, workoutAs } from './dumbbells.ts';
// One exercise's past, read back for the history sheet (issue #43): a chart series and the
// last few sessions, derived in a single pass over the log so the sheet can memoise the
// result and never rescan on a re-render.
//
// The chart plots ONE number per session, chosen the way Stats does it:
//   reps   — the heaviest completed work set (metric 'weight'); an exercise never loaded
//            (pull-ups, push-ups) plots its best rep count instead (metric 'reps'), because
//            that is the thing improving
//   time   — the longest completed hold, in seconds (metric 'sec')
//   cardio — the minutes logged that session (metric 'min')
// The mode is the one the exercise was logged in most recently; a session logged in another
// mode still appears in the list (its sets are labelled by their own target) but gets no point
// and no value, so the curve never mixes seconds with kilos.
//
// Warm-up rows are excluded from every number here, as everywhere else, except a session's
// volume when the profile counts warm-ups in it (#719).
export const HISTORY_SESSIONS: any = 10;
// Volume of the exercise in one session: main set plus its drops/bursts, reps mode only —
// there is no honest tonnage for a hold or a run.
// A dumbbell entry logged per bell counts both bells (lib/dumbbells.ts volumeFactor).
const entryVolume: any = (rows?: any, en?: any) => rows.reduce((v?: any, s?: any) => v + completedVolumeOf(s), 0) * volumeFactor(en);
export function exerciseHistory(S?: any, exId?: any, { limit = HISTORY_SESSIONS }: any = {}) {
    // Dumbbell weights are read in the exercise's current meaning (lib/dumbbells.ts), so the curve,
    // the best and the sessions compare like with like after a switch between each and total.
    const workouts: any = historyAs(S, exId, currentDbLoad(S, exId))?.workouts || [];
    // Chronological pairs of (workout, entry); the sort covers backfilled sessions, which are
    // inserted by date rather than appended.
    const logged: any = [];
    workouts.forEach((w?: any) => {
        // A combined session can contain the same exercise more than once. Keep one dated
        // snapshot, but read every completed occurrence that shares the session's latest mode.
        const entries: any = metricEntriesForExercise(w, exId);
        if (!entries.length)
            return;
        const mode: any = entries.at(-1).mode;
        const sameMode: any = entries.filter((item?: any) => item.mode === mode);
        const rows: any = sameMode.flatMap((item?: any) => item.rows);
        const en: any = { ...sameMode.at(-1).entry, sets: rows };
        // Its done warm-ups, only ever added to the session's volume and only when the profile
        // counts them (#719): the sets, the best and the curve stay work sets.
        const warm: any = countsWarmups(S) ? sameMode.flatMap((item?: any) => (item.entry.sets || []).filter(isWarmupRow)) : [];
        if (rows.length)
            logged.push({ w, en, mode, rows, warm });
    });
    logged.sort((a?: any, b?: any) => workoutAt(a.w) - workoutAt(b.w));
    const empty: any = { mode: modeOf({ id: exId }), metric: 'weight', best: 0, prId: null, total: 0, sessions: [], points: [], e1rmPoints: [] };
    if (!logged.length)
        return empty;
    const mode: any = logged[logged.length - 1].mode;
    const repsOnly: any = mode === 'reps' && !logged.some((l?: any) => l.mode === 'reps' && bestWeightForEntry(l.en) > 0);
    const metric: any = mode === 'cardio' ? 'min' : mode === 'time' ? 'sec' : repsOnly ? 'reps' : 'weight';
    const valueOf: any = ({ en, rows }: any) => {
        if (metric === 'min')
            return rows.reduce((a?: any, s?: any) => a + (Number(s.min) || 0), 0);
        if (metric === 'sec')
            return Math.max(0, ...rows.map((s?: any) => Number(s.sec) || 0));
        if (metric === 'reps')
            return Math.max(0, ...rows.map(completedRepsOf));
        return bestWeightForEntry(en);
    };
    let best: any = 0, prId: any = null;
    const sessions: any = [], points: any = [], e1rmPoints: any = [];
    logged.forEach(({ w, en, mode: m, rows, warm }: any) => {
        const same: any = m === mode;
        const value: any = same ? valueOf({ en, rows }) : null;
        const e1rm: any = m === 'reps' ? (bestSetOf(en)?.est ?? null) : null;
        const t: any = workoutAt(w);
        // "PR" goes on the session that first reached the all-time best, not on every session
        // that later matched it — one marker says where the record was set.
        if (value != null && value > best) {
            best = value;
            prId = w.id;
        }
        if (value != null && value > 0)
            points.push({ t, d: w.d, y: value, e1rm });
        if (e1rm != null)
            e1rmPoints.push({ t, d: w.d, y: e1rm });
        sessions.push({
            id: w.id, d: w.d, t, mode: m, target: en.target || null, sets: rows, value, e1rm,
            volume: m === 'reps' ? entryVolume(warm.length ? [...warm, ...rows] : rows, en) : null,
        });
    });
    // The "first reached" rule only holds for records above zero: a bodyweight session with
    // no weight logged is not a PR of anything.
    if (best <= 0)
        prId = null;
    return {
        mode, metric, best, prId, total: sessions.length,
        sessions: sessions.slice(-limit).reverse().map((s?: any) => ({ ...s, pr: s.id === prId })),
        points, e1rmPoints,
    };
}
/**
 * The best set ever logged of an exercise, for the "Best set" reference on the workout card
 * (#173) — the answer to "last time was a bad day, what can I actually do". It is the heaviest
 * completed work set, and of equally heavy ones the one with the most reps: the same "heaviest"
 * the Best chip and a PR mean, which on an assistance machine is the least help. A timed exercise
 * compares holds, then their load; cardio compares minutes, then speed. An exercise never loaded
 * (pull-ups) comes down to its reps that way.
 *
 * Unlike "Last time" this looks across every routine: a record belongs to the exercise, not to
 * the slot it was set in. Only sets logged in `mode` count, so a hold is never measured against
 * a rep set. A tie keeps the first time it was reached, as the PR marker does.
 * `as` reads dumbbell weights in that meaning (lib/dumbbells.ts): the session's own, so a past
 * "40 total" is held against today's sets as the "20 each" it was.
 * Returns { d, set, target } or null.
 */
export function bestSetFor(S?: any, exId?: any, mode: any = modeOf({ id: exId }), as?: any) {
    const keys: any = (s?: any) => mode === 'cardio' ? [Number(s.min) || 0, Number(s.speed) || 0]
        : mode === 'time' ? [Number(s.sec) || 0, Number(s.w) || 0]
            : [Number(s.w) || 0, Number(s.r) || 0];
    const better: any = (a?: any, b?: any) => {
        const [a1, a2]: any = keys(a), [b1, b2]: any = keys(b);
        if (a1 !== b1)
            return mode === 'reps' ? beatsWeight(exId, a1, b1) : a1 > b1;
        return a2 > b2;
    };
    // One pass over the history as it is stored, with no copy and no sort: this runs on every
    // render of every exercise card while the line shows the best set, and every stepper tap
    // re-renders them all, so sorting a long imported history each time was the cost of a tap.
    // Stored order is not always the order things happened in (a moved session keeps its place
    // until it is filed again), so a tie is settled by the start time, not by which came first
    // in the array; within one session the set logged first keeps it.
    let best: any = null;
    for (const stored of S?.workouts || []) {
        const w: any = as ? workoutAs(stored, exId, as) : stored;
        let t: any = null;
        for (const en of w.entries || []) {
            if (en.id !== exId)
                continue;
            for (const set of metricRowsForEntry(en, mode)) {
                t ??= workoutAt(w);
                if (!best || better(set, best.set) || (!better(best.set, set) && t < best.t))
                    best = { d: w.d, set, target: en.target || null, t };
            }
        }
    }
    return best && { d: best.d, set: best.set, target: best.target };
}
