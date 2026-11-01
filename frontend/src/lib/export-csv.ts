// Legacy dynamic types are explicit during the full language migration.
// The training history as a spreadsheet (#647): Settings > Data > "Export as CSV".
//
// One row per set, the shape every other app's importer reads (Strong, Hevy and the like), so a
// file from here opens in Excel or Sheets and moves to another app without a converter. Numbers
// are written with a dot and no grouping whatever the language, dates as ISO, exercise names in
// English: a spreadsheet in a German or Brazilian locale still reads the columns right, and so
// does our own importer (lib/import-csv.ts), which takes this file back without losing anything
// it can store. The `exercise_id` column is what makes that lossless: the name is for people,
// the id is what the re-import files the sets under.
//
// Body weight and measurements are a second file. They are one row per day, not per set, and a
// mixed file would leave every workout row with twenty empty measurement columns.
import { EXIDX } from './exercises.ts';
import { capWords } from './format.ts';
import { MEASUREMENT_FIELDS, builtinCsvColumn, customCsvColumn, customDisplayValue } from './measurements.ts';
import { hasCompletedWork, isWarmupRow, isFailureSet, isSideSet, dropsOf } from './workout-model.ts';
import { workoutDay } from './history.ts';
export const WORKOUT_COLUMNS: any = [
    'date', 'start_time', 'end_time', 'workout', 'workout_note', 'exercise', 'exercise_id', 'body_part',
    'superset_id', 'set', 'set_type', 'side', 'weight', 'unit', 'reps', 'rpe', 'rir', 'distance_km',
    'seconds', 'incline', 'note',
];
/** One CSV field, RFC 4180: quoted when it holds a comma, a quote or a line break. */
export function csvField(v?: any) {
    if (v == null)
        return '';
    let s: any = String(v);
    // A name starting with = + - @ is a formula to a spreadsheet, and a shared plan's name came from
    // someone else. The apostrophe is how spreadsheets spell "this is text"; the importer drops it.
    if (/^[=+\-@\t\r]/.test(s) && !/^-?\d/.test(s))
        s = "'" + s;
    return /[",\r\n]/.test(s) || /^\s|\s$/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}
const line: any = (cells?: any) => cells.map(csvField).join(',');
// The BOM is for Excel, which reads a UTF-8 file without one as the system code page and turns
// every "ü" into two characters. The importer strips it again.
const csvText: any = (header?: any, rows?: any) => '﻿' + [line(header), ...rows.map(line)].join('\r\n') + '\r\n';
// Dot decimal, no grouping, no float noise ("62.5", never "62,5" or "62.50000001").
const n: any = (v?: any) => (Number.isFinite(+v) && v !== '' && v != null ? String(Math.round(+v * 1e6) / 1e6) : '');
const p2: any = (x?: any) => String(x).padStart(2, '0');
const stamp: any = (ms?: any) => {
    if (!Number.isFinite(ms) || !ms)
        return '';
    const d: any = new Date(ms);
    return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())} ${p2(d.getHours())}:${p2(d.getMinutes())}`;
};
/**
 * A cardio set's distance, as short as it can be: speed × minutes is 4.708333 km for 25 minutes at
 * 11.3, which nobody wants in a spreadsheet. Two decimals (ten metres) mostly do; a short set
 * gets more, as many as our importer needs to read the same speed back (it rounds to 0.01 km/h).
 */
function distanceKm(s?: any) {
    const min: any = Number(s.min) || 0, speed: any = Number(s.speed) || 0;
    const km: any = speed * min / 60;
    if (!(km > 0))
        return '0';
    const back: any = (x?: any) => Math.round(x / (min / 60) * 100);
    for (let d: any = 2; d < 6; d++) {
        const r: any = Math.round(km * 10 ** d) / 10 ** d;
        if (back(r) === Math.round(speed * 100))
            return String(r);
    }
    return n(km);
}
/** Workouts whose day falls inside [from, to] (ISO days, either may be null for open), oldest first. */
const workoutsIn: any = (S?: any, from?: any, to?: any) => (S.workouts || [])
    .filter((w?: any) => { const d: any = workoutDay(w); return d && (!from || d >= from) && (!to || d <= to); })
    .sort((a?: any, b?: any) => (workoutDay(a) === workoutDay(b) ? (a.start || 0) - (b.start || 0) : workoutDay(a) < workoutDay(b) ? -1 : 1));
/** The exercise behind an entry and its name: the user's own as typed, a catalogue one in English. */
function exerciseFor(S?: any, id?: any) {
    const mine: any = (S.customEx || []).find((c?: any) => c && c.id === id);
    if (mine)
        return { ex: mine, name: mine.n || id };
    const ex: any = EXIDX[id] || null;
    return { ex, name: ex ? capWords(ex.n) : id };
}
/**
 * Rows of the workout file. `from`/`to` limit it to a stretch of days. Only completed sets are
 * written, the way the history and the text export count them: an unticked set never happened.
 */
export function workoutRows(S?: any, { from = null, to = null }: any = {}) {
    const unit: any = S.unit === 'lb' ? 'lb' : 'kg';
    const rows: any = [];
    for (const w of workoutsIn(S, from, to)) {
        const day: any = workoutDay(w);
        // Superset tags are random ids; in a spreadsheet 1, 2, 3 per workout reads better and says the same.
        const groups: any = new Map();
        const head: any = [day, stamp(w.start), w.end > w.start ? stamp(w.end) : '', w.name || '', w.note || ''];
        for (const e of w.entries || []) {
            const { ex, name }: any = exerciseFor(S, e.id);
            if (e.sg && !groups.has(e.sg))
                groups.set(e.sg, groups.size + 1);
            const exCells: any = [name, e.id, ex?.bp || '', e.sg ? groups.get(e.sg) : ''];
            let no: any = 0, noteLeft: any = e.note || '';
            // The entry's note rides on its first row only: the importer keeps one note per exercise.
            const push: any = (cells?: any) => { rows.push([...head, ...exCells, ...cells, noteLeft]); noteLeft = ''; };
            const cardio: any = (s?: any) => !(s.r > 0) && (s.min > 0 || s.speed > 0);
            for (const s of e.sets || []) {
                if (!hasCompletedWork(s))
                    continue;
                no++;
                const type: any = isWarmupRow(s) ? 'warmup' : isFailureSet(s) ? 'failure' : 'normal';
                if (cardio(s)) {
                    push([no, type, '', '', unit, '', '', '', distanceKm(s), n(Math.round((Number(s.min) || 0) * 60)), s.incline != null ? n(s.incline) : '']);
                    continue;
                }
                const effort: any = (x?: any) => [x.rpe != null ? n(x.rpe) : '', x.rir != null ? n(x.rir) : ''];
                const one: any = (x?: any, side?: any) => {
                    if (side && !x.done)
                        return;
                    push([no, type, side, n(x.w || 0), unit, x.sec > 0 && !(x.r > 0) ? '' : n(x.r || 0), ...effort(x), '', x.sec > 0 && !(x.r > 0) ? n(x.sec) : '', '']);
                    // A drop-set's drops follow as rows of their own under the same set number.
                    for (const d of dropsOf(x))
                        push([no, 'drop', side, n(d.w || 0), unit, n(d.r || 0), '', '', '', '', '']);
                };
                if (isSideSet(s)) {
                    one(s.sides.L, 'L');
                    one(s.sides.R, 'R');
                }
                else
                    one(s, '');
            }
        }
    }
    return rows;
}
export const workoutsCSV: any = (S?: any, range?: any) => csvText(WORKOUT_COLUMNS, workoutRows(S, range));
/**
 * Body weight and measurements, one row per day. Weight in the profile's unit (the header says
 * which, so the importer needs no unit column), measurements in centimetres the way they are
 * stored, body fat in percent. Custom measurement fields get a column each, under their own name
 * with their unit in brackets and their values in it (#718; lib/measurements.ts customCsvColumn).
 */
export function bodyCSV(S?: any, { from = null, to = null }: any = {}) {
    const unit: any = S.unit === 'lb' ? 'lb' : 'kg';
    const inside: any = (d?: any) => d && (!from || d >= from) && (!to || d <= to);
    const days: any = new Map();
    const at: any = (d?: any) => { if (!days.has(d))
        days.set(d, { w: null, m: null }); return days.get(d); };
    for (const b of S.bodyweight || [])
        if (inside(b?.d) && b.w > 0)
            at(b.d).w = b.w;
    for (const m of S.measurements || [])
        if (inside(m?.d))
            at(m.d).m = m;
    const fields: any = MEASUREMENT_FIELDS.filter((f?: any) => [...days.values()].some((v?: any) => v.m && v.m[f.key] != null));
    // The field's own name and unit where it still exists, else what the reading carries.
    const defs: any = new Map((S.customMeasurements || []).filter((c?: any) => c?.id).map((c?: any) => [c.id, c]));
    const custom: any = new Map();
    for (const v of days.values())
        for (const o of v.m?.other || []) {
            if (!o?.id || o.value == null || custom.has(o.id))
                continue;
            const def: any = defs.get(o.id);
            custom.set(o.id, { name: def?.name || o.name || 'Other', unit: def?.unit || o.unit });
        }
    const header: any = ['date', 'weight_' + unit, ...fields.map(builtinCsvColumn),
        ...[...custom.values()].map((c?: any) => customCsvColumn(c.name, c.unit))];
    const rows: any = [...days.keys()].sort().map((d?: any) => {
        const { w, m }: any = days.get(d);
        return [d, w != null ? n(w) : '', ...fields.map((f?: any) => (m && m[f.key] != null ? n(m[f.key]) : '')),
            ...[...custom].map(([id, c]: any) => { const o: any = (m?.other || []).find((x?: any) => x?.id === id); return o?.value != null ? n(customDisplayValue(o.value, c.unit)) : ''; })];
    });
    return csvText(header, rows);
}
/** What each file would hold, for the line under its button: workouts and sets, weigh-ins and measurements. */
export function csvCounts(S?: any, range?: any) {
    const from: any = range?.from, to: any = range?.to;
    const inside: any = (d?: any) => d && (!from || d >= from) && (!to || d <= to);
    return {
        workouts: workoutsIn(S, from, to).length,
        sets: workoutRows(S, range).length,
        weighIns: (S.bodyweight || []).filter((b?: any) => inside(b?.d) && b.w > 0).length,
        measurements: (S.measurements || []).filter((m?: any) => inside(m?.d)).length,
    };
}
