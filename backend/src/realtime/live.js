const url = require('url');
const { parseCookies } = require('../util/cookies');
const { verify } = require('../util/tokens');
const { sessionTokenFrom } = require('../middleware/auth');
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
    const check = (token) => {
      const payload = token ? verify(token, jwtSecret) : null;
      return payload && payload.username ? payload.username : null;
    };
    const cookieUser = check(sessionTokenFrom(req, parseCookies(req.headers.cookie)));
    const ws = acceptUpgrade(req, socket, head);
    if (!ws) return;
    sockets.add(ws);
    ws.on('close', () => sockets.delete(ws));
    // A browser tab with its own session sends it first ({ type: 'auth', token })
    // - a WebSocket can't carry headers, and tokens don't belong in addresses.
    // Without it, the site's cookie decides who this is.
    const timeout = setTimeout(() => ws.terminate(), 10000);
    ws.on('close', () => clearTimeout(timeout));
    const first = (text) => {
      ws.removeListener('message', first);
      clearTimeout(timeout);
      let msg = null;
      try {
        msg = JSON.parse(text);
      } catch (err) {
        // not JSON
      }
      const isAuth = msg && msg.type === 'auth';
      const username = isAuth ? check(typeof msg.token === 'string' ? msg.token : '') || cookieUser : cookieUser;
      if (!username) {
        ws.close(4001, 'Unauthorized');
        return;
      }
      hub.connect(ws, username);
      // the first message was a normal one: let the hub handle it too
      if (!isAuth) ws.emit('message', text);
    };
    ws.on('message', first);
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
