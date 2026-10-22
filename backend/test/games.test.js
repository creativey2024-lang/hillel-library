const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hillel-games-'));
process.env.LOCAL_DB_FILE = path.join(tmpDir, 'local-db.json');
process.env.CREDENTIALS_FILE = path.join(tmpDir, 'credentials.json');
process.env.JWT_SECRET = 'games-test-secret';
process.env.GAME_DAILY_COIN_CAP = '2500';

const { createApp } = require('../src/http/miniHttp');
const { attachUser } = require('../src/middleware/auth');
const store = require('../src/services/store');
const credentials = require('../src/services/credentialsStore');
const { loadSeed } = require('../src/services/db');
const economy = require('../src/services/gameEconomy');
const createAuthRouter = require('../src/routes/auth');
const createStaffRouter = require('../src/routes/staff');
const createGamesRouter = require('../src/routes/games');

const SUPER = 'מארק';
const seed = loadSeed();
store.configureCloud({});
credentials.configureCloud({});

// A clock the tests can move forward, so "a 60 second run" takes no real time.
let clock = Date.parse('2026-10-22T09:00:00Z');

const app = createApp();
app.use(attachUser(process.env.JWT_SECRET));
app.use('/api/auth', createAuthRouter({
  jwtSecret: process.env.JWT_SECRET, sessionTtlSeconds: 3600, pendingTtlSeconds: 300, superAdminUsername: SUPER, isProd: false,
}));
app.use('/api/staff', createStaffRouter({ superAdminUsername: SUPER, defaultPassword: 'chop' }));
app.use('/api/games', createGamesRouter({
  jwtSecret: process.env.JWT_SECRET, sessionTtlSeconds: 3600, isProd: false, superAdminUsername: SUPER, now: () => clock,
}));

let server;
let baseUrl;

test.before(async () => {
  await credentials.ensureSeeded(seed.staff.map((m) => ({ username: m.username, password: 'chop', secondary: m.username === SUPER ? 'x' : undefined })));
  await new Promise((resolve) => {
    server = app.listen(0, () => {
      baseUrl = `http://127.0.0.1:${server.address().port}`;
      resolve();
    });
  });
});

test.after(() => {
  server.close();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function makeClient() {
  const jar = {};
  async function request(method, urlPath, body) {
    const headers = { Cookie: Object.entries(jar).map(([k, v]) => `${k}=${v}`).join('; ') };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    const res = await fetch(`${baseUrl}${urlPath}`, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
    (res.headers.getSetCookie ? res.headers.getSetCookie() : []).forEach((line) => {
      const [pair] = line.split(';');
      const i = pair.indexOf('=');
      jar[pair.slice(0, i)] = pair.slice(i + 1);
    });
    let data = null;
    try { data = await res.json(); } catch (e) { /* no body */ }
    return { status: res.status, data };
  }
  return { get: (p) => request('GET', p), post: (p, b) => request('POST', p, b ?? {}) };
}

async function login(username) {
  const c = makeClient();
  const r = await c.post('/api/auth/login', { username, password: 'chop' });
  assert.equal(r.status, 200);
  return c;
}

// Plays one run of `seconds` (server time) and claims `coins`.
async function playRun(client, seconds, coins, game = 'runner') {
  const start = await client.post('/api/games/runs', { game });
  assert.equal(start.status, 201);
  clock += seconds * 1000;
  return client.post(`/api/games/runs/${start.data.runId}/finish`, { coins });
}

test('economy: per-run and daily limits', () => {
  assert.equal(economy.allowedCoinsForRun(1), 0);
  assert.equal(economy.allowedCoinsForRun(60), 60 * economy.MAX_COINS_PER_SECOND + economy.RUN_BASE_ALLOWANCE);
  // a run left open for hours still only counts as 30 minutes
  assert.equal(economy.allowedCoinsForRun(5 * 3600), economy.allowedCoinsForRun(30 * 60));

  const p = economy.normalizeProfile({ coins: 10, owned: 'gold,bogus', equipped: 'bogus' });
  assert.deepEqual(p.owned, ['gold']);
  assert.equal(p.equipped, '');

  const day = new Date('2026-10-22T10:00:00Z');
  const r1 = economy.applyRunEarnings(p, 400, 100, day, 1000);
  assert.equal(r1.earned, 400);
  const r2 = economy.applyRunEarnings(r1.profile, 900, 200, day, 1000);
  assert.equal(r2.earned, 600); // only 600 left today
  assert.equal(r2.limitedByDay, true);
  // next day the counter resets
  const r3 = economy.applyRunEarnings(r2.profile, 100, 100, new Date('2026-10-23T10:00:00Z'), 1000);
  assert.equal(r3.earned, 100);
  assert.equal(r3.profile.coins, 10 + 400 + 600 + 100);
});

test('wallet needs a login, and starts at zero', async () => {
  assert.equal((await makeClient().get('/api/games/profile')).status, 401);
  const c = await login('יאשה');
  const r = await c.get('/api/games/profile');
  assert.equal(r.status, 200);
  assert.equal(r.data.coins, 0);
  assert.equal(r.data.shop.find((i) => i.id === 'admin').price, 50000);
  assert.equal(r.data.shop.find((i) => i.id === 'gold').price, 1000);
});

test('coins from a run are saved per user; impossible claims are cut down', async () => {
  const c = await login('יאשה');
  const ok = await playRun(c, 60, 150);
  assert.equal(ok.status, 200);
  assert.equal(ok.data.earned, 150);
  assert.equal(ok.data.coins, 150);

  // 5 seconds can't be worth 99999 coins
  const cheat = await playRun(c, 5, 99999);
  assert.equal(cheat.data.earned, economy.allowedCoinsForRun(5));

  // finishing the same run twice doesn't pay twice
  const start = await c.post('/api/games/runs', { game: 'jumper' });
  clock += 30000;
  assert.equal((await c.post(`/api/games/runs/${start.data.runId}/finish`, { coins: 10 })).status, 200);
  assert.equal((await c.post(`/api/games/runs/${start.data.runId}/finish`, { coins: 10 })).status, 404);

  // a made-up run id is refused
  assert.equal((await c.post('/api/games/runs/abc/finish', { coins: 10 })).status, 404);

  // someone else's wallet is untouched
  const other = await login('לאון');
  assert.equal((await other.get('/api/games/profile')).data.coins, 0);
});

test('nobody can earn more than the daily cap', async () => {
  clock = Date.parse('2026-10-23T08:00:00Z'); // a fresh day
  const c = await login('לאון');
  let total = 0;
  for (let i = 0; i < 5; i++) {
    const r = await playRun(c, 30 * 60, 5000);
    total += r.data.earned;
  }
  assert.equal(total, 2500);
  const p = await c.get('/api/games/profile');
  assert.equal(p.data.dailyLeft, 0);
});

test('buy, equip and unequip a skin', async () => {
  const c = await login('הלל');
  assert.equal((await c.post('/api/games/shop/gold/buy')).status, 400); // no coins yet
  clock = Date.parse('2026-10-24T08:00:00Z');
  await playRun(c, 20 * 60, 1200);

  const buy = await c.post('/api/games/shop/gold/buy');
  assert.equal(buy.status, 200);
  assert.equal(buy.data.profile.coins, 200);
  assert.deepEqual(buy.data.profile.owned, ['gold']);
  assert.equal(buy.data.profile.equipped, 'gold');
  assert.equal((await c.post('/api/games/shop/gold/buy')).status, 400); // already owned

  assert.equal((await c.post('/api/games/equip', { skin: '' })).data.profile.equipped, '');
  assert.equal((await c.post('/api/games/equip', { skin: 'gold' })).data.profile.equipped, 'gold');
  assert.equal((await c.post('/api/games/equip', { skin: 'galaxy' })).status, 400); // not owned
  assert.equal((await c.post('/api/games/shop/nope/buy')).status, 404);
});

test('two purchases at the same moment cannot spend the same coins twice', async () => {
  const c = await login('הלל');
  // הלל has 200 coins left; earn exactly enough for one neon skin (2,500)
  clock = Date.parse('2026-10-25T08:00:00Z');
  await playRun(c, 30 * 60, 2300); // now 2500
  const [a, b] = await Promise.all([c.post('/api/games/shop/neon/buy'), c.post('/api/games/shop/neon/buy')]);
  assert.deepEqual([a.status, b.status].sort(), [200, 400]);
  assert.equal((await c.get('/api/games/profile')).data.coins, 0);
});

test('a librarian can buy the real admin role for 50,000 coins', async () => {
  const c = await login('יאשה');
  assert.equal((await c.get('/api/staff')).status, 200);
  // a librarian can't open admin routes yet
  assert.equal((await c.post('/api/staff', { username: 'בדיקה', role: 'librarian' })).status, 403);

  let r = await c.post('/api/games/shop/admin/buy');
  assert.equal(r.status, 400);
  assert.match(r.data.error, /אין מספיק/);

  // earn 50,000 the slow, legal way: 2,500 a day
  const startDay = Date.parse('2026-11-01T08:00:00Z');
  let coins = (await c.get('/api/games/profile')).data.coins;
  for (let day = 0; coins < 50000; day++) {
    clock = startDay + day * 24 * 3600 * 1000;
    const run = await playRun(c, 30 * 60, 2500);
    coins = run.data.coins;
  }

  r = await c.post('/api/games/shop/admin/buy');
  assert.equal(r.status, 200);
  assert.equal(r.data.roleChanged, true);
  assert.equal(r.data.profile.isAdmin, true);
  assert.equal(r.data.profile.coins, coins - 50000);

  // the new session works right away, and the role is really saved
  const me = await c.get('/api/auth/me');
  assert.equal(me.data.role, 'admin');
  assert.equal((await c.post('/api/staff', { username: 'בדיקה', role: 'librarian' })).status, 201);
  const staff = await store.findStaffByUsername('יאשה');
  assert.equal(staff.role, 'admin');

  // can't buy it twice
  assert.equal((await c.post('/api/games/shop/admin/buy')).status, 400);
});

test('an admin cannot buy the admin role', async () => {
  const c = await login('לאון');
  const r = await c.post('/api/games/shop/admin/buy');
  assert.equal(r.status, 400);
  assert.match(r.data.error, /כבר/);
});
