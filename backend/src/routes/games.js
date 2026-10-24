const crypto = require('crypto');
const { Router } = require('../http/miniHttp');
const store = require('../services/store');
const economy = require('../services/gameEconomy');
const tokens = require('../util/tokens');
const { serializeCookie } = require('../util/cookies');
const { requireAuth } = require('../middleware/auth');

// Coin wallet, game runs and the shop - one wallet per logged-in staff member.
//
// How cheating is kept in check: the browser can't simply say "I have 50,000
// coins". Coins only come in through a run: the server notes the time when a
// run starts, and when it finishes it accepts at most what is possible in the
// time that really passed (MAX_COINS_PER_SECOND). Each run pays once, and
// prices and balances live only here. So even someone who fakes requests
// can't get coins faster than an excellent player.
function createGamesRouter({ jwtSecret, sessionTtlSeconds, isProd, superAdminUsername, now = () => Date.now() }) {
  const router = new Router();

  // username -> { id, game, startedAt } (one open run per person)
  const openRuns = new Map();

  // Requests for the same person are handled one at a time, so two quick
  // purchases can't both spend the same coins.
  const locks = new Map();
  function withUserLock(username, fn) {
    const previous = locks.get(username) || Promise.resolve();
    const next = previous.catch(() => {}).then(fn);
    locks.set(username, next.catch(() => {}));
    return next;
  }

  async function loadProfile(username) {
    return economy.normalizeProfile(await store.getGameProfile(username));
  }

  async function saveProfile(username, profile) {
    await store.saveGameProfile(username, economy.serializeProfile(profile));
  }

  function isAdmin(user) {
    return Boolean(user && (user.role === 'admin' || user.username === superAdminUsername));
  }

  router.get('/profile', requireAuth, async (req, res) => {
    const profile = await loadProfile(req.user.username);
    res.json(economy.publicProfile(profile, { isAdmin: isAdmin(req.user) }));
  });

  router.post('/runs', requireAuth, async (req, res) => {
    const game = (req.body || {}).game;
    if (!economy.GAME_IDS.includes(game)) return res.status(400).json({ error: 'משחק לא מוכר' });
    const run = { id: crypto.randomBytes(12).toString('hex'), game, startedAt: now() };
    openRuns.set(req.user.username, run);
    res.status(201).json({ runId: run.id });
  });

  router.post('/runs/:id/finish', requireAuth, async (req, res) => {
    const { username } = req.user;
    const run = openRuns.get(username);
    if (!run || run.id !== req.params.id) {
      return res.status(404).json({ error: 'הריצה לא נמצאה (אולי כבר נשמרה)' });
    }
    openRuns.delete(username); // a run can be cashed in only once

    const elapsedSeconds = (now() - run.startedAt) / 1000;
    const result = await withUserLock(username, async () => {
      const profile = await loadProfile(username);
      const body = req.body || {};
      const outcome = economy.applyRunEarnings(profile, body.coins, elapsedSeconds, { game: run.game, score: body.score, won: body.won === true });
      if (outcome.earned > 0 || outcome.newBest) await saveProfile(username, outcome.profile);
      return outcome;
    });

    if (result.limitedByRun) {
      console.warn(`[games] ${username} claimed ${result.claimed} coins in a ${Math.round(elapsedSeconds)}s run - credited ${result.earned}`);
    }
    res.json({ earned: result.earned, coins: result.profile.coins, best: economy.bestOf(result.profile) });
  });

  router.post('/shop/:itemId/buy', requireAuth, async (req, res) => {
    const item = economy.findItem(req.params.itemId);
    if (!item) return res.status(404).json({ error: 'הפריט לא נמצא בחנות' });
    const { username } = req.user;

    try {
      const outcome = await withUserLock(username, async () => {
        const profile = await loadProfile(username);

        if (item.type === 'skin' && profile.owned.includes(item.id)) {
          return { status: 400, error: 'הסקין הזה כבר שלך' };
        }
        if (item.type === 'role' && isAdmin(req.user)) {
          return { status: 400, error: 'כבר יש לך הרשאת מנהל' };
        }
        if (profile.coins < item.price) {
          return { status: 400, error: `אין מספיק מטבעות (חסרים ${item.price - profile.coins})` };
        }

        let staffMember = null;
        if (item.type === 'role') {
          staffMember = await store.findStaffByUsername(username);
          if (!staffMember) return { status: 404, error: 'המשתמש לא נמצא' };
          if (staffMember.role === 'admin') return { status: 400, error: 'כבר יש לך הרשאת מנהל' };
        }

        const updated = { ...profile, owned: [...profile.owned], coins: profile.coins - item.price };
        if (item.type === 'skin') {
          updated.owned.push(item.id);
          updated.equipped = item.id; // wear it right away
        } else {
          updated.adminBoughtAt = new Date(now()).toISOString();
        }
        // Spend first, then grant: if the role change fails the coins are refunded below.
        await saveProfile(username, updated);

        if (item.type === 'role') {
          try {
            await store.updateStaffRole(staffMember.id, 'admin');
          } catch (err) {
            await saveProfile(username, profile);
            throw err;
          }
          console.log(`[games] ${username} bought the admin role for ${item.price} coins`);
        }
        return { status: 200, profile: updated };
      });

      if (outcome.error) return res.status(outcome.status).json({ error: outcome.error });

      let user = req.user;
      if (item.type === 'role') {
        // New session with the admin role, so it works immediately without logging out.
        user = { username, role: 'admin', isSuperAdmin: false };
        const token = tokens.sign(user, jwtSecret, sessionTtlSeconds);
        res.setHeader('Set-Cookie', serializeCookie('hillel_session', token, { maxAge: sessionTtlSeconds, secure: isProd }));
      }

      res.json({
        ok: true,
        item: item.id,
        roleChanged: item.type === 'role',
        profile: economy.publicProfile(outcome.profile, { isAdmin: isAdmin(user) }),
      });
    } catch (err) {
      console.error('[games] purchase failed:', err);
      res.status(500).json({ error: 'הקנייה נכשלה, נסו שוב' });
    }
  });

  // Wear a skin you own, or take it off (skin: null / '').
  router.post('/equip', requireAuth, async (req, res) => {
    const skin = (req.body || {}).skin || '';
    const { username } = req.user;
    const outcome = await withUserLock(username, async () => {
      const profile = await loadProfile(username);
      if (skin && !profile.owned.includes(skin)) return { status: 400, error: 'צריך לקנות את הסקין קודם' };
      const updated = { ...profile, equipped: skin };
      await saveProfile(username, updated);
      return { status: 200, profile: updated };
    });
    if (outcome.error) return res.status(outcome.status).json({ error: outcome.error });
    res.json({ ok: true, profile: economy.publicProfile(outcome.profile, { isAdmin: isAdmin(req.user) }) });
  });

  return router;
}

module.exports = createGamesRouter;
