// Legacy dynamic types are explicit during the full language migration.
/* Horizontal chip strips (`.chips` — the body-part and equipment filters in the Library
 * and the exercise picker, the muscle explorer) scroll by touch-swipe on a phone and by a
 * two-finger swipe on a trackpad. A plain mouse and a click do nothing sideways, so on a
 * desktop browser the chips that overflow the row to the right are unreachable — index.css
 * hides the scrollbar (`scrollbar-width:none`) so there is no handle either.
 *
 * `installChipDrag` adds the missing way in: press and drag anywhere on a strip to pull it
 * along, the way a swipe does on a phone. index.css shows a grab cursor as the hint.
 */
const DRAG_SLOP: any = 6; // px of travel before a press counts as a drag, not a click
const doc: any = () => (typeof document !== 'undefined' ? document : null);
export function installChipDrag(root: any = doc()) {
    if (!root?.addEventListener)
        return () => { };
    const win: any = root.defaultView || (typeof window !== 'undefined' ? window : null);
    const body: any = root.body || root.documentElement;
    if (!win)
        return () => { };
    let strip: any = null, startX: any = 0, startLeft: any = 0, dragging: any = false;
    // cursor hint on hover: only rows that actually overflow are draggable
    const onOver: any = (e?: any) => {
        const s: any = e.target?.closest?.('.chips');
        if (!s)
            return;
        if (s.scrollWidth > s.clientWidth)
            s.dataset.xscroll = '';
        else
            delete s.dataset.xscroll;
    };
    const swallowClick: any = (e?: any) => {
        win.removeEventListener('click', swallowClick, true);
        e.stopPropagation();
        e.preventDefault();
    };
    const onMove: any = (e?: any) => {
        if (!strip)
            return;
        const dx: any = e.clientX - startX;
        if (!dragging) {
            if (Math.abs(dx) < DRAG_SLOP)
                return;
            dragging = true;
            body?.classList.add('chips-dragging');
            win.getSelection?.()?.removeAllRanges?.();
            try {
                strip.setPointerCapture?.(e.pointerId);
            }
            catch { /* pointer already gone */ }
        }
        strip.scrollLeft = startLeft - dx;
        if (e.cancelable)
            e.preventDefault();
    };
    const onUp: any = () => {
        win.removeEventListener('pointermove', onMove);
        win.removeEventListener('pointerup', onUp, true);
        win.removeEventListener('pointercancel', onUp, true);
        if (dragging) {
            body?.classList.remove('chips-dragging');
            // The browser fires one click after the drag; drop it so releasing over a chip
            // doesn't toggle that filter. Self-removes on that click, 0ms fallback if none comes.
            win.addEventListener('click', swallowClick, true);
            win.setTimeout(() => win.removeEventListener('click', swallowClick, true), 0);
        }
        strip = null;
        dragging = false;
    };
    const onDown: any = (e?: any) => {
        if (e.button != null && e.button !== 0)
            return; // primary button only
        if (e.pointerType && e.pointerType !== 'mouse')
            return; // touch / pen already scroll
        const s: any = e.target?.closest?.('.chips');
        if (!s || s.scrollWidth <= s.clientWidth)
            return;
        strip = s;
        startX = e.clientX;
        startLeft = s.scrollLeft;
        dragging = false;
        win.addEventListener('pointermove', onMove);
        win.addEventListener('pointerup', onUp, true);
        win.addEventListener('pointercancel', onUp, true);
    };
    root.addEventListener('pointerover', onOver, true);
    root.addEventListener('pointerdown', onDown, true);
    return () => {
        root.removeEventListener('pointerover', onOver, true);
        root.removeEventListener('pointerdown', onDown, true);
        win.removeEventListener('pointermove', onMove);
        win.removeEventListener('pointerup', onUp, true);
        win.removeEventListener('pointercancel', onUp, true);
        win.removeEventListener('click', swallowClick, true);
        body?.classList.remove('chips-dragging');
    };
}
