// Legacy dynamic types are explicit during the full language migration.
/* Running a provider CLI as a child process, with the blast radius kept small.
 *
 * Three things matter here and none of them are about convenience:
 *   · no shell, ever — argv is an array, and the user's free text never reaches it anyway
 *     (it travels inside the payload file, as JSON data)
 *   · the environment is built from nothing rather than inherited, so the child cannot read
 *     RP_ID, ADMIN_UIDS, VAPID keys or anything else this process holds
 *   · the child runs as an unprivileged user (created in the Dockerfile) whose uid cannot
 *     read ./data, so a CLI that decided to go looking finds nothing to find
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
// Resolved once: the container creates a `coach` user, but a bare `node server.ts` on a
// developer's laptop has no such user and must still work.
let coachIds: any = null;
let resolved: any = false;
export function unprivilegedIds() {
    if (resolved)
        return coachIds;
    resolved = true;
    coachIds = null;
    try {
        const passwd: any = fs.readFileSync('/etc/passwd', 'utf8');
        const line: any = passwd.split('\n').find((l?: any) => l.startsWith('coach:'));
        if (line && process.getuid && process.getuid() === 0) {
            const [, , uid, gid]: any = line.split(':');
            coachIds = { uid: +uid, gid: +gid };
        }
    }
    catch { /* not linux, or no passwd file — see canDropPrivileges */ }
    return coachIds;
}
/**
 * Whether a job may run at all, privilege-wise.
 *
 * The drop is the control that keeps a provider runtime out of ./data, and it used to switch
 * itself off silently: `unprivilegedIds()` only returns ids when the server is root, so adding
 * an ordinary `USER node` line to the Dockerfile — a hardening change, made for unrelated
 * reasons — would have left the runtime inheriting the server's uid with nothing to say so.
 * A control that disappears during someone else's refactor is one you find out about late.
 *
 * So on Linux it fails closed: no drop, no job. Elsewhere (a developer's macOS laptop, where
 * there is no `coach` user and no container boundary either) it stays permissive, because the
 * alternative is that the test suite and local development simply stop working.
 *
 * "Elsewhere" does not include CI, which is Linux, runs as an ordinary user and has no `coach`
 * user — so the honest answer there is `false`, and every test that needs to reach the code
 * behind the drop has to say so explicitly. That is what the seam below is for: the suite sets
 * the verdict it wants to test against, including the refusal itself, instead of inheriting
 * whatever the host it happens to run on would have said.
 */
let forced: any = null;
/** Test-only. Pass a verdict to pin it, or null to go back to asking the host. */
export function forcePrivilegeVerdict(v?: any) { forced = v; }
export function canDropPrivileges() {
    if (forced)
        return forced;
    if (process.platform !== 'linux')
        return { ok: true, dropped: false, why: 'not linux — development host' };
    if (unprivilegedIds())
        return { ok: true, dropped: true, why: null };
    if (process.getuid && process.getuid() !== 0) {
        return { ok: false, dropped: false, why: 'the server is not running as root, so Coach jobs cannot drop to the unprivileged user' };
    }
    return { ok: false, dropped: false, why: 'no `coach` user exists in this image' };
}
/**
 * The gate every path that may start a provider runtime goes through — a job, the admin's test
 * run, and the admin card's version check — so the three cannot drift apart. Returns the
 * refusal, worded the same everywhere, or null when the adapter may run. A provider that spawns
 * nothing has no process to drop and is never refused for lacking the drop.
 */
export function privilegeRefusal(adapter?: any) {
    if (adapter?.spawns === false)
        return null;
    const priv: any = canDropPrivileges();
    return priv.ok ? null : `Coach jobs are disabled: ${priv.why}`;
}
/**
 * Run `cmd argv`, feed `stdin`, resolve { code, stdout, stderr, timedOut }.
 * Never rejects on a non-zero exit: the caller classifies failures, and a CLI that prints a
 * useful error and exits 1 is more informative than a thrown Error with none of it.
 */
export function run(cmd?: any, argv?: any, { stdin = '', env = {}, cwd, timeoutMs = 300000, asCoach = true }: any = {}) {
    return new Promise((resolve?: any) => {
        const ids: any = asCoach ? unprivilegedIds() : null;
        let child: any;
        try {
            child = spawn(cmd, argv, { cwd, env, stdio: ['pipe', 'pipe', 'pipe'], ...(ids || {}) });
        }
        catch (e: any) {
            resolve({ code: -1, stdout: '', stderr: e.message, spawnError: true });
            return;
        }
        let stdout: any = '', stderr: any = '', timedOut: any = false, done: any = false;
        // Output is bounded: a CLI stuck in a loop must not take the server's memory with it.
        const CAP: any = 4 * 1024 * 1024;
        const timer: any = setTimeout(() => { timedOut = true; child.kill('SIGKILL'); }, timeoutMs);
        child.stdout.on('data', (d?: any) => { if (stdout.length < CAP)
            stdout += d; });
        child.stderr.on('data', (d?: any) => { if (stderr.length < CAP)
            stderr += d; });
        const finish: any = (code?: any, err?: any) => {
            if (done)
                return;
            done = true;
            clearTimeout(timer);
            resolve({ code, stdout, stderr: stderr || (err ? err.message : ''), timedOut, spawnError: !!err });
        };
        child.on('error', (e?: any) => finish(-1, e));
        child.on('close', (code?: any) => finish(code));
        try {
            child.stdin.end(stdin);
        }
        catch { /* child already gone; 'close' handles it */ }
    });
}
