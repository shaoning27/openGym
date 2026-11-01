// Legacy dynamic types are explicit during the full language migration.
// Rest-over alert for the Capacitor app.
//
// The in-page countdown is a setInterval in the WebView. Android freezes that as soon as the
// screen locks, so the beep never runs and nothing is posted. Scheduling a real alarm at
// startRest() is what still fires with the screen off: the receiver posts the notification
// and plays the end tone. The card in the notification shade is the in-app shape: clock plus
// a shrinking bar. The lock screen shows it only when notifications are allowed and the
// system is set to show them there.
//
// iOS stops the page the moment the app leaves the screen. RestAlertPlugin.swift answers the same
// calls with a local notification for the end of the rest, in the tone Settings → Sound picked;
// there is no countdown card and no buttons there, so hold() just calls the notification off.
//
// The web build keeps Web Push (useUI). This file no-ops there; MOBILE is a build-time flag.
import { t } from './i18n-core.ts';
import { argb } from './format.ts';
import { accentPair } from './accent.ts';
import { MOBILE, nativePlatform } from './mobile.ts';
import { REST_SOUNDS } from './rest-sounds.ts';
export const REST_ALERT_ID: any = 42;
export const REST_CHANNEL_ID: any = 'rest-over';
// Settings → Vibrate off. A notification channel's vibration is the system's to keep once the
// channel exists, so the app cannot switch it off on 'rest-over': an end that must not buzz is
// posted on a second channel that never vibrates (RestAlert.java).
export const REST_QUIET_CHANNEL_ID: any = 'rest-over-quiet';
// One object the native side schedules. Public + high is what the notification shade can show.
// The lock screen follows the user's notification settings.
// `key` is a preset's key or the user's own colour as '#rrggbb' (lib/accent.ts accentValue).
export function accentColors(key?: any) {
    const { accent, ink }: any = accentPair(key);
    return { accent: argb(accent), ink: argb(ink) };
}
export function buildRestAlert({ at, title, countdownTitle, totalSec, accent, sound = true, classic = false, tone = null, vibrate = true, alarmBuzz = false, now = Date.now() }: any = {}) {
    if (typeof at !== 'number' || !(at > now))
        return null;
    // Settings → Sound (#306): one of lib/sound.ts REST_SOUNDS; without one, `classic` decides, as before.
    const kind: any = Object.hasOwn(REST_SOUNDS, tone) ? tone : classic === true ? 'classic' : 'chime';
    const totalMs: any = Math.max(1000, Math.round((totalSec > 0 ? totalSec : (at - now) / 1000) * 1000));
    const colors: any = accentColors(accent);
    return {
        id: REST_ALERT_ID,
        channelId: vibrate ? REST_CHANNEL_ID : REST_QUIET_CHANNEL_ID,
        title: title || t('Rest’s over. Next set!'),
        countdownTitle: countdownTitle || t('Rest'),
        pause: t('Pause'),
        resume: t('Resume'),
        minus: '− 15s',
        plus: '+ 15s',
        skip: t('Skip'),
        accent: colors.accent,
        ink: colors.ink,
        totalMs,
        at,
        allowWhileIdle: true,
        sound: !!sound,
        // Settings → Sound: the native side plays the same end tone the page does (RestTone.java).
        // `tone` names it; `classic` stays for an app shell from before #306, which reads only that
        // and plays the chime for every other pick.
        tone: kind,
        classic: kind === 'classic',
        vibrate: !!vibrate,
        // Settings → "Vibrate when the phone is on silent" (#375): the end buzzes as an alarm, which
        // silent mode lets through, instead of through the notification channel, which it mutes.
        alarmBuzz: !!vibrate && !!alarmBuzz,
        localOnly: false,
        visibility: 'public',
        importance: 'high',
    };
}
// Serialises schedule/cancel. startRest() disarms the previous alarm and arms the next in
// the same turn; if those two bridge calls raced, a cancel finishing last would swallow the
// new alarm. `token` stops a slow schedule from adopting the beep after a later disarm.
let chain: any = Promise.resolve();
let token: any = 0;
const enqueue: any = (fn?: any) => {
    const run: any = chain.then(fn, fn);
    chain = run.then(() => { }, () => { });
    return run;
};
// The native plugin, registered once: registerPlugin() warns on every call after the first. It
// travels inside an object because a Capacitor plugin proxy answers `then` with a native call that
// never settles, so a promise resolved with the bare proxy hangs for good (the Coach hang, #42).
// Anything but the phone app gets null and registers nothing.
let pluginP: any = null;
const restPlugin: any = () => pluginP || (pluginP = (async () => {
    if (!(await nativePlatform()))
        return null;
    const { registerPlugin }: any = await import('@capacitor/core');
    return { RestAlert: registerPlugin('RestAlert') };
})().catch(() => null));
// Resolves true only when the phone scheduled the end itself. Callers use false as
// "fall back to the server push": the web, and a failed schedule.
export function armRestAlert(at?: any, opts: any = {}) {
    if (!MOBILE)
        return Promise.resolve(false);
    const mine: any = ++token;
    const alert: any = buildRestAlert({ at, title: opts.title, countdownTitle: opts.countdownTitle, totalSec: opts.totalSec, accent: opts.accent, sound: opts.sound, classic: opts.classic === true, tone: opts.tone, vibrate: opts.vibrate !== false, alarmBuzz: !!opts.alarmBuzz });
    if (!alert)
        return Promise.resolve(false);
    // Outside the chain and never awaited: the alarm, its tone and the alarm buzz do not need the
    // notification permission, and a dialog left open while the phone is put away must not hold
    // the alarm back until the rest is long over.
    askNotifPermissionOnce();
    return enqueue(async () => {
        let kind: any = 'failed';
        try {
            kind = await deliver(alert);
        }
        catch {
            kind = 'failed';
        }
        if (mine !== token)
            return false;
        return kind === 'native';
    });
}
export function disarmRestAlert() {
    token++;
    if (!MOBILE)
        return;
    enqueue(async () => {
        try {
            await cancelDelivered();
        }
        catch { /* the next arm replaces this alarm */ }
    });
}
// The rest was paused in the app (#193): the notification stops its clock at the time held and
// offers Resume, and the alarm for the old end is called off. Resuming arms it again for the new
// end like any other rest; time added or taken while paused holds it again at the new figure.
export function holdRestAlert(leftSec?: any, totalSec?: any) {
    token++;
    if (!MOBILE)
        return;
    enqueue(async () => {
        const p: any = await restPlugin();
        if (p)
            await p.RestAlert.hold({ id: REST_ALERT_ID, leftMs: Math.max(1, leftSec) * 1000, totalMs: Math.max(1, totalSec) * 1000 });
    });
}
// What the notification's own buttons did (pause, ±15s, skip), for useUI to mirror in the bar.
let onNativeRest: any = null;
export function bindNativeRest(cb?: any) { onNativeRest = cb; }
// Caught: in the iOS app before it had the plugin this listener rejected at startup with nobody
// to catch it. The iPhone's notification has no buttons, so it never fires there.
if (MOBILE) {
    restPlugin()
        .then((p?: any) => p && p.RestAlert.addListener('rest', (ev?: any) => { if (onNativeRest)
        onNativeRest(ev); }))
        .catch(() => { });
}
// A buzz that silent mode lets through (#375): the native side vibrates as an alarm. Resolves true
// once it did, false anywhere it cannot (the web, a failed call) for the caller to buzz the
// ordinary way instead. iOS has no patterns: the phone buzzes once. Never resolves with the plugin
// itself — see restPlugin.
export function buzzAsAlarm(pattern?: any) {
    if (!MOBILE)
        return Promise.resolve(false);
    const p: any = Array.isArray(pattern) ? pattern.filter((n?: any) => Number.isFinite(n) && n >= 0).map(Math.round) : (Number.isFinite(pattern) && pattern > 0 ? [Math.round(pattern)] : []);
    if (!p.length)
        return Promise.resolve(false);
    return restPlugin()
        .then((plugin?: any) => (plugin ? plugin.RestAlert.buzz({ pattern: p }).then(() => true) : false))
        .catch(() => false);
}
// The end tone through the native side, which ducks music for it (a page cannot). Resolves true
// once it was handed over, false anywhere it cannot (the web, a failed call) for the caller
// to play the page's own chime instead. Never resolves with the plugin itself — see restPlugin.
export function toneNative(kind?: any) {
    if (!MOBILE)
        return Promise.resolve(false);
    return restPlugin()
        .then((plugin?: any) => (plugin ? plugin.RestAlert.tone({ kind: String(kind || 'chime') }).then(() => true) : false))
        .catch(() => false);
}
// The running countdown repaints with this swatch. No-op when no rest is on screen.
export function setRestAccent(key?: any) {
    if (!MOBILE)
        return;
    const { accent, ink }: any = accentColors(key);
    enqueue(async () => {
        const p: any = await restPlugin();
        if (p)
            await p.RestAlert.setAccent({ accent, ink });
    });
}
// The notification permission is asked once, the first time a rest starts. The answer is kept:
// Android lets an app ask again after a "Don't allow", and asking on every rest would pop the
// dialog between every set. Settings → Notifications in the system is where it changes later.
export const NOTIF_ASKED_KEY: any = 'gym_rest_notif_asked';
let askP: any = null;
const readAsked: any = () => { try {
    return localStorage.getItem(NOTIF_ASKED_KEY);
}
catch {
    return null;
} };
const writeAsked: any = (v?: any) => { try {
    localStorage.setItem(NOTIF_ASKED_KEY, v);
}
catch { /* asked again next launch */ } };
export function askNotifPermissionOnce() {
    if (askP)
        return askP;
    askP = (async () => {
        try {
            if (!(await nativePlatform()))
                return false;
            const { LocalNotifications }: any = await import('@capacitor/local-notifications');
            const perm: any = await LocalNotifications.checkPermissions();
            if (perm.display === 'granted')
                return true;
            if (perm.display === 'denied' || readAsked())
                return false;
            const got: any = await LocalNotifications.requestPermissions();
            // Kept only once really answered. Leaving the app closes the dialog and reports "denied",
            // but the permission still reads 'prompt' then: nobody chose, so the next launch asks again
            // (this one does not: askP holds the answer for the rest of the session).
            const after: any = got.display === 'granted' ? got : await LocalNotifications.checkPermissions().catch(() => got);
            if (after.display !== 'prompt')
                writeAsked(got.display === 'granted' ? 'granted' : 'denied');
            return got.display === 'granted';
        }
        catch {
            return false;
        }
    })();
    return askP;
}
// Test seam: a fresh launch.
export function _resetNotifAsk() { askP = null; }
async function deliver(alert?: any) {
    // The end passed while the call waited its turn (a slow bridge, a frozen WebView): nothing to
    // ring any more, and the plugin would refuse it ("at must be in the future").
    if (!(alert.at > Date.now()))
        return 'expired';
    const p: any = await restPlugin();
    if (!p)
        return 'skipped';
    const { RestAlert }: any = p;
    if (!(alert.at > Date.now()))
        return 'expired';
    // Sound, the alarm buzz and the alarm itself need no notification permission; only the
    // countdown card does, and askNotifPermissionOnce() asks for it on the side.
    await RestAlert.schedule({
        id: alert.id,
        at: alert.at,
        title: alert.title,
        sound: alert.sound,
        classic: alert.classic,
        tone: alert.tone,
        // The end of a rest the app is not in front for: the notification, or the buzz standing in
        // for it where notifications are off. With the app in front the page buzzes (lib/sound.ts).
        vibrate: alert.vibrate,
        alarmBuzz: alert.alarmBuzz,
        channelId: alert.channelId,
        visibility: alert.visibility,
        importance: alert.importance,
        localOnly: alert.localOnly,
        countdownTitle: alert.countdownTitle,
        totalMs: alert.totalMs,
        pause: alert.pause,
        resume: alert.resume,
        minus: alert.minus,
        plus: alert.plus,
        skip: alert.skip,
        accent: alert.accent,
        ink: alert.ink,
    });
    return 'native';
}
async function cancelDelivered() {
    const p: any = await restPlugin();
    if (p)
        await p.RestAlert.cancel({ id: REST_ALERT_ID });
}
