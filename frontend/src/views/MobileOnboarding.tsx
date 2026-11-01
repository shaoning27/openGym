// Legacy dynamic types are explicit during the full language migration.
// Mobile build only, first launch: the choice useStore.boot() couldn't make on its own — keep
// everything on this device, or connect to a self-hosted openGym server instead. See
// lib/remote.ts for the pairing flow this hands off to.
import { useState, useRef, useEffect } from 'react';
import { useStore } from '../store/useStore.ts';
import { useUI } from '../store/useUI.ts';
import { openLostAccess } from '../components/LostAccess.tsx';
import { t } from '../lib/i18n.ts';
import Icon from '../components/Icon.tsx';
import { Button } from '../components/ui.tsx';
import { askAddDeviceData } from '../sheets.tsx';
import { normalizeServerUrl } from '../lib/remote.ts';
import { loadCfAccess, saveCfAccess } from '../lib/cf-access.ts';
import { useSheetKeyboard } from '../lib/use-sheet-keyboard.ts';
// A plain http:// server works (#428), but whatever the app sends, the pairing code and then its
// token, crosses the network readable. Said once under the field, not in the way: on a home
// network that is often a fine trade. localhost is the phone itself and needs no warning.
export function plainHttp(raw?: any) {
    const base: any = /^\s*http:\/\//i.test(String(raw || '')) ? normalizeServerUrl(raw) : null;
    if (!base)
        return false;
    const host: any = new URL(base).hostname;
    return !/^(localhost|127\.\d+\.\d+\.\d+|\[::1\])$/i.test(host);
}
// The sheet's slide-up (index.css @keyframes sheetup, .34s) plus a frame: a field focused before
// it lands has the keyboard reveal it at a position the sheet is about to leave.
export const SHEET_SETTLE_MS: any = 400;
// `server`: the address the token is most likely for (the one being typed into ConnectSheet).
const openCfAccess: any = (server?: any) => useUI.getState().openSheet((close?: any) => <CfAccessSheet close={close} server={server}/>);
// A server behind Cloudflare Access (lib/cf-access.ts): the service token that lets this phone
// through, entered before pairing because the pairing request has to get through as well. It is
// saved with the address of its server and only ever sent there, so the sheet asks for that
// address too and says it: a stored token shows the server it belongs to, not `server`.
export function CfAccessSheet({ close, server = '' }: any) {
    const [addr, setAddr]: any = useState(typeof server === 'string' ? server : '');
    const [clientId, setClientId]: any = useState('');
    const [clientSecret, setClientSecret]: any = useState('');
    const [had, setHad]: any = useState(false);
    const [busy, setBusy]: any = useState(false);
    const addrRef: any = useRef(null);
    const onFocus: any = useSheetKeyboard(addrRef, true, { reveal: true });
    const origin: any = normalizeServerUrl(addr);
    useEffect(() => {
        loadCfAccess().then((c?: any) => { if (c) {
            setClientId(c.clientId);
            setClientSecret(c.clientSecret);
            setHad(true);
            if (c.origin)
                setAddr(c.origin);
        } });
    }, []);
    const save: any = async (id?: any, secret?: any) => {
        if (!!id.trim() !== !!secret.trim()) {
            useUI.getState().toast(t('Enter both the Client ID and the Client Secret'));
            return;
        }
        if (id.trim() && !origin) {
            useUI.getState().toast(t('Enter the address of the server this token is for'));
            return;
        }
        setBusy(true);
        try {
            const saved: any = await saveCfAccess({ clientId: id, clientSecret: secret, server: origin });
            close();
            useUI.getState().toast(saved ? t('Saved') : t('Removed'));
        }
        catch (e: any) {
            useUI.getState().toast(e.message || t('Could not save'));
        }
        finally {
            setBusy(false);
        }
    };
    return <div className="kb-lift">
    <h3>{t('Cloudflare Access')}</h3>
    <div className="muted small" style={{ marginBottom: 14 }}>
      {t('Only if your server is behind Cloudflare Access: the service token this phone sends with every request to it. Kept in this phone’s secure storage.')}
    </div>
    <input ref={addrRef} className="input" placeholder={t('Server address (e.g. gym.example.com)')} value={addr} aria-label={t('Server address (e.g. gym.example.com)')} onFocus={onFocus} onChange={(e?: any) => setAddr(e.target.value)} autoCapitalize="none" autoCorrect="off" inputMode="url"/>
    {origin && <div className="dim small" role="note" style={{ marginTop: 8, lineHeight: 1.45, overflowWrap: 'anywhere' }}>
      {t('Sent only to {0}, never to another server.', new URL(origin).host)}
    </div>}
    <div style={{ height: 10 }}/>
    <input className="input" placeholder="CF-Access-Client-Id" value={clientId} onFocus={onFocus} onChange={(e?: any) => setClientId(e.target.value)} autoCapitalize="none" autoCorrect="off" spellCheck={false}/>
    <div style={{ height: 10 }}/>
    <input className="input" type="password" placeholder="CF-Access-Client-Secret" value={clientSecret} onFocus={onFocus} onChange={(e?: any) => setClientSecret(e.target.value)} autoCapitalize="none" autoCorrect="off" spellCheck={false} autoComplete="off"/>
    <div style={{ height: 12 }}/>
    <Button variant="primary" onClick={() => save(clientId, clientSecret)} disabled={busy}>{t('Save')}</Button>
    {had && <>
      <div style={{ height: 10 }}/>
      <Button icon="trash" onClick={() => save('', '')} disabled={busy}>{t('Remove')}</Button>
    </>}
  </div>;
}
// `again`: a phone whose server stopped accepting it (components/ServerSync.tsx pairAgain) — the
// address it had is filled in when it still has one, so only the new code is left to type, and
// the sheet says that what the phone kept is merged, not replaced.
export function ConnectSheet({ close, initialUrl = '', again = false }: any) {
    const { connectToServer }: any = useStore();
    const [url, setUrl]: any = useState(initialUrl);
    const [code, setCode]: any = useState('');
    const [busy, setBusy]: any = useState(false);
    // Why the last try failed, under the fields: a toast is gone in two seconds, too soon to read
    // "the server was reached but refused the app's request" and act on it (#329).
    const [error, setError]: any = useState('');
    const ref: any = useRef(null);
    const codeRef: any = useRef(null);
    // The sheet stands on the keyboard and scrolls the focused field into view itself (index.css
    // .kb-lift). On iOS the code field went out of sight above the screen (TestFlight build 26):
    // the sheet sat at the bottom under the keys, so WebKit scrolled the pinned page to reach the
    // field, and the first focus came 250 ms into the sheet's 340 ms slide-up, measured on a
    // sheet still moving. The autofocus now waits for the sheet to land.
    const onFocus: any = useSheetKeyboard(ref, true, { reveal: true });
    useEffect(() => {
        const tm: any = setTimeout(() => (initialUrl ? codeRef : ref).current?.focus(), SHEET_SETTLE_MS);
        return () => clearTimeout(tm);
    }, []);
    const go: any = async () => {
        if (!url.trim() || !code.trim()) {
            useUI.getState().toast(t('Enter your server address and the code'));
            return;
        }
        setBusy(true);
        setError('');
        try {
            await connectToServer(url.trim(), code.trim(), askAddDeviceData);
            close();
            useUI.getState().toast(t('Connected'));
        }
        catch (e: any) {
            setError(e.message || t('Could not connect'));
        }
        finally {
            setBusy(false);
        }
    };
    return <div className="kb-lift">
    <h3>{again ? t('Pair again') : t('Connect to my server')}</h3>
    <div className="muted small" style={{ marginBottom: 14 }}>
      {again
            ? t('Open Settings → Account → “Pair the mobile app” on your openGym site in a browser and enter the new code shown there. What this phone kept is merged into your account.')
            : t('Open Settings → Account → “Pair the mobile app” on the openGym site you’re already signed into, then enter its address and the code shown there.')}
    </div>
    <input ref={ref} className="input" placeholder={t('Server address (e.g. gym.example.com)')} value={url} onFocus={onFocus} onChange={(e?: any) => setUrl(e.target.value)} autoCapitalize="none" autoCorrect="off" inputMode="url"/>
    {plainHttp(url) && <div className="dim small" role="note" style={{ marginTop: 8, lineHeight: 1.45 }}>
      {t('Plain http:// isn’t encrypted. Fine on your home network, but use https:// if your server is reachable from the internet.')}
    </div>}
    <div style={{ height: 10 }}/>
    <input ref={codeRef} className="input" placeholder={t('Pairing code')} maxLength={8} value={code} onFocus={onFocus} onChange={(e?: any) => setCode(e.target.value.toUpperCase())} style={{ letterSpacing: '.14em', fontWeight: 600, textAlign: 'center' }}/>
    {error && <div className="small" role="alert" style={{ color: 'var(--red)', marginTop: 10, lineHeight: 1.45, overflowWrap: 'anywhere' }}>{error}</div>}
    <div style={{ height: 12 }}/>
    <Button variant="primary" onClick={go} disabled={busy}>{busy ? t('Connecting…') : t('Connect')}</Button>
    <div style={{ height: 10 }}/>
    <Button icon="key" onClick={() => openCfAccess(normalizeServerUrl(url) || '')} disabled={busy}>{t('Cloudflare Access')}</Button>
    <Button variant="ghost" className="dim" onClick={openLostAccess} disabled={busy}>{t('Lost access?')}</Button>
  </div>;
}
export default function MobileOnboarding() {
    const { chooseLocalMode }: any = useStore();
    const head: any = <>
    <div style={{ fontSize: 54, display: 'flex', justifyContent: 'center', color: 'var(--acc)' }}><Icon name="dumbbell"/></div>
    <h1 style={{ fontSize: 34, fontWeight: 700, letterSpacing: '-.028em', margin: '10px 0 4px' }}>openGym</h1>
  </>;
    const wrap: any = { display: 'flex', flexDirection: 'column', justifyContent: 'center', minHeight: '78vh', textAlign: 'center' };
    return (<div className="narrow" style={wrap}>
      {head}
      <div className="muted" style={{ marginBottom: 34 }}>{t('How do you want to use openGym?')}</div>
      <Button variant="primary" icon="lock" onClick={() => chooseLocalMode()}>{t('Use on this device')}</Button>
      <div style={{ height: 10 }}/>
      <Button icon="cloud" onClick={() => useUI.getState().openSheet((close?: any) => <ConnectSheet close={close}/>)}>{t('Connect to my server')}</Button>
      <div className="dim small" style={{ marginTop: 26, lineHeight: 1.5 }}>
        {t('Local keeps everything on this phone. Connecting syncs to your own openGym server instead. You can switch later in Settings.')}
      </div>
      <div style={{ height: 18 }}/>
      <Button icon="gear" onClick={() => openCfAccess()}>{t('Connection settings')}</Button>
    </div>);
}
