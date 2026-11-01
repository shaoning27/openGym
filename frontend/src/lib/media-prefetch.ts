// Legacy dynamic types are explicit during the full language migration.
// Offline exercise media for the installed web app (#281).
//
// The service worker keeps every animation and still it has served in a cache that outlives
// updates (public/sw.js, MEDIA). What it cannot do on its own is hold the media for a workout
// nobody has opened yet: a GIF was offline only if it had once been shown online. So once the app
// has settled, and again when the plan changes or the network comes back, the media for every
// exercise in the plan and in the session in progress is fetched through the worker, which keeps
// it. URLs already in the cache are skipped, so after the first run this is a cache lookup per
// exercise and no traffic.
//
// Only in the app installed on the home screen (installedApp). That is where a workout gets
// opened in a gym basement with no signal; a browser tab is someone looking at the app, and
// fetching a few megabytes of animations behind their back is not what they opened it for. A tab
// keeps the worker's ordinary on-demand cache: whatever it has shown stays available offline.
//
// And never when the browser says data costs something: Data Saver, a cellular connection, or a
// 2G-class one. Safari and Firefox say nothing about the connection, and there it runs; the set is
// bounded by the plan (a few MB for a typical one) and each file goes once.
//
// Not in the phone app: it has no service worker, and its media comes from the CDN.
import { EXIDX, imgSrc, gifSrc, isCustomEx, figureOf } from './exercises.ts';
// The worker's media cache, public/sw.js MEDIA. Duplicated because the worker is not bundled;
// sw-media.test.js pins the two together.
export const MEDIA_CACHE: any = 'opengym-media-v1';
// Long enough after boot or an edit that the app's own requests go first.
export const PREFETCH_DELAY_MS: any = 8000;
const CONCURRENCY: any = 2;
// A server that refuses three in a row (a gated instance answering a guest with 401, a proxy
// that is down) is not asked for the rest until the next run.
const MAX_FAILURES: any = 3;
/** Every same-origin img/gif URL for the exercises in the plan and the active session. */
export function planMediaUrls(S?: any, base: any = globalThis.location?.href, index: any = EXIDX) {
    if (!base)
        return [];
    const ids: any = new Set();
    (S?.routines || []).forEach((r?: any) => (r?.ex || []).forEach((e?: any) => { if (e?.id)
        ids.add(e.id); }));
    (S?.active?.entries || []).forEach((en?: any) => { if (en?.id)
        ids.add(en.id); });
    const origin: any = new URL(base).origin;
    const urls: any = new Set();
    for (const id of ids) {
        const ex: any = index[id];
        // A custom exercise's photo or video is not a file of the shipped dataset: it lives in the
        // local media store and has its own prefetch (lib/media-sync.ts). An unknown id has nothing.
        if (!ex || isCustomEx(ex))
            continue;
        for (const src of [ex.gif && gifSrc(ex, figureOf(S)), ex.img && imgSrc(ex, figureOf(S))]) {
            if (!src)
                continue;
            const u: any = new URL(src, base);
            // Media on another origin (a build that points at a CDN) never passes through this
            // worker, so fetching it here would only warm the browser's HTTP cache.
            if (u.origin === origin)
                urls.add(u.href);
        }
    }
    return [...urls];
}
const STANDALONE: any = '(display-mode: standalone)';
/**
 * Whether this page runs as the app installed on the home screen, not in a browser tab: the
 * display mode the manifest asks for (`standalone`), or iOS Safari's own flag, which a home-screen
 * app there has had since before it knew display modes. `win.matchMedia` is called on `win` —
 * a detached matchMedia throws in a browser.
 */
export function installedApp(win: any = globalThis, nav: any = win?.navigator) {
    if (nav?.standalone === true)
        return true;
    try {
        return !!win?.matchMedia?.(STANDALONE)?.matches;
    }
    catch {
        return false;
    }
}
/** Whether the connection is one to spend a few megabytes on without asking. */
export function prefetchAllowed(nav: any = globalThis.navigator) {
    if (!nav || nav.onLine === false)
        return false;
    const c: any = nav.connection;
    if (!c)
        return true;
    if (c.saveData)
        return false;
    if (c.type === 'cellular')
        return false;
    if (/(^|-)2g$/.test(c.effectiveType || ''))
        return false;
    return true;
}
/**
 * Fetch whatever of `urls` the cache does not hold yet, through the worker. Two at a time,
 * and it stops as soon as the connection stops qualifying or the server keeps refusing.
 */
export async function prefetchMedia(urls?: any, { cache, fetchImpl = globalThis.fetch, allowed = prefetchAllowed }: any = {}) {
    const missing: any = cache
        ? (await Promise.all(urls.map(async (u?: any) => ((await cache.match(u).catch(() => null)) ? null : u)))).filter(Boolean)
        : urls.slice();
    let next: any = 0;
    let fetched: any = 0;
    let failures: any = 0;
    const lane: any = async () => {
        while (next < missing.length && failures < MAX_FAILURES && allowed()) {
            const u: any = missing[next++];
            try {
                const res: any = await fetchImpl(u, { priority: 'low' });
                // Read to the end, so the worker's copy of the same stream is complete as well.
                await res.arrayBuffer();
                if (res.ok) {
                    fetched++;
                    failures = 0;
                }
                else
                    failures++;
            }
            catch (e: any) {
                failures++;
            }
        }
    };
    await Promise.all(Array.from({ length: CONCURRENCY }, lane));
    return { wanted: urls.length, missing: missing.length, fetched };
}
/**
 * Keep the plan's media offline for as long as the page is open, while it runs as the installed
 * app. `store` is the zustand store (getState/subscribe). Returns a function that stops it.
 */
export function startMediaPrefetch(store?: any, { delay = PREFETCH_DELAY_MS, win = globalThis, nav = win?.navigator, cachesApi = globalThis.caches }: any = {}) {
    const sw: any = nav?.serviceWorker;
    if (!sw || !cachesApi)
        return () => { };
    let timer: any = null;
    let running: any = false;
    // The URL set the last complete run covered; the same set again has nothing left to fetch.
    let done: any = '';
    // Asked on every run, and between files, not once at start: a desktop browser can move an open
    // tab into the installed app's window (and back), and a phone can leave Wi-Fi mid-run.
    const allowed: any = () => installedApp(win, nav) && prefetchAllowed(nav);
    const run: any = async () => {
        timer = null;
        // Only through a worker that is in charge of this page: without one nothing would be kept.
        if (running || !sw.controller || !allowed())
            return;
        const urls: any = planMediaUrls(store.getState().S);
        const key: any = urls.join('\n');
        if (!urls.length || key === done)
            return;
        running = true;
        try {
            const r: any = await prefetchMedia(urls, { cache: await cachesApi.open(MEDIA_CACHE), allowed });
            if (r.fetched === r.missing)
                done = key;
        }
        catch (e: any) { /* best effort: the next change or reconnect tries again */ }
        finally {
            running = false;
        }
    };
    const schedule: any = () => {
        if (timer)
            clearTimeout(timer);
        timer = setTimeout(() => {
            if (typeof globalThis.requestIdleCallback === 'function')
                globalThis.requestIdleCallback(() => run(), { timeout: 30000 });
            else
                run();
        }, delay);
    };
    let seen: any = store.getState().S;
    const unsubscribe: any = store.subscribe((st?: any) => {
        const S: any = st.S;
        if (S?.routines === seen?.routines && S?.active === seen?.active)
            return;
        seen = S;
        schedule();
    });
    // A tab moved into the app's window becomes the installed app without a reload.
    let mode: any = null;
    try {
        mode = win?.matchMedia?.(STANDALONE) || null;
    }
    catch { /* no display modes to follow */ }
    globalThis.addEventListener?.('online', schedule);
    sw.addEventListener?.('controllerchange', schedule);
    mode?.addEventListener?.('change', schedule);
    schedule();
    return () => {
        unsubscribe();
        if (timer)
            clearTimeout(timer);
        globalThis.removeEventListener?.('online', schedule);
        sw.removeEventListener?.('controllerchange', schedule);
        mode?.removeEventListener?.('change', schedule);
    };
}
