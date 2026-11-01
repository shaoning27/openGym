// Legacy dynamic types are explicit during the full language migration.
import { useEffect, useRef, useState } from 'react';
import { fmtVol, isoOf, todayISO, MONTHS, weekStartOf, weekDayOffset } from '../lib/format.ts';
import { workoutDay, workoutDuration, sessionVolume } from '../lib/history.ts';
import { t, tn } from '../lib/i18n.ts';
import { tappable } from '../lib/use-sheet-keyboard.ts';
import { Segmented } from './ui.tsx';
import { dayNoteOf, dayNoteLine } from '../lib/day-notes.ts';
const normalizeMetric: any = (value?: any) => value === 'vol' ? 'vol' : 'time';
// GitHub-style activity heatmap, shaded by the selected time or volume metric per day.
export default function Heatmap({ S, onDay, metric: selectedMetric, onMetricChange }: any) {
    const wrapRef: any = useRef(null);
    const [localMetric, setLocalMetric]: any = useState(() => normalizeMetric(selectedMetric ?? S?.heatmapMetric));
    useEffect(() => { if (wrapRef.current)
        wrapRef.current.scrollLeft = wrapRef.current.scrollWidth; }, []);
    const metric: any = normalizeMetric(selectedMetric ?? localMetric);
    const metricValue: any = metric === 'vol' ? 'vol' : 'min';
    const changeMetric: any = (value?: any) => {
        const next: any = normalizeMetric(value);
        if (selectedMetric == null)
            setLocalMetric(next);
        onMetricChange?.(next);
    };
    const agg: any = {};
    (S.workouts || []).forEach((w?: any) => {
        const day: any = workoutDay(w);
        if (!day)
            return;
        const a: any = agg[day] = agg[day] || { n: 0, vol: 0, min: 0 };
        a.n++;
        // Recounted from the sets (sessionVolume), so units, per-side and the warm-up switch apply.
        a.vol += sessionVolume(w, S);
        a.min += Math.max(0, Math.round(workoutDuration(w) / 60000));
    });
    const values: any = Object.values(agg).map((a?: any) => a[metricValue]).filter((v?: any) => v > 0).sort((a?: any, b?: any) => a - b);
    const q: any = (p?: any) => (values.length ? values[Math.min(values.length - 1, Math.floor(p * values.length))] : 0);
    const t1: any = q(0.25), t2: any = q(0.5), t3: any = q(0.75);
    const level: any = (a?: any) => !a ? 0 : !a[metricValue] ? 1 : a[metricValue] >= t3 ? 4 : a[metricValue] >= t2 ? 3 : a[metricValue] >= t1 ? 2 : 1;
    const today: any = new Date();
    today.setHours(12, 0, 0, 0);
    const ws: any = weekStartOf(S);
    const end: any = new Date(today);
    end.setDate(today.getDate() - weekDayOffset(today.getDay(), ws));
    const start: any = new Date(end);
    start.setDate(end.getDate() - 52 * 7);
    const dayLabels: any = Array(7).fill(null);
    dayLabels[weekDayOffset(1, ws)] = 'Mon';
    dayLabels[weekDayOffset(3, ws)] = 'Wed';
    dayLabels[weekDayOffset(5, ws)] = 'Fri';
    const months: any = [], cols: any = [];
    let lastMonth: any = -1;
    for (let wk: any = 0; wk <= 52; wk++) {
        const colStart: any = new Date(start);
        colStart.setDate(start.getDate() + wk * 7);
        const mo: any = colStart.getMonth();
        const showM: any = mo !== lastMonth && colStart.getDate() <= 7 && wk < 51;
        months.push(<span key={wk}>{showM ? t(MONTHS[mo]) : ''}</span>);
        if (colStart.getDate() <= 7)
            lastMonth = mo;
        const cells: any = [];
        for (let d: any = 0; d < 7; d++) {
            const day: any = new Date(colStart);
            day.setDate(colStart.getDate() + d);
            const key: any = isoOf(day);
            const a: any = agg[key];
            // A day off with a note (#261): outlined, its note in the tooltip, and tappable like a
            // trained day so the note can be read (and changed) on a phone too.
            const note: any = !a && dayNoteOf(S, key);
            const cls: any = 'hm-c l' + level(a) + (note ? ' noted' : '') + (key === todayISO() ? ' today' : '') + (day > today ? ' future' : '');
            cells.push(<div key={d} className={cls} title={key + (a ? ` · ${tn('{0} workout', '{0} workouts', a.n)} · ${t('{0} min', a.min)} · ${fmtVol(a.vol, S.unit)}` : note ? ` · ${dayNoteLine(note, t)}` : '')} {...tappable(a || note ? () => onDay?.(key) : undefined)}/>);
        }
        cols.push(<div key={wk} className="hm-col">{cells}</div>);
    }
    return <>
    <Segmented value={metric} onChange={changeMetric} options={[{ value: 'time', label: t('Time') }, { value: 'vol', label: t('Volume') }]}/>
    <div className="hm-wrap" ref={wrapRef}>
      <div className="hm-months" style={{ marginInlineStart: 30 }}>{months}</div>
      <div className="hm-body">
        <div className="hm-days">{dayLabels.map((lbl?: any, i?: any) => <span key={i}>{lbl ? t(lbl) : ''}</span>)}</div>
        <div className="hm-grid">{cols}</div>
      </div>
    </div>
    <div className="hm-legend">{t(metric === 'vol' ? 'Less volume' : 'Less time')} <div className="hm-c l0"/><div className="hm-c l1"/><div className="hm-c l2"/><div className="hm-c l3"/><div className="hm-c l4"/> {t(metric === 'vol' ? 'More volume' : 'More time')}</div>
  </>;
}
