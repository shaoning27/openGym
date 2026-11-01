// Legacy dynamic types are explicit during the full language migration.
import { useEffect, useRef, useState, forwardRef, useSyncExternalStore } from 'react';
import { useNavigate, useParams, useLocation, Navigate } from 'react-router-dom';
import { useStore, DEF, hasData } from '../store/useStore.ts';
import { healthStatus, loadHealth, enableHealth, disableHealth, openHealthConnect, onHealthChange, enableRead, disableRead } from '../lib/health-sync.ts';
import { workoutControls } from '../lib/workout-controls.ts';
import { speedUnitOf } from '../lib/speed.ts';
import { formulaOf, FORMULA_NAMES } from '../lib/onerm.ts';
import { copyText } from '../lib/clipboard.ts';
import { useUI } from '../store/useUI.ts';
import { ACCENTS, ACCENT_NAMES, todayISO, localTZ, weekStartOf, MONDAY, SUNDAY, fmtPlate } from '../lib/format.ts';
import { inventoryFor, ownsPlates } from '../lib/plates.ts';
import { BAR_TYPES, ownBarDefault } from '../lib/bar.ts';
import { dumbbellsOf, ownsNoDumbbells } from '../lib/dumbbells.ts';
import { effortOf } from '../lib/history.ts';
import { figureOf } from '../lib/exercises.ts';
import { unlock, chime, playOnSilentSupported, vibrateSupported, appleTouchDevice } from '../lib/sound.ts';
import { REST_SOUND_IDS, restSoundOf } from '../lib/rest-sounds.ts';
import { scheduleModeOf, chooseFixedWeek, chooseRotation } from '../lib/rotation.ts';
import { queueOf } from '../lib/queue.ts';
import { api, webauthnOK, passkeyRegister, passkeyError, IS_ANDROID } from '../lib/api.ts';
import { pushSupported, enablePush, disablePush, sendTestPush, syncPushSubscription } from '../lib/push.ts';
import { wakeLockSupported } from '../lib/wakelock.ts';
import { t, tn, LANGS, INSTR_LANGS, EXERCISE_NAME_LANGS, baseLang, dateLocale } from '../lib/i18n.ts';
import { effectiveLang } from '../lib/default-lang.ts';
import { DEMO, REPO } from '../lib/demo.ts';
import { MOBILE, isAndroid, shareExport, shareExportBlob, syncReminder } from '../lib/mobile.ts';
import { NUDGE_COPY, NUDGE_TONES, toneOf } from '../lib/nudge.ts';
import { referencedFiles } from '../lib/media-refs.ts';
import { mediaStore } from '../lib/media-store.ts';
import { syncMedia, fetchToStore } from '../lib/media-sync.ts';
import { getMediaStatus, subscribeMediaStatus, pendingRefCount } from '../lib/media-owed.ts';
import { limitsFrom, fmtMB, MB } from '../lib/media-limits.ts';
import { setRestAccent } from '../lib/rest-alert.ts';
import { CUSTOM, accentKey, adjustedIn, applyAccent, cleanHex, inkOn, isGrey } from '../lib/accent.ts';
import { checkForUpdate, downloadAndInstall, fetchChecksum, forgetDownloadedUpdate, RELEASES_PAGE } from '../lib/update.ts';
import { APK_VARIANT, VARIANT_NAMES } from '../lib/apk-variant.ts';
import { BUILTIN_PX } from '../lib/anim-quality.ts';
import { selfUpdates } from '../lib/channel.ts';
import { forgetCoach } from '../lib/coach-api.ts';
import { coachAvailable } from '../lib/coach.ts';
import { REST_MAX, REST_PAUSE_MIN, REST_PAUSE_MAX, fmtRest, fmtDuration } from '../lib/duration.ts';
import { starterPlanSheet, confirmSheet, importFromApp, importFromHevy, equipmentProfileSheet, plateInventorySheet, dumbbellInventorySheet, barDefaultsSheet, menuSheet } from '../sheets.tsx';
import Icon from '../components/Icon.tsx';
import { durationSheet } from '../components/DurationWheel.tsx';
import { showsConnection, showsLocalLine } from '../components/SyncBanner.tsx';
import BackupFolderRow, { useBackupFolder, autoBackupSubtitle } from '../components/BackupFolderRow.tsx';
import AppIconRow from '../components/AppIconRow.tsx';
import { AnimationQualityRow } from '../components/Animations.tsx';
import { ServerSyncSection, KeptChangesRows, leaveServer, connectServer, passkeySignIn } from '../components/ServerSync.tsx';
import { passwordOn, PasswordRow, openPasswordSignIn, openPasswordRegister } from '../components/PasswordAuth.tsx';
import { usePasskeys, PasskeysRow, DeviceLinkRow, openDeviceLinkRedeem, PairSheet } from '../components/Passkeys.tsx';
import { DeleteAccountRow } from '../components/DeleteAccount.tsx';
import { Section, Row, SelectRow, Switch, Segmented, Button, TextField, SearchField } from '../components/ui.tsx';
import { PAGES, ROOT_GROUPS, pageVisible, searchSettings, pageTrail } from './settings-pages.ts';
import { platformNow } from '../lib/platform-now.ts';
import { pathBefore } from '../lib/nav.ts';
import WatchSettingsPage from './WatchSettings.tsx';
import { reportSheet } from '../components/ReportSheet.tsx';
import { csvExportSheet } from '../components/CsvExportSheet.tsx';
import GymReminderPage, { GymEditPage } from './GymReminder.tsx';
import { readGymConfig } from '../lib/gym-reminder.ts';
import { THEMES, inSeason, seasonChoice, activeSeason } from '../lib/seasonal.ts';
/* Settings (v1.3.11). The root is one screen: an account card, eleven rows that each open a page
   (/settings/<page>), and a search over every row. Rare things live one level further down
   (Workout → Fine-tuning). The rows and their rules are the ones the single long page had; only
   where they sit changed. settings-pages.ts says which page holds what, and is what the search
   reads. `page` is the open page (null for the root), `find` a row a search hit asked for, which
   is scrolled to and flashed. */
// What was typed into the search, kept while you step into a hit and back out again: tied to
// the history entry it was typed on, so Back (in the app, the browser's or Android's) brings the
// results back, while Settings opened afresh from anywhere (the gear, a tab) starts at the root.
let lastQuery: any = { q: '', key: null };
// The route: /settings and /settings/<page>. An unknown page, or one this device does not have
// (the Coach page off the phone app), goes back to the root.
export function SettingsRoute() {
    const { page }: any = useParams();
    const loc: any = useLocation();
    // `ios` now, not after an async platform check: the Apple Watch page is iPhone only, and a route
    // that did not know yet sent every visit to it straight back to the root.
    // (Unknown counts as yes inside the phone app: the page itself then says there is no watch.)
    const ctx: any = { user: useStore((s?: any) => s.user), mobile: MOBILE, ios: MOBILE && platformNow() !== 'android' };
    if (page && (!PAGES[page] || !pageVisible(PAGES[page].parent || page, ctx) || !pageVisible(page, ctx)))
        return <Navigate to="/settings" replace/>;
    if (page === 'coach')
        return <Navigate to="/coach/setup" replace/>;
    return <Settings key={page || 'root'} page={page || null} find={loc.state?.find || null} via={loc.state?.via || null} entryKey={loc.key}/>;
}
// "Mon" / "Sun" in the app's language, for the Plan & schedule row's preview.
const shortWeekday: any = (day?: any) => {
    try {
        return new Intl.DateTimeFormat(dateLocale(), { weekday: 'short' }).format(new Date(2024, 0, day === 0 ? 7 : 1));
    }
    catch {
        return day === 0 ? 'Sun' : 'Mon';
    }
};
// Running as an installed app (home-screen web app or the phone app): no install tip then.
const standalone: any = () => {
    try {
        return !!(window.matchMedia?.('(display-mode: standalone)').matches || window.navigator.standalone === true);
    }
    catch {
        return false;
    }
};
// Apple devices, the iPad included (it says Macintosh): the install tip's Safari wording. Read here
// rather than from lib/api.ts, whose test mocks across the Settings suites only carry IS_ANDROID.
const APPLE_UA: any = typeof navigator !== 'undefined' && /iPhone|iPad|iPod|Macintosh/.test(navigator.userAgent);
export default function Settings({ page = null, find = null, via = null, entryKey = null }: any) {
    const nav: any = useNavigate();
    const S: any = useStore((s?: any) => s.S);
    const user: any = useStore((s?: any) => s.user);
    const sync: any = useStore((s?: any) => s.sync);
    const coachLocal: any = useStore((s?: any) => s.coachLocal);
    // Name-and-password sign-in, where the instance offers it (#118).
    const config: any = useStore((s?: any) => s.config);
    const pwOn: any = passwordOn(config);
    // What the app is showing, which for a profile that never picked a language is worked out on
    // this device rather than stored (#303).
    const lang: any = effectiveLang(S, config);
    // This profile's passkeys and the code for another device (#95). A change to them is read back
    // here and by the password row, whose "Remove" depends on there being a passkey.
    // On a paired phone only the code for another device uses it (#551).
    const passkeys: any = usePasskeys(!!user && !DEMO && (page === 'account'));
    const [credsV, setCredsV]: any = useState(0);
    const credsChanged: any = () => { passkeys.load(); setCredsV((v?: any) => v + 1); };
    const { update, importConflict, importBackup, setUnit, resetEverything: resetAll, setUser, pullState, pushState, resetDemo }: any = useStore();
    const toast: any = useUI((s?: any) => s.toast);
    const fileRef: any = useRef(null);
    const importRef: any = useRef(null);
    const body: any = useRef(null);
    const wakeOK: any = wakeLockSupported();
    // The gym reminder's switch lives on its own page and on this device only (lib/gym-reminder.ts).
    const gymOn: any = MOBILE && readGymConfig().on;
    // A planner's own queue (no rotationId, or one that doesn't match the saved rotation here) is
    // not this app's to switch off or overwrite. The Scheduling row goes read-only for it.
    const liveQ: any = queueOf(S);
    const externalQ: any = !!liveQ && (!S.rotation || liveQ.rotationId !== S.rotation.id);
    // Two honest choices on a unit switch (issue #22): convert the numbers, or keep them and only
    // change the label — the old behaviour, still right for someone who logged in lb all along
    // under a kg label. Closing the sheet leaves the unit as it was.
    const switchUnit: any = (v?: any) => {
        if (v === S.unit)
            return;
        menuSheet({
            title: t('Convert to {0}?', v),
            subtitle: t('Every stored weight (logged sets, working weights, routine targets, body weight, bar weights) is in {0}. Convert the numbers, or keep them and only change the label?', S.unit),
            items: [
                { icon: 'calculator', label: t('Convert the numbers'), onClick: () => setUnit(v) },
                { icon: 'pencil', label: t('Keep the numbers, change the label'), onClick: () => setUnit(v, { convert: false }) },
            ],
        });
    };
    // Fixed Week or Rotation. A live queue always wins (scheduleModeOf, lib/rotation.ts) — a queue
    // written by a planner switches the app to Rotation on its own — but choosing Rotation with
    // nothing built yet has no queue to derive from, so S.scheduleMode is what keeps it selected
    // (and the weekday grid hidden, on both Home and Plan) until the first routine is added.
    // Fixed Week behaves as on Plan (views/Plan.tsx setMode), with the same words: with no loop
    // running there is nothing to lose and it switches at once; a running loop asks first.
    const setScheduleMode: any = (v?: any) => {
        if (v === scheduleModeOf(S))
            return;
        if (v === 'week') {
            // A planner's own queue is never this app's to drop — this control is text-only while one
            // is live (below), but the guard stays here too rather than trust the render alone.
            if (!liveQ) {
                update((s?: any) => { chooseFixedWeek(s); });
                return;
            }
            confirmSheet({
                title: t('Back to a fixed week?'),
                message: t('The loop stops. Your weekdays stay as they are, and the loop is saved for later.'),
                confirmText: t('Use Fixed Week'),
                onConfirm: () => update((s?: any) => { chooseFixedWeek(s); }),
            });
            return;
        }
        // The same switch as Plan's "How you train" (lib/rotation.ts). With nothing to start (no
        // saved sequence, or a malformed queue Plan has to sort out) the choice holds and you stay
        // here: the page then offers the way to Plan (below), so picking a value never leaves it.
        update((s?: any) => { chooseRotation(s); });
    };
    // --- update check state ---
    const [updateInfo, setUpdateInfo]: any = useState(null); // { hasUpdate, latestVersion, apkUrl, hashUrl } | null
    const [android, setAndroid]: any = useState(false);
    const [ios, setIos]: any = useState(() => MOBILE && platformNow() === 'ios'); // the iPhone app: Settings → Apple Watch
    const [selfUpdate, setSelfUpdate]: any = useState(false); // the sideloaded APK, which updates itself
    const [checking, setChecking]: any = useState(false);
    // Where auto-backup writes on this Android phone, for the Auto-backup row's own subtitle.
    const [backupDir]: any = useBackupFolder(MOBILE && android && !!S.autoBackup);
    useEffect(() => {
        // The in-app updater installs an .apk, so it only applies to the native Android build.
        // On iOS and the web this check is skipped and the update row never appears. isAndroid()
        // already answers false off the mobile build; the MOBILE check on top keeps the web bundle
        // from even asking (and from calling GitHub on every Settings visit). Only the pages
        // that show it ask: the root (for nothing but `android`) skips the release check.
        // The Google Play build is updated by Play (lib/channel.ts): no update row there either.
        if (!MOBILE)
            return;
        isAndroid().then(async (ok?: any) => {
            setAndroid(ok);
            setIos(!ok);
            const own: any = ok && await selfUpdates();
            setSelfUpdate(own);
            // Nothing newer: an update APK still in the cache is the one already installed.
            if (own && page === 'about')
                checkForUpdate().then((info?: any) => { setUpdateInfo(info); if (!info?.hasUpdate)
                    forgetDownloadedUpdate(); }).catch(() => { });
        });
    }, [page]);
    // A search hit: scroll its row (or button) into view and flash it once. A row that shows only
    // once the page has heard back from the server (web push, the passkey list) is waited for a
    // moment; still missing, the hit's `via` row, if it names one, is flashed instead, with a word
    // on why.
    useEffect(() => {
        if (!find || !body.current)
            return;
        const el: any = body.current;
        const named: any = (label?: any) => [...el.querySelectorAll('.lrow')].find((r?: any) => r.querySelector('.lrow-t')?.textContent === label)
            || [...el.querySelectorAll('.btn')].find((b?: any) => b.textContent.trim() === label);
        let tm: any = null;
        const flash: any = (row?: any) => {
            row.classList.add('sp-flash');
            if (typeof row.scrollIntoView === 'function')
                row.scrollIntoView({ block: 'center' });
            tm = setTimeout(() => row.classList.remove('sp-flash'), 1900);
        };
        const row: any = named(t(find));
        if (row) {
            flash(row);
            return () => clearTimeout(tm);
        }
        let done: any = false;
        const mo: any = typeof MutationObserver === 'function' ? new MutationObserver(() => {
            const r: any = named(t(find));
            if (r && !done) {
                done = true;
                mo.disconnect();
                clearTimeout(wait);
                flash(r);
            }
        }) : null;
        mo?.observe(el, { childList: true, subtree: true });
        const wait: any = setTimeout(() => {
            if (done)
                return;
            done = true;
            mo?.disconnect();
            const r: any = via && named(t(via));
            if (r) {
                flash(r);
                toast(t('Turn on push notifications first.'));
            }
        }, 1500);
        return () => { done = true; mo?.disconnect(); clearTimeout(wait); clearTimeout(tm); };
    }, [find]);
    // The same check, on demand: the automatic one is silent when it finds nothing or cannot
    // reach GitHub, and a person who taps "Check for updates" deserves an answer either way.
    const checkNow: any = async () => {
        if (checking)
            return;
        setChecking(true);
        try {
            const info: any = await checkForUpdate();
            setUpdateInfo(info);
            if (!info.hasUpdate) {
                toast(t('You have the latest version.'));
                forgetDownloadedUpdate();
            }
        }
        catch {
            toast(t('Couldn’t check for updates. Are you online?'));
        }
        setChecking(false);
    };
    const onUpdateRowClick: any = () => {
        if (!updateInfo?.hasUpdate)
            return;
        if (updateInfo.apkUrl) {
            // Start download & install
            const version: any = updateInfo.latestVersion;
            confirmSheet({
                title: t('Update to {0}?', version),
                message: t('The latest version will be downloaded and the installer will open.'),
                confirmText: t('Download & Install'),
                onConfirm: async () => {
                    // Open a progress sheet
                    let closeProgress: any = null;
                    let setProgress: any = null;
                    useUI.getState().openSheet((close?: any) => {
                        closeProgress = close;
                        return <DownloadProgress ref={(fn?: any) => { setProgress = fn; }}/>;
                    }, { locked: true });
                    try {
                        // The release always publishes the checksum next to the APK. Without it the file is
                        // not installed — a sideloaded binary is exactly the thing that should be verified.
                        let expectedHash: any = null;
                        try {
                            expectedHash = await fetchChecksum(updateInfo.hashUrl);
                        }
                        catch (e: any) { /* reported below */ }
                        if (!/^[0-9a-f]{64}$/i.test(expectedHash || ''))
                            throw new Error(t('Checksum not available, so not installing'));
                        await downloadAndInstall(updateInfo.apkUrl, expectedHash, (received?: any, total?: any) => {
                            if (setProgress)
                                setProgress(received, total);
                        });
                        if (closeProgress)
                            closeProgress();
                    }
                    catch (e: any) {
                        if (closeProgress)
                            closeProgress();
                        toast(t('Update failed: {0}', e.message));
                    }
                },
            });
        }
        else {
            // Update available but no APK asset — open the releases page
            window.open(RELEASES_PAGE, '_blank', 'noopener');
        }
    };
    // Reads the store at the moment of the tap: the sheet that asks before a sign-out offers it too,
    // and the copy it exports is the one that has not reached the server.
    const doExport: any = async () => {
        const json: any = JSON.stringify(useStore.getState().S, null, 2);
        const name: any = 'opengym-backup-' + todayISO() + '.json';
        // WKWebView can't download blob URLs — the native build hands the file to the share sheet.
        if (MOBILE) {
            try {
                await shareExport(json, name);
                toast(t('Backup exported'));
            }
            catch (e: any) { /* share sheet dismissed */ }
            return;
        }
        const blob: any = new Blob([json], { type: 'application/json' });
        const a: any = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = name;
        a.click();
        URL.revokeObjectURL(a.href);
        toast(t('Backup exported'));
    };
    // "Export with photos & videos": the same JSON plus every file the state refers to, in a zip
    // (lib/backup-media.ts). Signed in, a file this device never downloaded is fetched for it; one
    // nobody has is left out and counted. The sign-out sheet offers it while media are waiting.
    const doExportZip: any = async () => {
        const { exportBackupZip }: any = await import('../lib/backup-media.ts');
        const st: any = useStore.getState();
        const signedIn: any = !!(st.user && st.config?.media);
        let out: any;
        try {
            out = await exportBackupZip(st.S, { fetchOne: signedIn ? fetchToStore : null });
        }
        catch {
            toast(t('Something went wrong'));
            return;
        }
        const name: any = 'opengym-backup-' + todayISO() + '.zip';
        if (out.missing)
            toast(tn('{0} file could not be included', '{0} files could not be included', out.missing));
        if (MOBILE) {
            try {
                await shareExportBlob(out.blob, name);
                if (!out.missing)
                    toast(t('Backup exported'));
            }
            catch (e: any) { /* share sheet dismissed */ }
            return;
        }
        const a: any = document.createElement('a');
        a.href = URL.createObjectURL(out.blob);
        a.download = name;
        a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 60000);
        if (!out.missing)
            toast(t('Backup exported'));
    };
    // Import takes the JSON backup and the zip alike, told apart by their first bytes. A zip's
    // files go into the local store only once the import is confirmed, each checked against its
    // name first; the state's media refs and links pass the usual gates (lib/backup-media.ts).
    const doImport: any = async (ev?: any) => {
        const f: any = ev.target.files[0];
        if (!f)
            return;
        ev.target.value = '';
        let read: any;
        try {
            const { readBackupFile }: any = await import('../lib/backup-media.ts');
            read = await readBackupFile(f);
        }
        catch (e: any) {
            const { backupImportError }: any = await import('../lib/backup-media.ts');
            toast(backupImportError(e));
            return;
        }
        const apply: any = async (mergeWith?: any) => {
            if (read.files.length) {
                const { storeBackupMedia }: any = await import('../lib/backup-media.ts');
                await storeBackupMedia(read.files, { limits: limitsFrom(useStore.getState().config) });
            }
            importBackup(read.state, { mergeWith });
            // The photos it brought are pending here and maybe gone from the server (a reset): sent now,
            // not after the ten-minute dedupe of the run before the reset.
            if (read.files.length)
                syncMedia({ force: true });
            toast(t('Backup imported'));
        };
        // Signed in, the server is asked first: a workout logged since the backup was made, or on
        // another device meanwhile, would be deleted from the profile by the replace — said, with the
        // choice to merge those in instead (useStore importConflict / importBackup).
        const conflict: any = await importConflict(read.state);
        if (conflict) {
            const n: any = conflict.workouts;
            menuSheet({
                title: t('Import backup?'),
                subtitle: conflict.device
                    ? t(n === 1 ? 'This device has 1 workout that is not in this backup. Replacing deletes it.'
                        : 'This device has {0} workouts that are not in this backup. Replacing deletes them.', n)
                    : t(n === 1
                        ? 'The server has 1 workout that is not in this backup, logged since it was made or on another device. Replacing deletes it.'
                        : 'The server has {0} workouts that are not in this backup, logged since it was made or on another device. Replacing deletes them.', n),
                items: [
                    { icon: 'trash', label: t('Replace anyway'), danger: true, onClick: () => apply(null) },
                    { icon: 'merge', label: t('Merge them in'), onClick: () => apply(conflict) },
                    { icon: 'xmark', label: t('Cancel'), onClick: () => { } },
                ],
            });
            return;
        }
        confirmSheet({
            title: t('Import backup?'), message: t('This replaces all current data with the backup file.'), confirmText: t('Import'), danger: true,
            onConfirm: () => apply(null)
        });
    };
    // Whether any custom exercise has a photo or video: the rows about them only show then.
    const hasMedia: any = referencedFiles(S).length > 0;
    const registerHere: any = () => useUI.getState().openSheet((close?: any) => <RegisterInline close={close} setUser={setUser} pushState={pushState} pullState={pullState} toast={toast}/>);
    /* Disconnect (phone), Sign out, Sign out everywhere. None of them wipes this device while the
       server is missing a change: the confirm no longer promises a sync it never checked, and when
       something is owed, a second sheet says how much and offers to try again, to export a backup,
       or to go ahead anyway with the changes kept on this device (components/ServerSync.tsx).
       "Sign out everywhere" also ends every paired phone's token — the phones have no passkey to
       sign in with, so they have to be paired again, and the confirm says so. Failing, it touches
       nothing local: still signed in here, and the toast says so. */
    const kept: any = t('The changes your server has not seen are kept on this device, and added back when it connects as this account again.');
    // A workout running here is kept aside by the sign-out (useStore stashActive): the confirm says so.
    const running: any = () => S.active ? ' ' + t('You have a workout running. It waits on this device until you’re back on this account.') : '';
    const leave: any = (kind?: any, after?: any) => leaveServer(kind, { exportBackup: doExport, exportBackupZip: doExportZip, done: (r?: any) => { nav('/home'); if (r.stashed)
            toast(kept);
        else if (after)
            toast(after); } });
    const disconnect: any = () => confirmSheet({
        title: t('Disconnect from your server?'),
        message: t('This phone switches back to local-only and its copy of your account is removed. First it checks that your server has every change. If not, you choose what happens to them.') + running(),
        confirmText: t('Disconnect'), danger: true,
        onConfirm: () => leave('disconnect', t('Disconnected. Back to local-only')),
    });
    const signOutHere: any = () => confirmSheet({
        title: t('Sign out?'),
        message: t('Your data is removed from this browser; your profile on the server keeps it. First it checks that the server has every change. If not, you choose what happens to them.') + running(),
        confirmText: t('Sign out'), danger: true,
        onConfirm: () => leave('signout'),
    });
    const signOutEverywhere: any = () => confirmSheet({
        title: t('Sign out everywhere?'),
        message: t('Signs this profile out on every device, including this one. Phones paired with it are disconnected and have to be paired again. Your passkeys keep working, so you can sign in with them again anytime.') + running(),
        confirmText: t('Sign out everywhere'), danger: true,
        onConfirm: () => leave('everywhere', t('Signed out on all devices')),
    });
    // Signed in, the empty state is pushed to the profile like any other change, so the wipe
    // reaches the server and every device that syncs with it — the dialog has to say so. The Coach
    // keeps its data outside S in two homes that can both be in use on one phone: a file per
    // profile on the server, and — when it runs with the phone's own key — a file on the device.
    // Each is cleared on its own; forgetCoach() alone would pick one by mode. A failed call must
    // not stop the reset.
    const resetEverything: any = () => confirmSheet({
        title: t('Reset everything?'),
        message: user
            ? t('Deletes your plan, workouts, body weight, photos and videos from your profile on this server and on every signed-in device. This cannot be undone.')
            : t('Deletes your plan, workouts, body weight, photos and videos on this device. This cannot be undone.'),
        confirmText: t('Delete everything'), danger: true,
        onConfirm: () => {
            if (user)
                api('/api/coach/forget', { method: 'POST', body: '{}' }).catch(() => { });
            if (coachLocal?.mode === 'byok')
                forgetCoach().catch(() => { });
            resetAll();
            nav('/home');
            toast(t('All data reset'));
            clearMediaAfterReset(!!user).catch(() => { });
        },
    });
    /* ---------------- what the pages and the search need to know about this device ---------------- */
    const canVibrate: any = vibrateSupported();
    const ctx: any = {
        user, mobile: MOBILE, android, ios: MOBILE && ios, appIcons: MOBILE && platformNow() === 'ios', demo: DEMO, wakeOK, hasMedia, pwOn, webauthn: webauthnOK(),
        sound: !!S.sound, playOnSilent: playOnSilentSupported(), canVibrate, vibrate: S.vibrate !== false,
        profiles: (S.equipProfiles || []).length > 0, nameLang: EXERCISE_NAME_LANGS.includes(baseLang(lang)),
        pushOK: !MOBILE && pushSupported(), reminderOn: !!S.reminder?.on, nudge: !!S.reminder?.nudge,
        autoBackup: !!S.autoBackup, synced: !!sync, installTip: !MOBILE && !standalone(), androidWeb: IS_ANDROID, desktopWeb: !IS_ANDROID && !APPLE_UA,
    };
    const mode: any = scheduleModeOf(S);
    const layout: any = ['list', 'compact', 'focus'].includes(S.workoutView) ? S.workoutView : 'cards';
    const layoutLabel: any = ({ cards: t('Cards'), list: t('List'), compact: t('Compact') } as any)[layout];
    const activeProfile: any = (S.equipProfiles || []).find((p?: any) => p.id === S.activeEquipId);
    const themeLabel: any = ({ dark: t('Dark'), light: t('Light'), system: t('System') } as any)[S.theme || 'dark'] || t('Dark');
    // The value a root row shows, so most questions are answered without opening the page.
    const preview: any = {
        workout: () => (S.restSec > 0 ? t('{0} rest', fmtRest(S.restSec)) : t('No rest timer')) + ' · ' + layoutLabel,
        alerts: () => [S.sound ? t('Sound') : null, canVibrate && S.vibrate !== false ? t('Vibrate') : null, S.timerFlash ? t('Flash') : null].filter(Boolean).join(' · ') || t('Silent'),
        reminders: () => (S.reminder?.on ? (S.reminder.time || DEF.reminder?.time || '') : t('Off')),
        plan: () => (mode === 'rotation' ? t('Rotation') : t('Fixed Week')) + ' · ' + shortWeekday(weekStartOf(S) === SUNDAY ? 0 : 1),
        units: () => (S.unit || 'kg') + ' · ' + (LANGS[lang] || lang),
        equipment: () => (S.equipFilterOn && activeProfile ? activeProfile.name : ownsNoDumbbells(S) ? t('Everything but dumbbells') : t('Everything')),
        look: () => themeLabel + ' · ' + accentLabel(S),
        coach: () => (coachLocal?.mode === 'server' ? t('Your server') : coachLocal?.mode === 'byok' ? t('Your API key') : t('Off')),
        data: () => '',
        about: () => 'v' + __APP_VERSION__,
        watch: () => '',
    };
    const open: any = (id?: any) => {
        if (id === 'coach') {
            nav('/coach/setup');
            return;
        }
        nav('/settings/' + id);
    };
    // Back the way you came when there is a way (the browser's back, Android's back, this button
    // all do the same); a page opened from a link with nothing behind it goes up to its parent.
    const back: any = () => {
        const up: any = PAGES[page]?.parent ? '/settings/' + PAGES[page].parent : '/settings';
        if ((window.history.state?.idx || 0) > 0)
            nav(-1);
        else
            nav(up, { replace: true });
    };
    /* ---------------- the pages ---------------- */
    const restRow: any = <Row icon="timer" iconTint="var(--orange)" title={t('Rest timer')} value={fmtRest(S.restSec)} accessory="chevron" onClick={() => durationSheet({
            title: t('Rest timer'), value: S.restSec, max: REST_MAX, off: t('Off'),
            footer: t('Scroll to 0:00 to turn the rest timer off.'),
            onDone: (v?: any) => update((s?: any) => { s.restSec = v; }),
        })}/>;
    // Default for a rest-pause burst added live on a plain set. A planned exercise's own "Rest (s)"
    // (in its drop set / burst config) overrides it, the same way the main rest timer is the
    // fallback for an exercise without a rest of its own. On the wheel too, 5 s to 5 min: the
    // burst's rest is never 0 (lib/history.ts keeps it at 5 s at least), so the wheel stops there.
    const restPauseRow: any = <Row icon="bolt" iconTint="var(--orange)" title={t('Rest-pause rest')} value={fmtDuration(S.restPauseSec || 15)} accessory="chevron" onClick={() => durationSheet({
            title: t('Rest-pause rest'), value: S.restPauseSec || 15, min: REST_PAUSE_MIN, max: REST_PAUSE_MAX,
            footer: t('The short break between the bursts of a rest-pause set.'),
            onDone: (v?: any) => update((s?: any) => { s.restPauseSec = v; }),
        })}/>;
    // The rest between warm-up sets for every exercise without its own (Discord: seals' "separate
    // warm-up rest"). Absent is like the work sets, 0 no timer (lib/supersetFlow.ts warmupRestSecFor).
    const warmAll: any = typeof S.warmupRestSec === 'number' ? S.warmupRestSec : null;
    const setWarm: any = (v?: any) => update((s?: any) => { if (v === null)
        delete s.warmupRestSec;
    else
        s.warmupRestSec = v; });
    const warmupRestRow: any = <Row icon="timer" iconTint="var(--yellow)" title={t('Rest between warm-ups')} accessory="chevron" subtitle={t('The last warm-up still gets the full rest before your first work set.')} value={warmAll === null ? t('Like the work sets') : warmAll > 0 ? fmtRest(warmAll) : t('No timer')} onClick={() => menuSheet({
            title: t('Rest between warm-ups'),
            items: [
                { icon: 'timer', label: t('Like the work sets'), on: warmAll === null, onClick: () => setWarm(null) },
                { icon: 'pause', label: t('No timer'), on: warmAll === 0, onClick: () => setWarm(0) },
                { icon: 'clock', label: t('Pick a time'), on: warmAll > 0, onClick: () => durationSheet({
                        title: t('Rest between warm-ups'), value: warmAll > 0 ? warmAll : 30, max: REST_MAX, off: t('No timer'),
                        onDone: (v?: any) => setWarm(v > 0 ? v : 0),
                    }) },
            ],
        })}/>;
    const pages: any = {
        watch: () => <WatchSettingsPage />,
        gym: () => <GymReminderPage />,
        'gym-edit': () => <GymEditPage />,
        workout: () => <>
      <Section title={t('Rest')} footer={t('Each exercise can have its own rest too. Set it in the exercise settings of a routine.')}>
        {restRow}
        {warmupRestRow}
        {restPauseRow}
      </Section>
      <Section title={t('Logging')}>
        {/* Two names for the same judgement, so the column asks in the scale you already think in.
                The (i) sits before the control: you read it on the way to the choice, not after it. */}
        <Row icon="gauge" iconTint="var(--purple)" title={t('Effort per set')}>
          <button className="helpbtn" aria-label={t('What are RIR and RPE?')} onClick={effortHelpSheet}><Icon name="info"/></button>
          <Segmented className="seg-inline" options={[{ value: 'none', label: t('Off') }, { value: 'rir', label: t('RIR') }, { value: 'rpe', label: t('RPE') }]} value={effortOf(S)} onChange={(v?: any) => update((s?: any) => { s.effort = v; delete s.showRir; })}/>
        </Row>
        {/* The line under each exercise that the rows are held against (#173). Tapping the line in
                a workout switches it too; this is where the choice can be found without knowing that. */}
        <SelectRow icon="history" iconTint="var(--blue)" title={t('Shown under each exercise')} value={S.logRef === 'best' ? 'best' : 'last'} onChange={(v?: any) => update((s?: any) => { s.logRef = v; })} options={[
                { value: 'last', label: t('Last time'), subtitle: t('What you did the last time, in that routine.') },
                { value: 'best', label: t('Best set'), subtitle: t('Your heaviest set of the exercise, from any workout.') },
            ]}/>
        {/* One exercise at a time (cards with Prev/Next), the whole session stacked as a
                scrollable list, or that list stripped to just names and set rows (compact). Legacy or
                unknown values read as cards. The workout's ⋯ menu can override it for one session. */}
        <Row icon="layout" iconTint="var(--blue)" title={t('Layout')}>
          <Segmented className="seg-inline" options={[{ value: 'cards', label: t('Cards') }, { value: 'list', label: t('List') }, { value: 'compact', label: t('Compact') }, { value: 'focus', label: t('Focus') }]} value={layout} onChange={(v?: any) => update((s?: any) => { s.workoutView = v; })}/>
        </Row>
        {/* The saved side of the Layout menu's "Collapse completed exercises" (#241): on here, every
                session starts with it, and the menu still flips it for one session. Setting it here
                also drops a running session's own choice, so the switch does what it says right away. */}
        <Row icon="minimize" iconTint="var(--teal)" title={t('Collapse completed exercises')} subtitle={t('In List and Compact, a finished exercise folds into one line.')}>
          <Switch aria-label={t('Collapse completed exercises')} checked={!!S.collapseCompleted} onChange={(v?: any) => update((s?: any) => { s.collapseCompleted = v; if (s.active)
            delete s.active.collapseCompleted; })}/>
        </Row>
        {/* Its counterpart for Cards and Focus (#523): Prev, Next and the swipe jump over an
                exercise whose every set is done. */}
        <Row icon="skipForward" iconTint="var(--teal)" title={t('Skip completed exercises')} subtitle={t('In Cards and Focus, Prev and Next hop over a finished exercise.')}>
          <Switch aria-label={t('Skip completed exercises')} checked={S.skipCompleted === true} onChange={(v?: any) => update((s?: any) => { if (v)
            s.skipCompleted = true;
        else
            delete s.skipCompleted; })}/>
        </Row>
      </Section>
      <Section title={t('Before and during')}>
        {/* The quick weigh-in that opens on Start (sheets.tsx startFlow, issue #137); off skips
                straight to the session. Home and Stats still log weight by hand. */}
        <Row icon="scale" iconTint="var(--green)" title={t('Weigh in before workouts')} subtitle={t('Asks for your body weight when a workout starts. Off starts the session straight away.')}>
          <Switch checked={S.weighIn !== false} onChange={(v?: any) => update((s?: any) => { s.weighIn = v; })}/>
        </Row>
        {(wakeOK || !MOBILE) && (<Row icon="phoneScreen" iconTint="var(--yellow)" title={t('Keep screen awake')} subtitle={wakeOK ? t('The screen stays on while a workout is running, so you don’t have to unlock your phone between sets.') : t('Not supported in this browser.')}>
            <Switch checked={wakeOK && S.keepAwake !== false} disabled={!wakeOK} onChange={(v?: any) => update((s?: any) => { s.keepAwake = v; })}/>
          </Row>)}
        {/* 'full'/'mini' is also what the tap-toggle on the workout animation writes; 'off' hides
                workout media entirely (library, detail sheet and picker thumbs are unaffected).
                Legacy/unknown values read as 'full'. */}
        <Row icon="image" iconTint="var(--teal)" title={t('Exercise animations')}>
          <Segmented className="seg-inline" options={[{ value: 'full', label: t('Full') }, { value: 'mini', label: t('Small') }, { value: 'off', label: t('Hidden') }]} value={S.gifSize === 'mini' || S.gifSize === 'off' ? S.gifSize : 'full'} onChange={(v?: any) => update((s?: any) => { s.gifSize = v; })}/>
        </Row>
        {/* Store apps: how sharp the animations are, from packs this device downloads. Per device,
                never synced: the profile is not touched (components/Animations.tsx). */}
        <AnimationQualityRow />
      </Section>
      <Section>
        <Row icon="wrench" iconTint="var(--grey)" title={t('Fine-tuning')} subtitle={t('Buttons, timed sets')} accessory="chevron" onClick={() => open('advanced')}/>
      </Section>
    </>,
        advanced: () => {
            // S.wc overlays DEF.wc, so a profile from before these switches existed reads as the lean default.
            const wc: any = workoutControls(S);
            const setWc: any = (k?: any, v?: any) => update((s?: any) => { s.wc = { ...workoutControls(s), [k]: v }; });
            return <>
        <Section title={t('Sessions and timed sets')}>
          {/* Whose reps a planned session opens with (lib/session-start.ts). The plan's by default:
                    the routine is what you said you would do, and history and progression decide the
                    weight. The other choice is the old behaviour, reps carried over from last time, and
                    the weight too for an exercise with progression off. Absent (an older profile) reads
                    as the plan. */}
          <SelectRow icon="clipboard" iconTint="var(--green)" title={t('Planned sessions start from')} value={S.startFrom === 'last' ? 'last' : 'plan'} onChange={(v?: any) => update((s?: any) => { s.startFrom = v; })} options={[
                    { value: 'plan', label: t('Your plan'), subtitle: t('The routine’s sets and reps. Your history decides the weight.') },
                    { value: 'last', label: t('Your last session'), subtitle: t('The reps you logged last time in that routine, carried over. With progression off, the weight too.') },
                ]}/>
          {/* Where "last time" is read from (lib/history.ts lastAcrossRoutines, #770): the routine's
                    own last session by default (#216), so a heavy and a light day keep their numbers.
                    'any' reads the exercise's newest session wherever it was. Absent reads as the routine. */}
          <SelectRow icon="history" iconTint="var(--indigo)" title={t('Last time means')} value={S.lastFrom === 'any' ? 'any' : 'routine'} onChange={(v?: any) => update((s?: any) => { s.lastFrom = v; })} options={[
                    { value: 'routine', label: t('This routine'), subtitle: t('Your last session of the exercise in the same routine. Heavy day and light day stay apart.') },
                    { value: 'any', label: t('Any workout'), subtitle: t('The last time you did the exercise, whichever routine it was in.') },
                ]}/>
          <Row icon="stopwatch" iconTint="var(--orange)" title={t('Keep timing after target')} subtitle={t('Timed sets continue up to 15 extra minutes. Tap Done to log the actual duration.')}>
            <Switch aria-label={t('Keep timing after target')} checked={!!S.timedSetOvertime} onChange={(v?: any) => update((s?: any) => { s.timedSetOvertime = v; })}/>
          </Row>
        </Section>
        {/* The lean workout screen keeps the sets and one "more" button per exercise; each switch
                    brings one of the old always-visible button groups back for people who liked them. */}
        <Section title={t('Buttons on the workout screen')} footer={t('Everything hidden here stays one tap away: the ⋯ button of an exercise and the number of a set.')}>
          <Row icon="plusCircle" iconTint="var(--green)" title={t('Weight and reps buttons')} subtitle={t('Off: tap the number and type it')}>
            <Switch checked={wc.steppers} onChange={(v?: any) => setWc('steppers', v)}/>
          </Row>
          <Row icon="bolt" iconTint="var(--orange)" title={t('Drop and burst shortcuts on every set')}>
            <Switch checked={wc.setShortcuts} onChange={(v?: any) => setWc('setShortcuts', v)}/>
          </Row>
          {/* Swipe actions (v1.3.11): not a button, but the same question of what a set row does. The
                    one switch covers Plan's lists too; the stored key keeps its old name, swipeSets. */}
          <Row icon="swap" iconTint="var(--indigo)" title={t('Swipe actions')} subtitle={t('Sets, routines and the loop: left removes, right copies')}>
            <Switch aria-label={t('Swipe actions')} checked={wc.swipeSets} onChange={(v?: any) => setWc('swipeSets', v)}/>
          </Row>
          {/* The chip row at the top of a workout (#323): not a button row, but the same question of
                    what the workout screen shows. On by default, it is about one line tall. */}
          <Row icon="more" iconTint="var(--mint)" title={t('Exercise chips at the top')} subtitle={t('A numbered dot per exercise, filled as you go. Tap one to jump there.')}>
            <Switch aria-label={t('Exercise chips at the top')} checked={wc.exerciseChips} onChange={(v?: any) => setWc('exerciseChips', v)}/>
          </Row>
          {/* The live session's body (#670): at the end of the chip row, or in the header without it. */}
          <Row icon="figureStrength" iconTint="var(--orange)" title={t('Muscle map at the top')} subtitle={t('A tiny body that lights up as you tick sets. Tap it for the details.')}>
            <Switch aria-label={t('Muscle map at the top')} checked={wc.muscleMap} onChange={(v?: any) => setWc('muscleMap', v)}/>
          </Row>
          <Row icon="link" iconTint="var(--blue)" title={t('Superset buttons in the exercise header')}>
            <Switch checked={wc.pairButtons} onChange={(v?: any) => setWc('pairButtons', v)}/>
          </Row>
          <Row icon="swap" iconTint="var(--teal)" title={t('Move, swap and remove buttons below the exercise')}>
            <Switch checked={wc.exerciseButtons} onChange={(v?: any) => setWc('exerciseButtons', v)}/>
          </Row>
        </Section>
      </>;
        },
        alerts: () => {
            const iPhone: any = appleTouchDevice();
            return <>
        <Section title={t('When a rest ends')}>
          <Row icon="speaker" iconTint="var(--pink)" title={t('Play a sound')}>
            {/* Turning the sound on is a tap: unlock the audio context now so a timer that ends
                    before the next set check can already sound (iOS, #152). */}
            <Switch checked={!!S.sound} onChange={(v?: any) => { if (v)
                unlock(true); update((s?: any) => { s.sound = v; }); }}/>
          </Row>
          {/* The chime that replaced the original three beeps (Discord: "too quiet under music")
                    is not an improvement for everyone: louder is a cost with headphones or in a quiet
                    room, and some want a sound that feels like theirs (#306). The chime by default; the
                    sheet plays each one as you tap it (restSoundSheet). */}
          {S.sound && <Row icon="speaker" iconTint="var(--pink)" title={t('Sound')} value={t(REST_SOUND_LABEL[restSoundOf(S)])} accessory="chevron" onClick={restSoundSheet}/>}
          {/* iOS only (WebKit's audio-session API, iOS 17+): with it off the ring/silent switch
                    mutes the timer. On, the phone treats the timer like a music player (exclusive, and
                    the music app is not told it may resume), so it is a choice, off by default. */}
          {S.sound && playOnSilentSupported() && (<Row icon="speaker" iconTint="var(--orange)" title={t('Play even on silent')} subtitle={<>{t('Music playing on this phone stops during a workout and does not resume by itself.')}<br />{t('iPhone only')}</>}>
              <Switch checked={!!S.soundOnSilent} onChange={(v?: any) => update((s?: any) => { s.soundOnSilent = v; })}/>
            </Row>)}
        </Section>
        {/* The buzz at the end of a rest or a hold and on a set tick, on its own switch like the
                    sound (Discord, asierlama). iOS has no navigator.vibrate: the row stays, greyed out,
                    and says so, instead of an iPhone user looking for a setting that is not there. */}
        <Section footer={!canVibrate && iPhone ? t('iPhone doesn’t let openGym vibrate. A sound or a flash does the job.') : null}>
          <Row icon="vibrate" iconTint="var(--indigo)" title={t('Vibrate')} className={canVibrate ? '' : 'dis'} subtitle={canVibrate ? null : iPhone ? t('Not on iPhone') : t('Not supported in this browser.')}>
            <Switch checked={canVibrate && S.vibrate !== false} disabled={!canVibrate} onChange={(v?: any) => update((s?: any) => { s.vibrate = v; })}/>
          </Row>
          {/* Android app only (#375), and only shown there, so it needs no "Android app only" hint: silent mode mutes the ordinary buzz and the notification's,
                    so the end of a rest or a hold can buzz as an alarm instead. Opt-in, like the iOS row
                    above: an alarm-class buzz is the most insistent thing an app can do on some phones. */}
          {MOBILE && android && canVibrate && S.vibrate !== false && (<Row icon="vibrate" iconTint="var(--indigo)" title={t('Vibrate on silent too')} subtitle={t('The end of a rest or a hold buzzes like an alarm, even in silent mode.')}>
              <Switch checked={!!S.vibrateOnSilent} onChange={(v?: any) => update((s?: any) => { s.vibrateOnSilent = v; })}/>
            </Row>)}
          <Row icon="sun" iconTint="var(--yellow)" title={t('Flash the screen')}>
            <Switch checked={!!S.timerFlash} onChange={(v?: any) => update((s?: any) => { s.timerFlash = v; })}/>
          </Row>
        </Section>
      </>;
        },
        reminders: () => <>
      <NotificationsCard S={S} update={update} toast={toast}/>
      {MOBILE && <Section footer={t('A nudge when you walk into your gym.')}>
        <Row icon="mapPin" iconTint="var(--green)" title={t('Gym reminder')} value={gymOn ? t('On') : t('Off')} accessory="chevron" onClick={() => nav('/settings/gym')}/>
      </Section>}
    </>,
        plan: () => <>
      <Section>
        {/* Fixed Week (S.week) or Rotation (the live queue, lib/queue.ts + lib/rotation.ts).
                Derived from the queue, never stored. */}
        <Row icon="repeat" iconTint="var(--orange)" title={t('How you train')}>
          {externalQ
                ? <span className="small dim">{t('Rotation')} · {t('Externally managed')}</span>
                : <Segmented className="seg-inline" options={[{ value: 'week', label: t('Fixed Week') }, { value: 'rotation', label: t('Rotation') }]} value={mode} onChange={setScheduleMode}/>}
        </Row>
        {/* Rotation chosen with no loop running yet: the loop is built on Plan. */}
        {mode === 'rotation' && !liveQ && <Row icon="calendar" iconTint="var(--orange)" title={t('Build your loop in Plan')} accessory="chevron" onClick={() => nav('/plan')}/>}
        {/* Monday or Sunday: the Plan list, the Home strip, the calendar grid and every "this
                week" total follow it. Stored as a getDay() index (see lib/format.ts). */}
        <Row icon="calendar" iconTint="var(--orange)" title={t('Week starts on')}>
          <Segmented className="seg-inline" options={[{ value: MONDAY, label: t('Monday') }, { value: SUNDAY, label: t('Sunday') }]} value={weekStartOf(S)} onChange={(v?: any) => update((s?: any) => { s.weekStart = v; })}/>
        </Row>
      </Section>
      <Section>
        <Row icon="clipboard" iconTint="var(--green)" title={t('Load starter plan')} accessory="chevron" onClick={starterPlanSheet}/>
      </Section>
    </>,
        units: () => <>
      <Section>
        <SelectRow icon="globe" iconTint="var(--blue)" title={t('Language')} value={lang} onChange={(v?: any) => update((s?: any) => { s.lang = v; s.langAuto = false; })} options={Object.entries(LANGS).map(([k, name]: any) => ({
                value: k, label: name,
                subtitle: INSTR_LANGS.includes(k) ? null : t("Exercise instructions aren't translated into this language yet, so they stay in English."),
            }))}/>
        {ctx.nameLang && <>
          <Row icon="globe" iconTint="var(--purple)" title={t('English exercise names')} subtitle={t('Show the English name in parentheses next to the translated one.')}>
            <Switch checked={S.enParens?.[baseLang(lang)] ?? true} disabled={S.enOnly?.[baseLang(lang)] === true} onChange={(v?: any) => update((s?: any) => { s.enParens = { ...(s.enParens || {}), [baseLang(lang)]: v }; })}/>
          </Row>
          <Row icon="globe" iconTint="var(--purple)" title={t('English names only')} subtitle={t('Replace the translated names with the original English ones.')}>
            <Switch checked={S.enOnly?.[baseLang(lang)] === true} onChange={(v?: any) => update((s?: any) => { s.enOnly = { ...(s.enOnly || {}), [baseLang(lang)]: v }; })}/>
          </Row>
        </>}
      </Section>
      <Section footer={t('Switching the unit offers to convert every stored weight.')}>
        <Row icon="scale" iconTint="var(--teal)" title={t('Weight unit')}>
          <Segmented className="seg-inline" options={[{ value: 'kg', label: 'kg' }, { value: 'lb', label: 'lb' }]} value={S.unit} onChange={(v?: any) => switchUnit(v)}/>
        </Row>
        {/* Display only: one decimal reads fine for plate-loadable numbers, two for anyone whose
                per-side figure lands on .25 or .75, or who loads microplates (issue #139). Nothing is
                stored or rounded differently; lib/format.ts fmtNum just prints what is already there. */}
        <Row icon="ruler" iconTint="var(--teal)" title={t('Weight decimals')} subtitle={t('How precisely weights are shown.')}>
          <Segmented className="seg-inline" options={[{ value: 1, label: t('0.5') }, { value: 2, label: t('0.25') }]} value={S.wdec === 2 ? 2 : 1} onChange={(v?: any) => update((s?: any) => { s.wdec = v; })}/>
        </Row>
        {/* Cardio speed (Discord "miles per hour"). Unlike the weight unit this converts nothing:
                speeds stay stored in km/h and only what is shown and typed follows it (lib/speed.ts).
                Until chosen it follows the weight unit, so a profile in pounds already reads mph. */}
        <Row icon="figureRun" iconTint="var(--teal)" title={t('Speed unit')}>
          <Segmented className="seg-inline" options={[{ value: 'kmh', label: 'km/h' }, { value: 'mph', label: 'mph' }]} value={speedUnitOf(S)} onChange={(v?: any) => update((s?: any) => { s.speedUnit = v; })}/>
        </Row>
        {/* Which formula turns a set into an estimated 1RM (Discord, #155): the exercise page,
                the 1RM chart and records all follow it. Formula names are people, not words. */}
        <SelectRow icon="chart" iconTint="var(--teal)" title={t('1RM formula')} value={formulaOf(S)} onChange={(v?: any) => update((s?: any) => { s.oneRmFormula = v; })} options={[
                { value: 'epley', label: 'Epley', subtitle: t('The common one. A bit generous at higher reps.') },
                { value: 'brzycki', label: 'Brzycki', subtitle: t('More conservative above five reps.') },
                { value: 'lombardi', label: 'Lombardi', subtitle: t('Generous, especially at high reps.') },
                { value: 'oconner', label: FORMULA_NAMES.oconner, subtitle: t('The most conservative of the classics.') },
                { value: 'mayhew', label: 'Mayhew' },
                { value: 'wathan', label: 'Wathan' },
                { value: 'lander', label: 'Lander' },
                { value: 'weighted', label: t('Blend of all'), subtitle: t('Averages seven formulas and reads your RIR when you log it.') },
            ]}/>
        {/* Gross volume for people comparing with other apps (#719). Off is the app's own rule,
                work sets only; on, every screen that shows a volume counts done warm-ups too
                (lib/history.ts sessionVolume). Records and progression never read warm-ups. */}
        <Row icon="sunrise" iconTint="var(--teal)" title={t('Count warm-ups in volume')} subtitle={t('Handy when you compare with another app. Records ignore warm-ups either way.')}>
          <Switch aria-label={t('Count warm-ups in volume')} checked={S.volumeWarmups === true} onChange={(v?: any) => update((s?: any) => { s.volumeWarmups = v; })}/>
        </Row>
      </Section>
    </>,
        equipment: () => <EquipmentCard S={S} update={update}/>,
        look: () => <>
      <Section footer={DEMO || MOBILE || !user ? undefined : t('synced with your profile')}>
        <Row icon="moon" iconTint="var(--indigo)" title={t('Theme')}>
          <Segmented className="seg-inline" options={[
                { value: 'dark', icon: 'moon', label: t('Dark') },
                { value: 'light', icon: 'sun', label: t('Light') },
                { value: 'system', icon: 'gear', label: t('System') },
            ]} value={S.theme || 'dark'} onChange={(v?: any) => update((s?: any) => { s.theme = v; })}/>
        </Row>
        <div className="lrow" style={{ flexWrap: 'wrap', rowGap: 12, paddingBottom: 14 }}>
          <span className="lrow-i" style={{ '--tint': 'var(--purple)' }}><Icon name="palette"/></span>
          <span className="lrow-m"><span className="lrow-t">{t('Accent color')}</span></span>
          <span className="lrow-v">{accentLabel(S)}</span>
          <AccentSwatches S={S} update={update}/>
        </div>
        {/* The home-screen icon: the phone's own, not synced. iPhone only in 1.4.3 (Android follows). */}
        {MOBILE && platformNow() === 'ios' && <AppIconRow />}
        {/* How the muscle map is drawn. The exercise drawings follow it until they are set below. */}
        <Row icon="figureStrength" iconTint="var(--teal)" title={t('Body diagram')}>
          <Segmented className="seg-inline" options={[{ value: 'male', label: t('Male') }, { value: 'female', label: t('Female') }]} value={S.body === 'female' ? 'female' : 'male'} onChange={(v?: any) => update((s?: any) => { s.body = v; })}/>
        </Row>
        {/* Which figure the exercise animations show where both exist (about 940 exercises; the
                rest are drawn once). Only the picture changes: the exercise and its id stay the same,
                so nothing logged is touched, on this device or any other. */}
        <Row icon="figureStrength" iconTint="var(--teal)" title={t('Exercise drawings')} subtitle={t('Where an exercise is drawn on both figures. Your workouts stay exactly as they are.')}>
          <Segmented className="seg-inline" options={[{ value: 'male', label: t('Male') }, { value: 'female', label: t('Female') }]} value={figureOf(S)} onChange={(v?: any) => update((s?: any) => { s.exFigure = v; })}/>
        </Row>
      </Section>
      {/* Halloween and whatever comes after it (lib/seasonal.ts), on a page of their own. */}
      <Section>
        <Row icon="pumpkin" iconTint="var(--orange)" title={t('Seasonal themes')} subtitle={t('Little extras for the time of year.')} value={activeSeasonTitle(S)} accessory="chevron" onClick={() => open('themes')}/>
      </Section>
      <Section title={t('On Home')}>
        {/* Membership QR codes on Home (views/CheckIn.tsx); off = no Home card, no route. */}
        <Row icon="qr" iconTint="var(--blue)" title={t('Gym check-in')} subtitle={t('Show a card on Home with your membership QR codes.')}>
          <Switch checked={S.checkIn !== false} onChange={(v?: any) => update((s?: any) => { s.checkIn = v; })}/>
        </Row>
        {/* The Home summary is optional; hiding it leaves weight logging, history and Stats intact. */}
        <Row icon="scale" iconTint="var(--green)" title={t('Body weight')} subtitle={t('Show the body weight card on Home.')}>
          <Switch checked={S.showWeightCard !== false} onChange={(v?: any) => update((s?: any) => { s.showWeightCard = v; })}/>
        </Row>
        {/* The bar at the top that says the app is offline, kept local, or not synced (#369, #330).
                Here and not under Server & sync, which a phone kept local never shows. Switching it on
                also brings back the no-server line its × hid (#454). */}
        {!DEMO && <Row icon="cloud" iconTint="var(--blue)" title={t('Show connection status')} subtitle={t('Off: the bar at the top is hidden. A dot on Home still warns when syncing is stuck.')}>
          <Switch checked={S.connStatus !== false} onChange={(v?: any) => update((s?: any) => { s.connStatus = v; if (v)
                s.connLocal = true; })}/>
        </Row>}
      </Section>
    </>,
        // One section per seasonal theme (lib/seasonal.ts). Auto shows it in its weeks; On keeps it
        // all year, Off never. Synced like the rest of Look; once-a-day surprises stay per device.
        themes: () => <>
      {THEMES.map((th?: any) => {
                const choice: any = seasonChoice(S, th.id);
                const set: any = (k?: any, v?: any) => update((s?: any) => { s.seasonal = { ...(s.seasonal || {}), [k]: v }; });
                const note: any = choice === 'on' ? t('On all year round. Bold choice.')
                    : choice === 'off' ? t('Off, even in season. Fair enough.')
                        : inSeason(th) ? t(th.during) : t(th.back);
                return <Section key={th.id} footer={note}>
          <Row icon={th.icon} iconTint={th.tint} title={t(th.title)}>
            <Segmented className="seg-inline" options={[{ value: 'auto', label: t('Auto') }, { value: 'on', label: t('On') }, { value: 'off', label: t('Off') }]} value={choice} onChange={(v?: any) => set(th.id, v)}/>
          </Row>
          {th.colors && <Row icon="palette" iconTint="var(--purple)" title={t(th.colorsTitle)} subtitle={t(th.colorsNote)}>
            <Switch aria-label={t(th.colorsTitle)} checked={S.seasonal?.[th.id + 'Colors'] === true} onChange={(v?: any) => set(th.id + 'Colors', v)}/>
          </Row>}
          {/* On by default while the theme shows; nothing there is ever in the way of a set. */}
          {th.workoutTitle && <Row icon="play" iconTint="var(--green)" title={t(th.workoutTitle)} subtitle={t(th.workoutNote)}>
            <Switch aria-label={t(th.workoutTitle)} checked={S.seasonal?.[th.id + 'Workout'] !== false} onChange={(v?: any) => set(th.id + 'Workout', v)}/>
          </Row>}
        </Section>;
            })}
      {/* While Halloween shows, a way to the matching icon in Look & Home (it is there all year). */}
      {MOBILE && platformNow() === 'ios' && activeSeason(S) === 'halloween' && <Section>
        <Row icon="pumpkin" iconTint="var(--orange)" title={t('Try the Halloween app icon')} accessory="chevron" onClick={() => nav('/settings/look', { state: { find: 'App icon' } })}/>
      </Section>}
    </>,
        data: () => <>
      <Section title={t('Back up')}>
        <Row icon="share" iconTint="var(--blue)" title={t('Export backup (JSON)')} subtitle={hasMedia ? t('Without photos and videos') : undefined} accessory="chevron" onClick={doExport}/>
        {hasMedia && <Row icon="share" iconTint="var(--blue)" title={t('Export with photos & videos (.zip)')} accessory="chevron" onClick={doExportZip}/>}
        <Row icon="note" iconTint="var(--green)" title={t('Performance report (PDF)')} subtitle={t('Charts, totals and every workout of the last days or weeks.')} accessory="chevron" onClick={reportSheet}/>
        {/* One row per set for spreadsheets and other apps (#647); our own importer reads it back. */}
        <Row icon="share" iconTint="var(--green)" title={t('Export as spreadsheet (CSV)')} subtitle={t('Workouts, body weight and measurements')} accessory="chevron" onClick={csvExportSheet}/>
        {/* 14 is AUTO_BACKUP_KEEP in lib/mobile.ts, written out because the Settings tests mock
                that module wholesale; mobile.autobackup.test.js pins the two together. */}
        {MOBILE && <Row icon="folder" iconTint="var(--blue)" title={t('Auto-backup on changes')} subtitle={autoBackupSubtitle(android && S.autoBackup ? backupDir : null, 14)}>
          <Switch checked={!!S.autoBackup} onChange={(v?: any) => update((s?: any) => { s.autoBackup = v; })}/>
        </Row>}
        {/* Android only: the system folder picker (#161). iOS shows Documents in Files already. */}
        {MOBILE && android && S.autoBackup && <BackupFolderRow />}
      </Section>
      {MOBILE && <HealthConnectCard S={S} toast={toast} android={android}/>}
      <Section title={t('Bring data in')}>
        <Row icon="download" iconTint="var(--teal)" title={t('Import backup')} accessory="chevron" onClick={() => fileRef.current.click()}/>
        <Row icon="download" iconTint="var(--teal)" title={t('Import from another app')} subtitle={t('FitNotes, Strong, Hevy, GymMane, openGym CSV, or body weight from Apple Health')} accessory="chevron" onClick={() => importRef.current.click()}/>
        <Row icon="key" iconTint="var(--teal)" title={t('Import from Hevy')} subtitle={t('Pull your history with a Hevy Pro API key')} accessory="chevron" onClick={importFromHevy}/>
      </Section>
      {hasMedia && <Section><MediaRow /></Section>}
      <Section>
        <Row icon="trash" iconTint="var(--red)" title={t('Reset everything')} danger onClick={resetEverything}/>
      </Section>
      <input ref={fileRef} type="file" accept=".json,.zip,application/json,application/zip" style={{ display: 'none' }} onChange={doImport}/>
      {/* Reset after reading so picking the same file twice still fires onChange. */}
      <input ref={importRef} type="file" accept=".csv,.xml,text/csv,text/xml" style={{ display: 'none' }} onChange={(ev?: any) => { const f: any = ev.target.files[0]; if (f)
            importFromApp(f); ev.target.value = ''; }}/>
    </>,
        about: () => <>
      {/* Updates. On Android the row is always there: it checks on demand and installs when a
                release is newer (checksum verified, see onUpdateRowClick). On the web the app updates
                with its server, so the row points at the APK for the phone instead. iOS and the Google
                Play build are updated by their store. */}
      <Section footer={MOBILE ? (selfUpdate ? t('Releases are checked on GitHub. The download is verified against its checksum before the installer opens.') : null) : t('The web app updates together with your server. The Android app installs its own updates from here.')}>
        {/* The sideloaded APK comes in three kinds that differ only in the animations built in
                (lib/apk-variant.ts): which one this is, so nobody has to guess from the file size. */}
        <Row icon="info" iconTint="var(--grey)" title={t('Version')} value={'v' + __APP_VERSION__} subtitle={MOBILE && selfUpdate ? t('{0} APK, animations at {1} px', (VARIANT_NAMES as any)[APK_VARIANT], BUILTIN_PX) : undefined}/>
        {MOBILE
                ? selfUpdate && <Row icon="download" iconTint="var(--green)" title={updateInfo?.hasUpdate ? t('Update to openGym v{0}', updateInfo.latestVersion) : t('Check for updates')} subtitle={checking ? t('Checking…') : t('You have v{0}', __APP_VERSION__)} accessory="chevron" onClick={() => (updateInfo?.hasUpdate ? onUpdateRowClick() : checkNow())}/>
                : <Row icon="download" iconTint="var(--green)" title={t('Get the Android app')} subtitle={t('Download the APK from opengym.ch')} accessory="chevron" onClick={() => window.open('https://opengym.ch/#download', '_blank', 'noopener')}/>}
      </Section>
      {/* Support: the project's own donation pages, and on the iPhone a straight line to writing a
                review. Plain links, no pop-up asking for anything (App Store 5.6.1). */}
      <Section title={t('Support openGym')} footer={t('openGym is free: no ads, no subscriptions, no tracking. A coffee keeps it that way.')}>
        {MOBILE && ios && <Row icon="star" iconTint="var(--orange)" title={t('Rate openGym on the App Store')} accessory="chevron" onClick={() => window.open('https://apps.apple.com/app/id6822275400?action=write-review', '_blank', 'noopener')}/>}
        <Row icon="heart" iconTint="var(--pink)" title={t('Buy me a coffee')} subtitle="Buy Me a Coffee" accessory="chevron" onClick={() => window.open('https://buymeacoffee.com/duartesantos', '_blank', 'noopener')}/>
        <Row icon="heart" iconTint="var(--blue)" title="Ko-fi" accessory="chevron" onClick={() => window.open('https://ko-fi.com/opengym', '_blank', 'noopener')}/>
        <Row icon="heart" iconTint="var(--purple)" title="GitHub Sponsors" accessory="chevron" onClick={() => window.open('https://github.com/sponsors/DuarteSantos8', '_blank', 'noopener')}/>
      </Section>
      {/* "Add to Home screen": not inside the phone app, and not once it is installed. Safari's
                Share menu only on Apple (an iPad says Macintosh too); Windows and Linux get Chrome's
                install icon instead of an iPhone tip. */}
      {!MOBILE && !standalone() && <Section title={t('Tip')}>
        <Row icon="share" iconTint="var(--blue)" title={IS_ANDROID ? t('In Chrome: ⋮ menu → Add to Home screen') : APPLE_UA ? t('In Safari: Share → Add to Home Screen') : t('In Chrome or Edge: the install icon in the address bar')} subtitle={t('to install openGym as a full-screen app.') + ' ' + (user ? t('Your data syncs with your profile. Sign in anywhere and it’s there.') : t('Guest data stays on this device, so export a backup now and then!'))}/>
      </Section>}
      {/* The version, where the support template tells people to look for it. On the phone
                build there is no address bar and no about box, so without this there is no way to tell
                which build you are running, or whether an update actually installed. */}
      <div className="dim small sp-version">
        openGym v{__APP_VERSION__} · {t('free & open source (AGPL v3)')}<br />
        <a href="https://github.com/DuarteSantos8/openGym" target="_blank" rel="noopener">{t('Source code')}</a><br />
        {/* Attribution the media licence asks for word for word (agreement §8c), so it is not translated */}
        Exercise media © Aliaksandr Makatserchyk, <a href="https://gymvisual.com/" target="_blank" rel="noopener">Gym visual</a>, gymvisual.com.
        Media licensed for use in openGym only; see <a href="https://github.com/DuarteSantos8/openGym/blob/main/NOTICE.md" target="_blank" rel="noopener">NOTICE.md</a>
      </div>
    </>,
        account: () => <>
      {/* The server: which one, which account, how that stands, "Sync now". A paired phone's
                Admin and Disconnect sit in the same block; a browser's account rows follow in their own. */}
      {user && !DEMO && <ServerSyncSection>
        {MOBILE && <>
          {user.admin && <Row icon="crown" iconTint="var(--indigo)" title={t('Admin dashboard')} accessory="chevron" onClick={() => nav('/admin')}/>}
          {/* A code to sign in on a computer (#551), behind the same proof as in a browser. */}
          <DeviceLinkRow state={passkeys.st}/>
          <AccountIdRow id={user.id}/>
          <Row icon="signOut" iconTint="var(--red)" title={t('Disconnect')} danger onClick={disconnect}/>
        </>}
      </ServerSyncSection>}

      {/* account (demo and mobile builds have nothing to sign in to) */}
      {/* A local-only phone has no account to hand another device a code for (#551). */}
      {!(MOBILE && user) && <Section title={MOBILE ? t('Your data') : DEMO ? t('Demo') : t('Account')} footer={MOBILE ? t('Signing in on your computer too needs your own server. Connect this phone to it, and Add another device then gives the computer a code.') : null}>
        {MOBILE ? <>
          <Row icon="lock" iconTint="var(--acc)" title={t('All data stays on this phone')} subtitle={t('No account, no cloud. Back it up anytime in Data & backup.')}/>
          <Row icon="cloud" iconTint="var(--indigo)" title={t('Connect to my server')} subtitle={t('Sync this device to your own self-hosted openGym instead.')} accessory="chevron" onClick={connectServer}/>
          <KeptChangesRows />
        </> : DEMO ? <>
          <Row icon="info" iconTint="var(--acc)" title={t('You’re in the demo')} subtitle={t('Example data, stored only in this browser. Go wild and change anything you like.')}/>
          <Row icon="reset" iconTint="var(--blue)" title={t('Reset demo data')} accessory="chevron" onClick={() => confirmSheet({ title: t('Reset demo data?'), message: t('Puts the example plan, workouts and weigh-ins back the way they started.'), confirmText: t('Reset'), onConfirm: () => { resetDemo(); nav('/home'); toast(t('Demo data reset')); } })}/>
          <Row icon="rocket" iconTint="var(--indigo)" title={t('Self-host openGym')} subtitle={t('Passkey sign-in, sync across your devices, your own data.')} accessory="chevron" onClick={() => window.open(REPO, '_blank', 'noopener')}/>
        </> : user ? <>
          {user.admin && <Row icon="crown" iconTint="var(--indigo)" title={t('Admin dashboard')} accessory="chevron" onClick={() => nav('/admin')}/>}
          <PasskeysRow state={passkeys.st} changed={credsChanged}/>
          <DeviceLinkRow state={passkeys.st}/>
          <Row icon="qr" iconTint="var(--blue)" title={t('Pair the mobile app')} subtitle={t('Connect the openGym app on your phone to this account.')} accessory="chevron" onClick={() => useUI.getState().openSheet((close?: any) => <PairSheet close={close}/>)}/>
          {pwOn && <PasswordRow version={credsV}/>}
          <Row icon="signOut" iconTint="var(--red)" title={t('Sign out')} danger onClick={signOutHere}/>
          <Row icon="shield" iconTint="var(--red)" title={t('Sign out everywhere')} subtitle={t('Ends this profile’s sessions on all your devices.')} danger onClick={signOutEverywhere}/>
          <AccountIdRow id={user.id}/>
        </> : webauthnOK() ? <>
          <Row icon="plusCircle" iconTint="var(--acc)" title={t('Create passkey profile')} subtitle={t('Keeps your data safe and separate per person.')} accessory="chevron" onClick={registerHere}/>
          <Row icon="fingerprint" iconTint="var(--blue)" title={t('Sign in with passkey')} accessory="chevron" onClick={passkeySignIn}/>
          {/* The Login screen offers both of these; a guest who skipped it had no way to either from here. */}
          {pwOn && <Row icon="plusCircle" iconTint="var(--orange)" title={t('Create profile with a password')} accessory="chevron" onClick={openPasswordRegister}/>}
          {pwOn && <Row icon="key" iconTint="var(--orange)" title={t('Sign in with password')} accessory="chevron" onClick={() => openPasswordSignIn()}/>}
          <Row icon="qr" iconTint="var(--blue)" title={t('Use a code from your other device')} accessory="chevron" onClick={openDeviceLinkRedeem}/>
          <KeptChangesRows />
        </> : pwOn ? <>
          {/* No passkeys in this browser (plain http on a LAN address, say): a password is the way in. */}
          <Row icon="plusCircle" iconTint="var(--acc)" title={t('Create new profile')} subtitle={t('Keeps your data safe and separate per person.')} accessory="chevron" onClick={openPasswordRegister}/>
          <Row icon="key" iconTint="var(--orange)" title={t('Sign in with password')} accessory="chevron" onClick={() => openPasswordSignIn()}/>
          <KeptChangesRows />
        </> : <>
          <Row icon="lock" iconTint="var(--grey)" title={t('Passkeys not supported in this browser.')}/>
          <KeptChangesRows />
        </>}
      </Section>}
      {/* Signed in or paired: the account can be deleted from here (App Store rule 5.1.1(v)). A
                phone in local-only mode has no account; "Reset everything" in Data & backup wipes it. */}
      {user && !DEMO && <Section>
        <DeleteAccountRow exportBackup={doExport} exportBackupZip={doExportZip} hasMedia={hasMedia} done={() => nav('/home')}/>
      </Section>}
      {/* The connection banner already says this to a guest; the line is for when it is switched
                off, or its × hid it (#454). */}
      {!user && !DEMO && !MOBILE && !(showsConnection(S) && showsLocalLine(S)) && <p className="sect-f" style={{ marginTop: -18, marginBottom: 22 }}>{t('Guest mode: your data lives only in this browser.')}</p>}
    </>,
    };
    /* ---------------- a page ---------------- */
    if (page && pages[page]) {
        const parent: any = PAGES[page].parent;
        return <div className="narrow" ref={body}>
      <div className="sp-nav">
        {/* Named by what it says ("Settings", "Workout"), so a voice command for the visible
                word finds it; the chevron is hidden from assistive tech. */}
        <button className="sp-back" data-back={((window.history.state?.idx || 0) > 0 ? pathBefore() : null) || (parent ? '/settings/' + parent : '/settings')} onClick={back}>
          <Icon name="chevronLeft"/><span>{parent ? t(PAGES[parent].title) : t('Settings')}</span>
        </button>
        <h1 className="sp-title">{t(PAGES[page].title)}</h1>
      </div>
      {pages[page]()}
    </div>;
    }
    /* ---------------- the root ---------------- */
    return <SettingsRoot ctx={ctx} preview={preview} open={open} user={user} sync={sync} entryKey={entryKey} home={() => nav('/home')} go={(hit?: any) => {
            if (hit.page === 'coach') {
                nav('/coach/setup');
                return;
            }
            nav('/settings/' + hit.page, hit.isPage ? undefined : { state: hit.via ? { find: hit.title, via: hit.via } : { find: hit.title } });
        }}/>;
}
function SettingsRoot({ ctx, preview, open, user, sync, home, go, entryKey }: any) {
    // The router's key for this history entry, taken once. From the router rather than
    // window.history: drawn under an edge swipe back the page is the entry before the current one.
    const [key]: any = useState(() => (entryKey && entryKey !== 'default' && entryKey !== 'back-preview' ? entryKey : window.history.state?.key || null));
    const [q, setQ]: any = useState(() => (key && lastQuery.key === key ? lastQuery.q : ''));
    const set: any = (v?: any) => { lastQuery = { q: v, key }; setQ(v); };
    const hits: any = q.trim() ? searchSettings(q, ctx) : null;
    // The account card: who this is, and the one line that matters about it.
    const acct: any = DEMO ? { title: t('Demo'), sub: t('Example data, only in this browser.') }
        : user ? {
            title: user.name || t('Account'),
            sub: sync && sync.status && sync.status !== 'ok' ? t('Sync needs a look') : MOBILE ? t('Synced with your server') : t('Account, devices and sync'),
        }
            : MOBILE ? { title: t('This phone'), sub: t('All data stays on this phone') }
                : { title: t('Guest'), sub: t('Your data lives on this device. Sign in to sync.') };
    const initial: any = user && !DEMO ? String(user.name || '?').trim().charAt(0).toUpperCase() : null;
    const nav: any = useNavigate();
    // Only while the server offers the Coach (the flag every Coach screen reads): on a box without
    // it the admin dashboard has no Coach card to land on.
    const config: any = useStore((s?: any) => s.config);
    const adminCoach: any = !MOBILE && !DEMO && !!user?.admin && coachAvailable(config, user);
    return <div className="narrow">
    <div className="sp-nav">
      <button className="sp-back" data-back="/home" onClick={home} aria-label={t('Home')}><Icon name="chevronLeft"/><span>{t('Home')}</span></button>
    </div>
    <h1 className="sp-root-title">{t('Settings')}</h1>
    <div className="sp-search">
      <SearchField value={q} onChange={(e?: any) => set(e.target.value)} onClear={() => set('')} placeholder={t('Search…')} aria-label={t('Search settings')} inputMode="search" enterKeyHint="search" autoComplete="off"/>
    </div>
    {hits ? (hits.length ? <Section title={tn('{0} result', '{0} results', hits.length)}>
      {hits.slice(0, 40).map((h?: any) => (<Row key={h.page + ':' + h.title} icon={h.icon} iconTint={h.tint} title={h.label} subtitle={h.trail} accessory="chevron" onClick={() => go(h)}/>))}
    </Section> : <div className="sp-empty">{t('No setting matches “{0}”.', q.trim())}</div>) : <>
      <Section>
        <button className="lrow tap sp-acct" onClick={() => open('account')}>
          <span className={'sp-avatar' + (initial ? ' on' : '')} aria-hidden="true">{initial || <Icon name="personCircle"/>}</span>
          <span className="lrow-m"><span className="lrow-t">{acct.title}</span><span className="lrow-s">{acct.sub}</span></span>
          <Icon name="chevronRight" className="lrow-c"/>
        </button>
      </Section>
      {ROOT_GROUPS.map((g?: any) => g.filter((id?: any) => pageVisible(id, ctx))).filter((g?: any) => g.length).map((g?: any) => (<Section key={g[0]}>
          {g.map((id?: any) => <Row key={id} icon={PAGES[id].icon} iconTint={PAGES[id].tint} title={t(PAGES[id].title)} value={preview[id]?.() || null} accessory="chevron" onClick={() => open(id)} className="sp-root-row"/>)}
          {/* The phone app sets up its own Coach on the Coach page beside Look; in a hosted app the
                    Coach is the server's, set up by an admin on the admin dashboard. Its admins get the
                    same row, in the same place, straight to that card; nobody else has anything to set. */}
          {g[0] === 'look' && adminCoach && <Row icon={PAGES.coach.icon} iconTint={PAGES.coach.tint} title={t(PAGES.coach.title)} value={t('Admin')} accessory="chevron" onClick={() => nav('/admin', { state: { section: 'coach' } })} className="sp-root-row"/>}
        </Section>))}
      <div className="dim small sp-version">openGym v{__APP_VERSION__}</div>
    </>}
  </div>;
}
// The whole point is that the two scales are one judgement counted from opposite ends, and a
// paragraph is a bad way to say that — the conversion table shows it in one look. Reading down
// a column is the answer to "what do I put here", so the numbers get their own aligned columns.
const EFFORT_ROWS: any = [
    ['0', '10', 'Nothing left, went to failure'],
    ['1', '9', 'One more rep in the tank'],
    ['2', '8', 'Two more reps'],
    ['3', '7', 'Three more reps'],
    ['4+', '≤6', 'Easy, warm-up territory'],
];
// RIR 2 / RPE 8: the row a working set usually lands on — the anchor the others are read
// against. Not where the stepper starts; + walks up from the bottom of the scale.
const EFFORT_TYPICAL: any = 2;
// Download progress sheet — receives a ref callback that exposes a (received, total) setter.
// Uses forwardRef so the caller can push byte counts in without re-rendering the whole Settings tree.
const DownloadProgress: any = forwardRef(function DownloadProgress(_?: any, ref?: any) {
    const [pct, setPct]: any = useState(0);
    const [text, setText]: any = useState(t('Starting download…'));
    // Expose a setter the caller can invoke directly
    if (ref)
        ref(function update(received?: any, total?: any) {
            if (total > 0) {
                const p: any = Math.min(100, Math.round((received / total) * 100));
                setPct(p);
                setText(t('{0} %', p));
            }
            else {
                setText(t('{0} MB', (received / 1000000).toFixed(1)));
            }
        });
    return (<div style={{ textAlign: 'center', padding: '8px 0' }}>
      <h3>{t('Downloading update…')}</h3>
      <div style={{ margin: '16px 0', height: 6, borderRadius: 3, background: 'var(--fill-3)', overflow: 'hidden' }}>
        <div style={{ height: '100%', width: pct + '%', background: 'var(--acc)', borderRadius: 3, transition: 'width .2s' }}/>
      </div>
      <div className="muted small">{text}</div>
    </div>);
});
// Settings → Sound (#306): every end-of-rest sound, each played as it is picked so you hear it
// before the next rest does. The sheet stays open for the next one; Done closes it. Stored as
// S.restSound, with S.classicChime kept for an app from before (lib/rest-sounds.ts restSoundOf).
const REST_SOUND_LABEL: any = { chime: 'Chime (louder)', classic: 'Classic beeps', bell: 'Bell', beep: 'Beep-beep', whistle: 'Whistle', soft: 'Soft' };
const REST_SOUND_HINT: any = {
    classic: 'The quieter three-beep sound from before 1.3.9, instead of the louder chime.',
    bell: 'Ding-dong. Rest is over, class is in.',
    beep: 'Your sports watch, calling you back.',
    whistle: 'Coach wants you back on the bar.',
    soft: 'Gentle, for headphones or a quiet room.',
};
export function pickRestSound(id?: any) {
    unlock(true);
    useStore.getState().update((s?: any) => { s.restSound = id; s.classicChime = id === 'classic'; });
    chime(true, id);
}
export function RestSoundSheet({ close }: any) {
    const S: any = useStore((s?: any) => s.S);
    const cur: any = restSoundOf(S);
    return <>
    <h3>{t('Sound')}</h3>
    <div className="muted small" style={{ marginBottom: 12 }}>{t('Tap one to hear it.')}</div>
    <Section>
      {REST_SOUND_IDS.map((id?: any) => <Row key={id} icon={id === cur ? 'speaker' : 'play'} iconTint="var(--pink)" title={t(REST_SOUND_LABEL[id])} subtitle={REST_SOUND_HINT[id] ? t(REST_SOUND_HINT[id]) : null} accessory={id === cur ? 'check' : 'none'} onClick={() => pickRestSound(id)}/>)}
    </Section>
    <div style={{ height: 14 }}/>
    <Button variant="primary" onClick={close}>{t('Done')}</Button>
  </>;
}
const restSoundSheet: any = () => useUI.getState().openSheet((close?: any) => <RestSoundSheet close={close}/>);
function effortHelpSheet() {
    useUI.getState().openSheet((close?: any) => <>
    <h3>{t('Effort per set')}</h3>
    <div className="muted small" style={{ lineHeight: 1.5 }}>
      {t('How hard a set was, logged next to weight and reps. Two scales for the same judgement, counted from opposite ends.')}
    </div>
    <div className="efftbl">
      <div className="r hd"><span className="n">{t('RIR')}</span><span className="n">{t('RPE')}</span><span className="f">{t('How it felt')}</span></div>
      {EFFORT_ROWS.map(([rir, rpe, feel]: any, i?: any) => (<div key={rir} className={'r' + (i === EFFORT_TYPICAL ? ' on' : '')}>
          <span className="n">{rir}</span><span className="n">{rpe}</span><span className="f">{t(feel)}</span>
        </div>))}
    </div>
    <div className="dim small" style={{ lineHeight: 1.5, display: 'grid', gap: 8 }}>
      <div>{t('RIR counts the reps you left in the tank; RPE reads the same effort off a 10-point scale, so RPE ≈ 10 − RIR. Pick whichever you already think in.')}</div>
      <div>{t('The highlighted row is where most working sets land. Sets you have already logged keep their own scale, and nothing else reads the value, so progression and estimated 1RM are unaffected.')}</div>
    </div>
    <div style={{ height: 8 }}/>
  </>);
}
function NotificationsCard({ S, update, toast }: any) {
    if (MOBILE)
        return <MobileReminderCard S={S} update={update} toast={toast}/>;
    return <PushCard S={S} update={update} toast={toast}/>;
}
// Mobile build: the reminder is a native local notification scheduled on planned weekdays —
// no push server involved. The schedule itself is (re)synced by the store on every persist;
// this card only owns the OS permission prompt when the switch turns on.
function MobileReminderCard({ S, update, toast }: any) {
    // A paired phone checks with the server before a nudge (lib/nudge-check.ts); the footer says
    // so, and that the phone decides when.
    const paired: any = useStore((s?: any) => !!s.user);
    const setReminder: any = (patch?: any) => update((s?: any) => { s.reminder = { ...(s.reminder || DEF.reminder), ...patch, tz: localTZ() }; });
    const toggle: any = async () => {
        const on: any = !S.reminder?.on;
        if (on) {
            const ok: any = await syncReminder({ ...S, reminder: { ...(S.reminder || DEF.reminder), on: true } }, true);
            if (!ok) {
                toast(t('Could not change notification settings'));
                return;
            }
        }
        setReminder({ on });
    };
    return (<Section title={t('Notifications')} footer={S.reminder?.on ? t('Reminds you at this time on days that have a routine planned.') + nudgeNote(S) + (paired && S.reminder?.nudge ? ' ' + t('Logged a workout on another device? Before the nudge goes out, the phone checks with your server whenever it lets the app run in the background. Opening the app always catches up.') : '') : null}>
      <Row icon="calendar" iconTint="var(--orange)" title={t('Workout day reminder')}>
        <Switch checked={!!S.reminder?.on} onChange={toggle} aria-label={t('Workout day reminder')}/>
      </Row>
      {S.reminder?.on && (<Row icon="clock" iconTint="var(--purple)" title={t('Reminder time')}>
          <input type="time" className="timef" value={S.reminder?.time || DEF.reminder.time} onChange={(e?: any) => setReminder({ time: e.target.value })}/>
        </Row>)}
      {S.reminder?.on && <NudgeRows S={S} setReminder={setReminder}/>}
    </Section>);
}
// The missed-workout nudge (lib/nudge.ts): a switch and its tone, under the reminder they ride
// on — the server sends it with the same push (or the phone schedules it beside the reminder).
function NudgeRows({ S, setReminder }: any) {
    const r: any = S.reminder || {};
    return <>
    <Row icon="bell" iconTint="var(--red)" title={t('Nudge me when I skip a planned workout')}>
      <Switch checked={!!r.nudge} onChange={() => setReminder({ nudge: !r.nudge })} aria-label={t('Nudge me when I skip a planned workout')}/>
    </Row>
    {r.nudge && (<SelectRow icon="chat" iconTint="var(--blue)" title={t('Nudge tone')} value={toneOf(r)} onChange={(v?: any) => setReminder({ tone: v })} options={NUDGE_TONES.map((k?: any) => ({ value: k, label: toneLabel(k), subtitle: t(NUDGE_COPY[k].title) }))}/>)}
  </>;
}
const toneLabel: any = (k?: any) => k === 'guilt' ? t('Guilt trip') : k === 'drill' ? t('Drill sergeant') : t('Friendly');
const nudgeNote: any = (S?: any) => S.reminder?.nudge
    ? ' ' + t('One nudge in the evening of a planned day with nothing logged, between 20:00 and 21:30. After 3 missed days in a row it goes quiet until your next workout.')
    : '';
function PushCard({ S, update, toast }: any) {
    const [on, setOn]: any = useState(false);
    const [busy, setBusy]: any = useState(false);
    const supported: any = pushSupported();
    // "On" means the server holds this browser's subscription, not merely that the browser has
    // one: a row the instance dropped (dead send, rebuilt db.json) left the switch on with nothing
    // ever arriving. syncPushSubscription re-registers on the way; if the server cannot be asked
    // (offline), the browser's side is the best answer available. A server that refused this
    // browser's subscription, even a fresh one, has answered: the switch is off, with its reason.
    useEffect(() => {
        if (!supported)
            return;
        let gone: any = false;
        syncPushSubscription()
            .then((ok?: any) => { if (!gone)
            setOn(ok); })
            .catch((e?: any) => {
            if (e?.refused) {
                if (!gone) {
                    setOn(false);
                    toast(e.message);
                }
                return;
            }
            return navigator.serviceWorker.ready.then((reg?: any) => reg.pushManager.getSubscription()).then((sub?: any) => { if (!gone)
                setOn(!!sub); }).catch(() => { });
        });
        return () => { gone = true; };
    }, [supported]);
    const toggle: any = async (v?: any) => {
        setBusy(true);
        try {
            if (!v) {
                await disablePush();
                setOn(false);
                toast(t('Notifications off'));
            }
            else {
                await enablePush();
                setOn(true);
                toast(t('Notifications on'));
            }
        }
        catch (e: any) {
            toast(e.message || t('Could not change notification settings'));
        }
        setBusy(false);
    };
    const test: any = async () => {
        try {
            await sendTestPush();
            toast(t('Test sent! Should pop up any second'));
        }
        catch (e: any) {
            toast(e.message || t('Test failed'));
        }
    };
    if (!supported)
        return (<Section title={t('Notifications')}>
      <Row icon="bellSlash" iconTint="var(--grey)" title={t('Not supported in this browser.')}/>
    </Section>);
    return <>
    <Section title={t('Notifications')} footer={on && S.reminder?.on
            ? t("Only sent on days you have a routine planned and haven't logged a workout yet.") +
                (S.reminder?.tz ? ' ' + t('Timezone: {0} (auto-detected, updates if you travel).', S.reminder.tz) : '') +
                nudgeNote(S)
            : null}>
      <Row icon="bell" iconTint="var(--red)" title={t('Push notifications')} subtitle={t('Rest-timer alerts, even if openGym is closed.')}>
        <Switch checked={on} disabled={busy} onChange={toggle}/>
      </Row>
      {on && (<Row icon="calendar" iconTint="var(--orange)" title={t('Workout day reminder')}>
          <Switch checked={!!S.reminder?.on} onChange={() => update((s?: any) => { s.reminder = { ...(s.reminder || DEF.reminder), on: !s.reminder?.on, tz: localTZ() }; })}/>
        </Row>)}
      {on && S.reminder?.on && (<Row icon="clock" iconTint="var(--purple)" title={t('Reminder time')}>
          <input type="time" className="timef" value={S.reminder?.time || DEF.reminder.time} onChange={(e?: any) => update((s?: any) => { s.reminder = { ...(s.reminder || DEF.reminder), time: e.target.value, tz: localTZ() }; })}/>
        </Row>)}
      {on && S.reminder?.on && (<NudgeRows S={S} setReminder={(patch?: any) => update((s?: any) => { s.reminder = { ...(s.reminder || DEF.reminder), ...patch, tz: localTZ() }; })}/>)}
    </Section>
    {on && <div style={{ marginTop: -12, marginBottom: 22 }}><Button size="sm" icon="bell" onClick={test}>{t('Send test notification')}</Button></div>}
  </>;
}
// Equipment profiles ("Home", "Gym", ...) — each an id/name/eq-list; the active one filters
// the Library, exercise picker, and flags routine entries that need something outside it
// (see lib/equipment.ts). Purely local/synced state — no server changes needed.
// What the chosen accent is called: a preset's colour name, or the user's own.
// The theme showing right now, by name, for the row that opens them.
function activeSeasonTitle(S?: any) {
    const id: any = activeSeason(S);
    const th: any = id && THEMES.find((x?: any) => x.id === id);
    return th ? t(th.title) : null;
}
function accentLabel(S?: any) {
    const k: any = accentKey(S);
    return k === CUSTOM ? t('Your own color') : t(ACCENT_NAMES[k] || 'Green');
}
/**
 * The presets, then one swatch for a colour of the user's own (lib/accent.ts). With no colour
 * of their own yet it is a rainbow ring, and a tap opens the system colour picker straight away.
 * Once there is one it is filled with it: a tap picks it again (it is kept while a preset is
 * chosen), and a tap on it while it is the accent opens the picker to change it. The picker is
 * the native <input type="color"> laid over the swatch, so the tap that opens it is the user's
 * own, which iOS Safari and the Android WebView both want.
 */
// How long the colour picker has to rest before a colour is saved, when the browser sends no
// `change` at the end (it should, once the picker closes).
const OWN_COLOR_SETTLE_MS: any = 400;
function AccentSwatches({ S, update }: any) {
    const key: any = accentKey(S);
    const own: any = cleanHex(S.accentCustom);
    const onCustom: any = key === CUSTOM;
    const pickPreset: any = (k?: any) => { update((s?: any) => { s.accent = k; }); setRestAccent(k); };
    const pickOwn: any = (hex?: any) => {
        const c: any = cleanHex(hex);
        if (!c || (onCustom && c === own))
            return;
        update((s?: any) => { s.accent = CUSTOM; s.accentCustom = c; });
        setRestAccent(c);
    };
    // The picker sends a colour for every step of a drag (React's onChange is the `input` event).
    // Those only repaint the page; the colour is saved, synced and sent to the native countdown
    // once: on the picker's `change`, after it has rested a moment, or when Settings closes.
    const inputRef: any = useRef(null);
    const pending: any = useRef(null);
    const timer: any = useRef(0);
    const pickOwnRef: any = useRef(pickOwn);
    pickOwnRef.current = pickOwn;
    const commit: any = () => {
        clearTimeout(timer.current);
        const c: any = pending.current;
        pending.current = null;
        if (c)
            pickOwnRef.current(c);
    };
    const preview: any = (hex?: any) => {
        const c: any = cleanHex(hex);
        if (!c)
            return;
        const de: any = document.documentElement;
        applyAccent(de, c, de.dataset.theme);
        pending.current = c;
        clearTimeout(timer.current);
        timer.current = setTimeout(commit, OWN_COLOR_SETTLE_MS);
    };
    const hasInput: any = !(own && !onCustom);
    useEffect(() => {
        const el: any = inputRef.current;
        if (!el)
            return;
        const onChange: any = () => { pending.current = cleanHex(el.value) || pending.current; commit(); };
        el.addEventListener('change', onChange);
        return () => el.removeEventListener('change', onChange);
    }, [hasInput]); // eslint-disable-line react-hooks/exhaustive-deps
    useEffect(() => commit, []); // eslint-disable-line react-hooks/exhaustive-deps
    // The input is not controlled (React would put the saved colour back after every drag step);
    // a colour changed elsewhere (sync, another tab) is put in by hand.
    useEffect(() => {
        if (!pending.current && inputRef.current)
            inputRef.current.value = own || '#30d158';
    }, [own]);
    const ownLabel: any = t('Your own color');
    const grey: any = own && isGrey(own);
    const notes: any = own && onCustom ? [
        adjustedIn(own, 'dark') && (grey ? t('Greys show lighter in dark mode, so buttons don’t look switched off.') : t('A touch lighter in dark mode, so you can still read it.')),
        adjustedIn(own, 'light') && (grey ? t('Greys show darker in light mode, so buttons don’t look switched off.') : t('A touch darker in light mode, so you can still read it.')),
    ].filter(Boolean) : [];
    return <>
    <div className="swatches" style={{ flexBasis: '100%', paddingInlineStart: 41 }}>
      {Object.entries(ACCENTS).map(([k, c]: any) => (<button key={k} className={'swatch' + (key === k ? ' on' : '')} style={{ background: c }} onClick={() => pickPreset(k)} aria-label={t(ACCENT_NAMES[k] || k)}/>))}
      {!hasInput
            ? <button className="swatch swatch-own" style={{ background: own }} onClick={() => pickOwn(own)} aria-label={ownLabel}/>
            : <span className={'swatch swatch-own' + (own ? ' on' : ' unset')} style={own ? { background: own, color: inkOn(own) } : undefined}>
          {own ? <Icon name="pencil"/> : <Icon name="plus"/>}
          <input ref={inputRef} type="color" className="swatch-input" defaultValue={own || '#30d158'} onChange={(e?: any) => preview(e.target.value)} aria-label={own ? t('Change your own color') : t('Pick your own color')}/>
        </span>}
    </div>
    {notes.map((n?: any) => <span key={n} className="lrow-s swatch-note" style={{ flexBasis: '100%', paddingInlineStart: 41 }}>{n}</span>)}
  </>;
}
function EquipmentCard({ S, update }: any) {
    const profiles: any = S.equipProfiles || [];
    const remove: any = (p?: any) => confirmSheet({
        title: t('Delete profile?'), message: t('"{0}" and its equipment list will be removed.', p.name),
        confirmText: t('Delete'), danger: true,
        onConfirm: () => update((s?: any) => {
            s.equipProfiles = (s.equipProfiles || []).filter((x?: any) => x.id !== p.id);
            if (s.activeEquipId === p.id)
                s.activeEquipId = (s.equipProfiles[0] && s.equipProfiles[0].id) || null;
        }),
    });
    // The plates you own, per unit (lib/plates.ts) — what the set rows' plate lines load from.
    const plateSummary: any = ownsPlates(S)
        ? inventoryFor(S).map((p?: any) => fmtPlate(p.w) + '×' + p.n).join(' · ') || t('None')
        : t('Standard set. Tap to count the pairs you own.');
    // The dumbbells you own, per unit (lib/dumbbells.ts): what dumbbell lifts step and progress over.
    const bells: any = dumbbellsOf(S);
    const dumbbellSummary: any = ownsNoDumbbells(S) ? t('None, so dumbbell lifts stay hidden.')
        : bells.length ? bells.map(fmtPlate).join(' · ')
            : t('Any weight. Tap to list the ones you own.');
    // Your bars (lib/bar.ts ownBarDefault): the types you set a weight for, in the profile unit.
    const unit: any = S.unit === 'lb' ? 'lb' : 'kg';
    const ownBars: any = BAR_TYPES.filter((eq?: any) => ownBarDefault(S, eq) !== null);
    const barSummary: any = ownBars.length
        ? ownBars.map((eq?: any) => { const n: any = t(eq); return n.charAt(0).toLocaleUpperCase() + n.slice(1) + ' ' + fmtPlate(ownBarDefault(S, eq)) + ' ' + unit; }).join(' · ')
        : t('Standard bars. Tap if yours are lighter.');
    return <Section title={t('Equipment')} footer={t('Filters the exercise library and picker, and flags routine exercises that need something you don’t have in the active profile.')}>
    <Row icon="plate" iconTint="var(--orange)" title={t('Plates')} subtitle={plateSummary} accessory="chevron" onClick={() => plateInventorySheet()}/>
    <Row icon="dumbbell" iconTint="var(--teal)" title={t('Dumbbells')} subtitle={dumbbellSummary} accessory="chevron" onClick={() => dumbbellInventorySheet()}/>
    <Row icon="barbell" iconTint="var(--blue)" title={t('Your bars')} subtitle={barSummary} accessory="chevron" onClick={() => barDefaultsSheet()}/>
    {profiles.length > 0 && <Row icon="kettlebell" iconTint="var(--acc)" title={t('Filter by equipment')}>
      <Switch checked={!!S.equipFilterOn} onChange={(v?: any) => update((s?: any) => { s.equipFilterOn = v; })}/>
    </Row>}
    {profiles.length > 0 && <SelectRow icon="house" iconTint="var(--blue)" title={t('Active profile')} value={S.activeEquipId || ''} onChange={(v?: any) => update((s?: any) => { s.activeEquipId = v; })} options={profiles.map((p?: any) => ({ value: p.id, label: p.name }))}/>}
    {profiles.map((p?: any) => (<Row key={p.id} icon="house" iconTint="var(--teal)" title={p.name} subtitle={t('{0} equipment types', p.equipment.length)} accessory="chevron" onClick={() => equipmentProfileSheet(p)}>
        <button className="iconbtn" aria-label={t('Delete')} onClick={(ev?: any) => { ev.stopPropagation(); remove(p); }}><Icon name="trash"/></button>
      </Row>))}
    <Row icon="plus" iconTint="var(--acc)" title={t('Add equipment profile')} accessory="chevron" onClick={() => equipmentProfileSheet(null)}/>
  </Section>;
}
// The account's id, small and one tap to copy (#219). It is what an admin puts in ADMIN_UIDS,
// and the one thing that names an account beyond doubt when someone asks their admin for help:
// display names are free text and need not be unique. copyText also reaches the clipboard on a
// plain-http LAN address, where the Clipboard API is missing and password sign-in (#118) is the
// usual way in; where no copy works at all the id is still on screen to read out.
/* After "Reset everything": the photos and videos go too. Signed in, the empty state is pushed
   first and, once the server holds it, the server is asked to drop every file that state no
   longer refers to (POST /api/media/sweep) — asked before the push landed, it would still see the
   old state and keep everything, which is the safe side. Then this device keeps only the files a
   stash refers to: another account's changes kept here are not this reset's to delete. */
async function clearMediaAfterReset(signedIn?: any) {
    const st: any = useStore.getState();
    if (signedIn && typeof st.pushState === 'function') {
        await st.pushState();
        const now: any = useStore.getState();
        if (now.sync?.status === 'ok' && now.config?.media)
            await api('/api/media/sweep', { method: 'POST', body: '{}' }).catch(() => { });
    }
    const keep: any = typeof st.stashedMediaHashes === 'function' ? await st.stashedMediaHashes() : new Set();
    await mediaStore.retainOnly(keep);
}
/* Settings → Data → "Photos & videos": how much of the server's space they take and what is still
   waiting to go up; a tap sends what is waiting now, offers again what the server refused, and
   lets a device that showed a file as missing ask for it again. On a device without a server that
   stores media, it says they are kept here only. */
function MediaRow() {
    const S: any = useStore((s?: any) => s.S);
    const user: any = useStore((s?: any) => s.user);
    const config: any = useStore((s?: any) => s.config);
    const status: any = useSyncExternalStore(subscribeMediaStatus, getMediaStatus);
    // Signed in, the files go to the server unless it has said it stores none. A config not known
    // yet — a phone started without a network; it is not kept between starts — is not that answer:
    // what is waiting is counted as waiting (and goes up once the server answers), not called
    // local-only as a guest's files are.
    const remote: any = !!user && (config == null || !!config.media);
    useEffect(() => { if (remote)
        syncMedia(); }, [remote]);
    const pending: any = remote ? pendingRefCount(S) : 0;
    const u: any = status.usage;
    const usage: any = remote && u && u.quotaBytes > 0
        ? t('{0} of {1} MB used on your server', fmtMB((u.bytes || 0) / MB), fmtMB(Math.round(u.quotaBytes / MB)))
        : null;
    const sub: any = remote
        ? [usage, pending ? t('{0} waiting to upload', pending) : null].filter(Boolean).join(' · ') || undefined
        : t('Kept on this device only. Export with photos & videos keeps a copy.');
    return <Row icon="image" iconTint="var(--teal)" title={t('Photos & videos')} subtitle={sub} onClick={remote ? () => syncMedia({ force: true, retryRejected: true }) : undefined}/>;
}
function AccountIdRow({ id }: any) {
    const toast: any = useUI((s?: any) => s.toast);
    if (!id)
        return null;
    const copy: any = async () => { if (await copyText(id))
        toast(t('Account ID copied')); };
    return <Row icon="personCircle" iconTint="var(--grey)" title={t('Account ID')} subtitle={<span className="acct-id">{id}</span>} onClick={copy}/>;
}
// The same registration as the sign-in screen's, reached from Settings instead. It asks for
// the invite code on the same terms: an invite-only instance rejects a registration without
// one, so a form that cannot collect it is a form that cannot succeed.
function RegisterInline({ close, setUser, pushState, pullState, toast }: any) {
    const nameRef: any = useRef(null);
    const [code, setCode]: any = useState('');
    const [inviteOnly, setInviteOnly]: any = useState(false);
    useEffect(() => { api('/api/config').then((c?: any) => setInviteOnly(!!c.invite_only)).catch(() => { }); }, []);
    const go: any = async () => {
        const n: any = (nameRef.current.value || '').trim();
        if (!n) {
            toast(t('Enter a name'));
            return;
        }
        if (inviteOnly && !code.trim()) {
            toast(t('An invite code is required'));
            return;
        }
        try {
            const u: any = await passkeyRegister(n, code.trim());
            setUser(u);
            close();
            if (hasData(useStore.getState().S)) {
                await pushState();
                toast(t('Profile created, and your data moved into it'));
            }
            else {
                await pullState();
                toast(t('Welcome, {0}', u.name));
            }
        }
        catch (e: any) {
            if (e.name !== 'NotAllowedError' && e.name !== 'AbortError')
                toast(passkeyError(e, t('Registration failed')));
        }
    };
    return <>
    <h3>{t('Create your profile')}</h3>
    <div className="muted small" style={{ marginBottom: 14 }}>{t('Pick a name, then confirm with your device.')}</div>
    <TextField ref={nameRef} placeholder={t('Your name')} maxLength={40}/>
    {inviteOnly && <>
      <div style={{ height: 10 }}/>
      <input className="input" placeholder={t('Invite code')} maxLength={40} value={code} onChange={(e?: any) => setCode(e.target.value.toUpperCase())} style={{ letterSpacing: '.14em', fontWeight: 600, textAlign: 'center' }}/>
      <div className="dim small" style={{ marginTop: 6 }}>{t('This app is invite-only. Enter the code you were given.')}</div>
    </>}
    <div style={{ height: 12 }}/><Button variant="primary" onClick={go}>{t('Create passkey')}</Button>
  </>;
}
// Android app: writing finished workouts and weigh-ins to Health Connect (#200), the phone's
// own store for health data, where other apps can read them. A fact about this phone, kept in
// its own file (lib/health-sync.ts) and not in S, so it never switches on anywhere else. The card
// stays out of the way on a phone without Health Connect, and only points to installing it on
// Android 13 and lower, where it is an app of its own. The iPhone app's card is the same switch for
// Apple Health, which the Apple Watch app also goes by (heart rate per set).
const HEALTH_COPY: any = {
    android: () => ({
        section: t('Health Connect'), write: t('Write to Health Connect'), open: t('Open Health Connect'),
        footer: t('Workouts and weigh-ins go to Health Connect when you finish or change them.'),
        on: t('Writing to Health Connect'), denied: t('Health Connect permission not granted'), failed: t('Could not write to Health Connect'),
        removeFailed: t('Could not remove it from Health Connect'), stop: t('Stop writing to Health Connect?'),
        stopSub: t('What openGym already wrote can stay in Health Connect as your data, or be removed from it.'),
    }),
    ios: () => ({
        section: t('Apple Health'), write: t('Write to Apple Health'), open: t('Open Apple Health'),
        footer: t('Workouts and weigh-ins go to Apple Health when you finish or change them.'),
        on: t('Writing to Apple Health'), denied: t('Apple Health permission not granted'), failed: t('Could not write to Apple Health'),
        removeFailed: t('Could not remove it from Apple Health'), stop: t('Stop writing to Apple Health?'),
        stopSub: t('What openGym already wrote can stay in Apple Health as your data, or be removed from it.'),
    }),
};
function HealthConnectCard({ S, toast, android }: any) {
    const getState: any = () => useStore.getState().S;
    const [st, setSt]: any = useState(null);
    const [h, setH]: any = useState(null);
    const [busy, setBusy]: any = useState(false);
    useEffect(() => {
        let gone: any = false;
        Promise.all([healthStatus(), loadHealth()]).then(([s, f]: any) => { if (!gone) {
            setSt(s);
            setH(f);
        } }).catch(() => { });
        const off: any = onHealthChange((f?: any) => { if (!gone)
            setH(f); });
        return () => { gone = true; off(); };
    }, []);
    const ios: any = st?.platform === 'ios';
    if (!st || !h || st.status === 'unsupported' || (!android && !ios))
        return null;
    const c: any = HEALTH_COPY[ios ? 'ios' : 'android']();
    if (st.status !== 'available')
        return (<Section title={t('Health Connect')}>
      <Row icon="heart" iconTint="var(--red)" title={t('Health Connect')} subtitle={st.status === 'update'
                ? t('Update Health Connect to share workouts and weigh-ins with other apps.')
                : t('Install Health Connect to share workouts and weigh-ins with other apps.')} accessory="chevron" onClick={() => openHealthConnect().catch(() => { })}/>
    </Section>);
    const turnOn: any = async () => {
        setBusy(true);
        try {
            const r: any = await enableHealth(S);
            if (r.health)
                setH(r.health);
            else
                setH(await loadHealth());
            if (r.ok)
                toast(c.on);
            else
                toast(r.reason === 'denied' ? c.denied : c.failed);
        }
        catch {
            toast(c.failed);
        }
        setBusy(false);
    };
    const turnOff: any = (removeWritten?: any) => async () => {
        setBusy(true);
        try {
            setH(await disableHealth({ removeWritten }));
        }
        catch {
            toast(c.removeFailed);
        }
        setBusy(false);
    };
    // Reading back (v1.4.3): heart rate during workouts and weigh-ins from other apps, each its own
    // switch and its own permission. Turning one off keeps what it already brought in.
    const toggleRead: any = (kind?: any) => async (v?: any) => {
        setBusy(true);
        try {
            if (v) {
                const r: any = await enableRead(kind, getState);
                setH(r.health || await loadHealth());
                if (!r.ok)
                    toast(r.reason === 'denied' ? c.denied : c.failed);
            }
            else
                setH(await disableRead(kind));
        }
        catch {
            toast(c.failed);
        }
        setBusy(false);
    };
    const reading: any = h.readHr || h.readWeight;
    // Off can mean two things for what is already there, so it asks; closing the sheet keeps it on.
    const askOff: any = () => menuSheet({
        title: c.stop,
        subtitle: c.stopSub,
        items: [
            { icon: 'check', label: t('Stop, keep what it wrote'), onClick: turnOff(false) },
            { icon: 'trash', label: t('Stop and remove what it wrote'), danger: true, onClick: turnOff(true) },
        ],
    });
    return (<Section title={c.section} footer={[h.on && c.footer, reading && (h.readWeight && h.wHistory ? t('openGym reads only while it is open: heart rate for workouts of the last day, weigh-ins of the last year. Older workouts stay as they are.') : t('openGym reads only while it is open: heart rate for workouts of the last day, weigh-ins of the last 30 days. Older workouts stay as they are.'))].filter(Boolean).join(' ') || null}>
      <Row icon="heart" iconTint="var(--red)" title={c.write} subtitle={t('Finished workouts and weigh-ins, from this phone only.')}>
        <Switch checked={!!h.on} disabled={busy} onChange={(v?: any) => (v ? turnOn() : askOff())}/>
      </Row>
      {h.on && h.error === 'permission' && <Row icon="warning" iconTint="var(--orange)" title={t('Permission withdrawn. Tap to allow again')} accessory="chevron" onClick={turnOn}/>}
      <Row icon="heart" iconTint="var(--red)" title={t('Heart rate from your watch')} subtitle={t('After a workout, each set gets the heart rate your watch saved. Garmin, Fitbit, Galaxy Watch and friends welcome.')}>
        <Switch checked={!!h.readHr} disabled={busy} onChange={toggleRead('hr')}/>
      </Row>
      <Row icon="scale" iconTint="var(--teal)" title={t('Weigh-ins from other apps')} subtitle={t('Your smart scale’s weigh-ins land here. One you type in yourself always wins.')}>
        <Switch checked={!!h.readWeight} disabled={busy} onChange={toggleRead('weight')}/>
      </Row>
      {reading && h.readError === 'permission' && <Row icon="warning" iconTint="var(--orange)" title={t('Permission withdrawn. Tap to allow again')} accessory="chevron" onClick={() => toggleRead(h.readHr ? 'hr' : 'weight')(true)}/>}
      {(h.on || reading) && <Row icon="list" iconTint="var(--blue)" title={c.open} accessory="chevron" onClick={() => openHealthConnect().catch(() => { })}/>}
    </Section>);
}
