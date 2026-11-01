// Legacy dynamic types are explicit during the full language migration.
import { useEffect } from 'react';
import { useUI } from '../store/useUI.ts';
// Flips the app's real light/dark theme on and off twice (~2.4s) instead of laying an
// opaque black/white rectangle over the screen — the alert reads as the app itself
// blinking, and it always settles back on whatever theme the user actually had.
export default function TimerFlash() {
    const id: any = useUI((s?: any) => s.timerFlashId);
    useEffect(() => {
        if (!id)
            return;
        const de: any = document.documentElement;
        const original: any = de.dataset.theme;
        const opposite: any = original === 'light' ? 'dark' : 'light';
        const steps: any = [opposite, original, opposite, original];
        const timers: any = steps.map((theme?: any, i?: any) => setTimeout(() => { de.dataset.theme = theme; }, i * 600));
        return () => {
            timers.forEach(clearTimeout);
            de.dataset.theme = original;
        };
    }, [id]);
    return null;
}
