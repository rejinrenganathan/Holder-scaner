// Holder Scan API — accounts, sign-in, owner dashboard (public version, build 2)
// Runs on a Cloudflare Worker with a D1 database bound as DB. Setup steps: server.html in this repo.
//
// Sign in with a Solana wallet: the app asks for a one-time message (nonce), the wallet signs it
// (no transaction, no fee), and the Worker checks the signature. Then it hands out a session token.
// Owner dashboard: open <this worker's address>/owner

const API_V = 2;
// Owner wallet(s) — always allowed into the dashboard. More owners can be added in Site control.
const OWNER_WALLETS = 'CZQkA9JszBPP7x2LescrtZwh1LGoxZwnW68wLbdFPz93';
// Sites allowed to call this API from a browser
const ORIGINS = ['https://rejinrenganathan.github.io'];
const APP_URI = 'https://rejinrenganathan.github.io/Holder-scaner/';
const OWNER_PAGE = 'https://rejinrenganathan.github.io/Holder-scaner/server/owner.html';
const NONCE_TTL = 10 * 60;          // a sign-in message is valid for 10 minutes, once
const SESSION_DAYS = 30;            // stay signed in for 30 days
const FRESH_SIGNIN = 15 * 60;       // changing payment wallet / owners needs a sign-in from the last 15 minutes
const SOL_MINT = 'So11111111111111111111111111111111111111112';

const PLANS = { m1: { name: '1 month', days: 30 }, m3: { name: '3 months', days: 90 }, m6: { name: '6 months', days: 180 },
  m12: { name: '12 months', days: 365 }, lifetime: { name: 'Founder lifetime', days: 0 } };
const DEFAULTS = {
  site_live: '1', signups: '1', payments: '0', founder: '1', alerts: '1', announce: '',
  prices: JSON.stringify({ m1: 2, m3: 5, m6: 9, m12: 15, lifetime: 30 }), founder_max: '100',
  free_tokens: '4', free_wallets: '10', paid_wallets: '4000',
  pay_wallet: OWNER_WALLETS.split(',')[0], owner_wallets: OWNER_WALLETS, owner_emails: '', google_client_id: ''
};
const PUBLIC_KEYS = ['site_live', 'signups', 'payments', 'founder', 'alerts', 'announce', 'prices', 'founder_max', 'free_tokens', 'free_wallets', 'paid_wallets', 'pay_wallet'];
const SENSITIVE = ['pay_wallet', 'owner_wallets', 'owner_emails', 'google_client_id'];
const KEY_NAMES = { helius: 'Helius', stracker: 'Solana Tracker', birdeye: 'Birdeye' };

// ---------- helpers ----------
const now = () => Math.floor(Date.now() / 1000);
const dayOf = (t = now()) => new Date(t * 1000).toISOString().slice(0, 10);
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
const isWallet = s => { const b = b58decode(s); return !!b && b.length === 32; };
function b64decode(s) {
  try { const bin = atob(String(s)); const u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return u; } catch (e) { return null; }
}
function hex(buf) { return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join(''); }
async function sha256(s) { return hex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s))); }
function randomToken(bytes = 32) { const a = new Uint8Array(bytes); crypto.getRandomValues(a); return hex(a); }
const csv = s => String(s || '').split(/[\s,]+/).map(x => x.trim()).filter(Boolean);

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
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS sessions(token_hash TEXT PRIMARY KEY, user_id INTEGER NOT NULL, created INTEGER NOT NULL, expires INTEGER NOT NULL)`),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS settings(k TEXT PRIMARY KEY, v TEXT NOT NULL)`),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS apikeys(name TEXT PRIMARY KEY, value TEXT NOT NULL, updated INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'untested', checked INTEGER NOT NULL DEFAULT 0, note TEXT NOT NULL DEFAULT '')`),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS site_wallets(wallet TEXT PRIMARY KEY, name TEXT NOT NULL DEFAULT '', handle TEXT NOT NULL DEFAULT '',
      kind TEXT NOT NULL DEFAULT 'smart', source TEXT NOT NULL DEFAULT 'manual', hidden INTEGER NOT NULL DEFAULT 0, added INTEGER NOT NULL)`),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS events(id INTEGER PRIMARY KEY, ts INTEGER NOT NULL, level TEXT NOT NULL, src TEXT NOT NULL, msg TEXT NOT NULL, fix TEXT NOT NULL DEFAULT '')`),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS stats(day TEXT NOT NULL, k TEXT NOT NULL, n INTEGER NOT NULL, PRIMARY KEY(day, k))`),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS hits(id INTEGER PRIMARY KEY, ts INTEGER NOT NULL, day TEXT NOT NULL, vid TEXT NOT NULL,
      path TEXT NOT NULL, ref TEXT NOT NULL, country TEXT NOT NULL, device TEXT NOT NULL, inst INTEGER NOT NULL)`),
    env.DB.prepare(`CREATE INDEX IF NOT EXISTS hits_day ON hits(day)`),
    env.DB.prepare(`CREATE INDEX IF NOT EXISTS hits_ts ON hits(ts)`)
  ]);
  // columns added after build 1
  for (const sql of ['ALTER TABLE users ADD COLUMN blocked INTEGER NOT NULL DEFAULT 0', "ALTER TABLE users ADD COLUMN via TEXT NOT NULL DEFAULT ''"]) {
    try { await env.DB.prepare(sql).run(); } catch (e) { /* already there */ }
  }
  ready = true;
}
async function getSettings(env) {
  const r = await env.DB.prepare('SELECT k, v FROM settings').all();
  const s = { ...DEFAULTS };
  for (const row of r.results || []) s[row.k] = row.v;
  return s;
}
async function setSetting(env, k, v) {
  await env.DB.prepare('INSERT INTO settings(k, v) VALUES(?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v').bind(k, String(v)).run();
}
async function logEvent(env, level, src, msg, fix = '') {
  try {
    await env.DB.prepare('INSERT INTO events(ts, level, src, msg, fix) VALUES(?, ?, ?, ?, ?)').bind(now(), level, src, String(msg).slice(0, 300), fix).run();
    if (Math.random() < 0.05) await env.DB.prepare('DELETE FROM events WHERE id < (SELECT MAX(id) - 1000 FROM events)').run();
  } catch (e) { /* logging must never break a request */ }
}
async function bump(env, k, by = 1) {
  try { await env.DB.prepare('INSERT INTO stats(day, k, n) VALUES(?, ?, ?) ON CONFLICT(day, k) DO UPDATE SET n = n + excluded.n').bind(dayOf(), k, by).run(); } catch (e) { }
}
function isOwner(u, s) {
  if (!u || u.blocked) return false;
  const ws = new Set([...csv(OWNER_WALLETS), ...csv(s.owner_wallets)]);
  const es = new Set(csv(s.owner_emails).map(e => e.toLowerCase()));
  return !!((u.wallet && ws.has(u.wallet)) || (u.email && es.has(String(u.email).toLowerCase())));
}
function planActive(u) { return u.plan !== 'free' && (u.plan === 'lifetime' || u.plan_until > now()); }
function publicUser(u, s) {
  if (!u) return null;
  const active = planActive(u);
  return { id: u.id, wallet: u.wallet, email: u.email, name: u.name, plan: active ? u.plan : 'free', planUntil: active ? u.plan_until : 0,
    created: u.created, isAdmin: isOwner(u, s || DEFAULTS) };
}
async function sessionFromRequest(req, env) {
  const m = (req.headers.get('authorization') || '').match(/^Bearer ([0-9a-f]{64})$/);
  if (!m) return null;
  const s = await env.DB.prepare('SELECT user_id, created, expires FROM sessions WHERE token_hash = ?').bind(await sha256(m[1])).first();
  if (!s || s.expires < now()) return null;
  const u = await env.DB.prepare('SELECT * FROM users WHERE id = ?').bind(s.user_id).first();
  if (!u || u.blocked) return null;
  return { user: u, created: s.created };
}
async function newSession(env, u) {
  const t = now(), token = randomToken(32);
  await env.DB.batch([
    env.DB.prepare('DELETE FROM sessions WHERE expires < ?').bind(t),
    env.DB.prepare('INSERT INTO sessions(token_hash, user_id, created, expires) VALUES(?, ?, ?, ?)').bind(await sha256(token), u.id, t, t + SESSION_DAYS * 86400)
  ]);
  return token;
}

// ---------- HTTP ----------
function cors(req) {
  const o = req.headers.get('origin') || '';
  const self = new URL(req.url).origin;
  const allow = ORIGINS.includes(o) || o === self || /^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(o) ? o : ORIGINS[0];
  return { 'access-control-allow-origin': allow, 'access-control-allow-headers': 'content-type, authorization', 'access-control-allow-methods': 'GET, POST, OPTIONS', 'vary': 'origin' };
}
const json = (req, o, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store', ...cors(req) } });
const fail = (req, status, error) => json(req, { ok: false, error }, status);
async function body(req) { try { return await req.json(); } catch (e) { return {}; } }

export default {
  async fetch(req, env, ctx) {
    try { return await handle(req, env, ctx); }
    catch (e) {
      if (env && env.DB) await logEvent(env, 'error', 'server', 'Server error: ' + String(e && e.message || e), 'If it repeats, send this message to Claude');
      return fail(req, 500, 'Server error: ' + String(e && e.message || e));
    }
  }
};

async function handle(req, env, ctx) {
  if (req.method === 'OPTIONS') return new Response(null, { headers: cors(req) });
  const path = new URL(req.url).pathname.replace(/\/+$/, '') || '/';
  if (path === '/owner') return ownerPage();
  if (!env.DB) return fail(req, 500, 'D1 database is not connected as DB (see server.html, step 3)');
  await init(env);
  const later = p => { if (ctx && ctx.waitUntil) ctx.waitUntil(p); else return p; };
  later(bump(env, 'req'));

  if (path === '/api/health' || path === '/') return json(req, { ok: true, app: 'holder-scan-api', v: API_V });

  // public site info (announcement, prices, limits) — for the app
  if (path === '/api/site' && req.method === 'GET') {
    const s = await getSettings(env);
    const out = {};
    for (const k of PUBLIC_KEYS) out[k] = s[k];
    out.prices = JSON.parse(s.prices);
    const sold = await env.DB.prepare("SELECT COUNT(*) n FROM users WHERE plan = 'lifetime'").first();
    out.founderLeft = Math.max(0, Number(s.founder_max) - (sold ? sold.n : 0));
    return json(req, { ok: true, site: out });
  }
  // sign-in options for the owner page
  if (path === '/api/auth/config' && req.method === 'GET') {
    const s = await getSettings(env);
    return json(req, { ok: true, googleClientId: s.google_client_id || '' });
  }

  // a page view (no cookies; visitor id is a hash that changes every day)
  if (path === '/api/hit' && req.method === 'POST') {
    const ua = req.headers.get('user-agent') || '';
    if (/bot|crawl|spider|preview|headless|lighthouse/i.test(ua)) return json(req, { ok: true });
    const b = await body(req), t = now(), day = dayOf(t);
    const s = await getSettings(env);
    let salt = s['salt_' + day];
    if (!salt) { salt = randomToken(16); await setSetting(env, 'salt_' + day, salt); await env.DB.prepare("DELETE FROM settings WHERE k LIKE 'salt_%' AND k < ?").bind('salt_' + dayOf(t - 2 * 86400)).run(); }
    const ip = req.headers.get('cf-connecting-ip') || req.headers.get('x-forwarded-for') || '';
    const vid = (await sha256(salt + ip + ua)).slice(0, 16);
    let ref = '';
    try { const r = new URL(String(b.r || '')); ref = r.hostname.replace(/^www\./, ''); } catch (e) { }
    if (ref && /github\.io$|workers\.dev$/.test(ref)) ref = '';
    const device = /iphone|ipad/i.test(ua) ? 'iPhone' : /android/i.test(ua) ? 'Android' : 'PC';
    const country = (req.cf && req.cf.country) || req.headers.get('cf-ipcountry') || '??';
    const p = String(b.p || '/').slice(0, 80);
    await env.DB.prepare('INSERT INTO hits(ts, day, vid, path, ref, country, device, inst) VALUES(?, ?, ?, ?, ?, ?, ?, ?)')
      .bind(t, day, vid, p, ref.slice(0, 60), String(country).slice(0, 2), device, b.i ? 1 : 0).run();
    if (Math.random() < 0.01) await env.DB.prepare('DELETE FROM hits WHERE ts < ?').bind(t - 120 * 86400).run();
    return json(req, { ok: true });
  }

  // 1) ask for a sign-in message
  if (path === '/api/auth/nonce' && req.method === 'POST') {
    const { wallet } = await body(req);
    if (!isWallet(wallet)) return fail(req, 400, 'Not a valid Solana wallet address');
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
    const s = await getSettings(env);
    const t = now(), existed = await env.DB.prepare('SELECT * FROM users WHERE wallet = ?').bind(wallet).first();
    if (existed && existed.blocked) return fail(req, 403, 'This account is blocked');
    if (!existed && s.signups !== '1' && !isOwner({ wallet }, s)) return fail(req, 403, 'New sign-ups are paused right now');
    await env.DB.prepare(`INSERT INTO users(wallet, created, last_seen, via) VALUES(?, ?, ?, 'wallet') ON CONFLICT(wallet) DO UPDATE SET last_seen = excluded.last_seen`).bind(wallet, t, t).run();
    const u = await env.DB.prepare('SELECT * FROM users WHERE wallet = ?').bind(wallet).first();
    if (!existed) await logEvent(env, 'info', 'users', `New user ${wallet.slice(0, 4)}…${wallet.slice(-4)} (wallet)`);
    return json(req, { ok: true, token: await newSession(env, u), user: publicUser(u, s), isNew: !existed });
  }

  // 2b) Google sign-in (needs a Google client ID in Site control)
  if (path === '/api/auth/google' && req.method === 'POST') {
    const s = await getSettings(env);
    if (!s.google_client_id) return fail(req, 400, 'Google sign-in is not set up yet');
    const { credential } = await body(req);
    if (typeof credential !== 'string' || credential.length > 4000) return fail(req, 400, 'Sign-in data is incomplete');
    const r = await fetch('https://oauth2.googleapis.com/tokeninfo?id_token=' + encodeURIComponent(credential));
    const info = r.ok ? await r.json() : null;
    if (!info || info.aud !== s.google_client_id || String(info.email_verified) !== 'true' || !info.email || Number(info.exp) < now())
      return fail(req, 401, 'Google could not confirm this sign-in — try again');
    const email = String(info.email).toLowerCase(), t = now();
    const existed = await env.DB.prepare('SELECT * FROM users WHERE email = ?').bind(email).first();
    if (existed && existed.blocked) return fail(req, 403, 'This account is blocked');
    if (!existed && s.signups !== '1' && !isOwner({ email }, s)) return fail(req, 403, 'New sign-ups are paused right now');
    await env.DB.prepare(`INSERT INTO users(email, name, created, last_seen, via) VALUES(?, ?, ?, ?, 'google') ON CONFLICT(email) DO UPDATE SET last_seen = excluded.last_seen`)
      .bind(email, String(info.name || '').slice(0, 60), t, t).run();
    const u = await env.DB.prepare('SELECT * FROM users WHERE email = ?').bind(email).first();
    if (!existed) await logEvent(env, 'info', 'users', `New user ${email.replace(/(.{3}).*@/, '$1…@')} (Google)`);
    return json(req, { ok: true, token: await newSession(env, u), user: publicUser(u, s), isNew: !existed });
  }

  // 3) who am I
  if (path === '/api/me' && req.method === 'GET') {
    const se = await sessionFromRequest(req, env);
    if (!se) return fail(req, 401, 'Not signed in');
    await env.DB.prepare('UPDATE users SET last_seen = ? WHERE id = ?').bind(now(), se.user.id).run();
    return json(req, { ok: true, user: publicUser(se.user, await getSettings(env)) });
  }

  // 4) sign out (this device)
  if (path === '/api/auth/logout' && req.method === 'POST') {
    const m = (req.headers.get('authorization') || '').match(/^Bearer ([0-9a-f]{64})$/);
    if (m) await env.DB.prepare('DELETE FROM sessions WHERE token_hash = ?').bind(await sha256(m[1])).run();
    return json(req, { ok: true });
  }

  // ---------- owner only ----------
  if (path.startsWith('/api/owner/')) {
    const se = await sessionFromRequest(req, env);
    if (!se) return fail(req, 401, 'Not signed in');
    const s = await getSettings(env);
    if (!isOwner(se.user, s)) return fail(req, 403, "This account isn't allowed here");
    return owner(req, env, path.slice(11), s, se);
  }

  return fail(req, 404, 'Not found');
}

async function ownerPage() {
  let html = '';
  try {
    const r = await fetch(OWNER_PAGE + '?t=' + Math.floor(Date.now() / 60000), { cf: { cacheTtl: 60 } });
    if (r.ok) html = await r.text();
  } catch (e) { }
  if (!html) html = '<!doctype html><meta name=viewport content="width=device-width"><p style="font:16px sans-serif;padding:20px">Could not load the dashboard page. Check your internet and reload.</p>';
  return new Response(html, { headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'x-frame-options': 'DENY',
    'referrer-policy': 'no-referrer', 'x-content-type-options': 'nosniff' } });
}

// ---------- key tests ----------
async function testKey(name, value) {
  try {
    let r;
    if (name === 'helius') {
      r = await fetch('https://mainnet.helius-rpc.com/?api-key=' + encodeURIComponent(value), { method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getHealth' }) });
      if (r.ok) { const j = await r.json(); if (j.result === 'ok') return { status: 'ok', note: 'Working' }; }
    } else if (name === 'stracker') {
      r = await fetch('https://data.solanatracker.io/price?token=' + SOL_MINT, { headers: { 'x-api-key': value } });
      if (r.ok) return { status: 'ok', note: 'Working' };
    } else if (name === 'birdeye') {
      r = await fetch('https://public-api.birdeye.so/defi/price?address=' + SOL_MINT, { headers: { 'X-API-KEY': value, 'x-chain': 'solana' } });
      if (r.ok) return { status: 'ok', note: 'Working' };
    } else return { status: 'error', note: 'Unknown key' };
    if (r.status === 401 || r.status === 403) return { status: 'error', note: 'Key rejected — check it was copied fully' };
    if (r.status === 429) return { status: 'warn', note: 'Limit reached — wait or upgrade the plan' };
    return { status: 'error', note: 'Answered ' + r.status };
  } catch (e) { return { status: 'error', note: 'Could not reach ' + KEY_NAMES[name] }; }
}
async function getKey(env, name) { const r = await env.DB.prepare('SELECT value FROM apikeys WHERE name = ?').bind(name).first(); return r ? r.value : ''; }
const mask = v => v ? '••••' + v.slice(-4) : '';

// parse "wallet name @handle" lines
function parseWallets(text) {
  const out = [], seen = new Set(); let bad = 0;
  for (const line of String(text || '').split(/\r?\n/)) {
    const parts = line.trim().split(/[\s,;|]+/).filter(Boolean);
    if (!parts.length) continue;
    const w = parts.find(isWallet);
    if (!w) { bad++; continue; }
    if (seen.has(w)) continue;
    seen.add(w);
    const rest = parts.filter(p => p !== w);
    const h = rest.find(p => /^@\w{1,30}$/.test(p));
    const name = rest.filter(p => p !== h && !/^(kol|smart)$/i.test(p)).join(' ').slice(0, 40);
    const forced = rest.find(p => /^(kol|smart)$/i.test(p));
    out.push({ wallet: w, name, handle: h ? h.slice(1) : '', kind: forced ? forced.toLowerCase() : (h ? 'kol' : 'smart') });
  }
  return { list: out, bad };
}

async function owner(req, env, route, s, se) {
  const DB = env.DB, t = now(), b = req.method === 'POST' ? await body(req) : {};
  const q = new URL(req.url).searchParams;

  if (route === 'home') {
    const today = dayOf(t), yest = dayOf(t - 86400);
    const one = async (sql, ...a) => { const r = await DB.prepare(sql).bind(...a).first(); return r ? Object.values(r)[0] || 0 : 0; };
    const out = {
      visitors: await one('SELECT COUNT(DISTINCT vid) FROM hits WHERE day = ?', today),
      visitorsY: await one('SELECT COUNT(DISTINCT vid) FROM hits WHERE day = ?', yest),
      online: await one('SELECT COUNT(DISTINCT vid) FROM hits WHERE ts > ?', t - 300),
      signups: await one('SELECT COUNT(*) FROM users WHERE created >= ?', t - (t % 86400)),
      signupsY: await one('SELECT COUNT(*) FROM users WHERE created >= ? AND created < ?', t - (t % 86400) - 86400, t - (t % 86400)),
      users: await one('SELECT COUNT(*) FROM users'),
      paid: await one("SELECT COUNT(*) FROM users WHERE plan != 'free' AND (plan = 'lifetime' OR plan_until > ?)", t),
      active: await one('SELECT COUNT(*) FROM users WHERE last_seen > ?', t - 86400),
      wallets: await one('SELECT COUNT(*) FROM site_wallets'),
      expiring: await one("SELECT COUNT(*) FROM users WHERE plan NOT IN ('free','lifetime') AND plan_until > ? AND plan_until < ?", t, t + 7 * 86400),
      errors: await one("SELECT COUNT(*) FROM events WHERE level = 'error' AND ts > ?", t - 86400),
      warns: await one("SELECT COUNT(*) FROM events WHERE level = 'warn' AND ts > ?", t - 86400),
      keysMissing: Object.keys(KEY_NAMES).length - await one('SELECT COUNT(*) FROM apikeys'),
      keysBad: await one("SELECT COUNT(*) FROM apikeys WHERE status IN ('error','warn')"),
      requests: await one('SELECT n FROM stats WHERE day = ? AND k = ?', today, 'req'),
      settings: { site_live: s.site_live, signups: s.signups, alerts: s.alerts }
    };
    out.issues = (await DB.prepare("SELECT ts, level, src, msg, fix FROM events WHERE level = 'error' AND ts > ? ORDER BY id DESC LIMIT 3").bind(t - 86400).all()).results;
    out.activity = (await DB.prepare('SELECT ts, level, src, msg FROM events ORDER BY id DESC LIMIT 8').all()).results;
    return json(req, { ok: true, home: out });
  }

  if (route === 'settings' && req.method === 'GET') {
    const out = { ...s };
    for (const k of Object.keys(out)) if (k.startsWith('salt_')) delete out[k];
    out.prices = JSON.parse(s.prices);
    out.signedInAgo = t - se.created;
    return json(req, { ok: true, settings: out });
  }
  if (route === 'settings' && req.method === 'POST') {
    const ch = b.changes || {};
    for (const [k, v] of Object.entries(ch)) {
      if (!(k in DEFAULTS)) return fail(req, 400, 'Unknown setting ' + k);
      if (SENSITIVE.includes(k) && t - se.created > FRESH_SIGNIN) return fail(req, 403, 'For safety, sign out and sign in again, then change this within 15 minutes');
      let val = v;
      if (['site_live', 'signups', 'payments', 'founder', 'alerts'].includes(k)) val = v === true || v === '1' || v === 1 ? '1' : '0';
      if (['founder_max', 'free_tokens', 'free_wallets', 'paid_wallets'].includes(k)) { val = Math.round(Number(v)); if (!(val >= 0 && val <= 1e6)) return fail(req, 400, 'Enter a number'); }
      if (k === 'prices') {
        const p = typeof v === 'string' ? JSON.parse(v) : v;
        for (const pk of Object.keys(PLANS)) if (!(Number(p[pk]) > 0 && Number(p[pk]) < 10000)) return fail(req, 400, 'Every price must be a number above 0');
        val = JSON.stringify(Object.fromEntries(Object.keys(PLANS).map(pk => [pk, Math.round(Number(p[pk]) * 1000) / 1000])));
      }
      if (k === 'pay_wallet' && !isWallet(String(v))) return fail(req, 400, 'Not a valid Solana wallet address');
      if (k === 'owner_wallets' && csv(v).some(w => !isWallet(w))) return fail(req, 400, 'One of the owner wallets is not valid');
      if (k === 'owner_emails' && csv(v).some(e => !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e))) return fail(req, 400, 'One of the owner emails is not valid');
      if (k === 'announce') val = String(v).slice(0, 140);
      if (k === 'google_client_id' && v && !/^[\w.-]+\.apps\.googleusercontent\.com$/.test(String(v).trim())) return fail(req, 400, 'That does not look like a Google client ID (it ends with .apps.googleusercontent.com)');
      await setSetting(env, k, typeof val === 'string' ? val.trim() : val);
      if (SENSITIVE.includes(k)) await logEvent(env, 'warn', 'settings', `Owner changed ${k.replace('_', ' ')}`);
    }
    return json(req, { ok: true });
  }

  // ---- API keys ----
  if (route === 'keys' && req.method === 'GET') {
    const rows = (await DB.prepare('SELECT * FROM apikeys').all()).results || [];
    const by = Object.fromEntries(rows.map(r => [r.name, r]));
    const today = dayOf(t);
    const st = Object.fromEntries(((await DB.prepare('SELECT k, n FROM stats WHERE day = ?').bind(today).all()).results || []).map(r => [r.k, r.n]));
    return json(req, { ok: true, keys: Object.entries(KEY_NAMES).map(([name, label]) => {
      const r = by[name];
      return { name, label, set: !!r, masked: r ? mask(r.value) : '', status: r ? r.status : 'missing', note: r ? r.note : '', checked: r ? r.checked : 0, callsToday: st['call_' + name] || 0 };
    }), requestsToday: st.req || 0 });
  }
  if (route === 'keys' && req.method === 'POST') {
    const name = String(b.name || '');
    if (!KEY_NAMES[name]) return fail(req, 400, 'Unknown key');
    if (b.remove) { await DB.prepare('DELETE FROM apikeys WHERE name = ?').bind(name).run(); await logEvent(env, 'warn', 'keys', `${KEY_NAMES[name]} key removed`); return json(req, { ok: true }); }
    let value = b.value === undefined ? await getKey(env, name) : String(b.value).trim();
    if (!value) return fail(req, 400, 'Paste the key first');
    if (value.length > 200 || /\s/.test(value)) return fail(req, 400, 'That key has spaces or is too long — copy it again');
    const res = await testKey(name, value);
    await bump(env, 'call_' + name);
    await DB.prepare(`INSERT INTO apikeys(name, value, updated, status, checked, note) VALUES(?, ?, ?, ?, ?, ?)
      ON CONFLICT(name) DO UPDATE SET value = excluded.value, updated = CASE WHEN apikeys.value = excluded.value THEN apikeys.updated ELSE excluded.updated END,
      status = excluded.status, checked = excluded.checked, note = excluded.note`).bind(name, value, t, res.status, t, res.note).run();
    if (b.value !== undefined) await logEvent(env, 'info', 'keys', `${KEY_NAMES[name]} key saved`);
    if (res.status !== 'ok') await logEvent(env, res.status === 'warn' ? 'warn' : 'error', 'keys', `${KEY_NAMES[name]}: ${res.note}`, res.status === 'warn' ? 'Wait for the limit to reset, or upgrade that plan' : 'Open Keys and paste a fresh key');
    return json(req, { ok: true, result: res, masked: mask(value) });
  }

  // ---- health ----
  if (route === 'health') {
    let db = 'ok';
    try { await DB.prepare('SELECT 1').first(); } catch (e) { db = 'error'; }
    const run = q.get('run') === '1';
    const keys = [];
    for (const [name, label] of Object.entries(KEY_NAMES)) {
      const r = await DB.prepare('SELECT * FROM apikeys WHERE name = ?').bind(name).first();
      if (!r) { keys.push({ name, label, status: 'missing', note: 'Not added' }); continue; }
      if (run) {
        const res = await testKey(name, r.value);
        await bump(env, 'call_' + name);
        await DB.prepare('UPDATE apikeys SET status = ?, checked = ?, note = ? WHERE name = ?').bind(res.status, t, res.note, name).run();
        if (res.status !== 'ok') await logEvent(env, res.status === 'warn' ? 'warn' : 'error', 'health', `${label}: ${res.note}`, res.status === 'warn' ? 'Wait for the limit to reset, or upgrade that plan' : 'Open Keys and paste a fresh key');
        keys.push({ name, label, ...res, checked: t });
      } else keys.push({ name, label, status: r.status, note: r.note, checked: r.checked });
    }
    const st = await DB.prepare('SELECT n FROM stats WHERE day = ? AND k = ?').bind(dayOf(t), 'req').first();
    const events = (await DB.prepare("SELECT ts, level, src, msg, fix FROM events WHERE level IN ('error','warn') ORDER BY id DESC LIMIT 30").all()).results;
    if (run) await logEvent(env, 'info', 'health', 'Full check run');
    return json(req, { ok: true, health: { server: 'ok', db, keys, requestsToday: st ? st.n : 0, events } });
  }
  if (route === 'events/clear' && req.method === 'POST') {
    await DB.prepare("DELETE FROM events WHERE level IN ('error','warn')").run();
    return json(req, { ok: true });
  }

  // ---- main wallet ----
  if (route === 'wallet') {
    const w = s.pay_wallet, key = await getKey(env, 'helius');
    let sol = null, err = '';
    if (!key) err = 'Add your Helius key (More → Keys) to see the live balance';
    else {
      try {
        const r = await fetch('https://mainnet.helius-rpc.com/?api-key=' + encodeURIComponent(key), { method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getBalance', params: [w] }) });
        await bump(env, 'call_helius');
        const j = r.ok ? await r.json() : null;
        if (j && j.result && typeof j.result.value === 'number') sol = j.result.value / 1e9; else err = 'Helius did not answer (' + r.status + ')';
      } catch (e) { err = 'Could not reach Helius'; }
    }
    const sold = await DB.prepare("SELECT COUNT(*) n FROM users WHERE plan = 'lifetime'").first();
    return json(req, { ok: true, wallet: { address: w, sol, error: err, founderSold: sold ? sold.n : 0, founderMax: Number(s.founder_max) } });
  }

  // ---- site wallets ----
  if (route === 'wallets' && req.method === 'GET') {
    const kind = q.get('kind') || 'all', sort = q.get('sort') || 'new', search = (q.get('q') || '').trim();
    const off = Math.max(0, Number(q.get('offset')) || 0), lim = Math.min(200, Math.max(1, Number(q.get('limit')) || 10));
    const where = [], args = [];
    if (kind === 'kol' || kind === 'smart') { where.push('kind = ? AND hidden = 0'); args.push(kind); }
    else if (kind === 'hidden') where.push('hidden = 1');
    if (search) { where.push('(wallet LIKE ? OR name LIKE ? OR handle LIKE ?)'); const l = '%' + search.replace(/^@/, '').replace(/[%_]/g, '') + '%'; args.push(l, l, l); }
    const w = where.length ? 'WHERE ' + where.join(' AND ') : '';
    const order = { new: 'added DESC', old: 'added ASC', name: "CASE WHEN name = '' THEN 1 ELSE 0 END, name COLLATE NOCASE ASC", kind: 'kind ASC, added DESC' }[sort] || 'added DESC';
    const total = await DB.prepare(`SELECT COUNT(*) n FROM site_wallets ${w}`).bind(...args).first();
    const rows = (await DB.prepare(`SELECT * FROM site_wallets ${w} ORDER BY ${order} LIMIT ? OFFSET ?`).bind(...args, lim, off).all()).results;
    const sum = await DB.prepare("SELECT COUNT(*) total, SUM(kind = 'kol' AND hidden = 0) kol, SUM(kind = 'smart' AND hidden = 0) smart, SUM(hidden) hidden FROM site_wallets").first();
    return json(req, { ok: true, total: total.n, rows, summary: { total: sum.total || 0, kol: sum.kol || 0, smart: sum.smart || 0, hidden: sum.hidden || 0 } });
  }
  if (route === 'wallets/add' && req.method === 'POST') {
    const { list, bad } = parseWallets(b.text);
    if (list.length > 20000) return fail(req, 400, 'Too many lines at once — split into files of 20,000');
    const existing = new Set();
    for (let i = 0; i < list.length; i += 90) {
      const chunk = list.slice(i, i + 90);
      const r = await DB.prepare(`SELECT wallet FROM site_wallets WHERE wallet IN (${chunk.map(() => '?').join(',')})`).bind(...chunk.map(x => x.wallet)).all();
      for (const row of r.results || []) existing.add(row.wallet);
    }
    const fresh = list.filter(x => !existing.has(x.wallet));
    const res = { add: fresh.length, dup: list.length - fresh.length, bad, kol: fresh.filter(x => x.kind === 'kol').length, smart: fresh.filter(x => x.kind === 'smart').length };
    if (b.dry) return json(req, { ok: true, preview: res });
    const src = ['manual', 'upload', 'leaderboard', 'lab', 'addon', 'suggestion'].includes(b.source) ? b.source : 'manual';
    for (let i = 0; i < fresh.length; i += 50)
      await DB.batch(fresh.slice(i, i + 50).map(x => DB.prepare('INSERT OR IGNORE INTO site_wallets(wallet, name, handle, kind, source, added) VALUES(?, ?, ?, ?, ?, ?)')
        .bind(x.wallet, x.name, x.handle, x.kind, src, t)));
    if (fresh.length) await logEvent(env, 'info', 'wallets', `${fresh.length} wallet${fresh.length > 1 ? 's' : ''} added (${src})`);
    return json(req, { ok: true, result: res });
  }
  if (route === 'wallets/edit' && req.method === 'POST') {
    if (!isWallet(b.wallet)) return fail(req, 400, 'Not a valid wallet');
    const kind = b.kind === 'kol' ? 'kol' : 'smart';
    await DB.prepare('UPDATE site_wallets SET name = ?, handle = ?, kind = ?, hidden = ? WHERE wallet = ?')
      .bind(String(b.name || '').slice(0, 40), String(b.handle || '').replace(/^@/, '').slice(0, 30), kind, b.hidden ? 1 : 0, b.wallet).run();
    return json(req, { ok: true });
  }
  if (route === 'wallets/delete' && req.method === 'POST') {
    let n = 0;
    if (b.all) {
      if (b.confirm !== 'DELETE') return fail(req, 400, 'Type DELETE to confirm');
      const r = await DB.prepare('DELETE FROM site_wallets').run(); n = r.meta ? r.meta.changes : 0;
    } else if (b.hidden) {
      const r = await DB.prepare('DELETE FROM site_wallets WHERE hidden = 1').run(); n = r.meta ? r.meta.changes : 0;
    } else {
      const ws = (Array.isArray(b.wallets) ? b.wallets : []).filter(isWallet);
      for (let i = 0; i < ws.length; i += 90) {
        const r = await DB.prepare(`DELETE FROM site_wallets WHERE wallet IN (${ws.slice(i, i + 90).map(() => '?').join(',')})`).bind(...ws.slice(i, i + 90)).run();
        n += r.meta ? r.meta.changes : 0;
      }
    }
    if (n) await logEvent(env, 'warn', 'wallets', `${n} wallet${n > 1 ? 's' : ''} deleted`);
    return json(req, { ok: true, deleted: n });
  }
  if (route === 'wallets/restore' && req.method === 'POST') {
    const rows = (Array.isArray(b.rows) ? b.rows : []).filter(r => r && isWallet(r.wallet)).slice(0, 5000);
    for (let i = 0; i < rows.length; i += 50)
      await DB.batch(rows.slice(i, i + 50).map(x => DB.prepare('INSERT OR IGNORE INTO site_wallets(wallet, name, handle, kind, source, hidden, added) VALUES(?, ?, ?, ?, ?, ?, ?)')
        .bind(x.wallet, String(x.name || ''), String(x.handle || ''), x.kind === 'kol' ? 'kol' : 'smart', String(x.source || 'manual'), x.hidden ? 1 : 0, Number(x.added) || t)));
    return json(req, { ok: true, restored: rows.length });
  }
  if (route === 'wallets/export') {
    const rows = (await DB.prepare('SELECT wallet, name, handle, kind, hidden FROM site_wallets ORDER BY added').all()).results || [];
    const text = rows.map(r => [r.wallet, r.name, r.handle ? '@' + r.handle : '', r.handle ? '' : r.kind === 'kol' ? 'kol' : ''].filter(Boolean).join(' ')).join('\n');
    return json(req, { ok: true, count: rows.length, text });
  }
  if (route === 'wallets/balances' && req.method === 'POST') {
    const ws = (Array.isArray(b.wallets) ? b.wallets : []).filter(isWallet).slice(0, 100);
    const key = await getKey(env, 'helius');
    if (!key) return json(req, { ok: true, balances: {}, error: 'Add your Helius key to see balances' });
    const r = await fetch('https://mainnet.helius-rpc.com/?api-key=' + encodeURIComponent(key), { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getMultipleAccounts', params: [ws, { encoding: 'base64', dataSlice: { offset: 0, length: 0 } }] }) });
    await bump(env, 'call_helius');
    const j = r.ok ? await r.json() : null;
    if (!j || !j.result) return json(req, { ok: true, balances: {}, error: 'Helius did not answer (' + r.status + ')' });
    const out = {};
    ws.forEach((w, i) => { const a = j.result.value[i]; out[w] = a ? a.lamports / 1e9 : 0; });
    return json(req, { ok: true, balances: out });
  }

  // ---- users ----
  if (route === 'users' && req.method === 'GET') {
    const f = q.get('filter') || 'all', search = (q.get('q') || '').trim();
    const off = Math.max(0, Number(q.get('offset')) || 0), lim = Math.min(100, Number(q.get('limit')) || 20);
    const where = [], args = [];
    if (f === 'paid') { where.push("plan != 'free' AND (plan = 'lifetime' OR plan_until > ?)"); args.push(t); }
    if (f === 'free') { where.push("(plan = 'free' OR (plan != 'lifetime' AND plan_until <= ?))"); args.push(t); }
    if (f === 'expiring') { where.push("plan NOT IN ('free','lifetime') AND plan_until > ? AND plan_until < ?"); args.push(t, t + 7 * 86400); }
    if (f === 'blocked') where.push('blocked = 1'); else where.push('blocked = 0');
    if (search) { where.push('(wallet LIKE ? OR email LIKE ? OR name LIKE ?)'); const l = '%' + search.replace(/[%_]/g, '') + '%'; args.push(l, l, l); }
    const w = 'WHERE ' + where.join(' AND ');
    const total = await DB.prepare(`SELECT COUNT(*) n FROM users ${w}`).bind(...args).first();
    const rows = (await DB.prepare(`SELECT * FROM users ${w} ORDER BY last_seen DESC LIMIT ? OFFSET ?`).bind(...args, lim, off).all()).results || [];
    const counts = await DB.prepare(`SELECT COUNT(*) total, SUM(plan != 'free' AND (plan = 'lifetime' OR plan_until > ?)) paid, SUM(blocked) blocked,
      SUM(plan NOT IN ('free','lifetime') AND plan_until > ? AND plan_until < ?) expiring FROM users`).bind(t, t, t + 7 * 86400).first();
    return json(req, { ok: true, total: total.n, counts, users: rows.map(u => ({ ...publicUser(u, s), lastSeen: u.last_seen, via: u.via, blocked: u.blocked, rawPlan: u.plan, rawUntil: u.plan_until })) });
  }
  if (route === 'users/action' && req.method === 'POST') {
    const u = await DB.prepare('SELECT * FROM users WHERE id = ?').bind(Number(b.id)).first();
    if (!u) return fail(req, 404, 'User not found');
    const who = u.email || (u.wallet ? u.wallet.slice(0, 4) + '…' + u.wallet.slice(-4) : '#' + u.id);
    if (b.action === 'give') {
      const p = PLANS[b.plan];
      if (!p) return fail(req, 400, 'Pick a plan');
      const until = b.plan === 'lifetime' ? 0 : t + p.days * 86400;
      await DB.prepare('UPDATE users SET plan = ?, plan_until = ? WHERE id = ?').bind(b.plan, until, u.id).run();
      await logEvent(env, 'info', 'users', `Gave ${p.name} to ${who}`);
    } else if (b.action === 'extend') {
      const days = Math.round(Number(b.days));
      if (!(days > 0 && days <= 3650)) return fail(req, 400, 'Enter days between 1 and 3650');
      if (u.plan === 'lifetime') return fail(req, 400, 'This user already has lifetime');
      const base = planActive(u) ? u.plan_until : t, plan = planActive(u) ? u.plan : 'm1';
      await DB.prepare('UPDATE users SET plan = ?, plan_until = ? WHERE id = ?').bind(plan, base + days * 86400, u.id).run();
      await logEvent(env, 'info', 'users', `Extended ${who} by ${days} days`);
    } else if (b.action === 'free') {
      await DB.prepare("UPDATE users SET plan = 'free', plan_until = 0 WHERE id = ?").bind(u.id).run();
      await logEvent(env, 'warn', 'users', `Moved ${who} to Free`);
    } else if (b.action === 'block' || b.action === 'unblock') {
      if (b.action === 'block' && isOwner(u, s)) return fail(req, 400, "You can't block an owner account");
      await DB.prepare('UPDATE users SET blocked = ? WHERE id = ?').bind(b.action === 'block' ? 1 : 0, u.id).run();
      if (b.action === 'block') await DB.prepare('DELETE FROM sessions WHERE user_id = ?').bind(u.id).run();
      await logEvent(env, 'warn', 'users', `${b.action === 'block' ? 'Blocked' : 'Unblocked'} ${who}`);
    } else return fail(req, 400, 'Unknown action');
    return json(req, { ok: true });
  }

  // ---- traffic ----
  if (route === 'traffic') {
    const days = Math.min(90, Math.max(1, Number(q.get('days')) || 7));
    const from = dayOf(t - (days - 1) * 86400);
    const all = async (sql, ...a) => (await DB.prepare(sql).bind(...a).all()).results || [];
    const one = async (sql, ...a) => { const r = await DB.prepare(sql).bind(...a).first(); return r ? Object.values(r)[0] || 0 : 0; };
    const prevFrom = dayOf(t - (2 * days - 1) * 86400);
    const uniq = await one('SELECT COUNT(DISTINCT day || vid) FROM hits WHERE day >= ?', from);
    const uniqPrev = await one('SELECT COUNT(DISTINCT day || vid) FROM hits WHERE day >= ? AND day < ?', prevFrom, from);
    const views = await one('SELECT COUNT(*) FROM hits WHERE day >= ?', from);
    const visits = await all('SELECT COUNT(*) c, MAX(ts) - MIN(ts) d FROM hits WHERE day >= ? GROUP BY day, vid', from);
    const bounce = visits.length ? Math.round(100 * visits.filter(v => v.c === 1).length / visits.length) : 0;
    const time = visits.length ? Math.round(visits.reduce((a, v) => a + v.d, 0) / visits.length) : 0;
    const perDay = await all('SELECT day, COUNT(DISTINCT vid) u, COUNT(*) v FROM hits WHERE day >= ? GROUP BY day ORDER BY day', from);
    const top = async col => all(`SELECT ${col} k, COUNT(DISTINCT day || vid) n FROM hits WHERE day >= ? GROUP BY ${col} ORDER BY n DESC LIMIT 6`, from);
    const inst = await one('SELECT COUNT(DISTINCT day || vid) FROM hits WHERE day >= ? AND inst = 1', from);
    const signups = await one('SELECT COUNT(*) FROM users WHERE created >= ?', Date.parse(from) / 1000);
    const paid = await one("SELECT COUNT(*) FROM users WHERE created >= ? AND plan != 'free' AND (plan = 'lifetime' OR plan_until > ?)", Date.parse(from) / 1000, t);
    return json(req, { ok: true, traffic: { days, uniq, uniqPrev, views, bounce, time, live: await one('SELECT COUNT(DISTINCT vid) FROM hits WHERE ts > ?', t - 300),
      perDay, sources: await top("CASE WHEN ref = '' THEN 'Direct' ELSE ref END"), countries: await top('country'), devices: await top('device'), pages: await top('path'),
      installed: uniq ? Math.round(100 * inst / uniq) : 0, funnel: { visited: uniq, signedUp: signups, paid } } });
  }

  return fail(req, 404, 'Not found');
}
