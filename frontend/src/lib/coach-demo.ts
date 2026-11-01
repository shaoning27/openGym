// Legacy dynamic types are explicit during the full language migration.
// The Coach, in the demo build.
//
// The GitHub Pages demo has no backend at all, so there is nothing to run a CLI and nothing
// to poll. Rather than hide the feature there — it is the most interesting thing the app
// does — the demo answers the same calls locally with a canned proposal.
//
// It is built from the demo profile's actual routines rather than hard-coded, so every id
// resolves, the before/after values are real, and applying it exercises exactly the same
// code path as a live instance: validate, snapshot, apply, log, revert. What is faked is the
// provider, not the feature.
//
// Nothing here ships in a self-hosted bundle: every entry point is behind DEMO, which Vite
// replaces at build time.
import { EXIDX, EXDB } from './exercises.ts';
import { modeOf, workoutVolume, workoutAt } from './history.ts';
import { isWarmupRow } from './workout-model.ts';
import { best1RM } from './onerm.ts';
import { fmtNum } from './format.ts';
import { planHash } from './coach.ts';
import { waitingProposal } from '../../../api/coach/core/pending.ts';
import { t } from './i18n.ts';
const DELAY: any = 2200; // long enough to see "the Coach is thinking…", short enough to forgive
let pending: any = null;
let job: any = null;
let timer: any = null;
let lastError: any = null; // the last job that ended without a proposal, in the server's shape
const iso: any = (d?: any) => d.toISOString().slice(0, 10);
/** The routine the canned review aims at: the first with two exercises, one to swap and one to cut a set from. */
const reviewable: any = (S?: any) => (S.routines || []).find((r?: any) => (r.ex || []).length >= 2);
/** A change-set that reads like a real one, aimed at whatever the demo profile actually has. */
function buildReview(S?: any) {
    const routine: any = reviewable(S);
    if (!routine)
        return null;
    const reps: any = (routine.ex || []).filter((e?: any) => modeOf(e) === 'reps');
    const first: any = reps[0] || routine.ex[0];
    // Anything but `first`: the two changes below swap `first` away and re-set `second`, so the
    // same entry in both aborts the whole change-set on apply (`missing target`). `reps[1]` was
    // not enough — a routine whose only rep-mode exercise sits at index 1 landed on it twice.
    const second: any = reps.find((e?: any) => e !== first) || routine.ex.find((e?: any) => e !== first);
    const other: any = (S.routines || []).find((r?: any) => r.id !== routine.id);
    // Something plausible that is *not* in this routine, from the same body part as the first
    // exercise — a swap the reader can believe rather than a random pick out of 1,324.
    const bp: any = EXIDX[first.id]?.bp;
    const swapTo: any = EXDB.find((e?: any) => e.bp === bp && e.eq === 'dumbbell' && !(routine.ex || []).some((x?: any) => x.id === e.id))
        || EXDB.find((e?: any) => e.bp === bp && !(routine.ex || []).some((x?: any) => x.id === e.id));
    const sessions: any = (S.workouts || []).slice(-9);
    const changes: any = [];
    if (swapTo)
        changes.push({
            id: 'd1', type: 'swap-exercise', target: { routineId: routine.id, exId: first.id },
            before: EXIDX[first.id]?.n || first.id, after: { id: swapTo.id, name: swapTo.n },
            why: t('Every top set on this one came in at RPE 9.5 or above for three sessions and the weight has not moved. Swapping the movement for four weeks usually breaks that stall faster than grinding the same one.')
        });
    if (second)
        changes.push({
            id: 'd2', type: 'sets', target: { routineId: routine.id, exId: second.id },
            before: second.sets ?? 3, after: Math.max(1, (second.sets ?? 3) - 1),
            why: t('Sessions have been running about fifteen minutes over. This is the accessory with the least to lose from one set fewer.')
        });
    if (other)
        changes.push({
            id: 'd3', type: 'week', target: { weekday: 6 }, before: null, after: other.id,
            why: t('You have moved this session to Saturday three weeks running. Better the plan says so than that you keep overriding it.')
        });
    return {
        id: 'demo-review', kind: 'review', createdAt: Date.now(), expiresAt: Date.now() + 864e5,
        planHash: planHash(S), iteration: 1,
        summary: t('Three things worth changing, and one worth knowing about. Everything else is working: the squat and the pulls are both progressing on schedule.'),
        evidence: { from: sessions[0]?.d || iso(new Date(Date.now() - 28 * 864e5)), to: sessions.at(-1)?.d || iso(new Date()), sessions: sessions.length || 9 },
        changes,
        notes: [t('Body weight has been flat for four weeks while the goal is to gain. That’s a kitchen problem, not a training one. The plan isn’t what’s holding it back.')]
    };
}
/** A small, honest starter plan for the demo's creation flow. */
function buildPlan(S?: any, intake?: any) {
    const pick: any = (bp?: any, eq?: any) => EXDB.find((e?: any) => e.bp === bp && (!eq || e.eq === eq)) || EXDB.find((e?: any) => e.bp === bp);
    const days: any = intake?.preferredDays?.length ? intake.preferredDays.slice(0, 3) : [1, 3, 5];
    const eq: any = (intake?.equipment || [])[0] || null;
    const mk: any = (id?: any, name?: any, sets?: any, reps?: any, why?: any) => ({ id, sets, reps, mode: 'reps', why });
    const routines: any = [
        {
            id: 'dr1', name: t('Full body A'), emoji: '💪', prog: 'linear',
            why: t('The two big lower-body and pressing patterns first, while you are fresh.'),
            ex: [
                mk(pick('upper legs', eq)?.id, null, 3, 8, t('The main lower-body driver, where most of the strength comes from.')),
                mk(pick('chest', eq)?.id, null, 3, 10, t('Horizontal pressing, the other half of the session.')),
                mk(pick('back', eq)?.id, null, 3, 10, t('A pull for every press, so the shoulders stay balanced.'))
            ].filter((e?: any) => e.id)
        },
        {
            id: 'dr2', name: t('Full body B'), emoji: '🏋️', prog: 'linear',
            why: t('The same patterns, different variations: enough overlap to progress, enough difference to stay fresh.'),
            ex: [
                mk(pick('upper legs', eq)?.id, null, 3, 10, t('Same pattern, higher reps than day A.')),
                mk(pick('shoulders', eq)?.id, null, 3, 10, t('Vertical pressing.')),
                mk(pick('upper arms', eq)?.id, null, 3, 12, t('Direct arm work, since you asked for it.'))
            ].filter((e?: any) => e.id)
        }
    ];
    const week: any = {};
    days.forEach((d?: any, i?: any) => { week[d] = routines[i % routines.length].id; });
    return {
        id: 'demo-plan', kind: 'create', createdAt: Date.now(), expiresAt: Date.now() + 864e5, iteration: 1,
        planHash: planHash(S),
        summary: t('A two-day rotation across three sessions a week, built around the equipment you listed. Compounds first, one pull for every press, and enough overlap between the days that nothing goes two weeks without being trained.'),
        bundle: {
            opengym_plan: 1, name: t('Coach plan'),
            summary: t('A two-day rotation across three sessions a week, built around the equipment you listed. Compounds first, one pull for every press, and enough overlap between the days that nothing goes two weeks without being trained.'),
            basedOn: (S.workouts || []).length ? t('Based on the training already in this demo profile.') : t('No training history yet, so starting conservatively.'),
            week, routines, customEx: []
        }
    };
}
/** One session, read back with its own numbers — no plan changes, just what a coach would say after. */
function buildDebrief(S?: any, workoutId?: any) {
    const all: any = (S.workouts || []).filter((w?: any) => w && w.d);
    const w: any = all.find((x?: any) => x.id === workoutId) || all[all.length - 1];
    if (!w)
        return null;
    // workoutVolume() reads `w.entries` and `e.sets` without a guard; every other line here
    // tolerates both being absent. A workout carrying a date and nothing else therefore threw
    // inside the timer below, where at the time nothing caught it — the job stayed 'running'
    // for ever and every later request answered 409.
    const entries: any = (w.entries || []).map((en?: any) => ({ ...en, sets: en.sets || [] }));
    const done: any = entries.reduce((n?: any, en?: any) => n + en.sets.filter((s?: any) => s.done && !isWarmupRow(s)).length, 0);
    const planned: any = entries.reduce((n?: any, en?: any) => n + en.sets.filter((s?: any) => !isWarmupRow(s)).length, 0);
    const vol: any = Math.round(Number.isFinite(w.vol) ? w.vol : workoutVolume({ ...w, entries }));
    const prs: any = (w.prs || []).length;
    const minutes: any = w.end && w.start ? Math.round((w.end - w.start) / 60000) : null;
    const complete: any = planned > 0 && done >= planned;
    const score: any = complete ? (prs ? 9 : 8) : 7;
    const highlights: any = [
        complete ? t('Every planned set done: {0} of {1}.', done, planned) : t('{0} of {1} planned sets done.', done, planned),
        t('{0} {1} moved in total.', fmtNum(vol), S.unit)
    ];
    if (prs)
        highlights.push(t('{0} new personal records.', prs));
    const watch: any = minutes && minutes > 80 ? [t('{0} minutes is long. Rest periods may be creeping up.', minutes)] : [t('Top sets logged without an effort rating; add RIR so the next review can read how hard they were.')];
    const nextTime: any = [complete ? t('Add the next load step on the main lift.') : t('Repeat the same loads and get every set.'), t('Keep the session under an hour and a quarter.')];
    return {
        id: 'demo-debrief', kind: 'debrief', createdAt: Date.now(), expiresAt: Date.now() + 864e5,
        planHash: planHash(S), iteration: 1,
        workout: { id: w.id, d: w.d, name: w.name || null, minutes, vol, sets: done, prs },
        summary: complete
            ? t('A clean session: everything on the sheet got done and the loads held. This is exactly what progress looks like from the inside: unremarkable, repeated.')
            : t('Most of the work got done. One or two sets fell short, which is fine once. It only becomes a signal if the same sets miss next time.'),
        score, highlights, watch, nextTime
    };
}
/** What "the room" would say on a busy instance — five people, plausible medians, your real bests. */
export function demoCohort(S?: any) {
    const since: any = Date.now() - 56 * 864e5;
    const you: any = Math.round((S.workouts || []).filter((w?: any) => workoutAt(w) > since).length / 8 * 10) / 10;
    const ids: any = [...new Set((S.routines || []).flatMap((r?: any) => (r.ex || []).map((e?: any) => e.id)))].slice(0, 5);
    const exercises: any = ids.map((id?: any) => {
        const b: any = best1RM(S, id);
        const mine: any = b ? Math.round(b.est * 10) / 10 : null;
        return { id, name: EXIDX[id]?.n || id, people: 4, median: mine ? Math.round(mine * 0.92) : 60, you: mine };
    });
    return { ok: true, enabled: true, sharing: true, people: 5, minPeople: 3, unit: S.unit, sessionsPerWeek: { median: 3, you }, exercises, rankPct: 62 };
}
/* ---------------- the API surface the demo stands in for ---------------- */
export const demoStatus: any = () => ({ job, pending, cap: { used: 0, limit: 0 }, lastError });
function start(kind?: any, make?: any) {
    if (job)
        throw Object.assign(new Error(t('The Coach is already thinking about your training.')), { status: 409 });
    job = { id: 'demo-' + kind, kind, state: 'running', startedAt: Date.now() };
    lastError = null;
    clearTimeout(timer);
    // A builder that throws still has to end the job: left uncaught, one throw kept `job` at
    // 'running' for ever and every later request answered 409 until the page was reloaded. The
    // failure is recorded the way the server and the phone record theirs, so the chat's
    // job-ended effect writes the same error line it would for them. `nostate` because the only
    // thing a builder can trip over is the shape of the profile's own data.
    timer = setTimeout(() => {
        try {
            pending = make();
        }
        catch (e: any) {
            lastError = { errorClass: 'nostate', detail: String(e && e.message || e) };
        }
        finally {
            job = null;
        }
    }, DELAY);
    return { job };
}
export const demoReview: any = (S?: any) => {
    // Refused before the job starts, the way demoDebrief refuses with no workout: without a
    // two-exercise routine buildReview has nothing to aim at, and a job that runs the whole wait
    // and ends with neither a proposal nor an error reads as the Coach ignoring you.
    if (!reviewable(S))
        throw Object.assign(new Error(t('There’s no routine to review yet. Build one with at least two exercises first.')), { status: 409, code: 'noroutine' });
    return start('review', () => buildReview(S));
};
export const demoPlan: any = (S?: any, intake?: any) => start('create', () => buildPlan(S, intake));
// A refine re-reads the saved answers, as the server's payload does when a refine carries no
// intake of its own (`opts.intake || coach.profile`). Built from nothing, every revised plan
// went back to Mon/Wed/Fri whatever days were chosen at intake.
export const demoRefine: any = (S?: any) => start('create', () => {
    const p: any = buildPlan(S, S.coach?.profile || null);
    return { ...p, iteration: (pending?.iteration || 1) + 1, summary: t('Revised as you asked. Everything you did not question is exactly as it was.') + ' ' + p.summary };
});
export const demoDebrief: any = (S?: any, workoutId?: any) => {
    if (!(S.workouts || []).some((w?: any) => w && w.d))
        throw Object.assign(new Error(t('There’s no workout to look at yet. Log one first.')), { status: 409, code: 'noworkout' });
    return start('debrief', () => buildDebrief(S, workoutId));
};
// The demo has no model behind it: a question gets a sample answer that says so.
export const demoAsk: any = (S?: any, text?: any) => start('ask', () => ({
    id: 'demo-ask-' + Date.now().toString(36), kind: 'ask', createdAt: Date.now(), expiresAt: Date.now() + 864e5,
    planHash: planHash(S), iteration: 1, prev: waitingProposal(pending),
    answer: t('This is the demo, so there is no AI model behind me. On your own server I answer questions like “{0}” with your plan, your last sessions and the workout you are doing right now.', String(text || '').slice(0, 80)),
}));
export const demoResolve: any = () => { pending = pending?.kind === 'ask' ? waitingProposal(pending.prev) : null; return { ok: true }; };
export const demoDisclosure: any = () => ({
    provider: 'demo', providerLabel: t('the configured AI provider'),
    categories: ['plan', 'training', 'bodyweight', 'profile', 'prefs'], version: 1
});
