// Legacy dynamic types are explicit during the full language migration.
import { useMemo, useState } from 'react';
import { useStore } from '../store/useStore.ts';
import { useUI } from '../store/useUI.ts';
import { t } from '../lib/i18n.ts';
import { fmtNum } from '../lib/format.ts';
import { isWarmupRow } from '../lib/workout-model.ts';
import { sessionLoad, sessionLevels, MUSCLES, MUSCLE_NAME } from '../lib/muscles.ts';
import BodyMap from './BodyMap.tsx';
import { Button } from './ui.tsx';
// What the running session hits (#670): a tiny body in the workout header that lights up as sets
// are ticked, and a sheet behind it with the full map and done/planned sets per muscle. The
// header re-renders on every keystroke in a set row, so the load is worked out again only when
// the exercises or their ticks change, not when a weight is typed.
const tickKey: any = (entries?: any) => (entries || []).map((e?: any) => e.id + ':' + (e.sets || []).map((s?: any) => (isWarmupRow(s) ? 'w' : s.done ? '1' : '0')).join('')).join('|');
export function useSessionLoad(entries?: any) {
    const key: any = tickKey(entries);
    // eslint-disable-next-line react-hooks/exhaustive-deps
    return useMemo(() => sessionLoad(entries), [key]);
}
const any: any = (load?: any) => MUSCLES.some((m?: any) => (load[m] || 0) > 0);
/** The header button. Nothing at all until the session has a working set to show. */
export function SessionMapButton({ entries, body }: any) {
    const load: any = useSessionLoad(entries);
    const levels: any = useMemo(() => sessionLevels(load), [load]);
    if (!any(load.planned))
        return null;
    return <button type="button" className="iconbtn whdr-map" data-session-map aria-label={t('What this session hits')} title={t('What this session hits')} onClick={sessionMusclesSheet}>
    <BodyMap className="bm-mini bm-session" levels={levels} body={body}/>
  </button>;
}
// A secondary muscle counts as part of a set (bench is 0.4 of a set for the shoulders), which is
// right for the bar but reads odd as "1/11.2". The numbers say whole sets; a little that would
// round to nothing says "<1", so a muscle on the list never reads as 0 planned.
const sets: any = (v?: any) => (v > 0 && v < 0.5 ? '<1' : fmtNum(Math.round(v)));
const ROWS: any = 6;
// The sheet reads the live session itself, so a set ticked behind it (the watch, another tab)
// shows up while it is open.
export function SessionMuscles({ close }: any) {
    const entries: any = useStore((s?: any) => s.S.active?.entries);
    const body: any = useStore((s?: any) => s.S.body);
    const load: any = useSessionLoad(entries);
    const levels: any = useMemo(() => sessionLevels(load), [load]);
    const [all, setAll]: any = useState(false);
    const { done, planned }: any = load;
    const muscles: any = MUSCLES.filter((m?: any) => (planned[m] || 0) > 0)
        .sort((a?: any, b?: any) => (done[b] || 0) - (done[a] || 0) || planned[b] - planned[a] || MUSCLES.indexOf(a) - MUSCLES.indexOf(b));
    return <div className="sm-sheet">
    <div className="row between" style={{ marginBottom: 8 }}>
      <h3 style={{ margin: 0 }}>{t('What this session hits')}</h3>
      <Button size="sm" variant="ghost" onClick={close}>{t('Done')}</Button>
    </div>
    <BodyMap className="bm-session" levels={levels} body={body}/>
    <div className="hm-legend sm-legend">
      <span className="hm-c l4"/>{t('Already worked')}<span className="hm-c l1"/>{t('Still to come')}
    </div>
    {(all ? muscles : muscles.slice(0, ROWS)).map((m?: any) => {
            const d: any = done[m] || 0;
            const p: any = planned[m];
            return <div className="mrow" key={m} data-muscle-session={m}>
        <span className="nm">{t(MUSCLE_NAME[m])}</span>
        <span className="bar"><i style={{ width: Math.round(Math.min(d / p, 1) * 100) + '%' }}/></span>
        <span className="v sess" aria-label={`${t('Completed')} ${t('{0} sets', sets(d))} · ${t('Planned')} ${t('{0} sets', sets(p))}`}>
          {sets(d)}/{sets(p)}
        </span>
      </div>;
        })}
    {muscles.length > ROWS && <>
      <div style={{ height: 8 }}/>
      <Button trailingIcon={all ? 'chevronUp' : 'chevronDown'} aria-expanded={all} onClick={() => setAll((v?: any) => !v)}>
        {t(all ? 'Show less' : 'Show more')}
      </Button>
    </>}
  </div>;
}
/** Opens the session's muscle sheet from the workout header. */
export function sessionMusclesSheet() {
    return useUI.getState().openSheet((close?: any) => <SessionMuscles close={close}/>);
}
