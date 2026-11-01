// Legacy dynamic types are explicit during the full language migration.
// What a swap picker opens on (#473): the exercises that train the same target muscle as the one
// being replaced, the ones on the same equipment first. A machine that is taken is usually
// swapped for another way to hit the same muscle, often on the same kind of kit.
//
// `tg` is the catalogue's one-word target (a custom exercise keeps the primary picked first, see
// CustomExForm), so "same muscle" means the same primary, not merely the same body part.
/** The target muscle a swap away from `ex` should start on, or '' when it has none. */
export const swapMuscleOf: any = (ex?: any) => (ex && typeof ex.tg === 'string' ? ex.tg : '');
/**
 * The exercises in `list` sharing `ex`'s target muscle, `ex` itself left out, those on its
 * equipment first. Otherwise the list's own order is kept (Array#sort is stable), so favourites
 * floated to the top earlier stay on top within each half.
 */
export function sameMuscleFirst(list?: any, ex?: any) {
    const tg: any = swapMuscleOf(ex);
    if (!tg)
        return [];
    const eq: any = ex.eq || '';
    return list
        .filter((e?: any) => e && e.tg === tg && e.id !== ex.id)
        .sort((a?: any, b?: any) => Number(!!eq && b.eq === eq) - Number(!!eq && a.eq === eq));
}
