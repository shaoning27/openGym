// Legacy dynamic types are explicit during the full language migration.
import { useMemo } from 'react';
import BodyMap from './BodyMap.tsx';
import { loadOfRoutine } from '../lib/muscles.ts';
// A thumbnail of what one or more routines hit, for list rows (Plan's routines, Home's Today).
// Decoration beside the name: the row itself is the button, so the map is hidden from screen
// readers and takes no taps. Nothing at all for a routine that hits nothing yet.
export default function MiniBodyMap({ routines, body }: any) {
    const load: any = useMemo(() => loadOfRoutine({ ex: routines.flatMap((r?: any) => r?.ex || []) }), [routines]);
    if (!Object.values(load).some((v?: any) => v > 0))
        return null;
    return <span className="bm-mini-wrap" aria-hidden="true"><BodyMap className="bm-mini" load={load} body={body}/></span>;
}
