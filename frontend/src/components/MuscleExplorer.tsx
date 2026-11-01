// Legacy dynamic types are explicit during the full language migration.
import { useMemo, useState } from 'react';
import { useStore } from '../store/useStore.ts';
import { BODYPARTS, allExercises, equipmentOf, searchExercises } from '../lib/exercises.ts';
import { activeProfile, exAvailable } from '../lib/equipment.ts';
import { bestWeightFor } from '../lib/history.ts';
import { fmtNum, exCount } from '../lib/format.ts';
import { MUSCLES, MUSCLE_NAME, musclesOf } from '../lib/muscles.ts';
import { t, exerciseNameFor, exerciseNameClass } from '../lib/i18n.ts';
import BodyMap from './BodyMap.tsx';
import { Thumb } from './Media.tsx';
import Icon from './Icon.tsx';
import ExerciseViewToggle from './ExerciseViewToggle.tsx';
import { Button } from './ui.tsx';
import { tappable } from '../lib/use-sheet-keyboard.ts';
import { useAutoMore } from '../lib/use-auto-more.ts';
import { favIds, isFav, sortFavouritesFirst } from '../lib/favourites.ts';
const FAV: any = '☆';
// One explorer for the Library and every catalogue picker. Supplying `onPick` turns
// a result into a selection; without it the explorer behaves like the normal Library.
export default function MuscleExplorer({ onPick, onDetail, onPlan, pickIcon = 'plus', initial = null }: any) {
    const S: any = useStore((s?: any) => s.S);
    const [selected, setSelected]: any = useState(initial);
    const [q, setQ]: any = useState('');
    const [bp, setBp]: any = useState('');
    const [eq, setEq]: any = useState('');
    const [shown, setShown]: any = useState(40);
    const [showAll, setShowAll]: any = useState(false); // ignore the active equipment profile for this session
    const moreRef: any = useAutoMore(() => setShown((s?: any) => s + 40));
    // Same rule as the Library and the picker: the active equipment profile narrows the catalogue
    // (and the per-muscle counts) unless the user asks for everything.
    const profile: any = activeProfile(S);
    const catalog: any = useMemo(() => {
        const all: any = allExercises(S);
        return (profile && !showAll) ? all.filter((e?: any) => exAvailable(S, e)) : all;
    }, [S.customEx, S.equipFilterOn, S.activeEquipId, S.equipProfiles, showAll]);
    const counts: any = useMemo(() => Object.fromEntries(MUSCLES.map((m?: any) => [m,
        catalog.filter((e?: any) => musclesOf(e)[m]).length
    ])), [catalog]);
    const pick: any = (muscle?: any) => { setSelected(muscle === selected ? null : muscle); setEq(''); setShown(40); };
    const targeted: any = selected ? catalog.filter((e?: any) => musclesOf(e)[selected]) : [];
    // The picker's Favourites chip (#669), here for the chosen muscle: '☆' in place of a body part.
    const favOn: any = bp === FAV;
    const favHere: any = targeted.filter((e?: any) => isFav(S, e.id)).length;
    const base: any = searchExercises(targeted.filter((e?: any) => favOn ? isFav(S, e.id) : (!bp || e.bp === bp)), q);
    const eqOpts: any = equipmentOf(base);
    const eqOn: any = eqOpts.includes(eq) ? eq : '';
    // Favourites float to the top of whatever the filters left (issue #6), the rest keeps its order.
    const exercises: any = sortFavouritesFirst(eqOn ? base.filter((e?: any) => e.eq === eqOn) : base, S);
    const choose: any = (ex?: any) => onPick ? onPick(ex) : onDetail(ex);
    // The live count and the × of the Library's search (#338): the count while a search or a
    // filter narrows the muscle's list, the × while there is text.
    const narrowed: any = !!(q.trim() || bp || eqOn);
    return <>
    {profile && <div className="small dim row" style={{ margin: '-4px 2px 10px', gap: 6, alignItems: 'center' }}>
      <Icon name="kettlebell" style={{ fontSize: 13 }}/>
      {showAll ? t('Showing all equipment') : t('Showing what you have in "{0}"', profile.name)}
      <button className="chip nocap" style={{ marginInlineStart: 'auto', padding: '3px 10px', fontSize: 12 }} onClick={() => { setShowAll((v?: any) => !v); setEq(''); setShown(40); }}>
        {showAll ? t('Filter by "{0}"', profile.name) : t('Show all equipment')}
      </button>
    </div>}
    <div className="card">
      <BodyMap className="tappable" body={S.body} selected={selected} onMuscle={pick}/>
      <div className="chips" style={{ marginTop: 10 }}>
        {MUSCLES.map((m?: any) => <button key={m} className={'chip' + (selected === m ? ' on' : '')} aria-pressed={selected === m} onClick={() => pick(m)}>
          {t(MUSCLE_NAME[m])} <span className="dim">{counts[m]}</span>
        </button>)}
      </div>
    </div>

    {!selected && onPick && <div className="empty"><div className="ico"><Icon name="figureStrength"/></div>{t('Choose a muscle to see exercises that train it.')}</div>}

    {selected && <>
      <div className="row between" style={{ margin: '2px 0 10px' }}>
        <h4 className="sec" style={{ margin: 0 }}>{t('Exercises for {0}', t(MUSCLE_NAME[selected]))}</h4>
        <Button size="sm" variant="ghost" onClick={() => pick(selected)}>{t('Clear selection')}</Button>
      </div>
      <div className="search-row" style={{ marginBottom: 10 }}><div className={'search' + (narrowed ? ' has-count' : '') + (q ? ' has-clear' : '')}><svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/></svg>
        <input className="input" placeholder={t('Search…')} value={q} onChange={(e?: any) => { setQ(e.target.value); setShown(40); }}/>
        {narrowed && <span className="search-count" role="status" aria-label={exCount(exercises.length)}>{fmtNum(exercises.length)}</span>}
        {q && <button className="clear" onClick={() => { setQ(''); setShown(40); }} aria-label={t('Clear')}><Icon name="xmark"/></button>}
      </div><ExerciseViewToggle /></div>
      {/* Changing body part keeps the equipment filter (issue #71, same rule as Library): the
                eqOn fallback above drops it only for this view if the new body part has nothing under
                it, without forgetting the choice. "All" clears it, since it spans every body part. */}
      <div className="chips" style={{ marginBottom: eqOpts.length > 1 ? 8 : 12 }}>
        {favIds(S).length > 0 && <button className={'chip' + (favOn ? ' on' : '')} onClick={() => { setBp(FAV); setEq(''); setShown(40); }}><Icon name="starFill" className="fav-star"/>{t('Favourites')} ({favHere})</button>}
        <button className={'chip nocap' + (!bp ? ' on' : '')} onClick={() => { setBp(''); setEq(''); setShown(40); }}>{t('All')}</button>
        {BODYPARTS.map((b?: any) => <button key={b} className={'chip' + (bp === b ? ' on' : '')} onClick={() => { setBp(b); setShown(40); }}>{t(b)}</button>)}
      </div>
      {eqOpts.length > 1 && <div className="chips" style={{ marginBottom: 12 }}>
        <button className={'chip nocap' + (!eqOn ? ' on' : '')} onClick={() => { setEq(''); setShown(40); }}>{t('Any equipment')}</button>
        {eqOpts.map((x?: any) => <button key={x} className={'chip' + (eqOn === x ? ' on' : '')} onClick={() => { setEq(x); setShown(40); }}>{t(x)}</button>)}
      </div>}
      <div className={'list' + (S.exerciseView === 'cards' ? ' ex-grid' : '')}>
        {exercises.slice(0, shown).map((e?: any) => {
                const best: any = bestWeightFor(S, e.id);
                const primary: any = musclesOf(e)[selected] === 1;
                return <div key={e.id} className="item" {...tappable(() => choose(e))}>
            <Thumb ex={e}/>
            <div className="grow"><div className={`tt ${exerciseNameClass(e)}`}>{isFav(S, e.id) && <Icon name="starFill" className="fav-star"/>}{exerciseNameFor(e)}</div><div className="ss">{t(primary ? 'Primary target' : 'Also trains')} · <span className="capitalize">{t(MUSCLE_NAME[e.tg] || e.tg || e.bp)} · {t(e.eq)}</span></div></div>
            {onPick ? <Icon name={pickIcon} className="chev"/> : <>
              {best > 0 && <span className="tag acc">{fmtNum(best)}</span>}
              <Button size="sm" variant="tinted" icon="plus" onClick={(ev?: any) => { ev.stopPropagation(); onPlan(e); }}>{t('Plan')}</Button>
            </>}
          </div>;
            })}
        {exercises.length === 0 && <div className="empty"><div className="ico"><Icon name="magnifier"/></div>{t('No match')}</div>}
      </div>
      {exercises.length > shown && <><div style={{ height: 10 }}/><Button ref={moreRef} onClick={() => setShown((s?: any) => s + 40)}>{t('Show more')}</Button></>}
    </>}
  </>;
}
