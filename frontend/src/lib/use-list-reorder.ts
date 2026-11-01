// Legacy dynamic types are explicit during the full language migration.
import { useEffect, useRef, useState } from 'react';
// Reorder a flat list by its handle, the way iOS does in Edit mode: press the handle and the row
// follows the finger at once (no long press: the handle only exists while you are reordering, so
// there is no scroll to tell apart), the rows it passes slide out of its way, and letting go
// commits one move. The arrow keys on a focused handle move the row one place, for a keyboard.
//
// The routine editor has its own, superset-aware drag (RoutineEdit.tsx). This one is for lists
// with nothing grouped: Plan's routines and the rotation's loop.
//
//   const r = useListReorder(items.length, (from, to) => …)
//   <div ref={r.listRef}>{items.map((x, i) => <div data-reorder-row style={r.rowStyle(i)}>
//     … <button {...r.handle(i)} /></div>)}</div>
//
// `to` is the row's index after the move, so splice(from, 1) then splice(to, 0, row) applies it.
export function useListReorder(count?: any, onMove?: any) {
    const listRef: any = useRef(null);
    const gesture: any = useRef(null);
    const onMoveRef: any = useRef(onMove);
    onMoveRef.current = onMove;
    const [drag, setDrag]: any = useState(null); // { from, to, dy, stride } while a row is held
    useEffect(() => () => { gesture.current = null; }, []);
    const end: any = (commit?: any) => {
        const g: any = gesture.current;
        if (!g)
            return;
        gesture.current = null;
        try {
            g.el.releasePointerCapture?.(g.id);
        }
        catch { /* already released */ }
        setDrag(null);
        if (commit && g.to !== g.from)
            onMoveRef.current(g.from, g.to);
    };
    const rowsOf: any = () => [...(listRef.current?.children || [])].filter((el?: any) => el.hasAttribute('data-reorder-row'));
    const handle: any = (i?: any) => ({
        'data-reorder-handle': '',
        onPointerDown: (e?: any) => {
            if (e.button != null && e.button !== 0)
                return;
            const rows: any = rowsOf();
            if (!rows[i])
                return;
            e.preventDefault();
            e.stopPropagation();
            const rects: any = rows.map((row?: any) => row.getBoundingClientRect());
            // The distance from one row to the next, gap included, is how far a passed row slides.
            const stride: any = rects.length > 1 ? Math.abs(rects[1].top - rects[0].top) || rects[0].height : rects[0].height;
            gesture.current = { id: e.pointerId, el: e.currentTarget, from: i, to: i, y0: e.clientY, rects, stride };
            try {
                e.currentTarget.setPointerCapture?.(e.pointerId);
            }
            catch { /* unsupported */ }
            setDrag({ from: i, to: i, dy: 0, stride });
        },
        onPointerMove: (e?: any) => {
            const g: any = gesture.current;
            if (!g || e.pointerId !== g.id)
                return;
            e.preventDefault();
            const dy: any = e.clientY - g.y0;
            const held: any = g.rects[g.from];
            const mid: any = held.top + held.height / 2 + dy;
            // The new index is how many of the other rows now sit above the held row's middle.
            g.to = g.rects.reduce((n?: any, r?: any, k?: any) => n + (k !== g.from && r.top + r.height / 2 < mid ? 1 : 0), 0);
            setDrag({ from: g.from, to: g.to, dy, stride: g.stride });
        },
        onPointerUp: (e?: any) => { if (gesture.current && e.pointerId === gesture.current.id)
            end(true); },
        onPointerCancel: () => end(false),
        onClick: (e?: any) => e.stopPropagation(),
        onKeyDown: (e?: any) => {
            const d: any = e.key === 'ArrowUp' ? -1 : e.key === 'ArrowDown' ? 1 : 0;
            if (!d)
                return;
            e.preventDefault();
            const to: any = i + d;
            if (to >= 0 && to < count)
                onMoveRef.current(i, to);
        },
    });
    // The held row follows the pointer; the rows between where it was and where it would land
    // slide one place towards the gap it left.
    const rowStyle: any = (i?: any) => {
        if (!drag)
            return undefined;
        if (i === drag.from)
            return { transform: `translateY(${drag.dy}px)`, zIndex: 2, position: 'relative', transition: 'none' };
        if (drag.from < drag.to && i > drag.from && i <= drag.to)
            return { transform: `translateY(${-drag.stride}px)` };
        if (drag.to < drag.from && i >= drag.to && i < drag.from)
            return { transform: `translateY(${drag.stride}px)` };
        return { transform: 'translateY(0)' };
    };
    return { listRef, drag, handle, rowStyle };
}
/** `list` with the entry at `from` moved to index `to` (a new array). */
export const moved: any = (list?: any, from?: any, to?: any) => {
    const next: any = [...list];
    const [x]: any = next.splice(from, 1);
    next.splice(to, 0, x);
    return next;
};
