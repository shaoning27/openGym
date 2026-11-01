// Legacy dynamic types are explicit during the full language migration.
// Backend + WebAuthn helpers (ported from the vanilla app).
import { t } from './i18n-core.ts';
import { MOBILE } from './mobile.ts';
import { appBase } from './app-base.ts';
import { nativeFetch } from './capacitor-fetch.ts';
export const IS_APPLE: any = /iPhone|iPad|iPod|Macintosh/.test(navigator.userAgent);
export const IS_ANDROID: any = /Android/.test(navigator.userAgent);
export const BIO: any = IS_APPLE ? 'Face ID / Touch ID' : IS_ANDROID ? 'fingerprint or face unlock' : 'your fingerprint, face or PIN';
// The same phrase in the UI language. It goes into translated sentences ("confirm with {0}"),
// so the English constant above left an English phrase in the middle of every other language.
// Functions, not constants: the pack is loaded after this module is.
export const bio: any = () => (IS_APPLE ? t('Face ID / Touch ID') : IS_ANDROID ? t('fingerprint or face unlock') : t('your fingerprint, face or PIN'));
// PublicKeyCredential is the WebAuthn-specific capability signal. Do not also gate the UI on
// navigator.credentials: some browsers expose WebAuthn while that generic Credential Management
// API check produces a false negative (notably Chrome on iOS). The real create/get calls still run
// only after the user chooses a passkey action and surface any genuine browser error there.
export const webauthnOK: any = () => typeof window.PublicKeyCredential !== 'undefined';
// The paired mobile app (lib/remote.ts) is the only caller of these — everywhere else stays on
// same-origin cookies, so remoteBase/remoteToken stay empty and api() behaves exactly as before.
let remoteBase: any = '';
let remoteToken: any = null;
export function setRemoteAuth(base?: any, token?: any) { remoteBase = base || ''; remoteToken = token || null; }
// A Cloudflare Access service token (lib/cf-access.ts): sent only to the origin it was entered
// for, never on a same-origin request, where the browser's own Access session cookie already
// does the job, and never to a server that merely happens to be paired or typed in.
let accessHeaders: any = {};
let accessOrigin: any = '';
export function setAccessHeaders(h?: any, origin?: any) { accessHeaders = Object.assign({}, h); accessOrigin = origin || ''; }
const originOf: any = (base?: any) => { try {
    return new URL(base).origin;
}
catch {
    return '';
} };
const accessFor: any = (base?: any) => (base && accessOrigin && originOf(base) === accessOrigin ? accessHeaders : {});
const remoteHeaders: any = () => Object.assign({}, accessFor(remoteBase), remoteToken ? { Authorization: 'Bearer ' + remoteToken } : {});
// The paired server and what a request to it carries (the token, an Access service token for that
// origin), for the phone's background check (lib/nudge-check.ts), which runs with no WebView and
// so has to be handed them. null when this is not a paired phone.
export const remoteAuth: any = () => (remoteBase && remoteToken ? { base: remoteBase, headers: remoteHeaders() } : null);
export { appBase };
// How long one request may take before it counts as no answer at all. A black-holed connection
// (captive portal, half-open socket, a phone between two networks) never settles on its own, and
// the store runs one push and one pull at a time: a single hung request used to hold every later
// sync behind it, silently, for as long as the socket hung. A GET is small; a PUT carries the
// whole profile over what may be a slow uplink. A caller that knows its request is slow on
// purpose (the admin's provider test) passes its own `timeout`; 0 means none.
const TIMEOUT_GET_MS: any = 20000;
const TIMEOUT_MS: any = 60000;
const failure: any = (message?: any, code?: any, status?: any) => Object.assign(new Error(message), { code, status });
// The message an error answer is shown with. The server's English `error`, except a write the
// origin check refused (or a passkey made at another address): a self-hoster whose ORIGIN is not
// the address they opened only ever saw "cross-origin request refused", and nobody could tell
// what to change. The answer names ORIGIN, so the sentence can too (api/verify-error.ts).
function refusal(status?: any, body?: any) {
    if (body && body.code === 'origin-mismatch')
        return t('This server only takes changes made at {0}. If you opened openGym at another address, whoever runs the server can set ORIGIN and RP_ID to match it (the self-hosting guide shows how).', String(body.expected || '?'));
    return (body && body.error) || ('HTTP ' + status);
}
export async function api(path?: any, opts?: any) {
    const { timeout, ...init }: any = opts || {};
    // A phone with no server to talk to: local mode, or a pairing that is gone. There is no
    // relative URL to fall back on here — the WebView's own origin is Capacitor's local asset
    // server, which answers ANY path, PUT included, with index.html and a 200, so a push "landed"
    // there and the change was marked as synced while the server never saw it. status 0, not
    // undefined: this is not "offline", and the store must not show it as such.
    if (MOBILE && !remoteBase)
        throw failure(t('This phone is not connected to a server.'), 'not-paired', 0);
    const headers: any = Object.assign({ 'Content-Type': 'application/json' }, init.headers, remoteHeaders());
    // A paired phone has an absolute base of its own; everyone else is relative to where the app
    // is served, so a subpath deployment reaches its own API instead of the proxy's root.
    const url: any = remoteBase ? remoteBase + path : appBase().replace(/\/$/, '') + path;
    const ms: any = timeout != null ? timeout : (init.method || 'GET').toUpperCase() === 'GET' ? TIMEOUT_GET_MS : TIMEOUT_MS;
    return request(url, Object.assign({}, init, { headers }), ms);
}
// One exchange, bounded by `ms`. No status on the timeout, like a fetch that failed outright: to
// the store both mean the server could not be reached, and the device says it is offline instead
// of waiting forever.
async function request(url?: any, init?: any, ms?: any) {
    const ctl: any = typeof AbortController === 'function' ? new AbortController() : null;
    let timer: any = null;
    const expired: any = new Promise((_?: any, reject?: any) => {
        if (ms > 0)
            timer = setTimeout(() => { if (ctl)
                ctl.abort(); reject(failure(t('The server did not answer in time.'), 'timeout')); }, ms);
    });
    const answer: any = exchange(url, ctl ? Object.assign({}, init, { signal: ctl.signal }) : init);
    answer.catch(() => { }); // it may still settle after the timeout has answered; nobody is listening then
    try {
        return await Promise.race([answer, expired]);
    }
    finally {
        clearTimeout(timer);
    }
}
// Every route of the API answers JSON (api/server.ts json()). A 2xx whose body is not JSON is
// therefore someone else's answer: Capacitor's local server on a phone that lost its pairing, an
// auth proxy's login page, a proxy that sends /api/* to the app's index.html. Reading it as {}
// made a push look accepted by a server "from before revisions" — the change was marked synced
// and dropped from the queue. It is an error, with the status it came with.
async function exchange(url?: any, init?: any) {
    const r: any = await fetch(url, init);
    let data: any;
    let parsed: any = true;
    try {
        data = await r.json();
    }
    catch {
        parsed = false;
    }
    const body: any = parsed && data && typeof data === 'object' ? data : null;
    // The body rides along on the error: a 409 from /api/data carries the server's document.
    if (!r.ok) {
        const e: any = new Error(refusal(r.status, body));
        e.status = r.status;
        e.data = body || {};
        throw e;
    }
    if (!body)
        throw failure(t('The server answered with something other than openGym data.'), 'bad-response', r.status);
    return body;
}
// A "left" signal sent as the page goes: sendBeacon outlives a closing tab, where fetch may not.
// Only the web app sends one, to its own origin with its session cookie. A beacon carries no
// Authorization header, so a paired phone's server could not tell whose it is, and the phone's own
// origin is Capacitor's asset server, which answers every path with index.html: the phones sent
// every "left" to https://localhost/api/activity. The api() call beside it reaches the server.
export function beacon(path?: any, body?: any) {
    if (MOBILE)
        return false;
    try {
        if (typeof navigator === 'undefined' || typeof navigator.sendBeacon !== 'function')
            return false;
        return !!navigator.sendBeacon(appBase().replace(/\/$/, '') + path, new Blob([JSON.stringify(body)], { type: 'application/json' }));
    }
    catch {
        return false;
    }
}
/* ------------------------------------------------ photos and videos of custom exercises ------
   Two transports beside api(), for the one kind of body that is not JSON. Both go to the same
   base api() uses and carry the paired phone's Bearer token the same way (the server's CORS
   answer allows it for GET and PUT); both refuse to run on a phone without a server, like api(). */
const mediaUrl: any = (path?: any) => (remoteBase ? remoteBase + path : appBase().replace(/\/$/, '') + path);
const mediaHeaders: any = remoteHeaders;
const notPaired: any = () => failure(t('This phone is not connected to a server.'), 'not-paired', 0);
const timedOut: any = () => failure(t('The server did not answer in time.'), 'timeout');
/**
 * GET a file as a Blob (lib/media-sync.ts fetchToStore, which checks its hash before keeping it).
 * An answer that announces more than `expectSize` (+1 KB) is refused before a byte is read, and
 * one that turns out longer is cut off: a login page or a proxy's error is never read into
 * memory. There is no total time limit — a video on a slow line takes what it takes — only an
 * idle one: no bytes for `idleMs` and the download counts as offline (code 'timeout').
 * Errors carry { status, code } like api()'s: the server's code on a refusal (media-missing).
 */
export async function apiBlob(path?: any, { expectSize, idleMs = 30000, fetchImpl = globalThis.fetch }: any = {}) {
    if (MOBILE && !remoteBase)
        throw notPaired();
    const max: any = typeof expectSize === 'number' && expectSize >= 0 ? expectSize + 1024 : Infinity;
    const ctl: any = typeof AbortController === 'function' ? new AbortController() : null;
    let timer: any = null;
    let idle: any = false;
    // The stall is raced against every await, not left to the abort alone: a WebView whose reader
    // does not settle on abort would otherwise hang the download for good.
    let stalled: any = null;
    const stall: any = new Promise((_?: any, reject?: any) => { stalled = reject; });
    stall.catch(() => { });
    const arm: any = () => { clearTimeout(timer); timer = setTimeout(() => { idle = true; ctl?.abort(); stalled(timedOut()); }, idleMs); };
    const tooBig: any = (status?: any) => failure('HTTP ' + status, 'too-large', status);
    // What loses the race may still reject afterwards, with nobody left listening.
    const orStall: any = (p?: any) => { p.catch(() => { }); return Promise.race([p, stall]); };
    arm();
    try {
        const r: any = await orStall(fetchImpl(mediaUrl(path), { headers: mediaHeaders(), cache: 'no-store', ...(ctl ? { signal: ctl.signal } : {}) }));
        if (!r.ok) {
            let body: any = null;
            try {
                body = await r.json();
            }
            catch { /* not JSON: a proxy's page */ }
            throw Object.assign(new Error(refusal(r.status, body)), { status: r.status, code: (body && body.code) || 'http', data: body || {} });
        }
        const announced: any = Number(r.headers?.get?.('content-length'));
        if (Number.isFinite(announced) && announced > max) {
            ctl?.abort();
            throw tooBig(r.status);
        }
        const reader: any = r.body && typeof r.body.getReader === 'function' ? r.body.getReader() : null;
        if (!reader) {
            const b: any = await orStall(r.blob());
            if (b.size > max)
                throw tooBig(r.status);
            return b;
        }
        const parts: any = [];
        let n: any = 0;
        for (;;) {
            arm();
            const { done, value }: any = await orStall(reader.read());
            if (done)
                break;
            n += value.length;
            if (n > max) {
                ctl?.abort();
                throw tooBig(r.status);
            }
            parts.push(value);
        }
        return new Blob(parts);
    }
    catch (e: any) {
        if (idle)
            throw timedOut();
        throw e;
    }
    finally {
        clearTimeout(timer);
    }
}
/**
 * PUT a file (XMLHttpRequest, because only it reports upload progress). `mime` is the type the
 * MediaRef records, sent explicitly — a Blob read back from a phone's file carries whatever the
 * local server guessed. Resolves with the server's JSON answer. Rejects with { status, code }:
 * the server's own code on a refusal, plus `retryAfter` on a 429; 'proxy-too-large' for a 413
 * that is not the API's JSON (nginx's client_max_body_size, Cloudflare's 100 MB); 'timeout' after
 * `idleMs` without progress; no status at all when the network failed.
 */
export function apiUpload(path?: any, blob?: any, mime?: any, { onProgress, idleMs = 60000, XHR = globalThis.XMLHttpRequest }: any = {}) {
    if (MOBILE && !remoteBase)
        return Promise.reject(notPaired());
    return new Promise((resolve?: any, reject?: any) => {
        const xhr: any = new XHR();
        let timer: any = null;
        let idle: any = false;
        const arm: any = () => { clearTimeout(timer); timer = setTimeout(() => { idle = true; xhr.abort(); }, idleMs); };
        xhr.open('PUT', mediaUrl(path));
        xhr.setRequestHeader('Content-Type', mime);
        for (const [k, v] of Object.entries(mediaHeaders()))
            xhr.setRequestHeader(k, v);
        if (xhr.upload)
            xhr.upload.onprogress = (e?: any) => { arm(); if (onProgress && e.lengthComputable)
                onProgress(e.loaded, e.total); };
        xhr.onprogress = arm;
        xhr.onload = () => {
            clearTimeout(timer);
            let body: any = null;
            try {
                body = JSON.parse(xhr.responseText);
            }
            catch { /* not JSON */ }
            if (body && typeof body !== 'object')
                body = null;
            if (xhr.status >= 200 && xhr.status < 300) {
                if (body)
                    resolve(body);
                else
                    reject(failure(t('The server answered with something other than openGym data.'), 'bad-response', xhr.status));
                return;
            }
            if (xhr.status === 413 && !body) {
                reject(failure('HTTP 413', 'proxy-too-large', 413));
                return;
            }
            const e: any = Object.assign(new Error(refusal(xhr.status, body)), { status: xhr.status, code: (body && body.code) || 'http', data: body || {} });
            if (xhr.status === 429) {
                const header: any = Number(xhr.getResponseHeader && xhr.getResponseHeader('Retry-After'));
                e.retryAfter = Number(body && body.retryAfter) || (Number.isFinite(header) && header > 0 ? header : 60);
            }
            reject(e);
        };
        xhr.onerror = () => { clearTimeout(timer); reject(Object.assign(new Error('network'), { code: 'network' })); };
        xhr.onabort = () => { clearTimeout(timer); reject(idle ? timedOut() : Object.assign(new Error('aborted'), { code: 'network' })); };
        arm();
        xhr.send(blob);
    });
}
// "Failed to fetch" is all the WebView says when pairing never got an answer (#329), and it says
// the same for a wrong address and for a reverse proxy that answered the CORS preflight itself
// without letting the app's origin in (a Traefik `headers` middleware with an allow-list, which
// never passes the OPTIONS on to openGym). A no-cors request needs no preflight and tells the two
// apart: it settles when the server is there at all. Its answer cannot be read, nor needs to be.
const PROBE_MS: any = 5000;
const hostOfBase: any = (base?: any) => {
    try {
        const u: any = new URL(base);
        return u.host + u.pathname.replace(/\/$/, '');
    }
    catch {
        return base || '';
    }
};
// What /api/health says when it can be read (the app's native fetch reads it past CORS):
// 'opengym', 'front' when something in front of openGym answered in its place (a redirect, a
// 401/403 or an HTML page: an SSO login, forward-auth, a proxy rule), 'other' for an answer that
// is just not openGym's (another app's JSON, a proxy's plain "404 page not found"), and null
// when nothing readable came back.
async function healthAnswer(base?: any, ms?: any) {
    const ctl: any = typeof AbortController === 'function' ? new AbortController() : null;
    let timer: any = null;
    try {
        const res: any = await Promise.race([
            nativeFetch(base + '/api/health', { method: 'GET', headers: { Accept: 'application/json' }, ...(ctl ? { signal: ctl.signal } : {}) }),
            new Promise((_?: any, reject?: any) => { timer = setTimeout(() => { if (ctl)
                ctl.abort(); reject(new Error('timeout')); }, ms); }),
        ]);
        const text: any = await res.text();
        let body: any = null;
        try {
            body = JSON.parse(text);
        }
        catch {
            body = null;
        }
        if (res.ok && body && typeof body === 'object' && body.ok === true)
            return 'opengym';
        const type: any = (res.headers && typeof res.headers.get === 'function' && res.headers.get('content-type')) || '';
        const html: any = /html/i.test(type) || /^\s*</.test(text || '');
        if ((res.status >= 300 && res.status < 400) || res.status === 401 || res.status === 403 || res.status === 407 || html)
            return 'front';
        return 'other';
    }
    catch {
        return null;
    }
    finally {
        clearTimeout(timer);
    }
}
async function whyUnreachable(base?: any, ms?: any) {
    let reached: any = false;
    const ctl: any = typeof AbortController === 'function' ? new AbortController() : null;
    let timer: any = null;
    try {
        await Promise.race([
            fetch(base + '/api/health', { mode: 'no-cors', cache: 'no-store', ...(ctl ? { signal: ctl.signal } : {}) }),
            new Promise((_?: any, reject?: any) => { timer = setTimeout(() => { if (ctl)
                ctl.abort(); reject(new Error('timeout')); }, ms); }),
        ]);
        reached = true;
    }
    catch { /* not reachable either */ }
    finally {
        clearTimeout(timer);
    }
    // Something answered. Whether it is openGym needs a readable answer: in the app the native
    // fetch reads /api/health past CORS. A login page or a proxy rule answering in openGym's place
    // is not a wrong address, and a page that is simply not openGym's is (#329). No readable
    // answer at all leaves the CORS explanation.
    const answer: any = reached ? await healthAnswer(base, ms) : null;
    if (answer === 'front') {
        return failure(t('That address answers, but a login page or proxy rule replied instead of openGym. Let /api/ through to openGym unchanged. See “Phone app and CORS” in docs/SELF_HOSTING.md.'), 'proxy-answered');
    }
    if (answer === 'other') {
        return failure(t('That address answers, but it isn’t an openGym server. Check the URL.'), 'not-opengym');
    }
    if (reached) {
        const origin: any = globalThis.location?.origin || 'https://localhost';
        return failure(t('Your server was reached, but it refused the app’s request (CORS). If a reverse proxy such as Traefik adds CORS headers, let requests from {0} through to openGym unchanged. See “Phone app and CORS” in docs/SELF_HOSTING.md.', origin), 'cors');
    }
    // An address typed without a scheme is tried as https://. A home server on plain http gives
    // that try nothing to talk to, while the phone's browser, which tries http, opens it (#428).
    let u: any = null;
    try {
        u = new URL(base);
    }
    catch { /* said as it is below */ }
    if (u && u.protocol === 'https:' && looksLocal(u.hostname)) {
        return failure(t('Could not reach {0} over https://. If your server runs on plain http (common at home), type http://{0} instead.', hostOfBase(base)), 'unreachable');
    }
    return failure(t('Could not reach {0}. Check the address and that this phone can reach it.', hostOfBase(base)), 'unreachable');
}
// An address that only makes sense on a home network: a private or link-local IP, a name
// without a dot ("nas"), or a LAN-only suffix (.local, .lan, .home.arpa, .internal). Those are
// where a server most often runs on plain http, so an https:// try that got nowhere is worth a
// hint about http:// (#428). A public name gets the plain "could not reach" instead.
export function looksLocal(hostname?: any) {
    const h: any = String(hostname || '').toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '');
    if (!h)
        return false;
    const v4: any = /^(\d{1,3})\.(\d{1,3})\.\d{1,3}\.\d{1,3}$/.exec(h);
    if (v4) {
        const a: any = +v4[1], b: any = +v4[2];
        return a === 10 || a === 127 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) ||
            (a === 169 && b === 254) || (a === 100 && b >= 64 && b <= 127);
    }
    if (h.includes(':'))
        return h === '::1' || /^f[cd]/.test(h) || /^fe[89ab]/.test(h);
    return !h.includes('.') || /\.(local|lan|home|home\.arpa|internal|localdomain)$/.test(h);
}
// Bootstraps the connection itself: the base isn't configured yet (that's what this call decides),
// so it talks straight to the server the user typed in, no Authorization header. A Cloudflare
// Access token goes along when it was entered for that server: without it Access never lets
// the code through, and to any other server it would be handed to a stranger.
export async function pairRedeem(serverBase?: any, code?: any, { probeMs = PROBE_MS }: any = {}) {
    let data: any;
    try {
        data = await request(serverBase + '/api/pair/redeem', {
            method: 'POST', headers: Object.assign({ 'Content-Type': 'application/json' }, accessFor(serverBase)), body: JSON.stringify({ code })
        }, TIMEOUT_GET_MS);
    }
    catch (e: any) {
        // A wrong, spent or expired code is the one refusal a person can fix, and the server says it
        // in English only ('invalid or expired code'), so it is said here in the UI language.
        if (e && e.status === 400)
            throw failure(t('That code didn’t work. Codes last 5 minutes and work once, so grab a fresh one.'), 'pair-invalid', 400);
        // The server answered (any status) or did not answer in time: that error says it already.
        if (e && (e.status != null || e.code))
            throw e;
        throw await whyUnreachable(serverBase, probeMs);
    }
    // Anything that is not a pairing would be saved as one — and the phone would then send every
    // change to a server that never gave it a token.
    if (!data.token || !data.user)
        throw failure(t('The server answered with something other than openGym data.'), 'bad-response', 200);
    return data;
}
const bufToB64u: any = (buf?: any) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const b64uToBuf: any = (s?: any) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c?: any) => c.charCodeAt(0)).buffer;
function toCreationOptions(o?: any) {
    o.challenge = b64uToBuf(o.challenge);
    o.user.id = b64uToBuf(o.user.id);
    (o.excludeCredentials || []).forEach((c?: any) => { c.id = b64uToBuf(c.id); });
    return o;
}
function toRequestOptions(o?: any) {
    o.challenge = b64uToBuf(o.challenge);
    (o.allowCredentials || []).forEach((c?: any) => { c.id = b64uToBuf(c.id); });
    return o;
}
function credToJSON(cred?: any) {
    const r: any = cred.response;
    const out: any = {
        id: cred.id, rawId: bufToB64u(cred.rawId), type: cred.type,
        clientExtensionResults: cred.getClientExtensionResults ? cred.getClientExtensionResults() : {},
        authenticatorAttachment: cred.authenticatorAttachment || null,
        response: { clientDataJSON: bufToB64u(r.clientDataJSON) }
    };
    if (r.attestationObject) {
        out.response.attestationObject = bufToB64u(r.attestationObject);
        out.response.transports = r.getTransports ? r.getTransports() : ['internal'];
    }
    if (r.authenticatorData) {
        out.response.authenticatorData = bufToB64u(r.authenticatorData);
        out.response.signature = bufToB64u(r.signature);
        out.response.userHandle = r.userHandle ? bufToB64u(r.userHandle) : null;
    }
    return out;
}
// A passkey sign-in or sign-up the server refused, in the UI language. The routes send a stable
// `code` beside their English message; an answer without one (an older server, a verify error)
// is shown as it came.
export function passkeyError(e?: any, fallback?: any) {
    switch (e?.data?.code) {
        case 'invite': return t('That invite code is not valid.');
        case 'unknown-credential': return t('This server doesn’t know that passkey. Make a profile first.');
        case 'disabled': return t('This account has been disabled.');
        case 'challenge-expired': return t('That took a little too long. Give it another go.');
        case 'origin-mismatch': return refusal(e.status, e.data);
    }
    return e?.message || fallback;
}
export async function passkeyRegister(name?: any, code?: any) {
    const { cid, options }: any = await api('/api/register/options', { method: 'POST', body: JSON.stringify({ name, code: code || '' }) });
    const cred: any = await navigator.credentials.create({ publicKey: toCreationOptions(options) });
    const res: any = await api('/api/register/verify', { method: 'POST', body: JSON.stringify({ cid, credential: credToJSON(cred) }) });
    return res.user;
}
// One passkey ceremony, not yet sent anywhere: /api/login/verify turns it into a sign-in, and
// the account routes take it as proof that the owner is here (#118, #95). `signal` calls the
// prompt off — a sheet that asked for it and was closed meanwhile (components/PasswordAuth.tsx,
// ProveOwner) — which then rejects with an AbortError.
export async function passkeyAssertion({ signal }: any = {}) {
    const { cid, options }: any = await api('/api/login/options', { method: 'POST', body: '{}' });
    const cred: any = await navigator.credentials.get({ publicKey: toRequestOptions(options), ...(signal ? { signal } : {}) });
    return { cid, credential: credToJSON(cred) };
}
export async function passkeyLogin() {
    const res: any = await api('/api/login/verify', { method: 'POST', body: JSON.stringify(await passkeyAssertion()) });
    return res.user;
}
// A creation ceremony on options the server has already handed out: another passkey for a
// signed-in profile, or one made with a code from another device (#95, components/Passkeys.tsx).
// The options come in an earlier step so the prompt opens straight from the tap that asks for it.
// They are copied first — the conversion writes buffers into them, and a prompt dismissed by
// mistake is tried again with the same ones.
export async function createPasskey(options?: any) {
    const cred: any = await navigator.credentials.create({ publicKey: toCreationOptions(JSON.parse(JSON.stringify(options))) });
    return credToJSON(cred);
}
// Name-and-password sign-in, on an instance that offers it (config.password_login). Each of
// these answers with the same session cookie a passkey sign-in sets, so callers treat the user
// they return exactly alike.
const post: any = (path?: any, body?: any) => api(path, { method: 'POST', body: JSON.stringify(body) });
// `name` is whatever was typed in "Name or e-mail": it goes in the original `name` field, which
// the server matches against the profile's sign-in e-mail when it holds an "@" and against the
// name otherwise — so the app and a server a version apart still understand each other.
export async function passwordLogin(name?: any, password?: any) {
    return (await post('/api/login/password', { name, password })).user;
}
// `email` is optional, and sent only when there is one: a server from before the field would
// otherwise ignore it without a word, which is the same thing.
export async function passwordRegister(name?: any, password?: any, code?: any, email?: any) {
    return (await post('/api/register/password', { name, password, code: code || '', ...(email ? { email } : {}) })).user;
}
export async function passwordResetRedeem(name?: any, code?: any, next?: any) {
    return (await post('/api/login/password-reset', { name, code, next })).user;
}
