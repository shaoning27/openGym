// Legacy dynamic types are explicit during the full language migration.
/* Running Coach jobs, and owning their results.
 *
 * Why the server owns proposals instead of the synced state blob: a client PUTs its whole
 * state and the newest `_ts` wins. A scheduled review that wrote its proposal in there would
 * be erased without trace by the next device to sync an older copy. So the proposal lives
 * here, in a file this server alone writes, until the user decides what to do with it — at
 * which point the *client* applies it to the plan and the outcome joins the synced log, which
 * is exactly where an audit trail belongs.
 *
 * Everything here is deliberately in-process and file-backed. A single-core box running one
 * household's gym app does not need a job queue with a broker; it needs jobs that cannot pile
 * up, cannot run forever, and cannot lie about what happened when the container restarts.
 */
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import * as cfgStore from './config.ts';
import { adapterFor } from './adapters/index.ts';
import * as payloadLib from './core/payload.ts';
import { runPipeline } from './core/pipeline.ts';
import { extractJSON } from './core/parse.ts';
import { hashPlan } from './core/plan-hash.ts';
import { buildPrompt } from './core/prompt.ts';
import { waitingProposal } from './core/pending.ts';
import { handleFor } from './handle.ts';
import { fetchFor } from './node-fetch.ts';
import { privilegeRefusal, unprivilegedIds } from './adapters/spawn.ts';
import { cohortForPayload, invalidate as invalidateCohort } from './cohort.ts';
// The prompt assembly, the plan fingerprint and the invoke→parse→validate→repair loop all
// live in ./core now, where the phone can import them too. Re-exported so nothing that
// reached them through this module has to move.
export { hashPlan, buildPrompt };
const DATA: any = process.env.DATA_DIR || '/data';
const COACH_DIR: any = path.join(DATA, 'coach');
// Five minutes by default. A local model on a small CPU box can legitimately need more; a
// cloud API that needs more has a problem. COACH_JOB_TIMEOUT_MS overrides, never below one minute.
export const TIMEOUT_MS: any = Math.max(60000, Number(process.env.COACH_JOB_TIMEOUT_MS) || 5 * 60000);
const MAX_CONCURRENT: any = 2; // these are minutes-scale jobs on often-single-core boxes
const PENDING_DAYS: any = 14; // FR-33
const HISTORY_MAX: any = 20;
/* ---------- per-user store ---------- */
const safe: any = (uid?: any) => String(uid).replace(/[^a-zA-Z0-9_-]/g, '');
const userFile: any = (uid?: any) => path.join(COACH_DIR, safe(uid) + '.json');
const EMPTY: any = { daily: null, current: null, pending: null, history: [] };
export function readUser(uid?: any) {
    try {
        return { ...EMPTY, ...JSON.parse(fs.readFileSync(userFile(uid), 'utf8')) };
    }
    catch {
        return { ...EMPTY };
    }
}
function writeUser(uid?: any, rec?: any) {
    fs.mkdirSync(COACH_DIR, { recursive: true, mode: 0o700 });
    const file: any = userFile(uid), tmp: any = file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(rec), { mode: 0o600 });
    fs.renameSync(tmp, file);
}
function patchUser(uid?: any, patch?: any) {
    const rec: any = { ...readUser(uid), ...patch };
    writeUser(uid, rec);
    return rec;
}
/** Consent revoked, profile deleted, "reset everything" — no server-side residue (FR-51).
 *  Today's job count is the one thing that stays: it is the spending record the daily cap
 *  reads, not the profile's data, and forgetting must not hand out a fresh cap; the record
 *  outlives the day only until the next job or forget touches it, and counts for nothing once
 *  the date has passed. A job still waiting in the queue is dropped here; one already mid-call
 *  is cancelled where the adapter can be (the HTTP ones — a spawned runtime runs to its end),
 *  and either way finishes without writing anything back (see finish). */
export function clearUser(uid?: any) {
    const { daily }: any = readUser(uid);
    try {
        fs.unlinkSync(userFile(uid));
    }
    catch { /* nothing to clear */ }
    if (daily?.date === todayISO())
        writeUser(uid, { ...EMPTY, daily });
    const queued: any = queue.findIndex((j?: any) => j.uid === uid);
    if (queued >= 0) {
        queue.splice(queued, 1);
        inflight.delete(uid);
    }
    aborts.get(uid)?.abort();
    forgetSeq.set(uid, (forgetSeq.get(uid) || 0) + 1);
    invalidateCohort();
}
/** Every profile with a state file — the population a cohort is drawn from. */
export function listUserIds() {
    try {
        return fs.readdirSync(DATA).filter((f?: any) => /^state-[a-zA-Z0-9_-]+\.json$/.test(f)).map((f?: any) => f.slice(6, -5));
    }
    catch {
        return [];
    }
}
/* ---------- "compare with others" opt-in ----------
   Held here, in the server's own per-profile record, rather than in the synced state: the
   flag decides whether this person's numbers reach other people, and a stale device syncing
   an older copy of S must not be able to flip it back on. */
export const isSharing: any = (uid?: any) => !!readUser(uid).share;
export function setShare(uid?: any, share?: any) {
    patchUser(uid, { share: !!share });
    invalidateCohort();
    return !!share;
}
export function readState(uid?: any) {
    try {
        return JSON.parse(fs.readFileSync(path.join(DATA, 'state-' + safe(uid) + '.json'), 'utf8'));
    }
    catch {
        return null;
    }
}
/* ---------- caps ---------- */
const todayISO: any = () => new Date().toISOString().slice(0, 10);
function bumpDaily(uid?: any) {
    const rec: any = readUser(uid);
    const d: any = todayISO();
    const daily: any = rec.daily?.date === d ? { date: d, count: rec.daily.count + 1 } : { date: d, count: 1 };
    patchUser(uid, { daily });
    return daily.count;
}
export function capState(uid?: any) {
    const caps: any = cfgStore.load().caps || {};
    const rec: any = readUser(uid);
    const used: any = rec.daily?.date === todayISO() ? rec.daily.count : 0;
    return { used, limit: caps.perProfileDaily || 0 };
}
// The instance-wide count is kept the same way in coach.json, not read off the job log: the
// log keeps its last hundred entries, and a count that stops at a hundred is not a cap.
function bumpInstanceDaily() {
    const cur: any = cfgStore.load().daily;
    const d: any = todayISO();
    cfgStore.save({ daily: cur?.date === d ? { date: d, count: cur.count + 1 } : { date: d, count: 1 } });
}
function instanceUsedToday() {
    const daily: any = cfgStore.load().daily;
    return daily?.date === todayISO() ? daily.count : 0;
}
/* ---------- status ---------- */
/** What the client polls. Expiry is enforced lazily here rather than on a timer. */
export function status(uid?: any) {
    const rec: any = readUser(uid);
    if (rec.pending && rec.pending.expiresAt && rec.pending.expiresAt < Date.now()) {
        archive(uid, rec, 'expired');
        // Same shape as every other answer: the poll that happens to be the one which expires a
        // proposal must not be the one where the client's cap readout goes undefined.
        return { job: null, pending: null, cap: capState(uid) };
    }
    return {
        job: rec.current ? { id: rec.current.id, kind: rec.current.kind, state: rec.current.state, startedAt: rec.current.startedAt } : null,
        pending: rec.pending || null,
        cap: capState(uid),
        // How the most recent job ended, so the chat can say "nothing to change" or "that failed"
        // in the Coach's own bubble rather than leaving a job that silently stopped appearing.
        last: lastOutcome(rec)
    };
}
function lastOutcome(rec?: any) {
    const h: any = (rec.history || []).at(-1);
    return h ? { id: h.id, kind: h.kind, outcome: h.outcome, errorClass: h.errorClass || null, at: h.at, ...(h.trigger === 'scheduled' ? { trigger: 'scheduled' } : {}), ...(h.reading ? { reading: h.reading } : {}) } : null;
}
function archive(uid?: any, rec?: any, outcome?: any) {
    const history: any = [...(rec.history || []), {
            id: rec.pending?.id, kind: rec.pending?.kind, outcome, at: Date.now()
        }].slice(-HISTORY_MAX);
    patchUser(uid, { pending: null, history });
}
/* ---------- the queue ---------- */
const queue: any = [];
let running: any = 0;
const inflight: any = new Set(); // uids with a job queued or running (FR-07 single-flight)
const forgetSeq: any = new Map(); // uid → bumped by every clearUser; a job carries the value it saw at enqueue
const aborts: any = new Map(); // uid → AbortController of the provider call in flight, for clearUser to pull
class CoachError extends Error {
    [key: string]: any;
    constructor(code?: any, message?: any) { super(message); this.code = code; }
}
export { CoachError };
/**
 * Clamp a free-text note/refine message to the admin's configured `maxMessageLen` (issue #267).
 * The one place this is enforced — `routes.ts` only applies a generous sanity ceiling before a
 * string reaches here, and `payload.ts`'s own bound exists purely so a caller that skips this
 * module (coach-local.ts's in-process pipeline) still has a limit. Exported so the clamp itself
 * is directly testable without walking the whole enqueue → execute pipeline.
 */
export function clampMessage(text?: any) {
    if (!text)
        return null;
    const max: any = cfgStore.load().maxMessageLen || 1000;
    return String(text).slice(0, max);
}
/**
 * Enqueue a job. Throws CoachError with a code the routes layer maps to an HTTP status:
 * `off`, `busy`, `cap`, `consent`.
 */
export function enqueue(uid?: any, opts?: any) {
    if (!cfgStore.isEnabled() || !cfgStore.isConnected())
        throw new CoachError('off', 'the Coach is not set up on this instance');
    if (inflight.has(uid))
        throw new CoachError('busy', 'the Coach is already thinking about your training');
    const S: any = readState(uid);
    // Consent is enforced here, server-side, not by the screen that collects it: a UI-only gate
    // is not a gate (FR-08/13).
    if (!S?.coach?.consent?.agreedAt)
        throw new CoachError('consent', 'the Coach needs your go-ahead first');
    // Whose account pays. In instance mode the credential binds to the first profile that spends
    // it and every other profile is refused outright — not warned. A warning would move the
    // decision onto whoever clicks past it, and the decision is about spending somebody else's
    // personal subscription.
    const cred: any = cfgStore.credentialFor(uid);
    if (!cred.ok) {
        if (cred.reason === 'shared-account')
            throw new CoachError('shared', cred.message);
        throw new CoachError('off', 'this profile has no provider account connected');
    }
    // The privilege drop is what keeps a provider runtime out of ./data. If it cannot be
    // performed, there is no job — see canDropPrivileges for why this is not a warning either.
    // A provider that spawns nothing has no process to drop, and is not refused for it.
    // Asked before the bind below: a job refused here spends nothing, so it must not bind.
    const refusal: any = privilegeRefusal(adapterFor(cfgStore.load().provider));
    if (refusal)
        throw new CoachError('unprivileged', refusal);
    // The caps, before the bind for the same reason: a job refused for the day spends nothing.
    const caps: any = cfgStore.load().caps || {};
    const { used, limit }: any = capState(uid);
    if (limit > 0 && used >= limit)
        throw new CoachError('cap', 'daily limit reached');
    if (caps.instanceDaily > 0 && instanceUsedToday() >= caps.instanceDaily)
        throw new CoachError('cap', 'this instance has reached its daily limit');
    // Spending is what binds: a personal credential (setup token, OAuth) belongs to the first
    // profile that runs a job on it from here on; an API key binds to nobody and is shared.
    cfgStore.bindInstanceCredential(uid);
    // Counted at enqueue, not at completion: the cap exists to bound what one profile can spend
    // of the owner's provider account, and queueing twenty jobs spends it whether or not the
    // twentieth ever finishes.
    bumpDaily(uid);
    bumpInstanceDaily();
    const job: any = {
        id: crypto.randomBytes(8).toString('hex'),
        uid,
        forgetSeq: forgetSeq.get(uid) || 0,
        kind: opts.kind, // 'create' | 'review' | 'debrief' | 'ask'
        trigger: opts.trigger || 'manual', // 'manual' | 'scheduled'
        workoutId: opts.workoutId ? String(opts.workoutId).slice(0, 40) : null,
        intake: opts.intake || null,
        note: clampMessage(opts.note),
        refine: clampMessage(opts.refine),
        // A question's running session, sent by the phone (the server never holds `active`). Kept on
        // the in-memory job only, never in the user's file; the payload builder bounds it.
        today: opts.kind === 'ask' && opts.today && typeof opts.today === 'object' ? opts.today : null,
        lang: payloadLib.langTag(opts.lang), // the language the app was showing (#303)
        state: 'queued',
        startedAt: Date.now()
    };
    inflight.add(uid);
    patchUser(uid, { current: { id: job.id, kind: job.kind, state: 'queued', startedAt: job.startedAt } });
    queue.push(job);
    pump();
    return { id: job.id };
}
function pump() {
    while (running < MAX_CONCURRENT && queue.length) {
        const job: any = queue.shift();
        running++;
        execute(job)
            .catch((e?: any) => { console.error('coach job crashed', job.id, e); finish(job, { outcome: 'failed', errorClass: 'internal' }); })
            .finally(() => { running--; inflight.delete(job.uid); pump(); });
    }
}
/* Why an answer was rejected, for the admin card. "Couldn't use" with no reason left people
   guessing whether the model, the key or the app was at fault. The validator's own lines say
   which rule broke; quoted values are cut out, because they can carry a routine name or other
   words from the person's plan, and the instance log carries outcomes, not content (FR-12/42). */
export function whyUnusable(errors?: any) {
    if (!Array.isArray(errors) || !errors.length)
        return null;
    return errors.slice(0, 3).map((e?: any) => String(e).replace(/"[^"]*"/g, '"…"')).join('; ').slice(0, 300);
}
function finish(job?: any, result?: any) {
    cfgStore.logJob({
        at: new Date().toISOString(), uid: job.uid, kind: job.kind, trigger: job.trigger,
        outcome: result.outcome, errorClass: result.errorClass || null,
        ms: Date.now() - job.startedAt, detail: result.detail || null
    });
    // Forgotten while it ran: the record is gone and stays gone, and nobody is notified. The
    // job still ran and still spent, which is why the instance log above keeps its line.
    if ((forgetSeq.get(job.uid) || 0) !== job.forgetSeq)
        return;
    const rec: any = readUser(job.uid);
    const history: any = [...(rec.history || []), {
            id: job.id, kind: job.kind, trigger: job.trigger, outcome: result.outcome,
            errorClass: result.errorClass || null, at: Date.now(),
            // "Nothing to change" is an answer with a reason attached, and throwing the reason away
            // leaves the user with a job that finished and nothing to show for it. It lives here, in
            // the profile's own file — deliberately not in `detail`, which goes to the instance log
            // the admin card renders, and which carries counts and outcomes only (FR-12/42).
            ...(result.reading ? { reading: String(result.reading).slice(0, 1200) } : {})
        }].slice(-HISTORY_MAX);
    writeUser(job.uid, {
        ...rec,
        current: null,
        pending: result.pending !== undefined ? result.pending : rec.pending,
        history
    });
    if (result.outcome === 'ready' && onProposal) {
        try {
            onProposal(job.uid, result.pending, job);
        }
        catch (e: any) {
            console.error('coach notify failed', e);
        }
    }
}
// Set by server.ts so a finished job can raise a push notification without this module
// importing the web-push plumbing (and dragging it into every test that touches the queue).
let onProposal: any = null;
export function setProposalHook(fn?: any) { onProposal = fn; }
/* ---------- execution ---------- */
async function execute(job?: any) {
    patchUser(job.uid, { current: { id: job.id, kind: job.kind, state: 'running', startedAt: job.startedAt } });
    const S: any = readState(job.uid);
    if (!S)
        return finish(job, { outcome: 'failed', errorClass: 'nostate' });
    // Checked again here, not only at enqueue: a job can wait behind two others, and consent
    // withdrawn or the Coach switched off in the meantime means no payload leaves for it.
    if (!S.coach?.consent?.agreedAt)
        return finish(job, { outcome: 'failed', errorClass: 'consent' });
    if (!cfgStore.isEnabled())
        return finish(job, { outcome: 'failed', errorClass: 'off' });
    const cfg: any = cfgStore.load();
    const adapter: any = adapterFor(cfg.provider);
    if (!adapter)
        return finish(job, { outcome: 'failed', errorClass: 'off' });
    // The gate again, for the provider this job actually runs on: enqueue asked about the one
    // configured then, and a job that waited behind two others would otherwise spawn without the
    // drop if the admin had switched from an HTTPS provider to a runtime-backed one meanwhile.
    const refusal: any = privilegeRefusal(adapter);
    if (refusal)
        return finish(job, { outcome: 'failed', errorClass: 'unprivileged', detail: refusal });
    if (job.kind === 'debrief' && !payloadLib.findWorkout(S, job.workoutId)) {
        return finish(job, { outcome: 'failed', errorClass: 'noworkout' });
    }
    const pendingCreate: any = job.refine ? readUser(job.uid).pending : null;
    const payload: any = payloadLib.build(S, {
        handle: handleFor(job.uid),
        kind: job.kind,
        intake: job.intake,
        note: job.note,
        refine: job.refine,
        previous: pendingCreate?.bundle || null,
        workoutId: job.workoutId,
        today: job.today,
        // The app says which language it is in. A scheduled review has no app behind it: a profile
        // that never picked a language then gets the instance's DEFAULT_LANG, like its screens do.
        lang: job.lang || (S.langAuto === true ? payloadLib.langTag(process.env.DEFAULT_LANG) : null),
        // The room's medians ride along on a review or a debrief when the admin allows it and
        // this person opted in; null otherwise, and the payload then carries no `cohort` at all.
        cohort: (job.kind === 'review' || job.kind === 'debrief') ? cohortForPayload(job.uid) : null
    });
    // The payload is paid for with the instance's key, and it is built from state the client
    // wrote. The builder bounds each field; a payload that is still bigger than any real training
    // history makes is refused here, before a provider is called, rather than sent and billed.
    const size: any = JSON.stringify(payload).length;
    if (size > payloadLib.MAX_PAYLOAD_CHARS) {
        return finish(job, { outcome: 'failed', errorClass: 'toolarge', detail: `payload of ${Math.round(size / 1000)}k characters` });
    }
    // An HTTPS provider has no child process, so no directory for one to live in either.
    const jobDir: any = adapter.spawns === false ? null : fs.mkdtempSync(path.join(os.tmpdir(), 'coach-'));
    const env: any = cfgStore.jobEnv(jobDir || os.tmpdir(), cfgStore.credentialFor(job.uid));
    const ctl: any = new AbortController();
    aborts.set(job.uid, ctl);
    try {
        const ids: any = jobDir && unprivilegedIds();
        if (ids)
            shareJobDir(jobDir, ids);
        const attempt: any = await runPipeline({
            adapter, cfg, kind: job.kind, payload, model: cfgStore.modelFor(cfg), timeoutMs: TIMEOUT_MS,
            // The HTTP adapters take the fetch and the abort signal they are given; the runtime
            // adapters ignore both.
            invokeOpts: { jobDir, env, fetch: fetchFor(TIMEOUT_MS), signal: ctl.signal, maxTokens: cfg.maxOutputTokens }
        });
        if (!attempt.ok) {
            // Cancelled by a forget, not failed by the provider: the log must not blame the job budget.
            const errorClass: any = ctl.signal.aborted ? 'forgotten' : attempt.errorClass;
            return finish(job, { outcome: 'failed', errorClass, detail: attempt.detail || whyUnusable(attempt.errors) });
        }
        if (attempt.nochange) {
            return finish(job, { outcome: 'nochange', pending: null, detail: null, reading: attempt.reading });
        }
        const pending: any = {
            id: job.id,
            kind: job.kind,
            createdAt: Date.now(),
            expiresAt: Date.now() + PENDING_DAYS * 86400000,
            planHash: hashPlan(payloadLib.canonicalPlan(S)),
            iteration: job.refine ? (pendingCreate?.iteration || 1) + 1 : 1,
            // Nobody asked for a scheduled one, so nobody is watching for it: a phone app has no web
            // push, and says so itself when it next comes to the foreground (lib/coach-schedule.ts).
            ...(job.trigger === 'scheduled' ? { trigger: 'scheduled' } : {}),
            // A debrief names the session it read, so the card can show it after the fact.
            ...(job.kind === 'debrief' ? { workout: payloadLib.workoutMeta(S, job.workoutId) } : {}),
            ...(job.kind === 'ask' ? { prev: waitingProposal(readUser(job.uid).pending) } : {}),
            ...attempt.result
        };
        return finish(job, { outcome: 'ready', pending });
    }
    finally {
        aborts.delete(job.uid);
        if (jobDir)
            removeJobDir(jobDir, unprivilegedIds());
    }
}
/* ---------- decisions ---------- */
/** The client has applied (or discarded) the pending proposal. Record it and clear. */
export function resolvePending(uid?: any, { accepted = [], rejected = [], dismissed = false }: any = {}) {
    const rec: any = readUser(uid);
    if (!rec.pending)
        return { ok: true };
    const history: any = [...(rec.history || []), {
            id: rec.pending.id, kind: rec.pending.kind,
            outcome: dismissed ? 'dismissed' : 'applied',
            accepted: accepted.length, rejected: rejected.length, at: Date.now()
        }].slice(-HISTORY_MAX);
    // A read answer gives back the proposal it was asked beside (core/pending.ts).
    const back: any = rec.pending.kind === 'ask' ? waitingProposal(rec.pending.prev) : null;
    writeUser(uid, { ...rec, pending: back, history });
    return { ok: true };
}
/* ---------- admin test + boot recovery ---------- */
/** A2's "Test the Coach": the real adapter, a trivial round-trip, no user data anywhere near it. */
/* Give the unprivileged `coach` user its job directory without locking this process out of it.
 *
 * The obvious move is chown(jobDir, coach) — and it breaks the spawn outright. libuv chdir()s
 * into cwd BEFORE it drops to the child's uid, so the parent still has to be able to enter the
 * directory it just gave away; mkdtemp creates 0700, and a container started with `drop: [ALL]`
 * has no CAP_DAC_OVERRIDE for root to ignore that with. The child never starts and node reports
 * EACCES, which the Agent SDK renders as "the native binary failed to launch … does not match
 * this system's libc" — a guess, and a misleading one.
 *
 * So the directory stays owned by this process and `coach` reaches it through the group: 0770
 * with the coach gid. The child can write, the parent can still chdir and still clean up
 * afterwards, and nobody else on the container can read it. chmod before chown, while this
 * process is still the owner — CAP_FOWNER is not in the capability set either.
 */
function shareJobDir(jobDir?: any, ids?: any) {
    fs.chmodSync(jobDir, 0o770);
    fs.chownSync(jobDir, process.getuid ? process.getuid() : 0, ids.gid);
}
/* Remove a job directory whose contents belong to somebody else.
 *
 * The child writes as `coach` and its own directories come out 0700/0755 coach-owned — this
 * process cannot unlink inside them without CAP_DAC_OVERRIDE, which is the same capability the
 * handover above is written to avoid needing. Left to `fs.rmSync` it throws EACCES from a
 * `finally`, turning a completed run into a failed one.
 *
 * So the child's user clears its own files, and this process removes the directory it still
 * owns. Best effort throughout: a leaked temp directory is a worse outcome than a failed job
 * only in the sense that it is not one.
 */
function removeJobDir(jobDir?: any, ids?: any) {
    if (ids) {
        try {
            const mine: any = fs.readdirSync(jobDir).map((n?: any) => path.join(jobDir, n));
            // argv array, no shell — the same rule the provider spawn follows, and these paths are
            // this module's own mkdtemp output rather than anything a user chose.
            if (mine.length)
                spawnSync('/bin/rm', ['-rf', ...mine], { uid: ids.uid, gid: ids.gid, stdio: 'ignore' });
        }
        catch { /* fall through: the removal below is still worth attempting */ }
    }
    try {
        fs.rmSync(jobDir, { recursive: true, force: true });
    }
    catch { /* leaked, not fatal */ }
}
export async function testRun() {
    const cfg: any = cfgStore.load();
    const adapter: any = adapterFor(cfg.provider);
    if (!adapter)
        return { ok: false, error: 'no provider configured' };
    // The same gate as enqueue: this spawns the runtime a job would, and without the drop the
    // child runs as this process and can read ./data.
    const refusal: any = privilegeRefusal(adapter);
    if (refusal)
        return { ok: false, error: refusal };
    const jobDir: any = adapter.spawns === false ? null : fs.mkdtempSync(path.join(os.tmpdir(), 'coach-test-'));
    try {
        // No user asked for this, so there is no profile whose account is being spent. In instance
        // mode that is the bound profile's credential — the one the round-trip is meant to prove —
        // and in per-profile mode it is nobody's, which is the honest answer: an admin cannot test
        // a credential that belongs to a profile.
        const env: any = cfgStore.jobEnv(jobDir || os.tmpdir(), cfgStore.credentialFor(cfgStore.boundUidFor(cfg)));
        const ids: any = jobDir && unprivilegedIds();
        if (ids)
            shareJobDir(jobDir, ids);
        const check: any = await adapter.check(cfg, env);
        if (!check.ok)
            return { ok: false, error: check.error || 'the provider runtime could not be run' };
        const r: any = await adapter.invoke({
            cfg, jobDir, env, model: cfgStore.modelFor(cfg), timeoutMs: 90000, fetch: fetchFor(90000),
            prompt: 'Reply with exactly this JSON object and nothing else: {"coach_contract":1,"ok":true}'
        });
        if (r.timedOut)
            return { ok: false, version: check.version, error: 'the provider did not answer in time' };
        if (r.code !== 0) {
            const err: any = (r.stderr || r.text || '').trim();
            return { ok: false, version: check.version, error: err.slice(0, 300) || 'the provider runtime exited with an error' };
        }
        const parsed: any = extractJSON(r.text);
        if (parsed.error || !parsed.value?.ok) {
            return { ok: false, version: check.version, error: 'the provider answered, but not in the expected shape' };
        }
        return { ok: true, version: check.version };
    }
    finally {
        if (jobDir)
            removeJobDir(jobDir, unprivilegedIds());
    }
}
/**
 * A job that was running when the process died is not coming back. Say so plainly and let the
 * user retry, rather than leaving a spinner that never resolves or silently re-running work
 * that may already have cost them a provider call.
 */
export function recoverOnBoot() {
    let n: any = 0;
    try {
        for (const f of fs.readdirSync(COACH_DIR)) {
            if (!f.endsWith('.json'))
                continue;
            const uid: any = f.replace(/\.json$/, '');
            const rec: any = readUser(uid);
            if (!rec.current)
                continue;
            writeUser(uid, {
                ...rec, current: null,
                history: [...(rec.history || []), { id: rec.current.id, kind: rec.current.kind, outcome: 'failed', errorClass: 'restart', at: Date.now() }].slice(-HISTORY_MAX)
            });
            n++;
        }
    }
    catch { /* no coach dir yet */ }
    if (n)
        console.log(`coach: cleared ${n} job(s) interrupted by restart`);
    return n;
}
