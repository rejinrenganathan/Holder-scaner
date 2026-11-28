// Holder Scan API — accounts, sign-in, owner dashboard (public version, build 2)
// Runs on a Cloudflare Worker with a D1 database bound as DB. Setup steps: server.html in this repo.
//
// Sign in with a Solana wallet: the app asks for a one-time message (nonce), the wallet signs it
// (no transaction, no fee), and the Worker checks the signature. Then it hands out a session token.
// Owner dashboard: open <this worker's address>/owner
//
// Plan payments (build 8): the app asks for a payment (/api/pay/start) and gets a one-time reference key. The wallet sends exactly
// the plan price to the payment wallet with that key attached. The server finds the transfer by the key on Helius, checks recipient,
// exact amount, confirmation and that the signature was never used before, then turns the plan on. A cron re-checks every 5 minutes.

const API_V = 14;
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
const ICON_180 = 'iVBORw0KGgoAAAANSUhEUgAAALQAAAC0CAIAAACyr5FlAAANEklEQVR42u2dbYxdxXnH/8/MnHPu2+5d7zsYYxsb2xAXDA6CQCBJBaS0hBKTQEOTVn355FSK2rSq+iX91jRqpEqNolaoQo3aJG2VQkSAJgIMCUkIJJgE+QUvBgMGm921d+/e93POzDz9sDSkFXv3evf6Xvvu89P9eHfP1ZnfmXnmmTnzUC5XgCC8F0pugSByCCKHIHIIIocgcggihyByCCKHIHIIIocgiByCyCGIHILIIYgcgsghiBzCeY6RW9DFJ5Ha+ppnkWPNQEQKbNnXUjDQwhAGiFRWkyb2DBY5+lsMTb7pXGp1IcpdPQqFVk1OxKmPXyrZeqKiQAWKe9qLiBxn1wxbSTKXDA596pL8dePR1gEQtexiwJabL5VqP5qZ+8Yr9u26HgjZ9cwPklcTzqYZ8dCdmyf/6gozmfV1y7FH66GCASLKaJXTybHqyS/sr3z/hBmIeuWHDoJQGvJsxJ6+mq7bs2n9311DWrmFBMwgauMDpN5XrR6OirdtaB4sxS+XKaN7En+IHGclP8Cxz2wvXvTV6+GYE09GtR5Q/n8Aq4ljR5HOf2C88t23fNWSJslz9MnshFM3uneHKhgfe6yoXckoX0/DDfmRP7zUxykpkaMf1IBPnJnM53aN+PqqnnjSytdt/rpxUwjZMkjkON/dUOQTl792LFif48SvqkUJHLtw62DmimHfdOh65yFynAUYKmc605YMCoiyBswyrPQLHUxecc8S6pIEO5eGJCZiAgEMJmZiSZ+LE0RMrDg1qTUpmEBsbBDYgDwRk8ixVnMiXqdBnARJkIbjcxNj8xNWW+PM9MjJU+tm0ijJ6IKGFjnWnhmsqrnyxOnJK4+8/4YXbhpeGC1Wh5zy2qvSwPzpodmndz15cPeBKSqpXkSHIkfvUmWMeqb+4Z/esufx31lXHrE6TY2tZWvExMTZOLfprS1bj22fe37+H8k/hPsKXPRwkPT5+Z7nyO4cHrjlQt9wS2U2iamaq3z8ibt/76E/ZoVG1PDaA0ysCERMnrwzLo7iTCW6tbinhurzJ56Mgmw3d3mIHD2QQ7FqRPWP77vnrsfuLRfKTKxYEehXNwItrsIpVk67JscfvuiOqqvun34yMt3zQ/Ic3UZ7Xc1Wbnr+5k9+73cr+bLyqvV8ZNGbhXjhz3d/+eaN99SSBU1G5OhHmOIgHp+7YM/j99RytTanqQQCUEsbn73ySyO5CxLfPIM1XpHjPJqepEGy66XdwwsjVqft5zAUqdg11xc2Xjf50cTG3Zm8iBxd7jhckIbX//ym1KTE6gyX4cixu33z7yuluCtLLSJHNxfzKTV2fG5ipDRqTXqmqU+CSlxyYeGSidyG1McEEjn6Kk2e6nRsfqJYHXLKrWAPUcrJWG79ZG5j6mMikaPvOg+r7QrMeHdk8an1CUEC0j7c6QHtjPJ6pX/OWgVGhd1JdYgc3YxGOXRmZuTkwsC8duZMV1uZOVDRTP34idqrocp0ISZVa76bV8t/OtSHM9hYc2po5tTQrHEBzvDpZ/hQBW9WXpltnDAq6kLnsVYX3pQGCDaGt8s0PQMmhArAHuxXHZPqNKj/8Oqntr1+WTOqE+szG1NIf+fV+7331JV9g2YNroaCFBoL8EBxEtkhcIu3mxkEVN5GtYRQIxyAt6u5uFc+TKMXt70wu266UB902rY5ofXsMzr7evnl56afCE3k4SFL9h1fFoO3SCrYcScuvwNbbkZ+Eh5LZqOZoRhzU5h6FAe+jTeeQa4I9lh5l85hGp5aN/2tW7+x99//rJxf+GV2vPWAQkQZk/nKL/5ivjFTCIuOLWRVtsNm2Bg6wp3/jNv+BhdfhaAI1tAaSi3x0YDG4DguvQFX3AtSOPoYTNAiCll2VZaJoyRzbMPRRqa2+/C1aRCDWvnhyRNRIRj44k/3fvfY1wfComMnS/adjj3ZQWdw74O4+rdRs0g9uL18gWPEDirCr30EahBTj8KES3Ue7SzZM3GYRgcu/UUcNt9/8ANeO6vt/66w0S+/w8Re+dBGeVX42+f3PnDknwai7pmxluRQGnEdv/UPuOYulGLoELT4/mobHyIoBWY0LS67Aadew/HnEGbfMyZsc7MPE2fSzOFLDpwYP77l+Lbh8rD2ZtGGxWsaZ6I0EzWj0xtPf/Ho3keeu38gP9RNM9ZMzEEazQo234hr/wgVCxOtMJJVGg2Pm7+EqUeQVKH0auYMnnyukf/JlT88sunQzqNXfXD/h8bmJ4bKw1455fVc8dTs8PQPdu176arDL372eznkHTnIHtKzMkNxHts+BkOIV5G2IAXrMDyKi2/AoW8jO4jVPcpe+Xy9UM/Wnr563492PTVaGhtZGLXKGa9n183MFU97dtmoUOBiGZXu7zE2a+PVZotcEdvvQAqQ6oBq7/sEDj3YkR/nldfO5G3AxKWB+VPrZhY3GBsbZOIMOVCou7yveI31HOwRZJEbBqMD6U4G8hOdTasvvtxmnAlcsJh1YTATs2LVu3Pj1kyeg3mV+av/O39Jz9Liy2JSnCGH1HZ/fOlgECMnGAuQ460FQeQQRA5B5BBEDkHkEEQOQeQQRA5B5BBEDkEQOQSRQxA5BKyRzT7U9n4sYa3IQe9s5vZpW1/WAZjBTpqw3+VQGi5FvQIF5EeX6RQIcClqJWggGlzcbSkN2adyKINGCbkxvG8PdtyJiz/Ychswg4C4jKlHceQ7eHUfTAQdrv79d+Hck0Np1EvYcgtu/zI2XAEHtLMLeHACF3wON34O+/8Nj34ezXkEWfGjv+RQGs0KdtyOTz8IY1Cx75yP0E40mngAuPbTGNmOf/0Ykgq0lvGlX6aypJA2MLoNn3oAMGg6aAOl26vMq6AMlMFCgq3XYM/XYBsASXP2jRwEm+I3/h7ZANZBregMNROikmLnR3HlZ9CorvCfCOeWHERI6xjejE03ImEotbq8COPyuwAvnUd/yKGQpth2Owp52NU1qtJICJs/hJEtSBtr5HWj/h5WCAwMbQLxqnOdBA9ki8iPwafSefTL2opLOtaW77wKK2b0jRydHAJIzJBVWUHkEEQOQeQQRA5B5BBEDkHkEASRQxA5BJFDEDkEkUMQOQSRQxA5BJFDEDkEQeQQRA5B5BBEDkHkEEQOQeQQRA5B5BBEDkEQOQSRQxA5BJFDEDkEkUMQOQSRQxA5BJFDEDnkFggihyByCP0iB5+3l+O1ULtS9bi6Gzp4urVa5iht0t375Zo6dto2AYrWWjEeoFE6k0KyLf9VGiOtLekHEVyKpALqxEP97i9fuo5DNYXlDvhB4NRzzfakVEiP5GAPozH1MBoJ9Op+AzsEjDd+gtlDCHLvVQaQoQLUSph6BAGvuk4ggz0O/9dSR/GzZxXq2rOz6Vs1CtSqVGRQRsdT5caLcyqr4XnNyBHkMH0AJw8gAPwqagd7D0OYehjWL/l4MUMTjjwER6s1wyiUK3jtBwgy713ymKFCbWfq9f2nVd6wW3mLsvUqa2rPzLh6Qpq6H8eoHpclf+wvAQJhhQ+0S5EP8PpB/Ow+ZAtLSsYO0QBeeQov/AcGDGyyQjNciqzCvr9G+SRMuFQxSmamQM9+9bBfSFWksCI/2HpVCJLXqnP3T+lMwL4HIa4OgrBnUxUTYvYw4iZ23gpPsBbUZhEWBnt4h1yAhRl88xMovwkTtoonFgeBY0/h4l/H5EWIU/DitaitSj/sAMKgwY//BU98AWGulc0MCpR9u5G+WRv8zYugiZuOqO36Mp7Zsh4MuOne+tNnm0cWKGN6Mv3poRwAGEEWR59ArYxN12EgBxDccnEcA4oQKmQ1jv8c37wbJ/cjM7h8XXtlEJdx6AGM7MT67QgUHIHbuJwhZBUAfP8rePhPYKLlm5mhMrp+4HRytJq/ZjS4MA8AjpdvYwLljC5GySuVNz//bO2ZaTMQwvdmZky5XKH35cprJay/Crs/gy23YWwHGC2qlYMAm+D4MzjyMH52H5IaogF4227hQZfAJdj1B7j8Dmy8CbmhVlUlGVBA6Q28+jhe/BaO/DdygwC3Wd2YNNlKEm0oDN29OX/9eGZ7Eapl6EBg65sHS9Wnp0v/ecyeauqBYDVRy/kvx6IfSRWJRaGIscvALe0gQlLHzAFYj2wepM8sXlkcShplABi7FPkROG4ZyQLzb6B0EpqQKbZr4a/44WPnE6uzQbR1cJkuh8Cpj18u+9TqTACjetVnnEtyLD7TpOBS2EZbXw5yIAXvVpi3WCxPnDbaamwdwYRgLD9yLTVSKGLHvunaUZcymhSx556nWc8ZOd69kdTuZLgzFQjbC0g70lCq3YD0HGkMg3OLdofzjhUc7ebj6VnWVgTIqqwgcggihyCIHILIIYgcgsghiByCyCGIHILIIYgcgsghCCKHIHIIIocgcggihyByCCKHIHIIIocgcggih9wCQeQQRA5B5BBEDkHkEEQOQeQQRA5B5BBEDkEQOQSRQxA5hLPI/wDnljMhmNJJxwAAAABJRU5ErkJggg==';
const SOL_MINT = 'So11111111111111111111111111111111111111112';

const PLANS = { m1: { name: '1 month', days: 30 }, m3: { name: '3 months', days: 90 }, m6: { name: '6 months', days: 180 },
  m12: { name: '12 months', days: 365 }, lifetime: { name: 'Founder lifetime', days: 0 } };
const DEFAULTS = {
  site_live: '1', signups: '1', payments: '0', founder: '1', alerts: '1', announce: '',
  prices: JSON.stringify({ m1: 2, m3: 5, m6: 9, m12: 15, lifetime: 30 }), founder_max: '100',
  free_tokens: '4', free_wallets: '10', paid_wallets: '4000',
  pay_wallet: OWNER_WALLETS.split(',')[0], owner_wallets: OWNER_WALLETS, owner_emails: '', google_client_id: '',
  hook_id: '', hook_secret: '', hook_url: '', hook_count: '0', hook_synced: '0', hook_err: '', hook_dirty: '0'
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
function b58encode(bytes) {
  let n = 0n; for (const b of bytes) n = n * 256n + BigInt(b);
  let out = ''; while (n > 0n) { out = B58[Number(n % 58n)] + out; n /= 58n; }
  for (const b of bytes) { if (b !== 0) break; out = '1' + out; }
  return out;
}
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
  return `Sign in to Scan Holders\n\nWallet: ${wallet}\nNonce: ${nonce}\nTime: ${new Date(issued * 1000).toISOString()}\n\n` +
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
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS trades(id INTEGER PRIMARY KEY, ts INTEGER NOT NULL, wallet TEXT NOT NULL, mint TEXT NOT NULL, side TEXT NOT NULL, sol REAL NOT NULL, sig TEXT NOT NULL)`),
    env.DB.prepare(`CREATE UNIQUE INDEX IF NOT EXISTS trades_u ON trades(sig, wallet, mint)`),
    env.DB.prepare(`CREATE INDEX IF NOT EXISTS trades_ts ON trades(ts)`),
    env.DB.prepare(`CREATE INDEX IF NOT EXISTS trades_mint ON trades(mint, ts)`),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS user_wallets(user_id INTEGER NOT NULL, wallet TEXT NOT NULL, name TEXT NOT NULL DEFAULT '', handle TEXT NOT NULL DEFAULT '', kind TEXT NOT NULL DEFAULT 'smart', added INTEGER NOT NULL, PRIMARY KEY(user_id, wallet))`),
    env.DB.prepare(`CREATE INDEX IF NOT EXISTS uw_wallet ON user_wallets(wallet)`),
    env.DB.prepare(`CREATE INDEX IF NOT EXISTS hits_day ON hits(day)`),
    env.DB.prepare(`CREATE INDEX IF NOT EXISTS hits_ts ON hits(ts)`),
    // one row per payment request; status: pending → paid | review (wrong amount / seats full → refund by hand) → refunded | expired
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS payments(id INTEGER PRIMARY KEY, ref TEXT NOT NULL UNIQUE, user_id INTEGER NOT NULL, plan TEXT NOT NULL,
      sol REAL NOT NULL, lamports INTEGER NOT NULL, recipient TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending', sig TEXT UNIQUE, payer TEXT NOT NULL DEFAULT '',
      got INTEGER NOT NULL DEFAULT 0, created INTEGER NOT NULL, paid_at INTEGER NOT NULL DEFAULT 0, checked INTEGER NOT NULL DEFAULT 0,
      until_before INTEGER NOT NULL DEFAULT 0, until_after INTEGER NOT NULL DEFAULT 0, inr REAL NOT NULL DEFAULT 0, note TEXT NOT NULL DEFAULT '')`),
    env.DB.prepare(`CREATE INDEX IF NOT EXISTS pay_user ON payments(user_id, created)`),
    env.DB.prepare(`CREATE INDEX IF NOT EXISTS pay_status ON payments(status, created)`),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS token_meta(mint TEXT PRIMARY KEY, j TEXT NOT NULL, dex_t INTEGER NOT NULL DEFAULT 0, st_t INTEGER NOT NULL DEFAULT 0, ord_t INTEGER NOT NULL DEFAULT 0)`)
  ]);
  // columns added after build 1
  for (const sql of ['ALTER TABLE users ADD COLUMN blocked INTEGER NOT NULL DEFAULT 0', "ALTER TABLE users ADD COLUMN via TEXT NOT NULL DEFAULT ''", 'ALTER TABLE users ADD COLUMN follow INTEGER NOT NULL DEFAULT 1']) {
    try { await env.DB.prepare(sql).run(); } catch (e) { /* already there */ }
  }
  for (const sql of ['ALTER TABLE payments ADD COLUMN usd REAL NOT NULL DEFAULT 0', 'ALTER TABLE trades ADD COLUMN amt REAL NOT NULL DEFAULT 0', "ALTER TABLE users ADD COLUMN prefs TEXT NOT NULL DEFAULT ''"]) {
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
    created: u.created, isAdmin: isOwner(u, s || DEFAULTS), follow: u.follow !== 0 };
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
  },
  // every 5 minutes: look for payments people made and then closed the app
  async scheduled(event, env, ctx) {
    if (!env.DB) return;
    await init(env);
    try { await recheckPending(env, 20); } catch (e) { await logEvent(env, 'error', 'payments', 'Payment check failed: ' + String(e && e.message || e), 'It retries by itself in 5 minutes'); }
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

  // ---------- plan payments ----------
  if (path.startsWith('/api/pay/')) return payApi(req, env, path, later);

  // ---------- live tracking: Helius sends every trade of the tracked wallets here ----------
  if (path === '/hook' && req.method === 'POST') {
    const s = await getSettings(env);
    if (!s.hook_secret || req.headers.get('authorization') !== s.hook_secret) return fail(req, 401, 'Not allowed');
    let list = []; try { list = await req.json(); } catch (e) { }
    if (!Array.isArray(list)) list = [list];
    const T = await tracked(env), rows = [], seen = new Set();
    for (const tx of list) {
      if (!tx || !tx.signature || tx.transactionError) continue;
      const who = new Set([tx.feePayer, ...(tx.tokenTransfers || []).flatMap(x => [x.fromUserAccount, x.toUserAccount]), ...(tx.accountData || []).map(a => a.account)]);
      for (const w of who) { if (!w || !T.has(w)) continue; const tr = parseTrade(tx, w), k = tx.signature + w; if (tr && !seen.has(k)) { seen.add(k); rows.push([tx.timestamp || now(), w, tr.m, tr.side, Math.round(tr.sol * 1000) / 1000, tx.signature, tr.amt || 0]); } }
    }
    if (s.hook_dirty === '1' && now() - (+s.hook_synced || 0) >= 30) { await setSetting(env, 'hook_dirty', '0'); later(syncHook(env, '').catch(() => { })); }
    if (rows.length) {
      const st = env.DB.prepare('INSERT OR IGNORE INTO trades(ts, wallet, mint, side, sol, sig, amt) VALUES(?, ?, ?, ?, ?, ?, ?)');
      await env.DB.batch(rows.map(r => st.bind(...r)));
      later(bump(env, 'trades', rows.length));
    }
    if (Math.random() < 0.01) later(env.DB.prepare('DELETE FROM trades WHERE ts < ?').bind(now() - 48 * 3600).run());
    return json(req, { ok: true, n: rows.length });
  }

  // ---------- public app (Scan Holders) ----------
  if (path === '/api/feed' || path === '/api/trades' || path === '/api/token' || path === '/api/wallets' || path.startsWith('/api/wallets/') || path === '/api/prefs') {
    const s = await getSettings(env);
    const se = await sessionFromRequest(req, env), u = se ? se.user : null;
    const full = !!u && (planActive(u) || isOwner(u, s));
    if (s.site_live !== '1' && !(u && isOwner(u, s))) return json(req, { ok: false, down: true, error: 'Scan Holders is being updated — back soon' }, 503);
    return publicApi(req, env, path, s, u, full, later);
  }

  // ---------- owner only ----------
  if (path.startsWith('/api/owner/')) {
    const se = await sessionFromRequest(req, env);
    if (!se) return fail(req, 401, 'Not signed in');
    const s = await getSettings(env);
    if (!isOwner(se.user, s)) return fail(req, 403, "This account isn't allowed here");
    return owner(req, env, path.slice(11), s, se, later);
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

// after wallets change, refresh the webhook list (at most once every 30 seconds)
function hookLater(env, s, later) {
  TRACKED.t = 0; if (!s.hook_id) return;
  if (now() - (+s.hook_synced || 0) < 30) { later(setSetting(env, 'hook_dirty', '1')); return; }   // sent with the next update
  later(syncHook(env, '').catch(() => { }));
}

// ---------- trades ----------
const SKIP_MINTS = new Set([SOL_MINT, 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB']);
// the same buy/sell reading the personal app uses: one memecoin in or out, paid in SOL
function parseTrade(tx, w) {
  const tt = tx.tokenTransfers || [], ins = {}, outs = {};
  for (const x of tt) { if (!x || SKIP_MINTS.has(x.mint)) continue; const a = +x.tokenAmount || 0; if (x.toUserAccount === w) ins[x.mint] = (ins[x.mint] || 0) + a; if (x.fromUserAccount === w) outs[x.mint] = (outs[x.mint] || 0) + a; }
  const im = Object.keys(ins), om = Object.keys(outs);
  const ad = (tx.accountData || []).find(a => a.account === w); let sol = (ad ? ad.nativeBalanceChange : 0) / 1e9;
  for (const x of tt) { if (!x || x.mint !== SOL_MINT) continue; if (x.toUserAccount === w) sol += +x.tokenAmount || 0; if (x.fromUserAccount === w) sol -= +x.tokenAmount || 0; }
  if (im.length === 1 && !om.length && -sol >= 0.01) return { m: im[0], side: 'buy', sol: -sol, amt: ins[im[0]] };
  if (om.length === 1 && !im.length && sol >= 0.01) return { m: om[0], side: 'sell', sol, amt: outs[om[0]] };
  return null;
}
// every wallet we follow: site wallets (not hidden) + every user's own wallets — kept in memory for a minute
let TRACKED = { t: 0, set: new Set() };
async function tracked(env) {
  if (Date.now() - TRACKED.t < 60000) return TRACKED.set;
  const r = await env.DB.batch([env.DB.prepare('SELECT wallet FROM site_wallets WHERE hidden = 0'), env.DB.prepare('SELECT DISTINCT wallet FROM user_wallets')]);
  TRACKED = { t: Date.now(), set: new Set([...(r[0].results || []), ...(r[1].results || [])].map(x => x.wallet)) };
  return TRACKED.set;
}
// keep the Helius webhook's address list the same as the wallets we follow
async function syncHook(env, origin) {
  const s = await getSettings(env), key = await getKey(env, 'helius');
  if (!key) return { ok: false, error: 'Add your Helius key first (More → API keys)' };
  let secret = s.hook_secret; if (!secret) { secret = 'hs_' + randomToken(20); await setSetting(env, 'hook_secret', secret); }
  const url = origin ? origin + '/hook' : s.hook_url; if (!url) return { ok: false, error: 'Open the dashboard once to set the address' };
  if (origin) await setSetting(env, 'hook_url', url);
  TRACKED.t = 0; const set = await tracked(env), addrs = [...set].slice(0, 100000);
  if (!addrs.length) return { ok: false, error: 'Add some site wallets first' };
  const body = JSON.stringify({ webhookURL: url, transactionTypes: ['ANY'], accountAddresses: addrs, webhookType: 'enhanced', authHeader: secret });
  const base = 'https://api.helius.xyz/v0/webhooks', q = '?api-key=' + encodeURIComponent(key);
  let r = null, id = s.hook_id;
  for (let i = 0; i < 3; i++) {
    r = await fetch(id ? `${base}/${id}${q}` : base + q, { method: id ? 'PUT' : 'POST', headers: { 'content-type': 'application/json' }, body });
    await bump(env, 'call_helius');
    if (r.status === 404 && id) { id = ''; continue; }
    if (r.status === 429 || r.status >= 500) { await new Promise(res => setTimeout(res, 1500 * (i + 1))); continue; }
    break;
  }
  if (!r || !r.ok) { const msg = 'Helius webhook update failed (' + (r ? r.status : 'no answer') + ')'; await setSetting(env, 'hook_err', msg); await logEvent(env, 'error', 'tracking', msg, 'Tap Sync again in a minute; check the Helius key'); return { ok: false, error: msg }; }
  const j = await r.json().catch(() => ({}));
  if (j.webhookID) await setSetting(env, 'hook_id', j.webhookID);
  await setSetting(env, 'hook_count', addrs.length); await setSetting(env, 'hook_synced', now()); await setSetting(env, 'hook_err', ''); await setSetting(env, 'hook_dirty', '0');
  return { ok: true, count: addrs.length, id: j.webhookID || id };
}

// SOL price (CoinGecko, no key) — remembered for 5 minutes
let PX = { t: 0, usd: null };
async function solPrice() {
  if (Date.now() - PX.t < 300000) return PX;
  try { const r = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd', { headers: { accept: 'application/json' } });
    const j = r.ok ? await r.json() : null; if (j && j.solana) PX = { t: Date.now(), usd: j.solana.usd ?? null }; } catch (e) { }
  return PX;
}

// ---------- Hot tab: token data cache + filter engine (build 11) ----------
// Every token's market + safety data is fetched once and shared by every user:
//  • DexScreener (free, 30 tokens per call): market cap, liquidity, volume, price change, buys/sells, boosts, paid profile, socials
//  • Solana Tracker (your key, paced one call at a time): launchpad pool, safety (bundlers, snipers, top 10, dev), fees, holders, unique buyers
//  • DexScreener orders (paced): ads — only when someone uses the Ads filter
const SUFFIX_LP = [[/pump$/, 'Pump.fun'], [/bonk$/, 'Bonk.fun'], [/BAGS$/, 'Bags'], [/boop$/, 'Boop']];
const MARKET_LP = { pumpfun: 'Pump.fun', 'pumpfun-amm': 'Pump.fun', pumpswap: 'Pump.fun', 'raydium-launchpad': 'Raydium LaunchLab', launchlab: 'Raydium LaunchLab',
  moonshot: 'Moonit', moonit: 'Moonit', boop: 'Boop', bags: 'Bags',
  // Meteora DBC coins (Believe, Jupiter Studio, Heaven…) are never shown: their curve can change trading fees (owner decision 28 Nov 2026). Bags is kept (found by its BAGS ending).
  'meteora-curve': 'BLOCKED', 'meteora-dbc': 'BLOCKED', believe: 'BLOCKED', 'jupiter-studio': 'BLOCKED', heaven: 'BLOCKED' };
const CURVE_MARKETS = new Set(['pumpfun', 'raydium-launchpad', 'launchlab', 'moonshot', 'moonit', 'boop', 'meteora-curve', 'meteora-dbc', 'heaven', 'bags']);
const LP_NAMES = ['Pump.fun', 'Bonk.fun', 'Raydium LaunchLab', 'Bags', 'Moonit', 'Boop'];
const sleep = ms => new Promise(r => setTimeout(r, globalThis.__FAST_TEST ? 0 : ms));   // tests skip the pauses
const SEEN_MARKETS = new Set(Object.keys(MARKET_LP).concat(['raydium', 'raydium-cpmm', 'raydium-amm', 'raydium-clmm', 'meteora', 'meteora-damm', 'meteora-damm-v2', 'orca', 'pumpswap']));
function classifyLinks(urls) {
  const s = { x: false, tg: false, web: false, ig: false, tt: false };
  for (const u0 of urls) { const u = String(u0 || '').toLowerCase(); if (!u) continue;
    if (/(^|\/\/|\.)(x|twitter)\.com/.test(u)) s.x = true; else if (/(^|\/\/)t\.me\/|telegram/.test(u)) s.tg = true;
    else if (/instagram\.com/.test(u)) s.ig = true; else if (/tiktok\.com/.test(u)) s.tt = true; else if (/^https?:\/\//.test(u)) s.web = true; }
  return s;
}
function dexMeta(p) {
  const tx = p.txns || {}, v = p.volume || {}, pc = p.priceChange || {}, info = p.info || null, links = [];
  if (info) { (info.websites || []).forEach(w => links.push(w && w.url)); (info.socials || []).forEach(x => links.push(x && (x.url || (x.type === 'twitter' ? 'https://x.com' : x.type === 'telegram' ? 'https://t.me/' : '')))); }
  const n = x => typeof x === 'number' && isFinite(x) ? x : null, txo = o => o ? { b: +o.buys || 0, s: +o.sells || 0 } : null;
  return { sym: p.baseToken && p.baseToken.symbol, name: p.baseToken && p.baseToken.name, img: info && info.imageUrl || null, mcD: n(p.marketCap) ?? n(p.fdv), liqD: p.liquidity ? n(p.liquidity.usd) : null,
    price: n(+p.priceUsd), vol: { m5: n(v.m5), h1: n(v.h1), h6: n(v.h6), h24: n(v.h24) }, pc: { m5: n(pc.m5), h1: n(pc.h1), h6: n(pc.h6), h24: n(pc.h24) },
    tx: { m5: txo(tx.m5), h1: txo(tx.h1), h6: txo(tx.h6), h24: txo(tx.h24) }, pairAt: p.pairCreatedAt ? Math.floor(p.pairCreatedAt / 1000) : null, dexId: String(p.dexId || '').toLowerCase(),
    boosts: (p.boosts && +p.boosts.active) || 0, dexPaid: !!(info && (info.imageUrl || (info.socials || []).length || (info.websites || []).length)), socD: classifyLinks(links), url: p.url || '' };
}
function stMeta(ti) {
  const tk = ti.token || {}, pools = Array.isArray(ti.pools) ? ti.pools : [], r = ti.risk || {}, ev = ti.events || {};
  const markets = [...new Set(pools.map(p => String(p && p.market || '').toLowerCase()).filter(Boolean))];
  const main = pools.slice().sort((a, b) => ((b && b.liquidity || {}).usd || 0) - ((a && a.liquidity || {}).usd || 0))[0] || {};
  const sec = main.security || {}, ext = { ...(tk.extensions || {}), ...(tk.strictSocials || {}) };
  let ct = tk.creation && tk.creation.created_time; if (ct > 1e12) ct = Math.floor(ct / 1000);
  const pct = o => o && typeof o.totalPercentage === 'number' ? o.totalPercentage : null;
  return { symS: tk.symbol, nameS: tk.name, imgS: tk.image, markets, created: ct || null, liqS: main.liquidity ? main.liquidity.usd ?? null : null, mcS: main.marketCap ? main.marketCap.usd ?? null : null,
    freeze: 'freezeAuthority' in sec ? sec.freezeAuthority : undefined, mintA: 'mintAuthority' in sec ? sec.mintAuthority : undefined, curve: typeof main.curvePercentage === 'number' ? main.curvePercentage : null,
    bundlers: pct(r.bundlers), snipers: pct(r.snipers), top10: typeof r.top10 === 'number' ? r.top10 : null, dev: r.dev && typeof r.dev.percentage === 'number' ? r.dev.percentage : null,
    fees: r.fees && typeof r.fees.total === 'number' ? r.fees.total : null, holders: typeof ti.holders === 'number' ? ti.holders : null,
    pc30e: ev['30m'] && typeof ev['30m'].priceChangePercentage === 'number' ? ev['30m'].priceChangePercentage : null,
    socS: classifyLinks(Object.values(ext).filter(x => typeof x === 'string')) };
}
async function metaGet(env, mints) {
  const out = {};
  for (let i = 0; i < mints.length; i += 90) {
    const part = mints.slice(i, i + 90);
    const rows = (await env.DB.prepare(`SELECT * FROM token_meta WHERE mint IN (${part.map(() => '?').join(',')})`).bind(...part).all()).results || [];
    for (const r of rows) { try { out[r.mint] = { ...JSON.parse(r.j), _dt: r.dex_t, _st: r.st_t, _ot: r.ord_t }; } catch (e) { } }
  }
  return out;
}
async function metaPut(env, patches, col) {   // patches: { mint: partial object }
  const ms = Object.keys(patches); if (!ms.length) return;
  const cur = await metaGet(env, ms), t = now(), st = [];
  for (const m of ms) {
    const old = cur[m] || {}; const { _dt, _st, _ot, ...base } = old;
    const j = JSON.stringify({ ...base, ...patches[m] });
    st.push(env.DB.prepare(`INSERT INTO token_meta(mint, j, dex_t, st_t, ord_t) VALUES(?, ?, ?, ?, ?) ON CONFLICT(mint) DO UPDATE SET j = excluded.j,
      dex_t = MAX(token_meta.dex_t, excluded.dex_t), st_t = MAX(token_meta.st_t, excluded.st_t), ord_t = MAX(token_meta.ord_t, excluded.ord_t)`)
      .bind(m, j, col === 'dex' ? t : 0, col === 'st' ? t : 0, col === 'ord' ? t : 0));
  }
  for (let i = 0; i < st.length; i += 50) await env.DB.batch(st.slice(i, i + 50));
}
// DexScreener: refresh tokens older than a minute, 30 per call
async function dexRefresh(env, mints, metas) {
  const stale = mints.filter(m => !metas[m] || now() - (metas[m]._dt || 0) > 60);
  const chunks = []; for (let i = 0; i < stale.length; i += 30) chunks.push(stale.slice(i, i + 30));
  const patches = {};
  for (let i = 0; i < chunks.length; i += 4) {
    await Promise.all(chunks.slice(i, i + 4).map(async part => {
      try {
        const r = await fetch('https://api.dexscreener.com/tokens/v1/solana/' + part.join(','), { headers: { accept: 'application/json' } }); await bump(env, 'call_dex');
        const list = r.ok ? await r.json() : null; if (!Array.isArray(list)) return;
        const best = {};
        for (const p of list) { const a = p && p.baseToken && p.baseToken.address; if (!a || !part.includes(a)) continue; if (!best[a] || ((p.liquidity || {}).usd || 0) > ((best[a].liquidity || {}).usd || 0)) best[a] = p; }
        for (const m of part) patches[m] = best[m] ? dexMeta(best[m]) : { noDex: true };
      } catch (e) { }
    }));
  }
  await metaPut(env, patches, 'dex');
  for (const [m, p] of Object.entries(patches)) metas[m] = { ...(metas[m] || {}), ...p, _dt: now() };
}
// Solana Tracker: one call at a time (your plan answers 429 to bursts), shared lock so only one worker runs it
async function stWork(env, mints, wantOrders) {
  const DB = env.DB, t = now();
  await DB.prepare("INSERT OR IGNORE INTO settings(k, v) VALUES('st_lock', '0')").run();
  const got = await DB.prepare("UPDATE settings SET v = ? WHERE k = 'st_lock' AND CAST(v AS INTEGER) < ?").bind(String(t + 28), t).run();
  if (!got.meta || !got.meta.changes) return 0;
  let n = 0;
  try {
    const key = await getKey(env, 'stracker'), t0 = Date.now();
    const metas = await metaGet(env, mints);
    const get = async p => { const r = await fetch('https://data.solanatracker.io' + p, { headers: { 'x-api-key': key, accept: 'application/json' } }); await bump(env, 'call_stracker'); return { s: r.status, j: r.ok ? await r.json().catch(() => null) : null }; };
    if (key) for (const m of mints.filter(m => !metas[m] || now() - (metas[m]._st || 0) > 240)) {
      if (Date.now() - t0 > 22000) break;
      const a = await get('/tokens/' + m);
      if (a.s === 429) { await sleep(3000); continue; }
      await sleep(1050);
      const b = await get('/stats/' + m);
      const patch = a.j ? stMeta(a.j) : { noST: a.s === 404 };
      if (b.j) { const ub = {}; for (const k of ['15m', '30m', '1h', '24h']) if (b.j[k] && typeof b.j[k].buyers === 'number') ub[k] = b.j[k].buyers;
        patch.ub = ub; if (b.j['30m'] && typeof b.j['30m'].priceChangePercentage === 'number') patch.pc30 = b.j['30m'].priceChangePercentage; }
      await metaPut(env, { [m]: patch }, 'st'); n++;
      for (const mk of patch.markets || []) if (!SEEN_MARKETS.has(mk)) { SEEN_MARKETS.add(mk); await logEvent(env, 'info', 'launchpads', `New pool type seen: ${mk} (token ${short4(m)})`, 'Tell Claude so it can be named in the Launchpads list'); }
      await sleep(1050);
    }
    if (wantOrders) for (const m of mints.filter(m => !metas[m] || now() - (metas[m]._ot || 0) > 900).slice(0, 15)) {
      if (Date.now() - t0 > 24000) break;
      try { const r = await fetch('https://api.dexscreener.com/orders/v1/solana/' + m); await bump(env, 'call_dex');
        const arr = r.ok ? await r.json() : null; const L = Array.isArray(arr) ? arr : (arr && Array.isArray(arr.orders) ? arr.orders : null);
        if (L) await metaPut(env, { [m]: { ads: L.some(o => o && (o.type === 'tokenAd' || o.type === 'trendingBarAd') && o.status === 'approved'), paidO: L.some(o => o && o.type === 'tokenProfile' && o.status === 'approved') } }, 'ord');
      } catch (e) { }
      await sleep(1050);
    }
  } finally { await DB.prepare("UPDATE settings SET v = '0' WHERE k = 'st_lock'").run(); }
  return n;
}
// whole-market candidates (KOL and Smart both off): Solana Tracker's latest / graduating / graduated launchpad tokens, refreshed once a minute for everyone
async function marketMints(env) {
  const DB = env.DB, c = await DB.prepare("SELECT v FROM settings WHERE k = 'mkt'").first();
  let cache = null; try { cache = c ? JSON.parse(c.v) : null; } catch (e) { }
  if (cache && now() - cache.t < 60) return cache.m;
  await setSetting(env, 'mkt', JSON.stringify({ t: now(), m: cache ? cache.m : [] }));   // others use the old list while this one refreshes
  const key = await getKey(env, 'stracker'); if (!key) return cache ? cache.m : [];
  try {
    const get = async p => { const r = await fetch('https://data.solanatracker.io' + p, { headers: { 'x-api-key': key, accept: 'application/json' } }); await bump(env, 'call_stracker');
      const j = r.ok ? await r.json().catch(() => null) : null; if (!r.ok) await logEvent(env, 'error', 'hot', `Solana Tracker ${p.split('?')[0]} answered ${r.status}`, r.status === 429 ? 'Too many calls — it retries next minute' : r.status === 401 || r.status === 403 ? 'Check the Solana Tracker key / plan' : 'It retries next minute'); return j; };
    let list = [];
    const j = await get('/tokens/multi/all?limit=100');
    if (j && typeof j === 'object' && !Array.isArray(j)) list = [...(j.latest || []), ...(j.graduating || []), ...(j.graduated || [])];
    if (!list.length) { await sleep(1100); const tr = await get('/tokens/trending/5m'); if (Array.isArray(tr)) list = tr; }
    if (!list.length) { await sleep(1100); const la = await get('/tokens/latest'); if (Array.isArray(la)) list = la; }
    list = list.filter(x => x && x.token && x.token.mint);
    if (!list.length) return cache ? cache.m : [];
    const patches = {}; for (const ti of list) patches[ti.token.mint] = stMeta(ti);
    await metaPut(env, patches, 'st');
    const m = [...new Set(list.map(x => x.token.mint))];
    await setSetting(env, 'mkt', JSON.stringify({ t: now(), m }));
    return m;
  } catch (e) { return cache ? cache.m : []; }
}
// ---- reading a token's numbers (one place, so every filter reads the same value) ----
function lpOf(mint, m) {
  for (const [re, name] of SUFFIX_LP) if (re.test(mint)) return name;
  for (const mk of m.markets || []) if (MARKET_LP[mk]) return MARKET_LP[mk];
  if (MARKET_LP[m.dexId]) return MARKET_LP[m.dexId];
  return null;
}
function stageOf(m) {
  const mk = m.markets || [];
  if (mk.length) return mk.some(x => !CURVE_MARKETS.has(x)) ? 'mig' : 'bond';
  if (m.dexId) return CURVE_MARKETS.has(m.dexId) ? 'bond' : 'mig';
  return null;
}
const winKey = w => w <= 900 ? 'm5' : w <= 3600 ? 'h1' : w <= 14400 ? 'h6' : 'h24';
const ubKey = w => w <= 900 ? '15m' : w <= 3600 ? '1h' : '24h';
function view(mint, m, win) {
  const st = stageOf(m), k = winKey(win), tx = (m.tx || {})[k], vol = (m.vol || {})[k] ?? null;
  const soc = m.socD || {}, so = m.socS || {};
  return { lp: lpOf(mint, m), stage: st, created: m.created || m.pairAt || null,
    mc: m.mcD ?? m.mcS ?? null, liq: st === 'bond' ? (m.liqS ?? m.liqD ?? null) : (m.liqD ?? m.liqS ?? null),
    vol, buys: tx ? tx.b : null, sells: tx ? tx.s : null, bs: tx && tx.s ? tx.b / tx.s : tx && tx.b ? tx.b : null,
    ub: m.ub ? m.ub[ubKey(win)] ?? null : null, fees: m.fees ?? null, holders: m.holders ?? null,
    bundlers: m.bundlers ?? null, snipers: m.snipers ?? null, top10: m.top10 ?? null, dev: m.dev ?? null,
    pc: { '5m': (m.pc || {}).m5 ?? null, '30m': m.pc30 ?? m.pc30e ?? null, '6h': (m.pc || {}).h6 ?? null, '24h': (m.pc || {}).h24 ?? null, h1: (m.pc || {}).h1 ?? null },
    soc: { x: !!(soc.x || so.x), tg: !!(soc.tg || so.tg), web: !!(soc.web || so.web), ig: !!(soc.ig || so.ig), tt: !!(soc.tt || so.tt) },
    paid: m.dexPaid || m.paidO || false, boosted: (m.boosts || 0) > 0, ads: typeof m.ads === 'boolean' ? m.ads : null,
    unsafe: (m.freeze !== undefined && m.freeze !== null && m.freeze !== '') || (m.mintA !== undefined && m.mintA !== null && m.mintA !== ''),
    hasST: !!m._st, sym: m.sym || m.symS || '', name: m.name || m.nameS || '', img: m.img || m.imgS || null, price: m.price ?? null };
}
// ---- filters: read and clean what the app sends; free accounts keep only the free filters ----
const num = (x, lo, hi) => { const n = Number(x); return isFinite(n) && n >= lo && n <= hi ? n : null; };
function range(o, hi) { if (!o || typeof o !== 'object') return null; const a = num(o.min, 0, hi), b = num(o.max, 0, hi); return a == null && b == null ? null : { min: a, max: b }; }
function parseFilters(raw, full) {
  let f = {}; try { f = JSON.parse(raw || '{}') || {}; } catch (e) { }
  const b = f.b || {}, out = { b: { all: b.all !== false, kol: b.kol !== false, smart: b.smart !== false } };
  if (!out.b.kol && !out.b.smart) out.b.all = true;
  out.stage = { bond: !f.stage || f.stage.bond !== false, mig: !f.stage || f.stage.mig !== false }; if (!out.stage.bond && !out.stage.mig) out.stage = { bond: true, mig: true };
  out.lpOff = Array.isArray(f.lpOff) ? f.lpOff.filter(x => LP_NAMES.includes(x)) : []; if (out.lpOff.length >= LP_NAMES.length) out.lpOff = [];
  out.age = range(f.age, 1e9); out.mc = range(f.mc, 1e13); out.liq = range(f.liq, 1e12);
  out.minb = 0;   // Minimum buyers filter removed (owner decision 28 Nov 2026)
  if (!full) { out.sort = 'hot'; return out; }
  out.minsol = num(f.minsol, 0, 1e7) || 0; out.hold = num(f.hold, 0, 100) || 0; out.lastb = num(f.lastb, 0, 86400 * 7) || 0;
  if (f.pc && (f.pc.dir === 'up' || f.pc.dir === 'down')) out.pc = { dir: f.pc.dir, min: num(f.pc.min, 0, 1e6) || 0, tf: ['5m', '30m', '6h', '24h'].includes(f.pc.tf) ? f.pc.tf : '5m' };
  for (const k of ['bun', 'snp', 'top', 'dev']) out[k] = range(f[k], 100);
  out.vol = range(f.vol, 1e13); out.fee = range(f.fee, 1e9); out.ubr = range(f.ubr, 1e9); out.bsr = range(f.bsr, 1e6); out.hld = range(f.hld, 1e9);
  out.soc = Array.isArray(f.soc) ? f.soc.filter(x => ['x', 'web', 'ig', 'tt', 'tg'].includes(x)) : [];
  out.paid = !!f.paid; out.boost = !!f.boost; out.ads = !!f.ads;
  out.sort = ['hot', 'new', 'buyers', 'sol', 'mc', 'vol', 'fees'].includes(f.sort) ? f.sort : 'hot';
  return out;
}
// 15 buys in 5 min ≈ 30, 200 ≈ 60, 1,000+ with a strong spike ≈ 90+
const mktScore = (b5, ratio) => Math.max(1, Math.min(99, Math.round(25 * Math.log10(1 + (b5 || 0)) + 6 * Math.min(5, ratio || 0))));
const inR = (v, r) => !r || (v != null && (r.min == null || v >= r.min) && (r.max == null || v <= r.max));   // filter on + no data → hidden
async function hotFeed(req, env, s, u, full, later, q) {
  const DB = env.DB, t = now(), uid = u ? u.id : -1, follow = !u || u.follow !== 0;
  const win = [900, 3600, 14400, 86400].includes(+q.get('win')) ? +q.get('win') : 3600;
  const f = parseFilters(q.get('f'), full), tracked = f.b.kol || f.b.smart, FREE = Math.max(1, +s.free_tokens || 4);
  const kinds = [f.b.kol ? 'kol' : null, f.b.smart ? 'smart' : null].filter(Boolean);
  let toks = [];
  if (tracked) {
    // one row per token + wallet: buys in the window (0.1 SOL or more), token amounts for "still holding", last buy
    const rows = (await DB.prepare(`SELECT t.mint, t.wallet, COALESCE(sw.kind, uw.kind, 'smart') kind, sw.name, sw.handle, uw.name uname,
        SUM(CASE WHEN t.side = 'buy' AND t.ts > ?1 AND t.sol >= 0.1 THEN t.sol ELSE 0 END) bsol,
        SUM(CASE WHEN t.side = 'buy' AND t.ts > ?1 AND t.sol >= 0.1 THEN 1 ELSE 0 END) bn,
        MIN(CASE WHEN t.side = 'buy' AND t.ts > ?1 AND t.sol >= 0.1 THEN t.ts END) bfirst,
        MAX(CASE WHEN t.side = 'buy' AND t.sol >= 0.1 THEN t.ts END) blast,
        SUM(CASE WHEN t.side = 'buy' THEN t.amt ELSE 0 END) bamt, SUM(CASE WHEN t.side = 'buy' AND t.amt > 0 THEN t.sol ELSE 0 END) bsolA,
        SUM(CASE WHEN t.side = 'sell' THEN t.amt ELSE 0 END) samt, SUM(CASE WHEN t.side = 'sell' THEN 1 ELSE 0 END) sn
      FROM trades t LEFT JOIN site_wallets sw ON sw.wallet = t.wallet AND sw.hidden = 0 LEFT JOIN user_wallets uw ON uw.wallet = t.wallet AND uw.user_id = ?2
      WHERE t.ts > ?3 AND (sw.wallet IS NOT NULL OR uw.wallet IS NOT NULL)${follow ? '' : ' AND uw.wallet IS NOT NULL'}
      GROUP BY t.mint, t.wallet HAVING bn > 0 LIMIT 6000`).bind(t - win, uid, t - 48 * 3600).all()).results || [];
    const by = {};
    for (const r of rows) {
      if (!kinds.includes(r.kind)) continue;
      const holding = r.bamt > 0 ? (r.bamt - r.samt) / r.bamt > 0.5 : r.sn === 0;
      const age = t - r.blast, fresh = age < 900 ? 1 : age < 3600 ? 0.7 : age < 14400 ? 0.4 : 0.2;
      const x = by[r.mint] = by[r.mint] || { mint: r.mint, kol: 0, smart: 0, buyers: 0, solIn: 0, holding: 0, first: Infinity, last: 0, raw: 0, sold: 0, w: [], entrySol: 0, entryAmt: 0, firstPx: null, firstTs: Infinity };
      x[r.kind]++; x.buyers++; x.solIn += r.bsol; if (holding) x.holding++; else x.sold++;
      x.first = Math.min(x.first, r.bfirst); x.last = Math.max(x.last, r.blast);
      x.raw += (r.kind === 'kol' ? 3 : 2) * fresh * (holding ? 1 : 0.3);
      if (r.bamt > 0 && r.bsolA > 0) { x.entrySol += r.bsolA; x.entryAmt += r.bamt; if (r.bfirst < x.firstTs) { x.firstTs = r.bfirst; x.firstPx = r.bsolA / r.bamt; } }
      x.w.push({ w: r.wallet, kind: r.kind, name: r.name || r.uname || '', x: r.handle || '', sol: Math.round(r.bsol * 100) / 100, ts: r.bfirst, holding });
    }
    toks = Object.values(by).map(x => { x.raw += Math.log2(1 + x.solIn) * 0.5; return x; }).sort((a, b) => b.raw - a.raw).slice(0, 150);
  } else {
    toks = (await marketMints(env)).map(mint => ({ mint, market: true }));
  }
  const mints = toks.map(x => x.mint), metas = await metaGet(env, mints);
  await dexRefresh(env, mints, metas);
  const needST = mints.filter(m => !metas[m] || now() - (metas[m]._st || 0) > 240).slice(0, 40);
  if (needST.length || f.ads) later(stWork(env, tracked ? mints.slice(0, 60) : needST, f.ads).catch(() => 0));
  const px = await solPrice();
  let waiting = 0;
  const pass = [], D = { checked: toks.length, noLp: 0, unsafe: 0, quiet: 0, noSpike: 0, filters: 0 };
  for (const x of toks) {
    const m = metas[x.mint] || {}, v = view(x.mint, m, win);
    if (!v.lp || v.lp === 'BLOCKED') { if (!v.lp && !v.hasST) waiting++; D.noLp++; continue; }   // launchpad tokens only (unknown → wait for Solana Tracker)
    if (v.unsafe) { D.unsafe++; continue; }                                                     // mint or freeze authority still on → never shown
    if (!f.stage[v.stage === 'bond' ? 'bond' : 'mig'] && v.stage) continue;
    if (!v.stage && !(f.stage.bond && f.stage.mig)) continue;
    if (f.lpOff.includes(v.lp)) continue;
    const ageS = v.created ? t - v.created : null;
    if (!inR(ageS, f.age) || !inR(v.mc, f.mc) || !inR(v.liq, f.liq)) continue;
    let hot, buyersN, sol;
    if (x.market) {
      // whole market: sudden buying only, no dead tokens
      const t5 = (m.tx || {}).m5, t1 = (m.tx || {}).h1, v5 = (m.vol || {}).m5;
      if (!t5 || !(v5 >= 500)) { D.quiet++; continue; }
      const ratio = t1 && t1.b ? t5.b / Math.max(1, t1.b / 12) : t5.b ? 5 : 0;
      if (!(t5.b >= 15 && v5 >= 3000 && ratio >= 2)) { D.noSpike++; continue; }
      buyersN = v.buys; sol = null;
      hot = mktScore(t5.b, ratio);
      x.spike = Math.round(ratio * 10) / 10;
    } else {
      buyersN = x.buyers; sol = x.solIn;
      const own = Math.min(99, Math.round(x.raw * 8));
      if (f.b.all) { const t5 = (m.tx || {}).m5, t1 = (m.tx || {}).h1; const r = t5 && t1 && t1.b ? t5.b / Math.max(1, t1.b / 12) : 0; hot = t5 ? Math.round(0.6 * mktScore(t5.b, r) + 0.4 * own) : Math.round(own * 0.4); }
      else hot = own;
    }
    if (f.minb && !(buyersN != null && buyersN >= f.minb)) continue;
    if (!x.market) {
      if (f.minsol && !(sol >= f.minsol)) continue;
      if (f.hold && !(x.buyers && 100 * x.holding / x.buyers >= f.hold)) continue;
      if (f.lastb && !(t - x.last <= f.lastb)) continue;
    } else if (f.lastb) { const k = f.lastb <= 300 ? 'm5' : f.lastb <= 3600 ? 'h1' : f.lastb <= 21600 ? 'h6' : 'h24'; const tx = (m.tx || {})[k]; if (!(tx && tx.b > 0)) continue; }
    if (f.pc) { const pv = v.pc[f.pc.tf]; if (pv == null) continue; if (f.pc.dir === 'up' ? !(pv > 0 && pv >= f.pc.min) : !(pv < 0 && -pv >= f.pc.min)) continue; }
    if (!inR(v.bundlers, f.bun) || !inR(v.snipers, f.snp) || !inR(v.top10, f.top) || !inR(v.dev, f.dev)) continue;
    if (!inR(v.vol, f.vol) || !inR(v.fees, f.fee) || !inR(v.ub, f.ubr) || !inR(v.bs, f.bsr) || !inR(v.holders, f.hld)) continue;
    if (f.soc && f.soc.length && !f.soc.every(k => v.soc[k])) continue;
    if (f.paid && !v.paid) continue;
    if (f.boost && !v.boosted) continue;
    if (f.ads && v.ads !== true) { if (v.ads === null) waiting++; continue; }
    const supply = v.price && v.mc ? v.mc / v.price : null;
    const entry = !x.market && supply && px.usd && x.firstPx ? Math.round(x.firstPx * px.usd * supply) : null;
    pass.push({ mint: x.mint, sym: v.sym, name: v.name, img: v.img, mc: v.mc, liq: v.liq, ch1: v.pc.h1, pc: v.pc, hot, market: !!x.market,
      kol: x.kol || 0, smart: x.smart || 0, buyers: buyersN, solIn: sol != null ? Math.round(sol * 100) / 100 : null, first: x.first === Infinity ? null : x.first, last: x.last || null,
      holding: full && !x.market ? x.holding : undefined, sold: full && !x.market ? x.sold : undefined,
      buys: v.buys, vol: v.vol, spike: x.spike || null, stage: v.stage, lp: v.lp, created: v.created, fees: v.fees, holders: v.holders,
      bundlers: v.bundlers, snipers: v.snipers, top10: v.top10, entryMc: entry, buyersList: (x.w || []).sort((a, b) => a.ts - b.ts).slice(0, full ? 12 : 3) });
  }
  const key = { hot: z => z.hot, new: z => z.created || 0, buyers: z => z.buyers || 0, sol: z => z.solIn ?? z.vol ?? 0, mc: z => z.mc || 0, vol: z => z.vol || 0, fees: z => z.fees || 0 }[f.sort] || (z => z.hot);
  pass.sort((a, b) => key(b) - key(a) || (b.last || 0) - (a.last || 0));
  D.filters = Math.max(0, D.checked - D.noLp - D.unsafe - D.quiet - D.noSpike - pass.length);
  const count = pass.length, vis = full ? pass.slice(0, 60) : pass.slice(0, FREE);
  const plan = u ? (isOwner(u, s) ? 'owner' : planActive(u) ? u.plan : 'free') : 'guest';
  return json(req, { ok: true, tab: 'hot', win, plan, mode: tracked ? (f.b.all ? 'mixed' : 'tracked') : 'market', limit: full ? null : FREE, count, tokens: q.get('dry') ? [] : vis, locked: count - vis.length, waiting, filters: f, diag: D });
}

// ---------- public app API ----------
const short4 = w => w.slice(0, 4) + '…' + w.slice(-4);
async function publicApi(req, env, path, s, u, full, later) {
  const DB = env.DB, t = now(), q = new URL(req.url).searchParams, b = req.method === 'POST' ? await body(req) : {};
  const FREE = Math.max(1, +s.free_tokens || 4), uid = u ? u.id : -1, follow = !u || u.follow !== 0;
  const plan = u ? (isOwner(u, s) ? 'owner' : planActive(u) ? u.plan : 'free') : 'guest';
  const scope = follow ? '' : ' AND uw.wallet IS NOT NULL';   // "follow site KOLs" off → only the user's own wallets

  if (path === '/api/feed' && q.get('tab') === 'hot') return hotFeed(req, env, s, u, full, later, q);
  if (path === '/api/feed') {
    const tab = ['hot', 'kol', 'smart', 'spikes', 'mine'].includes(q.get('tab')) ? q.get('tab') : 'hot';
    const win = tab === 'spikes' ? 900 : Math.min(86400, Math.max(900, +q.get('win') || 14400));
    const having = { hot: 'kol + smart + mine >= 1', kol: 'kol >= 1', smart: 'smart >= 1', spikes: 'buys >= 3', mine: 'mine >= 1' }[tab];
    const order = { hot: 'kol * 3 + smart + mine * 2 DESC, last DESC', kol: 'kol DESC, last DESC', smart: 'smart DESC, last DESC', spikes: 'buys DESC, last DESC', mine: 'mine DESC, last DESC' }[tab];
    const rows = (await DB.prepare(`SELECT t.mint,
        COUNT(DISTINCT CASE WHEN t.side = 'buy' AND sw.kind = 'kol' THEN t.wallet END) kol,
        COUNT(DISTINCT CASE WHEN t.side = 'buy' AND sw.kind = 'smart' THEN t.wallet END) smart,
        COUNT(DISTINCT CASE WHEN t.side = 'buy' AND uw.wallet IS NOT NULL THEN t.wallet END) mine,
        SUM(t.side = 'buy') buys, SUM(t.side = 'sell') sells, ROUND(SUM(CASE WHEN t.side = 'buy' THEN t.sol ELSE 0 END), 2) solIn,
        ROUND(SUM(CASE WHEN t.side = 'sell' THEN t.sol ELSE 0 END), 2) solOut, MIN(t.ts) first, MAX(t.ts) last
      FROM trades t LEFT JOIN site_wallets sw ON sw.wallet = t.wallet AND sw.hidden = 0 LEFT JOIN user_wallets uw ON uw.wallet = t.wallet AND uw.user_id = ?
      WHERE t.ts > ?${scope} AND (sw.wallet IS NOT NULL OR uw.wallet IS NOT NULL) GROUP BY t.mint HAVING ${having} ORDER BY ${order} LIMIT 60`).bind(uid, t - win).all()).results || [];
    const vis = full ? rows : rows.slice(0, FREE), locked = rows.length - vis.length;
    if (vis.length) {
      const by = (await DB.prepare(`SELECT t.mint, t.wallet, MIN(t.ts) ts, ROUND(SUM(t.sol), 2) sol, sw.kind, sw.name, sw.handle, uw.name uname
        FROM trades t LEFT JOIN site_wallets sw ON sw.wallet = t.wallet AND sw.hidden = 0 LEFT JOIN user_wallets uw ON uw.wallet = t.wallet AND uw.user_id = ?
        WHERE t.ts > ? AND t.side = 'buy' AND t.mint IN (${vis.map(() => '?').join(',')}) AND (sw.wallet IS NOT NULL OR uw.wallet IS NOT NULL) GROUP BY t.mint, t.wallet ORDER BY ts`)
        .bind(uid, t - win, ...vis.map(r => r.mint)).all()).results || [];
      const m = {}; for (const x of by) (m[x.mint] = m[x.mint] || []).push({ w: x.wallet, name: x.name || x.uname || '', x: x.handle || '', kind: x.uname != null && !x.kind ? 'mine' : x.kind || 'smart', sol: x.sol, ts: x.ts });
      vis.forEach(r => { r.buyers = (m[r.mint] || []).slice(0, full ? 12 : 3); });
    }
    return json(req, { ok: true, tab, win, plan, limit: full ? null : FREE, tokens: vis, locked });
  }

  if (path === '/api/trades') {
    const f = ['all', 'kol', 'smart', 'mine'].includes(q.get('f')) ? q.get('f') : 'all';
    const cond = { all: '(sw.wallet IS NOT NULL OR uw.wallet IS NOT NULL)', kol: "sw.kind = 'kol'", smart: "sw.kind = 'smart'", mine: 'uw.wallet IS NOT NULL' }[f];
    const rows = (await DB.prepare(`SELECT t.id, t.ts, t.wallet, t.mint, t.side, t.sol, t.sig, sw.kind, sw.name, sw.handle, uw.name uname FROM trades t
      LEFT JOIN site_wallets sw ON sw.wallet = t.wallet AND sw.hidden = 0 LEFT JOIN user_wallets uw ON uw.wallet = t.wallet AND uw.user_id = ?
      WHERE t.ts > ? AND ${cond}${scope} ORDER BY t.id DESC LIMIT 60`).bind(uid, t - 86400).all()).results || [];
    const out = rows.map(r => ({ ts: r.ts, w: r.wallet, mint: r.mint, side: r.side, sol: r.sol, sig: r.sig, name: r.name || r.uname || '', x: r.handle || '', kind: r.uname != null && !r.kind ? 'mine' : r.kind || 'smart' }));
    const vis = full ? out : out.slice(0, FREE);
    return json(req, { ok: true, plan, limit: full ? null : FREE, trades: vis, locked: out.length - vis.length });
  }

  if (path === '/api/token') {
    const mint = q.get('mint') || '';
    if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(mint)) return fail(req, 400, 'Not a valid token');
    const rows = (await DB.prepare(`SELECT t.ts, t.wallet, t.side, t.sol, sw.kind, sw.name, sw.handle, uw.name uname FROM trades t
      LEFT JOIN site_wallets sw ON sw.wallet = t.wallet AND sw.hidden = 0 LEFT JOIN user_wallets uw ON uw.wallet = t.wallet AND uw.user_id = ?
      WHERE t.mint = ? AND t.ts > ? AND (sw.wallet IS NOT NULL OR uw.wallet IS NOT NULL)${scope} ORDER BY t.ts DESC LIMIT 80`).bind(uid, mint, t - 86400).all()).results || [];
    const out = rows.map(r => ({ ts: r.ts, w: r.wallet, side: r.side, sol: r.sol, name: r.name || r.uname || '', x: r.handle || '', kind: r.uname != null && !r.kind ? 'mine' : r.kind || 'smart' }));
    const vis = full ? out : out.slice(0, FREE);
    return json(req, { ok: true, plan, trades: vis, locked: out.length - vis.length, buys: rows.filter(r => r.side === 'buy').length, sells: rows.filter(r => r.side === 'sell').length });
  }

  // ---- saved filters (kept on the account) ----
  if (path === '/api/prefs') {
    if (!u) return fail(req, 401, 'Sign in to save filters');
    if (req.method === 'POST') { const v = JSON.stringify(b && b.prefs || {}); if (v.length > 4000) return fail(req, 400, 'Too much to save'); await DB.prepare('UPDATE users SET prefs = ? WHERE id = ?').bind(v, u.id).run(); return json(req, { ok: true }); }
    let p = {}; try { p = JSON.parse(u.prefs || '{}'); } catch (e) { }
    return json(req, { ok: true, prefs: p });
  }
  // ---- the user's own wallets ----
  if (!u) return fail(req, 401, 'Sign in to add your own wallets');
  const limit = full ? +s.paid_wallets || 4000 : +s.free_wallets || 10;
  if (path === '/api/wallets' && req.method === 'GET') {
    const rows = (await DB.prepare('SELECT wallet, name, handle, kind, added FROM user_wallets WHERE user_id = ? ORDER BY added DESC').bind(u.id).all()).results || [];
    return json(req, { ok: true, plan, limit, used: rows.length, follow: follow ? 1 : 0, wallets: rows });
  }
  if (path === '/api/wallets/add' && req.method === 'POST') {
    const { list, bad } = parseWallets(b.text);
    const have = new Set(((await DB.prepare('SELECT wallet FROM user_wallets WHERE user_id = ?').bind(u.id).all()).results || []).map(r => r.wallet));
    const fresh = list.filter(x => !have.has(x.wallet)), room = Math.max(0, limit - have.size), take = fresh.slice(0, room);
    const res = { add: take.length, dup: list.length - fresh.length, bad, over: fresh.length - take.length, limit, used: have.size + take.length };
    if (b.dry) return json(req, { ok: true, preview: res });
    for (let i = 0; i < take.length; i += 50)
      await DB.batch(take.slice(i, i + 50).map(x => DB.prepare('INSERT OR IGNORE INTO user_wallets(user_id, wallet, name, handle, kind, added) VALUES(?, ?, ?, ?, ?, ?)').bind(u.id, x.wallet, x.name, x.handle, x.kind, t)));
    if (take.length) hookLater(env, s, later);
    return json(req, { ok: true, result: res });
  }
  if (path === '/api/wallets/delete' && req.method === 'POST') {
    const ws = (Array.isArray(b.wallets) ? b.wallets : []).filter(isWallet).slice(0, 5000); let n = 0;
    for (let i = 0; i < ws.length; i += 90) { const r = await DB.prepare(`DELETE FROM user_wallets WHERE user_id = ? AND wallet IN (${ws.slice(i, i + 90).map(() => '?').join(',')})`).bind(u.id, ...ws.slice(i, i + 90)).run(); n += r.meta ? r.meta.changes : 0; }
    if (n) hookLater(env, s, later);
    return json(req, { ok: true, deleted: n });
  }
  if (path === '/api/wallets/edit' && req.method === 'POST') {
    if (!isWallet(b.wallet)) return fail(req, 400, 'Not a valid wallet');
    await DB.prepare('UPDATE user_wallets SET name = ?, handle = ? WHERE user_id = ? AND wallet = ?').bind(String(b.name || '').slice(0, 40), String(b.handle || '').replace(/^@/, '').slice(0, 30), u.id, b.wallet).run();
    return json(req, { ok: true });
  }
  if (path === '/api/wallets/follow' && req.method === 'POST') {
    await DB.prepare('UPDATE users SET follow = ? WHERE id = ?').bind(b.on ? 1 : 0, u.id).run();
    return json(req, { ok: true });
  }
  return fail(req, 404, 'Not found');
}

// ---------- plan payments (SOL) ----------
const PAY_HOLD = 20 * 60;           // a Founder seat is held 20 minutes for someone who started paying
const PAY_GIVEUP = 48 * 3600;       // stop looking for a payment after 48 hours
// start of "today" for money totals: the owner's phone sends its time-zone offset (minutes, like getTimezoneOffset)
const dayStart = (t, tz) => { const off = -Math.max(-840, Math.min(840, Number(tz) || 0)) * 60; return t - ((t + off) % 86400 + 86400) % 86400; };
async function rpc(env, key, method, params) {
  const r = await fetch('https://mainnet.helius-rpc.com/?api-key=' + encodeURIComponent(key), { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) });
  await bump(env, 'call_helius');
  const j = r.ok ? await r.json().catch(() => null) : null;
  if (!j || j.error) throw new Error('Helius ' + method + ': ' + (j && j.error ? j.error.message : 'answered ' + r.status));
  return j.result;
}
const lam = sol => Math.round(Number(sol) * 1e9);
const solOf = l => Math.round(l) / 1e9;
function payOut(p, extra) {
  const label = 'Scan Holders', msg = `Scan Holders · ${PLANS[p.plan] ? PLANS[p.plan].name : p.plan}`;
  return { ref: p.ref, plan: p.plan, planName: PLANS[p.plan] ? PLANS[p.plan].name : p.plan, sol: solOf(p.lamports), lamports: p.lamports, recipient: p.recipient,
    status: p.status, created: p.created, paidAt: p.paid_at, sig: p.sig || '', until: p.until_after || 0, note: p.note || '',
    url: `solana:${p.recipient}?amount=${solOf(p.lamports)}&reference=${p.ref}&label=${encodeURIComponent(label)}&message=${encodeURIComponent(msg)}`, ...(extra || {}) };
}
const whoOf = u => !u ? 'unknown user' : u.email ? u.email.replace(/(.{3}).*@/, '$1…@') : u.wallet ? short4(u.wallet) : '#' + u.id;

// look on chain for a transfer carrying this payment's reference key
async function checkPayment(env, p, key) {
  const DB = env.DB;
  if (p.status !== 'pending') return p;
  await DB.prepare('UPDATE payments SET checked = ? WHERE id = ?').bind(now(), p.id).run();
  const sigs = await rpc(env, key, 'getSignaturesForAddress', [p.ref, { limit: 20, commitment: 'confirmed' }]) || [];
  for (const x of sigs.slice().reverse()) {   // oldest first
    if (!x || !x.signature || x.err) continue;
    if (x.confirmationStatus && !['confirmed', 'finalized'].includes(x.confirmationStatus)) continue;
    if (await DB.prepare('SELECT 1 FROM payments WHERE sig = ?').bind(x.signature).first()) continue;   // signature already used
    const tx = await rpc(env, key, 'getTransaction', [x.signature, { encoding: 'jsonParsed', commitment: 'confirmed', maxSupportedTransactionVersion: 0 }]);
    if (!tx || !tx.meta || tx.meta.err || !tx.transaction) continue;
    const m = tx.transaction.message || {};
    const keys = (m.accountKeys || []).map(k => typeof k === 'string' ? k : k && k.pubkey);
    if (!keys.includes(p.ref)) continue;
    const ins = [...(m.instructions || []), ...((tx.meta.innerInstructions || []).flatMap(i => i.instructions || []))];
    let got = 0, payer = '';
    for (const i of ins) {
      const pi = i && i.parsed;
      if (i && i.program === 'system' && pi && (pi.type === 'transfer' || pi.type === 'transferWithSeed') && pi.info && pi.info.destination === p.recipient) {
        got += Number(pi.info.lamports) || 0; payer = payer || pi.info.source || '';
      }
    }
    if (!got) continue;   // not a payment to the payment wallet
    const ts = tx.blockTime || now();
    if (got !== p.lamports) {
      // wrong or partial amount: never accepted — kept for a refund by hand
      try {
        await DB.prepare(`INSERT INTO payments(ref, user_id, plan, sol, lamports, recipient, status, sig, payer, got, created, paid_at, checked, note)
          VALUES(?, ?, ?, ?, ?, ?, 'review', ?, ?, ?, ?, ?, ?, ?)`).bind('x' + x.signature.slice(0, 43), p.user_id, p.plan, p.sol, p.lamports, p.recipient, x.signature, payer, got, now(), ts, now(),
          `Sent ${solOf(got)} SOL instead of ${solOf(p.lamports)} SOL`).run();
        const u = await DB.prepare('SELECT * FROM users WHERE id = ?').bind(p.user_id).first();
        await logEvent(env, 'warn', 'payments', `Wrong amount from ${whoOf(u)}: ${solOf(got)} SOL for ${PLANS[p.plan].name} (${solOf(p.lamports)} SOL)`, 'Money → Needs refund');
      } catch (e) { /* already recorded */ }
      continue;
    }
    return await activate(env, p, x.signature, payer, got, ts);
  }
  return p;
}
async function activate(env, p, sig, payer, got, ts) {
  const DB = env.DB, s = await getSettings(env), px = await solPrice(), t = now();
  try {
    const c = await DB.prepare("UPDATE payments SET status = 'paid', sig = ?, payer = ?, got = ?, paid_at = ?, usd = ? WHERE id = ? AND status = 'pending'")
      .bind(sig, payer, got, ts, px.usd || 0, p.id).run();
    if (!c.meta || !c.meta.changes) return await DB.prepare('SELECT * FROM payments WHERE id = ?').bind(p.id).first();   // someone else handled it
  } catch (e) { return p; }   // signature used by another payment
  const u = await DB.prepare('SELECT * FROM users WHERE id = ?').bind(p.user_id).first();
  const before = u && planActive(u) ? (u.plan === 'lifetime' ? -1 : u.plan_until) : 0;
  let ok = false, note = '';
  if (!u) note = 'User not found';
  else if (u.plan === 'lifetime') note = 'Already had Founder lifetime';
  else if (p.plan === 'lifetime') {
    // one statement = no overselling, even if two people pay in the same second
    const r = await DB.prepare("UPDATE users SET plan = 'lifetime', plan_until = 0 WHERE id = ? AND plan != 'lifetime' AND (SELECT COUNT(*) FROM users WHERE plan = 'lifetime') < ?")
      .bind(u.id, Number(s.founder_max) || 0).run();
    ok = !!(r.meta && r.meta.changes); if (!ok) note = 'Founder seats were full';
  } else {
    // renewing adds the days on top of the time that is left
    const r = await DB.prepare(`UPDATE users SET plan = ?, plan_until = (CASE WHEN plan NOT IN ('free', 'lifetime') AND plan_until > ? THEN plan_until ELSE ? END) + ? WHERE id = ? AND plan != 'lifetime'`)
      .bind(p.plan, t, t, PLANS[p.plan].days * 86400, u.id).run();
    ok = !!(r.meta && r.meta.changes); if (!ok) note = 'Could not update the plan';
  }
  const u2 = u ? await DB.prepare('SELECT * FROM users WHERE id = ?').bind(u.id).first() : null;
  if (ok) {
    await DB.prepare('UPDATE payments SET until_before = ?, until_after = ? WHERE id = ?').bind(before, u2.plan === 'lifetime' ? -1 : u2.plan_until, p.id).run();
    await logEvent(env, 'info', 'payments', `Payment ${solOf(got)} SOL · ${PLANS[p.plan].name} · ${whoOf(u)}`);
    await bump(env, 'payments');
  } else {
    await DB.prepare("UPDATE payments SET status = 'review', note = ? WHERE id = ?").bind(note, p.id).run();
    await logEvent(env, 'warn', 'payments', `Payment from ${whoOf(u)} needs a refund: ${note}`, 'Money → Needs refund');
  }
  return await DB.prepare('SELECT * FROM payments WHERE id = ?').bind(p.id).first();
}
// called by the cron and when the owner opens Money: new requests every run, older ones every 30 minutes
async function recheckPending(env, max) {
  const DB = env.DB, t = now();
  await DB.prepare("UPDATE payments SET status = 'expired' WHERE status = 'pending' AND created < ?").bind(t - PAY_GIVEUP).run();
  const rows = (await DB.prepare(`SELECT * FROM payments WHERE status = 'pending' AND ((created > ? AND checked < ?) OR checked < ?) ORDER BY created DESC LIMIT ?`)
    .bind(t - 3600, t - 120, t - 1800, max).all()).results || [];
  if (!rows.length) return 0;
  const key = await getKey(env, 'helius'); if (!key) return 0;
  let n = 0;
  for (const p of rows) { try { const r = await checkPayment(env, p, key); if (r && r.status === 'paid') n++; } catch (e) { break; } }   // Helius trouble → try next run
  return n;
}

async function payApi(req, env, path, later) {
  const DB = env.DB, t = now(), b = req.method === 'POST' ? await body(req) : {};
  const s = await getSettings(env), se = await sessionFromRequest(req, env), u = se ? se.user : null;

  // 1) start a payment → one-time reference key
  if (path === '/api/pay/start' && req.method === 'POST') {
    if (!u) return fail(req, 401, 'Sign in first so the plan goes to your account');
    if (s.payments !== '1') return fail(req, 403, 'Payments are not open yet');
    const plan = String(b.plan || '');
    if (!PLANS[plan]) return fail(req, 400, 'Pick a plan');
    const prices = JSON.parse(s.prices), lamports = lam(prices[plan]);
    if (!(lamports > 0)) return fail(req, 400, 'This plan has no price yet');
    if (!isWallet(s.pay_wallet)) return fail(req, 503, 'Payments are paused for a moment — try again later');
    if (!(await getKey(env, 'helius'))) { await logEvent(env, 'error', 'payments', 'Someone tried to pay but the Helius key is missing', 'More → API keys → add Helius'); return fail(req, 503, 'Payments are paused for a moment — try again later'); }
    if (u.plan === 'lifetime') return fail(req, 400, 'You already have Founder lifetime');
    if (u.wallet && u.wallet === s.pay_wallet) return fail(req, 400, 'This is the payment wallet itself — sign in with another account to test');
    const open = await DB.prepare("SELECT * FROM payments WHERE user_id = ? AND plan = ? AND lamports = ? AND recipient = ? AND status = 'pending' AND created > ? ORDER BY id DESC LIMIT 1")
      .bind(u.id, plan, lamports, s.pay_wallet, t - PAY_HOLD).first();
    if (open) return json(req, { ok: true, payment: payOut(open, { usd: (await solPrice()).usd }) });
    if (plan === 'lifetime') {
      if (s.founder !== '1') return fail(req, 400, 'The Founder plan is closed');
      const r = await DB.batch([DB.prepare("SELECT COUNT(*) n FROM users WHERE plan = 'lifetime'"),
        DB.prepare("SELECT COUNT(DISTINCT user_id) n FROM payments WHERE plan = 'lifetime' AND status = 'pending' AND created > ? AND user_id != ?").bind(t - PAY_HOLD, u.id)]);
      const sold = r[0].results[0].n, held = r[1].results[0].n, max = Number(s.founder_max) || 0;
      if (sold >= max) return fail(req, 400, 'All Founder seats are taken');
      if (sold + held >= max) return fail(req, 400, 'The last Founder seats are being paid for right now — try again in 20 minutes');
    }
    const recent = await DB.prepare('SELECT COUNT(*) n FROM payments WHERE user_id = ? AND created > ?').bind(u.id, t - 3600).first();
    if (recent && recent.n >= 12) return fail(req, 429, 'Too many payment requests — wait a few minutes');
    const rb = new Uint8Array(32); crypto.getRandomValues(rb);
    const ref = b58encode(rb);
    await DB.prepare('INSERT INTO payments(ref, user_id, plan, sol, lamports, recipient, created) VALUES(?, ?, ?, ?, ?, ?, ?)').bind(ref, u.id, plan, solOf(lamports), lamports, s.pay_wallet, t).run();
    const p = await DB.prepare('SELECT * FROM payments WHERE ref = ?').bind(ref).first();
    return json(req, { ok: true, payment: payOut(p, { usd: (await solPrice()).usd }) });
  }

  // the reference key works like a ticket: it only lets someone pay for that plan, so these two need no sign-in
  // (that way a Google user can open Phantom just to pay)
  const ref = String(b.ref || '');
  const row = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(ref) ? await DB.prepare('SELECT * FROM payments WHERE ref = ?').bind(ref).first() : null;

  // 2) details for the wallet, with a fresh blockhash
  if (path === '/api/pay/intent' && req.method === 'POST') {
    if (!row) return fail(req, 404, 'This payment link is not valid');
    if (row.status !== 'pending') return json(req, { ok: true, payment: payOut(row) });
    if (row.created < t - PAY_GIVEUP) return fail(req, 400, 'This payment link expired — start again in the app');
    const key = await getKey(env, 'helius'); if (!key) return fail(req, 503, 'Payments are paused for a moment — try again later');
    const bh = await rpc(env, key, 'getLatestBlockhash', [{ commitment: 'confirmed' }]);
    const owner = await DB.prepare('SELECT wallet, email FROM users WHERE id = ?').bind(row.user_id).first();
    return json(req, { ok: true, payment: payOut(row, { blockhash: bh && bh.value ? bh.value.blockhash : '', account: owner ? (owner.email ? owner.email.replace(/(.{3}).*@/, '$1…@') : short4(owner.wallet || '')) : '' }) });
  }

  // 3) has it arrived?
  if (path === '/api/pay/check' && req.method === 'POST') {
    const key = await getKey(env, 'helius');
    if (row) {
      let p = row;
      if (p.status === 'pending' && key && t - p.checked >= 3) { try { p = await checkPayment(env, p, key); } catch (e) { /* answer with what we know */ } }
      const mine = u && u.id === p.user_id;
      const fresh = mine ? await DB.prepare('SELECT * FROM users WHERE id = ?').bind(u.id).first() : null;
      return json(req, { ok: true, payment: payOut(p), user: fresh ? publicUser(fresh, s) : undefined });
    }
    if (!u) return fail(req, 404, 'This payment is not valid');
    const rows = (await DB.prepare("SELECT * FROM payments WHERE user_id = ? AND status = 'pending' AND created > ? ORDER BY id DESC LIMIT 5").bind(u.id, t - PAY_GIVEUP).all()).results || [];
    const out = [];
    for (let p of rows) { if (key && t - p.checked >= 3) { try { p = await checkPayment(env, p, key); } catch (e) { } } out.push(payOut(p)); }
    const fresh = await DB.prepare('SELECT * FROM users WHERE id = ?').bind(u.id).first();
    return json(req, { ok: true, payments: out, user: publicUser(fresh, s) });
  }

  // 4) my receipts
  if (path === '/api/pay/mine' && req.method === 'GET') {
    if (!u) return fail(req, 401, 'Not signed in');
    const rows = (await DB.prepare("SELECT * FROM payments WHERE user_id = ? AND status IN ('paid', 'review', 'refunded') ORDER BY COALESCE(NULLIF(paid_at, 0), created) DESC LIMIT 20").bind(u.id).all()).results || [];
    return json(req, { ok: true, payments: rows.map(p => payOut(p, { got: solOf(p.got) })) });
  }
  return fail(req, 404, 'Not found');
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

async function owner(req, env, route, s, se, later) {
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
      ['payReview', "SELECT COUNT(*) n FROM payments WHERE status = 'review'"], ['payToday', "SELECT COALESCE(SUM(got), 0) n FROM payments WHERE status = 'paid' AND paid_at >= ?", dayStart(t, q.get('tz'))],
      ['issues', "SELECT ts, level, src, msg, fix FROM events WHERE level = 'error' AND ts > ? ORDER BY id DESC LIMIT 3", t - 86400], ['activity', 'SELECT ts, level, src, msg FROM events ORDER BY id DESC LIMIT 8']];
    const res = await DB.batch(q1.map(([, sql, ...a]) => DB.prepare(sql).bind(...a)));   // one trip to the database
    const out = { settings: { site_live: s.site_live, signups: s.signups, alerts: s.alerts } };
    q1.forEach(([k], i) => { const rows = res[i].results || []; out[k] = k === 'issues' || k === 'activity' ? rows : (rows[0] ? rows[0].n || 0 : 0); });
    out.keysMissing = Object.keys(KEY_NAMES).length - out.keys;
    return json(req, { ok: true, home: out });
  }

  if (route === 'settings' && req.method === 'GET') {
    const out = { ...s };
    for (const k of Object.keys(out)) if (k.startsWith('salt_') || k === 'hook_secret') delete out[k];
    out.prices = JSON.parse(s.prices);
    out.signedInAgo = t - se.created;
    return json(req, { ok: true, settings: out });
  }
  if (route === 'settings' && req.method === 'POST') {
    const ch = b.changes || {};
    for (const [k, v] of Object.entries(ch)) {
      if (!(k in DEFAULTS) || k.startsWith('hook_')) return fail(req, 400, 'Unknown setting ' + k);
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
    const tr = await DB.prepare('SELECT COUNT(*) n FROM trades WHERE ts > ?').bind(t - 86400).first();
    return json(req, { ok: true, health: { server: 'ok', db, keys, requestsToday: st ? st.n : 0, events, hook: { on: !!s.hook_id, err: s.hook_err || '', trades24h: tr ? tr.n : 0 } } });
  }
  if (route === 'events/clear' && req.method === 'POST') {
    await DB.prepare("DELETE FROM events WHERE level IN ('error','warn')").run();
    return json(req, { ok: true });
  }

  // ---- live tracking ----
  if (route === 'hook' && req.method === 'GET') {
    const r = await DB.batch([DB.prepare('SELECT COUNT(*) n, MAX(ts) last FROM trades WHERE ts > ?').bind(t - 86400), DB.prepare('SELECT COUNT(*) n FROM site_wallets WHERE hidden = 0'), DB.prepare('SELECT COUNT(DISTINCT wallet) n FROM user_wallets')]);
    const a = r[0].results[0] || {};
    return json(req, { ok: true, hook: { on: !!s.hook_id, id: s.hook_id || '', count: +s.hook_count || 0, synced: +s.hook_synced || 0, err: s.hook_err || '',
      trades24h: a.n || 0, lastTrade: a.last || 0, siteWallets: r[1].results[0].n, userWallets: r[2].results[0].n } });
  }
  if (route === 'hook' && req.method === 'POST') {
    if (b.action === 'off') {
      const key = await getKey(env, 'helius');
      if (s.hook_id && key) { try { await fetch(`https://api.helius.xyz/v0/webhooks/${s.hook_id}?api-key=${encodeURIComponent(key)}`, { method: 'DELETE' }); } catch (e) { } }
      await setSetting(env, 'hook_id', ''); await logEvent(env, 'warn', 'tracking', 'Live tracking turned off');
      return json(req, { ok: true });
    }
    const res = await syncHook(env, new URL(req.url).origin);
    if (res.ok) await logEvent(env, 'info', 'tracking', `Live tracking synced · ${res.count} wallets`);
    return res.ok ? json(req, { ok: true, result: res }) : fail(req, 400, res.error);
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
    return json(req, { ok: true, wallet: { address: w, sol, error: err, founderSold: sold ? sold.n : 0, founderMax: Number(s.founder_max), usd: px.usd } });
  }

  // ---- payments ----
  if (route === 'payments' && req.method === 'GET') {
    later(recheckPending(env, 10).catch(() => { }));   // look for anything people paid and then closed the app
    const f = ['all', 'paid', 'review', 'pending'].includes(q.get('filter')) ? q.get('filter') : 'all';
    const lim = Math.min(200, Math.max(1, Number(q.get('limit')) || 30));
    const where = { all: "p.status IN ('paid', 'review', 'refunded')", paid: "p.status = 'paid'", review: "p.status = 'review'", pending: "p.status = 'pending'" }[f];
    const midDay = dayStart(t, q.get('tz'));
    const sum = from => DB.prepare("SELECT COUNT(*) n, COALESCE(SUM(got), 0) l, COALESCE(SUM(got / 1e9 * usd), 0) r FROM payments WHERE status = 'paid' AND paid_at >= ?").bind(from);
    const r = await DB.batch([sum(midDay), sum(t - 7 * 86400), sum(0),
      DB.prepare("SELECT SUM(status = 'review') review, SUM(status = 'pending' AND created > ?) pending, SUM(status = 'paid') paid, SUM(status = 'refunded') refunded FROM payments").bind(t - 3600),
      DB.prepare(`SELECT p.*, u.wallet uwallet, u.email uemail, u.name uname FROM payments p LEFT JOIN users u ON u.id = p.user_id WHERE ${where}
        ORDER BY COALESCE(NULLIF(p.paid_at, 0), p.created) DESC LIMIT ?`).bind(lim + 1)]);
    const px = await solPrice();
    const tot = i => { const x = r[i].results[0] || {}; return { n: x.n || 0, sol: solOf(x.l || 0), usd: Math.round((x.r || 0) * 100) / 100 }; };
    const rows = r[4].results || [];
    return json(req, { ok: true, income: { today: tot(0), week: tot(1), all: tot(2) }, counts: r[3].results[0] || {}, usdNow: px.usd, more: rows.length > lim,
      payments: rows.slice(0, lim).map(p => ({ id: p.id, plan: p.plan, planName: PLANS[p.plan] ? PLANS[p.plan].name : p.plan, sol: solOf(p.lamports), got: solOf(p.got), status: p.status,
        sig: p.sig || '', payer: p.payer, created: p.created, paidAt: p.paid_at, until: p.until_after, before: p.until_before, usd: p.usd, note: p.note, ref: p.ref,
        user: { id: p.user_id, wallet: p.uwallet || '', email: p.uemail || '', name: p.uname || '' } })) });
  }
  if (route === 'payments/action' && req.method === 'POST') {
    const p = await DB.prepare('SELECT * FROM payments WHERE id = ?').bind(Number(b.id)).first();
    if (!p) return fail(req, 404, 'Payment not found');
    if (b.action === 'refunded') {
      if (p.status !== 'review') return fail(req, 400, 'Only payments that need a refund can be marked refunded');
      await DB.prepare("UPDATE payments SET status = 'refunded', note = ? WHERE id = ?").bind((p.note ? p.note + ' · ' : '') + 'refunded ' + dayOf(t), p.id).run();
      await logEvent(env, 'info', 'payments', `Marked refunded: ${solOf(p.got)} SOL to ${p.payer ? short4(p.payer) : 'payer'}`);
      return json(req, { ok: true });
    }
    if (b.action === 'recheck') {
      if (p.status !== 'pending' && p.status !== 'expired') return fail(req, 400, 'This payment is already done');
      if (p.status === 'expired') await DB.prepare("UPDATE payments SET status = 'pending' WHERE id = ?").bind(p.id).run();
      const key = await getKey(env, 'helius'); if (!key) return fail(req, 400, 'Add your Helius key first');
      const r = await checkPayment(env, { ...p, status: 'pending' }, key);
      if (r.status === 'pending' && p.status === 'expired') await DB.prepare("UPDATE payments SET status = 'expired' WHERE id = ? AND status = 'pending'").bind(p.id).run();
      return json(req, { ok: true, status: r.status === 'pending' && p.status === 'expired' ? 'expired' : r.status });
    }
    return fail(req, 400, 'Unknown action');
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
  // ---- data test: compare Solana Tracker fees + price-change time frames with DexScreener on real tokens ----
  if (route === 'datatest' && req.method === 'POST') {
    const key = await getKey(env, 'stracker');
    if (!key) return fail(req, 400, 'Add your Solana Tracker key in More → API keys');
    const st = async p => { const r = await fetch('https://data.solanatracker.io' + p, { headers: { 'x-api-key': key, accept: 'application/json' } }); await bump(env, 'call_stracker');
      const j = await r.json().catch(() => null); return { status: r.status, j }; };
    let mints = (Array.isArray(b.mints) ? b.mints : []).map(x => String(x).trim()).filter(x => /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(x));
    mints = [...new Set(mints)].slice(0, 5);
    let source = 'yours';
    if (!mints.length) {
      const hot = (await DB.prepare("SELECT mint, COUNT(DISTINCT wallet) n FROM trades WHERE ts > ? AND side = 'buy' GROUP BY mint ORDER BY n DESC LIMIT 5").bind(t - 4 * 3600).all()).results || [];
      mints = hot.map(r => r.mint); source = 'feed';
      if (!mints.length) { const tr = await st('/tokens/trending/1h'); mints = (Array.isArray(tr.j) ? tr.j : []).map(x => x && x.token && x.token.mint).filter(Boolean).slice(0, 5); source = 'trending'; }
    }
    if (!mints.length) return fail(req, 400, 'No tokens found to test — paste some addresses');
    let dex = {};
    try { const r = await fetch('https://api.dexscreener.com/tokens/v1/solana/' + mints.join(',')); const list = r.ok ? await r.json() : [];
      for (const p of Array.isArray(list) ? list : []) { const a = p.baseToken && p.baseToken.address; if (!a || !mints.includes(a)) continue; if (!dex[a] || ((p.liquidity || {}).usd || 0) > ((dex[a].liquidity || {}).usd || 0)) dex[a] = p; } } catch (e) { }
    const out = [];
    for (const m of mints) {
      const [ti, ss] = await Promise.all([st('/tokens/' + m), st('/stats/' + m)]);
      const info = ti.j || {}, stats = ss.j || {}, d = dex[m];
      const ev = {}; for (const [k, v] of Object.entries(info.events || {})) ev[k] = v && typeof v.priceChangePercentage === 'number' ? v.priceChangePercentage : null;
      const sv = {}; for (const [k, v] of Object.entries(stats || {})) if (v && typeof v === 'object' && 'priceChangePercentage' in v) sv[k] = { pc: v.priceChangePercentage, buyers: v.buyers ?? null, sellers: v.sellers ?? null };
      out.push({ mint: m, symbol: (info.token && info.token.symbol) || (d && d.baseToken && d.baseToken.symbol) || '', status: { info: ti.status, stats: ss.status },
        fees: info.risk && info.risk.fees != null ? info.risk.fees : null, poolFees: (info.pools || []).map(p => p && p.fees).filter(x => x != null).slice(0, 3),
        events: ev, stats: sv, dex: d && d.priceChange ? { '5m': d.priceChange.m5 ?? null, '1h': d.priceChange.h1 ?? null, '6h': d.priceChange.h6 ?? null, '24h': d.priceChange.h24 ?? null } : null,
        volume24h: d && d.volume ? d.volume.h24 : null });
    }
    await logEvent(env, 'info', 'datatest', `Data test run on ${out.length} token${out.length > 1 ? 's' : ''}`);
    return json(req, { ok: true, source, tokens: out });
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
    if (fresh.length) { await logEvent(env, 'info', 'wallets', `${fresh.length} wallet${fresh.length > 1 ? 's' : ''} added (${src})`); hookLater(env, s, later); }
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
    if (n) { await logEvent(env, 'warn', 'wallets', `${n} wallet${n > 1 ? 's' : ''} deleted`); hookLater(env, s, later); }
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
