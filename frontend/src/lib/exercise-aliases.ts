// Legacy dynamic types are explicit during the full language migration.
const MAX_ALIASES: any = 20;
const MAX_LENGTH: any = 80;
let overrides: any = {};
export function normalizeAliases(value?: any) {
    const values: any = typeof value === 'string' ? value.split(/[,\n]/) : Array.isArray(value) ? value : [];
    const seen: any = new Set();
    return values.filter((v?: any) => typeof v === 'string').map((v?: any) => v.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, MAX_LENGTH))
        .filter((v?: any) => { const key: any = v.toLocaleLowerCase(); if (!v || seen.has(key))
        return false; seen.add(key); return true; })
        .slice(0, MAX_ALIASES);
}
// Register every adopted/restored state, including an empty map when switching profiles.
export const registerExerciseAliases: any = (map?: any) => { overrides = map && typeof map === 'object' && !Array.isArray(map) ? map : {}; };
export const aliasSnapshot: any = () => overrides;
export const exerciseAliases: any = (ex?: any, map: any = overrides) => normalizeAliases(map && Object.hasOwn(map, ex?.id) ? map[ex.id] : ex?.aliases);
