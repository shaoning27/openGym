// Legacy dynamic types are explicit during the full language migration.
// Lets non-component modules (sheet flows) navigate. App registers the router's navigate.
let _nav: any = () => { };
export const setNav: any = (fn?: any) => { _nav = fn; };
// `opts` goes to the router as is ({ replace: true }).
export const nav: any = (to?: any, opts?: any) => (opts ? _nav(to, opts) : _nav(to));
// The route each history entry showed, by the router's index for it (App.tsx notes every one), so a
// back button that walks history (Settings) can say where it goes: the edge swipe back shows that
// page underneath while the finger moves (lib/edge-swipe-back.ts).
const pathAt: any = new Map();
const idxNow: any = () => { try {
    return Number(globalThis.history?.state?.idx) || 0;
}
catch {
    return 0;
} };
export const notePath: any = (path?: any, key?: any) => { pathAt.set(idxNow(), { path, key: key || null }); };
export const pathBefore: any = () => (idxNow() > 0 ? pathAt.get(idxNow() - 1)?.path || null : null);
/** The router key of the entry before this one, when it showed `path`: the page underneath an
 *  edge swipe back is that entry's page, and a view keyed on its entry (Settings' search) reads it. */
export const keyBefore: any = (path?: any) => { const e: any = idxNow() > 0 ? pathAt.get(idxNow() - 1) : null; return e && e.path === path ? e.key : null; };
// Every open sheet sits on a history entry of its own (Modals.tsx), and closing it walks back
// only while the page is still where the sheet opened. A sheet that closes and moves to another
// page at once left that entry behind: back from the new page landed on it, the same page with
// no sheet, and the next back seemed to do nothing. The new page takes the sheet's entry instead.
export const onSheetEntry: any = () => {
    try {
        return !!globalThis.history?.state?.openGymSheet;
    }
    catch {
        return false;
    }
};
export function closeThenNav(close?: any, to?: any) {
    const replace: any = onSheetEntry();
    close();
    nav(to, replace ? { replace: true } : undefined);
}
// Into the workout screen: from the routine chooser (already #/workout) or from a sheet's entry,
// the session takes that entry, so one back leaves it rather than landing on itself.
export function navToWorkout() {
    const here: any = String(globalThis.location?.hash || '').startsWith('#/workout');
    nav('/workout', here || onSheetEntry() ? { replace: true } : undefined);
}
