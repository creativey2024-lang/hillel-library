// Rules for the games' coin wallet and shop. Kept free of I/O so they are easy
// to test. Everything here runs on the server - the browser is never trusted
// with a coin balance, a price, or how many coins a run was worth.

const SHOP_ITEMS = [
  {
    id: 'gold',
    type: 'skin',
    name: 'זהב',
    price: 1000,
    effects: ['גוף זהב מבריק', 'ניצוצות'],
  },
  {
    id: 'neon',
    type: 'skin',
    name: 'ניאון',
    price: 2500,
    effects: ['גוף זוהר', 'קו מתאר ניאון', 'שובל אור', 'טבעת אור בקפיצה'],
  },
  {
    id: 'galaxy',
    type: 'skin',
    name: 'גלקסיה',
    price: 5000,
    effects: ['צבעים שמתחלפים', 'שובל כוכבים', 'הילה מסתובבת', 'פיצוץ כוכבים בנחיתה'],
  },
  {
    id: 'admin',
    type: 'role',
    name: 'הרשאת מנהל',
    price: 50000,
    effects: ['הופך אותך למנהל (אדמין) במערכת הספרייה'],
  },
];

const GAME_IDS = ['runner', 'jumper', 'arena'];

// Anti-cheat limit: a run's coins are only accepted if they are possible in
// the time the SERVER measured between "run started" and "run finished".
const MAX_COINS_PER_SECOND = 8;   // well above what a great player collects (~3-5/s)
const RUN_BASE_ALLOWANCE = 10;    // a few coins of slack for short runs
const MIN_RUN_SECONDS = 2;
const MAX_RUN_SECONDS = 30 * 60;  // a run left open longer than this counts as 30 minutes

// Best scores are kept per user (not per computer). A score is only believed
// up to what's possible in the run's real length: runner/jumper score is
// distance (at most ~25 units/s) + 10 per coin (at most 8 coins/s).
const MAX_SCORE_PER_SECOND = 110;
const SCORE_BASE_ALLOWANCE = 50;
// an island-battle win counts only if the match lasted at least this long
const MIN_WIN_SECONDS = 60;

function findItem(id) {
  return SHOP_ITEMS.find((item) => item.id === id) || null;
}

function isSkinId(id) {
  const item = findItem(id);
  return Boolean(item && item.type === 'skin');
}

function toInt(value) {
  const n = Math.floor(Number(value));
  return Number.isFinite(n) && n > 0 ? n : 0;
}

// Profiles are stored as flat scalar fields (Firestore REST here only handles
// scalars), so the list of owned skins is a comma-separated string.
function normalizeProfile(raw) {
  const r = raw || {};
  const ownedList = Array.isArray(r.owned)
    ? r.owned
    : String(r.owned || '').split(',').map((s) => s.trim()).filter(Boolean);
  const owned = [...new Set(ownedList.filter(isSkinId))];
  const equipped = owned.includes(r.equipped) ? r.equipped : '';
  return {
    coins: toInt(r.coins),
    owned,
    equipped,
    totalEarned: toInt(r.totalEarned),
    adminBoughtAt: typeof r.adminBoughtAt === 'string' ? r.adminBoughtAt : '',
    bestRunner: toInt(r.bestRunner),
    bestJumper: toInt(r.bestJumper),
    arenaWins: toInt(r.arenaWins),
  };
}

function serializeProfile(profile) {
  return {
    coins: profile.coins,
    owned: profile.owned.join(','),
    equipped: profile.equipped || '',
    totalEarned: profile.totalEarned,
    adminBoughtAt: profile.adminBoughtAt || '',
    bestRunner: profile.bestRunner || 0,
    bestJumper: profile.bestJumper || 0,
    arenaWins: profile.arenaWins || 0,
    updatedAt: new Date().toISOString(),
  };
}

function allowedCoinsForRun(elapsedSeconds) {
  if (elapsedSeconds < MIN_RUN_SECONDS) return 0;
  const seconds = Math.min(elapsedSeconds, MAX_RUN_SECONDS);
  return Math.floor(seconds * MAX_COINS_PER_SECOND) + RUN_BASE_ALLOWANCE;
}

function allowedScoreForRun(elapsedSeconds) {
  if (elapsedSeconds < MIN_RUN_SECONDS) return 0;
  const seconds = Math.min(elapsedSeconds, MAX_RUN_SECONDS);
  return Math.floor(seconds * MAX_SCORE_PER_SECOND) + SCORE_BASE_ALLOWANCE;
}

// Works out how many of the claimed coins are credited (and the new best
// score), and returns the updated profile. Never trusts the claim beyond
// what the run's real length allows.
function applyRunEarnings(profile, claimedCoins, elapsedSeconds, { game, score, won } = {}) {
  const p = { ...profile, owned: [...profile.owned] };
  const claimed = toInt(claimedCoins);
  const earned = Math.min(claimed, allowedCoinsForRun(elapsedSeconds));
  p.coins += earned;
  p.totalEarned += earned;
  let newBest = false;
  if (game === 'runner' || game === 'jumper') {
    const s = Math.min(toInt(score), allowedScoreForRun(elapsedSeconds));
    const field = game === 'runner' ? 'bestRunner' : 'bestJumper';
    if (s > (p[field] || 0)) {
      p[field] = s;
      newBest = true;
    }
  } else if (game === 'arena' && won === true && elapsedSeconds >= MIN_WIN_SECONDS) {
    p.arenaWins = (p.arenaWins || 0) + 1;
    newBest = true;
  }
  return { profile: p, earned, claimed, limitedByRun: earned < claimed, newBest };
}

function bestOf(profile) {
  return { runner: profile.bestRunner || 0, jumper: profile.bestJumper || 0, arena: profile.arenaWins || 0 };
}

function publicProfile(profile, { isAdmin } = {}) {
  return {
    coins: profile.coins,
    owned: profile.owned,
    equipped: profile.equipped,
    best: bestOf(profile),
    isAdmin: Boolean(isAdmin),
    shop: SHOP_ITEMS.map((item) => ({
      ...item,
      owned: item.type === 'skin' ? profile.owned.includes(item.id) : Boolean(isAdmin),
    })),
  };
}

module.exports = {
  SHOP_ITEMS,
  GAME_IDS,
  MAX_COINS_PER_SECOND,
  RUN_BASE_ALLOWANCE,
  MIN_RUN_SECONDS,
  MAX_RUN_SECONDS,
  findItem,
  isSkinId,
  normalizeProfile,
  serializeProfile,
  allowedCoinsForRun,
  allowedScoreForRun,
  applyRunEarnings,
  bestOf,
  MAX_SCORE_PER_SECOND,
  MIN_WIN_SECONDS,
  publicProfile,
};
