const crypto = require('crypto');

// Parties for the team games ("קרב באי" and "הגנה על הספרייה"): invite people
// by name, wait in the lobby, press ready together, and play the same match.
// A party plays one game at a time (the leader's); the members' game screens
// are told which one, so they can switch to it.
//
// The server only keeps who is online, who is in which party, the invites
// and the ready flags. During a match it just passes messages between the
// party members (the party leader's browser runs the bots, the storm and the
// loot). Nothing here touches coins - those still go through /api/games/runs.

const MAX_PARTY = 4;
const BASE_BOTS = 19;
const EXTRA_BOTS_PER_PLAYER = 4;
const INVITE_TTL_MS = 60 * 1000;
const OFFLINE_GRACE_MS = 30 * 1000;
const MAX_MESSAGES_PER_SECOND = 80;
const SKIN_IDS = new Set(['', 'gold', 'neon', 'galaxy']);
const GAME_ROOMS = ['arena', 'defense'];
const isGameRoom = (where) => GAME_ROOMS.includes(where);

function norm(name) {
  return String(name || '').trim().toLocaleLowerCase();
}

function createPartyHub({ now = () => Date.now(), random = () => Math.random(), arenaGraceMs = 10000 } = {}) {
  // username -> { name, sockets: Set<ws>, partyId, skin, goneTimer }
  const users = new Map();
  // partyId -> { id, leader, members: [username], ready: Set, invites: Map<username, { at }>, inMatch }
  const parties = new Map();

  function newId() {
    return crypto.randomBytes(8).toString('hex');
  }

  function user(name) {
    let u = users.get(name);
    if (!u) {
      u = { name, sockets: new Set(), partyId: null, skin: '', goneTimer: null, arenaGoneTimer: null };
      users.set(name, u);
    }
    return u;
  }

  function findOnline(name) {
    const key = norm(name);
    for (const u of users.values()) {
      if (norm(u.name) === key && u.sockets.size > 0) return u;
    }
    return null;
  }

  function send(ws, msg) {
    ws.send(JSON.stringify(msg));
  }

  function sendTo(username, msg, where = null) {
    const u = users.get(username);
    if (!u) return;
    for (const ws of u.sockets) if (!where || ws.where === where) send(ws, msg);
  }

  // is this user's game screen open (a given game, or any game)?
  function inGame(username, game = null) {
    const u = users.get(username);
    return Boolean(u && [...u.sockets].some((ws) => (game ? ws.where === game : isGameRoom(ws.where))));
  }

  function partyView(p) {
    return {
      id: p.id,
      leader: p.leader,
      game: p.game,
      max: MAX_PARTY,
      members: p.members.map((name) => ({
        name,
        ready: p.ready.has(name),
        skin: (users.get(name) || {}).skin || '',
        inArena: inGame(name, p.game),
        game: gameOf(name),
      })),
      invited: [...p.invites.keys()],
    };
  }

  function broadcastParty(p) {
    const view = partyView(p);
    for (const name of p.members) sendTo(name, { type: 'party', party: view });
  }

  function cleanInvites(p) {
    const t = now();
    for (const [to, inv] of p.invites) if (t - inv.at > INVITE_TTL_MS) p.invites.delete(to);
  }

  // which game screen this user has open ('' = none)
  function gameOf(username) {
    const u = users.get(username);
    if (!u) return '';
    const ws = [...u.sockets].find((s) => isGameRoom(s.where));
    return ws ? ws.where : '';
  }

  function createSoloParty(name, game = 'arena') {
    const p = { id: newId(), leader: name, members: [name], ready: new Set(), invites: new Map(), inMatch: false, game };
    parties.set(p.id, p);
    user(name).partyId = p.id;
    return p;
  }

  function partyOf(name) {
    const u = users.get(name);
    return u && u.partyId ? parties.get(u.partyId) || null : null;
  }

  function leaveParty(name) {
    const p = partyOf(name);
    if (!p) return;
    p.members = p.members.filter((m) => m !== name);
    p.ready.delete(name);
    user(name).partyId = null;
    if (p.members.length === 0) {
      parties.delete(p.id);
      return;
    }
    if (p.leader === name) p.leader = p.members[0];
    // tell the others (and, if a match is on, that this player is gone)
    for (const m of p.members) sendTo(m, { type: 'left', username: name }, p.game);
    broadcastParty(p);
  }

  function ensureParty(name, game = 'arena') {
    return partyOf(name) || createSoloParty(name, game);
  }

  function maybeStart(p) {
    if (p.members.length === 0) return;
    const allReady = p.members.every((m) => p.ready.has(m) && inGame(m, p.game));
    if (!allReady) return;
    p.ready.clear();
    p.inMatch = true;
    const seed = Math.floor(random() * 2 ** 31);
    const msg = {
      type: 'start',
      game: p.game,
      seed,
      host: p.leader,
      members: [...p.members],
      bots: BASE_BOTS + EXTRA_BOTS_PER_PLAYER * (p.members.length - 1),
    };
    for (const m of p.members) sendTo(m, msg, p.game);
    broadcastParty(p);
  }

  function handle(ws, name, msg) {
    const u = user(name);
    switch (msg.type) {
      case 'hello': {
        ws.where = isGameRoom(msg.where) ? msg.where : 'site';
        send(ws, { type: 'welcome', username: name });
        if (isGameRoom(ws.where)) {
          // back in the game (e.g. after a short drop): the match goes on
          if (u.arenaGoneTimer) {
            clearTimeout(u.arenaGoneTimer);
            u.arenaGoneTimer = null;
          }
          // the same user opened a game somewhere else: only the newest one plays
          for (const other of [...u.sockets]) {
            if (other === ws || !isGameRoom(other.where)) continue;
            other.where = 'replaced';
            send(other, { type: 'replaced' });
            other.close(4002, 'Opened elsewhere');
          }
        }
        if (typeof msg.skin === 'string' && SKIN_IDS.has(msg.skin)) u.skin = msg.skin;
        if (isGameRoom(ws.where)) {
          const p = ensureParty(name, ws.where);
          // the leader (or someone alone) picks the game the party plays
          if (!p.inMatch && p.leader === name) p.game = ws.where;
          broadcastParty(p);
        } else {
          const p = partyOf(name);
          send(ws, { type: 'party', party: p ? partyView(p) : null });
        }
        // invites that are still waiting for this person
        for (const p of parties.values()) {
          cleanInvites(p);
          if (p.invites.has(name)) send(ws, { type: 'invite', from: p.leader, partyId: p.id, size: p.members.length, game: p.game });
        }
        return;
      }
      case 'invite': {
        const p = ensureParty(name, isGameRoom(ws.where) ? ws.where : 'arena');
        cleanInvites(p);
        const target = findOnline(msg.to);
        if (!target) return send(ws, { type: 'inviteResult', ok: false, to: msg.to, error: 'המשתמש לא מחובר כרגע (או שאין משתמש בשם הזה)' });
        if (target.name === name) return send(ws, { type: 'inviteResult', ok: false, to: msg.to, error: 'אי אפשר להזמין את עצמך' });
        if (p.members.includes(target.name)) return send(ws, { type: 'inviteResult', ok: false, to: target.name, error: 'הוא כבר בקבוצה שלך' });
        if (p.members.length + p.invites.size >= MAX_PARTY) return send(ws, { type: 'inviteResult', ok: false, to: target.name, error: `בקבוצה יכולים להיות עד ${MAX_PARTY} שחקנים` });
        p.invites.set(target.name, { at: now(), from: name });
        sendTo(target.name, { type: 'invite', from: name, partyId: p.id, size: p.members.length, game: p.game });
        send(ws, { type: 'inviteResult', ok: true, to: target.name });
        broadcastParty(p);
        return;
      }
      case 'accept': {
        const p = parties.get(msg.partyId);
        if (p) cleanInvites(p);
        if (!p || !p.invites.has(name)) return send(ws, { type: 'error', error: 'ההזמנה כבר לא בתוקף' });
        if (p.members.length >= MAX_PARTY) return send(ws, { type: 'error', error: 'הקבוצה כבר מלאה' });
        if (p.inMatch) return send(ws, { type: 'error', error: 'הקבוצה באמצע קרב - נסו שוב בעוד רגע' });
        const inviter = p.invites.get(name).from;
        p.invites.delete(name);
        if (partyOf(name) !== p) leaveParty(name);
        p.members.push(name);
        user(name).partyId = p.id;
        sendTo(inviter, { type: 'joined', username: name });
        broadcastParty(p);
        // tell the game screen that just joined which game the party plays
        send(ws, { type: 'joinedParty', game: p.game });
        return;
      }
      case 'decline': {
        const p = parties.get(msg.partyId);
        if (!p || !p.invites.has(name)) return;
        const inviter = p.invites.get(name).from;
        p.invites.delete(name);
        sendTo(inviter, { type: 'declined', username: name });
        broadcastParty(p);
        return;
      }
      case 'leave': {
        leaveParty(name);
        if (isGameRoom(ws.where)) broadcastParty(createSoloParty(name, ws.where));
        return;
      }
      case 'ready': {
        if (!isGameRoom(ws.where)) return;
        const p = ensureParty(name, ws.where);
        if (p.game !== ws.where) return send(ws, { type: 'error', error: 'הקבוצה שלך משחקת במשחק אחר - עברו אליו כדי לשחק יחד' });
        if (msg.ready) p.ready.add(name);
        else p.ready.delete(name);
        broadcastParty(p);
        maybeStart(p);
        return;
      }
      case 'matchOver': {
        const p = partyOf(name);
        if (p) p.inMatch = false;
        return;
      }
      case 'net': {
        // game messages inside a match: pass them on to the other players
        const p = partyOf(name);
        if (!p) return;
        const out = JSON.stringify({ type: 'net', from: name, data: msg.data });
        for (const m of p.members) {
          if (m === name) continue;
          if (msg.to && msg.to !== m) continue;
          const mu = users.get(m);
          if (!mu) continue;
          for (const s of mu.sockets) if (s.where === p.game) s.send(out);
        }
        return;
      }
      default:
    }
  }

  function connect(ws, username) {
    const u = user(username);
    if (u.goneTimer) {
      clearTimeout(u.goneTimer);
      u.goneTimer = null;
    }
    u.sockets.add(ws);
    ws.where = 'site';
    ws.username = username;
    let windowStart = now();
    let count = 0;
    ws.on('message', (text) => {
      // a simple flood limit
      const t = now();
      if (t - windowStart > 1000) {
        windowStart = t;
        count = 0;
      }
      if (++count > MAX_MESSAGES_PER_SECOND) return;
      let msg;
      try {
        msg = JSON.parse(text);
      } catch (err) {
        return;
      }
      if (!msg || typeof msg.type !== 'string') return;
      try {
        handle(ws, username, msg);
      } catch (err) {
        console.error('[live] message error:', err);
      }
    });
    ws.on('close', () => {
      u.sockets.delete(ws);
      const p = partyOf(username);
      if (isGameRoom(ws.where) && p) {
        p.ready.delete(username);
        if (!inGame(username)) {
          // left the game screen. A short drop of the connection shouldn't end
          // the match for everyone, so wait a little before telling the others.
          if (u.arenaGoneTimer) clearTimeout(u.arenaGoneTimer);
          u.arenaGoneTimer = setTimeout(() => {
            u.arenaGoneTimer = null;
            if (inGame(username)) return;
            const party = partyOf(username);
            if (!party) return;
            for (const m of party.members) if (m !== username) sendTo(m, { type: 'left', username, game: true }, party.game);
            if (party.leader === username) party.inMatch = false;
          }, arenaGraceMs);
          if (u.arenaGoneTimer.unref) u.arenaGoneTimer.unref();
        }
        broadcastParty(p);
      }
      if (u.sockets.size === 0) {
        // gone from the site: leave the party if they don't come back soon
        u.goneTimer = setTimeout(() => {
          u.goneTimer = null;
          if (u.sockets.size === 0) leaveParty(username);
        }, OFFLINE_GRACE_MS);
        if (u.goneTimer.unref) u.goneTimer.unref();
      }
    });
  }

  return {
    connect,
    // for tests
    _state: { users, parties },
  };
}

module.exports = { createPartyHub, MAX_PARTY, BASE_BOTS, EXTRA_BOTS_PER_PLAYER, GAME_ROOMS };
