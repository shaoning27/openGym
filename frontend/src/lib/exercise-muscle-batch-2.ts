// Legacy dynamic types are explicit during the full language migration.
import batch from './exercise-muscle-batch-2.json' with { type: 'json' };
/**
 * ExRx-informed metadata for machine, cable, sled, and Smith-machine catalogue entries.
 * `exercises.ts` applies this as a runtime overlay so the raw generated catalogue remains
 * compatible with imports and historical records.
 */
export const MACHINE_BATCH_2: any = Object.freeze(batch);
