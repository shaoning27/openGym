// Legacy dynamic types are explicit during the full language migration.
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useStore } from '../store/useStore.ts';
import { DEMO } from '../lib/demo.ts';
import { t } from '../lib/i18n.ts';
import { connectionView, actionLabel, syncNowWithToast, pairAgain, connectServer, signInAgain, useOnline } from './ServerSync.tsx';
import Icon from './Icon.tsx';
// How long a change may sit unsent while the server is reachable before it is worth a word: the
// push after an edit, or the one boot owes, lands well within this, and saying "not synced" for
// every one of them would only teach people to ignore the line.
export const PENDING_GRACE_MS: any = 5000;
/* The connection, always in view while the app is not connected to a server: offline, the server
   unreachable or answering with an error (its HTTP code, for whoever runs it), a server that no
   longer accepts this device, an answer that is not openGym's, and a guest in a browser. A
   problem cannot be dismissed; it goes when the condition does — or when Settings → "Show
   connection status" is off, and then a dot on Home says a problem is there. The guest line alone
   has an ×, which hides it for good (#454): no server is a choice there, not a fault. A phone kept
   local never sees any of it. The others say what is wrong and that the changes are kept here,
   with the one thing to do about it (retry, pair again, sign in).

   Pinned under the status bar, above the page and the pinned workout and chat headers, below the
   tab bar, the timer and every sheet. Its height goes into --conn on the root, which the page's
   top padding and those headers add in, so it takes its own room instead of covering a control.
   The public demo has no server by design and says so itself; it never shows there. */
// What the indicator would say right now, and whether it would say it: shared by the banner and
// by the dot that stands in for it when the banner is switched off (useConnectionTrouble).
function useConnection() {
    const user: any = useStore((s?: any) => s.user);
    const sync: any = useStore((s?: any) => s.sync);
    const guest: any = useStore((s?: any) => s.isGuest());
    const onboarding: any = useStore((s?: any) => s.needsMobileOnboarding);
    const online: any = useOnline();
    const [waited, setWaited]: any = useState(false);
    const status: any = sync?.status;
    useEffect(() => {
        setWaited(false);
        if (status !== 'pending')
            return;
        const tm: any = setTimeout(() => setWaited(true), PENDING_GRACE_MS);
        return () => clearTimeout(tm);
    }, [status]);
    const view: any = connectionView(sync, { online });
    // Signed out on the web, the sign-in screen is the whole app: it hears only that the server
    // ended the session, and that the changes are still here.
    const show: any = !DEMO && !onboarding && !!view?.banner && (!!user || guest || status === 'auth') && (status !== 'pending' || waited);
    return { view, show, user, status };
}
// "Show connection status" (#369, #330): on by default, and an older profile without the key
// reads as on. Off hides the banner — for a phone kept local on purpose it is a line that never
// goes — but a sync that is stuck still has to be noticed somewhere.
export const showsConnection: any = (S?: any) => S?.connStatus !== false;
// The quiet "no server" line (#454): a phone kept local or a guest has chosen that, and a line
// saying so on every screen, for good, is a nag. Its × sets this off; offline, an error or a
// refusal still show, since only the 'quiet' tone is ever hidden by it.
export const showsLocalLine: any = (S?: any) => S?.connLocal !== false;
/* True while the banner is switched off and the connection has a problem worth seeing: offline,
   the server unreachable or answering with an error, refusing this device, a sign-in question
   still open, or changes waiting past the grace period. Never for a device with no server at all
   (a phone kept local, a guest): that is a choice, not a fault. The Home tab and the Settings
   gear carry a dot for it. */
export function useConnectionTrouble() {
    const on: any = useStore((s?: any) => showsConnection(s.S));
    const { view, show }: any = useConnection();
    return !on && show && (view.tone === 'off' || view.tone === 'bad' || view.tone === 'wait');
}
export default function SyncBanner() {
    const nav: any = useNavigate();
    const on: any = useStore((s?: any) => showsConnection(s.S));
    const local: any = useStore((s?: any) => showsLocalLine(s.S));
    const update: any = useStore((s?: any) => s.update);
    const conn: any = useConnection();
    const { view, user, status }: any = conn;
    const quiet: any = view?.tone === 'quiet';
    const show: any = conn.show && on && (!quiet || local);
    const row: any = useRef(null);
    useLayoutEffect(() => {
        const root: any = document.documentElement;
        const el: any = row.current;
        if (!show || !el) {
            root.style.removeProperty('--conn');
            return;
        }
        const fit: any = () => root.style.setProperty('--conn', el.offsetHeight + 'px');
        fit();
        const ro: any = typeof ResizeObserver === 'function' ? new ResizeObserver(fit) : null;
        ro?.observe(el);
        return () => { ro?.disconnect(); root.style.removeProperty('--conn'); };
    }, [show]);
    if (!show)
        return null;
    const act: any = ({
        retry: () => { syncNowWithToast(); },
        pair: pairAgain,
        connect: connectServer,
        // Signed in, or with a session the server ended: the passkey right here. A guest goes to
        // Settings, where signing in sits next to creating a profile.
        signin: () => (user || status === 'auth' ? signInAgain() : nav('/settings/account')),
    } as any)[view.action];
    const label: any = actionLabel(view);
    const inner: any = <>
    <Icon name={view.icon}/>
    <span className="conn-t">{view.banner}</span>
    {act && label && <span className="conn-a">{label}</span>}
  </>;
    return <div className={'conn-bar ' + view.tone}>
    <div className="conn-row" ref={row} role="status" aria-live="polite">
      {act ? <button className="conn" onClick={act}>{inner}</button> : <div className="conn">{inner}</div>}
      {/* Connecting or signing in is still in Settings, so hiding the line takes nothing away. */}
      {quiet && <button type="button" className="conn-x" aria-label={t('Close')} onClick={() => update((s?: any) => { s.connLocal = false; })}><Icon name="xmark"/></button>}
    </div>
  </div>;
}
