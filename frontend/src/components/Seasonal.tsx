// Legacy dynamic types are explicit during the full language migration.
import { Suspense, lazy, useEffect } from 'react';
import { useStore } from '../store/useStore.ts';
import { activeSeason, seasonInWorkout } from '../lib/seasonal.ts';
/* The main bundle's side of the seasonal themes (lib/seasonal.ts): two tiny components that render
   nothing at all unless a theme is showing, and only then fetch its module (seasonal/<id>.jsx,
   its art, CSS and timers). Out of season or switched off, nothing is downloaded, parsed or
   scheduled. seasonal.lazy.test.js keeps it that way: no file but this one names that folder,
   and only through import(). */
const LOADERS: any = {
    halloween: () => import('../seasonal/halloween.tsx'),
};
const mods: any = {};
const modOf: any = (id?: any) => (mods[id] ||= {
    Layer: lazy(() => LOADERS[id]().then((m?: any) => ({ default: m.Layer }))),
    Deco: lazy(() => LOADERS[id]().then((m?: any) => ({ default: m.Deco }))),
});
const useSeason: any = () => useStore((s?: any) => activeSeason(s.S));
// Whether the first screen this session drew was one the theme may decorate. The spider's
// "first open of the day" is an app start, so a start straight into a running workout skips it.
let firstVisible: any = null;
/** The screen-wide layer (the spider, the witch). `hidden` on the workout screen: no theme there. */
export function SeasonalLayer({ hidden = false }: any) {
    const id: any = useSeason();
    if (id && firstVisible === null)
        firstVisible = !hidden;
    // The CSS of a theme is scoped to html[data-season], so a theme switched off mid-session
    // leaves nothing styled behind even though its stylesheet stays loaded.
    useEffect(() => {
        const de: any = document.documentElement;
        if (id)
            de.dataset.season = id;
        else
            delete de.dataset.season;
    }, [id]);
    if (!id || !LOADERS[id])
        return null;
    const { Layer }: any = modOf(id);
    return <Suspense fallback={null}><Layer hidden={hidden} fresh={firstVisible}/></Suspense>;
}
/** One piece of decoration in a view: `spot` names where ('home-hero', 'home-streak', ...).
    `workout` marks a spot on the workout screen or its sheets: those follow the theme's own
    "Also during workouts" switch as well. */
export function SeasonDeco({ spot, workout = false }: any) {
    const season: any = useSeason();
    const inWorkout: any = useStore((s?: any) => seasonInWorkout(s.S));
    const id: any = workout && !inWorkout ? null : season;
    if (!id || !LOADERS[id])
        return null;
    const { Deco }: any = modOf(id);
    return <Suspense fallback={null}><Deco spot={spot}/></Suspense>;
}
