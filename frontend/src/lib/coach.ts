// Legacy dynamic types are explicit during the full language migration.
// The AI Coach, on the client side: everything that decides what a proposal *does* to a plan.
//
// The server produces proposals; it never writes into your state. Applying one is ordinary
// local editing — snapshot, mutate the draft, log — which is what makes it work offline, sync
// like every other change, and stay reversible without the server knowing anything about it.
//
// Every function here is pure over a draft state `s` (call them inside store.update), so the
// interesting parts are testable without a browser, a server or an AI account. That matters
// more here than elsewhere in the app: this is the code that edits a plan on the strength of
// something a language model said, and "it looked right on my phone" is not a standard.
//
// The screens that call it arrive in PR 4. Nothing in this file needs one to be tested, which
// is the point of it being separate from them.
import { EXIDX, canonicalExId } from './exercises.ts';
import { modeOf, isBw, isPerSide, cleanupSg } from './history.ts';
import { uid, todayISO, DAYN } from './format.ts';
import { mergePlan } from './plan-share.ts';
import { deleteRoutine } from './routines.ts';
import { POLICIES } from './progression.ts';
import { t, tn } from './i18n.ts';
import { snapshotKey } from './sync-merge.ts';
import { scheduleModeOf, startNewPass } from './rotation.ts';
import { queueOf } from './queue.ts';
// Bumping this re-prompts everyone: it means what we share, or who we share it with, changed.
// 2: the training line names the session notes, which the payload carries and version 1 never
// mentioned.
export const CONSENT_VERSION: any = 2;
// Bounds. The whole state has to stay inside the server's 5 MB body limit, and a Coach log
// that grows forever is exactly the kind of thing that eats it invisibly. Worst case here is
// ~75 KB; the namespace guard is the backstop for the case nobody predicted.
export const SNAPSHOT_MAX: any = 3;
export const LOG_MAX: any = 50;
export const CHAT_MAX: any = 40;
export const TIMINGS_MAX: any = 5;
const NAMESPACE_MAX: any = 256 * 1024;
export const emptyCoach: any = () => ({
    consent: null, profile: null, cadence: 'off', lastReview: null, log: [], snapshots: [],
    // The conversation as the user saw it (views/CoachChat.tsx): their messages, and what the
    // Coach did with them. Short, synced, and trimmed with the log — the proposal itself lives
    // server-side (or in the phone's device file) until it is applied or dismissed.
    chat: [],
    // How long the last few jobs took, so the typing bubble can say "usually about 2 minutes".
    timings: []
});
const coachOf: any = (s?: any) => (s.coach = s.coach || emptyCoach());
/* ============================ gating ============================ */
// One predicate, one place. Every Coach entry point in the UI is behind it, which is what
// makes "an instance with no provider is byte-identical to before" a claim worth testing.
//
// The demo build is the one exception, and it is deliberate: it has no backend and no
// account, but it does have a canned provider, and hiding the app's most interesting feature
// from the page people are sent to look at it on would be a strange choice.
//
// The mobile build has two ways in, both chosen in Settings (views/CoachSetup.tsx): a phone
// paired to a self-hosted server is an ordinary signed-in profile and takes the web rule; a
// phone that brought its own API key runs the Coach itself (lib/coach-local.ts). Nothing
// chosen means nothing shown — the same "invisible unless configured" promise the web keeps.
export const coachAvailable: any = (config?: any, user?: any, { demo, mobile, coachMode }: any = {}) => mobile ? (coachMode === 'byok' || !!(config?.coach?.enabled && user))
    : demo ? true : !!(config?.coach?.enabled && user);
// What each data category means, in the user's words. Rendered from the same list the payload
// builder uses (api/coach/core/categories.ts), so the screen cannot promise less than leaves.
// Each entry returns [title, detail] in the current language, through literal t() calls so
// check-source-strings sees every key. When the screens passed these to t() as variables the
// checker could not see them, and eight of the ten had no translation in any pack.
export const CATEGORY_TEXT: any = {
    plan: () => [t('Your plan'), t('Routines, exercises, sets and reps, your weekly schedule and progression settings.')],
    training: () => [t('Your logged training'), t('Sets you logged in the review window: weights, reps, times, effort ratings, how long sessions took, and your session notes.')],
    bodyweight: () => [t('Body weight'), t('Weigh-ins from the same window, and your goal weight if you set one.')],
    profile: () => [t('What you tell the Coach'), t('Your intake answers, including any limitations or injuries you describe.')],
    prefs: () => [t('A few preferences'), t('Your unit, your language and which effort scale you log.')]
};
export const hasConsent: any = (S?: any) => !!S?.coach?.consent?.agreedAt && S.coach.consent.version === CONSENT_VERSION;
/* ============================ plan fingerprint ============================ */
/**
 * Mirror of `canonicalPlan` in api/coach/payload.ts — field for field, including the rule
 * that every absent value is written out as a zero so "no weight" and "0 kg" cannot hash
 * apart, and that `bodyweight`/`side` are *resolved* against the catalogue rather than copied,
 * so a plan that says nothing and an exercise the dataset already calls bodyweight hash the
 * same. If you change one, change both; coach.test.js checks them against shared fixtures.
 */
export function canonicalPlan(S?: any) {
    return {
        routines: (S.routines || []).map((r?: any) => ({
            id: r.id, name: r.name || '', prog: r.prog || '',
            ex: (r.ex || []).map((e?: any) => {
                const mode: any = modeOf(e);
                return {
                    id: e.id, mode, sets: e.sets || 0,
                    reps: mode === 'reps' ? (e.reps || 0) : 0,
                    sec: mode === 'time' ? (e.sec || 0) : 0,
                    min: mode === 'cardio' ? (e.min || 0) : 0,
                    speed: mode === 'cardio' ? (e.speed || 0) : 0,
                    weight: mode === 'cardio' ? 0 : (e.weight || 0),
                    prog: e.prog || '', inc: e.inc || 0, repsMin: e.repsMin || 0, repsMax: e.repsMax || 0,
                    bodyweight: isBw(e), side: isPerSide(e),
                    sg: e.sg || ''
                };
            })
        })),
        // A weekday holds a routine-id list now. `[].concat` folds a legacy bare string and a
        // one-element list to the same shape, so their fingerprint is identical — no false-stale
        // storm on the first load after the upgrade. `?.length` keeps a stray `[]` out. Insertion
        // order is preserved and never sorted (it is the merge order).
        week: Object.fromEntries([1, 2, 3, 4, 5, 6, 0].filter((d?: any) => S.week?.[d]?.length).map((d?: any) => [d, [].concat(S.week[d])]))
    };
}
/** FNV-1a-ish 64-bit fingerprint. Mirror of hashPlan in api/coach/core/plan-hash.js. */
export function hashPlan(plan?: any) {
    const canon: any = JSON.stringify({
        routines: (plan?.routines || []).map((r?: any) => [r.id, r.name, r.prog, (r.ex || []).map((e?: any) => [e.id, e.mode, e.sets, e.reps, e.sec, e.min, e.speed, e.weight, e.prog, e.inc,
                e.repsMin, e.repsMax, e.bodyweight, e.side, e.sg].join(':'))]),
        // `plan` is a canonicalPlan output, so each day is already an array. `{1:['r1']}` → "1=r1",
        // byte-identical to the pre-upgrade fingerprint; `{3:['r2','r3']}` → "3=r2+r3". Weekday
        // keys still sorted; the routine list within a day never is.
        week: Object.keys(plan?.week || {}).sort().map((k?: any) => k + '=' + [].concat(plan.week[k]).join('+'))
    });
    let h1: any = 0x811c9dc5, h2: any = 0x01000193;
    for (let i: any = 0; i < canon.length; i++) {
        const c: any = canon.charCodeAt(i);
        h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0;
        h2 = Math.imul(h2 ^ ((c << 3) | i & 7), 0x85ebca6b) >>> 0;
    }
    return h1.toString(16).padStart(8, '0') + h2.toString(16).padStart(8, '0');
}
export const planHash: any = (S?: any) => hashPlan(canonicalPlan(S));
/* ============================ staleness ============================ */
const findRoutine: any = (S?: any, id?: any) => (S.routines || []).find((r?: any) => r.id === id) || null;
const findEx: any = (routine?: any, id?: any) => (routine?.ex || []).find((e?: any) => e.id === id) || null;
// The Coach reads a routine's name cut at 80 characters (NAME_MAX in api/coach/core/payload.ts),
// and the server copies that cut name into a rename's `before`. Compared whole, a longer name
// never matched, and every rename of it was shown as already overtaken by an edit. Not imported
// from payload.ts, which would pull the exercise catalogue into the main bundle; coach.test.js
// pins the two together.
export const ROUTINE_NAME_SEEN: any = 80;
/** The plan's current value for whatever a change is about — what `before` is checked against. */
export function currentValue(S?: any, change?: any) {
    const r: any = findRoutine(S, change.target?.routineId);
    const e: any = change.target?.exId ? findEx(r, change.target.exId) : null;
    switch (change.type) {
        case 'sets': return e?.sets ?? null;
        case 'reps': return e?.reps ?? null;
        case 'repsMin': return e?.repsMin ?? null;
        case 'repsMax': return e?.repsMax ?? null;
        case 'sec': return e?.sec ?? null;
        case 'inc': return e?.inc ?? null;
        case 'exercise-prog': return e?.prog ?? null;
        case 'routine-prog': return r?.prog ?? null;
        case 'rename-routine': return r?.name == null ? null : String(r.name).slice(0, ROUTINE_NAME_SEEN);
        case 'week': return [].concat(S.week?.[change.target?.weekday] ?? []); // routine-id list; [] = rest
        default: return undefined; // structural changes have no single scalar to compare
    }
}
/**
 * Mark what can no longer be applied. Two independent checks, because they fail differently:
 * the whole proposal is stale when the plan has moved since it was computed, and an individual
 * change is stale when the thing it names is gone or has already been changed by hand.
 *
 * A stale change is disabled, never silently skipped — someone who edited their plan on
 * another device should be told why the suggestion is greyed out.
 */
export function markStale(proposal?: any, S?: any) {
    if (!proposal)
        return proposal;
    const planMoved: any = !!proposal.planHash && proposal.planHash !== planHash(S);
    const changes: any = (proposal.changes || []).map((c?: any) => {
        const r: any = c.target?.routineId ? findRoutine(S, c.target.routineId) : null;
        let stale: any = false;
        if (c.type !== 'add-routine' && c.type !== 'week' && !r)
            stale = true;
        else if (c.target?.exId && !findEx(r, c.target.exId))
            stale = true;
        else if (c.type === 'week') {
            // The day's value is a routine-id list; `before` may be a list (a combined day) or a
            // legacy bare string. Compare by canonical join so order matters but shape does not.
            const join: any = (v?: any) => [].concat(v ?? []).join('+');
            if (c.before != null && join(currentValue(S, c)) !== join(c.before))
                stale = true;
        }
        else {
            const cur: any = currentValue(S, c);
            // `before` is what the Coach saw. If the live plan disagrees, someone has already
            // changed it — applying would silently overwrite their edit with a stale premise.
            if (cur !== undefined && c.before != null && cur !== c.before && cur !== null)
                stale = true;
        }
        return { ...c, status: stale ? 'stale' : (c.status === 'stale' ? 'proposed' : c.status || 'proposed') };
    });
    return { ...proposal, planMoved, changes };
}
export const applicable: any = (proposal?: any) => (proposal?.changes || []).filter((c?: any) => c.status !== 'stale');
/* ============================ validation ============================ */
/** Client-side mirror of the server's gate — the plan must survive a bad day at either end. */
export function validateProposal(p?: any) {
    if (!p || typeof p !== 'object')
        throw new Error(t('That proposal can’t be read.'));
    if (p.bundle) {
        if (!Array.isArray(p.bundle.routines) || !p.bundle.routines.length)
            throw new Error(t('That proposal can’t be read.'));
        // The server rejects a routine with no exercises; so must this, or an empty one is appended,
        // gets scheduled, and "start today's session" opens a workout with nothing in it.
        for (const r of p.bundle.routines) {
            if (!Array.isArray(r.ex) || !r.ex.length)
                throw new Error(t('That proposal can’t be read.'));
        }
        return true;
    }
    if (!Array.isArray(p.changes))
        throw new Error(t('That proposal can’t be read.'));
    for (const c of p.changes) {
        if (!CHANGE_APPLY[c.type])
            throw new Error(t('That proposal can’t be read.'));
    }
    return true;
}
/* ============================ snapshots & revert ============================ */
const clone: any = (o?: any) => JSON.parse(JSON.stringify(o));
/**
 * Remember the `dayPlan` entries an apply step deleted, on the snapshot that will undo it.
 *
 * A patch, not a clone: `dayPlan` holds every date the user ever rescheduled, and three copies
 * of it in the snapshot ring would crowd real snapshots out of the 256 KB namespace budget that
 * `trim()` enforces. The first value recorded for a date wins — that is the pre-apply one.
 */
function recordDayPlanDrops(s?: any, dropped?: any) {
    if (!Object.keys(dropped).length)
        return;
    const snaps: any = coachOf(s).snapshots || [];
    const snap: any = snaps[snaps.length - 1];
    if (!snap)
        return;
    snap.dayPlanRestore = { ...dropped, ...(snap.dayPlanRestore || {}) };
}
/**
 * Drop per-date reschedules from `iso` onwards.
 *
 * A created plan replaces the whole week, so overrides made against the old one are no longer
 * about anything: `'rest'` would hide a session the new plan schedules, and a routine id wins
 * over the new week on that day. Past dates stay — those are history, not intent.
 */
function sweepDayPlan(s?: any, fromIso?: any) {
    const dropped: any = {};
    Object.keys(s.dayPlan || {}).forEach((iso?: any) => {
        if (iso >= fromIso) {
            dropped[iso] = s.dayPlan[iso];
            delete s.dayPlan[iso];
        }
    });
    recordDayPlanDrops(s, dropped);
}
/** Snapshot `{routines, week}` before touching either. The unit of revert (FR-30/31). */
export function pushSnapshot(s?: any, proposalId?: any, label?: any) {
    const c: any = coachOf(s);
    c.snapshots = [...(c.snapshots || []), {
            at: Date.now(), proposalId: proposalId || null, label: label || '',
            routines: clone(s.routines || []), week: clone(s.week || {})
        }].slice(-SNAPSHOT_MAX);
    trim(s);
}
/**
 * Put the plan back the way it was before the last applied change-set.
 *
 * Workouts are untouched, and that is not an oversight: the log is what happened. Reverting a
 * plan re-derives every future target from that same history, which is exactly what the
 * progression engine does anyway.
 */
export function revertLast(s?: any) {
    const c: any = coachOf(s);
    const snap: any = (c.snapshots || []).pop();
    if (!snap)
        return false;
    s.routines = clone(snap.routines);
    s.week = clone(snap.week);
    // Snapshots taken before this field existed have nothing to put back.
    if (snap.dayPlanRestore)
        Object.assign(s.dayPlan, snap.dayPlanRestore);
    // A created plan that took over the rotation (useInRotation) gives the old loop and its pass back.
    if (snap.rotationRestore) {
        s.rotation = clone(snap.rotationRestore.rotation);
        s.queue = clone(snap.rotationRestore.queue);
    }
    // Which snapshot this used (`snap`): the sync merge keeps it off the ring when another device's
    // copy still holds it, so the same Undo is not offered twice (lib/sync-merge.ts mergeCoach).
    appendLog(s, { kind: 'revert', at: Date.now(), proposalId: snap.proposalId, snap: snapshotKey(snap), summary: t('Reverted the last Coach changes.') });
    return true;
}
export const canRevert: any = (S?: any) => !!(S?.coach?.snapshots || []).length;
/* ============================ the log ============================ */
export function appendLog(s?: any, entry?: any) {
    const c: any = coachOf(s);
    const e: any = { id: entry.id || uid(), ...entry };
    c.log = [...(c.log || []), e].slice(-LOG_MAX);
    trim(s);
    return e.id;
}
export const logEntry: any = (S?: any, id?: any) => (S?.coach?.log || []).find((e?: any) => e.id === id) || null;
/**
 * What a created plan looked like, small enough to keep: names, days and prescriptions, no
 * rationale text. The full bundle was merged into the plan already; this is what the chat
 * shows back when someone opens an old proposal months later.
 */
export function lightBundle(b?: any) {
    if (!b)
        return null;
    return {
        name: b.name || '', summary: b.summary || '', week: { ...(b.week || {}) },
        routines: (b.routines || []).map((r?: any) => ({
            id: r.id, name: r.name, emoji: r.emoji || '', why: r.why || '',
            ex: (r.ex || []).map((e?: any) => ({
                id: e.id, sets: e.sets, mode: e.mode || 'reps',
                ...(e.reps != null ? { reps: e.reps } : {}), ...(e.sec != null ? { sec: e.sec } : {}),
                ...(e.min != null ? { min: e.min } : {}), ...(e.weight ? { weight: e.weight } : {}),
                ...(e.why ? { why: String(e.why).slice(0, 200) } : {})
            }))
        }))
    };
}
const decisionOf: any = (c?: any, status?: any) => ({ id: c.id, type: c.type, target: c.target || null, before: c.before ?? null, after: c.after ?? null, why: c.why, routineName: c.routineName || null, status });
/**
 * Last line of defence for the 5 MB sync body: if the Coach namespace ever outgrows its
 * budget, drop the oldest history rather than let a PUT start failing for reasons nobody
 * would connect to this feature.
 */
function trim(s?: any) {
    const c: any = coachOf(s);
    let guard: any = 0;
    while (JSON.stringify(c).length > NAMESPACE_MAX && guard++ < 60) {
        if ((c.chat || []).length > 8)
            c.chat.shift();
        else if ((c.snapshots || []).length > 1)
            c.snapshots.shift();
        else if ((c.log || []).length > 1)
            c.log.shift();
        else
            break;
    }
}
/* ============================ the conversation ============================ */
/**
 * One line of the chat: `{ id, role: 'user'|'coach', kind, text?, at, ref? }`.
 * kinds — user: 'intake' (the questionnaire, rendered from the live profile), 'text';
 *         coach: 'text', 'applied', 'dismissed', 'reverted', 'error', 'nochange'.
 */
export function appendChat(s?: any, entry?: any) {
    const c: any = coachOf(s);
    c.chat = [...(c.chat || []), { id: entry.id || uid(), at: entry.at || Date.now(), ...entry }].slice(-CHAT_MAX);
    trim(s);
}
/** A job just finished: remember how long it took, for the next typing bubble. */
export function recordTiming(s?: any, ms?: any) {
    if (!(ms > 0))
        return;
    const c: any = coachOf(s);
    c.timings = [...(c.timings || []), Math.round(ms)].slice(-TIMINGS_MAX);
}
/**
 * What to promise in the typing bubble. Median of the observed runs, but never slower than
 * the most recent one: after a speed-up (a faster model, a warmed cache) the median drags
 * three old 8-minute runs along, and telling someone "about 8 min" for a one-minute job is
 * worse than being briefly optimistic. A slow outlier still cannot scare anyone — the median
 * wins in that direction.
 */
export function estimateMs(S?: any) {
    const raw: any = (S?.coach?.timings || []).filter((n?: any) => n > 0);
    if (!raw.length)
        return null;
    const sorted: any = [...raw].sort((a?: any, b?: any) => a - b);
    return Math.min(sorted[Math.floor(sorted.length / 2)], raw[raw.length - 1]);
}
// The weekdays the intake pre-selects for each day count (0 = Sunday, as in `week`): the usual
// spread for that many sessions, Mon/Wed/Fri for three, Mon/Tue/Thu/Fri for four.
const DEFAULT_DAYS: any = [[1], [1, 4], [1, 3, 5], [1, 2, 4, 5], [1, 2, 3, 4, 5], [1, 2, 3, 4, 5, 6], [0, 1, 2, 3, 4, 5, 6]];
/** The weekdays the intake pre-selects for `count` training days a week, clamped to 1–7. */
export function defaultTrainingDays(count?: any) {
    const n: any = Math.round(Number(count ?? 3));
    return [...DEFAULT_DAYS[Math.min(7, Math.max(1, Number.isFinite(n) ? n : 3)) - 1]];
}
/** The questionnaire, as the lines the chat shows back to the user. */
export function profileLines(p?: any) {
    if (!p)
        return [];
    const goal: any = ({ strength: 'Get stronger', muscle: 'Build muscle', general: 'General fitness', fatloss: 'Lose fat', endurance: 'Endurance' } as any)[p.goal];
    const exp: any = ({ new: 'New to lifting', returning: 'Coming back after a break', regular: 'Training regularly' } as any)[p.experience];
    const lines: any = [];
    if (goal)
        lines.push(t(goal));
    if (exp)
        lines.push(t(exp));
    if (p.daysPerWeek)
        lines.push(tn('1 day a week', '{0} days a week', p.daysPerWeek));
    if (p.sessionMin)
        lines.push(t('{0} min per session', p.sessionMin));
    if (p.equipment?.length)
        lines.push(p.equipment.join(', '));
    if (p.limitations)
        lines.push(t('Limits: {0}', p.limitations));
    if (p.likes)
        lines.push(t('Likes: {0}', p.likes));
    if (p.dislikes)
        lines.push(t('Avoid: {0}', p.dislikes));
    if (p.notes)
        lines.push(p.notes);
    return lines;
}
/* ============================ applying a created plan ============================ */
/**
 * Accepting a created plan is exactly importing a plan file (FR-18): routines arrive as new
 * ones with fresh ids, existing routines and history are never touched, and the week schedule
 * only moves if you asked it to.
 */
export function applyCreatedPlan(s?: any, proposal?: any, { schedule }: any = {}) {
    validateProposal(proposal);
    pushSnapshot(s, proposal.id, t('Before the Coach’s plan'));
    const bundle: any = proposal.bundle;
    // The Coach's `why` texts are for the review screen; they have no place in the routine data.
    // A link is never the Coach's to write: validatePlan already drops one from the model's plan,
    // and this drops it again on the way into mergePlan, which would otherwise carry a `url` on a
    // plan's own exercises through to the profile (cleanCustom keeps links for shared plans).
    const stripped: any = {
        ...bundle,
        routines: bundle.routines.map((r?: any) => ({ ...r, why: undefined, ex: r.ex.map((e?: any) => ({ ...e, why: undefined, name: undefined })) })),
        customEx: (bundle.customEx || []).map((c?: any) => { const { url, media, ...rest }: any = c || {}; return rest; })
    };
    const res: any = mergePlan(s, stripped, { schedule });
    // Only when the week actually moved — with the switch off the old schedule still stands, and
    // so do the reschedules made against it.
    if (schedule)
        sweepDayPlan(s, todayISO());
    const rotation: any = !!schedule && useInRotation(s, res.ids, bundle.name);
    res.logId = appendLog(s, {
        kind: 'create', at: Date.now(), proposalId: proposal.id,
        summary: proposal.summary || '', routines: res.routines, iteration: proposal.iteration || 1,
        bundle: lightBundle(bundle), scheduled: !!schedule, ...(rotation ? { rotation: true } : {})
    });
    res.rotation = rotation;
    return res;
}
/**
 * In rotation mode Home and Plan read the loop, not the week (lib/rotation.ts), so a created plan
 * that only set the week never showed up (#778). With the schedule switch on, the loop becomes
 * the plan's routines in the Coach's order and starts over from the first one. The Coach plans a
 * week, not rest days, so the loop has none. The old loop and pass go on the snapshot for Undo.
 * A planner's queue is its writer's (rotation.ts OWNERSHIP) and stays as it is. Returns whether
 * the rotation was set.
 */
function useInRotation(s?: any, ids?: any, name?: any) {
    if (scheduleModeOf(s) !== 'rotation' || !ids?.length)
        return false;
    const q: any = queueOf(s);
    if (q && (!s.rotation || q.rotationId !== s.rotation.id))
        return false;
    const snap: any = (coachOf(s).snapshots || []).at(-1);
    if (snap)
        snap.rotationRestore = { rotation: clone(s.rotation ?? null), queue: clone(s.queue ?? null) };
    s.rotation = { id: s.rotation?.id ?? uid(), sequence: [...ids], label: name || s.rotation?.label || '', at: 0 };
    startNewPass(s);
    return true;
}
/* ============================ applying a change-set ============================ */
// One implementation per allowed type. The object is the closed list on this side of the
// wire: a type with no entry here cannot be applied, whatever the server let through.
const CHANGE_APPLY: any = {
    'add-exercise': (s?: any, c?: any) => {
        const r: any = need(findRoutine(s, c.target.routineId));
        const a: any = c.after || {};
        // A drawing's id the Coach may have picked up names the exercise it draws.
        const e: any = { id: canonicalExId(a.id), sets: a.sets || 3, mode: a.mode || 'reps' };
        if (e.mode === 'cardio') {
            e.min = a.min || 20;
            e.speed = a.speed || 8;
        }
        else if (e.mode === 'time')
            e.sec = a.sec || 45;
        else
            e.reps = a.reps || 10;
        if (a.weight > 0)
            e.weight = a.weight;
        if (POLICIES.includes(a.prog))
            e.prog = a.prog;
        if (Number.isInteger(a.repsMin))
            e.repsMin = a.repsMin;
        if (Number.isInteger(a.repsMax))
            e.repsMax = a.repsMax;
        if (Number.isInteger(a.setsMax))
            e.setsMax = a.setsMax; // triple progression's set ceiling
        // Only when the Coach disagreed with the catalogue: an absent flag has always meant
        // "whatever the exercise says", and writing one out would freeze today's dataset into
        // the plan.
        if (a.bodyweight != null)
            e.bodyweight = !!a.bodyweight;
        if (a.side)
            e.side = true;
        const at: any = Number.isInteger(a.position) ? Math.min(a.position, r.ex.length) : r.ex.length;
        r.ex.splice(at, 0, e);
        cleanupSg(r.ex);
    },
    'remove-exercise': (s?: any, c?: any) => {
        const r: any = need(findRoutine(s, c.target.routineId));
        r.ex = r.ex.filter((e?: any) => e.id !== c.target.exId);
        cleanupSg(r.ex);
    },
    'swap-exercise': (s?: any, c?: any) => {
        const r: any = need(findRoutine(s, c.target.routineId));
        const i: any = r.ex.findIndex((e?: any) => e.id === c.target.exId);
        if (i < 0)
            throw new Error('missing exercise');
        const old: any = r.ex[i], a: any = c.after || {};
        // Keep the old prescription unless the Coach deliberately changed it: a swap is about the
        // movement, and silently resetting sets and reps would be a second change nobody approved.
        //
        // The two v1.2.4 flags are the exception, and they have to be: they describe the *movement*,
        // not the prescription. Carrying `side: true` from a lunge onto a leg press would make the
        // app halve a rep count that was never per-side, so an explicit flag is dropped and the new
        // exercise goes back to whatever the catalogue says about it.
        const { bodyweight, side, ...keep }: any = old;
        r.ex[i] = { ...keep, id: canonicalExId(a.id), ...(a.sets ? { sets: a.sets } : {}), ...(a.reps ? { reps: a.reps } : {}), ...(a.weight > 0 ? { weight: a.weight } : {}) };
    },
    sets: (s?: any, c?: any) => { need(findExIn(s, c)).sets = c.after; },
    reps: (s?: any, c?: any) => { need(findExIn(s, c)).reps = c.after; },
    repsMin: (s?: any, c?: any) => { need(findExIn(s, c)).repsMin = c.after; },
    repsMax: (s?: any, c?: any) => { need(findExIn(s, c)).repsMax = c.after; },
    sec: (s?: any, c?: any) => { need(findExIn(s, c)).sec = c.after; },
    cardio: (s?: any, c?: any) => {
        const e: any = need(findExIn(s, c));
        if (c.after?.min != null)
            e.min = c.after.min;
        if (c.after?.speed != null)
            e.speed = c.after.speed;
    },
    inc: (s?: any, c?: any) => { need(findExIn(s, c)).inc = c.after; },
    'exercise-prog': (s?: any, c?: any) => { need(findExIn(s, c)).prog = c.after; },
    'routine-prog': (s?: any, c?: any) => { need(findRoutine(s, c.target.routineId)).prog = c.after; },
    reorder: (s?: any, c?: any) => {
        const r: any = need(findRoutine(s, c.target.routineId));
        const by: any = new Map(r.ex.map((e?: any) => [e.id, e]));
        const next: any = c.after.map((id?: any) => by.get(id)).filter(Boolean);
        // Distinct exercises, not just the right count: an order naming one id twice maps to the
        // same object twice and still counts right, which drops an exercise and leaves the
        // survivor aliased into two slots that then edit each other.
        if (next.length !== r.ex.length || new Set(next).size !== r.ex.length)
            throw new Error('incomplete reorder');
        r.ex = next;
        cleanupSg(r.ex);
    },
    superset: (s?: any, c?: any) => {
        const r: any = need(findRoutine(s, c.target.routineId));
        const i: any = r.ex.findIndex((e?: any) => e.id === c.target.exId);
        if (i < 0)
            throw new Error('missing exercise');
        if (!c.after?.link) {
            delete r.ex[i].sg;
            cleanupSg(r.ex);
            return;
        }
        // Splicing the partner out from under the anchor when they are the same exercise leaves
        // nothing to tag; refuse rather than reorder the routine on the way to a TypeError.
        if (c.after.with === c.target.exId)
            throw new Error('superset with itself');
        const j: any = r.ex.findIndex((e?: any) => e.id === c.after.with);
        if (j < 0)
            throw new Error('missing partner');
        // Supersets are a property of adjacency in this app; move the partner next to it first.
        const [partner]: any = r.ex.splice(j, 1);
        const at: any = r.ex.findIndex((e?: any) => e.id === c.target.exId);
        r.ex.splice(at + 1, 0, partner);
        const tag: any = uid().slice(0, 6);
        r.ex[at].sg = tag;
        r.ex[at + 1].sg = tag;
    },
    'add-routine': (s?: any, c?: any) => {
        const a: any = c.after;
        s.routines.push({
            id: uid(), name: a.name, emoji: a.emoji || '🏋️',
            ...(POLICIES.includes(a.prog) ? { prog: a.prog } : {}),
            ex: a.ex.map((e?: any) => ({
                id: canonicalExId(e.id), sets: e.sets || 3, mode: e.mode || 'reps',
                // The same targets and defaults as 'add-exercise': a cardio entry used to get reps (#640).
                ...(e.mode === 'cardio' ? { min: e.min || 20, speed: e.speed || 8 }
                    : e.mode === 'time' ? { sec: e.sec || 45 } : { reps: e.reps || 10 }),
                ...(Number.isInteger(e.repsMax) ? { repsMax: e.repsMax } : {}),
                ...(Number.isInteger(e.setsMax) ? { setsMax: e.setsMax } : {}),
                ...(e.bodyweight != null ? { bodyweight: !!e.bodyweight } : {}),
                ...(e.side ? { side: true } : {})
            }))
        });
    },
    'remove-routine': (s?: any, c?: any) => {
        // The same delete as Plan and RoutineEdit. It used to compare each weekday with ===, which
        // missed a combined day (a list) and left the deleted id on it. The week comes back from the
        // snapshot on a revert; the dropped reschedules are not in the snapshot, so they are recorded.
        recordDayPlanDrops(s, deleteRoutine(s, c.target.routineId));
    },
    'rename-routine': (s?: any, c?: any) => { need(findRoutine(s, c.target.routineId)).name = c.after; },
    week: (s?: any, c?: any) => {
        // A single-routine op: the slot is a list, but the Coach only ever names one routine (or
        // rest), and it replaces the day. This collapses a combined day to one routine — the same
        // stated limitation as a DayOverride (see docs/dev/COMBINE_ROUTINES.md §8).
        const d: any = c.target.weekday;
        if (c.after == null || c.after === 'rest')
            delete s.week[d];
        else
            s.week[d] = [c.after];
    }
};
export const CHANGE_TYPES: any = Object.keys(CHANGE_APPLY);
function findExIn(s?: any, c?: any) { return findEx(findRoutine(s, c.target.routineId), c.target.exId); }
function need(x?: any) { if (!x)
    throw new Error('missing target'); return x; }
/**
 * Apply the accepted subset, atomically (FR-30).
 *
 * Atomic comes free from how the store works: `update()` hands us a throwaway clone and only
 * keeps it if we return normally. Throwing part-way through therefore discards every change
 * this function already made, which is precisely the transaction we want — no half-applied
 * change-set, ever.
 */
export function applyChangeSet(s?: any, proposal?: any, acceptedIds?: any) {
    validateProposal(proposal);
    const accepted: any = new Set(acceptedIds || []);
    const changes: any = (proposal.changes || []).filter((c?: any) => accepted.has(c.id) && c.status !== 'stale');
    if (!changes.length)
        return { applied: 0 };
    pushSnapshot(s, proposal.id, t('Before the Coach’s changes'));
    const applied: any = [];
    for (const c of changes) {
        CHANGE_APPLY[c.type](s, c);
        applied.push(decisionOf(c, 'accepted'));
    }
    // Turned-down changes keep their before/after too: the chat shows the whole proposal back
    // later, and "you declined something about sets" is not a memory anyone can use.
    const rejected: any = (proposal.changes || [])
        .filter((c?: any) => !accepted.has(c.id))
        .map((c?: any) => decisionOf(c, c.status === 'stale' ? 'stale' : 'rejected'));
    const logId: any = appendLog(s, {
        kind: 'review', at: Date.now(), proposalId: proposal.id,
        summary: proposal.summary || '', evidence: proposal.evidence || null,
        notes: proposal.notes || [], decisions: [...applied, ...rejected]
    });
    coachOf(s).lastReview = { at: Date.now() };
    return { applied: applied.length, rejected: rejected.length, logId };
}
/** Turned down whole, or expired: recorded so a later review knows not to re-propose it. */
export function recordDismissal(s?: any, proposal?: any) {
    const logId: any = appendLog(s, {
        kind: proposal.kind === 'create' ? 'create' : 'review', at: Date.now(), proposalId: proposal.id,
        summary: proposal.summary || '', dismissed: true,
        evidence: proposal.evidence || null, notes: proposal.notes || [],
        ...(proposal.bundle ? { bundle: lightBundle(proposal.bundle), iteration: proposal.iteration || 1 } : {}),
        decisions: (proposal.changes || []).map((c?: any) => decisionOf(c, 'rejected'))
    });
    if (proposal.kind !== 'create')
        coachOf(s).lastReview = { at: Date.now() };
    return logId;
}
/** A debrief has no decision to make: it is read, kept, and shown again on request. */
export function recordDebrief(s?: any, proposal?: any) {
    return appendLog(s, {
        kind: 'debrief', at: Date.now(), proposalId: proposal.id,
        workout: proposal.workout || null,
        summary: proposal.summary || '', score: proposal.score ?? null,
        highlights: proposal.highlights || [], watch: proposal.watch || [], nextTime: proposal.nextTime || []
    });
}
/* ============================ display helpers ============================ */
export const exName: any = (id?: any) => EXIDX[id]?.n || t('Unknown exercise');
// Catalogue names are lower-case; a title reads better with each word capitalised, and doing it
// here rather than with CSS keeps a German sentence around the name from being Title Cased too.
const cap: any = (s?: any) => String(s || '').replace(/(^|\s)(\p{L})/gu, (m?: any, sp?: any, ch?: any) => sp + ch.toUpperCase());
export const exTitle: any = (id?: any) => cap(exName(id));
/** Human label for a change, used on the review screen and in the log. */
export function changeTitle(c?: any, S?: any) {
    const ex: any = c.target?.exId ? exTitle(c.target.exId) : null;
    switch (c.type) {
        case 'add-exercise': return t('Add {0}', exTitle(c.after?.id));
        case 'remove-exercise': return t('Remove {0}', ex);
        case 'swap-exercise': return t('Swap {0} for {1}', ex, exTitle(c.after?.id));
        case 'sets': return t('{0}: sets', ex);
        case 'reps': return t('{0}: reps', ex);
        case 'repsMin': return t('{0}: rep-range floor', ex);
        case 'repsMax': return t('{0}: rep-range ceiling', ex);
        case 'sec': return t('{0}: hold time', ex);
        case 'cardio': return t('{0}: duration & pace', ex);
        case 'inc': return t('{0}: load step', ex);
        case 'exercise-prog': return t('{0}: progression', ex);
        case 'routine-prog': return t('Routine progression');
        case 'reorder': return t('Reorder exercises');
        case 'superset': return c.after?.link ? t('Superset {0} with {1}', ex, exTitle(c.after.with)) : t('Unlink superset on {0}', ex);
        case 'add-routine': return t('Add routine “{0}”', c.after?.name);
        case 'remove-routine': return t('Remove a routine');
        case 'rename-routine': return t('Rename routine to “{0}”', c.after);
        case 'week': return Number.isInteger(c.target?.weekday) ? t('{0}: what’s planned', t(DAYN[c.target.weekday])) : t('Change what’s planned on one day');
        default: return c.type;
    }
}
/** Short before/after strings for the diff column. */
export function changeValues(c?: any, S?: any) {
    const routineName: any = (id?: any) => (S?.routines || []).find((r?: any) => r.id === id)?.name || id;
    const fmt: any = (v?: any) => {
        // `week` first — its value is a routine-id list (an array is also an object, so it has to
        // win before the generic branches). Render as " + "-joined routine names; null / empty /
        // "rest" all read as Rest.
        if (c.type === 'week') {
            const ids: any = [].concat(v ?? []).filter((x?: any) => x && x !== 'rest');
            return ids.length ? ids.map(routineName).join(' + ') : t('Rest');
        }
        if (v == null)
            return '–';
        if (typeof v === 'object')
            return v.id ? exTitle(v.id) : v.name || JSON.stringify(v);
        if (Array.isArray(v))
            return v.length + '';
        return String(v);
    };
    if (['add-exercise', 'add-routine', 'reorder'].includes(c.type))
        return null;
    if (['remove-exercise', 'remove-routine'].includes(c.type))
        return null;
    return { before: fmt(c.before), after: fmt(c.after) };
}
