// Legacy dynamic types are explicit during the full language migration.
// Settings → Workout → Animation quality, and the hooks that put the chosen quality on screen
// (store apps only; the web and a self-hosted server show nothing new and keep their 180 px
// files). The rules are lib/anim-quality.ts, the packs and the per-device choice lib/anim-packs.js.
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { useStore } from '../store/useStore.ts';
import { t } from '../lib/i18n.ts';
import { MOBILE } from '../lib/mobile.ts';
import { gifSrc, figureOf } from '../lib/exercises.ts';
import { fmtMB } from '../lib/media-limits.ts';
import { BUILTIN_PX, packId, parsePackId, wantedQuality, clipSources } from '../lib/anim-quality.ts';
import { subscribe, getState, installedBases, deviceInfo, refresh, ensureWanted, writePrefs, download, remove, downloadBytes, diagnose, offeredQualities, targetPack, ALL_PACKS } from '../lib/anim-packs.ts';
import { Section, Row, Switch, Button } from './ui.tsx';
import { useUI } from '../store/useUI.ts';
const MB: any = 1024 * 1024;
export const useAnimPacks: any = () => useSyncExternalStore(subscribe, getState, getState);
/**
 * Where a built-in exercise's animation comes from, best first (lib/anim-quality.ts clipSources):
 * `{ still, sources }`. Off the store apps, always the built-in file.
 */
export function useAnimSources(ex?: any, figure?: any) {
    const packs: any = useAnimPacks();
    const builtin: any = ex?.gif ? gifSrc(ex, figure) : null;
    if (!MOBILE)
        return { still: false, sources: builtin ? [builtin] : [] };
    const choice: any = packs.available ? packs.prefs.choice : (packs.prefs.choice === 'still' ? 'still' : 'builtin');
    return clipSources({ ex, figure, choice, device: deviceInfo(), installed: installedBases(packs), builtin });
}
/** Shell: what the device has, once, and the pack the choice wants for the figure shown. */
export function useAnimPacksBoot() {
    const figure: any = useStore((s?: any) => figureOf(s.S));
    useEffect(() => { if (MOBILE)
        refresh().then(() => ensureWanted(figure)).catch(() => { }); }, []);
    useEffect(() => { if (MOBILE && getState().checked)
        ensureWanted(figure); }, [figure]);
}
// "Auto (360 px)", "Still only", "Built in (180 px)", "720 px".
export function choiceLabel(choice?: any, packs: any = getState(), figure: any = 'male') {
    if (choice === 'still')
        return t('Still only');
    if (choice === 'builtin' || !packs.available)
        return t('Built in ({0} px)', BUILTIN_PX);
    if (choice === 'auto') {
        // A build that names its packs (Android) may not have the size Auto wants: the one it gets.
        const target: any = packs.offered ? targetPack('auto', figure, deviceInfo(), packs) : null;
        const q: any = packs.offered ? (target ? (parsePackId(target)!.px as any) : 'builtin') : wantedQuality('auto', deviceInfo());
        return t('Auto ({0})', q === 'builtin' ? t('{0} px', BUILTIN_PX) : t('{0} px', q));
    }
    return t('{0} px', choice);
}
export function AnimationQualityRow() {
    const packs: any = useAnimPacks();
    const figure: any = useStore((s?: any) => figureOf(s.S));
    if (!MOBILE)
        return null;
    return <Row icon="image" iconTint="var(--indigo)" title={t('Animation quality')} value={choiceLabel(packs.prefs.choice, packs, figure)} accessory="chevron" onClick={() => useUI.getState().openSheet((close?: any) => <AnimationQualitySheet close={close}/>)}/>;
}
// One pack's line under its quality: downloaded and how big on this device, on its way, waiting
// for Wi-Fi, or what it would take to download ("~750 MB").
const sizeText: any = (bytes?: any) => t('{0} MB', fmtMB(Math.max(0.1, bytes / MB)));
function packLine(p?: any, id?: any) {
    if (!p || p.state === 'none' || !p.state) {
        const dl: any = downloadBytes(id);
        return dl ? t('Not downloaded') + ' · ~' + sizeText(dl) : t('Not downloaded');
    }
    if (p.state === 'ready') {
        const dl: any = downloadBytes(id);
        return t('Downloaded · {0}', p.bytes > 0 ? sizeText(p.bytes) : dl ? '~' + sizeText(dl) : '…');
    }
    if (p.state === 'downloading')
        return t('Downloading… {0}%', Math.round((p.progress || 0) * 100));
    if (p.state === 'needs-wifi')
        return t('Waiting for Wi-Fi');
    return t('Download failed. Tap to try again.');
}
// TestFlight builds (or the title tapped five times): what the native side knows about each pack
// and whether its sample drawing loads, for a screenshot when a download does not show. Not
// translated on purpose: it is for the person fixing it.
function PackDetails({ figure }: any) {
    const [rows, setRows]: any = useState(null);
    const run: any = async () => {
        setRows([]);
        const ids: any = (getState().offered || ALL_PACKS).filter((id?: any) => id.endsWith('-' + figure));
        const out: any = [];
        for (const id of ids) {
            out.push(await diagnose(id));
            setRows([...out]);
        }
    };
    return <Section title="Details">
    <Row icon="info" title="Check the packs" subtitle="State, where they are read from, a sample drawing" accessory="chevron" onClick={run}/>
    {rows && <pre className="small dim" style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-all', userSelect: 'text', padding: '8px 12px', margin: 0 }}>
      {rows.length ? rows.map((r?: any) => JSON.stringify(r, null, 1)).join('\n\n') : '…'}
    </pre>}
  </Section>;
}
export function AnimationQualitySheet({ close }: any) {
    const packs: any = useAnimPacks();
    const figure: any = useStore((s?: any) => figureOf(s.S));
    const { choice, wifiOnly }: any = packs.prefs;
    const pick: any = (c?: any) => { writePrefs({ choice: c }); ensureWanted(figure); };
    const retry: any = (id?: any) => () => download(id);
    const qualities: any = packs.available ? offeredQualities(figure, packs) : [];
    const ready: any = Object.entries(packs.packs).filter(([, p]: any) => p.state === 'ready');
    const taps: any = useRef(0);
    const [details, setDetails]: any = useState(false);
    const tapTitle: any = () => { taps.current += 1; if (taps.current >= 5)
        setDetails(true); };
    return <>
    <h3 onClick={tapTitle}>{t('Animation quality')}</h3>
    <Section footer={packs.available
            ? t('Sharper animations download once per figure. Until they’re here you see the built-in ones, so nothing ever goes blank.')
            : t('Sharper animations aren’t available on this device yet. The built-in ones work everywhere.')}>
      {packs.available && <Row title={choiceLabel('auto', packs, figure)} subtitle={t('A good size for this screen.')} accessory={choice === 'auto' ? 'check' : 'none'} onClick={() => pick('auto')}/>}
      <Row title={t('Still only')} subtitle={t('No animation, just the picture. Easy on battery.')} accessory={choice === 'still' ? 'check' : 'none'} onClick={() => pick('still')}/>
      <Row title={choiceLabel('builtin', packs, figure)} accessory={choice === 'builtin' || (!packs.available && choice !== 'still') ? 'check' : 'none'} onClick={() => pick('builtin')}/>
      {qualities.map((px?: any) => {
            const id: any = packId(px, figure);
            const p: any = packs.packs[id];
            const failed: any = p?.state === 'failed' || p?.state === 'needs-wifi';
            return <Row key={px} title={t('{0} px', px)} subtitle={packLine(p, id)} accessory={choice === px ? 'check' : 'none'} onClick={failed && choice === px ? retry(id) : () => pick(px)}/>;
        })}
    </Section>
    {packs.available && <Section>
      <Row icon="cloud" iconTint="var(--blue)" title={t('Download over Wi-Fi only')}>
        <Switch checked={wifiOnly} onChange={(v?: any) => writePrefs({ wifiOnly: v })}/>
      </Row>
    </Section>}
    {ready.length > 0 && <Section title={t('On this device')}>
      {ready.map(([id, p]: any) => {
                const [, px, fig]: any = /^anim-(\d+)-(male|female)$/.exec(id) || [];
                return <Row key={id} title={t('{0} px', px) + ' · ' + (fig === 'female' ? t('Female') : t('Male'))} subtitle={p.bytes > 0 ? sizeText(p.bytes) : '…'}>
          <Button size="sm" variant="danger" onClick={() => remove(id)}>{t('Delete')}</Button>
        </Row>;
            })}
    </Section>}
    {packs.available && (packs.testflight || details) && <PackDetails figure={figure}/>}
    <Button variant="ghost" className="dim" onClick={close}>{t('Done')}</Button>
  </>;
}
