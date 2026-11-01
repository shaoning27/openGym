// Legacy dynamic types are explicit during the full language migration.
/* The server's local admin socket (#584): how `node recover.ts <name>` asks the running server for
 * a recovery code.
 *
 * Why a socket and not the file: the server keeps db.json in memory and writes all of it on every
 * change (saveDb). A second process editing db.json while the server runs would be overwritten by
 * the next save, or overwrite one the server just made. So the command never touches the data: it
 * asks the server, which makes the code through the same code path an admin's request takes, in
 * its own memory, and saves and audits it like any other change.
 *
 * Who may ask: whoever can open the socket. It is a Unix socket in a directory only this process's
 * user can enter (0700, checked: ours, not a symlink, nobody else's bits), the socket itself 0600.
 * In the Docker image that is root, which is who `docker compose exec api` runs as; the Coach's
 * jobs run as their own unprivileged user and cannot reach it, any more than they can read /data.
 * Being able to reach it is being able to read db.json anyway. Nothing listens on the network.
 *
 * The path is derived from the data directory, so two instances on one machine do not meet, and
 * recover.ts finds it from the same environment the server has (DATA_DIR, or ADMIN_SOCKET_DIR).
 */
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
const MAX_LINE: any = 4096;
/** The directory the socket lives in: ADMIN_SOCKET_DIR, else a per-user, per-data-dir one in the temp dir. */
export function socketDir(env: any = process.env) {
    if (env.ADMIN_SOCKET_DIR)
        return env.ADMIN_SOCKET_DIR;
    const data: any = path.resolve(env.DATA_DIR || '/data');
    const tag: any = crypto.createHash('sha256').update(data).digest('hex').slice(0, 10);
    const uid: any = typeof process.getuid === 'function' ? process.getuid() : 'u';
    return path.join(os.tmpdir(), `opengym-admin-${uid}-${tag}`);
}
export const socketPath: any = (env: any = process.env) => path.join(socketDir(env), 'admin.sock');
/** Creates the directory 0700, or checks the one there is ours and private. Throws when it is not. */
export function privateDir(dir?: any) {
    try {
        fs.mkdirSync(dir, { mode: 0o700 });
    }
    catch (e: any) {
        if (e.code !== 'EEXIST')
            throw e;
    }
    const st: any = fs.lstatSync(dir);
    if (!st.isDirectory() || st.isSymbolicLink())
        throw new Error(`${dir} is not a directory`);
    if (typeof process.getuid === 'function' && st.uid !== process.getuid())
        throw new Error(`${dir} belongs to someone else`);
    if ((st.mode & 0o077) !== 0)
        throw new Error(`${dir} is open to others (mode ${(st.mode & 0o777).toString(8)})`);
    return dir;
}
/**
 * Listens on the socket. `handle(msg)` answers one request ({ cmd, ... }) with a plain object; each
 * connection carries one JSON line in and one out. Returns the server, or null when there is no
 * safe place for it (logged; the instance runs without the command then).
 */
export function startAdminSocket({ env = process.env, handle, log = console }: any) {
    if (process.platform === 'win32')
        return null;
    let file: any;
    try {
        privateDir(socketDir(env));
        file = socketPath(env);
        // A socket left by the previous process; only ever one of ours, in our private directory.
        try {
            if (fs.lstatSync(file).isSocket())
                fs.unlinkSync(file);
        }
        catch { /* none */ }
    }
    catch (e: any) {
        log.error('admin socket: not started,', e.message);
        return null;
    }
    const server: any = net.createServer((conn?: any) => {
        let buf: any = '';
        conn.setTimeout(5000, () => conn.destroy());
        conn.on('error', () => { });
        conn.on('data', async (chunk?: any) => {
            buf += chunk;
            if (buf.length > MAX_LINE) {
                conn.end(JSON.stringify({ error: 'request too long' }) + '\n');
                return;
            }
            const nl: any = buf.indexOf('\n');
            if (nl < 0)
                return;
            let out: any;
            try {
                out = await handle(JSON.parse(buf.slice(0, nl)));
            }
            catch (e: any) {
                out = { error: e instanceof SyntaxError ? 'not JSON' : 'server error' };
                if (!(e instanceof SyntaxError))
                    log.error('admin socket:', e);
            }
            conn.end(JSON.stringify(out) + '\n');
        });
    });
    server.on('error', (e?: any) => log.error('admin socket:', e.message));
    const old: any = process.umask(0o177);
    try {
        server.listen(file, () => { try {
            fs.chmodSync(file, 0o600);
        }
        catch { /* the umask already did */ } });
    }
    finally {
        process.umask(old);
    }
    server.unref();
    return server;
}
/** One request to the running server: resolves with its answer. For recover.js. */
export function askAdminSocket(msg?: any, { env = process.env, timeoutMs = 10000 }: any = {}) {
    return new Promise((resolve?: any, reject?: any) => {
        const conn: any = net.createConnection(socketPath(env));
        let buf: any = '';
        const timer: any = setTimeout(() => { conn.destroy(); reject(Object.assign(new Error('no answer'), { code: 'ETIMEDOUT' })); }, timeoutMs);
        conn.on('connect', () => conn.write(JSON.stringify(msg) + '\n'));
        conn.on('data', (d?: any) => { buf += d; });
        conn.on('end', () => {
            clearTimeout(timer);
            try {
                resolve(JSON.parse(buf));
            }
            catch {
                reject(new Error('the server sent something unexpected'));
            }
        });
        conn.on('error', (e?: any) => { clearTimeout(timer); reject(e); });
    });
}
