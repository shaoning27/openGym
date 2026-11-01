// Legacy dynamic types are explicit during the full language migration.
// A note on a day you did not train (#261): "Sick", "Travelling", a line of your own. A day that
// carries one is excused: the missed-day nudge (lib/nudge.ts, and its server copy api/nudge.ts)
// and the workout-day reminder leave it alone, and the calendar, the heatmap and the week strip
// show it instead of an empty planned day.
//
// Stored per day, the way a plate-loading choice is (lib/plates.ts):
//
//   S.dayNotes = { '2026-10-08': { tag: 'sick', text: 'Flu, back Monday', _ts }, … }
//
// Each day is one entry with the time it was last written, so two devices that each noted a
// different day keep both, and the same day keeps the later note (lib/sync-merge.ts
// mergeStampedMap). Taking a note away is a stamped empty entry (`{ _ts }`), not a deleted key:
// a delete would come straight back from the other device's copy on the next sync.
//
// Only today and the days before can take a note. A note on a future day reads as permission to
// skip it, and the issue asked for nothing that nudges towards procrastination.
import { NOTE_MAX } from './history.ts';
import { todayISO } from './format.ts';
/** The quick picks, in the order the sheet shows them. Labels are English source strings. */
export const DAY_NOTE_TAGS: any = ['sick', 'travel', 'rest', 'injured'];
export const DAY_NOTE_LABEL: any = { sick: 'Sick', travel: 'Travelling', rest: 'Rest day', injured: 'Injured' };
// Icons the set already has (components/Icon.tsx): under the weather, away, asleep, ouch.
export const DAY_NOTE_ICON: any = { sick: 'cloud', travel: 'globe', rest: 'moon', injured: 'warning' };
const isMap: any = (v?: any) => !!v && typeof v === 'object' && !Array.isArray(v);
const ISO: any = /^\d{4}-\d{2}-\d{2}$/;
/** A stored entry read back: { tag, text } with the junk left out, or null for none or a cleared one. */
export function readDayNote(entry?: any) {
    if (!isMap(entry))
        return null;
    const tag: any = DAY_NOTE_TAGS.includes(entry.tag) ? entry.tag : null;
    const text: any = typeof entry.text === 'string' ? entry.text.trim().slice(0, NOTE_MAX) : '';
    return tag || text ? { tag, text } : null;
}
/** The note on `iso`, or null. */
export const dayNoteOf: any = (S?: any, iso?: any) => readDayNote(isMap(S?.dayNotes) ? S.dayNotes[iso] : null);
/** Whether `iso` is excused: it carries a note. The nudge and the reminder skip such a day. */
export const excusedOn: any = (S?: any, iso?: any) => dayNoteOf(S, iso) != null;
/** Whether `iso` can take a note at all: a real date, today or earlier. */
export const canNoteDay: any = (iso?: any, today: any = todayISO()) => ISO.test(String(iso || '')) && iso <= today;
/**
 * S.dayNotes with `iso` set to `note` ({ tag, text }), stamped `now`. An empty note (no tag, no
 * text) is written as a cleared entry, so the removal syncs (see the top of this file).
 */
export function withDayNote(map?: any, iso?: any, note?: any, now: any = Date.now()) {
    const clean: any = readDayNote(note);
    const entry: any = clean ? { ...(clean.tag ? { tag: clean.tag } : {}), ...(clean.text ? { text: clean.text } : {}), _ts: now } : { _ts: now };
    return { ...(isMap(map) ? map : {}), [iso]: entry };
}
/** The label a note reads as in a list or a tooltip: its quick pick, its text, or both. */
export function dayNoteLine(note?: any, tr: any = (s?: any) => s) {
    if (!note)
        return '';
    const label: any = note.tag ? tr(DAY_NOTE_LABEL[note.tag]) : '';
    return label && note.text ? `${label} · ${note.text}` : label || note.text;
}
