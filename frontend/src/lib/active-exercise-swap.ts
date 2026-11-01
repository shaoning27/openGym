// Legacy dynamic types are explicit during the full language migration.
import { supersetUnits, unitOf } from './history.ts';
function hasLoggedSet(entry?: any) {
    return Array.isArray(entry?.sets) && entry.sets.some((set?: any) => set?.done === true);
}
/**
 * Swap one exact active-workout occurrence.
 *
 * Unlogged occurrences are replaced in place. Logged results are never relabelled: after explicit
 * confirmation, the replacement is inserted beside the original. A logged group member also
 * requires an explicit choice to keep the replacement in the group or detach it after the group.
 */
export function swapActiveExercise(active?: any, index?: any, replacement?: any, { loggedConfirmed = false, groupDisposition }: any = {}) {
    if (!active || !Array.isArray(active.entries) || !replacement || index < 0 || index >= active.entries.length)
        return null;
    const current: any = active.entries[index];
    if (!hasLoggedSet(current)) {
        const metadata: any = Object.fromEntries(Object.entries(current).filter(([key]: any) => (!['id', 'target', 'plan', 'planned', 'carried', 'sets', 'sg'].includes(key))));
        active.entries[index] = { ...metadata, ...replacement, ...(current.sg ? { sg: current.sg } : {}) };
        active.cur = index;
        return { inserted: false, index };
    }
    if (!loggedConfirmed)
        return { needsConfirmation: true, grouped: !!current.sg, index };
    if (current.sg && !['keep', 'detach'].includes(groupDisposition)) {
        return { needsConfirmation: true, grouped: true, index };
    }
    const unit: any = unitOf(supersetUnits(active.entries), index);
    const keepGroup: any = current.sg && groupDisposition === 'keep';
    const insertAt: any = keepGroup ? index + 1 : (unit.length > 1 ? unit.at(-1) + 1 : index + 1);
    active.entries.splice(insertAt, 0, {
        ...replacement,
        // A swap does not change which routine the slot belongs to — carry its `rid` the same
        // way `sg` is carried, so a combined session's WorkoutDetail groups stay contiguous.
        ...(current.rid ? { rid: current.rid } : {}),
        ...(keepGroup ? { sg: current.sg } : {})
    });
    active.cur = insertAt;
    return { inserted: true, index: insertAt };
}
