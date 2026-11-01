// Legacy dynamic types are explicit during the full language migration.
// Browser-only shell of the i18n module. The runtime-agnostic state and readers live
// in i18n-core.ts (plain Node-loadable); this file adds the two pieces that genuinely need
// the browser: `setLang` (which lazy-loads locale packs via import.meta.glob) and the React
// subscription hook `useLang`.
import { useSyncExternalStore } from 'react';
import { LANGS, INSTR_LANGS, EXERCISE_NAME_LANGS, DATE_LOCALES, DERIVED_LOCALES, RTL_LANGS, getLang, dateLocale, t, tn, instrFor, exerciseNameFor, exerciseNameSearchText, getVersion, baseLang, derivePack, _setLangState, exerciseNameClass, descFor, instrTranslated, _setDetailsLoader, _setDetails, _detailsFailed } from './i18n-core.ts';
export { LANGS, INSTR_LANGS, EXERCISE_NAME_LANGS, DATE_LOCALES, DERIVED_LOCALES, RTL_LANGS, getLang, dateLocale, t, tn, instrFor, instrTranslated, descFor, exerciseNameFor, exerciseNameSearchText, exerciseNameClass, baseLang };
// Vite code-splits locale, instruction and exercise-name packs via import.meta.glob. They are
// lazy, so the production bundle ships English only until another language is selected.
const localePacks: any = import.meta.glob('../locales/*.js');
const instrPacks: any = import.meta.glob('../instr/*.js');
const exerciseNamePacks: any = import.meta.glob('../exercise-names/*.js');
const descPacks: any = import.meta.glob('../exercise-desc/*.js');
// English steps and descriptions, plus the language's own descriptions where it has some: fetched
// the first time any screen asks for an exercise's details (i18n-core askDetails), and again for
// the descriptions whenever the language changes after that.
let detailsLoaded: any = false;
async function loadDetails() {
    const l: any = getLang();
    const base: any = baseLang(l);
    const load: any = async (packs?: any, key?: any) => { try {
        return packs[key] ? (await packs[key]()).default : null;
    }
    catch (e: any) {
        return null;
    } };
    const [en, enDesc, desc]: any = await Promise.all([
        load(instrPacks, '../instr/en.js'),
        load(descPacks, '../exercise-desc/en.js'),
        base === 'en' ? null : load(descPacks, '../exercise-desc/' + base + '.js'),
    ]);
    // Either English pack missing is a failed load (both always exist): core asks again later.
    if (en && enDesc)
        detailsLoaded = true;
    // The language changed while this loaded (setLang only reloads once a load has finished): the
    // descriptions are the old language's, so the new one's are loaded instead.
    const current: any = _setDetails(en, enDesc, derivePack(l, desc), l);
    if (!en || !enDesc)
        _detailsFailed();
    notify();
    if (!current)
        return loadDetails();
}
_setDetailsLoader(loadDetails);
// React subscription bookkeeping — kept here, not in core, so core has zero React coupling.
const subs: any = new Set();
const notify: any = () => { subs.forEach((f?: any) => f()); };
let lastShowEn: any = undefined;
let lastEnOnly: any = undefined;
export async function setLang(l?: any, showEn?: any, enOnly?: any) {
    if (!LANGS[l])
        l = 'en';
    const show: any = showEn !== false;
    const only: any = enOnly === true;
    // Both display switches participate in the early-exit, so toggling the parens or the
    // English-only switch re-applies state even when l did not change.
    if (l === getLang() && getVersion() > 0 && show === lastShowEn && only === lastEnOnly)
        return;
    // A derived locale (de-CH) ships no packs of its own: it loads its base language's and
    // transforms the strings on the way through. `l` stays the selected language throughout, so
    // dateLocale() still reports de-CH and formats numbers Swiss-style.
    lastShowEn = show;
    lastEnOnly = only;
    const base: any = baseLang(l);
    // The three packs are fetched side by side: one after the other, a start in any language but
    // English waited three round trips before Home could draw.
    const pack: any = async (packs?: any, key?: any, fallback?: any) => { try {
        return (await packs[key]()).default;
    }
    catch (e: any) {
        return fallback;
    } };
    const [dict, instr, exerciseNames]: any = await Promise.all([
        base === 'en' ? {} : pack(localePacks, '../locales/' + base + '.js', {}),
        base === 'en' || !INSTR_LANGS.includes(base) ? null : pack(instrPacks, '../instr/' + base + '.js', null),
        base === 'en' || !EXERCISE_NAME_LANGS.includes(base) ? null : pack(exerciseNamePacks, '../exercise-names/' + base + '.js', null),
    ]);
    _setLangState(l, derivePack(l, dict), derivePack(l, instr), derivePack(l, exerciseNames), show, only);
    if (detailsLoaded)
        loadDetails();
    document.documentElement.lang = l;
    document.documentElement.dir = RTL_LANGS.has(l) ? 'rtl' : 'ltr';
    notify();
}
/** Called after every language change (the Apple Watch link sends the watch its new words). */
export function onLangChange(fn?: any) { subs.add(fn); return () => subs.delete(fn); }
// Re-renders the subscribing component (and its children) whenever the language changes.
export function useLang() {
    return useSyncExternalStore((fn?: any) => { subs.add(fn); return () => subs.delete(fn); }, getVersion);
}
