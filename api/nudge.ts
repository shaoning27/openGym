// Legacy dynamic types are explicit during the full language migration.
// Missed-workout nudge — the server half. Hand-copied (not imported) from
// frontend/src/lib/nudge.ts, as queue.ts is from lib/queue.ts: see there for the three rules
// (WHEN 20:00, or 2 h after the reminder, until 21:30; WHICH day counts as missed; the back-off
// after 3 missed days in a row). Kept out of server.ts so it can be unit-tested without booting
// the server; the tick in server.ts adds what only it knows (the push subscription, a session
// on screen right now, the once-a-day mark in db.json).
import { effectiveRoutineId, queueLiveOn } from './queue.ts';
export const NUDGE_TONES: any = ['friendly', 'guilt', 'drill'];
export const NUDGE_MAX_MISSES: any = 3;
export const NUDGE_LOOKBACK_DAYS: any = 14;
const EVENING: any = 20 * 60, LATEST: any = 21 * 60 + 30, AFTER_REMINDER: any = 120;
export const toneOf: any = (r?: any) => (NUDGE_TONES.includes(r?.tone) ? r.tone : 'friendly');
const hhmmToMin: any = (v?: any) => {
    const m: any = /^(\d{2}):(\d{2})$/.exec(v || '');
    return m ? Number(m[1]) * 60 + Number(m[2]) : NaN;
};
/** Minutes after midnight the nudge is owed from, or null when that would be after 21:30. */
export function nudgeMinute(reminderTime?: any) {
    const r: any = hhmmToMin(reminderTime);
    const at: any = Math.max(EVENING, Number.isNaN(r) ? 0 : r + AFTER_REMINDER);
    return at > LATEST ? null : at;
}
/** Is `hhmm` inside today's nudge window for a reminder set at `reminderTime`? */
export function nudgeWindowOpen(reminderTime?: any, hhmm?: any) {
    const at: any = nudgeMinute(reminderTime);
    const now: any = hhmmToMin(hhmm);
    return at != null && now >= at && now <= LATEST;
}
// Calendar arithmetic on ISO dates at UTC noon: no zone or DST edge can move the day.
const dayBefore: any = (iso?: any) => new Date(Date.parse(iso + 'T12:00:00Z') - 86400000).toISOString().slice(0, 10);
const records: any = (v?: any) => (Array.isArray(v) ? v.filter((x?: any) => x && typeof x === 'object') : []);
const logged: any = (S?: any, iso?: any) => S.workouts.some((w?: any) => w.d === iso);
// A day with a note on it (frontend lib/day-notes.ts: a quick pick or a line of text) is excused:
// never a missed day, never nudged or reminded about.
const DAY_NOTE_TAGS: any = ['sick', 'travel', 'rest', 'injured'];
export function excusedOn(S?: any, iso?: any) {
    const e: any = S?.dayNotes && typeof S.dayNotes === 'object' ? S.dayNotes[iso] : null;
    if (!e || typeof e !== 'object' || Array.isArray(e))
        return false;
    return DAY_NOTE_TAGS.includes(e.tag) || (typeof e.text === 'string' && e.text.trim() !== '');
}
function missed(S?: any, iso?: any) {
    if (logged(S, iso) || excusedOn(S, iso))
        return null;
    const rid: any = effectiveRoutineId(S, iso);
    if (!rid)
        return null;
    if (queueLiveOn(S, iso) && logged(S, dayBefore(iso)))
        return null;
    return rid;
}
/**
 * The routine id to nudge about on `iso`, or null: not a missed day, or 3 missed days in a row
 * already since the last workout (back-off). Workouts dated after `iso` are not looked at.
 */
export function nudgeFor(state?: any, iso?: any) {
    const S: any = { ...state, workouts: records(state?.workouts), routines: records(state?.routines) };
    const rid: any = missed(S, iso);
    if (!rid)
        return null;
    const last: any = S.workouts.reduce((m?: any, w?: any) => (typeof w.d === 'string' && w.d < iso && w.d > m ? w.d : m), '');
    let misses: any = 0;
    let d: any = dayBefore(iso);
    for (let i: any = 0; i < NUDGE_LOOKBACK_DAYS && d > last; i++, d = dayBefore(d)) {
        if (missed(S, d) && ++misses >= NUDGE_MAX_MISSES)
            return null;
    }
    return rid;
}
/** The day's line index: by date, so a day keeps its line and consecutive days rotate. */
export const lineIndex: any = (iso?: any, n?: any) => Math.floor(Date.parse(iso + 'T00:00:00Z') / 86400000) % n;
