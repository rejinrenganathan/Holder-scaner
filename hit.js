// Counts one page view on your Holder Scan server (for the owner dashboard → Traffic).
// No cookies and nothing stored on the phone. The server turns the visit into an ID that changes every day.
// HS_API: your server address, e.g. https://holder-scan-api.yourname.workers.dev (set once the server is live).
(function () {
  var HS_API = 'https://holder-scan-api.rejinrenganathan.workers.dev';
  try {
    var api = HS_API || localStorage.getItem('hs_api') || '';
    if (!/^https:\/\/[^/]+$/.test(api)) return;
    var installed = (window.matchMedia && matchMedia('(display-mode: standalone)').matches) || navigator.standalone ? 1 : 0;
    fetch(api + '/api/hit', {
      method: 'POST', keepalive: true, mode: 'cors', credentials: 'omit',
      headers: { 'content-type': 'text/plain' },
      body: JSON.stringify({ p: location.pathname, r: document.referrer, i: installed })
    }).catch(function () { });
  } catch (e) { }
})();
