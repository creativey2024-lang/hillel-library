/**
 * הגנה על הספרייה (Library Defense) - a co-op wave defense game for the
 * Hillel library site: up to 4 friends defend the Golden Book in the middle
 * of a huge magical library from waves of monsters coming out of four
 * portals. Every 10 monsters you kill upgrade your gun (and every 30 give a
 * new one), * (weapons, ammo, healing, a stronger book), climb the book stacks to shoot
 * from the top of the shelves, revive your friends, and survive as many
 * waves as you can. Every 5th wave the Ink Titan comes.
 *
 * Reuses the island game's characters, guns, movement, effects, sounds and
 * party system (../arena/js). In a team, the party leader's computer runs the
 * monsters and the waves and tells everyone else where they are.
 */
import * as THREE from 'three';
import { GLTFLoader } from '../../shared/lib/loaders/GLTFLoader.js';
import { skinFromUrl, applySkin } from '../../shared/skins.js';
import * as bridgeLib from '../../shared/bridge.js';
import { WEAPONS, RARITIES, AMMO, makeWeapon, reloadTime, spreadMul, weaponDamage, magSize, fireRate, weaponMesh } from '../../arena/js/weapons.js';
import { createActor, refreshWeaponVisual, updateActorVisual, currentWeapon, applyDamage, playAction } from '../../arena/js/actors.js';
import { createEffects, muzzlePosition } from '../../arena/js/combat.js';
import { moveActor } from '../../arena/js/movement.js';
import { createAudio } from '../../arena/js/audio.js';
import { createNet } from '../../arena/js/net.js';
import { itemIcon } from '../../arena/js/icons.js';
import { createLibrary, HALF, PLAYER_SPAWNS, BOOK_POS } from './library.js';
import { fillIcons, iconSVG } from '../../shared/icons.js';
import { KINDS, KIND_LIST, createMonster, createMonsterSim, updateMonsterVisual, updateDying, disposeMonster, rayHitsMonster, monsterCenter, setMonsterShadows } from './monsters.js';
import { planWave, hpScale, spawnGap, maxAlive, BREAK_SECONDS, FIRST_BREAK } from './waves.js';
import { createFx } from './fx.js';
import { createStage } from './stage.js';
import { glowTexture } from './paint.js';

window.__gameBooted = true; // (all the game's files loaded - see index.html)
const createBridge = bridgeLib.createBridge;
const bestFromUrl = bridgeLib.bestFromUrl || (() => null);

// ------------------------------------------------------------------ settings
const BOOK_HP = 2000;
const MAX_AMMO = { light: 240, medium: 300, shells: 60, heavy: 20, rockets: 12, energy: 160 };
const GRENADE_MAX = 4;
const RESPAWN_SOLO = 8;
const RESPAWN_TEAM = 14;
const REVIVE_TIME = 1.6;
const WAVE_COINS = (w) => 4 + w * 2;
// upgrades: every KILLS_PER_UPGRADE kills the gun in your hands gets better;
// every 3rd upgrade is a new weapon instead (from this list, in order)
const KILLS_PER_UPGRADE = 10;
const NEW_WEAPONS = [['shotgun', 2], ['rocket', 2], ['freeze', 3], ['lightning', 3], ['minigun', 3], ['heavy', 3], ['rocket', 4], ['lightning', 4]];

const $ = (id) => document.getElementById(id);
const touchMode = window.matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;
const params = new URLSearchParams(window.location.search);
const lowGfx = params.has('lowgfx');

// ------------------------------------------------------------------ renderer and scene
const renderer = new THREE.WebGLRenderer({ antialias: !lowGfx, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, lowGfx ? 1 : 1.75));
renderer.shadowMap.enabled = !lowGfx;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.15;
$('world').appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.fog = new THREE.FogExp2(0x1a1236, 0.0135);
const camera = new THREE.PerspectiveCamera(70, 1, 0.1, 900);

// moonlight from above, warm candle light around, gold from the book, purple from the portals
scene.add(new THREE.HemisphereLight(0x8f9cff, 0x3b2412, 1.25));
scene.add(new THREE.AmbientLight(0xffd9a8, 0.35));
const moon = new THREE.DirectionalLight(0xc7d4ff, 1.5);
moon.position.set(-40, 80, -30);
moon.castShadow = true;
moon.shadow.mapSize.set(2048, 2048);
moon.shadow.camera.left = -45;
moon.shadow.camera.right = 45;
moon.shadow.camera.top = 45;
moon.shadow.camera.bottom = -45;
moon.shadow.camera.near = 10;
moon.shadow.camera.far = 200;
moon.shadow.bias = -0.0004;
moon.shadow.normalBias = 0.04;
scene.add(moon);
scene.add(moon.target);
const bookLight = new THREE.PointLight(0xffc14d, 40, 30, 1.6);
bookLight.position.set(0, 4, 0);
scene.add(bookLight);
const portalLights = [[0, 58], [58, 0], [0, -58], [-58, 0]].map(([x, z]) => {
    const l = new THREE.PointLight(0xc026d3, 25, 26, 1.6);
    l.position.set(x, 5, z);
    scene.add(l);
    return l;
});
// warm lights along the avenues
for (const [x, z] of [[0, 30], [30, 0], [0, -30], [-30, 0]]) {
    const l = new THREE.PointLight(0xffb867, 18, 24, 1.8);
    l.position.set(x, 7, z);
    scene.add(l);
}

function resize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    renderer.setSize(w, h);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    if (stage) stage.resize(w, h);
}
window.addEventListener('resize', resize);

// ------------------------------------------------------------------ state
const state = {
    mode: 'loading', // loading | ready | playing | over
    time: 0,
    wave: 0,
    phase: 'break', // break | fight
    breakT: FIRST_BREAK,
    bookHp: BOOK_HP,
    bookMax: BOOK_HP,
    queue: [],
    spawnT: 0,
    left: 0,
    upKills: 0,
    upgrades: 0,
    coins: 0,
    kills: 0,
    earn: { kills: 0, waves: 0, boss: 0 },
    downT: 0,
    reviveT: 0,
    spin: 0,
    over: false,
    softPause: false,
};
const net = createNet({ where: 'defense' });
const team = {
    on: false, host: true, me: 'me', hostName: 'me', members: [],
    remotes: new Map(), sendT: 0, snapT: 0,
    ev: { dead: [], pj: [], fx: [] },
    myFx: [], myShots: [],
};

let lib = null;
let stage = null;
let characterGltf = null;
let player = null;
let sim = null;
const clientMonsters = new Map(); // id -> monster (on a teammate's computer)
const dying = [];
const drops = [];
const rockets = [];   // mine: { pos, vel, life, orb, remote }
const nades = [];
const shots = [];     // monster shots drawn here: { pos, vel, life, orb, lob, color }
const effects = createEffects(scene);
const fx = createFx(scene, camera);
const audio = createAudio({ base: '../arena/sounds/' });
let moveWorld = null;

const bridge = createBridge('defense', {
    getRunCoins: () => state.coins,
    onSaved: (info) => {
        const note = $('savedNote');
        note.classList.remove('hidden', 'warn');
        if (info.error) {
            note.textContent = 'לא הצלחנו לשמור את המטבעות הפעם';
            note.classList.add('warn');
        } else {
            note.textContent = info.earned > 0
                ? `נשמרו ${info.earned.toLocaleString()} מטבעות בחשבון · יש לך ${info.coins.toLocaleString()}`
                : `לא נאספו מטבעות הפעם · יש לך ${info.coins.toLocaleString()}`;
            if (info.newBest) note.textContent += ' · שיא חדש!';
        }
    },
});

const monstersNow = () => (team.on && !team.host ? [...clientMonsters.values()] : sim ? sim.monsters : []);

// ------------------------------------------------------------------ loading
async function load() {
    const loader = new GLTFLoader();
    $('loadingText').textContent = 'פותח את הספרייה... 20%';
    characterGltf = await loader.loadAsync('../jumper/models/character.glb');
    $('loadingText').textContent = 'מסדר את המדפים... 50%';
    await new Promise((r) => setTimeout(r, 30));
    lib = createLibrary(scene, { quality: lowGfx ? 0.3 : 1 });
    moveWorld = { ...lib, terrainHeight: () => 1 };
    $('loadingText').textContent = 'מדליק את הנרות... 85%';
    await new Promise((r) => setTimeout(r, 30));
    stage = createStage({ scene, camera, gltf: characterGltf, labels: $('lobbyLabels') });
    // warm up the monster models once (so the first wave doesn't stutter)
    for (const k of KIND_LIST) {
        const m = createMonster(scene, k, { x: 0, z: -500 });
        disposeMonster(scene, m);
    }
}

// ------------------------------------------------------------------ players
function newPlayer(name, opts = {}) {
    const a = createActor({ scene, gltf: characterGltf, name, isPlayer: opts.isPlayer, human: true, team: 'library', gearSeed: opts.gearSeed ?? name });
    a.phase = 'ground';
    a.onGround = true;
    a.glider.visible = false;
    a.ammo = { light: 180, medium: 270, shells: 24, heavy: 8, rockets: 0, energy: 0 };
    a.grenades = 2;
    a.down = false;
    return a;
}

function giveStarterKit(a) {
    a.slots = [makeWeapon('ar', 1), makeWeapon('pistol', 1), null, null, null];
    a.current = 0;
    refreshWeaponVisual(a);
}

function spawnAt(a, i) {
    const [x, z] = PLAYER_SPAWNS[i % PLAYER_SPAWNS.length];
    a.pos.set(x, lib.supportHeight(x, z, 5), z);
    a.vel.set(0, 0, 0);
    a.yaw = 0; // facing out, toward the north portal
}

function itemKey(it) {
    return it ? `${it.kind}:${it.rarity}` : '';
}
function itemFromKey(k) {
    if (!k) return null;
    const [kind, r] = k.split(':');
    return WEAPONS[kind] ? { kind, rarity: Number(r) || 0, ammoInMag: 1 } : null;
}

// ------------------------------------------------------------------ match start / end
function startMatch(cfg) {
    if (state.mode !== 'ready') return;
    team.on = cfg.members.length > 1;
    team.host = !team.on || cfg.host === cfg.me;
    team.me = cfg.me;
    team.hostName = cfg.host;
    team.members = cfg.members;
    stage.hide();

    player = newPlayer('את/ה', { isPlayer: true, gearSeed: team.on ? cfg.me : 'me' });
    giveStarterKit(player);
    if (player.skin === undefined) player.skin = applySkin({ model: player.model, scene, skinId: skinFromUrl(), height: 1.76 });
    const myIndex = Math.max(0, cfg.members.indexOf(cfg.me));
    spawnAt(player, myIndex);
    cfg.members.forEach((name, i) => {
        if (name === cfg.me) return;
        const r = newPlayer(name, { isPlayer: false });
        r.netName = name;
        const sk = net.party && net.party.members.find((m) => m.name === name);
        r.skin = applySkin({ model: r.model, scene, skinId: sk ? sk.skin : '', height: 1.76 });
        giveStarterKit(r);
        spawnAt(r, i);
        r.net = { x: r.pos.x, y: r.pos.y, z: r.pos.z, vx: 0, vy: 0, vz: 0, yaw: 0, pitch: 0, at: 0 };
        r.netSeen = true;
        r.healthBarT = 1e9;
        team.remotes.set(name, r);
    });

    sim = createMonsterSim({
        scene,
        lib,
        players: simPlayers,
        wave: () => state.wave,
        hpScale: () => hpScale(state.wave, playerCount()),
        hooks: simHooks,
    });

    $('lobby').classList.add('hidden');
    $('hud').classList.remove('hidden');
    $('muteBtn').classList.remove('hidden');
    $('credits').classList.add('hidden');
    soundIcons();
    state.mode = 'playing';
    state.time = 0;
    yaw = 0;
    pitch = -0.12;
    player.yaw = yaw;
    requestLock();
    bridge.runStarted();
    banner('הגנו על ספר הזהב!', team.on ? `${cfg.members.length} מגינים · המפלצות מגיעות בעוד ${FIRST_BREAK} שניות` : `המפלצות מגיעות בעוד ${FIRST_BREAK} שניות · כל ${KILLS_PER_UPGRADE} חיסולים הנשק משתדרג`);
    clock.getDelta();
}

const playerCount = () => 1 + team.remotes.size;

// the players the monsters can see (on the leader's computer)
function simPlayers() {
    const list = [];
    if (player) list.push({ name: team.me, pos: player.pos, vel: player.vel, alive: player.alive && !player.down, isMe: true });
    for (const [name, r] of team.remotes) list.push({ name, pos: r.pos, vel: r.vel, alive: !r.down && !r.gone, isMe: false });
    return list;
}

function endMatch(reason = 'book') {
    if (state.mode === 'over') return;
    state.mode = 'over';
    if (team.on) {
        if (team.host) net.relay({ t: 'over', w: state.wave });
        net.send({ type: 'matchOver' });
    }
    if (document.pointerLockElement) document.exitPointerLock();
    $('pauseScreen').classList.add('hidden');
    $('downScreen').classList.add('hidden');
    const reached = Math.max(1, state.wave);
    $('endTitle').textContent = reason === 'hostLeft' ? 'ההגנה הסתיימה' : 'ספר הזהב נפל!';
    $('endPlace').innerHTML = `גל ${reached}<small>${team.on ? 'הקבוצה החזיקה מעמד עד' : 'החזקת מעמד עד'} גל ${reached}</small>`;
    $('endKills').textContent = state.kills;
    $('endCoins').textContent = state.coins;
    const m = Math.floor(state.time / 60);
    $('endTime').textContent = `${m}:${Math.floor(state.time % 60).toString().padStart(2, '0')}`;
    const e = state.earn;
    const chips = [
        ['skull', e.kills, `על ${state.kills} מפלצות`],
        ['book', e.waves, 'על הגלים ששרדתם'],
        ['trophy', e.boss, 'על טיטאנים'],
    ].filter(([, v]) => v > 0);
    $('endBreakdown').innerHTML = chips.length ? `<p class="breakdown-title">מאיפה הגיעו המטבעות</p>${chips.map(([i, v, t]) => `<span class="chip">${iconSVG(i, 16)} <b>+${v}</b> ${t}</span>`).join('')}` : '';
    const note = $('savedNote');
    note.classList.toggle('hidden', !bridge.embedded);
    note.classList.remove('warn');
    note.textContent = 'שומר את המטבעות בחשבון...';
    bridge.runEnded(state.coins, { score: reached });
    audio.boom({ volume: 1, low: 200, length: 1.2 });
    fx.explosion(new THREE.Vector3(0, 3, 0), 7, 0xffc14d);
    setTimeout(() => $('endScreen').classList.remove('hidden'), 1600);
}

// ------------------------------------------------------------------ the waves (leader)
function startWave() {
    state.wave += 1;
    state.phase = 'fight';
    state.queue = planWave(state.wave, playerCount());
    state.spawnT = 1;
    const boss = state.wave % 5 === 0;
    banner(`גל ${state.wave}`, boss ? '⚠ טיטאן הדיו מתקרב!' : `${state.queue.length} מפלצות פורצות מהשערים`, boss ? 'boss' : '');
    audio.tone(110, { length: 1.2, type: 'sawtooth', volume: 0.12, slide: 0.5 });
}

function activePortals() {
    return state.wave <= 2 ? [0, 1] : [0, 1, 2, 3];
}

function directorTick(dt) {
    if (state.phase === 'break') {
        state.breakT -= dt;
        if (state.breakT <= 0) startWave();
        return;
    }
    const alive = sim.monsters.filter((m) => m.alive).length;
    state.spawnT -= dt;
    if (state.queue.length && state.spawnT <= 0 && alive < maxAlive(playerCount())) {
        const next = state.queue.shift();
        const portals = activePortals();
        const portal = portals[Math.floor(Math.random() * portals.length)];
        sim.spawn(next.kind, { elite: next.elite, portal: next.flock && team.lastPortal !== undefined ? team.lastPortal : portal, hpScale: hpScale(state.wave, playerCount()) });
        team.lastPortal = portal;
        state.spawnT = next.flock ? 0.15 : spawnGap(state.wave, playerCount()) * (0.7 + Math.random() * 0.6);
        if (next.boss) {
            banner('טיטאן הדיו!', 'כוונו לגביש הזוהר בחזה', 'boss');
            audio.boom({ volume: 1, low: 120, length: 1.4 });
        }
    }
    state.left = state.queue.length + alive;
    if (!state.queue.length && alive === 0) waveCleared();
}

function waveCleared() {
    state.phase = 'break';
    state.breakT = BREAK_SECONDS;
    // the book heals a little between waves
    state.bookHp = Math.min(state.bookMax, state.bookHp + state.bookMax * 0.12);
    onWaveCleared(state.wave);
}

// everyone (the leader and the others) gets the wave reward on their own computer
// (no shops: after every wave you get ammo, a grenade and your health back)
function onWaveCleared(w) {
    const coins = WAVE_COINS(w);
    state.coins += coins;
    state.earn.waves += coins;
    if (player) {
        for (const k of Object.keys(MAX_AMMO)) player.ammo[k] = Math.min(MAX_AMMO[k], player.ammo[k] + Math.ceil(MAX_AMMO[k] * 0.5));
        player.grenades = Math.min(GRENADE_MAX, player.grenades + 1);
        if (!player.down) {
            player.hp = 100;
            player.shield = Math.min(100, player.shield + 50);
        }
    }
    banner(`גל ${w} הושלם!`, `+${coins} מטבעות · תחמושת מולאה · +1 רימון · חיים מלאים · הגל הבא בעוד ${BREAK_SECONDS} שניות (B - עכשיו)`, 'good');
    audio.chime();
}

// ------------------------------------------------------------------ upgrades (every 10 kills)
const RARITY_NAMES = () => RARITIES.map((r) => r.name);
// what the next upgrade will be (shown on the screen)
function nextReward() {
    if ((state.upgrades + 1) % 3 === 0) {
        const [kind, r] = NEW_WEAPONS[Math.floor(state.upgrades / 3) % NEW_WEAPONS.length];
        return { type: 'new', text: `נשק חדש: ${WEAPONS[kind].name} ${RARITIES[r].name}` };
    }
    const w = upgradeTarget();
    if (!w) return { type: 'none', text: 'כל הנשקים אגדיים!' };
    return { type: 'up', w, text: `${WEAPONS[w.kind].name}: ${RARITIES[w.rarity].name} ← ${RARITIES[w.rarity + 1].name}` };
}
// the gun in your hands, or (if it's already legendary) your weakest gun
function upgradeTarget() {
    const cur = currentWeapon(player);
    if (cur && cur.rarity < 4) return cur;
    let best = null;
    for (const s of player.slots) if (s && s.rarity < 4 && (!best || s.rarity < best.rarity)) best = s;
    return best;
}
function doUpgrade() {
    state.upKills -= KILLS_PER_UPGRADE;
    const next = nextReward();
    state.upgrades += 1;
    if (next.type === 'new') {
        const [kind, r] = NEW_WEAPONS[Math.floor((state.upgrades - 1) / 3) % NEW_WEAPONS.length];
        const w = makeWeapon(kind, r);
        // into an empty slot, or instead of your weakest gun
        let slot = player.slots.findIndex((x) => !x);
        if (slot < 0) {
            slot = 0;
            player.slots.forEach((x, i) => { if (x.rarity < player.slots[slot].rarity) slot = i; });
        }
        player.slots[slot] = w;
        const def = WEAPONS[kind];
        player.ammo[def.ammo] = Math.min(MAX_AMMO[def.ammo], Math.max(player.ammo[def.ammo], AMMO[def.ammo].box * 4));
        selectSlot(slot, true);
        banner('נשק חדש!', `${def.name} ${RARITIES[r].name} - על ${state.upgrades * KILLS_PER_UPGRADE} חיסולים`, 'good');
    } else if (next.type === 'up') {
        const w = next.w;
        w.rarity += 1;
        w.ammoInMag = magSize(w);
        refreshWeaponVisual(player);
        const r = RARITIES[w.rarity];
        banner('הנשק שודרג!', `${WEAPONS[w.kind].name}: ${RARITIES[w.rarity - 1].name} ← ${r.name} · נזק ${Math.round(weaponDamage(w) * WEAPONS[w.kind].pellets)}`, 'good');
    } else {
        // nothing left to upgrade: a full heal instead
        player.hp = 100;
        player.shield = 100;
        banner('בונוס!', 'כל הנשקים אגדיים - חיים ומגן מלאים', 'good');
    }
    audio.chime();
    fx.sparkle(player.pos.clone().setY(player.pos.y + 1.4), 0xfacc15);
    fx.poof(player.pos.clone().setY(player.pos.y + 1), 0xfacc15, 2);
}

// ------------------------------------------------------------------ simulation hooks (leader)
const simHooks = {
    hitPlayer(name, dmg, kbx, kbz) {
        if (name === team.me) damagePlayer(dmg, kbx, kbz);
        else if (team.on) net.relay({ t: 'dmg', d: Math.round(dmg * 10) / 10, kb: [Math.round(kbx * 10) / 10, Math.round(kbz * 10) / 10] }, name);
    },
    hitBook(dmg) {
        if (state.mode !== 'playing') return;
        state.bookHp -= dmg;
        lib.book.hit = 1;
        state.bookAlertT = 2.5;
        if (state.bookHp <= 0) {
            state.bookHp = 0;
            endMatch('book');
        }
    },
    shot(p) {
        p.orb = fx.orb(p.color, p.big ? 1.6 : 0.7);
        p.orb.position.copy(p.pos);
        if (team.on) team.ev.pj.push([r2(p.pos.x), r2(p.pos.y), r2(p.pos.z), r2(p.vel.x), r2(p.vel.y), r2(p.vel.z), p.color, p.lob ? 1 : 0, p.big ? 1 : 0]);
        audio.tone(p.big ? 160 : 520, { length: 0.25, type: 'triangle', volume: 0.06, slide: 0.6 });
    },
    projectileDone(p) {
        if (p.orb) fx.removeObj(p.orb);
        fx.splat(p.pos, p.color, p.big ? 18 : 6);
    },
    died(m, killer) {
        onMonsterDied(m, killer);
        if (team.on) team.ev.dead.push([m.id, killer || '']);
    },
    spawned(m) {
        fx.poof(new THREE.Vector3(m.pos.x, 1.2, m.pos.z), 0xd946ef, m.def.boss ? 6 : 2);
    },
    slam(m) {
        fx.shockwave(m.pos, m.def.slam);
        audio.boom({ volume: 0.7 * listenerVolume(m.pos), low: 160, length: 0.6 });
        if (team.on) team.ev.fx.push(['slam', r2(m.pos.x), r2(m.pos.z), m.def.slam]);
    },
    summoned(m) {
        fx.poof(new THREE.Vector3(m.pos.x, 2, m.pos.z), 0xa855f7, 3);
        if (team.on) team.ev.fx.push(['poof', r2(m.pos.x), r2(m.pos.z)]);
    },
    teleported(m, from, to) {
        fx.poof(new THREE.Vector3(from.x, 1.2, from.z), 0xa855f7, 2);
        fx.poof(new THREE.Vector3(to.x, 1.2, to.z), 0xa855f7, 2);
        if (team.on) team.ev.fx.push(['poof', r2(from.x), r2(from.z)], ['poof', r2(to.x), r2(to.z)]);
    },
};

// a monster died (here: by the leader's simulation, or told by the leader)
function onMonsterDied(m, killer) {
    m.alive = false;
    m.dieT = 0;
    dying.push(m);
    const c = monsterCenter(m, new THREE.Vector3());
    fx.splat(c, m.kind === 'golem' ? 0x78716c : m.kind === 'archer' ? 0xe7e2d3 : 0x6366f1, m.def.boss ? 40 : 12);
    if (m.def.boss) fx.explosion(c, 6, 0xe879f9);
    audio.play('eliminate', { volume: 0.35 * listenerVolume(m.pos), rate: m.def.heavy ? 0.6 : 1.2 });
    const mine = killer === team.me;
    if (mine) {
        state.kills += 1;
        // elites and bosses count for more on the way to the next upgrade
        state.upKills += m.def.boss ? 10 : m.elite ? 3 : 1;
        while (state.upKills >= KILLS_PER_UPGRADE && player) doUpgrade();
        const coins = (m.def.coins || 0) * (m.elite ? 2 : 1);
        state.coins += coins;
        if (m.def.boss) state.earn.boss += coins;
        else state.earn.kills += coins;
        if (coins) fx.number(c, coins, 'coin');
        feed(`${m.elite ? 'מוזהב ' : ''}${m.def.name}`, coins);
        flashHitmarker('kill');
    }
    spawnDrops(m, c);
}

function listenerVolume(pos) {
    return player ? Math.max(0, 1 - player.pos.distanceTo(pos) / 70) : 0.5;
}

// ------------------------------------------------------------------ team messages
const r2 = (v) => Math.round(v * 100) / 100;
function actorState(a) {
    const flags = (a.aiming ? 1 : 0) | (a.moving ? 2 : 0) | (a.down ? 4 : 0) | (a.onGround ? 8 : 0) | (a.reloadT > 0 ? 16 : 0);
    return [r2(a.pos.x), r2(a.pos.y), r2(a.pos.z), r2(a.vel.x), r2(a.vel.y), r2(a.vel.z), r2(a.yaw), r2(a.pitch), itemKey(currentWeapon(a)), Math.round(a.hp), Math.round(a.shield), flags];
}

const INTERP_MS = 110;
const clockOffsets = new Map();
function localTime(from, ts) {
    const now = performance.now();
    if (!Number.isFinite(ts)) return now;
    const sample = now - ts;
    let off = clockOffsets.get(from);
    off = off === undefined || sample < off ? sample : off + (sample - off) * 0.02;
    clockOffsets.set(from, off);
    return Math.min(now, ts + off);
}
function pushState(o, at, x, y, z, vx, vy, vz, yawV, pitchV = 0) {
    const buf = o.netBuf || (o.netBuf = []);
    if (!buf.length || at > buf[buf.length - 1].t) buf.push({ t: at, x, y, z, vx, vy, vz, yaw: yawV, pitch: pitchV });
    if (buf.length > 30) buf.splice(0, buf.length - 30);
}
function angleLerp(a, b, k) {
    let d = b - a;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    return a + d * k;
}
// draw something from another computer where it was INTERP_MS ago (smoothly between updates)
function interpolate(o, dt) {
    const buf = o.netBuf;
    if (!buf || !buf.length) return;
    const rt = performance.now() - INTERP_MS;
    while (buf.length > 2 && buf[1].t <= rt) buf.shift();
    const s0 = buf[0];
    const s1 = buf[1];
    let x;
    let y;
    let z;
    let ry;
    let rp;
    if (s1 && rt >= s0.t) {
        const k = Math.min(1, (rt - s0.t) / Math.max(1, s1.t - s0.t));
        x = s0.x + (s1.x - s0.x) * k;
        y = s0.y + (s1.y - s0.y) * k;
        z = s0.z + (s1.z - s0.z) * k;
        ry = angleLerp(s0.yaw, s1.yaw, k);
        rp = s0.pitch + (s1.pitch - s0.pitch) * k;
    } else if (!s1) {
        const age = Math.max(0, Math.min(0.2, (rt - s0.t) / 1000));
        x = s0.x + s0.vx * age;
        y = s0.y + s0.vy * age;
        z = s0.z + s0.vz * age;
        ry = s0.yaw;
        rp = s0.pitch;
    } else {
        ({ x, y, z } = s0);
        ry = s0.yaw;
        rp = s0.pitch;
    }
    if (Math.abs(x - o.pos.x) + Math.abs(z - o.pos.z) > 12) o.pos.set(x, y, z);
    else {
        const k = Math.min(1, dt * 25);
        o.pos.x += (x - o.pos.x) * k;
        o.pos.y += (y - o.pos.y) * k;
        o.pos.z += (z - o.pos.z) * k;
    }
    const last = buf[buf.length - 1];
    if (o.vel) o.vel.set(last.vx, last.vy, last.vz);
    o.yaw = angleLerp(o.yaw, ry, Math.min(1, dt * 25));
    o.pitch = (o.pitch || 0) + (rp - (o.pitch || 0)) * Math.min(1, dt * 25);
}

function applyPlayerState(r, st, at) {
    pushState(r, at, st[0], st[1], st[2], st[3], st[4], st[5], st[6], st[7]);
    if (st[8] !== r.netItem) {
        r.netItem = st[8];
        r.slots = [itemFromKey(st[8]), null, null, null, null];
        r.current = 0;
        refreshWeaponVisual(r);
    }
    r.hp = st[9];
    r.shield = st[10];
    const f = st[11];
    r.aiming = Boolean(f & 1);
    r.moving = Boolean(f & 2);
    r.down = Boolean(f & 4);
    r.onGround = Boolean(f & 8);
    r.reloadT = f & 16 ? Math.max(r.reloadT, 0.5) : 0;
}

function teamTick(dt) {
    team.sendT -= dt;
    if (team.sendT <= 0) {
        team.sendT = 1 / 15;
        net.relay({ t: 'p', ts: Math.round(performance.now()), s: actorState(player), sh: team.myShots.splice(0, 12), fx: team.myFx.splice(0, 8) });
    }
    if (team.host) {
        team.snapT -= dt;
        if (team.snapT <= 0) {
            team.snapT = 1 / 12;
            const ms = [];
            for (const m of sim.monsters) {
                if (!m.alive) continue;
                const flags = (m.elite ? 1 : 0) | (m.mini ? 2 : 0) | (m.frozenT > 0 ? 4 : 0) | (m.attackT > 0 ? 8 : 0) | (m.aimT > 0 ? 16 : 0);
                ms.push([m.id, KIND_LIST.indexOf(m.kind), r2(m.pos.x), r2(m.pos.y), r2(m.pos.z), r2(m.yaw), Math.ceil(m.hp), m.maxHp, flags, r2(m.vel.x), r2(m.vel.z)]);
            }
            const ev = team.ev;
            net.relay({
                t: 's', ts: Math.round(performance.now()), ms,
                b: [Math.round(state.bookHp), state.bookMax],
                w: [state.wave, state.phase === 'fight' ? 1 : 0, Math.ceil(state.breakT), state.left],
                d: ev.dead.splice(0), pj: ev.pj.splice(0), fx: ev.fx.splice(0),
            });
        }
    }
    for (const r of team.remotes.values()) if (!r.gone) interpolate(r, dt);
    if (!team.host) {
        for (const m of clientMonsters.values()) {
            if (!m.alive) continue;
            interpolate(m, dt);
            m.speedNow = m.vel ? Math.hypot(m.vel.x, m.vel.z) : 0;
            m.frozenT = Math.max(0, m.frozenT - dt);
        }
    }
}

function onTeamMessage(from, d) {
    if (!d || !team.on || !player || state.mode === 'ready') return;
    switch (d.t) {
        case 'p': {
            const r = team.remotes.get(from);
            if (!r || r.gone) return;
            applyPlayerState(r, d.s, localTime(from, d.ts));
            if (d.sh && d.sh.length) remoteShots(r, d.sh);
            if (d.fx && d.fx.length) d.fx.forEach((e) => remoteFx(e));
            return;
        }
        case 's': {
            if (from !== team.hostName || team.host) return;
            const at = localTime(from, d.ts);
            const seen = new Set();
            for (const e of d.ms) {
                const [id, ki, x, y, z, yw, hp, maxHp, flags, vx, vz] = e;
                seen.add(id);
                let m = clientMonsters.get(id);
                if (!m) {
                    m = createMonster(scene, KIND_LIST[ki], { id, elite: Boolean(flags & 1), mini: Boolean(flags & 2), x, z, y });
                    m.yaw = yw;
                    clientMonsters.set(id, m);
                    fx.poof(new THREE.Vector3(x, 1.2, z), 0xd946ef, m.def.boss ? 6 : 1.6);
                }
                if (!m.alive) continue;
                pushState(m, at, x, y, z, vx || 0, 0, vz || 0, yw);
                // our own hits show right away; the leader's number wins after a moment
                if (!(m.predictT > 0) || hp < m.hp) m.hp = hp;
                m.maxHp = maxHp;
                if (flags & 4) m.frozenT = 0.3;
                if (flags & 8) m.attackT = Math.max(m.attackT, 0.3);
                if (flags & 16) m.aimT = 0.3;
                m.missing = 0;
            }
            // gone from the list without dying (it was removed): take it away
            for (const [id, m] of clientMonsters) {
                if (m.alive && !seen.has(id)) {
                    m.missing = (m.missing || 0) + 1;
                    if (m.missing > 6) {
                        disposeMonster(scene, m);
                        clientMonsters.delete(id);
                    }
                }
            }
            for (const [id, killer] of d.d || []) {
                const m = clientMonsters.get(id);
                if (m && m.alive) onMonsterDied(m, killer);
            }
            for (const p of d.pj || []) {
                const s = { pos: new THREE.Vector3(p[0], p[1], p[2]), vel: new THREE.Vector3(p[3], p[4], p[5]), color: p[6], lob: Boolean(p[7]), big: Boolean(p[8]), life: 4 };
                s.orb = fx.orb(s.color, s.big ? 1.6 : 0.7);
                s.orb.position.copy(s.pos);
                shots.push(s);
            }
            for (const e of d.fx || []) remoteFx(e);
            // the book and the wave
            const [hp, max] = d.b;
            if (hp < state.bookHp) {
                lib.book.hit = 1;
                state.bookAlertT = 2.5;
            }
            state.bookHp = hp;
            state.bookMax = max;
            const [w, fighting, breakT, left] = d.w;
            if (fighting && (w !== state.wave || state.phase !== 'fight')) {
                state.wave = w;
                state.phase = 'fight';
                const boss = w % 5 === 0;
                banner(`גל ${w}`, boss ? '⚠ טיטאן הדיו מתקרב!' : 'המפלצות פורצות מהשערים', boss ? 'boss' : '');
            } else if (!fighting && state.phase === 'fight') {
                state.phase = 'break';
                onWaveCleared(state.wave);
            }
            state.wave = w;
            state.breakT = breakT;
            state.left = left;
            return;
        }
        case 'hit': {
            // a teammate hit a monster
            if (!team.host) return;
            const m = sim.monsters.find((o) => o.id === d.id);
            if (m && m.alive) sim.damage(m, d.d, from, d.fx || null);
            return;
        }
        case 'dmg': {
            if (from !== team.hostName) return;
            damagePlayer(d.d, d.kb ? d.kb[0] : 0, d.kb ? d.kb[1] : 0);
            return;
        }
        case 'revive': {
            if (player.down) revive(from);
            return;
        }
        case 'skip': {
            if (team.host && state.phase === 'break') state.breakT = Math.min(state.breakT, 3);
            return;
        }
        case 'bookUp': {
            if (team.host) {
                state.bookMax += 250;
                state.bookHp += 250;
            }
            return;
        }
        case 'over': {
            if (from === team.hostName) {
                state.wave = d.w || state.wave;
                endMatch('book');
            }
            return;
        }
        default:
    }
}

function remoteShots(r, ends) {
    const w = currentWeapon(r);
    const def = w ? WEAPONS[w.kind] : WEAPONS.pistol;
    const muzzle = muzzlePosition(r, new THREE.Vector3());
    effects.flash(muzzle, 0.7);
    for (const e of ends) effects.tracer(muzzle, new THREE.Vector3(e[0], e[1], e[2]));
    audio.shot(def.sound, def.pitch, player ? player.pos.distanceTo(muzzle) : 0);
    if (r.fx) r.fx.recoil = Math.min(1, 0.55 + def.recoil * 9);
}

// effects that happened on someone else's computer
function remoteFx(e) {
    const [kind, ...v] = e;
    if (kind === 'boom') {
        fx.explosion(new THREE.Vector3(v[0], v[1], v[2]), v[3]);
        audio.boom({ volume: listenerVolume(new THREE.Vector3(v[0], v[1], v[2])), low: 300, length: 0.8 });
    } else if (kind === 'zap') {
        const pts = [];
        for (let i = 0; i + 2 < v.length; i += 3) pts.push(new THREE.Vector3(v[i], v[i + 1], v[i + 2]));
        if (pts.length > 1) fx.lightning(pts);
    } else if (kind === 'rk') {
        const r = { pos: new THREE.Vector3(v[0], v[1], v[2]), vel: new THREE.Vector3(v[3], v[4], v[5]), life: 3, remote: true };
        r.orb = fx.orb(0xff8a3d, 0.7);
        rockets.push(r);
    } else if (kind === 'slam') {
        fx.shockwave(new THREE.Vector3(v[0], 0, v[1]), v[2]);
        audio.boom({ volume: 0.6 * listenerVolume(new THREE.Vector3(v[0], 0, v[1])), low: 160, length: 0.6 });
    } else if (kind === 'poof') fx.poof(new THREE.Vector3(v[0], 1.5, v[1]), 0xa855f7, 2.4);
}

function teammateLeft(name) {
    const r = team.remotes.get(name);
    if (!r || r.gone) return;
    r.gone = true;
    r.root.visible = false;
    toast(`<b>${esc(name)}</b> יצא/ה מהמשחק`);
    if (name === team.hostName) {
        // the leader ran the monsters: without them the defense can't go on
        endMatch('hostLeft');
    }
}

// ------------------------------------------------------------------ damage, down, revive
function damagePlayer(dmg, kbx = 0, kbz = 0) {
    if (!player || player.down || state.mode !== 'playing') return;
    if (applyDamage(player, dmg)) {
        goDown();
        return;
    }
    player.vel.x += kbx;
    player.vel.z += kbz;
    if (Math.abs(kbx) + Math.abs(kbz) > 5 && player.onGround) {
        player.vel.y = 5;
        player.onGround = false;
    }
    if (player.fx) player.fx.flinch = 1;
    const el = $('hurtFlash');
    el.classList.remove('show');
    void el.offsetWidth;
    el.classList.add('show');
    audio.play('enemy_hurt', { volume: 0.4, rate: 0.8 });
}

function goDown() {
    player.down = true;
    player.alive = true; // (still "in" the match - just on the floor)
    player.hp = 0;
    player.shield = 0;
    player.reloadT = 0;
    state.downT = team.on ? RESPAWN_TEAM : RESPAWN_SOLO;
    $('downScreen').classList.remove('hidden');
    audio.play('eliminate', { volume: 0.5, rate: 0.7 });
    banner('נפלת!', team.on ? 'חבר יכול להקים אותך (E לידך)' : `חוזר בעוד ${RESPAWN_SOLO} שניות`, 'bad');
}

function revive(by) {
    player.down = false;
    player.hp = by ? 50 : 100;
    player.shield = by ? 0 : 0;
    state.downT = 0;
    $('downScreen').classList.add('hidden');
    if (!by) {
        // back at the dome
        const [x, z] = PLAYER_SPAWNS[Math.floor(Math.random() * PLAYER_SPAWNS.length)];
        player.pos.set(x, lib.supportHeight(x, z, 5), z);
        player.vel.set(0, 0, 0);
    } else toast(`${iconSVG('heart', 16)} <b>${esc(by)}</b> הקים/ה אותך!`);
    fx.sparkle(new THREE.Vector3(player.pos.x, 1, player.pos.z), 0x86efac);
    audio.chime();
}

// ------------------------------------------------------------------ drops (each player sees their own)
const dropGeo = {
    ammo: new THREE.BoxGeometry(0.5, 0.32, 0.36),
    heal: new THREE.OctahedronGeometry(0.26, 0),
};
const dropMat = {
    ammo: new THREE.MeshStandardMaterial({ color: 0x4d7c0f, roughness: 0.5, emissive: 0x1a2e05, emissiveIntensity: 0.6 }),
    heal: new THREE.MeshStandardMaterial({ color: 0xf472b6, roughness: 0.2, emissive: 0xdb2777, emissiveIntensity: 1 }),
};
function addDrop(type, pos, extra = {}) {
    const g = new THREE.Group();
    let ringColor = 0x84cc16;
    if (type === 'weapon') {
        const m = weaponMesh(extra.weapon.kind, extra.weapon.rarity);
        m.position.y = 0.5;
        m.rotation.y = Math.PI / 2;
        g.add(m);
        ringColor = RARITIES[extra.weapon.rarity].hex;
        if (extra.weapon.rarity >= 2 || WEAPONS[extra.weapon.kind].special) {
            const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.3, 6, 10, 1, true), new THREE.MeshBasicMaterial({ color: ringColor, transparent: true, opacity: 0.3, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
            beam.position.y = 3;
            g.add(beam);
        }
    } else {
        const m = new THREE.Mesh(dropGeo[type], dropMat[type]);
        m.position.y = 0.35;
        g.add(m);
        ringColor = type === 'heal' ? 0xf472b6 : 0x84cc16;
    }
    const glowS = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color: ringColor, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0.6 }));
    glowS.position.y = 0.45;
    glowS.scale.setScalar(1.4);
    g.add(glowS);
    g.position.set(pos.x, lib.supportHeight(pos.x, pos.z, Math.max(0, pos.y)), pos.z);
    scene.add(g);
    drops.push({ type, g, t: 0, ...extra, pos: g.position });
    // pop out a little
    g.userData.vy = 3;
}

function rollRarity(bonus = 0) {
    const r = Math.random() + bonus;
    return r > 0.97 ? 4 : r > 0.88 ? 3 : r > 0.7 ? 2 : r > 0.42 ? 1 : 0;
}
const GUN_POOL = ['pistol', 'smg', 'ar', 'ar', 'shotgun', 'shotgun', 'dmr', 'sniper', 'heavy', 'smg'];
const SPECIAL_POOL = ['minigun', 'rocket', 'freeze', 'lightning'];
function randomWeapon(bonus = 0, specialChance = 0.12) {
    const kind = Math.random() < specialChance ? SPECIAL_POOL[Math.floor(Math.random() * SPECIAL_POOL.length)] : GUN_POOL[Math.floor(Math.random() * GUN_POOL.length)];
    return makeWeapon(kind, Math.min(4, rollRarity(bonus)));
}

function spawnDrops(m, c) {
    if (!player || m.pos.distanceTo(player.pos) > 70) return;
    const at = (dx = 0, dz = 0) => new THREE.Vector3(m.pos.x + dx, c.y, m.pos.z + dz);
    if (m.def.boss) {
        for (let i = 0; i < 3; i++) addDrop('weapon', at(Math.cos(i * 2.1) * 2.2, Math.sin(i * 2.1) * 2.2), { weapon: randomWeapon(0.5, 0.6) });
        addDrop('heal', at(0, 1));
        addDrop('ammo', at(1, -1));
        return;
    }
    if (m.elite) {
        addDrop('weapon', at(), { weapon: randomWeapon(0.25, 0.3) });
        return;
    }
    const r = Math.random();
    if (r < 0.2) addDrop('ammo', at());
    else if (r < 0.28) addDrop('heal', at());
    else if (r < 0.315 + (m.def.heavy ? 0.3 : 0)) addDrop('weapon', at(), { weapon: randomWeapon(state.wave * 0.012) });
}

function updateDrops(dt, t) {
    for (let i = drops.length - 1; i >= 0; i--) {
        const d = drops[i];
        d.t += dt;
        const g = d.g;
        if (g.userData.vy !== undefined) {
            g.userData.vy -= 12 * dt;
            g.position.y = Math.max(lib.supportHeight(g.position.x, g.position.z, g.position.y + 0.5), g.position.y + g.userData.vy * dt);
            if (g.userData.vy < 0 && g.position.y <= lib.supportHeight(g.position.x, g.position.z, g.position.y + 0.5) + 0.001) delete g.userData.vy;
        }
        g.children[0].rotation.y += dt * 1.6;
        g.children[0].position.y = (d.type === 'weapon' ? 0.5 : 0.35) + Math.sin(t * 3 + i) * 0.08;
        let remove = d.t > 45;
        // ammo and healing are picked up just by walking over them
        if (!remove && player && !player.down && d.type !== 'weapon' && Math.hypot(player.pos.x - g.position.x, player.pos.z - g.position.z) < 1.5 && Math.abs(player.pos.y - g.position.y) < 1.6) {
            if (d.type === 'ammo') {
                const w = currentWeapon(player);
                const type = w ? WEAPONS[w.kind].ammo : 'medium';
                const amt = AMMO[type].box * 2;
                player.ammo[type] = Math.min(MAX_AMMO[type], player.ammo[type] + amt);
                // and a bit of everything else
                for (const k of Object.keys(player.ammo)) if (k !== type) player.ammo[k] = Math.min(MAX_AMMO[k], player.ammo[k] + Math.ceil(AMMO[k].box * 0.5));
                message(`+${amt} ${AMMO[type].name}`, 'loot');
            } else {
                if (player.hp < 100) player.hp = Math.min(100, player.hp + 35);
                else player.shield = Math.min(100, player.shield + 35);
                message('+35 ריפוי', 'loot');
            }
            audio.play('coin', { volume: 0.4, rate: d.type === 'heal' ? 1.4 : 1 });
            fx.sparkle(g.position.clone().setY(g.position.y + 0.5), d.type === 'heal' ? 0xf9a8d4 : 0xbef264);
            remove = true;
        }
        if (remove) {
            scene.remove(g);
            drops.splice(i, 1);
        }
    }
}

// ------------------------------------------------------------------ inventory
function giveWeapon(w) {
    let slot = player.slots.findIndex((s) => !s);
    if (slot < 0) {
        // full: swap with the one in your hands (it falls to the floor)
        slot = player.current;
        const old = player.slots[slot];
        if (old) addDrop('weapon', new THREE.Vector3(player.pos.x + Math.sin(player.yaw) * 1.2, player.pos.y + 0.5, player.pos.z + Math.cos(player.yaw) * 1.2), { weapon: old });
    }
    player.slots[slot] = w;
    selectSlot(slot, true);
    const def = WEAPONS[w.kind];
    // a new kind of ammo? start with some
    if (player.ammo[def.ammo] < AMMO[def.ammo].box * 2) player.ammo[def.ammo] = Math.min(MAX_AMMO[def.ammo], player.ammo[def.ammo] + AMMO[def.ammo].box * 3);
    const r = RARITIES[w.rarity];
    message(`<span style="color:${r.color}">${def.name} ${r.name}</span> · נזק ${Math.round(weaponDamage(w) * def.pellets)}`, 'loot');
}

function selectSlot(i, force = false) {
    if (!player || (i === player.current && !force) || !player.slots[i]) return;
    player.current = i;
    player.reloadT = 0;
    state.spin = 0;
    refreshWeaponVisual(player);
    audio.play('weapon_change', { volume: 0.4 });
}
function cycleSlot(dir) {
    if (!player) return;
    for (let k = 1; k <= 5; k++) {
        const i = (player.current + dir * k + 5) % 5;
        if (player.slots[i]) {
            selectSlot(i);
            return;
        }
    }
}

function startReload() {
    const w = currentWeapon(player);
    if (!w || player.reloadT > 0) return false;
    const def = WEAPONS[w.kind];
    if (w.ammoInMag >= magSize(w) || player.ammo[def.ammo] <= 0) return false;
    player.reloadT = reloadTime(w);
    return true;
}
function tickWeapon(dt) {
    player.cooldown = Math.max(0, player.cooldown - dt);
    if (player.reloadT > 0) {
        player.reloadT -= dt;
        if (player.reloadT <= 0) {
            player.reloadT = 0;
            const w = currentWeapon(player);
            if (w) {
                const def = WEAPONS[w.kind];
                const take = Math.min(magSize(w) - w.ammoInMag, player.ammo[def.ammo]);
                w.ammoInMag += take;
                player.ammo[def.ammo] -= take;
            }
        }
    }
}

// ------------------------------------------------------------------ shooting
const tmpV = new THREE.Vector3();
const tmpA = new THREE.Vector3();
const tmpB = new THREE.Vector3();
const camForward = new THREE.Vector3();
const camRight = new THREE.Vector3();
const aimDir = new THREE.Vector3();

function randomCone(dir, angle, out) {
    if (angle <= 0) return out.copy(dir);
    const u = Math.random();
    const v = Math.random();
    const theta = 2 * Math.PI * u;
    const phi = Math.acos(1 - v * (1 - Math.cos(angle)));
    out.set(Math.sin(phi) * Math.cos(theta), Math.sin(phi) * Math.sin(theta), Math.cos(phi));
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), dir);
    return out.applyQuaternion(q);
}

// the first monster along a ray (and how far), before `maxDist`
function firstMonster(o, d, maxDist, skip = null) {
    let best = null;
    for (const m of monstersNow()) {
        if (!m.alive || m === skip || (skip && skip.has && skip.has(m))) continue;
        const h = rayHitsMonster(m, o, d, best ? best.dist : maxDist);
        if (h) best = { m, ...h };
    }
    return best;
}

function hitMonster(m, dmg, weak, point, fxKind = null) {
    if (!m.alive) return;
    m.hitFlash = 1;
    m.barT = 4;
    fx.number(point, dmg, weak ? 'head' : '');
    flashHitmarker(weak ? 'head' : '');
    if (fxKind === 'freeze') {
        m.frozenT = Math.max(m.frozenT, 0.5);
        fx.frost(point);
    }
    if (!team.on || team.host) {
        sim.damage(m, dmg, team.me, fxKind);
    } else {
        m.hp = Math.max(0, m.hp - dmg);
        m.predictT = 0.6;
        net.relay({ t: 'hit', id: m.id, d: Math.round(dmg * 10) / 10, fx: fxKind }, team.hostName);
    }
}

function aimPointFromCamera(out) {
    camera.getWorldDirection(camForward);
    let dist = lib.raycast(camera.position, camForward, 300);
    const hit = firstMonster(camera.position, camForward, dist);
    if (hit) return out.copy(camera.position).addScaledVector(camForward, hit.dist);
    // light aim assist: a near miss next to a monster is pulled onto it
    let best = null;
    let bestAng = 0;
    for (const m of monstersNow()) {
        if (!m.alive) continue;
        monsterCenter(m, tmpA);
        const to = tmpB.subVectors(tmpA, camera.position);
        const d = to.length();
        if (d < 2 || d > 90) continue;
        to.divideScalar(d);
        const ang = Math.acos(Math.min(1, to.dot(camForward)));
        const limit = Math.min(0.07, (m.radius + 0.4) / d + 0.006);
        if (ang > limit || (best && ang > bestAng)) continue;
        if (!lib.lineOfSight(camera.position, tmpA)) continue;
        best = m;
        bestAng = ang;
    }
    if (best) return monsterCenter(best, out);
    dist = Math.max(dist, 2);
    return out.copy(camera.position).addScaledVector(camForward, dist);
}

function fireWeapon() {
    const w = currentWeapon(player);
    if (!w || player.cooldown > 0 || player.reloadT > 0 || player.down) return;
    const def = WEAPONS[w.kind];
    if (def.special === 'spin' && state.spin < 0.55) return;
    if (w.ammoInMag <= 0) {
        if (!startReload()) message('אין תחמושת - מקבלים עוד בסוף כל גל, ומפלצות מפילות קופסאות', 'kill');
        return;
    }
    w.ammoInMag -= 1;
    player.cooldown = 1 / (fireRate(w) * (def.special === 'spin' ? 0.4 + state.spin * 0.6 : 1));
    if (player.fx) player.fx.recoil = Math.min(1, 0.55 + def.recoil * 9);
    const muzzle = muzzlePosition(player, new THREE.Vector3());
    effects.flash(muzzle, def.pellets > 1 ? 1.1 : 0.7);
    const aimPoint = aimPointFromCamera(new THREE.Vector3());
    const origin = player.pos.clone();
    origin.y += 1.35;
    aimDir.subVectors(aimPoint, origin);
    if (aimDir.lengthSq() < 0.5) camera.getWorldDirection(aimDir);
    aimDir.normalize();
    let spread = (player.aiming ? def.adsSpread : def.spread) * spreadMul(w);
    if (player.moving) spread *= 1.3;
    if (!player.onGround) spread *= 1.6;
    // recoil kicks the view up a little
    pitch = Math.min(1.1, pitch + def.recoil * (player.aiming ? 0.5 : 0.9));
    yaw += (Math.random() - 0.5) * def.recoil * 0.3;

    if (def.special === 'rocket') {
        const vel = randomCone(aimDir, spread, new THREE.Vector3()).multiplyScalar(36);
        const r = { pos: muzzle.clone(), vel, life: 3.5, dmg: weaponDamage(w), blast: def.blast, orb: fx.orb(0xff8a3d, 0.7) };
        rockets.push(r);
        if (team.on) team.myFx.push(['rk', r2(muzzle.x), r2(muzzle.y), r2(muzzle.z), r2(vel.x), r2(vel.y), r2(vel.z)]);
        audio.boom({ volume: 0.6, low: 500, length: 0.5 });
        return;
    }
    if (def.special === 'chain') {
        chainLightning(muzzle, origin, aimDir, w, def);
        audio.tone(900, { length: 0.25, type: 'sawtooth', volume: 0.08, slide: 0.3 });
        return;
    }
    audio.shot(def.sound, def.pitch, 0);
    const base = weaponDamage(w);
    const d = new THREE.Vector3();
    for (let p = 0; p < def.pellets; p++) {
        randomCone(aimDir, spread, d);
        const wall = lib.raycast(origin, d, def.range);
        const hit = firstMonster(origin, d, wall);
        const dist = hit ? hit.dist : wall;
        const point = origin.clone().addScaledVector(d, dist);
        if (p < 3) {
            effects.tracer(muzzle, point);
            if (team.on) team.myShots.push([r2(point.x), r2(point.y), r2(point.z)]);
        }
        if (hit) {
            const falloff = 1 - Math.max(0, (dist / def.range - 0.4) / 0.6) * 0.45;
            const dmg = base * falloff * (hit.weak ? 1.5 : 1);
            hitMonster(hit.m, dmg, hit.weak, point, def.special === 'freeze' ? 'freeze' : null);
        } else if (dist < def.range - 0.1) {
            effects.impact(point, def.special === 'freeze' ? 0x7dd3fc : 0xd6d3d1);
        }
    }
}

function chainLightning(muzzle, origin, dir, w, def) {
    const wall = lib.raycast(origin, dir, def.range);
    const first = firstMonster(origin, dir, wall);
    const pts = [muzzle.clone()];
    if (!first) {
        pts.push(origin.clone().addScaledVector(dir, Math.min(wall, def.range)));
        fx.lightning(pts);
        if (team.on) team.myFx.push(['zap', ...pts.flatMap((p) => [r2(p.x), r2(p.y), r2(p.z)])]);
        return;
    }
    const hitSet = new Set();
    let cur = first.m;
    let dmg = weaponDamage(w);
    for (let k = 0; k < (def.chain || 3) && cur; k++) {
        hitSet.add(cur);
        const c = monsterCenter(cur, new THREE.Vector3());
        pts.push(c);
        hitMonster(cur, dmg, false, c, null);
        dmg *= 0.78;
        // jump to the nearest other monster close by
        let next = null;
        let nd = 8;
        for (const m of monstersNow()) {
            if (!m.alive || hitSet.has(m)) continue;
            const d = m.pos.distanceTo(cur.pos);
            if (d < nd) {
                nd = d;
                next = m;
            }
        }
        cur = next;
    }
    fx.lightning(pts);
    if (team.on) team.myFx.push(['zap', ...pts.flatMap((p) => [r2(p.x), r2(p.y), r2(p.z)])]);
}

function explode(pos, radius, dmg, mine) {
    fx.explosion(pos, radius);
    audio.boom({ volume: Math.max(0.3, listenerVolume(pos)), low: 300, length: 0.8 });
    if (team.on && mine) team.myFx.push(['boom', r2(pos.x), r2(pos.y), r2(pos.z), radius]);
    if (!mine) return;
    for (const m of monstersNow()) {
        if (!m.alive) continue;
        const c = monsterCenter(m, tmpA);
        const d = c.distanceTo(pos) - m.radius;
        if (d > radius) continue;
        hitMonster(m, dmg * (1 - Math.max(0, d) / radius * 0.6), false, c.clone(), null);
    }
}

function updateRockets(dt) {
    for (let i = rockets.length - 1; i >= 0; i--) {
        const r = rockets[i];
        r.life -= dt;
        const step = r.vel.length() * dt;
        tmpV.copy(r.vel).normalize();
        const wall = lib.raycast(r.pos, tmpV, step + 0.1);
        const hit = r.remote ? null : firstMonster(r.pos, tmpV, step + 0.3);
        let done = r.life <= 0 || wall <= step;
        if (hit) {
            r.pos.addScaledVector(tmpV, hit.dist);
            done = true;
        } else r.pos.addScaledVector(r.vel, dt);
        r.orb.position.copy(r.pos);
        fx.trail(r.pos, 0xffa94d, 0.6);
        if (done) {
            fx.removeObj(r.orb);
            if (!r.remote) explode(r.pos.clone(), r.blast, r.dmg, true);
            rockets.splice(i, 1);
        }
    }
    // grenades bounce, then go off
    for (let i = nades.length - 1; i >= 0; i--) {
        const n = nades[i];
        n.t -= dt;
        n.vel.y -= 20 * dt;
        n.pos.addScaledVector(n.vel, dt);
        const floor = lib.supportHeight(n.pos.x, n.pos.z, n.pos.y + 0.3, 0.1, 0.3);
        if (n.pos.y < floor + 0.12) {
            n.pos.y = floor + 0.12;
            n.vel.y = Math.abs(n.vel.y) * 0.35;
            n.vel.x *= 0.6;
            n.vel.z *= 0.6;
        }
        const before = n.pos.clone();
        lib.pushOut(n.pos, 0.15, 0.2, 0.05);
        if (before.distanceToSquared(n.pos) > 1e-6) {
            n.vel.x *= -0.4;
            n.vel.z *= -0.4;
        }
        n.mesh.position.copy(n.pos);
        n.mesh.rotation.x += dt * 8;
        n.blink.material.opacity = Math.sin(n.t * (n.t < 0.6 ? 30 : 12)) > 0 ? 1 : 0.2;
        if (n.t <= 0) {
            scene.remove(n.mesh);
            explode(n.pos.clone(), 5.5, 140 * (1 + state.wave * 0.05), true);
            nades.splice(i, 1);
        }
    }
    // the monsters' shots (drawn on a teammate's computer; the leader's are in the sim)
    if (team.host && sim) {
        for (const p of sim.projectiles) {
            if (p.orb) p.orb.position.copy(p.pos);
            if (Math.random() < 0.5) fx.trail(p.pos, p.color, p.big ? 1 : 0.4);
        }
    }
    for (let i = shots.length - 1; i >= 0; i--) {
        const s = shots[i];
        s.life -= dt;
        if (s.lob) s.vel.y -= 9 * dt;
        const step = s.vel.length() * dt;
        tmpV.copy(s.vel).normalize();
        const wall = lib.raycast(s.pos, tmpV, step + 0.05);
        s.pos.addScaledVector(s.vel, dt);
        s.orb.position.copy(s.pos);
        if (Math.random() < 0.5) fx.trail(s.pos, s.color, s.big ? 1 : 0.4);
        let done = s.life <= 0 || wall < step || (Math.hypot(s.pos.x, s.pos.z) < 3.4 && s.pos.y < 5.5);
        if (!done && player) {
            tmpA.copy(player.pos).y += 1;
            if (tmpA.distanceTo(s.pos) < 0.8) done = true;
            for (const r of team.remotes.values()) {
                tmpA.copy(r.pos).y += 1;
                if (tmpA.distanceTo(s.pos) < 0.8) done = true;
            }
        }
        if (done) {
            fx.removeObj(s.orb);
            fx.splat(s.pos, s.color, s.big ? 18 : 6);
            shots.splice(i, 1);
        }
    }
}

function throwGrenade() {
    if (!player || player.down || player.grenades <= 0) {
        if (player && player.grenades <= 0) message('אין רימונים - מקבלים רימון בסוף כל גל', 'kill');
        return;
    }
    player.grenades -= 1;
    camera.getWorldDirection(camForward);
    const pos = player.pos.clone().add(new THREE.Vector3(0, 1.6, 0));
    const vel = camForward.clone().multiplyScalar(17);
    vel.y += 5;
    vel.add(player.vel);
    const mesh = new THREE.Group();
    const ball = new THREE.Mesh(new THREE.SphereGeometry(0.14, 12, 8), new THREE.MeshStandardMaterial({ color: 0x3f6212, roughness: 0.5 }));
    const blink = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color: 0xef4444, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
    blink.scale.setScalar(0.6);
    mesh.add(ball, blink);
    scene.add(mesh);
    nades.push({ pos, vel, t: 1.7, mesh, blink });
    audio.play('jump_a', { volume: 0.3, rate: 1.6 });
}

// ------------------------------------------------------------------ shops, pickups and revives (E)
function nearestInteract() {
    if (!player || player.down) return null;
    // a teammate on the floor
    for (const [name, r] of team.remotes) {
        if (r.down && !r.gone && r.pos.distanceTo(player.pos) < 2.4) return { kind: 'revive', name, r };
    }
    let best = null;
    let bd = 2.2;
    for (const d of drops) {
        if (d.type !== 'weapon') continue;
        const dist = Math.hypot(d.g.position.x - player.pos.x, d.g.position.z - player.pos.z);
        if (dist < bd && Math.abs(d.g.position.y - player.pos.y) < 1.8) {
            best = { kind: 'weapon', d };
            bd = dist;
        }
    }
    return best;
}

function interact() {
    const it = nearestInteract();
    if (!it) return;
    if (it.kind === 'weapon') {
        const i = drops.indexOf(it.d);
        if (i >= 0) {
            scene.remove(it.d.g);
            drops.splice(i, 1);
        }
        giveWeapon(it.d.weapon);
        audio.play('weapon_change', { volume: 0.5 });
    }
    // (reviving is a hold - see updatePlayer)
}


// ------------------------------------------------------------------ input
const keys = {};
const mouse = { left: false, right: false, clicked: false };
let yaw = Math.PI;
let pitch = -0.2;

function locked() {
    return document.pointerLockElement === renderer.domElement;
}
function requestLock() {
    if (touchMode) return;
    try {
        const p = renderer.domElement.requestPointerLock();
        if (p && p.catch) p.catch(() => {});
    } catch (e) {
        // ignore
    }
}

window.addEventListener('keydown', (e) => {
    if (state.mode !== 'playing') return;
    const k = e.code;
    keys[k] = true;
    if (['Space', 'ArrowUp', 'ArrowDown'].includes(k)) e.preventDefault();
    if (e.repeat) return;
    if (k.startsWith('Digit')) {
        const n = Number(k.slice(5)) - 1;
        if (n >= 0 && n < 5) selectSlot(n);
    } else if (k === 'KeyE') interact();
    else if (k === 'KeyR') startReload();
    else if (k === 'KeyG') throwGrenade();
    else if (k === 'KeyB') skipBreak();
});
window.addEventListener('keyup', (e) => { keys[e.code] = false; });

function skipBreak() {
    if (state.phase !== 'break') return;
    if (!team.on || team.host) state.breakT = Math.min(state.breakT, 3);
    else net.relay({ t: 'skip' }, team.hostName);
    message('הגל הבא מתחיל!', 'loot');
}

renderer.domElement.addEventListener('mousedown', (e) => {
    if (state.mode === 'playing' && $('pauseScreen').classList.contains('hidden') === false) {
        resume();
        return;
    }
    if (state.mode !== 'playing') return;
    if (!locked() && !touchMode) {
        requestLock();
        return;
    }
    if (e.button === 0) {
        mouse.left = true;
        mouse.clicked = true;
    } else if (e.button === 2) mouse.right = true;
});
window.addEventListener('mouseup', (e) => {
    if (e.button === 0) mouse.left = false;
    else if (e.button === 2) mouse.right = false;
});
window.addEventListener('contextmenu', (e) => e.preventDefault());
window.addEventListener('mousemove', (e) => {
    if (!locked() || state.mode !== 'playing') return;
    let sens = 0.0022 * (scopeOn() ? (WEAPONS[currentWeapon(player).kind].zoom || 16) / 64 : player.aiming ? 0.6 : 1);
    if (state.stickyAim) sens *= 0.75;
    yaw -= e.movementX * sens;
    pitch -= e.movementY * sens;
    pitch = Math.max(-1.25, Math.min(1.1, pitch));
});
window.addEventListener('wheel', (e) => {
    if (state.mode !== 'playing') return;
    cycleSlot(e.deltaY > 0 ? 1 : -1);
});
document.addEventListener('pointerlockchange', () => {
    if (!locked() && state.mode === 'playing' && !touchMode) pause();
});
window.addEventListener('blur', () => {
    if (state.mode === 'playing' && !touchMode) pause();
});
document.addEventListener('visibilitychange', () => {
    if (document.hidden && state.mode === 'playing') pause();
});

// In a team the game can't stop (the others are still fighting): the menu
// just covers the screen. Alone, everything waits for you.
function pause() {
    mouse.left = false;
    mouse.right = false;
    Object.keys(keys).forEach((k) => { keys[k] = false; });
    state.softPause = team.on;
    $('pauseSub').textContent = team.on ? 'הקבוצה ממשיכה להילחם! לחצו כדי לחזור' : 'לחצו כדי לחזור להגנה על הספרייה';
    $('pauseScreen').classList.remove('hidden');
}
function resume() {
    $('pauseScreen').classList.add('hidden');
    state.softPause = false;
    requestLock();
    clock.getDelta();
}
$('resumeBtn').addEventListener('click', resume);

const touch = { stick: null, moveX: 0, moveZ: 0, look: null };
if (touchMode) {
    $('touch').classList.remove('hidden');
    const stick = $('stick');
    const knob = $('stickKnob');
    stick.addEventListener('pointerdown', (e) => {
        touch.stick = { id: e.pointerId, x: e.clientX, y: e.clientY };
        stick.setPointerCapture(e.pointerId);
    });
    stick.addEventListener('pointermove', (e) => {
        if (!touch.stick || e.pointerId !== touch.stick.id) return;
        let dx = e.clientX - touch.stick.x;
        let dy = e.clientY - touch.stick.y;
        const len = Math.hypot(dx, dy);
        if (len > 45) {
            dx *= 45 / len;
            dy *= 45 / len;
        }
        knob.style.transform = `translate(${dx}px, ${dy}px)`;
        touch.moveX = dx / 45;
        touch.moveZ = -dy / 45;
    });
    const endStick = () => {
        touch.stick = null;
        touch.moveX = 0;
        touch.moveZ = 0;
        knob.style.transform = '';
    };
    stick.addEventListener('pointerup', endStick);
    stick.addEventListener('pointercancel', endStick);
    renderer.domElement.addEventListener('pointerdown', (e) => {
        touch.look = { id: e.pointerId, x: e.clientX, y: e.clientY };
    });
    window.addEventListener('pointermove', (e) => {
        if (!touch.look || e.pointerId !== touch.look.id) return;
        yaw -= (e.clientX - touch.look.x) * 0.005;
        pitch -= (e.clientY - touch.look.y) * 0.005;
        pitch = Math.max(-1.25, Math.min(1.1, pitch));
        touch.look.x = e.clientX;
        touch.look.y = e.clientY;
    });
    window.addEventListener('pointerup', (e) => {
        if (touch.look && e.pointerId === touch.look.id) touch.look = null;
    });
    const hold = (id, on, off) => {
        const b = $(id);
        b.addEventListener('pointerdown', (e) => { e.stopPropagation(); on(); });
        b.addEventListener('pointerup', (e) => { e.stopPropagation(); if (off) off(); });
        b.addEventListener('pointerleave', () => { if (off) off(); });
    };
    hold('tFire', () => { mouse.left = true; mouse.clicked = true; }, () => { mouse.left = false; });
    hold('tAim', () => { mouse.right = !mouse.right; });
    hold('tJump', () => { keys.Space = true; }, () => { keys.Space = false; });
    hold('tUse', () => {
        keys.KeyE = true;
        interact();
    }, () => { keys.KeyE = false; });
    hold('tReload', startReload);
    hold('tNade', throwGrenade);
    hold('tNext', () => cycleSlot(1));
}

// The library page can pause or restart the game.
window.addEventListener('message', (e) => {
    if (e.origin !== window.location.origin) return;
    const msg = e.data && e.data.type;
    if (msg === 'pause' && state.mode === 'playing') pause();
    else if (msg === 'restart' && state.mode !== 'loading') {
        bridge.runEnded(state.coins, { score: state.wave });
        window.location.reload();
    }
});
$('againBtn').addEventListener('click', () => window.location.reload());
$('muteBtn').addEventListener('click', (e) => {
    e.stopPropagation();
    audio.toggleMute();
    soundIcons();
});
function soundIcons() {
    $('iconSoundOn').classList.toggle('hidden', audio.muted);
    $('iconSoundOff').classList.toggle('hidden', !audio.muted);
}

// ------------------------------------------------------------------ the player, each frame
function scopeOn() {
    const w = player && currentWeapon(player);
    return Boolean(w && player.aiming && WEAPONS[w.kind].scope);
}

function updatePlayer(dt) {
    const w = currentWeapon(player);
    const paused = state.softPause;
    if (player.down) {
        player.aiming = false;
        state.downT -= dt;
        $('downText').textContent = team.on ? `חבר יכול להקים אותך · חוזר בעוד ${Math.ceil(state.downT)}` : `חוזר בעוד ${Math.ceil(state.downT)}`;
        if (state.downT <= 0) revive(null);
        player.vel.x *= 0.9;
        player.vel.z *= 0.9;
        moveActor(player, moveWorld, { x: 0, z: 0, jump: false }, dt);
        return;
    }
    player.aiming = !paused && mouse.right && Boolean(w);
    // move relative to the camera
    let fwd = 0;
    let side = 0;
    if (!paused) {
        if (keys.KeyW || keys.ArrowUp) fwd += 1;
        if (keys.KeyS || keys.ArrowDown) fwd -= 1;
        if (keys.KeyD || keys.ArrowRight) side += 1;
        if (keys.KeyA || keys.ArrowLeft) side -= 1;
        if (touchMode) {
            fwd += touch.moveZ;
            side += touch.moveX;
        }
    }
    const f = new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw));
    const r = new THREE.Vector3(-Math.cos(yaw), 0, Math.sin(yaw));
    const move = f.multiplyScalar(fwd).addScaledVector(r, side);
    if (move.lengthSq() > 1) move.normalize();
    moveActor(player, moveWorld, { x: move.x, z: move.z, jump: !paused && Boolean(keys.Space), toggleGlider: false }, dt);
    if (player.justJumped) {
        audio.play('jump_a', { volume: 0.25 });
        player.justJumped = false;
    }
    if (player.justLanded) {
        if (player.justLanded === 'hard') audio.play('land', { volume: 0.3 });
        player.justLanded = null;
    }
    // you face where the camera looks
    player.yaw = yaw;
    player.pitch = pitch;

    tickWeapon(dt);
    const def = w ? WEAPONS[w.kind] : null;
    if (def && def.special === 'spin') state.spin = mouse.left && !paused ? Math.min(1, state.spin + dt * 1.6) : Math.max(0, state.spin - dt * 1.2);
    if (!paused && w && (mouse.left && (def.auto || mouse.clicked))) fireWeapon();
    mouse.clicked = false;
    // auto reload when empty - and with no bullets left at all, take another gun
    if (w && w.ammoInMag <= 0 && player.reloadT <= 0 && player.cooldown <= 0 && !startReload()) {
        const other = player.slots.findIndex((s) => s && (s.ammoInMag > 0 || player.ammo[WEAPONS[s.kind].ammo] > 0));
        if (other >= 0 && other !== player.current) {
            selectSlot(other);
            message('נגמרה התחמושת - עברתי לנשק אחר', 'kill');
        }
    }
    state.stickyAim = false;

    // reviving a friend: hold E next to them
    const it = nearestInteract();
    if (it && it.kind === 'revive' && keys.KeyE) {
        state.reviveT += dt;
        if (state.reviveT >= REVIVE_TIME) {
            net.relay({ t: 'revive' }, it.name);
            it.r.down = false;
            state.reviveT = 0;
            toast(`${iconSVG('heart', 16)} הקמת את <b>${esc(it.name)}</b>!`);
        }
    } else state.reviveT = 0;
}

// ------------------------------------------------------------------ camera
let camDist = 3.7;
let camFree = 3.7;
let fov = 70;
const pivot = new THREE.Vector3();
const desiredCam = new THREE.Vector3();
function updateCamera(dt) {
    const scope = scopeOn();
    const targetDist = player.down ? 5.5 : player.aiming ? 2.2 : 3.8;
    const shoulder = player.down ? 0 : player.aiming ? 0.7 : 0.85;
    camDist = THREE.MathUtils.lerp(camDist, targetDist, Math.min(1, dt * 10));
    const targetFov = scope ? WEAPONS[currentWeapon(player).kind].zoom || 16 : player.aiming ? 52 : 70;
    fov = THREE.MathUtils.lerp(fov, targetFov, Math.min(1, dt * 14));
    if (Math.abs(camera.fov - fov) > 0.01) {
        camera.fov = fov;
        camera.updateProjectionMatrix();
    }
    const p = player.down ? Math.max(pitch, -0.2) - 0.5 : pitch;
    camForward.set(Math.sin(yaw) * Math.cos(p), Math.sin(p), Math.cos(yaw) * Math.cos(p));
    camRight.set(-Math.cos(yaw), 0, Math.sin(yaw));
    pivot.copy(player.pos);
    pivot.y += 1.65;
    pivot.addScaledVector(camRight, shoulder);
    desiredCam.copy(pivot).addScaledVector(camForward, -camDist);
    desiredCam.y += 0.25;
    tmpV.subVectors(desiredCam, pivot);
    const want = tmpV.length();
    tmpV.normalize();
    const free = Math.max(0.4, lib.raycast(pivot, tmpV, want) - 0.3);
    camFree = free < camFree ? THREE.MathUtils.lerp(camFree, free, Math.min(1, dt * 30)) : THREE.MathUtils.lerp(camFree, free, Math.min(1, dt * 5));
    camera.position.copy(pivot).addScaledVector(tmpV, Math.min(camFree, want));
    if (scope) camera.position.copy(player.pos).add(tmpA.set(0, 1.55, 0)).addScaledVector(camForward, 0.3);
    camera.lookAt(tmpV.copy(camera.position).add(camForward));
    // (name tags and damage numbers are placed with this frame's camera)
    camera.updateMatrixWorld();
    player.root.visible = !scope;
    $('scope').classList.toggle('hidden', !scope);
    // the moon's shadows follow you
    moon.position.set(player.pos.x - 40, 80, player.pos.z - 30);
    moon.target.position.set(player.pos.x, 0, player.pos.z);
}

// ------------------------------------------------------------------ HUD
function message(html, cls = '') {
    const el = $('bigMessage');
    el.innerHTML = html;
    el.className = `big-message show ${cls}`;
    clearTimeout(message.t);
    message.t = setTimeout(() => el.classList.remove('show'), 1800);
}
function banner(title, sub = '', cls = '') {
    $('bannerTitle').textContent = title;
    $('bannerSub').textContent = sub;
    const el = $('waveBanner');
    el.className = `df-banner show ${cls}`;
    clearTimeout(banner.t);
    banner.t = setTimeout(() => el.classList.remove('show'), 3400);
}
function toast(html, ms = 4500) {
    const div = document.createElement('div');
    div.className = 'toast';
    div.innerHTML = html;
    $('toasts').appendChild(div);
    if (ms) setTimeout(() => div.remove(), ms);
    return div;
}
function feed(name, coins) {
    const div = document.createElement('div');
    div.className = 'feed-item df-feed';
    div.innerHTML = `${iconSVG('skull', 15)} <b class="me">את/ה</b> ${esc(name)}${coins ? ` <span class="gun">${iconSVG('coin', 13)} +${coins}</span>` : ''}`;
    const box = $('killFeed');
    box.prepend(div);
    while (box.children.length > 5) box.lastChild.remove();
    setTimeout(() => div.classList.add('fade'), 3500);
    setTimeout(() => div.remove(), 4200);
}
function flashHitmarker(kind) {
    const el = $('hitmarker');
    el.className = `hitmarker show ${kind}`;
    clearTimeout(flashHitmarker.t);
    flashHitmarker.t = setTimeout(() => { el.className = 'hitmarker'; }, kind === 'kill' ? 220 : 110);
    if (kind !== 'kill') audio.play('enemy_hurt', { volume: 0.18, rate: kind === 'head' ? 1.5 : 1.1 });
}

const slotEls = [...document.querySelectorAll('.slot')];
let slotSig = '';
function updateHud(dt) {
    // bars
    $('hpFill').style.width = `${player.hp}%`;
    $('hpText').textContent = Math.ceil(player.hp);
    $('shFill').style.width = `${player.shield}%`;
    $('shText').textContent = Math.ceil(player.shield);
    $('killText').textContent = state.kills.toLocaleString();
    // the next upgrade: how many kills to go, and what it will be
    const left = Math.max(0, KILLS_PER_UPGRADE - state.upKills);
    $('upFill').style.width = `${Math.min(1, state.upKills / KILLS_PER_UPGRADE) * 100}%`;
    $('upCount').textContent = `עוד ${left} ${left === 1 ? 'חיסול' : 'חיסולים'}`;
    const nr = nextReward();
    if ($('upNext').textContent !== nr.text) $('upNext').textContent = nr.text;
    $('coinText').textContent = state.coins.toLocaleString();
    $('nadeText').textContent = player.grenades;
    // weapon
    const w = currentWeapon(player);
    if (w) {
        const def = WEAPONS[w.kind];
        const r = RARITIES[w.rarity];
        $('weaponName').textContent = `${def.name} · ${r.name}`;
        $('weaponName').style.color = r.color;
        $('ammoText').textContent = w.ammoInMag;
        $('ammoReserve').textContent = player.ammo[def.ammo];
    }
    const sig = player.slots.map((s, i) => (s ? `${s.kind}:${s.rarity}:${s.ammoInMag}` : '-') + (i === player.current ? '*' : '')).join('|');
    if (sig !== slotSig) {
        slotSig = sig;
        slotEls.forEach((el, i) => {
            const it = player.slots[i];
            el.classList.toggle('empty', !it);
            el.classList.toggle('active', i === player.current);
            el.style.setProperty('--rarity', it ? RARITIES[it.rarity].color : 'transparent');
            el.querySelector('.slot-name').textContent = it ? WEAPONS[it.kind].name : '';
            el.querySelector('.slot-ammo').textContent = it ? it.ammoInMag : '';
            const img = el.querySelector('.slot-img');
            if (it) {
                const src = itemIcon(it);
                if (src && img.getAttribute('src') !== src) img.src = src;
                el.classList.toggle('has-icon', Boolean(src));
            } else el.classList.remove('has-icon');
        });
    }
    // the book and the wave
    const k = Math.max(0, state.bookHp / state.bookMax);
    $('bookFill').style.width = `${k * 100}%`;
    $('bookFill').classList.toggle('low', k < 0.3);
    $('bookText').textContent = `${Math.ceil(state.bookHp)}`;
    // the book is being hit: a warning (and a sound now and then)
    state.bookAlertT = Math.max(0, (state.bookAlertT || 0) - dt);
    const alert = state.bookAlertT > 0 && state.mode === 'playing';
    $('bookAlert').classList.toggle('show', alert);
    if (alert && !(state.alarmT > 0) && player.pos.distanceTo(BOOK_POS) > 10) {
        audio.tone(740, { length: 0.18, type: 'square', volume: 0.05 });
        state.alarmT = 2.2;
    }
    state.alarmT = (state.alarmT || 0) - dt;
    $('waveLabel').textContent = state.wave ? `גל ${state.wave}` : 'מתכוננים';
    $('waveSub').textContent = state.phase === 'break'
        ? `הגל ${state.wave ? 'הבא' : 'הראשון'} בעוד ${Math.max(0, Math.ceil(state.breakT))} · B להתחיל`
        : `${state.left} מפלצות נשארו`;
    // a boss on the field?
    const boss = monstersNow().find((m) => m.alive && m.def.boss);
    $('bossBar').classList.toggle('hidden', !boss);
    if (boss) $('bossFill').style.width = `${Math.max(0, boss.hp / boss.maxHp) * 100}%`;
    // crosshair
    const def = w ? WEAPONS[w.kind] : null;
    let spread = def ? (player.aiming ? def.adsSpread : def.spread) * spreadMul(w) : 0;
    if (player.moving) spread *= 1.3;
    const px = def ? Math.min(60, (spread / Math.tan((camera.fov * Math.PI) / 360)) * (window.innerHeight / 2)) + 3 : 8;
    const ch = $('crosshair');
    ch.className = `crosshair ${player.down || !w ? 'none' : w.kind} ${player.aiming ? 'aiming' : ''}`;
    ch.style.setProperty('--gap', `${px.toFixed(1)}px`);
    // prompt
    const it = nearestInteract();
    const prompt = $('prompt');
    if (it) {
        let html = '';
        if (it.kind === 'revive') html = `<kbd>E</kbd> החזיקו כדי להקים את ${esc(it.name)}`;
        else if (it.kind === 'weapon') {
            const r = RARITIES[it.d.weapon.rarity];
            html = `<kbd>E</kbd> לקחת <b style="color:${r.color}">${WEAPONS[it.d.weapon.kind].name} ${r.name}</b>`;
        }
        prompt.innerHTML = html;
        prompt.classList.remove('hidden');
    } else prompt.classList.add('hidden');
    // progress: reload / revive / minigun spin
    const prog = $('progress');
    if (state.reviveT > 0) {
        prog.classList.remove('hidden');
        $('progressFill').style.width = `${(state.reviveT / REVIVE_TIME) * 100}%`;
        $('progressText').textContent = 'מקים...';
    } else if (player.reloadT > 0 && w) {
        prog.classList.remove('hidden');
        $('progressFill').style.width = `${(1 - player.reloadT / reloadTime(w)) * 100}%`;
        $('progressText').textContent = 'טוען...';
    } else if (def && def.special === 'spin' && state.spin > 0 && state.spin < 0.55) {
        prog.classList.remove('hidden');
        $('progressFill').style.width = `${(state.spin / 0.55) * 100}%`;
        $('progressText').textContent = 'מסתובב...';
    } else prog.classList.add('hidden');
    fx.updateNumbers(dt, window.innerWidth, window.innerHeight);
    updateTeamHud();
    drawMinimap();
}

// teammates: a panel with everyone's health, and a name + bar over their heads
const tagEls = new Map();
function updateTeamHud() {
    const panel = $('teamPanel');
    if (!team.on) {
        panel.classList.add('hidden');
        return;
    }
    panel.classList.remove('hidden');
    const rows = [[`${team.me} (את/ה)`, player.hp, player.shield, player.down, false]];
    for (const [name, r] of team.remotes) rows.push([name, r.hp, r.shield, r.down, r.gone]);
    const html = rows.map(([n, hp, sh, down, gone]) => `<div class="mate${down || gone ? ' dead' : ''}">${esc(n)}${down ? ' · נפל!' : ''}${gone ? ' · יצא' : ''}<div class="bars"><i class="sh" style="width:${Math.max(0, sh)}%"></i><i class="hp" style="width:${Math.max(0, hp)}%"></i></div></div>`).join('');
    if (panel.innerHTML !== html) panel.innerHTML = html;
    const tags = $('teamTags');
    for (const [name, r] of team.remotes) {
        let el = tagEls.get(name);
        if (!el) {
            el = document.createElement('div');
            el.className = 'team-tag df-tag';
            tags.appendChild(el);
            tagEls.set(name, el);
        }
        tmpV.copy(r.pos);
        tmpV.y += 2.6;
        tmpV.project(camera);
        const vis = !r.gone && tmpV.z < 1;
        el.style.display = vis ? '' : 'none';
        if (!vis) continue;
        el.style.transform = `translate(${((tmpV.x * 0.5 + 0.5) * window.innerWidth).toFixed(1)}px, ${((-tmpV.y * 0.5 + 0.5) * window.innerHeight).toFixed(1)}px) translate(-50%, -100%)`;
        const inner = `${esc(name)}${r.down ? ' · צריך עזרה!' : ''}<span class="tag-hp"><i style="width:${Math.max(0, r.hp)}%"></i></span>`;
        if (el.dataset.sig !== inner) {
            el.dataset.sig = inner;
            el.innerHTML = inner;
        }
        el.classList.toggle('down', Boolean(r.down));
    }
}

const mini = $('minimap');
const mctx = mini.getContext('2d');
function drawMinimap() {
    const S = mini.width;
    const k = S / (HALF * 2);
    mctx.drawImage(lib.minimap, 0, 0, S, S);
    const toX = (x) => (x + HALF) * k;
    const toY = (z) => (HALF - z) * k;
    // the book
    mctx.fillStyle = '#facc15';
    mctx.beginPath();
    mctx.arc(toX(0), toY(0), 4, 0, Math.PI * 2);
    mctx.fill();
    for (const m of monstersNow()) {
        if (!m.alive) continue;
        mctx.fillStyle = m.def.boss ? '#e879f9' : m.elite ? '#facc15' : '#ef4444';
        const s = m.def.boss ? 5 : m.def.heavy ? 3 : 2;
        mctx.fillRect(toX(m.pos.x) - s / 2, toY(m.pos.z) - s / 2, s, s);
    }
    for (const r of team.remotes.values()) {
        if (r.gone) continue;
        mctx.fillStyle = r.down ? '#f87171' : '#38bdf8';
        mctx.beginPath();
        mctx.arc(toX(r.pos.x), toY(r.pos.z), 3, 0, Math.PI * 2);
        mctx.fill();
    }
    // you: an arrow
    mctx.save();
    mctx.translate(toX(player.pos.x), toY(player.pos.z));
    mctx.rotate(-yaw + Math.PI);
    mctx.fillStyle = '#fff';
    mctx.beginPath();
    mctx.moveTo(0, -6);
    mctx.lineTo(4, 4);
    mctx.lineTo(-4, 4);
    mctx.closePath();
    mctx.fill();
    mctx.restore();
}

// ------------------------------------------------------------------ the loop
const clock = new THREE.Clock();
function update(dt) {
    const t = clock.elapsedTime;
    const portalPower = [0, 1, 2, 3].map((i) => (state.phase === 'fight' && (state.wave <= 2 ? i < 2 : true) ? 1 : 0.3));
    lib.update(t, dt, { bookLife: state.bookHp / state.bookMax, portalPower });
    portalLights.forEach((l, i) => { l.intensity = 10 + portalPower[i] * 25 + Math.sin(t * 3 + i) * 4; });
    bookLight.intensity = 30 + (state.bookHp / state.bookMax) * 20 + lib.book.hit * 40;
    effects.update(dt);
    fx.update(dt);

    if (state.mode === 'playing') {
        state.time += dt;
        updatePlayer(dt);
        if (!team.on || team.host) {
            directorTick(dt);
            sim.update(dt, state.time);
        }
        if (team.on) teamTick(dt);
        updateRockets(dt);
        updateDrops(dt, t);
    }
    if (player) {
        updateActorVisual(player, dt, camera, t);
        // on the floor: lie down
        player.model.rotation.x = player.down ? -1.35 : 0;
        player.model.position.y = player.down ? 0.25 : 0;
        if (player.skin) player.skin.update(dt, { position: player.root.position, worldVelocity: null, moving: player.moving });
    }
    for (const r of team.remotes.values()) {
        if (r.gone) continue;
        r.healthBarT = 1e9;
        updateActorVisual(r, dt, camera, t);
        r.model.rotation.x = r.down ? -1.35 : 0;
        r.model.position.y = r.down ? 0.25 : 0;
        if (r.reloadT > 0) r.reloadT = Math.max(0.01, r.reloadT - dt);
        if (!r.moving && r.onGround && r.currentAction !== r.actions.idle) playAction(r, 'idle', 0.15);
        else if (r.moving && r.onGround) playAction(r, 'walk', 0.12);
        if (r.skin) r.skin.update(dt, { position: r.root.position, worldVelocity: null, moving: r.moving });
    }
    for (const m of monstersNow()) {
        if (m.alive) {
            if (m.predictT > 0) m.predictT -= dt;
            updateMonsterVisual(m, t, dt, camera);
        }
    }
    for (let i = dying.length - 1; i >= 0; i--) {
        const m = dying[i];
        if (updateDying(m, dt)) {
            disposeMonster(scene, m);
            dying.splice(i, 1);
            if (sim) {
                const k = sim.monsters.indexOf(m);
                if (k >= 0) sim.monsters.splice(k, 1);
            }
            clientMonsters.delete(m.id);
        }
    }
    if (state.mode === 'playing' || state.mode === 'over') {
        updateCamera(dt);
        updateHud(dt);
    }
}

const perf = { frames: 0, time: 0, lowered: 0 };
function lowerQuality() {
    perf.lowered += 1;
    perf.frames = 0;
    perf.time = 0;
    if (perf.lowered === 1) renderer.setPixelRatio(1);
    else if (perf.lowered === 2) {
        renderer.shadowMap.enabled = false;
        setMonsterShadows(false);
        scene.traverse((o) => {
            if (o.material) o.material.needsUpdate = true;
        });
    }
}

function loop() {
    requestAnimationFrame(loop);
    const raw = clock.getDelta();
    const dt = Math.min(raw, 0.05);
    if (state.mode === 'ready') {
        lib.update(clock.elapsedTime, dt, { bookLife: 1, portalPower: [0.5, 0.5, 0.5, 0.5] });
        fx.update(dt);
        stage.update(dt, clock.elapsedTime);
        renderer.render(scene, camera);
        return;
    }
    if (state.mode === 'loading') return;
    const solo = !team.on;
    if (!(solo && !$('pauseScreen').classList.contains('hidden'))) update(dt);
    renderer.render(scene, camera);
    if (state.mode === 'playing' && perf.lowered < 2) {
        perf.frames += 1;
        perf.time += raw;
        if (perf.time > 4) {
            if (perf.time / perf.frames > 1 / 28) lowerQuality();
            else perf.lowered = perf.lowered || 0;
            perf.frames = 0;
            perf.time = 0;
        }
    }
}

// ------------------------------------------------------------------ the lobby (party, invites, ready)
const esc = (t) => String(t).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
function avatarColor(name) {
    let h = 0;
    for (const ch of String(name)) h = (h * 31 + ch.charCodeAt(0)) % 360;
    return `hsl(${h}, 62%, 52%)`;
}
function myMember() {
    return net.party ? net.party.members.find((m) => m.name === net.me) : null;
}
const GAME_NAMES = { arena: 'קרב באי', defense: 'הגנה על הספרייה' };
function goToGame(game) {
    const url = game === 'arena' ? '../arena/index.html' : '../defense/index.html';
    window.location.href = url + window.location.search;
}

function renderLobby() {
    if (state.mode !== 'ready') return;
    const online = net.status === 'online' && net.party;
    const party = online ? net.party : null;
    const members = party
        ? [...party.members].sort((a, b) => (a.name === net.me ? -1 : b.name === net.me ? 1 : 0))
        : [{ name: 'את/ה', ready: false, skin: skinFromUrl() }];
    const n = members.length;
    stage.setMembers(members.map((m) => ({ ...m, me: party ? m.name === net.me : true, leader: party ? party.leader === m.name && n > 1 : false })), { canInvite: Boolean(online) });
    $('partyCount').textContent = `${n}/4`;
    $('lobbyMode').textContent = n === 1 ? 'סולו' : n === 2 ? 'זוג' : n === 3 ? 'שלישייה' : 'רביעייה';
    const rows = members.map((m) => {
        const crown = party && party.leader === m.name && n > 1 ? ' ♛' : '';
        const where = party && m.game && m.game !== party.game ? ` · ב${GAME_NAMES[m.game] || 'משחק אחר'}` : '';
        return `<li><span class="av" style="background:${avatarColor(m.name)}">${esc(m.name.charAt(0))}</span><span class="nm">${esc(m.name)}${crown}${party && m.name === net.me ? ' (את/ה)' : ''}${where}</span><span class="st ${m.ready ? 'ok' : ''}">${m.ready ? 'מוכן' : 'ממתין'}</span></li>`;
    });
    if (party) party.invited.forEach((name) => rows.push(`<li><span class="av" style="background:#475569">${esc(name.charAt(0))}</span><span class="nm">${esc(name)}</span><span class="st wait">הוזמן</span></li>`));
    $('partyList').innerHTML = rows.join('');
    $('leaveBtn').classList.toggle('hidden', !party || n < 2);
    $('inviteForm').classList.toggle('hidden', !online);
    $('drawerOffline').classList.toggle('hidden', Boolean(online));
    const me = myMember();
    const ready = Boolean(me && me.ready);
    const btn = $('readyBtn');
    btn.classList.toggle('is-ready', ready);
    $('readyLabel').textContent = ready ? 'מוכן ✓ · ביטול' : 'מוכן להגן';
    btn.disabled = net.status === 'connecting';
    let hint = n === 1 ? 'לחצו "מוכן" כדי להתחיל להגן על הספרייה' : '';
    if (party && n > 1) {
        const waiting = party.members.filter((m) => !m.ready).map((m) => (m.name === net.me ? 'לך' : `ל${esc(m.name)}`));
        const notIn = party.members.filter((m) => !m.inArena).map((m) => m.name);
        if (notIn.length) hint = `מחכים ש-${notIn.map(esc).join(', ')} יפתחו את המשחק<span class="dots"></span>`;
        else if (waiting.length) hint = `מתחילים כשכולם מוכנים · מחכים ${waiting.join(', ')}<span class="dots"></span>`;
        else hint = 'כולם מוכנים - להגנה!';
    }
    $('readyHint').innerHTML = hint;
    // the party plays the other game: offer to switch
    const sw = $('switchGame');
    if (party && party.game && party.game !== 'defense') {
        sw.textContent = `הקבוצה שלך ב${GAME_NAMES[party.game] || 'משחק אחר'} - לעבור לשם ↩`;
        sw.classList.remove('hidden');
        btn.disabled = true;
    } else sw.classList.add('hidden');
    const note = $('netNote');
    if (net.replaced) {
        note.textContent = 'המשחק נפתח בחלון אחר עם אותו משתמש - אפשר לשחק רק באחד';
        note.classList.remove('hidden');
    } else if (net.status === 'offline') {
        note.textContent = 'משחק לבד - אין חיבור לשרת של הספרייה';
        note.classList.remove('hidden');
    } else if (net.status === 'connecting') {
        note.textContent = 'מתחבר...';
        note.classList.remove('hidden');
    } else note.classList.add('hidden');
}

function openDrawer(focus) {
    const d = $('partyDrawer');
    d.classList.add('open');
    d.setAttribute('aria-hidden', 'false');
    if (focus && !$('inviteForm').classList.contains('hidden')) setTimeout(() => $('inviteName').focus(), 120);
}
function closeDrawer() {
    $('partyDrawer').classList.remove('open');
    $('partyDrawer').setAttribute('aria-hidden', 'true');
}

const incoming = new Map();
function showInvite(msg) {
    if (incoming.has(msg.partyId)) return;
    const card = document.createElement('div');
    card.className = 'lb-inv';
    const game = GAME_NAMES[msg.game] || GAME_NAMES.defense;
    card.innerHTML = `<span class="av" style="background:${avatarColor(msg.from)}">${esc(msg.from.charAt(0))}</span>`
        + `<div class="tx"><b>${esc(msg.from)}</b>מזמין/ה אותך ל${game} (${msg.size}/4)</div>`
        + '<div class="bt"><button class="yes" type="button">הצטרפות</button><button class="no" type="button">לא עכשיו</button></div><i class="timer"></i>';
    const done = () => {
        card.remove();
        incoming.delete(msg.partyId);
    };
    card.querySelector('.yes').addEventListener('click', () => {
        net.send({ type: 'accept', partyId: msg.partyId });
        done();
    });
    card.querySelector('.no').addEventListener('click', () => {
        net.send({ type: 'decline', partyId: msg.partyId });
        done();
    });
    $('incoming').appendChild(card);
    incoming.set(msg.partyId, card);
    setTimeout(done, 60000);
    if (state.mode !== 'ready') toast(`${iconSVG('people', 16)} <b>${esc(msg.from)}</b> הזמין/ה אותך - אפשר להצטרף אחרי המשחק`, 6000);
    else audio.chime();
}

function setupLobby() {
    net.on('status', renderLobby);
    net.on('party', renderLobby);
    net.on('invite', showInvite);
    net.on('inviteResult', (m) => {
        const msg = $('inviteMsg');
        msg.classList.toggle('err', !m.ok);
        msg.textContent = m.ok ? `ההזמנה נשלחה ל-${m.to} ✓` : m.error;
    });
    net.on('joined', (m) => toast(`${iconSVG('people', 16)} <b>${esc(m.username)}</b> הצטרף/ה לקבוצה`));
    net.on('joinedParty', (m) => {
        if (m.game && m.game !== 'defense' && state.mode === 'ready') goToGame(m.game);
    });
    net.on('declined', (m) => toast(`<b>${esc(m.username)}</b> לא יכול/ה עכשיו`));
    net.on('error', (m) => toast(esc(m.error)));
    net.on('left', (m) => {
        if (state.mode === 'playing') teammateLeft(m.username);
        else if (!m.game) toast(`<b>${esc(m.username)}</b> יצא/ה מהקבוצה`);
    });
    net.on('start', (m) => {
        if (m.game && m.game !== 'defense') return;
        startMatch({ seed: m.seed, host: m.host, members: m.members, me: net.me });
    });
    net.on('net', (m) => onTeamMessage(m.from, m.data));

    $('inviteForm').addEventListener('submit', (e) => {
        e.preventDefault();
        const name = $('inviteName').value.trim();
        if (!name) return;
        net.send({ type: 'invite', to: name });
        $('inviteName').value = '';
        $('inviteMsg').classList.remove('err');
        $('inviteMsg').textContent = 'שולח...';
    });
    $('leaveBtn').addEventListener('click', () => {
        net.send({ type: 'leave' });
        closeDrawer();
    });
    $('partyBtn').addEventListener('click', () => ($('partyDrawer').classList.contains('open') ? closeDrawer() : openDrawer(true)));
    $('drawerClose').addEventListener('click', closeDrawer);
    $('lobbyLabels').addEventListener('invite-click', () => openDrawer(true));
    $('helpBtn').addEventListener('click', () => $('helpModal').classList.remove('hidden'));
    $('helpModal').addEventListener('click', (e) => {
        if (e.target === $('helpModal') || e.target.closest('[data-close]')) $('helpModal').classList.add('hidden');
    });
    $('switchGame').addEventListener('click', () => {
        if (net.party && net.party.game) goToGame(net.party.game);
    });
    $('readyBtn').addEventListener('click', async () => {
        await audio.init();
        soundIcons();
        if (net.status === 'online' && net.party) {
            const me = myMember();
            net.send({ type: 'ready', ready: !(me && me.ready) });
        } else {
            startMatch({ seed: 1, host: 'me', members: ['me'], me: 'me' });
        }
    });
    const best = bestFromUrl();
    if (best) {
        $('bestLine').textContent = `השיא שלך: גל ${best}`;
        $('bestLine').classList.remove('hidden');
    }
    net.connect(skinFromUrl());
    renderLobby();
}

// ------------------------------------------------------------------ start
async function init() {
    fillIcons();
    resize();
    try {
        await load();
    } catch (err) {
        console.error(err);
        $('loadingText').textContent = 'לא הצלחנו לטעון את המשחק. נסו לרענן את הדף.';
        return;
    }
    resize();
    $('loadingScreen').classList.add('hidden');
    $('lobby').classList.remove('hidden');
    state.mode = 'ready';
    setupLobby();
    clock.getDelta();
    loop();
}

// For automated tests: add ?debug to the address.
if (params.has('debug')) {
    window.__defense = {
        state, team, keys, mouse, net,
        get player() { return player; },
        get sim() { return sim; },
        get lib() { return lib; },
        monsters: monstersNow,
        drops,
        step: (dt) => update(dt),
        setView: (y, p) => { yaw = y; pitch = p; },
        startMatch, endMatch, doUpgrade, interact, fireWeapon, throwGrenade, giveWeapon, damagePlayer,
        renderer, scene, camera,
    };
}

init();
