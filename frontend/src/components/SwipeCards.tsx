// Legacy dynamic types are explicit during the full language migration.
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
// What a card swipe never starts on: things that take a sideways drag themselves (a slider, a
// chip row that scrolls, a video's scrubber, a text area), and what has its own swipe (a set row,
// SwipeRow, marks itself data-swipe-ignore). Buttons, fields, the tick and the animation used to
// be on this list too, and on a phone that left almost no card to swipe (#431): a swipe may now
// start on any of them, and a tap is still a tap. The click a swipe leaves behind is swallowed.
const IGNORED_TARGETS: any = 'textarea,select,input[type="range"],[role="slider"],[contenteditable="true"],video[controls],audio,.chips,[data-swipe-ignore]';
const AXIS_SLOP: any = 8;
const AXIS_RATIO: any = 1.2;
const AXIS_DECIDE: any = 24;
const COMMIT_DISTANCE: any = 70;
const FLING_DISTANCE: any = 30;
const FLING_SPEED: any = 0.35;
const GAP: any = 12;
const DURATION: any = 200;
/**
 * The axis a card swipe has settled on after a move of (dx, dy): null while it is still too
 * short or too diagonal to tell, 'x' to turn the card, 'y' to leave it to the page's scroll.
 * Anything at least as vertical as it is sideways is the scroll's (with touch-action: pan-y the
 * browser takes those anyway). A clearly sideways move locks at once; a diagonal one that leans
 * sideways is watched a little longer and then turns the card, instead of being dropped as it was
 * at a strict 1.5 to 1 (#431), a gesture the browser had not scrolled either, so it did nothing.
 */
export function cardAxis(dx?: any, dy?: any) {
    const ax: any = Math.abs(dx), ay: any = Math.abs(dy);
    if (Math.max(ax, ay) < AXIS_SLOP)
        return null;
    if (ay >= ax)
        return 'y';
    if (ax >= ay * AXIS_RATIO || ax >= AXIS_DECIDE)
        return 'x';
    return null;
}
/**
 * Whether letting go turns the card: far enough (70 px), or a flick (30 px at 0.35 px/ms or
 * more) the way the card moved. `v` is the release speed in px/ms, signed like dx.
 */
export function cardCommits(dx?: any, dy?: any, v: any = 0) {
    const ax: any = Math.abs(dx);
    if (ax <= Math.abs(dy))
        return false;
    return ax >= COMMIT_DISTANCE || (ax >= FLING_DISTANCE && v * Math.sign(dx) >= FLING_SPEED);
}
// Which physical side the next card lies on: the right in a left-to-right language, the left in
// a right-to-left one (Arabic), where the exercises run from right to left like the text. A
// swipe towards the other side brings the next card in. `direction` stays logical throughout
// (+1 next, -1 previous) and only the pixels are multiplied by this.
const nextSide: any = () => (typeof document !== 'undefined' && document.documentElement.dir === 'rtl' ? -1 : 1);
export default function SwipeCards({ children, renderPreview, onNavigate, index, count, revision, timerKey, workKey }: any) {
    const surface: any = useRef(null);
    const card: any = useRef(null);
    const preview: any = useRef(null);
    const gesture: any = useRef(null);
    const pending: any = useRef(null);
    const latest: any = useRef({ revision, timerKey, workKey });
    const [direction, setDirection]: any = useState(null);
    latest.current = { revision, timerKey, workKey };
    const paint: any = (offset?: any, animate: any = false, toward: any = gesture.current?.direction) => {
        const side: any = gesture.current?.side ?? nextSide();
        if (card.current) {
            card.current.style.transition = animate ? `transform ${DURATION}ms ease-out` : 'none';
            card.current.style.transform = `translateX(${offset}px)`;
        }
        if (preview.current && toward) {
            preview.current.style.transition = animate ? `transform ${DURATION}ms ease-out` : 'none';
            const start: any = toward * side > 0 ? '100% + ' : '-100% - ';
            preview.current.style.transform = `translateX(calc(${start}${GAP}px + ${offset}px))`;
        }
    };
    const reset: any = () => {
        clearTimeout(pending.current);
        pending.current = null;
        gesture.current = null;
        setDirection(null);
        for (const node of [card.current, preview.current]) {
            node?.style.removeProperty('transform');
            node?.style.removeProperty('transition');
        }
    };
    // The click a swipe leaves behind: the button, tick or animation the finger started on must not
    // act once the card has moved. Cleared by the next touch, or after a moment.
    const swallow: any = useRef({ on: false, tm: null });
    const swallowClick: any = () => {
        clearTimeout(swallow.current.tm);
        swallow.current.on = true;
        swallow.current.tm = setTimeout(() => { swallow.current.on = false; }, 600);
    };
    useEffect(() => {
        reset();
        return () => clearTimeout(pending.current);
    }, [revision, timerKey, workKey, index, count]);
    useLayoutEffect(() => {
        if (gesture.current)
            paint(gesture.current.offset, false, direction);
    }, [direction]);
    // touchmove is attached by hand and not passive, so a locked sideways swipe keeps the page from
    // scrolling under it on browsers that do not honour touch-action (React's touch handlers are
    // passive). Before the lock it does nothing, so the page scrolls as usual.
    useEffect(() => {
        const el: any = surface.current;
        if (!el)
            return;
        const onTouchMove: any = (e?: any) => { if (gesture.current?.locked && e.cancelable)
            e.preventDefault(); };
        el.addEventListener('touchmove', onTouchMove, { passive: false });
        return () => {
            el.removeEventListener('touchmove', onTouchMove);
            clearTimeout(swallow.current.tm);
        };
    }, []);
    const onPointerDown: any = (event?: any) => {
        swallow.current.on = false;
        if (pending.current || gesture.current)
            return;
        if (event.pointerType && event.pointerType !== 'touch' && event.pointerType !== 'pen')
            return;
        const target: any = event.target;
        if (target?.closest?.(IGNORED_TARGETS))
            return;
        // A field you are typing in keeps a sideways drag for its caret.
        if (typeof document !== 'undefined' && target === document.activeElement && target?.matches?.('input'))
            return;
        gesture.current = {
            id: event.pointerId,
            x: event.clientX,
            y: event.clientY,
            offset: 0,
            direction: null,
            locked: false,
            samples: [],
            side: nextSide(),
            revision,
            timerKey,
            workKey,
        };
    };
    const track: any = (active?: any, event?: any, dx?: any) => {
        const now: any = event.timeStamp || Date.now();
        active.samples.push([now, dx]);
        while (active.samples.length > 2 && now - active.samples[0][0] > 100)
            active.samples.shift();
    };
    const onPointerMove: any = (event?: any) => {
        const active: any = gesture.current;
        if (!active || active.id !== event.pointerId)
            return;
        const dx: any = event.clientX - active.x;
        const dy: any = event.clientY - active.y;
        if (!active.locked) {
            const axis: any = cardAxis(dx, dy);
            if (!axis)
                return;
            if (axis === 'y') {
                gesture.current = null;
                return;
            }
            active.locked = true;
            try {
                event.currentTarget.setPointerCapture?.(event.pointerId);
            }
            catch { /* the gesture still tracks */ }
            swallowClick();
            const focused: any = typeof document !== 'undefined' ? document.activeElement : null;
            if (focused && focused !== document.body && surface.current?.contains(focused))
                focused.blur?.();
        }
        track(active, event, dx);
        const nextDirection: any = dx * active.side < 0 ? 1 : -1;
        const available: any = index + nextDirection >= 0 && index + nextDirection < count;
        active.direction = nextDirection;
        active.offset = available ? dx : dx * 0.35;
        if (direction !== (available ? nextDirection : null))
            setDirection(available ? nextDirection : null);
        paint(active.offset, false, nextDirection);
    };
    const finish: any = (event?: any, cancelled: any = false) => {
        const active: any = gesture.current;
        if (!active || active.id !== event.pointerId)
            return;
        // A tap, or a touch that never left the slop: nothing moved, so nothing to settle. It used
        // to wait out the 200 ms settle anyway, and a swipe started inside that wait was ignored.
        if (!active.locked) {
            gesture.current = null;
            return;
        }
        const lifted: any = Number.isFinite(event.clientX);
        const dx: any = lifted ? event.clientX - active.x : active.offset;
        const dy: any = lifted && Number.isFinite(event.clientY) ? event.clientY - active.y : 0;
        if (lifted && !cancelled)
            track(active, event, dx);
        const samples: any = active.samples;
        const dt: any = samples.length > 1 ? samples[samples.length - 1][0] - samples[0][0] : 0;
        const speed: any = dt > 0 ? (samples[samples.length - 1][1] - samples[0][1]) / dt : 0;
        const available: any = index + active.direction >= 0 && index + active.direction < count;
        const commit: any = !cancelled && active.direction != null && available && cardCommits(dx, dy, speed);
        const reducedMotion: any = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
        const width: any = surface.current?.getBoundingClientRect().width || 360;
        const stillCurrent: any = () => {
            const current: any = latest.current;
            return current.revision === active.revision && current.timerKey === active.timerKey && current.workKey === active.workKey;
        };
        const complete: any = () => {
            const navigate: any = commit && stillCurrent();
            const completedDirection: any = active.direction;
            reset();
            if (navigate)
                onNavigate(completedDirection);
        };
        paint(commit ? -active.direction * active.side * (width + GAP) : 0, !reducedMotion, active.direction);
        if (reducedMotion)
            complete();
        else
            pending.current = setTimeout(complete, DURATION);
    };
    return <div ref={surface} className="workout-swipe-surface workout-swipe-stack" data-testid="workout-swipe-surface" onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={(event?: any) => finish(event)} onPointerCancel={(event?: any) => finish(event, true)} onClickCapture={(event?: any) => {
            if (!swallow.current.on)
                return;
            swallow.current.on = false;
            event.preventDefault();
            event.stopPropagation();
        }} onLostPointerCapture={(event?: any) => {
            if (event.target === event.currentTarget && !pending.current && gesture.current?.id === event.pointerId)
                reset();
        }}>
    {direction != null && <div ref={preview} className="workout-swipe-preview" aria-hidden="true" inert>{renderPreview(direction)}</div>}
    <div ref={card} className="workout-swipe-card">{children}</div>
  </div>;
}
