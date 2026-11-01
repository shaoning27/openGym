// Legacy dynamic types are explicit during the full language migration.
// The numbers behind a Coach card, computed on the device from the same training log the
// Coach read — so the chart under a suggestion shows exactly the window the suggestion cites,
// and nothing the model wrote is ever taken as a statistic.
//
// Pure functions over S. Nothing here is persisted: a card recomputes its insights from the
// window it names, which is why an old proposal in the thread still draws its chart months
// later, against the data as it was then.
import { EXIDX } from './exercises.ts';
import { sessionVolume, workoutAt } from './history.ts';
import { isWarmupRow } from './workout-model.ts';
import { bestSetOf } from './onerm.ts';
import { weighInAt } from './bodyweight.ts';
const median: any = (arr?: any) => {
    const a: any = arr.filter((n?: any) => Number.isFinite(n)).sort((x?: any, y?: any) => x - y);
    return a.length ? a[Math.floor(a.length / 2)] : null;
};
const bpOf: any = (S?: any, id?: any) => EXIDX[id]?.bp || (S.customEx || []).find((c?: any) => c.id === id)?.bp || null;
const nameOf: any = (S?: any, id?: any) => EXIDX[id]?.n || (S.customEx || []).find((c?: any) => c.id === id)?.n || id;
/** Workouts inside an inclusive ISO-date window; either bound may be missing. */
export function windowWorkouts(S?: any, { from, to }: any = {}) {
    return (S.workouts || []).filter((w?: any) => w && w.d && (!from || w.d >= from) && (!to || w.d <= to));
}
/**
 * What a review looked at, in numbers: how much, how long, which body parts, where the body
 * weight went and which lifts moved. `strength` holds up to `topN` exercises with at least two
 * estimable sessions in the window, most-trained first, with the first→last e1RM change.
 */
export function insightsFor(S?: any, win: any = {}, { topN = 3 }: any = {}) {
    const ws: any = windowWorkouts(S, win);
    const minutes: any = ws.map((w?: any) => (w.end && w.start ? Math.round((w.end - w.start) / 60000) : null)).filter((n?: any) => n > 0);
    // The volume the app shows, so the coach and the Stats screen quote the same number (#719).
    const volume: any = ws.reduce((n?: any, w?: any) => n + sessionVolume(w, S), 0);
    const byBp: any = {};
    let setsTotal: any = 0;
    ws.forEach((w?: any) => (w.entries || []).forEach((en?: any) => {
        const n: any = (en.sets || []).filter((s?: any) => s.done && !isWarmupRow(s)).length;
        if (!n)
            return;
        setsTotal += n;
        const bp: any = bpOf(S, en.id) || 'other';
        byBp[bp] = (byBp[bp] || 0) + n;
    }));
    const bodyParts: any = Object.entries(byBp).map(([bp, sets]: any) => ({ bp, sets, share: setsTotal ? sets / setsTotal : 0 }))
        .sort((a?: any, b?: any) => b.sets - a.sets);
    const from: any = win.from || ws[0]?.d || null;
    const to: any = win.to || ws[ws.length - 1]?.d || null;
    const bw: any = (S.bodyweight || []).filter((b?: any) => b && b.d && (!from || b.d >= from) && (!to || b.d <= to))
        .map((b?: any) => ({ t: weighInAt(b), y: b.w, d: b.d }));
    const bodyweight: any = {
        points: bw,
        delta: bw.length > 1 ? Math.round((bw[bw.length - 1].y - bw[0].y) * 10) / 10 : null,
        last: bw.length ? bw[bw.length - 1].y : null,
        goal: Number.isFinite(S.targetW) ? S.targetW : null
    };
    const series: any = new Map();
    ws.forEach((w?: any) => (w.entries || []).forEach((en?: any) => {
        const best: any = bestSetOf(en);
        if (!best)
            return;
        if (!series.has(en.id))
            series.set(en.id, []);
        series.get(en.id).push({ t: workoutAt(w), d: w.d, y: Math.round(best.est * 10) / 10 });
    }));
    const strength: any = [...series.entries()]
        .filter(([, pts]: any) => pts.length >= 2)
        .sort((a?: any, b?: any) => b[1].length - a[1].length)
        .slice(0, topN)
        .map(([id, pts]: any) => {
        const first: any = pts[0].y, last: any = pts[pts.length - 1].y;
        return { id, name: nameOf(S, id), sessions: pts.length, first, last, delta: Math.round((last - first) * 10) / 10, pct: first ? Math.round((last - first) / first * 100) : 0, points: pts };
    });
    return {
        from, to, sessions: ws.length, minutes: median(minutes), volume: Math.round(volume), sets: setsTotal,
        bodyParts, bodyweight, strength
    };
}
/**
 * One workout against the last time the same routine was trained: the numbers a debrief
 * card puts above the Coach's words.
 */
export function sessionInsights(S?: any, workout?: any) {
    if (!workout)
        return null;
    const all: any = (S.workouts || []).filter((w?: any) => w && w.d);
    const idx: any = all.findIndex((w?: any) => (workout.id && w.id === workout.id) || (w.d === workout.d && w.start === workout.start));
    const before: any = (idx >= 0 ? all.slice(0, idx) : all).filter((w?: any) => w.name && w.name === workout.name);
    const prev: any = before[before.length - 1] || null;
    const stat: any = (w?: any) => ({
        volume: Math.round(sessionVolume(w, S)),
        sets: (w.entries || []).reduce((n?: any, en?: any) => n + (en.sets || []).filter((s?: any) => s.done && !isWarmupRow(s)).length, 0),
        minutes: w.end && w.start ? Math.round((w.end - w.start) / 60000) : null,
        prs: (w.prs || []).length
    });
    const now: any = stat(workout);
    const then: any = prev ? stat(prev) : null;
    const lifts: any = (workout.entries || []).map((en?: any) => {
        const best: any = bestSetOf(en);
        const pe: any = prev?.entries?.find((x?: any) => x.id === en.id);
        const pb: any = pe ? bestSetOf(pe) : null;
        return best ? { id: en.id, name: nameOf(S, en.id), est: Math.round(best.est * 10) / 10, w: best.w, r: best.r, prev: pb ? Math.round(pb.est * 10) / 10 : null } : null;
    }).filter(Boolean);
    return { now, then, prevDate: prev?.d || null, lifts };
}
