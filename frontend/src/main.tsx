// Legacy dynamic types are explicit during the full language migration.
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import { MOBILE } from './lib/mobile.ts';
import { useStore } from './store/useStore.ts';
import { startMediaSync } from './lib/media-sync.ts';
import { startNativeKeyboard } from './lib/native-keyboard.ts';
// The Coach's and the admin dashboard's styles stay in the main stylesheet, in the place they
// always had (before index.css), although their screens are now loaded on demand (App.tsx).
import './admin.css';
import './coach.css';
import './index.css';
import { hideBoot, handOverFromLaunchScreen } from './lib/boot.ts';
// App.tsx restores per-route scroll itself; the browser's own attempt races it.
// A script that dies before the app draws would otherwise leave the boot logo lifting forever.
window.addEventListener('error', hideBoot, { once: true });
handOverFromLaunchScreen();
if ('scrollRestoration' in history)
    history.scrollRestoration = 'manual';
createRoot((document.getElementById('root') as any)).render(<StrictMode><App /></StrictMode>);
// The photos and videos of custom exercises, in every build (the phone and the demo included):
// uploads of what the server lacks, the local clean-up, and the plan's files kept offline.
startMediaSync(useStore);
// Android 15 does not resize the page for the soft keyboard; the app says how much it covers and
// this keeps the focused field above it. Idle everywhere else.
startNativeKeyboard();
// Not in the mobile build: the native shell already serves everything from disk.
if (!MOBILE && 'serviceWorker' in navigator && location.protocol === 'https:') {
    navigator.serviceWorker.register('sw.js').catch(() => { });
    // The plan's exercise media, kept by the worker for a workout opened without a network (#281).
    // It only fetches ahead while the page runs as the installed app; a tab keeps what it has shown.
    import('./lib/media-prefetch.ts').then((m?: any) => m.startMediaPrefetch(useStore)).catch(() => { });
}
