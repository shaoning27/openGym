// Legacy dynamic types are explicit during the full language migration.
// Formatting + date helpers (ported from the vanilla app, unit taken from the store where needed).
import { dateLocale, t, tn, exerciseNameFor, exerciseNameClass } from './i18n-core.ts';
export const todayISO: any = () => {
    const d: any = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
};
export const isoOf: any = (d?: any) => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
export const DAYN: any = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
export const DAYS: any = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];
export const MONTHS: any = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const MONTHS_LONG: any = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
// toLocaleDateString / toLocaleString build a new Intl formatter on every call, which is most of
// what a long list of dates and weights costs (History with 400 workouts: ~430 ms in fmtDate
// alone). The formatters are kept per locale and options; their output is the same text.
const formatters: any = new Map();
const formatter: any = (Kind?: any, locale?: any, options?: any) => {
    const key: any = Kind.name + '|' + locale + '|' + (options ? JSON.stringify(options) : '');
    let f: any = formatters.get(key);
    if (!f) {
        f = new Kind(locale, options);
        formatters.set(key, f);
    }
    return f;
};
const DATE_SHORT: any = { day: 'numeric', month: 'short' };
const DATE_LONG: any = { weekday: 'short', day: 'numeric', month: 'short' };
const DATE_SHORT_Y: any = { ...DATE_SHORT, year: 'numeric' };
const DATE_LONG_Y: any = { ...DATE_LONG, year: 'numeric' };
export function fmtDate(iso?: any, long?: any, withYear: any = false) {
    const d: any = new Date(iso + 'T12:00:00');
    const options: any = long ? (withYear ? DATE_LONG_Y : DATE_LONG) : (withYear ? DATE_SHORT_Y : DATE_SHORT);
    // An unreadable date says "Invalid Date" as it always did; a formatter would throw instead.
    if (Number.isNaN(d.getTime()))
        return d.toLocaleDateString(dateLocale(), options);
    return formatter(Intl.DateTimeFormat, dateLocale(), options).format(d);
}
// A span of days, e.g. an import's first and last workout. The year is shown when the span
// crosses one or lies outside the current year: "3 Feb – 21 Dec" over two years read as one.
export function fmtDateRange(from?: any, to?: any, long?: any, now: any = new Date()) {
    if (!from)
        return '';
    const last: any = to || from;
    const year: any = String(now.getFullYear());
    const withYear: any = from.slice(0, 4) !== last.slice(0, 4) || from.slice(0, 4) !== year;
    return from === last ? fmtDate(from, long, withYear) : fmtDate(from, long, withYear) + ' – ' + fmtDate(last, long, withYear);
}
// In the UI language: the Latin h, m and min stood inside Arabic and Ukrainian rows.
export function fmtDur(ms?: any) {
    const m: any = Math.floor(ms / 60000);
    return m >= 60 ? t('{0}h {1}m', Math.floor(m / 60), m % 60) : t('{0} min', m);
}
// Imported history has no clock — an unknown duration is left out rather than shown as "0 min".
export const durPart: any = (ms?: any) => (ms >= 60000 ? [fmtDur(ms)] : []);
// Numbers follow the UI language, like the dates above — a hardcoded locale put Swiss
// apostrophes ("7'535 kg") in front of every user, in every language.
// Exercise names are stored lower-case and shown through CSS `capitalize`; text that has no
// element of its own (a toast) capitalises here instead.
export const capWords: any = (s?: any) => String(s || '').replace(/(^|[\s(\-\/])(\p{Ll})/gu, (m?: any, pre?: any, ch?: any) => pre + ch.toUpperCase());
// An exercise's display name as plain text, cased the way its element would be on screen
// (exerciseNameClass): for a toast, a dialog title or a picker label, which have no element of
// their own to put the class on.
export const exerciseNameText: any = (ex?: any) => (exerciseNameClass(ex) ? capWords(exerciseNameFor(ex)) : exerciseNameFor(ex));
/* How many decimals a weight is shown with. One is enough for plate-loadable numbers, but a
 * per-side figure from kg plates lands on .25 and .75 and reading those as .3 and .8 is the
 * complaint in issue #139 — as is microplate work. The setting is read here rather than passed
 * through sixty-odd call sites, the same way the date locale is; App.tsx pushes it whenever
 * `S.wdec` changes.
 *
 * It only ever adds precision that is really there: a whole number still prints whole, and
 * 62.5 is 62.5 either way. Nothing rounds differently in storage — this is display only.
 */
let decimals: any = 1;
export const setWeightDecimals: any = (n?: any) => { decimals = n === 2 ? 2 : 1; };
export const weightDecimals: any = () => decimals;
export const fmtNum: any = (n?: any) => {
    const p: any = decimals === 2 ? 100 : 10;
    // `+ 0` turns a -0 into 0: a change that rounds away ("-0.03") printed "-0".
    return formatter(Intl.NumberFormat, dateLocale(), decimals === 2 ? NUM_2 : NUM_1).format(Math.round(n * p) / p + 0);
};
const NUM_1: any = { maximumFractionDigits: 1 };
const NUM_2: any = { maximumFractionDigits: 2 };
// Plate sizes keep their quarter: 1.25 and 21.25 are real numbers on a plate and a bar.
export const fmtPlate: any = (n?: any) => formatter(Intl.NumberFormat, dateLocale()).format(Math.round(n * 100) / 100);
// Volume stays in the profile's unit throughout: the old shorthand turned anything over
// 10 000 into "t", which is wrong for a pound profile and made one list mix "18.8t" with
// "7'535 kg" — two numbers you can't compare at a glance.
export const fmtVol: any = (v?: any, unit?: any) => fmtNum(v) + ' ' + unit;
// Plural forms come from the pack via tn(): three forms in Russian, two in English.
export const exCount: any = (n?: any) => tn('{0} exercise', '{0} exercises', n);
export const routineCount: any = (n?: any) => tn('{0} routine', '{0} routines', n);
export const changeCount: any = (n?: any) => tn('{0} change', '{0} changes', n);
// The Sets tile of the finish summary: all the sets logged, then how many of them were work sets.
export const setsWorkCount: any = (n?: any, work?: any) => tn('{0} set · {1} work', '{0} sets · {1} work', n, work);
// "5 minutes ago", "yesterday", "now" — in the UI language, from the platform's own rules
// (Intl.RelativeTimeFormat), so no pack has to carry a word for every unit and plural. Used for
// when this device last synced; a time in the future (a clock set back since) reads as now.
export function fmtAgo(ts?: any, now: any = Date.now()) {
    const s: any = Math.max(0, Math.round((now - ts) / 1000));
    const [n, unit]: any = s < 60 ? [0, 'second'] : s < 3600 ? [Math.floor(s / 60), 'minute'] : s < 86400 ? [Math.floor(s / 3600), 'hour'] : [Math.floor(s / 86400), 'day'];
    try {
        return new Intl.RelativeTimeFormat(dateLocale(), { numeric: 'auto' }).format(-n, unit);
    }
    catch {
        return new Date(ts).toLocaleString(dateLocale());
    }
}
// How long before `dayIso` a logged day was, in calendar days (#363): "yesterday", "3 days ago",
// "2 weeks ago", "last month". For the "Last time (…)" line of a workout, so `dayIso` is the
// session's own day, not the wall clock: a workout logged into the past counts back from its
// day. Whole calendar days at noon, so a DST weekend between the two is not a day short.
// The words come from Intl.RelativeTimeFormat, so no pack carries them; it has no compound form
// ("1 week 1 day ago"), which is why a span rounds down to its coarsest unit. A year or more
// back reads as the date with its year, which says more than "1 year ago". A day after `dayIso`
// (a clock set back) reads as today.
export function fmtDaysAgo(iso?: any, dayIso: any = todayISO()) {
    const at: any = (s?: any) => Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10));
    const days: any = Math.max(0, Math.round((at(dayIso) - at(iso)) / 86400000));
    if (!(days >= 0))
        return fmtDate(iso);
    if (days >= 365)
        return fmtDate(iso, false, true);
    const [n, unit]: any = days < 7 ? [days, 'day'] : days < 35 ? [Math.floor(days / 7), 'week'] : [Math.max(1, Math.floor(days / 30.44)), 'month'];
    try {
        return new Intl.RelativeTimeFormat(dateLocale(), { numeric: 'auto' }).format(-n, unit);
    }
    catch {
        return fmtDate(iso);
    }
}
/* ---------------------------------------------------------------- week start --
   Where a week begins is a local convention, not a fact: most of Europe starts on
   Monday, most of the Americas and much of Asia on Sunday. The app used to assume
   Monday everywhere — the Plan list, the Home strip, the calendar grid and every
   "this week" total. It is now S.weekStart, a getDay() index, and every one of those
   places asks these helpers instead of writing the assumption down again.

   Only 1 and 0 are offered in the UI, but the helpers work for any weekday, so a
   Saturday start (parts of the Middle East) would need a locale string and nothing
   else. */
export const MONDAY: any = 1;
export const SUNDAY: any = 0;
/** The profile's first weekday, defaulting to Monday for every state written before this. */
export const weekStartOf: any = (S?: any) => (S?.weekStart === SUNDAY ? SUNDAY : MONDAY);
/** getDay() indices in display order — [1..6,0] for a Monday start, [0..6] for a Sunday one. */
export const weekOrder: any = (ws: any = MONDAY) => Array.from({ length: 7 }, (_?: any, i?: any) => (ws + i) % 7);
/** How many days a weekday sits past the start of its week. 0..6, so it doubles as a column. */
export const weekDayOffset: any = (day?: any, ws: any = MONDAY) => (day - ws + 7) % 7;
/** The Date (noon local, so DST cannot shift the day) that starts the week `iso` falls in. */
export function startOfWeek(iso?: any, ws: any = MONDAY) {
    const d: any = new Date(iso + 'T12:00:00');
    d.setDate(d.getDate() - weekDayOffset(d.getDay(), ws));
    return d;
}
/**
 * A key that is equal for two dates in the same week: the ISO date of the week's first day.
 *
 * Only ever compared or used as a map key — never shown, never stored — so it does not need
 * to be an ISO week number, and being one would be a liability here: "2026-35" is defined
 * Monday-first, and there is no Sunday-first equivalent to fall back to.
 */
//
// Memoised: Home's streak and week tally and Stats' weekly charts ask it for every workout on
// every render, and each call parses a Date. The answer only depends on the calendar date and
// the week start (noon local, so not on the time zone), so a string date is safe to remember.
const weekKeys: any = new Map();
export const weekKey: any = (iso?: any, ws: any = MONDAY) => {
    if (typeof iso !== 'string')
        return isoOf(startOfWeek(iso, ws));
    const k: any = ws + '|' + iso;
    let v: any = weekKeys.get(k);
    if (v === undefined) {
        if (weekKeys.size >= 20000)
            weekKeys.clear();
        v = isoOf(startOfWeek(iso, ws));
        weekKeys.set(k, v);
    }
    return v;
};
export const localTZ: any = () => { try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
}
catch {
    return 'UTC';
} };
export const uid: any = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
// What each accent is called, for a screen reader (Settings' swatches carry no text).
export const ACCENT_NAMES: any = { lime: 'Green', sky: 'Blue', orange: 'Orange', violet: 'Purple', pink: 'Pink', red: 'Red', teal: 'Teal', gold: 'Yellow' };
export const ACCENTS: any = { lime: '#30d158', sky: '#0a84ff', orange: '#ff9f0a', violet: '#bf5af2', pink: '#ff375f', red: '#ff453a', teal: '#40c8e0', gold: '#ffd60a' };
// Text drawn on top of that swatch. Matches the --on-acc values in index.css.
export const ACCENT_INK: any = { lime: '#000000', sky: '#ffffff', orange: '#000000', violet: '#ffffff', pink: '#ffffff', red: '#ffffff', teal: '#000000', gold: '#000000' };
// Android color int, opaque. JS bitwise ops are signed, so the high bit is cleared back to unsigned.
export const argb: any = (hex?: any) => (0xff000000 | parseInt(hex.slice(1), 16)) >>> 0;
