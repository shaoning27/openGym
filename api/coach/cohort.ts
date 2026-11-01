// Legacy dynamic types are explicit during the full language migration.
/* "Compare with others here": how one profile sits against everyone else on this instance.
 *
 * Two gates, both required. The admin switches the feature on for the instance (`community`
 * in coach.json), and each person opts in for themselves (`share` in their coach record). A
 * profile that does not share sees nothing — the trade is symmetric on purpose.
 *
 * What is computed is deliberately coarse: a median across at least MIN_PEOPLE participants
 * per number, never a single person's value, never a body weight, never a date. With three
 * people the median is still one person's number, so the floor is a floor on *plausibility*
 * of guessing whose, not a cryptographic guarantee; the docs say so.
 *
 * Everything is read from the state files on disk — the same ones the Coach reads for a
 * review — and cached for a few minutes, because a box with forty profiles should not parse
 * forty JSON blobs on every open of the sheet.
 */
import * as cfgStore from './config.ts';
import { readState, listUserIds, isSharing } from './jobs.ts';
import { libraryHas, libraryName } from './core/library.ts';
export const MIN_PEOPLE: any = 3;
export const MAX_EXERCISES: any = 12;
const WEEKS_STRENGTH: any = 12;
const WEEKS_FREQUENCY: any = 8;
const CACHE_MS: any = 5 * 60000;
const LB_TO_KG: any = 0.45359237;
const REP_CAP: any = 12; // mirrors frontend/src/lib/onerm.ts: past twelve reps the estimate stops meaning much
// Mirror of frontend/src/lib/workout-model.ts isWarmupRow: an explicit phase wins over the
// legacy boolean.
const isWarmup: any = (s?: any) => {
    const ph: any = typeof s?.phase === 'string' ? s.phase.trim().toLowerCase() : '';
    if (ph)
        return ph === 'warmup' || ph === 'warm-up' || ph === 'warm_up';
    return s?.warmup === true;
};
const epley: any = (w?: any, r?: any) => w * (1 + Math.min(r, REP_CAP) / 30);
const round1: any = (n?: any) => Math.round(n * 10) / 10;
const median: any = (arr?: any) => {
    const a: any = arr.filter((n?: any) => Number.isFinite(n)).sort((x?: any, y?: any) => x - y);
    return a.length ? a[Math.floor(a.length / 2)] : null;
};
const isoDaysAgo: any = (days?: any) => { const d: any = new Date(); d.setDate(d.getDate() - days); return d.toISOString().slice(0, 10); };
/** One participant, reduced to what the cohort reads: kg throughout.
 *
 * Catalogue exercises only. An entry's id is whatever that person's client wrote, and the ids
 * that enough people share are put, as they are, into every other sharing person's review and
 * debrief prompt — so three accounts that log the same made-up id could write into a stranger's
 * prompt. A custom exercise's id is minted per person and never means the same lift on two
 * accounts anyway, so nothing a real comparison needs is lost. */
function participant(S?: any) {
    const since: any = isoDaysAgo(WEEKS_STRENGTH * 7);
    const sinceFreq: any = isoDaysAgo(WEEKS_FREQUENCY * 7);
    const toKg: any = S.unit === 'lb' ? LB_TO_KG : 1;
    const workouts: any = (S.workouts || []).filter((w?: any) => w && w.d && w.d >= since);
    if (!workouts.length)
        return null;
    const best: any = {};
    workouts.forEach((w?: any) => (w.entries || []).forEach((en?: any) => {
        if (!libraryHas(en?.id))
            return;
        (en.sets || []).forEach((s?: any) => {
            if (!s.done || isWarmup(s) || !(s.w > 0) || !(s.r > 0))
                return;
            const est: any = epley(s.w * toKg, s.r);
            if (est > (best[en.id] || 0))
                best[en.id] = est;
        });
    }));
    const recent: any = workouts.filter((w?: any) => w.d >= sinceFreq).length;
    return { sessionsPerWeek: round1(recent / WEEKS_FREQUENCY), best };
}
let cache: any = null; // { at, rows: Map<uid, participant> }
export function invalidate() { cache = null; }
function rows() {
    if (cache && Date.now() - cache.at < CACHE_MS)
        return cache.rows;
    const out: any = new Map();
    for (const uid of listUserIds()) {
        if (!isSharing(uid))
            continue;
        const S: any = readState(uid);
        if (!S)
            continue;
        const p: any = participant(S);
        if (p)
            out.set(uid, p);
    }
    cache = { at: Date.now(), rows: out };
    return out;
}
/** Everything the sheet shows, in the requester's unit. */
export function computeCohort(uid?: any) {
    if (!isSharing(uid))
        return { ok: false, enabled: true, sharing: false };
    const all: any = rows();
    const people: any = all.size;
    if (people < MIN_PEOPLE)
        return { ok: false, enabled: true, sharing: true, people, minPeople: MIN_PEOPLE };
    const me: any = all.get(uid) || null;
    const S: any = readState(uid);
    const unit: any = S?.unit === 'lb' ? 'lb' : 'kg';
    const out: any = (v?: any) => (v == null ? null : round1(unit === 'lb' ? v / LB_TO_KG : v));
    const byEx: any = new Map();
    for (const p of all.values()) {
        for (const [id, est] of Object.entries(p.best)) {
            if (!byEx.has(id))
                byEx.set(id, []);
            byEx.get(id).push(est);
        }
    }
    const exercises: any = [...byEx.entries()]
        .filter(([, list]: any) => list.length >= MIN_PEOPLE)
        .map(([id, list]: any) => ({ id, name: libraryName(id), people: list.length, medianKg: median(list), youKg: me?.best[id] ?? null, list }))
        .sort((a?: any, b?: any) => b.people - a.people || a.name.localeCompare(b.name))
        .slice(0, MAX_EXERCISES);
    // Where the requester stands: for each listed exercise they trained, the share of the
    // *other* participants whose best is at or below theirs, averaged.
    const ranks: any = exercises.filter((x?: any) => x.youKg != null).map((x?: any) => {
        const others: any = x.list.length - 1;
        if (others <= 0)
            return null;
        const below: any = x.list.filter((v?: any) => v <= x.youKg).length - 1;
        return below / others;
    }).filter((v?: any) => v != null);
    const rankPct: any = ranks.length ? Math.round(ranks.reduce((a?: any, b?: any) => a + b, 0) / ranks.length * 100) : null;
    return {
        ok: true, enabled: true, sharing: true, people, minPeople: MIN_PEOPLE, unit,
        sessionsPerWeek: { median: median([...all.values()].map((p?: any) => p.sessionsPerWeek)), you: me?.sessionsPerWeek ?? 0 },
        exercises: exercises.map((x?: any) => ({ id: x.id, name: x.name, people: x.people, median: out(x.medianKg), you: out(x.youKg) })),
        rankPct
    };
}
/** The compact form a prompt gets — kg regardless of the requester's unit, or null. */
export function cohortForPayload(uid?: any) {
    try {
        if (!cfgStore.load().community || !isSharing(uid))
            return null;
        const all: any = rows();
        if (all.size < MIN_PEOPLE)
            return null;
        const me: any = all.get(uid) || null;
        const byEx: any = new Map();
        for (const p of all.values())
            for (const [id, est] of Object.entries(p.best)) {
                if (!byEx.has(id))
                    byEx.set(id, []);
                byEx.get(id).push(est);
            }
        const exercises: any = [...byEx.entries()]
            .filter(([, list]: any) => list.length >= MIN_PEOPLE)
            .map(([id, list]: any) => ({ id, name: libraryName(id), median: round1(median(list)), you: me?.best[id] != null ? round1(me.best[id]) : null }))
            .sort((a?: any, b?: any) => ((b.you != null) as any) - ((a.you != null) as any) || a.name.localeCompare(b.name))
            .slice(0, MAX_EXERCISES);
        return {
            unit: 'kg', people: all.size,
            sessionsPerWeek: { median: median([...all.values()].map((p?: any) => p.sessionsPerWeek)), you: me?.sessionsPerWeek ?? 0 },
            exercises
        };
    }
    catch {
        return null;
    }
}
