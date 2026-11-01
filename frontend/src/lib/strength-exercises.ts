// Legacy dynamic types are explicit during the full language migration.
// Per-exercise rows for the Strength view: best estimated 1RM from the user's own logged
// sets, the exercise's OWN retained-strength decay (same 14-day plateau / 28-day half-life
// / 0.5 floor model as the muscle map, applied to the exercise's last done work set), and
// the expected CURRENT 1RM (= estimate x decay). The body map keeps the per-muscle model;
// the exercise list deliberately reads per-exercise, so an old exercise shows its own
// decline even when its muscle is kept fresh by other work. Muscle mapping is
// catalogue-first (EXIDX), exactly like the fatigue/strength maps, falling back to the
// logged snapshot (muscleWeights) for exercises no longer in the catalogue.
import { best1RM } from './onerm.ts';
import { entriesForExercise, workoutAt } from './history.ts';
import { STRENGTH_FULL_MS, STRENGTH_HALF_LIFE_MS, STRENGTH_FLOOR, halfLifeDecay } from './recovery.ts';
import { musclesOf } from './muscles.ts';
import { EXIDX } from './exercises.ts';
import { hasCompletedWork, isWarmupRow } from './workout-model.ts';
import { exerciseNameFor } from './i18n-core.ts';
const round1: any = (value?: any) => Math.round(value * 10) / 10;
// Same retained-strength curve the muscle map uses, applied to one exercise's age.
function strengthFromAge(ageMs?: any) {
    if (!Number.isFinite(ageMs) || ageMs < 0)
        return STRENGTH_FLOOR;
    if (ageMs <= STRENGTH_FULL_MS)
        return 1;
    return Math.max(STRENGTH_FLOOR, halfLifeDecay(ageMs - STRENGTH_FULL_MS, STRENGTH_HALF_LIFE_MS));
}
// Timestamp of the exercise's latest completed WORK set (warm-ups excluded - they are prep,
// not stimulus, and the strength model is built on effective work).
function lastWorkSetAt(S?: any, id?: any) {
    let latest: any = -Infinity;
    for (const workout of S?.workouts || []) {
        const ts: any = workoutAt(workout);
        if (!Number.isFinite(ts) || ts <= latest)
            continue;
        const entries: any = entriesForExercise(workout, id);
        if (entries.some((entry?: any) => (entry.sets || []).some((s?: any) => hasCompletedWork(s) && !isWarmupRow(s))))
            latest = ts;
    }
    return Number.isFinite(latest) ? latest : null;
}
function snapshotWeights(entry?: any) {
    const catalogue: any = entry && typeof entry === 'object' ? EXIDX[entry.id] : null;
    if (catalogue)
        return musclesOf(catalogue);
    const direct: any = entry && typeof entry === 'object'
        ? (entry.muscleWeights || entry.muscleSnapshot?.muscleWeights)
        : null;
    if (direct && typeof direct === 'object' && !Array.isArray(direct) && Object.keys(direct).length) {
        return Object.fromEntries(Object.entries(direct).filter(([, value]: any) => {
            const weight: any = Number(value);
            return Number.isFinite(weight) && weight > 0;
        }));
    }
    return musclesOf(entry);
}
// Highest-weight muscle of an exercise - used for the primary/secondary badge and the
// per-muscle link, not for the decay (the exercise's own decay is what the row shows).
export function primaryMuscleOf(entry?: any) {
    const weights: any = snapshotWeights(entry);
    let best: any = null;
    for (const [slug, weight] of Object.entries(weights)) {
        if (!best || (weight as any) > best.weight)
            best = { slug, weight };
    }
    return best;
}
function resolvedExerciseName(entry?: any) {
    // Imported history often has no name snapshot (entries are { id, sets, topW }) - the
    // catalogue (or the registered custom) is the canonical name source.
    const ex: any = entry && typeof entry === 'object' ? EXIDX[entry.id] : null;
    if (ex?.n)
        return exerciseNameFor(ex);
    if (entry?.muscleSnapshot?.n)
        return entry.muscleSnapshot.n;
    return entry && typeof entry === 'object' && entry.n ? entry.n : null;
}
function workoutDay(workout?: any) {
    const day: any = workout?.d;
    return typeof day === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(day) ? day : null;
}
function entriesWithId(S?: any, id?: any) {
    let order: any = 0;
    return (S?.workouts || []).flatMap((workout?: any) => entriesForExercise(workout, id).map((entry?: any) => ({
        entry,
        day: workoutDay(workout),
        // -Infinity, not NaN: isNewerOccurrence compares these with `!==` then `>`, and a NaN pair
        // would answer "not equal, not greater" instead of falling through to insertion order.
        timestamp: Number.isFinite(workoutAt(workout)) ? workoutAt(workout) : -Infinity,
        order: order++,
    })));
}
const hasSavedMetadata: any = (entry?: any) => Boolean(entry?.n
    || (entry?.muscleWeights && Object.keys(entry.muscleWeights).length)
    || (entry?.muscleSnapshot && Object.keys(entry.muscleSnapshot).length));
function isNewerOccurrence(a?: any, b?: any) {
    if (!b)
        return true;
    if (a.day && b.day && a.day !== b.day)
        return a.day > b.day;
    if (a.day !== b.day)
        return !!a.day;
    if (a.timestamp !== b.timestamp)
        return a.timestamp > b.timestamp;
    return a.order > b.order;
}
// Use the latest dated occurrence that carries a snapshot for display metadata, while keeping
// the latest dated occurrence as a fallback for old history. The catalogue still wins for built-ins.
function representativeEntry(occurrences?: any) {
    let fallback: any = null;
    let withMetadata: any = null;
    for (const occurrence of occurrences) {
        if (isNewerOccurrence(occurrence, fallback))
            fallback = occurrence;
        if (hasSavedMetadata(occurrence.entry) && isNewerOccurrence(occurrence, withMetadata))
            withMetadata = occurrence;
    }
    return (withMetadata || fallback)?.entry || null;
}
/**
 * Strength rows for every exercise with an estimate: best estimated 1RM (work sets only,
 * warm-ups excluded), the estimate's date, the exercise's primary muscle, the exercise's
 * OWN decay (from its last done work set), and the expected current 1RM (estimate x decay).
 * Sorted by expected current 1RM, strongest first. Exercises without a usable estimate are
 * omitted - a made-up number is worse than no number.
 */
export function strengthExerciseRows(S?: any, now?: any) {
    const workouts: any = S?.workouts || [];
    const ids: any = [...new Set(workouts.flatMap((w?: any) => (w.entries || []).map((e?: any) => e.id)))];
    const rows: any = [];
    for (const id of ids) {
        const best: any = best1RM(S, id);
        if (!best)
            continue;
        const entry: any = representativeEntry(entriesWithId(S, id));
        const lastAt: any = lastWorkSetAt(S, id);
        const decay: any = lastAt == null ? STRENGTH_FLOOR : strengthFromAge(Number(now) - lastAt);
        rows.push({
            id,
            name: resolvedExerciseName(entry) || id,
            est: best.est,
            estDate: best.d,
            primary: primaryMuscleOf(entry) ? primaryMuscleOf(entry).slug : null,
            decay,
            current: round1(best.est * decay),
        });
    }
    return rows.sort((a?: any, b?: any) => b.current - a.current || String(a.name).localeCompare(String(b.name)));
}
/**
 * Strength rows for exercises with positive resolved muscle credit for `slug`; catalogue
 * metadata takes precedence over saved snapshots when available. Each row keeps the exercise's
 * OWN decay and expected current 1RM - the tapped muscle filters the list, not the row's metrics.
 */
export function strengthExerciseRowsForMuscle(S?: any, now?: any, slug?: any) {
    const seen: any = new Map();
    for (const metric of strengthExerciseRows(S, now)) {
        const entries: any = entriesWithId(S, metric.id);
        const entry: any = representativeEntry(entries);
        // A deleted custom exercise may have snapshots on more than one occurrence. The latest
        // metadata-bearing snapshot answers the muscle filter, without mutating either record.
        const weight: any = snapshotWeights(entry)[slug];
        if (!weight)
            continue;
        const primary: any = primaryMuscleOf(entry);
        seen.set(metric.id, {
            id: metric.id,
            name: resolvedExerciseName(entry) || metric.id,
            weight,
            primary: primary ? primary.slug : null,
            est: metric.est,
            estDate: metric.estDate,
            decay: metric.decay,
            current: metric.current,
        });
    }
    return [...seen.values()].sort((a?: any, b?: any) => b.current - a.current || String(a.name).localeCompare(String(b.name)));
}
