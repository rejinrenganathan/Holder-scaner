// Holder Scan API — accounts, sign-in, owner dashboard (public version, build 2)
// Runs on a Cloudflare Worker with a D1 database bound as DB. Setup steps: server.html in this repo.
//
// Sign in with a Solana wallet: the app asks for a one-time message (nonce), the wallet signs it
// (no transaction, no fee), and the Worker checks the signature. Then it hands out a session token.
// Owner dashboard: open <this worker's address>/owner

const API_V = 6;
// Owner wallet(s) — always allowed into the dashboard. More owners can be added in Site control.
const OWNER_WALLETS = 'CZQkA9JszBPP7x2LescrtZwh1LGoxZwnW68wLbdFPz93';
// Sites allowed to call this API from a browser
const ORIGINS = ['https://rejinrenganathan.github.io'];
const APP_URI = 'https://rejinrenganathan.github.io/Holder-scaner/';
const OWNER_PAGE = 'https://rejinrenganathan.github.io/Holder-scaner/server/owner.html';
const LAB_PAGE = 'https://rejinrenganathan.github.io/Holder-scaner/lab.html';
const NONCE_TTL = 10 * 60;          // a sign-in message is valid for 10 minutes, once
const SESSION_DAYS = 30;            // stay signed in for 30 days
const FRESH_SIGNIN = 15 * 60;       // changing payment wallet / owners needs a sign-in from the last 15 minutes
// home-screen icon for the owner dashboard (PNG, base64)
const ICON_512 = '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';
const ICON_180 = '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';
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
  // plain text on purpose: Phantom strictly checks messages written in the "Sign in with Solana" format
  return `Sign in to Holder Scan\n\nWallet: ${wallet}\nNonce: ${nonce}\nTime: ${new Date(issued * 1000).toISOString()}\n\n` +
    `This only proves you own this wallet. It costs nothing and sends no transaction.`;
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
  if (path === '/owner') return ownerPage(OWNER_PAGE, ctx);
  if (path === '/owner/lab') return ownerPage(LAB_PAGE, ctx);
  if (path === '/owner/hit.js') return new Response('', { headers: { 'content-type': 'text/javascript' } });
  if (path === '/owner/manifest.webmanifest') return new Response(JSON.stringify({ name: 'Holder Scan Owner', short_name: 'HS Owner', start_url: '/owner', scope: '/owner', display: 'standalone',
    background_color: '#000000', theme_color: '#000000', icons: [{ src: '/owner/icon.png', sizes: '512x512', type: 'image/png', purpose: 'any maskable' }, { src: '/owner/icon-180.png', sizes: '180x180', type: 'image/png' }] }),
    { headers: { 'content-type': 'application/manifest+json', 'cache-control': 'public, max-age=3600' } });
  if (path === '/owner/icon.png' || path === '/owner/icon-180.png' || path === '/owner/icon.svg')
    return new Response(Uint8Array.from(atob(path === '/owner/icon-180.png' ? ICON_180 : ICON_512), c => c.charCodeAt(0)), { headers: { 'content-type': 'image/png', 'cache-control': 'public, max-age=86400' } });
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

// page cache: answer instantly from memory, refresh from GitHub in the background every 30 s
const PAGE_CACHE = {};
async function fetchPage(url) {
  try { const r = await fetch(url + '?t=' + Math.floor(Date.now() / 30000)); if (r.ok) { const h = await r.text(); PAGE_CACHE[url] = { h, t: Date.now() }; return h; } } catch (e) { }
  return '';
}
async function ownerPage(url, ctx) {
  const c = PAGE_CACHE[url];
  let html = c ? c.h : '';
  if (!c) html = await fetchPage(url);
  else if (Date.now() - c.t > 30000) { const p = fetchPage(url); if (ctx && ctx.waitUntil) ctx.waitUntil(p); }
  if (!html) html = '<!doctype html><meta name=viewport content="width=device-width"><p style="font:16px sans-serif;padding:20px">Could not load the dashboard page. Check your internet and reload.</p>';
  return new Response(html, { headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'x-frame-options': 'SAMEORIGIN', 'content-security-policy': "frame-ancestors 'self'",
    'referrer-policy': 'no-referrer', 'x-content-type-options': 'nosniff' } });
}

// SOL price (CoinGecko, no key) — remembered for 5 minutes
let PX = { t: 0, inr: null, usd: null };
async function solPrice() {
  if (Date.now() - PX.t < 300000) return PX;
  try { const r = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=inr,usd', { headers: { accept: 'application/json' } });
    const j = r.ok ? await r.json() : null; if (j && j.solana) PX = { t: Date.now(), inr: j.solana.inr ?? null, usd: j.solana.usd ?? null }; } catch (e) { }
  return PX;
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
    const today = dayOf(t), yest = dayOf(t - 86400), mid = t - (t % 86400);
    const q1 = [
      ['visitors', 'SELECT COUNT(DISTINCT vid) n FROM hits WHERE day = ?', today], ['visitorsY', 'SELECT COUNT(DISTINCT vid) n FROM hits WHERE day = ?', yest],
      ['online', 'SELECT COUNT(DISTINCT vid) n FROM hits WHERE ts > ?', t - 300], ['signups', 'SELECT COUNT(*) n FROM users WHERE created >= ?', mid],
      ['signupsY', 'SELECT COUNT(*) n FROM users WHERE created >= ? AND created < ?', mid - 86400, mid], ['users', 'SELECT COUNT(*) n FROM users'],
      ['paid', "SELECT COUNT(*) n FROM users WHERE plan != 'free' AND (plan = 'lifetime' OR plan_until > ?)", t], ['active', 'SELECT COUNT(*) n FROM users WHERE last_seen > ?', t - 86400],
      ['wallets', 'SELECT COUNT(*) n FROM site_wallets'], ['expiring', "SELECT COUNT(*) n FROM users WHERE plan NOT IN ('free','lifetime') AND plan_until > ? AND plan_until < ?", t, t + 7 * 86400],
      ['errors', "SELECT COUNT(*) n FROM events WHERE level = 'error' AND ts > ?", t - 86400], ['warns', "SELECT COUNT(*) n FROM events WHERE level = 'warn' AND ts > ?", t - 86400],
      ['keys', 'SELECT COUNT(*) n FROM apikeys'], ['keysBad', "SELECT COUNT(*) n FROM apikeys WHERE status IN ('error','warn')"], ['requests', 'SELECT n FROM stats WHERE day = ? AND k = ?', today, 'req'],
      ['issues', "SELECT ts, level, src, msg, fix FROM events WHERE level = 'error' AND ts > ? ORDER BY id DESC LIMIT 3", t - 86400], ['activity', 'SELECT ts, level, src, msg FROM events ORDER BY id DESC LIMIT 8']];
    const res = await DB.batch(q1.map(([, sql, ...a]) => DB.prepare(sql).bind(...a)));   // one trip to the database
    const out = { settings: { site_live: s.site_live, signups: s.signups, alerts: s.alerts } };
    q1.forEach(([k], i) => { const rows = res[i].results || []; out[k] = k === 'issues' || k === 'activity' ? rows : (rows[0] ? rows[0].n || 0 : 0); });
    out.keysMissing = Object.keys(KEY_NAMES).length - out.keys;
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
    const px = await solPrice();
    return json(req, { ok: true, wallet: { address: w, sol, error: err, founderSold: sold ? sold.n : 0, founderMax: Number(s.founder_max), inr: px.inr, usd: px.usd } });
  }

  // ---- key-safe pass-through for the dashboard's leaderboards and Winner Lab (keys never leave the server) ----
  if (route === 'proxy' && req.method === 'POST') {
    const svc = b.svc;
    let upstream;
    if (svc === 'st' || svc === 'be') {
      const p = String(b.path || '');
      const okPath = svc === 'st' ? /^\/(v2\/pnl\/|tokens\/|chart\/|price|search|deployer\/|first-buyers\/|pnl\/|top-traders\/)/ : /^\/(trader\/gainers-losers|defi\/price|defi\/v3\/token\/)/;
      if (!okPath.test(p) || p.length > 600) return fail(req, 400, 'This request is not allowed');
      const key = await getKey(env, svc === 'st' ? 'stracker' : 'birdeye');
      if (!key) return fail(req, 400, `Add your ${svc === 'st' ? 'Solana Tracker' : 'Birdeye'} key in More → API keys`);
      upstream = await fetch((svc === 'st' ? 'https://data.solanatracker.io' : 'https://public-api.birdeye.so') + p,
        { headers: svc === 'st' ? { 'x-api-key': key, accept: 'application/json' } : { 'X-API-KEY': key, 'x-chain': 'solana', accept: 'application/json' } });
      await bump(env, svc === 'st' ? 'call_stracker' : 'call_birdeye');
    } else if (svc === 'hel') {
      const allowed = ['getSignaturesForAddress', 'getTransaction', 'getMultipleAccounts', 'getBalance', 'getAccountInfo', 'getTokenAccountsByOwner', 'getTokenLargestAccounts', 'getAsset'];
      if (!allowed.includes(b.method)) return fail(req, 400, 'This request is not allowed');
      const key = await getKey(env, 'helius');
      if (!key) return fail(req, 400, 'Add your Helius key in More → API keys');
      upstream = await fetch('https://mainnet.helius-rpc.com/?api-key=' + encodeURIComponent(key), { method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: b.method, params: Array.isArray(b.params) ? b.params : [] }) });
      await bump(env, 'call_helius');
    } else return fail(req, 400, 'Unknown service');
    // body is streamed through untouched (no parsing = little server time); the real status rides in a header
    return new Response(upstream.body, { status: 200, headers: { 'content-type': 'application/json', 'cache-control': 'no-store', 'x-up': String(upstream.status), ...cors(req) } });
  }
  if (route === 'wallets/ids') {
    const rows = (await DB.prepare('SELECT wallet FROM site_wallets').all()).results || [];
    return json(req, { ok: true, ids: rows.map(r => r.wallet) });
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
    const from = dayOf(t - (days - 1) * 86400), prevFrom = dayOf(t - (2 * days - 1) * 86400), fromTs = Date.parse(from) / 1000;
    const top = col => `SELECT ${col} k, COUNT(DISTINCT day || vid) n FROM hits WHERE day >= ? GROUP BY ${col} ORDER BY n DESC LIMIT 6`;
    const Q = [
      ['uniq', 'SELECT COUNT(DISTINCT day || vid) n FROM hits WHERE day >= ?', from], ['uniqPrev', 'SELECT COUNT(DISTINCT day || vid) n FROM hits WHERE day >= ? AND day < ?', prevFrom, from],
      ['views', 'SELECT COUNT(*) n FROM hits WHERE day >= ?', from],
      ['visits', 'SELECT COUNT(*) v, SUM(c = 1) b, SUM(d) d FROM (SELECT COUNT(*) c, MAX(ts) - MIN(ts) d FROM hits WHERE day >= ? GROUP BY day, vid)', from],
      ['perDay', 'SELECT day, COUNT(DISTINCT vid) u, COUNT(*) v FROM hits WHERE day >= ? GROUP BY day ORDER BY day', from],
      ['sources', top("CASE WHEN ref = '' THEN 'Direct' ELSE ref END"), from], ['countries', top('country'), from], ['devices', top('device'), from], ['pages', top('path'), from],
      ['inst', 'SELECT COUNT(DISTINCT day || vid) n FROM hits WHERE day >= ? AND inst = 1', from], ['live', 'SELECT COUNT(DISTINCT vid) n FROM hits WHERE ts > ?', t - 300],
      ['signups', 'SELECT COUNT(*) n FROM users WHERE created >= ?', fromTs], ['paid', "SELECT COUNT(*) n FROM users WHERE created >= ? AND plan != 'free' AND (plan = 'lifetime' OR plan_until > ?)", fromTs, t]];
    const res = await DB.batch(Q.map(([, sql, ...a]) => DB.prepare(sql).bind(...a)));
    const R = {}; Q.forEach(([k], i) => { R[k] = res[i].results || []; });
    const n = k => (R[k][0] && R[k][0].n) || 0, V = R.visits[0] || {}, uniq = n('uniq');
    return json(req, { ok: true, traffic: { days, uniq, uniqPrev: n('uniqPrev'), views: n('views'), bounce: V.v ? Math.round(100 * (V.b || 0) / V.v) : 0, time: V.v ? Math.round((V.d || 0) / V.v) : 0,
      live: n('live'), perDay: R.perDay, sources: R.sources, countries: R.countries, devices: R.devices, pages: R.pages,
      installed: uniq ? Math.round(100 * n('inst') / uniq) : 0, funnel: { visited: uniq, signedUp: n('signups'), paid: n('paid') } } });
  }

  return fail(req, 404, 'Not found');
}
