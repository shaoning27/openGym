// Legacy dynamic types are explicit during the full language migration.
/* The exercise catalogue the Coach reasons over, in the five fields it needs.
 *
 * `library-data.js` is generated from the frontend dataset and committed (see
 * scripts/build-coach-assets.mjs) — the same arrangement the translated instruction packs use.
 * It is an ES module rather than JSON on purpose: bare node needs createRequire for JSON, Vite
 * needs an import attribute, and this file has to load under both without either knowing.
 */
import { EXERCISES } from './library-data.js';
export const LIBRARY: any = EXERCISES;
export const LIB_BY_ID: any = new Map(LIBRARY.map((e?: any) => [e.id, e]));
export const libraryHas: any = (id?: any) => LIB_BY_ID.has(id);
export const libraryName: any = (id?: any) => LIB_BY_ID.get(id)?.n || null;
/* Whether the person's equipment covers a catalogue exercise. Body weight is never gated, the
   same rule the app's own equipment profiles follow (frontend lib/equipment.ts), and an id the
   catalogue does not hold (one of their own exercises) is theirs to judge, not ours. No
   equipment stated means the whole catalogue. */
const ALWAYS_AVAILABLE: any = 'body weight';
export function equipmentAllows(equipment?: any, id?: any) {
    const wanted: any = (equipment || []).map((x?: any) => String(x).toLowerCase());
    if (!wanted.length)
        return true;
    const eq: any = (LIB_BY_ID.get(id)?.eq || '').toLowerCase();
    return !eq || eq === ALWAYS_AVAILABLE || wanted.includes(eq);
}
/* "I own no dumbbells", the app's switch under Settings → Equipment → Dumbbells (frontend
   lib/dumbbells.ts ownsNoDumbbells): kept in the synced dumbbell map under `none`. It holds
   whatever the Coach's own equipment answer says, the switch being the more direct statement. */
export const ownsNoDumbbells: any = (S?: any) => S?.dumbbells?.none?.on === true;
export const isDumbbellLift: any = (id?: any) => (LIB_BY_ID.get(id)?.eq || '').toLowerCase() === 'dumbbell';
/* ---------- the library slice the model gets to choose from ----------
   Bounded. The whole catalogue is 1,324 rows — 10k+ tokens on every job, which costs real money
   against a cloud API and does not fit a small local model's context at all; and a model does
   not choose better from 1,324 options than from 160. So the slice is capped and balanced: a
   weighted share of every body part, in catalogue order (deterministic, so repeated jobs keep
   the same prefix), with the exercises already in the user's plan or history always included —
   a review has to be able to name what it is talking about. */
export const MAX_LIBRARY: any = 160;
// What one library entry tells the model: enough to pick it, nothing more. The taxonomy
// fields beyond body part never appear in a rationale and cost ~30 tokens an entry.
const slim: any = (e?: any) => ({ id: e.id, n: e.n, bp: e.bp, ...(e.custom ? { custom: true } : {}) });
/* Mobility work is not what a plan is built from, and at an even share per body part the
   catalogue's 57 stretches crowded out the lifts that are: a first plan for someone who
   stated no equipment arrived with "upper legs" as five stretches, a balance board and some
   band work — no squat, no hinge, no lunge anywhere in the lane.

   Dropped from the candidate pool, never from the catalogue. One already in someone's plan or
   history is pinned by `keep` below and still travels, because a review has to be able to name
   what it is talking about, and the validator still accepts every id the catalogue holds.

   The word boundary is what stops this being a silent data bug: "single leg bridge with
   outstretched leg" is a glute exercise, not a stretch. */
export const isStretch: any = (e?: any) => /\bstretch(es|ing)?\b/i.test((e && e.n) || '');
/* ---------- what each body part is worth in candidates ----------
   An equal lane per body part reads fair and is not: it spent as many of the 160 slots on
   "lower arms" (37 rows, wrist curls to a one) as on "chest", and gave "neck" (two rows, both
   stretches) a lane of its own. A plan is not drawn from an even spread of the catalogue's
   taxonomy, so the lanes are weighted by how much programming actually draws on them.

   These are shares, not quotas — a lane that runs out hands its remainder to the others, which
   is what keeps a narrow equipment filter from returning a short slice. Anything not listed
   gets 1, so a body part added to the catalogue later still appears rather than vanishing. */
const LANE_WEIGHT: any = {
    'back': 4, 'chest': 4, 'upper legs': 4,
    'shoulders': 3,
    'upper arms': 2, 'waist': 2,
    'cardio': 1, 'lower arms': 1, 'lower legs': 1, 'neck': 1
};
const laneWeight: any = (bp?: any) => LANE_WEIGHT[bp] ?? 1;
export function librarySlice(S?: any, equipment?: any, { keep = [], max = MAX_LIBRARY }: any = {}) {
    const wanted: any = (equipment || []).map((x?: any) => String(x).toLowerCase());
    // A custom exercise's name and body part are whatever the person typed, and its id is
    // whatever the client wrote; all three ride into every prompt. Cut to the bounds payload.ts
    // gives every other name (NAME_MAX, 80) and id (ID_MAX, 64); a non-string reads as absent.
    const cut: any = (v?: any, n?: any) => (typeof v === 'string' ? v.slice(0, n) : undefined);
    const customs: any = (Array.isArray(S.customEx) ? S.customEx : [])
        .filter((c?: any) => c && typeof c === 'object' && typeof c.id === 'string' && c.id)
        .map((c?: any) => ({ id: cut(c.id, 64), n: cut(c.n, 80), bp: cut(c.bp, 40), tg: null, eq: 'custom', custom: true }));
    // No equipment stated (or "everything") ⇒ the whole catalogue. Filtering to nothing would
    // leave the Coach unable to propose anything at all, which is a worse failure than a
    // slightly larger payload.
    const noDumbbells: any = ownsNoDumbbells(S);
    const filtered: any = (wanted.length ? LIBRARY.filter((e?: any) => equipmentAllows(wanted, e.id)) : LIBRARY)
        .filter((e?: any) => !noDumbbells || !isDumbbellLift(e.id));
    const equipped: any = filtered.length ? filtered : LIBRARY;
    // Same reasoning as the equipment fallback: a filter that removed everything is not a filter
    // worth honouring. Someone whose only kit reaches nothing but stretches gets the stretches.
    const lifts: any = equipped.filter((e?: any) => !isStretch(e));
    const base: any = lifts.length ? lifts : equipped;
    const pinned: any = new Set(keep.filter((id?: any) => LIB_BY_ID.has(id)));
    const out: any = [];
    const taken: any = new Set();
    const add: any = (e?: any) => { if (!taken.has(e.id)) {
        taken.add(e.id);
        out.push(e);
    } };
    // What the user already trains comes first, filter or no filter.
    for (const id of pinned)
        add(LIB_BY_ID.get(id));
    if (base.length + out.length <= max) {
        base.forEach(add);
    }
    else {
        // Weighted round-robin across body parts, so a 292-row "upper arms" cannot crowd out a
        // 37-row "lower arms" and a 37-row "lower arms" cannot claim as much room as "chest";
        // order within a body part is the catalogue's own. Lanes are visited in sorted key order
        // and each takes its weight per pass, so the slice stays deterministic.
        const groups: any = new Map();
        for (const e of base) {
            if (!groups.has(e.bp))
                groups.set(e.bp, []);
            groups.get(e.bp).push(e);
        }
        const keys: any = [...groups.keys()].sort();
        const lanes: any = keys.map((k?: any) => groups.get(k));
        const weights: any = keys.map(laneWeight);
        const cursor: any = lanes.map(() => 0);
        let progressed: any = true;
        while (out.length < max && progressed) {
            progressed = false;
            for (let i: any = 0; i < lanes.length && out.length < max; i++) {
                for (let n: any = 0; n < weights[i] && out.length < max; n++) {
                    while (cursor[i] < lanes[i].length && taken.has(lanes[i][cursor[i]].id))
                        cursor[i]++;
                    if (cursor[i] >= lanes[i].length)
                        break; // lane spent; its share flows to the rest
                    add(lanes[i][cursor[i]++]);
                    progressed = true;
                }
            }
        }
    }
    return [...customs, ...out].map(slim);
}
