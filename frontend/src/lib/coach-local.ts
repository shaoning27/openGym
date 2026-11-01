// Legacy dynamic types are explicit during the full language migration.
// The Coach, on a phone that brings its own API key.
//
// No server. The pipeline the server runs — payload allowlist, prompt, provider call, parser,
// validator, one repair round — is imported from api/coach/core and run here, in-process, so
// the phone gets exactly the code the server has and not a second opinion of it. The apply
// engine, staleness, snapshot/revert and the log are the ones every build already uses.
//
// This module is the one static importer of the core, which makes `import('./coach-local.ts')`
// the whole lazy chunk: the exercise catalogue, the prompts and the validator arrive together
// and only after the user chose this mode. coach-api.ts dispatches here the same way it
// dispatches to the demo provider, so the screens never learn that there is no server.
//
// What is different from the server, and on purpose:
//   - the user pays. There is no cfg.caps to lean on, so a local daily cap is not optional —
//     but on a LAN model even that is friction, so it is one of the three dials the setup
//     screen's Advanced section keeps in the device file (#527).
//   - the pseudonym is drawn at random once and kept, rather than derived from a secret.
//   - a proposal waits in the device file, not in S, so it survives an app kill without
//     riding into a backup or a sync.
import * as payloadLib from '../../../api/coach/core/payload.ts';
import { runPipeline } from '../../../api/coach/core/pipeline.ts';
import { waitingProposal } from '../../../api/coach/core/pending.ts';
import { isDue } from '../../../api/coach/core/due.ts';
import { HTTP_PROVIDERS, baseUrlFor } from '../../../api/coach/core/providers.ts';
import anthropic from '../../../api/coach/core/adapters/anthropic.ts';
import openai from '../../../api/coach/core/adapters/openai.ts';
import gemini from '../../../api/coach/core/adapters/gemini.ts';
import compatible from '../../../api/coach/core/adapters/compatible.ts';
import { modelSubstitute } from '../../../api/coach/core/adapters/http.ts';
import { nativeFetch } from './capacitor-fetch.ts';
import { getApiKey } from './coach-secrets.ts';
import { loadCoachDevice, saveCoachDevice, coachLimits } from './coach-device.ts';
import { planHash } from './coach.ts';
import { todayISO } from './format.ts';
import { t, getLang } from './i18n.ts';
export const ADAPTERS: any = { anthropic, openai, gemini, compatible };
// Five minutes is right for a cloud API and wrong for a model on somebody's laptop; the
// OpenAI-compatible endpoint is the one that may be local, so it gets the long budget.
export const TIMEOUT_MS: any = 5 * 60000;
export const LOCAL_ENDPOINT_TIMEOUT_MS: any = 25 * 60000;
export const timeoutFor: any = (provider?: any) => (provider === 'compatible' ? LOCAL_ENDPOINT_TIMEOUT_MS : TIMEOUT_MS);
const PENDING_DAYS: any = 14;
const HANDLE_LENGTH: any = 16;
let job: any = null;
let lastError: any = null;
let last: any = null; // how the most recent job ended — the same shape the server's status() reports
// Reported to the screens through the same status shape the server answers with; a toast is
// also raised because on the server a failed job lands in the admin card, and here there is
// no admin card — the user is the operator.
let notify: any = null;
export function setNotifier(fn?: any) { notify = fn; }
/* ---------- what this phone is configured with ---------- */
const cfgOf: any = (d?: any) => ({ provider: d.provider, providerOptions: d.baseUrl ? { [d.provider]: { baseUrl: d.baseUrl } } : {} });
const envOf: any = (d?: any, key?: any) => (key ? { [HTTP_PROVIDERS[d.provider].apiKeyEnv]: key } : {});
function mintHandle() {
    const bytes: any = new Uint8Array(12);
    ((globalThis.crypto || {}).getRandomValues as any) ? crypto.getRandomValues(bytes) : bytes.forEach((_?: any, i?: any) => { bytes[i] = Math.floor(Math.random() * 256); });
    let bin: any = '';
    bytes.forEach((b?: any) => { bin += String.fromCharCode(b); });
    return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '').slice(0, HANDLE_LENGTH);
}
async function handle() {
    const d: any = await loadCoachDevice();
    if (d.handle && d.handle.length === HANDLE_LENGTH)
        return d.handle;
    const h: any = mintHandle();
    await saveCoachDevice({ handle: h });
    return h;
}
/* ---------- the cap ---------- */
async function capState() {
    const d: any = await loadCoachDevice();
    const today: any = todayISO();
    const used: any = d.daily && d.daily.d === today ? d.daily.n : 0;
    return { used, limit: coachLimits(d).daily };
}
async function bumpDaily() {
    const { used }: any = await capState();
    await saveCoachDevice({ daily: { d: todayISO(), n: used + 1 } });
}
/* ---------- the API surface coach-api.ts dispatches to ---------- */
export async function localStatus() {
    const d: any = await loadCoachDevice();
    if (d.pending && d.pending.expiresAt && d.pending.expiresAt < Date.now())
        await saveCoachDevice({ pending: null });
    return { job, pending: (await loadCoachDevice()).pending || null, cap: await capState(), lastError, last, maxMessageLen: coachLimits(d).maxMessageLen };
}
export const localReview: any = async (S?: any, note?: any) => {
    const d: any = await loadCoachDevice();
    return start(S, 'review', { note: note ? String(note).slice(0, coachLimits(d).maxMessageLen) : null });
};
export const localPlan: any = (S?: any, intake?: any) => start(S, 'create', { intake: intake || null });
export const localRefine: any = async (S?: any, text?: any) => {
    const d: any = await loadCoachDevice();
    const pendingCreate: any = d.pending && d.pending.kind === 'create' ? d.pending : null;
    return start(S, 'create', { refine: String(text || '').slice(0, coachLimits(d).maxMessageLen), previous: pendingCreate?.bundle || null, iteration: (pendingCreate?.iteration || 1) + 1 });
};
export const localDebrief: any = (S?: any, workoutId?: any) => start(S, 'debrief', { workoutId: workoutId || null });
export const localAsk: any = async (S?: any, text?: any, today?: any) => {
    const d: any = await loadCoachDevice();
    return start(S, 'ask', { note: String(text || '').slice(0, coachLimits(d).maxMessageLen), today: today || null });
};
/* Automatic reviews. On a server the cadence tick runs them (api/coach/cadence.ts); a phone with
   its own key has no server, and for a long time nothing ran them at all: the setting saved, the
   reviews never came (Discord, 10-19). So the phone asks the same question, with the same rule
   (core/due.ts), whenever the app is open (lib/coach-schedule.ts): right after a workout, and on
   the first open after a weekly slot. `reviewedAt` in the device file is the run marker, kept
   the way the server keeps its job history: a review the model answered counts, whether it
   proposed something, found nothing to change, or answered unusably (paid for all the same).
   Returns the started job, or null when nothing is due. Never throws: a skip is silent. */
export async function localScheduled(S?: any, now: any = new Date()) {
    const cadence: any = S?.coach?.cadence;
    if (job || !cadence || cadence === 'off' || !S?.coach?.consent?.agreedAt)
        return null;
    const d: any = await loadCoachDevice();
    if (d.mode !== 'byok' || !ADAPTERS[d.provider])
        return null;
    // A proposal nobody has answered is not replaced by the next one, as on the server.
    if (d.pending && !(d.pending.expiresAt && d.pending.expiresAt < now.getTime()))
        return null;
    const cap: any = await capState();
    if (cap.limit > 0 && cap.used >= cap.limit)
        return null;
    const tz: any = deviceZone();
    if (!isDue(S.coach, S, wallClock(now), d.reviewedAt || 0, tz))
        return null;
    try {
        return await start(S, 'review', { scheduled: true });
    }
    catch {
        return null;
    }
}
// The phone's own clock, in the shape the server's userNow() hands the tick.
export function wallClock(now?: any) {
    const p: any = (n?: any) => String(n).padStart(2, '0');
    return { date: `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`, hhmm: `${p(now.getHours())}:${p(now.getMinutes())}`, weekday: now.getDay() };
}
const deviceZone: any = () => { try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || null;
}
catch {
    return null;
} };
// A read answer gives back the proposal it was asked beside, as the server does.
export async function localResolve() {
    const d: any = await loadCoachDevice();
    await saveCoachDevice({ pending: d.pending?.kind === 'ask' ? waitingProposal(d.pending.prev) : null });
    return { ok: true };
}
export async function localForget() { job = null; lastError = null; await saveCoachDevice({ pending: null, daily: null, reviewedAt: null }); return { ok: true }; }
export async function localDisclosure() {
    const d: any = await loadCoachDevice();
    const meta: any = HTTP_PROVIDERS[d.provider] || {};
    const base: any = d.provider ? baseUrlFor(d.provider, cfgOf(d)) : '';
    return {
        provider: d.provider, providerLabel: meta.label || t('the configured AI provider'),
        categories: payloadLib.DATA_CATEGORIES, version: 1,
        // The honest difference from the self-hosted flow: it is the user's own account.
        payer: 'you', host: hostOf(base)
    };
}
/** The models the configured endpoint serves — the setup screen's list, and its reachability test. */
export async function localModels(settings?: any, key?: any) {
    const adapter: any = ADAPTERS[settings.provider];
    if (!adapter)
        return { ok: false, error: 'unknown provider', models: [] };
    return adapter.models(cfgOf(settings), envOf(settings, key), { fetch: nativeFetch, timeoutMs: 20000 });
}
const hostOf: any = (url?: any) => { try {
    return new URL(url).host;
}
catch {
    return url || '';
} };
/* ---------- running a job ---------- */
async function start(S?: any, kind?: any, opts?: any) {
    if (job)
        throw Object.assign(new Error(t('The Coach is already thinking about your training.')), { status: 409, code: 'busy' });
    if (!S?.coach?.consent?.agreedAt)
        throw Object.assign(new Error(t('The Coach needs your go-ahead first.')), { status: 403, code: 'consent' });
    const d: any = await loadCoachDevice();
    const adapter: any = ADAPTERS[d.provider];
    if (d.mode !== 'byok' || !adapter)
        throw Object.assign(new Error(t('The Coach isn’t set up on this phone.')), { status: 503, code: 'off' });
    const cap: any = await capState();
    // 0 is the documented "no limit" (the dial's own floor), same as the instance cap.
    if (cap.limit > 0 && cap.used >= cap.limit)
        throw Object.assign(new Error(t('The Coach is taking a breather. You’ve used today’s {0} runs on this phone.', cap.limit)), { status: 429, code: 'cap' });
    await bumpDaily();
    job = { id: 'local-' + Date.now().toString(36), kind, state: 'running', startedAt: Date.now(), ...(opts.scheduled ? { trigger: 'scheduled' } : {}) };
    lastError = null;
    // Not awaited: the screens poll, exactly as they do against a server.
    run(S, kind, opts, d, adapter).catch((e?: any) => { lastError = { errorClass: 'internal', detail: String(e && e.message || e) }; }).finally(() => { job = null; });
    return { job };
}
async function run(S?: any, kind?: any, opts?: any, d?: any, adapter?: any) {
    const key: any = await getApiKey();
    const payload: any = payloadLib.build(S, {
        handle: await handle(), kind, intake: opts.intake, note: opts.note, refine: opts.refine, previous: opts.previous, workoutId: opts.workoutId, today: opts.today,
        lang: getLang() // what the app shows, which a profile that never picked a language does not store (#303)
    });
    const model: any = d.model || HTTP_PROVIDERS[d.provider].defaultModel;
    const attempt: any = await runPipeline({
        adapter, cfg: cfgOf(d), kind, payload,
        model, timeoutMs: timeoutFor(d.provider),
        invokeOpts: { env: envOf(d, key), fetch: nativeFetch, maxTokens: coachLimits(d).maxOutputTokens }
    });
    // The saved model was refused and another one answered (#758): keep that one, so the next
    // launch does not pay for the same 404 again. The setup screen shows the new name.
    const swapped: any = model && modelSubstitute(d.provider, cfgOf(d), model);
    if (swapped && swapped !== d.model)
        await saveCoachDevice({ model: swapped });
    if (!attempt.ok) {
        // There is no admin card on a phone, so the reason has to reach the person holding it:
        // the provider's own words for a refusal, the validator's for an answer that did not fit.
        const detail: any = attempt.detail || (Array.isArray(attempt.errors) && attempt.errors.length
            ? attempt.errors.slice(0, 3).map(String).join(' · ').slice(0, 300)
            : null);
        lastError = { errorClass: attempt.errorClass, detail };
        last = { id: job.id, kind, outcome: 'failed', errorClass: attempt.errorClass, at: Date.now() };
        if (kind === 'review' && attempt.errorClass === 'unusable')
            await markReviewed();
        if (notify)
            notify({ kind: 'failed', errorClass: attempt.errorClass, detail, scheduled: !!opts.scheduled });
        return;
    }
    if (attempt.nochange) {
        last = { id: job.id, kind, outcome: 'nochange', errorClass: null, at: Date.now(), reading: attempt.reading };
        if (kind === 'review')
            await markReviewed();
        if (notify)
            notify({ kind: 'nochange', reading: attempt.reading, scheduled: !!opts.scheduled });
        return;
    }
    const pending: any = {
        id: job.id, kind, createdAt: Date.now(), expiresAt: Date.now() + PENDING_DAYS * 86400000,
        planHash: planHash(S), iteration: opts.iteration || 1,
        ...(kind === 'debrief' ? { workout: workoutMetaOf(S, opts.workoutId) } : {}),
        ...(kind === 'ask' ? { prev: waitingProposal((await loadCoachDevice()).pending) } : {}),
        ...attempt.result
    };
    await saveCoachDevice({ pending, ...(kind === 'review' ? { reviewedAt: Date.now() } : {}) });
    last = { id: job.id, kind, outcome: 'ready', errorClass: null, at: Date.now() };
    if (notify)
        notify({ kind: 'ready', pending, scheduled: !!opts.scheduled });
}
// Any review the model read counts as the latest one, asked for or scheduled, as on the server.
const markReviewed: any = () => saveCoachDevice({ reviewedAt: Date.now() });
// The session a debrief is about, in the shape the card reads. The core builds it for the
// server; the fallback covers a core that predates it.
function workoutMetaOf(S?: any, workoutId?: any) {
    if (typeof payloadLib.workoutMeta === 'function')
        return payloadLib.workoutMeta(S, workoutId);
    const all: any = (S.workouts || []).filter((w?: any) => w && w.d);
    const w: any = all.find((x?: any) => x.id === workoutId) || all[all.length - 1];
    return w ? { id: w.id, d: w.d, name: w.name || null } : null;
}
// Test seam.
export function _resetLocal() { job = null; lastError = null; last = null; }
