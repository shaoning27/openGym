// Legacy dynamic types are explicit during the full language migration.
import { useDeferredValue, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useStore } from '../store/useStore.ts';
import { EXDB, BODYPARTS, allExercises, equipmentOf, byCategory, searchExercises, similarExercises } from '../lib/exercises.ts';
import { MUSCLE_NAME } from '../lib/muscles.ts';
import { activeProfile, exAvailable } from '../lib/equipment.ts';
import { bestWeightFor } from '../lib/history.ts';
import { fmtNum, exCount } from '../lib/format.ts';
import { t, tn, exerciseNameFor, exerciseNameClass } from '../lib/i18n.ts';
import { Thumb } from '../components/Media.tsx';
import { exerciseDetailSheet, addToRoutineSheet, customExSheet } from '../sheets.tsx';
import Icon from '../components/Icon.tsx';
import ExerciseViewToggle from '../components/ExerciseViewToggle.tsx';
import { Button } from '../components/ui.tsx';
import { tappable, useRevealActiveChip } from '../lib/use-sheet-keyboard.ts';
import { useAutoMore } from '../lib/use-auto-more.ts';
import { isFav, sortFavouritesFirst, sortYoursFirst, usageOf } from '../lib/favourites.ts';
export default function Library() {
    const nav: any = useNavigate();
    const S: any = useStore((s?: any) => s.S);
    const [q, setQ]: any = useState('');
    const [bp, setBp]: any = useState('');
    const [eq, setEq]: any = useState('');
    const [cat, setCat]: any = useState('');
    const [showAll, setShowAll]: any = useState(false); // ignore the active equipment profile for this session
    const [shown, setShown]: any = useState(40);
    const bpStrip: any = useRef(null), eqStrip: any = useRef(null), catStrip: any = useRef(null);
    const moreRef: any = useAutoMore(() => setShown((s?: any) => s + 40));
    const profile: any = activeProfile(S);
    // Your own exercises, counted the way the list below shows them (allExercises puts every
    // custom entry in front of the catalogue; deleting one removes it from customEx outright).
    const ownCount: any = (S.customEx || []).filter((c?: any) => c && c.id).length;
    const inPart: any = searchExercises(allExercises(S).filter((e?: any) => !bp || e.bp === bp), q);
    // Kind of exercise (strength, stretching, cardio...), the same fallback as equipment below: a
    // choice the search or body part has narrowed away is ignored for now, never a dead end.
    const { opts: catOpts, on: catOn, list: base }: any = byCategory(inPart, cat);
    const eqFiltered: any = (profile && !showAll) ? base.filter((e?: any) => exAvailable(S, e)) : base;
    const eqOpts: any = equipmentOf(eqFiltered);
    // Drop the equipment filter if the search narrowed it away, so you never hit a dead end.
    const eqOn: any = eqOpts.includes(eq) ? eq : '';
    // Favourites float to the top of whatever the filters left (issue #6), the rest keeps its order;
    // while searching, the exercises you have logged or planned follow right after them.
    const narrowedList: any = eqOn ? eqFiltered.filter((e?: any) => e.eq === eqOn) : eqFiltered;
    const usage: any = useMemo(() => (q.trim() ? usageOf(S) : null), [q, S.routines, S.workouts]);
    const f: any = usage ? sortYoursFirst(narrowedList, S, usage) : sortFavouritesFirst(narrowedList, S);
    useRevealActiveChip(bpStrip, bp);
    useRevealActiveChip(eqStrip, eqOn);
    useRevealActiveChip(catStrip, catOn);
    // A live count at the end of the search field while a search or filter narrows the list
    // (idea and first version: GitLab !31) — how many are left, before scrolling to find out.
    const narrowed: any = !!(q.trim() || bp || eqOn || catOn);
    // Close but not exact (a typo too many, most of the words, a similar name), under the results
    // once they are all on screen, so a search almost never ends on "No match".
    // Worked out a beat behind the typing (useDeferredValue): the list itself never waits for it.
    const qLate: any = useDeferredValue(q);
    const similar: any = q.trim() && qLate === q && f.length <= shown
        ? similarExercises(allExercises(S).filter((e?: any) => (!bp || e.bp === bp) && (!profile || showAll || exAvailable(S, e))), q, f, f.length ? 12 : 30)
        : [];
    const row: any = (e?: any) => {
        const best: any = bestWeightFor(S, e.id);
        return <div key={e.id} className="item" {...tappable(() => exerciseDetailSheet(e))}>
      <Thumb ex={e}/>
      <div className="grow"><div className={`tt ${exerciseNameClass(e)}`}>{isFav(S, e.id) && <Icon name="starFill" className="fav-star"/>}{exerciseNameFor(e)}</div><div className="ss capitalize">{t(MUSCLE_NAME[e.tg] || e.tg || e.bp)} · {t(e.eq)}</div></div>
      {best > 0 && <span className="tag acc">{fmtNum(best)}</span>}
      <Button size="sm" variant="tinted" icon="plus" onClick={(ev?: any) => { ev.stopPropagation(); addToRoutineSheet(e); }}>{t('Plan')}</Button>
    </div>;
    };
    return <>
    <div className="hdr lib-hdr"><div><h1>{t('Exercises')}</h1></div>
      <Button size="sm" variant="tinted" icon="figureStrength" onClick={() => nav('/muscles')}>{t('By muscle')}</Button>
      <div className="sub lib-count">{ownCount
            ? tn('{1} animated exercises + 1 of your own', '{1} animated exercises + {0} of your own', ownCount, EXDB.length)
            : t('{0} exercises with animations', EXDB.length)}</div>
    </div>
    <div className="search-row" style={{ marginBottom: 10 }}><div className={'search' + (narrowed ? ' has-count' : '') + (q ? ' has-clear' : '')}><svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/></svg>
      <input className="input" placeholder={t('Search…')} value={q} onChange={(e?: any) => { setQ(e.target.value); setShown(40); }}/>
      {narrowed && <span className="search-count" role="status" aria-label={exCount(f.length)}>{fmtNum(f.length)}</span>}
      {q && <button className="clear" onClick={() => { setQ(''); setShown(40); }} aria-label={t('Clear')}><Icon name="xmark"/></button>}</div>
      <ExerciseViewToggle /></div>
    {profile && <div className="small dim row" style={{ margin: '-4px 2px 10px', gap: 6, alignItems: 'center' }}>
      <Icon name="kettlebell" style={{ fontSize: 13 }}/>
      {showAll ? t('Showing all equipment') : t('Showing what you have in "{0}"', profile.name)}
      <button className="chip nocap" style={{ marginInlineStart: 'auto', padding: '3px 10px', fontSize: 12 }} onClick={() => setShowAll((v?: any) => !v)}>
        {showAll ? t('Filter by "{0}"', profile.name) : t('Show all equipment')}
      </button>
    </div>}
    {/* Changing body part keeps the equipment filter (issue #71): the eqOn fallback above drops
            it only for the current view if the new body part has nothing under it, without forgetting
            the choice. "All" clears it, since it spans every body part. */}
    <div className="chips" ref={bpStrip} style={{ marginBottom: eqOpts.length > 1 || catOpts.length > 1 ? 8 : 12 }}>
      <button className={'chip nocap' + (!bp ? ' on' : '')} onClick={() => { setBp(''); setEq(''); setShown(40); }}>{t('All')}</button>
      {BODYPARTS.map((b?: any) => <button key={b} className={'chip' + (bp === b ? ' on' : '')} onClick={() => { setBp(b); setShown(40); }}>{t(b)}</button>)}
    </div>
    {catOpts.length > 1 && <div className="chips" ref={catStrip} style={{ marginBottom: 8 }}>
      <button className={'chip nocap' + (!catOn ? ' on' : '')} onClick={() => { setCat(''); setShown(40); }}>{t('Any type')}</button>
      {catOpts.map((x?: any) => <button key={x} className={'chip' + (catOn === x ? ' on' : '')} onClick={() => { setCat(x); setShown(40); }}>{t(x)}</button>)}
    </div>}
    {eqOpts.length > 1 && <div className="chips" ref={eqStrip} style={{ marginBottom: 12 }}>
      <button className={'chip nocap' + (!eqOn ? ' on' : '')} onClick={() => { setEq(''); setShown(40); }}>{t('Any equipment')}</button>
      {eqOpts.map((x?: any) => <button key={x} className={'chip' + (eqOn === x ? ' on' : '')} onClick={() => { setEq(x); setShown(40); }}>{t(x)}</button>)}
    </div>}
    <div className={'list' + (S.exerciseView === 'cards' ? ' ex-grid' : '')}>
      <div className="item ex-new" {...tappable(() => customExSheet(null, (ex?: any) => exerciseDetailSheet(ex), q.trim()))}>
        <div className="thumb thumb-x"><Icon name="plusCircle"/></div>
        <div className="grow"><div className="tt">{t('Create your own exercise')}</div><div className="ss">{t('name + body part, and a photo or video if you like')}</div></div><Icon name="plus" className="chev"/>
      </div>
      {f.slice(0, shown).map(row)}
      {f.length === 0 && !similar.length && <div className="empty"><div className="ico"><Icon name="magnifier"/></div>{t('No match')}</div>}
      {similar.length > 0 && <h4 className="sec similar-label">{f.length ? t('Similar exercises') : t('No exact match. These come close:')}</h4>}
      {similar.map(row)}
    </div>
    {f.length > shown && <><div style={{ height: 10 }}/><Button ref={moreRef} onClick={() => setShown((s?: any) => s + 40)}>{t('Show more')}</Button></>}
  </>;
}
