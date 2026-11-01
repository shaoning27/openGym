// Legacy dynamic types are explicit during the full language migration.
// A finished workout as plain text, for "Copy as text" in its detail sheet (Discord 'Improvement
// ideas'): something to paste into a chat, a coach's spreadsheet or a notes app. The sets are the
// same labels the history shows, so a drop-set or a rest-pause set reads the same in both.
// i18n-core rather than i18n, like history.ts: nothing here needs the React half.
import { setLabel, sessionSections, workoutVolume } from './history.ts';
import { EXIDX } from './exercises.ts';
import { hasCompletedWork, isWarmupRow } from './workout-model.ts';
import { fmtDate, fmtNum, fmtVol, durPart, capWords } from './format.ts';
import { t, exerciseNameClass } from './i18n-core.ts';
/**
 * `unit` is the profile's, `nameOf(entry)` the exercise's display name, `speedUnit` the one cardio
 * is shown in (lib/speed.ts; km/h when absent). Blocks are separated by a blank line: the heading,
 * then each exercise (a superset's under one "Superset" line, its members together), then the
 * session note.
 */
export function workoutText(w?: any, { unit, nameOf, speedUnit, warmups = false }: any = undefined as any) {
    const facts: any = [
        ...durPart((w.end || 0) - (w.start || 0)),
        // `warmups`: the profile counts warm-ups in volume (#719); the set list below stays work sets.
        fmtVol(warmups ? workoutVolume(w, { warmups }) : (w.vol ?? workoutVolume(w)), unit),
        ...(w.bw ? [t('Body weight') + ' ' + fmtNum(w.bw) + ' ' + unit] : []),
    ];
    const blocks: any = [[[w.name, fmtDate(w.d, true, true)].filter(Boolean).join(' · '), facts.join(' · ')].join('\n')];
    // Work sets only: the text is what you trained, the work the volume above counts. Warm-ups are
    // left out of volume, records and progression everywhere else, and listed here with nothing to
    // tell them apart they would read as sets of their own.
    const lines: any = (entry?: any) => {
        const sets: any = (entry.sets || []).filter((s?: any) => hasCompletedWork(s) && !isWarmupRow(s));
        if (!sets.length)
            return null;
        // Title case the way the screen shows it (exerciseNameClass): an English name gets it, a
        // translated one keeps its own casing, which German's capitalised nouns depend on.
        const name: any = nameOf(entry);
        return [exerciseNameClass(EXIDX[entry.id]) ? capWords(name) : name, sets.map((s?: any) => setLabel(entry.id, s, entry.target, speedUnit)).join(', '), ...(entry.note ? [entry.note] : [])];
    };
    // Grouped the way the detail sheet groups it (sessionSections): per routine first, so a
    // superset is only ever paired inside one routine's section, in the order the sheet lists them.
    const entries: any = w.entries || [];
    for (const group of sessionSections(entries).flatMap((section?: any) => section.units)) {
        const members: any = group.map((i?: any) => lines(entries[i])).filter(Boolean);
        if (!members.length)
            continue;
        blocks.push([...(members.length > 1 ? [t('Superset')] : []), ...members.flat()].join('\n'));
    }
    if (w.note)
        blocks.push(w.note);
    return blocks.join('\n\n');
}
