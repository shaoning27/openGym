// Legacy dynamic types are explicit during the full language migration.
import { Component, createRef } from 'react';
// A layout-effect cleanup is too late to measure the old DOM. React's snapshot lifecycle
// brackets the collapse itself, including changes made while the Layout sheet locks the body.
export default class WorkoutScrollAnchor extends Component<any, any> {
    [key: string]: any;
    root = createRef();
    getSnapshotBeforeUpdate(prev?: any) {
        if (prev.collapsed === this.props.collapsed)
            return null;
        const root: any = this.root.current;
        const top: any = Math.max(0, root.querySelector('.whdr')?.getBoundingClientRect().bottom || 0);
        const collapsing: any = new Set(this.props.collapsed.split(',').filter((k?: any) => !prev.collapsed.split(',').includes(k)));
        const visible: any = [...root.querySelectorAll('.wl-unit')].filter((el?: any) => {
            const rect: any = el.getBoundingClientRect();
            return rect.bottom > top && rect.top < window.innerHeight;
        });
        // A finished tile that folds on screen keeps its top (or lands just under the header when
        // it started above it), so its summary stays in view and everything after it moves up
        // (#642). Otherwise the first surviving tile holds still; a collapsed summary works too.
        const folding: any = visible.find((el?: any) => collapsing.has(el.dataset.unitKey));
        if (folding)
            return { anchor: folding, top: Math.max(top, folding.getBoundingClientRect().top), fold: true };
        const anchor: any = visible.find((el?: any) => !collapsing.has(el.dataset.unitKey)) || visible[0];
        return anchor ? { anchor, top: anchor.getBoundingClientRect().top } : null;
    }
    componentDidUpdate(prev?: any, state?: any, snapshot?: any) {
        if (!snapshot)
            return;
        const root: any = this.root.current;
        if (!snapshot.anchor.isConnected) {
            root.style.paddingBottom = '';
            return;
        }
        const body: any = document.body;
        const locked: any = body.style.position === 'fixed';
        const delta: any = snapshot.anchor.getBoundingClientRect().top - snapshot.top;
        const y: any = locked ? -(parseFloat(body.style.top) || 0) : window.scrollY;
        let target: any = Math.max(0, y + delta);
        // At the page start we cannot scroll to a negative offset: the page simply starts at the
        // top. No spacer before the next tile, that read as a blank gap (#642).
        // Collapsing near the page end can clamp scrollY before we restore it. Keep only the
        // trailing space needed to hold this viewport; a later expansion can reclaim it.
        const oldSpace: any = parseFloat(root.style.paddingBottom) || 0;
        const height: any = Math.max(body.scrollHeight, document.documentElement.scrollHeight) - oldSpace;
        let space: any = Math.max(0, target + window.innerHeight - height);
        // A folding tile near the page end is the exception: holding its top would need a blank
        // strip under it (Discord, after #642). The page settles at its end instead, and the
        // summary, being the last of what is left, slides down but stays in view.
        if (snapshot.fold && space) {
            target = Math.max(0, height - window.innerHeight);
            space = 0;
        }
        root.style.paddingBottom = space ? `${space}px` : '';
        if (locked)
            body.style.top = `${-target}px`;
        else if (delta || oldSpace !== space || target !== y) {
            // Cancel a sheet's delayed keyboard correction before it can undo this newer anchor.
            window.dispatchEvent(new Event('workout-scroll-anchor'));
            window.scrollTo({ top: target, left: window.scrollX, behavior: 'instant' });
        }
    }
    render() {
        return <div ref={(this.root as any)} className="narrow" style={{ overflowAnchor: this.props.enabled ? 'none' : undefined }}>{this.props.children}</div>;
    }
}
