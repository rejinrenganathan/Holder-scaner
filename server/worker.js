// Holder Scan API — accounts, sign-in and sessions (step 1 of the public version)
// Runs on a Cloudflare Worker with a D1 database bound as DB. Setup steps: server.html in this repo.
//
// Sign in with a Solana wallet: the app asks for a one-time message (nonce), the wallet signs it
// (no transaction, no fee), and the Worker checks the signature. Then it hands out a session token.

const API_V = 1;
// Wallets that may open the admin panel later (your Holder Scan wallet). Add more, comma-separated.
const ADMIN_WALLETS = 'CZQkA9JszBPP7x2LescrtZwh1LGoxZwnW68wLbdFPz93';
// Sites allowed to call this API from a browser
const ORIGINS = ['https://rejinrenganathan.github.io'];
const APP_URI = 'https://rejinrenganathan.github.io/Holder-scaner/';
const NONCE_TTL = 10 * 60;          // a sign-in message is valid for 10 minutes, once
const SESSION_DAYS = 30;            // stay signed in for 30 days

// ---------- helpers ----------
const now = () => Math.floor(Date.now() / 1000);
const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
function b58decode(s) {
  if (typeof s !== 'string' || !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(s)) return null;
  let n = 0n;
  for (const c of s) n = n * 58n + BigInt(B58.indexOf(c));
  const out = [];
  while (n > 0n) { out.unshift(Number(n % 256n)); n /= 256n; }
  for (const c of s) { if (c !== '1') break; out.unshift(0); }
  return new Uint8Array(out);
}
function b64decode(s) {
  try { const bin = atob(String(s)); const u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return u; } catch (e) { return null; }
}
function hex(buf) { return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join(''); }
async function sha256(s) { return hex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s))); }
function randomToken(bytes = 32) { const a = new Uint8Array(bytes); crypto.getRandomValues(a); return hex(a); }

// the exact text the wallet signs — rebuilt on the server from the stored nonce, never trusted from the app
function signInMessage(wallet, nonce, issued) {
  return `Holder Scan wants you to sign in with your Solana account:\n${wallet}\n\n` +
    `Sign in to Holder Scan. This costs nothing and sends no transaction.\n\n` +
    `URI: ${APP_URI}\nNonce: ${nonce}\nIssued At: ${new Date(issued * 1000).toISOString()}`;
}
async function verifyEd25519(pubBytes, sigBytes, msgBytes) {
  for (const alg of [{ name: 'Ed25519' }, { name: 'NODE-ED25519', namedCurve: 'NODE-ED25519' }]) {
    try {
      const key = await crypto.subtle.importKey('raw', pubBytes, alg, false, ['verify']);
      return await crypto.subtle.verify(alg.name === 'Ed25519' ? 'Ed25519' : alg, key, sigBytes, msgBytes);
    } catch (e) { /* try the older name */ }
  }
  return false;
}

// ---------- database ----------
let ready = false;
async function init(env) {
  if (ready) return;
  await env.DB.batch([
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS users(id INTEGER PRIMARY KEY, wallet TEXT UNIQUE, email TEXT UNIQUE, name TEXT,
      plan TEXT NOT NULL DEFAULT 'free', plan_until INTEGER NOT NULL DEFAULT 0, created INTEGER NOT NULL, last_seen INTEGER NOT NULL)`),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS nonces(nonce TEXT PRIMARY KEY, wallet TEXT NOT NULL, issued INTEGER NOT NULL)`),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS sessions(token_hash TEXT PRIMARY KEY, user_id INTEGER NOT NULL, created INTEGER NOT NULL, expires INTEGER NOT NULL)`)
  ]);
  ready = true;
}
const admins = () => new Set(ADMIN_WALLETS.split(',').map(s => s.trim()).filter(Boolean));
function publicUser(u) {
  if (!u) return null;
  const active = u.plan !== 'free' && (u.plan === 'lifetime' || u.plan_until > now());
  return { id: u.id, wallet: u.wallet, email: u.email, name: u.name, plan: active ? u.plan : 'free', planUntil: active ? u.plan_until : 0,
    created: u.created, isAdmin: !!(u.wallet && admins().has(u.wallet)) };
}
async function userFromRequest(req, env) {
  const m = (req.headers.get('authorization') || '').match(/^Bearer ([0-9a-f]{64})$/);
  if (!m) return null;
  const s = await env.DB.prepare('SELECT user_id, expires FROM sessions WHERE token_hash = ?').bind(await sha256(m[1])).first();
  if (!s || s.expires < now()) return null;
  return await env.DB.prepare('SELECT * FROM users WHERE id = ?').bind(s.user_id).first();
}

// ---------- HTTP ----------
function cors(req) {
  const o = req.headers.get('origin') || '';
  const allow = ORIGINS.includes(o) || /^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(o) ? o : ORIGINS[0];
  return { 'access-control-allow-origin': allow, 'access-control-allow-headers': 'content-type, authorization', 'access-control-allow-methods': 'GET, POST, OPTIONS', 'vary': 'origin' };
}
const json = (req, o, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json', ...cors(req) } });
const fail = (req, status, error) => json(req, { ok: false, error }, status);
async function body(req) { try { return await req.json(); } catch (e) { return {}; } }

export default {
  async fetch(req, env) {
    try { return await handle(req, env); }
    catch (e) { return fail(req, 500, 'Server error: ' + String(e && e.message || e)); }
  }
};

async function handle(req, env) {
  if (req.method === 'OPTIONS') return new Response(null, { headers: cors(req) });
  if (!env.DB) return fail(req, 500, 'D1 database is not connected as DB (see server.html, step 3)');
  await init(env);
  const path = new URL(req.url).pathname.replace(/\/+$/, '') || '/';

  if (path === '/api/health' || path === '/') return json(req, { ok: true, app: 'holder-scan-api', v: API_V });

  // 1) ask for a sign-in message
  if (path === '/api/auth/nonce' && req.method === 'POST') {
    const { wallet } = await body(req);
    const pub = b58decode(wallet);
    if (!pub || pub.length !== 32) return fail(req, 400, 'Not a valid Solana wallet address');
    const t = now(), nonce = randomToken(16);
    await env.DB.batch([
      env.DB.prepare('DELETE FROM nonces WHERE issued < ?').bind(t - NONCE_TTL),
      env.DB.prepare('INSERT INTO nonces(nonce, wallet, issued) VALUES(?, ?, ?)').bind(nonce, wallet, t)
    ]);
    return json(req, { ok: true, nonce, message: signInMessage(wallet, nonce, t) });
  }

  // 2) send back the signature → session
  if (path === '/api/auth/solana' && req.method === 'POST') {
    const { wallet, nonce, signature } = await body(req);
    const pub = b58decode(wallet), sig = b64decode(signature);
    if (!pub || pub.length !== 32 || !sig || sig.length !== 64 || typeof nonce !== 'string') return fail(req, 400, 'Sign-in data is incomplete');
    const n = await env.DB.prepare('SELECT * FROM nonces WHERE nonce = ?').bind(nonce).first();
    if (!n || n.wallet !== wallet) return fail(req, 401, 'This sign-in request is unknown or was already used — try again');
    await env.DB.prepare('DELETE FROM nonces WHERE nonce = ?').bind(nonce).run();   // one use only
    if (n.issued < now() - NONCE_TTL) return fail(req, 401, 'The sign-in request expired — try again');
    const okSig = await verifyEd25519(pub, sig, new TextEncoder().encode(signInMessage(wallet, nonce, n.issued)));
    if (!okSig) return fail(req, 401, 'The signature does not match this wallet');
    const t = now(), existed = await env.DB.prepare('SELECT id FROM users WHERE wallet = ?').bind(wallet).first();
    await env.DB.prepare(`INSERT INTO users(wallet, created, last_seen) VALUES(?, ?, ?) ON CONFLICT(wallet) DO UPDATE SET last_seen = excluded.last_seen`).bind(wallet, t, t).run();
    const u = await env.DB.prepare('SELECT * FROM users WHERE wallet = ?').bind(wallet).first();
    const token = randomToken(32);
    await env.DB.batch([
      env.DB.prepare('DELETE FROM sessions WHERE expires < ?').bind(t),
      env.DB.prepare('INSERT INTO sessions(token_hash, user_id, created, expires) VALUES(?, ?, ?, ?)').bind(await sha256(token), u.id, t, t + SESSION_DAYS * 86400)
    ]);
    return json(req, { ok: true, token, user: publicUser(u), isNew: !existed });
  }

  // 3) who am I
  if (path === '/api/me' && req.method === 'GET') {
    const u = await userFromRequest(req, env);
    if (!u) return fail(req, 401, 'Not signed in');
    await env.DB.prepare('UPDATE users SET last_seen = ? WHERE id = ?').bind(now(), u.id).run();
    return json(req, { ok: true, user: publicUser(u) });
  }

  // 4) sign out (this device)
  if (path === '/api/auth/logout' && req.method === 'POST') {
    const m = (req.headers.get('authorization') || '').match(/^Bearer ([0-9a-f]{64})$/);
    if (m) await env.DB.prepare('DELETE FROM sessions WHERE token_hash = ?').bind(await sha256(m[1])).run();
    return json(req, { ok: true });
  }

  return fail(req, 404, 'Not found');
}
