// Legacy dynamic types are explicit during the full language migration.
// An iOS-style duration picker: two scroll wheels, minutes and seconds, any value in [min, max].
//
// Each wheel is a plain scroller with CSS scroll snapping, so a flick keeps its native momentum
// on iPhone Safari and in the Android WebView, and a mouse wheel or a trackpad scrolls it on a
// desktop. Where it comes to rest is the value: a short pause in the scroll events (or the
// `scrollend` event, where there is one) reads the row under the highlight band and reports it.
// A value outside the range (15:30 on a 15:00 wheel, 0:03 on a 5-second minimum) is reported
// clamped and the wheel rolls back to it, the way the iOS timer does.
//
// Keyboard and screen readers get one spinbutton per wheel: arrows step by one, Page Up/Down by
// a bigger step, Home/End jump to the ends. Both carry the whole duration as aria-valuetext
// ("1 minute 30 seconds"), so either wheel tells you what is set.
//
// The wheels are laid out left to right in every language (minutes first, the way a duration is
// written in digits); the unit labels follow the page direction.
//
//   <DurationWheel value={sec} onChange={setSec} max={900} off={t('Off')} />
//   durationSheet({ title, value, max, off, onDone: sec => … })   // the sheet with a Done button
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { t } from '../lib/i18n.ts';
import { vibrate } from '../lib/sound.ts';
import { useUI } from '../store/useUI.ts';
import { REST_MAX, clampDuration, splitDuration, joinDuration, fmtDuration, durationText } from '../lib/duration.ts';
import { Button } from './ui.tsx';
// One row of a wheel, in CSS px. Kept in step with --dw-item in index.css.
export const WHEEL_ITEM: any = 40;
// How long the scroll events have to stop before the wheel counts as settled, where the browser
// has no `scrollend` (Safari before 18.x, older WebViews).
export const SETTLE_MS: any = 120;
const pad2: any = (n?: any) => String(n).padStart(2, '0');
/**
 * One wheel. `index` is what the parent holds; `onPick(i)` is called when the wheel comes to
 * rest on another row. `nonce` re-syncs the wheel to `index` after a pick the parent clamped.
 * `rowRef.current()` answers the row under the band right now, settled or not.
 */
export function WheelColumn({ count, index, onPick, label, unit, format = String, valueText, disabledAt, step = 10, nonce = 0, rowRef }: any) {
    const scroller: any = useRef(null);
    const live: any = useRef(index); // the row under the band right now
    const touching: any = useRef(false);
    const programmatic: any = useRef(false); // a scroll we started: no tick, no pick on the way
    const settleTimer: any = useRef(null);
    const frame: any = useRef(0);
    const mounted: any = useRef(false);
    const [shown, setShown]: any = useState(index);
    const latest: any = useRef({ index, onPick, count });
    latest.current = { index, onPick, count };
    const clampIdx: any = (i?: any) => Math.max(0, Math.min(count - 1, i));
    const rowAt: any = (el?: any) => clampIdx(Math.round(el.scrollTop / WHEEL_ITEM));
    if (rowRef)
        rowRef.current = () => clampIdx(live.current);
    // The rows near the band lean back like a drum: smaller and fainter the further they are.
    const paint: any = useCallback(() => {
        frame.current = 0;
        const el: any = scroller.current;
        if (!el)
            return;
        const top: any = el.scrollTop;
        const items: any = el.querySelectorAll('.dw-it');
        const first: any = Math.max(0, Math.floor(top / WHEEL_ITEM) - 3);
        const last: any = Math.min(items.length - 1, Math.ceil(top / WHEEL_ITEM) + 3);
        for (let i: any = first; i <= last; i++) {
            const d: any = (i * WHEEL_ITEM - top) / WHEEL_ITEM;
            const a: any = Math.min(3, Math.abs(d));
            items[i].style.transform = `rotateX(${(-d * 20).toFixed(1)}deg) scale(${(1 - a * 0.07).toFixed(3)})`;
            items[i].style.opacity = String(Math.max(0.15, 1 - a * 0.3));
        }
    }, []);
    const scrollToRow: any = useCallback((i?: any, smooth?: any) => {
        const el: any = scroller.current;
        if (!el)
            return;
        const top: any = i * WHEEL_ITEM;
        if (Math.abs(el.scrollTop - top) < 1)
            return;
        programmatic.current = true;
        if (typeof el.scrollTo === 'function')
            el.scrollTo({ top, behavior: smooth ? 'smooth' : 'auto' });
        else
            el.scrollTop = top;
        if (!smooth)
            programmatic.current = false;
    }, []);
    const settle: any = useCallback(() => {
        clearTimeout(settleTimer.current);
        const el: any = scroller.current;
        if (!el || touching.current)
            return;
        const was: any = programmatic.current;
        programmatic.current = false;
        const i: any = rowAt(el);
        // Without snapping (an old engine), finish the job ourselves.
        if (Math.abs(el.scrollTop - i * WHEEL_ITEM) >= 1)
            scrollToRow(i, true);
        if (!was && i !== latest.current.index)
            latest.current.onPick(i);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [scrollToRow, count]);
    // Start where the value is; follow it when it changes from outside (a key, a clamp).
    useLayoutEffect(() => {
        if (touching.current)
            return;
        const el: any = scroller.current;
        if (el && rowAt(el) !== index)
            scrollToRow(index, mounted.current);
        live.current = index;
        setShown(index);
        mounted.current = true;
        if (!frame.current)
            frame.current = requestAnimationFrame(paint);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [index, nonce]);
    useEffect(() => {
        const el: any = scroller.current;
        if (!el)
            return;
        const onScroll: any = () => {
            const i: any = rowAt(el);
            if (i !== live.current) {
                live.current = i;
                setShown(i);
                // the click of a detent, where the phone can give one (Android); iOS has no buzz for a page
                if (!programmatic.current)
                    vibrate(4);
            }
            if (!frame.current)
                frame.current = requestAnimationFrame(paint);
            clearTimeout(settleTimer.current);
            settleTimer.current = setTimeout(settle, SETTLE_MS);
        };
        const onEnd: any = () => settle();
        const down: any = () => { touching.current = true; programmatic.current = false; };
        const up: any = () => { touching.current = false; clearTimeout(settleTimer.current); settleTimer.current = setTimeout(settle, SETTLE_MS); };
        // A mouse wheel moves one row per notch; a trackpad's small deltas scroll natively.
        const onWheel: any = (e?: any) => {
            if (e.ctrlKey)
                return;
            const notch: any = e.deltaMode !== 0 || Math.abs(e.deltaY) >= 50;
            if (!notch || !e.deltaY)
                return;
            e.preventDefault();
            const next: any = clampIdx(live.current + Math.sign(e.deltaY));
            if (next === live.current)
                return;
            programmatic.current = false;
            if (typeof el.scrollTo === 'function')
                el.scrollTo({ top: next * WHEEL_ITEM, behavior: 'smooth' });
            else {
                el.scrollTop = next * WHEEL_ITEM;
                onScroll();
            }
        };
        el.addEventListener('scroll', onScroll, { passive: true });
        el.addEventListener('scrollend', onEnd);
        el.addEventListener('touchstart', down, { passive: true });
        el.addEventListener('touchend', up, { passive: true });
        el.addEventListener('touchcancel', up, { passive: true });
        el.addEventListener('wheel', onWheel, { passive: false });
        return () => {
            el.removeEventListener('scroll', onScroll);
            el.removeEventListener('scrollend', onEnd);
            el.removeEventListener('touchstart', down);
            el.removeEventListener('touchend', up);
            el.removeEventListener('touchcancel', up);
            el.removeEventListener('wheel', onWheel);
            clearTimeout(settleTimer.current);
            cancelAnimationFrame(frame.current);
            frame.current = 0;
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [settle, paint]);
    // Tapping a row above or below the band rolls it in, like on iOS; it counts once it settles.
    const tapRow: any = (i?: any) => {
        const el: any = scroller.current;
        if (!el || i === live.current)
            return;
        programmatic.current = false;
        if (typeof el.scrollTo === 'function')
            el.scrollTo({ top: i * WHEEL_ITEM, behavior: 'smooth' });
        else
            onPick(i);
    };
    const key: any = (e?: any) => {
        const big: any = Math.max(1, step);
        const to: any = ({
            ArrowUp: index + 1, ArrowDown: index - 1, PageUp: index + big, PageDown: index - big, Home: 0, End: count - 1,
        } as any)[e.key];
        if (to === undefined)
            return;
        e.preventDefault();
        const i: any = clampIdx(to);
        if (i !== index)
            onPick(i);
    };
    return (<div className="dw-col" role="spinbutton" tabIndex={0} aria-label={label} aria-valuenow={index} aria-valuemin={0} aria-valuemax={count - 1} aria-valuetext={valueText} onKeyDown={key}>
      <div className="dw-scroll" ref={scroller}>
        <div className="dw-pad" aria-hidden="true"/>
        {Array.from({ length: count }, (_?: any, i?: any) => (<div key={i} aria-hidden="true" className={'dw-it' + (i === shown ? ' on' : '') + (disabledAt && disabledAt(i) ? ' out' : '')} onClick={() => tapRow(i)}>
            <span className="dw-n">{format(i)}</span>
          </div>))}
        <div className="dw-pad" aria-hidden="true"/>
      </div>
      {unit && <span className="dw-unit" aria-hidden="true">{unit}</span>}
    </div>);
}
/**
 * Minutes and seconds wheels for a duration in seconds. `onChange(sec)` gets every value the
 * wheels come to rest on, already clamped to [min, max]. `off` names 0 for a screen reader
 * ("Off" for the rest timer); without it 0 reads as "0 seconds". `readRef.current()` answers the
 * duration the wheels show right now, also while one is still rolling to rest: a Done tapped
 * straight after a flick must not save the value from before it.
 */
export default function DurationWheel({ value, onChange, min = 0, max = REST_MAX, off = null, className = '', readRef }: any) {
    const v: any = clampDuration(value, min, max);
    const { m, s }: any = splitDuration(v);
    const maxM: any = Math.floor(max / 60);
    const [nonce, setNonce]: any = useState(0);
    const live: any = useRef({ m, s });
    live.current = { m, s };
    const mRow: any = useRef(null), sRow: any = useRef(null);
    if (readRef)
        readRef.current = () => joinDuration(mRow.current ? mRow.current() : m, sRow.current ? sRow.current() : s, min, max);
    const pick: any = (mm?: any, ss?: any) => {
        const next: any = joinDuration(mm, ss, min, max);
        setNonce((n?: any) => n + 1); // the wheels go back to what was kept, if it was clamped
        if (next !== v)
            onChange(next);
    };
    const text: any = durationText(v, { off });
    return (<div className={'dw ' + className} data-nodrag="" dir="ltr">
      <span className="dw-band" aria-hidden="true"/>
      <WheelColumn count={maxM + 1} index={m} nonce={nonce} step={5} rowRef={mRow} onPick={(i?: any) => pick(i, live.current.s)} label={t('Minutes')} unit={t('min')} valueText={text} disabledAt={(i?: any) => i * 60 > max || (i + 1) * 60 - 1 < min}/>
      <WheelColumn count={60} index={s} nonce={nonce} step={10} format={pad2} rowRef={sRow} onPick={(i?: any) => pick(live.current.m, i)} label={t('Seconds')} unit={t('sec')} valueText={text} disabledAt={(i?: any) => m * 60 + i > max || m * 60 + i < min}/>
    </div>);
}
/**
 * The same wheels for a longer span in hours and minutes: `value` and `onChange` are minutes,
 * the minutes wheel steps by `step`. The Coach's session length uses it, so it looks like every
 * other time picker in the app.
 */
export function HourMinuteWheel({ value, onChange, min = 10, max = 235, step = 5, className = '' }: any) {
    const clamp: any = (n?: any) => Math.max(min, Math.min(max, Math.round((Number(n) || 0) / step) * step));
    const v: any = clamp(value);
    const h: any = Math.floor(v / 60), mi: any = (v % 60) / step;
    const [nonce, setNonce]: any = useState(0);
    const live: any = useRef({ h, mi });
    live.current = { h, mi };
    const pick: any = (hh?: any, mm?: any) => {
        const next: any = clamp(hh * 60 + mm * step);
        setNonce((n?: any) => n + 1);
        if (next !== v)
            onChange(next);
    };
    const text: any = durationText(v * 60);
    return (<div className={'dw ' + className} data-nodrag="" dir="ltr">
      <span className="dw-band" aria-hidden="true"/>
      <WheelColumn count={Math.floor(max / 60) + 1} index={h} nonce={nonce} step={1} onPick={(i?: any) => pick(i, live.current.mi)} label={t('Hours')} unit={t('h')} valueText={text} disabledAt={(i?: any) => i * 60 > max || i * 60 + 59 < min}/>
      <WheelColumn count={60 / step} index={mi} nonce={nonce} step={3} format={(i?: any) => pad2(i * step)} onPick={(i?: any) => pick(live.current.h, i)} label={t('Minutes')} unit={t('min')} valueText={text} disabledAt={(i?: any) => h * 60 + i * step > max || h * 60 + i * step < min}/>
    </div>);
}
/* A sheet with the wheel, a read-out of what is set and Done. Nothing is saved until Done:
   closing the sheet any other way leaves the setting as it was. */
function DurationSheet({ title, value, min, max, off, footer, onDone, close }: any) {
    const [v, setV]: any = useState(clampDuration(value, min, max));
    const read: any = useRef(null);
    return <>
    <h3>{title}</h3>
    <div className="dw-read" aria-hidden="true">{fmtDuration(v, { off })}</div>
    <DurationWheel value={v} onChange={setV} min={min} max={max} off={off} readRef={read}/>
    {footer && <p className="dim small dw-foot">{footer}</p>}
    <Button variant="primary" onClick={() => { const now: any = read.current ? read.current() : v; close(); onDone(now); }}>{t('Done')}</Button>
    <div style={{ height: 8 }}/>
  </>;
}
/** Opens the wheel in a bottom sheet; `onDone(sec)` runs on Done with the clamped value. */
export function durationSheet({ title, value, min = 0, max = REST_MAX, off = null, footer = null, onDone }: any) {
    return useUI.getState().openSheet((close?: any) => <DurationSheet title={title} value={value} min={min} max={max} off={off} footer={footer} onDone={onDone} close={close}/>);
}
