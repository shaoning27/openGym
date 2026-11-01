// Legacy dynamic types are explicit during the full language migration.
// Automatic reviews on a phone that brings its own API key (Discord, 10-19).
//
// On a server the cadence tick runs them (api/coach/cadence.ts). A phone in BYOK mode has no
// server, and nothing ran them: "Weekly" and "After every few workouts" saved, and no review ever
// came. There is no running JavaScript while the app is closed, so the phone asks while it is
// open, with the server's rule (api/coach/core/due.ts): on start, on every return to the
// foreground, and once a minute while on screen. That last one is what catches a workout the
// moment it is finished, and a weekly slot that passes with the app open.
//
// A phone paired with a server leaves the running to the server, which has no way to reach the
// phone app (no web push there): on start and on every return to the foreground the phone asks
// whether a scheduled review left a proposal, and says so once.
//
// The check itself is cheap and says no early: without automatic reviews on, or with the Coach
// off on this phone, it stops here, before the Coach's code is even loaded.
import { MOBILE } from './mobile.ts';
const TICK_MS: any = 60000;
/** Whether this state could have a review due here at all, before anything is loaded. */
export function mayBeDue(store?: any) {
    const cadence: any = store?.S?.coach?.cadence;
    return store?.coachLocal?.mode === 'byok' && !!cadence && cadence !== 'off';
}
/** Whether the paired server could have run one this phone has not heard of. */
export function mayHaveNews(store?: any) {
    const cadence: any = store?.S?.coach?.cadence;
    // A paired phone without a key of its own uses its server's Coach (coachAvailable, lib/coach.ts).
    return store?.coachLocal?.mode !== 'byok' && !!store?.config?.coach?.enabled && !!store?.user && !!cadence && cadence !== 'off';
}
let running: any = false;
/** One look: runs the review when it is due (own key), or, on the way back to the foreground,
 *  asks the paired server whether one is waiting. Resolves to what it found, or null. */
export async function checkScheduledReview(getStore?: any, foreground: any = false) {
    const store: any = getStore();
    const own: any = mayBeDue(store), paired: any = foreground && mayHaveNews(store);
    if (running || (!own && !paired))
        return null;
    running = true;
    try {
        const api: any = await import('./coach-api.ts');
        return await (own ? api.scheduledReview() : api.scheduledNotice());
    }
    catch {
        return null;
    }
    finally {
        running = false;
    }
}
let started: any = false;
export function initCoachSchedule(getStore?: any) {
    if (!MOBILE || started)
        return;
    started = true;
    const look: any = (foreground: any = false) => {
        if (typeof document !== 'undefined' && document.visibilityState === 'hidden')
            return;
        checkScheduledReview(getStore, foreground);
    };
    setTimeout(() => look(true), 5000); // after start-up, not in the middle of it
    setInterval(() => look(), TICK_MS);
    if (typeof document !== 'undefined')
        document.addEventListener('visibilitychange', () => look(true));
    // The same promise rule as initReminderSync (lib/mobile.ts): returned into the catch.
    import('@capacitor/app').then(({ App }: any) => App.addListener('appStateChange', ({ isActive }: any) => { if (isActive)
        look(true); })).catch(() => { });
}
