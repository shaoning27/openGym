// Legacy dynamic types are explicit during the full language migration.
// The phone's background check before a nudge or a reminder it scheduled on itself (lib/mobile.ts
// syncReminder). Both are local notifications, worked out from this phone's copy of the profile:
// a workout logged on the web or on another phone, with this one left in a pocket, used to be
// followed at 20:00 by "you missed it". So a paired phone also hands the native NudgeCheck plugin
// (ios/App/App/NudgeCheckPlugin.swift: BGAppRefreshTask; android/.../NudgeCheckPlugin.java:
// JobScheduler) the days it has something scheduled for. Shortly before each one fires, the
// plugin asks the server how that day stands (GET /api/nudge-check, a few bytes) and takes back
// what no longer applies. Offline, the server down, an answer it cannot read: nothing changes.
// When the app comes back to the foreground it resyncs from the full state as before.
//
// iOS decides when a background refresh actually runs (how much the app is used, battery, Low
// Power Mode), so there the check is a good chance, not a promise; Android runs it in the window
// asked for unless the phone is in deep sleep. See docs/MOBILE.md.
import { MOBILE } from './mobile.ts';
import { isoOf } from './format.ts';
import { remoteAuth } from './api.ts';
// The id ranges syncReminder schedules (lib/mobile.ts): workout-day reminders, then nudges.
export const REMINDER_IDS: any = [1000, 1999];
export const NUDGE_IDS: any = [2000, 2999];
const inRange: any = (id?: any, [lo, hi]: any = undefined as any) => id >= lo && id <= hi;
/**
 * The days a background check is for, from the notifications syncReminder just scheduled:
 * `{ date, at, reminder: [ids], nudge: [ids] }` per calendar day, `at` the first of them to fire
 * (ms), soonest first. Only what is still ahead of `now`.
 */
export function nudgeCheckPlan(notifications?: any, now: any = Date.now()) {
    const byDate: any = new Map();
    for (const n of notifications || []) {
        const when: any = n?.schedule?.at instanceof Date ? n.schedule.at.getTime() : NaN;
        if (!Number.isFinite(when) || when <= now)
            continue;
        const kind: any = inRange(n.id, NUDGE_IDS) ? 'nudge' : inRange(n.id, REMINDER_IDS) ? 'reminder' : null;
        if (!kind)
            continue;
        const date: any = isoOf(new Date(when));
        const e: any = byDate.get(date) || { date, at: when, reminder: [], nudge: [] };
        e.at = Math.min(e.at, when);
        e[kind].push(n.id);
        byDate.set(date, e);
    }
    return [...byDate.values()].sort((a?: any, b?: any) => a.at - b.at);
}
/**
 * What one answer from GET /api/nudge-check takes back for its day: everything once the day was
 * trained or excused (`done`), only the nudge when the server would not nudge it (its plan moved),
 * nothing on anything else. No answer (offline, an error) or one that is not the server's for this
 * day: nothing, the phone keeps what it planned. The native plugins apply the same rule.
 */
export function idsToCancel(entry?: any, answer?: any) {
    if (!entry || !answer || typeof answer !== 'object' || answer.date !== entry.date)
        return [];
    if (answer.done === true)
        return [...entry.reminder, ...entry.nudge];
    if (answer.nudge === false)
        return [...entry.nudge];
    return [];
}
// Registered once, and handed out inside an object: a Capacitor plugin proxy answers `then` with
// a native call that never settles, so a promise resolved with the bare proxy hangs (#42).
let pluginP: any = null;
const checkPlugin: any = () => pluginP || (pluginP = (async () => {
    if (!MOBILE)
        return null;
    const { registerPlugin }: any = await import('@capacitor/core');
    return { NudgeCheck: registerPlugin('NudgeCheck') };
})().catch(() => null));
/**
 * Hands the plan to the native side, or takes it back: armed only on a paired phone with the
 * reminder and the missed-day nudge on. Never throws; a phone without the plugin (an older native
 * shell) just goes without the check, as before.
 */
export async function armNudgeCheck(S?: any, notifications?: any, now: any = Date.now()) {
    const p: any = await checkPlugin();
    if (!p)
        return false;
    const r: any = S?.reminder;
    const auth: any = remoteAuth();
    const entries: any = r?.on && r.nudge && auth ? nudgeCheckPlan(notifications, now) : [];
    try {
        if (!entries.length) {
            await p.NudgeCheck.disarm();
            return false;
        }
        await p.NudgeCheck.arm({ server: auth.base, headers: auth.headers, entries });
        return true;
    }
    catch {
        return false;
    }
}
export function _resetNudgeCheck() { pluginP = null; }
