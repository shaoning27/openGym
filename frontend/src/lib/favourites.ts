// Legacy dynamic types are explicit during the full language migration.
// Favourite exercises (issue #6): a personal shortlist that floats to the top of the picker,
// the Library and the muscle explorer so building a routine takes fewer scrolls.
//
// Stored as a flat id list in synced state (S.favEx) — catalogue or custom ids alike. It is
// personal, so it stays out of shared plan bundles (lib/plan-share.ts) on purpose. Profiles
// written before the field existed simply have no list, hence every reader tolerates undefined.
export const favIds: any = (S?: any) => (Array.isArray(S?.favEx) ? S.favEx : []);
export const isFav: any = (S?: any, id?: any) => favIds(S).includes(id);
/** Flip one exercise in a state draft. Returns true when it is a favourite afterwards. */
export function toggleFav(s?: any, id?: any) {
    const list: any = favIds(s);
    const on: any = !list.includes(id);
    s.favEx = on ? [...list, id] : list.filter((x?: any) => x !== id);
    return on;
}
/**
 * Favourites first, everything else after — both halves keep the order they came in, so a
 * list that is already sorted by name (or by usage) stays that way within each half.
 */
export function sortFavouritesFirst(list?: any, S?: any) {
    const fav: any = favIds(S);
    if (!fav.length)
        return list;
    const set: any = new Set(fav);
    return [...list.filter((e?: any) => set.has(e.id)), ...list.filter((e?: any) => !set.has(e.id))];
}
/**
 * A search's results the way a person scans them: favourites, then the exercises they have
 * already logged or planned (`usage`: id -> count, the picker's "Chosen"), then the rest. Each
 * group keeps the search's own order. Someone who imported years of history types "press" and
 * wants their press on top, not the best name match among 5,000.
 */
export function sortYoursFirst(list?: any, S?: any, usage?: any) {
    const fav: any = new Set(favIds(S));
    const group: any = (e?: any) => (fav.has(e.id) ? 0 : usage?.[e.id] ? 1 : 2);
    if (!fav.size && !list.some((e?: any) => usage?.[e.id]))
        return list;
    return [0, 1, 2].flatMap((g?: any) => list.filter((e?: any) => group(e) === g));
}
/** How often each exercise sits in a routine or a logged workout: id -> count. */
export function usageOf(S?: any) {
    const u: any = {};
    for (const r of S?.routines || [])
        for (const e of r.ex || [])
            u[e.id] = (u[e.id] || 0) + 1;
    for (const w of S?.workouts || [])
        for (const e of w.entries || [])
            u[e.id] = (u[e.id] || 0) + 1;
    return u;
}
