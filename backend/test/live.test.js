const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const { attachLiveChannel } = require('../src/realtime/live');
const tokens = require('../src/util/tokens');

// The live channel of the island game: WebSocket handshake + auth, parties,
// invites, ready -> start, and relaying game messages inside a party.

const SECRET = 'live-test-secret';
let server;
let port;

test.before(async () => {
  server = http.createServer((req, res) => {
    res.statusCode = 404;
    res.end();
  });
  attachLiveChannel(server, { jwtSecret: SECRET, pingEveryMs: 60000 });
  await new Promise((r) => server.listen(0, r));
  port = server.address().port;
});

test.after(() => {
  server.close();
});

// a connected client that collects messages and lets a test wait for one
function connect(username, where = 'arena') {
  const cookie = `hillel_session=${encodeURIComponent(tokens.sign({ username, role: 'librarian' }, SECRET, 3600))}`;
  const ws = new WebSocket(`ws://127.0.0.1:${port}/api/live`, { headers: { cookie } });
  const inbox = [];
  const waiters = [];
  ws.addEventListener('message', (e) => {
    const msg = JSON.parse(e.data);
    inbox.push(msg);
    for (const w of [...waiters]) {
      if (w.match(msg)) {
        waiters.splice(waiters.indexOf(w), 1);
        w.resolve(msg);
      }
    }
  });
  const client = {
    ws,
    inbox,
    send: (m) => ws.send(JSON.stringify(m)),
    waitFor(match, ms = 2000) {
      const found = inbox.find(match);
      if (found) {
        inbox.splice(inbox.indexOf(found), 1);
        return Promise.resolve(found);
      }
      return new Promise((resolve, reject) => {
        const w = { match, resolve: (m) => { clearTimeout(timer); inbox.splice(inbox.indexOf(m), 1); resolve(m); } };
        const timer = setTimeout(() => reject(new Error('timed out waiting for a message')), ms);
        waiters.push(w);
      });
    },
    close: () => ws.close(),
  };
  return new Promise((resolve, reject) => {
    ws.addEventListener('open', () => {
      client.send({ type: 'hello', where, skin: 'gold' });
      resolve(client);
    });
    ws.addEventListener('error', reject);
  });
}

test('rejects connections without a valid session', async () => {
  const ws = new WebSocket(`ws://127.0.0.1:${port}/api/live`);
  const result = await new Promise((resolve) => {
    ws.addEventListener('open', () => resolve('open'));
    ws.addEventListener('error', () => resolve('error'));
  });
  assert.equal(result, 'error');
});

test('invite by name, accept, ready together -> both get the same start', async () => {
  const a = await connect('דנה');
  const b = await connect('יוסי');
  const pa = await a.waitFor((m) => m.type === 'party');
  assert.equal(pa.party.leader, 'דנה');
  assert.equal(pa.party.members.length, 1);

  // inviting someone who isn't online fails nicely
  a.send({ type: 'invite', to: 'מישהו שלא קיים' });
  const bad = await a.waitFor((m) => m.type === 'inviteResult');
  assert.equal(bad.ok, false);

  a.send({ type: 'invite', to: ' יוסי ' });
  const ok = await a.waitFor((m) => m.type === 'inviteResult');
  assert.equal(ok.ok, true);
  const inv = await b.waitFor((m) => m.type === 'invite');
  assert.equal(inv.from, 'דנה');

  b.send({ type: 'accept', partyId: inv.partyId });
  await a.waitFor((m) => m.type === 'joined' && m.username === 'יוסי');
  const both = await b.waitFor((m) => m.type === 'party' && m.party.members.length === 2);
  assert.deepEqual(both.party.members.map((m) => m.name), ['דנה', 'יוסי']);
  assert.equal(both.party.members[0].skin, 'gold');

  a.send({ type: 'ready', ready: true });
  await b.waitFor((m) => m.type === 'party' && m.party.members[0].ready);
  b.send({ type: 'ready', ready: true });
  const sa = await a.waitFor((m) => m.type === 'start');
  const sb = await b.waitFor((m) => m.type === 'start');
  assert.equal(sa.seed, sb.seed);
  assert.equal(sa.host, 'דנה');
  assert.deepEqual(sa.members, ['דנה', 'יוסי']);
  assert.equal(sa.bots, 23); // a few more bots for a team of two

  // game messages go to the other members only
  a.send({ type: 'net', data: { t: 'p', x: 1 } });
  const relayed = await b.waitFor((m) => m.type === 'net');
  assert.equal(relayed.from, 'דנה');
  assert.deepEqual(relayed.data, { t: 'p', x: 1 });
  assert.equal(a.inbox.some((m) => m.type === 'net'), false);

  // leaving: the leader role moves on
  a.send({ type: 'leave' });
  const left = await b.waitFor((m) => m.type === 'left' && m.username === 'דנה');
  assert.ok(left);
  const solo = await b.waitFor((m) => m.type === 'party' && m.party.members.length === 1);
  assert.equal(solo.party.leader, 'יוסי');
  a.close();
  b.close();
});

test('a party holds at most 4 players', async () => {
  const names = ['א1', 'א2', 'א3', 'א4', 'א5'];
  const cs = await Promise.all(names.map((n) => connect(n)));
  const leader = cs[0];
  for (let i = 1; i < 4; i++) {
    leader.send({ type: 'invite', to: names[i] });
    const r = await leader.waitFor((m) => m.type === 'inviteResult');
    assert.equal(r.ok, true);
  }
  leader.send({ type: 'invite', to: names[4] });
  const full = await leader.waitFor((m) => m.type === 'inviteResult');
  assert.equal(full.ok, false);
  cs.forEach((c) => c.close());
});
