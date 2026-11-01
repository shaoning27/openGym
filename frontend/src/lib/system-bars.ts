// Legacy dynamic types are explicit during the full language migration.
// The status bar (and on Android the navigation bar) draws on top of the page: Android 15 runs the
// page edge to edge, iOS always does. The icons are white unless the native side is told the page
// is light, and on the light theme the clock and the battery all but vanished on #f2f2f7. App.tsx
// calls this with every theme it resolves to. Android: BarIconsPlugin.java flips the icons dark on
// light and back (from Android 15, where the page is under the bars). iOS: Capacitor's own
// SystemBars plugin does the same for the status bar.
import { MOBILE } from './mobile.ts';
// Registered once, and kept inside an object: a Capacitor plugin proxy answers `then` with a native
// call that never settles, so a promise resolved with the bare proxy would hang (the Coach hang, #42).
let pluginP: any = null;
const barsPlugin: any = () => pluginP || (pluginP = (async () => {
    if (!MOBILE)
        return null;
    const { Capacitor, registerPlugin, SystemBars }: any = await import('@capacitor/core');
    const platform: any = Capacitor.getPlatform();
    if (platform === 'android') {
        const icons: any = registerPlugin('BarIcons');
        return { setLight: (light?: any) => icons.setStyle({ light }) };
    }
    if (platform === 'ios' && SystemBars) {
        return { setLight: (light?: any) => SystemBars.setStyle({ style: light ? 'LIGHT' : 'DARK' }) };
    }
    return null;
})().catch(() => null));
let last: any = null;
export async function setSystemBarsLight(light?: any) {
    light = !!light;
    if (last === light)
        return;
    last = light;
    try {
        const p: any = await barsPlugin();
        if (p)
            await p.setLight(light);
    }
    catch {
        // An older APK without the plugin: the bars stay as they were.
    }
}
