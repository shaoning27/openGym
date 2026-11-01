// Legacy dynamic types are explicit during the full language migration.
// Swipe from the left edge to go back, the iPhone way (owner request).
//
// Only where the screen shows its own back button: every page-level back arrow carries
// `data-back`, and the gesture does exactly what that button does, by clicking it. No button,
// no gesture: a tab root, the workout screen, anything behind an open sheet. So it can never
// leave the app or go somewhere the screen does not offer.
//
// Only on iOS and only where nothing else does it: the iPhone/iPad app (Capacitor, whose web
// view has no back gesture of its own) and the home-screen web app (standalone, where Safari's
// edge swipe is gone). Android has its system back (lib/back.ts), a Safari tab has its own.
//
// Only from the edge (EDGE_PX), so the swipe cards, the set rows, the chip strips and the sliders
// keep every touch that starts anywhere else. A touch that does start at the edge is claimed
// before any of them sees it (a capture listener on the window), and given back by no one: a
// set row under the thumb at the very edge does not open while the page goes back.
//
// The page follows the finger over a dimmed backdrop (the previous page is not rendered, so
// the backdrop stands in for it); past a third of the width, or flicked, it goes; otherwise it
// springs back. With reduced motion nothing moves: the same decision, then just the navigation.
// Right-to-left languages mirror all of it: the right edge, swiping left.
import { MOBILE, nativePlatform } from './mobile.ts';
export const EDGE_PX: any = 20; // how close to the edge a back swipe must start
export const SLOP_PX: any = 10; // movement before the gesture decides sideways or not
export const COMMIT_FRACTION: any = 1 / 3;
export const FLICK_PX_PER_MS: any = 0.5; // a flick this fast goes back from any distance past the slop
const SETTLE_MS: any = 260;
const PARALLAX: any = 0.3; // the page underneath starts this far to the left, and slides in
const SHADE: any = 0.35; // its dimming at the start of the swipe
export const BACK_PREVIEW_EVENT: any = 'opengym:back-preview';
/* ---------- pure decisions ---------- */
/** Whether this build and device get the gesture at all. */
export function edgeSwipeEnabled({ mobile, platform, ios, standalone }: any) {
    if (mobile)
        return platform === 'ios';
    return !!ios && !!standalone;
}
/** Whether a touch at clientX starts in the back edge (the right one in RTL). */
export function startsAtEdge(x?: any, width?: any, rtl: any = false, edge: any = EDGE_PX) {
    return rtl ? x >= width - edge : x <= edge;
}
/** The distance travelled towards "back": positive to the right, or to the left in RTL. */
export const progressOf: any = (x0?: any, x?: any, rtl: any = false) => (rtl ? x0 - x : x - x0);
/**
 * Sideways or not, once the finger has moved past the slop: 'go' for a back swipe, 'abort' for
 * a scroll (more vertical than sideways) or a swipe the wrong way, null to keep waiting.
 */
export function lockOf(dx?: any, dy?: any, slop: any = SLOP_PX) {
    if (Math.abs(dx) < slop && Math.abs(dy) < slop)
        return null;
    if (Math.abs(dy) >= Math.abs(dx) || dx <= 0)
        return 'abort';
    return 'go';
}
/** On release: 'back' past COMMIT_FRACTION of the width or with a flick, 'cancel' otherwise. */
export function releaseOf({ dx, width, vx }: any) {
    if (dx <= 0)
        return 'cancel';
    if (dx >= width * COMMIT_FRACTION)
        return 'back';
    if (vx >= FLICK_PX_PER_MS && dx > SLOP_PX)
        return 'back';
    return 'cancel';
}
/* ---------- where the gesture acts ---------- */
/** The page's own back button, or null: visible, enabled, and not behind an open sheet. */
export function backTarget(doc: any = document) {
    if (doc.querySelector('#modal-root.open'))
        return null;
    // the page on top: the one underneath (App.tsx `under`) has back buttons of its own
    const el: any = doc.querySelector('#app > .page:not(.under) [data-back]') || doc.querySelector('#app [data-back]');
    if (!el || el.disabled)
        return null;
    return el;
}
const reducedMotion: any = (win?: any) => { try {
    return !!win.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
}
catch {
    return false;
} };
const isRtl: any = (doc?: any) => (doc.documentElement.dir || '').toLowerCase() === 'rtl';
/* ---------- the gesture ---------- */
/**
 * Installs the listeners. `opts.enabled` forces the platform answer (tests); otherwise it is
 * worked out once. Returns a function that removes everything again.
 */
export function installEdgeSwipeBack(win: any = window, opts: any = {}) {
    const doc: any = win.document;
    let enabled: any = opts.enabled;
    if (enabled === undefined) {
        enabled = false;
        const ios: any = /iPhone|iPad|iPod/.test(win.navigator.userAgent) ||
            (/Macintosh/.test(win.navigator.userAgent) && (win.navigator.maxTouchPoints || 0) > 1); // iPadOS
        let standalone: any = false;
        try {
            standalone = !!(win.matchMedia?.('(display-mode: standalone)').matches || win.navigator.standalone === true);
        }
        catch { /* not standalone */ }
        if (MOBILE)
            nativePlatform().then((p?: any) => { enabled = edgeSwipeEnabled({ mobile: true, platform: p }); });
        else
            enabled = edgeSwipeEnabled({ mobile: false, ios, standalone });
    }
    let g: any = null; // { id, x0, y0, lastX, lastT, vx, rtl, width, target, path, lock, page, under, shade }
    // The page it goes back to (App.tsx renders it underneath while asked to; `path` null ends
    // that), and, as the swipe lands, where it is returning, so App restores its scroll position.
    const preview: any = (path?: any) => win.dispatchEvent(new win.CustomEvent(BACK_PREVIEW_EVENT, { detail: { path } }));
    const committing: any = (path?: any) => win.dispatchEvent(new win.CustomEvent(BACK_PREVIEW_EVENT, { detail: { commit: path } }));
    const underlay: any = () => (g && (g.under || (g.under = doc.querySelector('#app > .page.under')))) || null;
    // transform and opacity only, so the frames stay on the compositor
    const paint: any = (dx?: any, ms: any = 0) => {
        if (!g || !g.page)
            return;
        const p: any = Math.min(1, Math.max(0, dx) / g.width);
        const dir: any = g.rtl ? -1 : 1;
        const tr: any = (prop?: any) => (ms ? `${prop} ${ms}ms cubic-bezier(.32,.72,0,1)` : 'none');
        g.page.style.transition = tr('transform');
        g.page.style.transform = p ? `translateX(${p * g.width * dir}px)` : '';
        const under: any = underlay();
        if (under) {
            under.style.visibility = 'visible';
            under.style.transition = tr('transform');
            under.style.transform = `translateX(${-PARALLAX * (1 - p) * g.width * dir}px)`;
        }
        if (g.shade) {
            g.shade.style.transition = ms ? `opacity ${ms}ms linear` : 'none';
            g.shade.style.opacity = String((1 - p) * SHADE);
        }
    };
    const startVisual: any = () => {
        if (reducedMotion(win))
            return;
        const page: any = doc.querySelector('#app > .page:not(.under)') || doc.getElementById('app');
        if (!page)
            return;
        g.page = page;
        // The page's own ground reaches the screen's edges (index.css .edge-back-page::before): its
        // box stops at #app's padding, and the page underneath must not show through around it.
        const r: any = page.getBoundingClientRect();
        page.style.setProperty('--eb-l', Math.max(0, r.left) + 'px');
        page.style.setProperty('--eb-r', Math.max(0, g.width - r.right) + 'px');
        page.style.setProperty('--eb-t', Math.max(0, r.top) + 'px');
        page.style.setProperty('--eb-b', Math.max(0, (win.innerHeight || 0) - r.bottom) + 'px');
        page.classList.add('edge-back-page');
        const shade: any = doc.createElement('div');
        shade.className = 'edge-back-shade';
        page.parentNode.insertBefore(shade, page);
        g.shade = shade;
    };
    // Cancelled: everything back as it was, and the page underneath goes away.
    const endVisual: any = (gesture?: any) => {
        if (gesture.page) {
            gesture.page.style.transition = '';
            gesture.page.style.transform = '';
            for (const v of ['--eb-l', '--eb-r', '--eb-t', '--eb-b'])
                gesture.page.style.removeProperty(v);
            gesture.page.classList.remove('edge-back-page');
        }
        gesture.shade?.remove();
        if (gesture.path)
            preview(null);
    };
    // Landed: the page underneath is the page now (App keeps it, same element). The page that
    // slid out stays where it went until React has taken it away, so nothing flashes back.
    const landed: any = (gesture?: any) => {
        if (gesture.path)
            committing(gesture.path);
        gesture.target.click();
        const raf: any = win.requestAnimationFrame || ((f?: any) => win.setTimeout(f, 16));
        raf(() => raf(() => {
            gesture.shade?.remove();
            if (gesture.page?.isConnected)
                endVisual({ ...gesture, path: null });
        }));
    };
    const onDown: any = (e?: any) => {
        if (!enabled || g || (e.pointerType && e.pointerType !== 'touch' && e.pointerType !== 'pen'))
            return;
        const rtl: any = isRtl(doc);
        const width: any = win.innerWidth || doc.documentElement.clientWidth;
        if (!startsAtEdge(e.clientX, width, rtl))
            return;
        const target: any = backTarget(doc);
        if (!target)
            return;
        // Claimed: nothing under the edge (a set row, a card) starts its own swipe from this touch.
        e.stopPropagation();
        // The page underneath starts mounting now, hidden, so it is there by the time the finger has
        // moved far enough to show it. Not with reduced motion: nothing slides, nothing to show.
        const path: any = reducedMotion(win) ? null : (target.getAttribute('data-back') || null);
        g = { id: e.pointerId, x0: e.clientX, y0: e.clientY, lastX: e.clientX, lastT: e.timeStamp || Date.now(), vx: 0, rtl, width, target, path, lock: null };
        if (path)
            preview(path);
    };
    const onMove: any = (e?: any) => {
        if (!g || e.pointerId !== g.id)
            return;
        e.stopPropagation();
        const dx: any = progressOf(g.x0, e.clientX, g.rtl);
        const now: any = e.timeStamp || Date.now();
        const dt: any = now - g.lastT;
        if (dt > 0)
            g.vx = progressOf(g.lastX, e.clientX, g.rtl) / dt;
        g.lastX = e.clientX;
        g.lastT = now;
        if (!g.lock) {
            g.lock = lockOf(dx, e.clientY - g.y0);
            if (g.lock === 'abort') {
                const done: any = g;
                g = null;
                endVisual(done);
                return;
            }
            if (g.lock === 'go')
                startVisual();
            else
                return;
        }
        paint(dx);
    };
    const onUp: any = (e?: any) => {
        if (!g || e.pointerId !== g.id)
            return;
        e.stopPropagation();
        const done: any = g;
        g = null;
        if (done.lock !== 'go') {
            endVisual(done);
            return;
        }
        const dx: any = progressOf(done.x0, e.clientX, done.rtl);
        const go: any = releaseOf({ dx, width: done.width, vx: done.vx }) === 'back' && e.type !== 'pointercancel';
        if (!done.page) {
            if (go)
                landed(done);
            else
                endVisual(done);
            return;
        }
        g = done; // for paint
        paint(go ? done.width : 0, SETTLE_MS);
        g = null;
        win.setTimeout(() => { if (go)
            landed(done);
        else
            endVisual(done); }, SETTLE_MS);
    };
    // A claimed touch must not scroll the page under it: pointer events alone do not stop a WebKit
    // scroll, and a scroll that starts in the slop cancels the pointer. Only touches that began in
    // the back edge of a page with a back button are held like this.
    const onTouchMove: any = (e?: any) => { if (g && e.cancelable)
        e.preventDefault(); };
    win.addEventListener('pointerdown', onDown, true);
    win.addEventListener('pointermove', onMove, true);
    win.addEventListener('pointerup', onUp, true);
    win.addEventListener('pointercancel', onUp, true);
    doc.addEventListener('touchmove', onTouchMove, { passive: false });
    return () => {
        win.removeEventListener('pointerdown', onDown, true);
        win.removeEventListener('pointermove', onMove, true);
        win.removeEventListener('pointerup', onUp, true);
        win.removeEventListener('pointercancel', onUp, true);
        doc.removeEventListener('touchmove', onTouchMove);
        if (g) {
            endVisual(g);
            g = null;
        }
    };
}
