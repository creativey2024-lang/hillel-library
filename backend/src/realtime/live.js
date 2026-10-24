const url = require('url');
const { parseCookies } = require('../util/cookies');
const { verify } = require('../util/tokens');
const { acceptUpgrade, rejectUpgrade } = require('./ws');
const { createPartyHub } = require('./partyHub');

// Hooks the live WebSocket channel (/api/live) onto the HTTP server. Only
// logged-in users can connect (the same session cookie as the rest of the site).
function attachLiveChannel(server, { jwtSecret, hub = createPartyHub(), pingEveryMs = 25000 }) {
  const sockets = new Set();

  server.on('upgrade', (req, socket, head) => {
    const { pathname } = url.parse(req.url);
    if (pathname !== '/api/live') {
      rejectUpgrade(socket, 404, 'Not Found');
      return;
    }
    const token = parseCookies(req.headers.cookie)['hillel_session'];
    const payload = token ? verify(token, jwtSecret) : null;
    if (!payload || !payload.username) {
      rejectUpgrade(socket, 401, 'Unauthorized');
      return;
    }
    const ws = acceptUpgrade(req, socket, head);
    if (!ws) return;
    sockets.add(ws);
    ws.on('close', () => sockets.delete(ws));
    hub.connect(ws, payload.username);
  });

  // keep connections alive through proxies, drop ones that stopped answering
  const timer = setInterval(() => {
    const t = Date.now();
    for (const ws of sockets) {
      if (t - ws.lastPong > pingEveryMs * 2.5) ws.terminate();
      else ws.ping();
    }
  }, pingEveryMs);
  if (timer.unref) timer.unref();
  server.on('close', () => clearInterval(timer));
  return hub;
}

module.exports = { attachLiveChannel };
