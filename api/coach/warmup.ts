// Legacy dynamic types are explicit during the full language migration.
/* Keeps a local model's prefix cache warm, so nobody pays the cold start.
 *
 * The rules ride as a byte-identical system message precisely so a llama.cpp/Ollama endpoint
 * can reuse its KV prefix across jobs — but the cache only exists after something has sent
 * that prefix once, and it dies with the ollama process. Without this, the first review after
 * a reboot quietly costs ~8 minutes instead of ~1, and whoever asks it looks unlucky.
 *
 * So: when the configured provider is a compatible endpoint, send each chat prefix once at
 * boot and then again every half hour. A warm ping is nearly free (the prefix is cached, one
 * token comes back); a cold one does the expensive read exactly once, off anyone's clock.
 * Cloud providers are never pinged — their caches are their problem, and requests cost money.
 */
import * as cfgStore from './config.ts';
import { adapterFor } from './adapters/index.ts';
import { buildPromptParts } from './core/prompt.ts';
import { fetchFor } from './node-fetch.ts';
const INTERVAL_MS: any = 30 * 60000;
const TIMEOUT_MS: any = 10 * 60000;
// The two kinds a chat runs day to day; `create` happens once per user and may pay cold.
// Review is deliberately LAST: with OLLAMA_NUM_PARALLEL=1 there is one live slot, it belongs
// to whatever ran most recently, and the fallback restore from the prompt cache is not
// reliable for large prompts — so the slot must end up holding the kind people actually use.
// (Measured: a review right after a debrief ping took 402 s; right after a review ping, 26 s.)
const KINDS: any = ['debrief', 'review'];
let running: any = false;
export async function warmOnce({ log = console, fetch: fetchImpl }: any = {}) {
    const cfg: any = cfgStore.load();
    if (!cfgStore.isEnabled() || cfg.provider !== 'compatible')
        return { skipped: true };
    const adapter: any = adapterFor(cfg.provider);
    if (!adapter || adapter.spawns !== false)
        return { skipped: true };
    if (running)
        return { skipped: true };
    running = true;
    try {
        for (const kind of KINDS) {
            const parts: any = buildPromptParts(kind, {});
            const t0: any = Date.now();
            const r: any = await adapter.invoke({
                cfg,
                system: parts.system,
                prompt: 'Reply with exactly {"coach_contract":1} and nothing else.',
                model: cfgStore.modelFor(cfg),
                timeoutMs: TIMEOUT_MS,
                fetch: fetchImpl || fetchFor(TIMEOUT_MS)
            });
            const ms: any = Date.now() - t0;
            if (r.code !== 0) {
                log.log(`coach warmup (${kind}): endpoint not reachable, will retry later`);
                return { ok: false };
            }
            // >5s means the prefix was actually (re)read — worth a line; a warm ping is noise.
            if (ms > 5000)
                log.log(`coach warmup (${kind}): prefix cached in ${Math.round(ms / 1000)}s`);
        }
        return { ok: true };
    }
    finally {
        running = false;
    }
}
/** Boot + every half hour. Never throws; a failed warmup is only a missed optimisation. */
export function startWarmup(log: any = console) {
    const tick: any = () => warmOnce({ log }).catch(() => { });
    setTimeout(tick, 5000); // let the container settle first
    const timer: any = setInterval(tick, INTERVAL_MS);
    timer.unref?.();
    return timer;
}
