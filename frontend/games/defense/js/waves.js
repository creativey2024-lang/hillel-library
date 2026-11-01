/**
 * The waves: what comes out of the portals, how many, how tough, and how
 * fast. More players = more (and tougher) monsters. Every 5th wave a Titan.
 * Run by the party leader's computer.
 */
export const BREAK_SECONDS = 18;
export const FIRST_BREAK = 10;

// [kind, weight, first wave it can appear in]
const TABLE = [
    ['slime', 30, 1],
    ['book', 24, 1],
    ['goblin', 22, 2],
    ['bat', 10, 3],
    ['archer', 14, 4],
    ['golem', 6, 6],
    ['wizard', 6, 8],
];

export function hpScale(wave, players) {
    const w = wave - 1;
    return (1 + 0.13 * w + 0.006 * w * w) * (1 + 0.38 * (players - 1));
}

/** The list of monsters for a wave, in the order they come out. */
export function planWave(wave, players, rand = Math.random) {
    const boss = wave % 5 === 0;
    let count = Math.round((7 + wave * 3.2 + Math.pow(wave, 1.35)) * (1 + 0.45 * (players - 1)));
    if (boss) count = Math.round(count * 0.6);
    const allowed = TABLE.filter((t) => wave >= t[2]);
    const total = allowed.reduce((s, t) => s + t[1], 0);
    const eliteChance = wave >= 6 ? Math.min(0.2, 0.03 * (wave - 5)) : 0;
    const list = [];
    for (let i = 0; i < count; i++) {
        let x = rand() * total;
        let kind = allowed[0][0];
        for (const t of allowed) {
            x -= t[1];
            if (x < 0) {
                kind = t[0];
                break;
            }
        }
        if (kind === 'bat') {
            // bats come in a little flock
            for (let k = 0; k < 4; k++) list.push({ kind, elite: false, flock: k > 0 });
            i += 2;
            continue;
        }
        list.push({ kind, elite: rand() < eliteChance && kind !== 'golem' });
    }
    if (boss) {
        // the Titan comes out a little after the wave starts
        const at = Math.min(list.length, 6);
        for (let k = 0; k < Math.max(1, Math.floor(wave / 10) + (players > 2 ? 1 : 0)); k++) list.splice(at + k * 4, 0, { kind: 'titan', elite: false, boss: true });
    }
    return list;
}

/** Seconds between two monsters coming out. */
export function spawnGap(wave, players) {
    return Math.max(0.35, (1.5 - wave * 0.07) / (1 + 0.3 * (players - 1)));
}

export function maxAlive(players) {
    return 34 + players * 6;
}
