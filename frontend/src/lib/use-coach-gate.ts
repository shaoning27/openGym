// Legacy dynamic types are explicit during the full language migration.
// Whether the Coach is here, once that is known. A cold start straight on #/coach or
// #/coach/intake (a reload, a bookmark) reads the store before it has the answer: /api/config is
// fetched at boot without a session, so it carries no `coach` key, and setUser asks again only
// afterwards (useStore setUser). Deciding then sent everyone home (QA v1.4.2). Here the screens
// wait for an answer made for this session, asking for one if it is missing, and decide after.
import { useEffect, useState } from 'react';
import { useStore } from '../store/useStore.ts';
import { coachAvailable } from './coach.ts';
import { DEMO } from './demo.ts';
import { MOBILE } from './mobile.ts';
/** `{ known, ok }`: `ok` the Coach is available; `known` the answer is final for this session. */
export function useCoachGate() {
    const config: any = useStore((s?: any) => s.config);
    const user: any = useStore((s?: any) => s.user);
    const coachMode: any = useStore((s?: any) => s.coachLocal?.mode);
    const ready: any = useStore((s?: any) => s.ready);
    const ok: any = coachAvailable(config, user, { demo: DEMO, mobile: MOBILE, coachMode });
    const fresh: any = !user || !!(config && 'coach' in config);
    const [asked, setAsked]: any = useState(false);
    useEffect(() => {
        if (!ready || ok || fresh || asked)
            return;
        let gone: any = false;
        Promise.resolve(useStore.getState().refreshConfig?.()).catch(() => { }).finally(() => { if (!gone)
            setAsked(true); });
        return () => { gone = true; };
    }, [ready, ok, fresh, asked]);
    return { known: ok || (ready && (fresh || asked)), ok };
}
