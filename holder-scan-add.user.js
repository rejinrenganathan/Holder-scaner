// ==UserScript==
// @name         Holder Scan – add wallets from any site
// @namespace    holder-scan
// @version      1.1.0
// @description  Puts a ＋ button next to every Solana wallet on GMGN, Axiom, Pump.fun, Padre Terminal, Solscan, Birdeye, Kolscan, DexScreener… Tap ＋ on the wallets you want, then "Send" to add them to your Holder Scan tracker (with name and X handle when the page shows them).
// @match        https://gmgn.ai/*
// @match        https://*.gmgn.ai/*
// @match        https://axiom.trade/*
// @match        https://*.axiom.trade/*
// @match        https://pump.fun/*
// @match        https://*.pump.fun/*
// @match        https://padre.gg/*
// @match        https://*.padre.gg/*
// @match        https://solscan.io/*
// @match        https://birdeye.so/*
// @match        https://*.birdeye.so/*
// @match        https://kolscan.io/*
// @match        https://dexscreener.com/*
// @match        https://photon-sol.tinyastro.io/*
// @match        https://neo.bullx.io/*
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_openInTab
// @run-at       document-idle
// @updateURL    https://rejinrenganathan.github.io/Holder-scaner/holder-scan-add.user.js
// @downloadURL  https://rejinrenganathan.github.io/Holder-scaner/holder-scan-add.user.js
// ==/UserScript==
(function () {
  'use strict';
  // your Holder Scan app (change this if your GitHub Pages address is different)
  const APP = 'https://rejinrenganathan.github.io/Holder-scaner/';

  const B58 = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
  const B58G = /[1-9A-HJ-NP-Za-km-z]{32,44}/;
  // links that point at a WALLET (not a token)
  const WALLET_PATH = /\/(?:address|account|profile|wallet|wallets|trader|traders|portfolio|user|maker|kol|tracker|dev)\/([1-9A-HJ-NP-Za-km-z]{32,44})(?=[/?#]|$)/i;
  const WALLET_Q = /[?&](?:maker|wallet|address|owner|user|trader)=([1-9A-HJ-NP-Za-km-z]{32,44})/i;
  const TOKEN_PATH = /\/(?:token|tokens|coin|coins|meme|pair|pairs|swap|trade\/solana)\//i;
  const SKIP = new Set(['So11111111111111111111111111111111111111112', '11111111111111111111111111111111', 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA', 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb', '6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P']);

  const get = (k, d) => { try { const v = GM_getValue(k); return v === undefined ? d : v; } catch (e) { return d; } };
  const set = (k, v) => { try { GM_setValue(k, v); } catch (e) {} };
  let Q = get('q', []);            // picked wallets waiting to be sent: {w,n,x}
  let SENT = new Set(get('sent', []));
  let MODE = get('mode', 'auto');  // auto = X handle → KOL, rest → Smart · smart = everything as Smart
  let TO = get('to', 'chrome');    // which browser has your Holder Scan app: chrome (hand-off) or firefox (this browser)
  const inQ = w => Q.some(o => o.w === w);

  // ---------- styles ----------
  const css = document.createElement('style');
  css.textContent = `
  .hsx-b{all:unset;box-sizing:border-box;display:inline-flex!important;align-items:center;justify-content:center;min-width:22px;height:20px;padding:0 5px;margin:0 3px;border-radius:7px;
    background:#6d5dfc;color:#fff!important;font:800 12px/1 -apple-system,system-ui,sans-serif!important;cursor:pointer;vertical-align:middle;flex:0 0 auto;z-index:5;position:relative}
  .hsx-b.on{background:#22c55e}.hsx-b.sent{background:#334155}
  #hsx-p{position:fixed;left:10px;bottom:74px;z-index:2147483647;display:none;align-items:center;gap:6px;background:#111827;color:#fff;border:1px solid #6d5dfc;border-radius:14px;
    padding:8px 10px;font:700 13px -apple-system,system-ui,sans-serif;box-shadow:0 8px 24px rgba(0,0,0,.45)}
  #hsx-p button{all:unset;cursor:pointer;padding:6px 10px;border-radius:9px;font-weight:800;font-size:12.5px}
  #hsx-p .go{background:#6d5dfc}#hsx-p .md{background:#1f2937}#hsx-p .x{background:#1f2937;color:#f87171}
  #hsx-p .pg{background:#22c55e;color:#06210f}`;
  document.documentElement.appendChild(css);

  // ---------- floating panel ----------
  const P = document.createElement('div'); P.id = 'hsx-p';
  document.documentElement.appendChild(P);
  function pageWallet() {
    const u = location.pathname + location.search;
    if (TOKEN_PATH.test(location.pathname)) return null;
    const m = u.match(WALLET_PATH) || u.match(WALLET_Q);
    return m && !SKIP.has(m[1]) ? m[1] : null;
  }
  function drawPanel() {
    const pw = pageWallet();
    const showPage = pw && !inQ(pw);
    if (!Q.length && !showPage) { P.style.display = 'none'; return; }
    P.style.display = 'flex';
    P.innerHTML = `${showPage ? '<button class="pg" data-a="page">＋ Add this wallet</button>' : ''}` +
      (Q.length ? `<span>📥 ${Q.length}</span><button class="md" data-a="mode">${MODE === 'smart' ? '🧠 All Smart' : '👑/🧠 Auto'}</button><button class="md" data-a="to">${TO === 'chrome' ? '→ Chrome' : '→ Firefox'}</button><button class="go" data-a="send">Send</button><button class="x" data-a="clear">✕</button>` : '');
  }
  P.addEventListener('click', e => {
    const a = e.target.closest('[data-a]'); if (!a) return; e.preventDefault(); e.stopPropagation();
    const act = a.dataset.a;
    if (act === 'page') { const w = pageWallet(); if (w) toggle({ w, n: pageName(), x: pageHandle() }); }
    if (act === 'mode') { MODE = MODE === 'smart' ? 'auto' : 'smart'; set('mode', MODE); }
    if (act === 'to') { TO = TO === 'chrome' ? 'firefox' : 'chrome'; set('to', TO); }
    if (act === 'clear') { Q = []; set('q', Q); refreshButtons(); }
    if (act === 'send') send();
    drawPanel();
  }, true);

  function send() {
    if (!Q.length) return;
    const json = JSON.stringify(Q.map(o => [o.w, o.n || '', o.x || '']));
    const b64 = btoa(unescape(encodeURIComponent(json))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    const qs = 'add=' + b64 + '&as=' + MODE + '&from=' + encodeURIComponent(location.hostname.replace(/^www\./, ''));
    const url = APP + '#' + qs;
    Q.forEach(o => SENT.add(o.w)); set('sent', [...SENT].slice(-5000));
    Q = []; set('q', Q); refreshButtons(); drawPanel();
    if (TO === 'chrome') {
      // Android hand-off: open the app in Chrome (your installed Chrome app gets the wallets, not this Firefox copy)
      const u = new URL(APP);
      const intent = 'intent://' + u.host + u.pathname + '?' + qs + '#Intent;scheme=https;package=com.android.chrome;S.browser_fallback_url=' + encodeURIComponent(APP + '?' + qs) + ';end';
      const a = document.createElement('a'); a.href = intent; a.rel = 'noopener'; document.body.appendChild(a); a.click(); setTimeout(() => a.remove(), 1000);
      return;
    }
    try { GM_openInTab(url, { active: true }); } catch (e) { window.open(url, '_blank'); }
  }
  function toggle(o) {
    const i = Q.findIndex(x => x.w === o.w);
    if (i >= 0) Q.splice(i, 1); else Q.push(o);
    set('q', Q); refreshButtons(); drawPanel();
  }

  // ---------- name / X handle from the row around a wallet ----------
  const xFrom = href => {
    const m = String(href || '').match(/^https?:\/\/(?:www\.|mobile\.)?(?:x|twitter)\.com\/@?([A-Za-z0-9_]{1,15})(?:[/?#]|$)/i);
    if (!m || /^(i|home|intent|search|share|status|hashtag|explore|settings)$/i.test(m[1])) return '';
    return m[1];
  };
  // wallets mentioned inside an element (links to wallet pages + full addresses in titles / text)
  function walletsIn(el) {
    const s = new Set();
    el.querySelectorAll('a[href]').forEach(a => { const w = walletFromHref(a.getAttribute('href')); if (w) s.add(w); });
    el.querySelectorAll('[title],[data-address]').forEach(e => { const v = (e.getAttribute('data-address') || e.getAttribute('title') || '').trim(); if (B58.test(v)) s.add(v); });
    return s;
  }
  // the row around a wallet: table row / list item, else the biggest parent that is still about this one wallet only
  function rowOf(el, w) {
    const r = el.closest('tr,[role="row"],li');
    if (r && walletsIn(r).size <= 1) return r;
    let n = el;
    for (let i = 0; i < 6 && n.parentElement; i++) {
      const p = n.parentElement; if ((p.innerText || '').length > 400) break;
      const ws = walletsIn(p); ws.delete(w); if (ws.size) break;
      n = p;
    }
    return n;
  }
  const looksAddr = t => /…|\.\.\./.test(t) || B58G.test(t) || /^[A-Za-z0-9]{3,6}[.…]{1,3}[A-Za-z0-9]{3,6}$/.test(t);
  function nameIn(row, anchor, w) {
    const cands = [];
    if (anchor) cands.push((anchor.innerText || '').trim().split('\n')[0]);
    row.querySelectorAll('a,span,div,p,b,strong').forEach(e => { if (e.children.length === 0) cands.push((e.textContent || '').trim()); });
    for (const t of cands) {
      if (!t || t.length < 2 || t.length > 32) continue;
      if (looksAddr(t) || (w && t.startsWith(w.slice(0, 4)) && t.endsWith(w.slice(-4)))) continue;
      if (/^[-+$◎~<>]?[\d.,]+\s*[%KMBkmb]?$/.test(t) || /^\$|%$|^\d+[smhdw]$|ago$/i.test(t)) continue;
      if (/^(buy|sell|copy|follow|track|share|holder|holders|trader|traders|top|pnl|profit|bought|sold|balance|hold|holding|＋|✓)$/i.test(t)) continue;
      return t;
    }
    return '';
  }
  function handleIn(row) {
    for (const a of row.querySelectorAll('a[href*="x.com/"],a[href*="twitter.com/"]')) { const h = xFrom(a.href); if (h) return h; }
    return '';
  }
  function pageHandle() { return handleIn(document.querySelector('main') || document.body); }
  function pageName() { const h = document.querySelector('h1,h2'); const t = h ? (h.innerText || '').trim() : ''; return t && t.length <= 32 && !looksAddr(t) ? t : ''; }

  // ---------- buttons ----------
  function mkBtn(w, info) {
    const b = document.createElement('button');
    b.className = 'hsx-b'; b.dataset.hsw = w; b.type = 'button'; b.title = 'Add to Holder Scan';
    paint(b);
    const stop = e => { e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation && e.stopImmediatePropagation(); };
    ['pointerdown', 'mousedown', 'touchstart', 'touchend', 'mouseup'].forEach(ev => b.addEventListener(ev, e => e.stopPropagation(), true));
    b.addEventListener('click', e => { stop(e); const o = info(); toggle({ w, n: o.n, x: o.x }); }, true);
    return b;
  }
  function paint(b) {
    const w = b.dataset.hsw, q = inQ(w), s = SENT.has(w);
    b.classList.toggle('on', q); b.classList.toggle('sent', !q && s);
    b.textContent = q ? '✓' : s ? '✓✓' : '＋';
  }
  function refreshButtons() { document.querySelectorAll('.hsx-b').forEach(paint); }

  function walletFromHref(href) {
    let u; try { u = new URL(href, location.href); } catch (e) { return null; }
    const path = u.pathname + u.search;
    if (TOKEN_PATH.test(u.pathname) && !WALLET_Q.test(u.search)) return null;
    const m = path.match(WALLET_PATH) || u.search.match(WALLET_Q);
    if (!m) return null;
    return SKIP.has(m[1]) ? null : m[1];
  }
  function already(row, w) { return !!row.querySelector(`.hsx-b[data-hsw="${w}"]`); }

  function scan() {
    // 1) links to wallet pages (GMGN /sol/address/…, Pump.fun /profile/…, Solscan /account/…, DexScreener ?maker=… …)
    document.querySelectorAll('a[href]:not([data-hsx])').forEach(a => {
      a.dataset.hsx = '1';
      if (a.closest('#hsx-p')) return;
      const w = walletFromHref(a.getAttribute('href')); if (!w) return;
      const row = rowOf(a, w); if (already(row, w)) return;
      const b = mkBtn(w, () => ({ n: nameIn(row, a, w), x: handleIn(row) }));
      // a link that wraps a whole row gets the button inside it, a small link gets it right after
      if ((a.innerText || '').length > 60 || getComputedStyle(a).display === 'block' || getComputedStyle(a).display === 'flex') a.appendChild(b);
      else a.insertAdjacentElement('afterend', b);
    });
    // 2) full addresses shown as text or in a title / data attribute (profile headers, holder lists, copy buttons)
    const pageW = pageWallet(), path = location.pathname;
    document.querySelectorAll('[title]:not([data-hsx]),[data-address]:not([data-hsx]),span:not([data-hsx]),div:not([data-hsx]),td:not([data-hsx]),p:not([data-hsx])').forEach(el => {
      if (el.children.length > 1) { el.dataset.hsx = '1'; return; }
      const cand = [el.getAttribute('data-address'), el.getAttribute('title'), el.children.length === 0 ? (el.textContent || '').trim() : ''].find(v => v && B58.test(v.trim()));
      el.dataset.hsx = '1';
      if (!cand) return;
      const w = cand.trim();
      if (SKIP.has(w)) return;
      if (path.includes(w) && w !== pageW) return;              // the token on its own token page — not a wallet
      if (el.closest('a[href]') && walletFromHref(el.closest('a[href]').getAttribute('href')) === w) return;
      const row = rowOf(el, w); if (already(row, w)) return;
      el.insertAdjacentElement('afterend', mkBtn(w, () => ({ n: nameIn(row, null, w), x: handleIn(row) })));
    });
    drawPanel();
  }

  // pages here are single-page apps: rescan when the page changes
  let t = null;
  new MutationObserver(() => { if (t) return; t = setTimeout(() => { t = null; scan(); }, 400); }).observe(document.documentElement, { childList: true, subtree: true });
  let lastUrl = location.href;
  setInterval(() => { if (location.href !== lastUrl) { lastUrl = location.href; drawPanel(); } }, 800);
  // the queue is shared across tabs and sites
  setInterval(() => { const q = get('q', []); if (JSON.stringify(q) !== JSON.stringify(Q)) { Q = q; refreshButtons(); drawPanel(); } }, 1500);
  scan();
})();
