/**
 * קרב באי (Island Battle) - a battle royale against bots, alone or as a team
 * of up to 4 friends (each on their own computer).
 *
 * In the lobby you invite friends by name and press "ready"; then everyone
 * falls from the sky onto a big island, opens the glider, lands, finds
 * weapons and chests, keeps away from the storm - and the last one (or the
 * last team) standing wins. Coins are saved to your account by the library site.
 *
 * Team matches: the party leader's computer runs the bots, the storm and the
 * loot and sends them to the others; every player runs their own character
 * and sends where they are, what they hold and what they shoot.
 *
 * Original game written for the Hillel library site. Models and sounds:
 * Kenney (CC0). 3D engine: three.js (MIT).
 */
import * as THREE from 'three';
import { GLTFLoader } from '../../shared/lib/loaders/GLTFLoader.js';
import { applySkin, skinFromUrl } from '../../shared/skins.js';
import { createBridge } from '../../shared/bridge.js';
import { createWorld, POIS, makeRng } from './world.js';
import { WEAPONS, RARITIES, AMMO, makeWeapon } from './weapons.js';
import { createActor, refreshWeaponVisual, updateActorVisual, currentWeapon, currentItem, applyDamage, rayHitsActor, playAction } from './actors.js';
import { createLoot, COIN_VALUE } from './loot.js';
import { HEALS, isHeal, healSlot, healUseful, applyHeal } from './heals.js';
import { createStorm } from './storm.js';
import { createEffects, fire, tickWeapon, startReload, muzzlePosition } from './combat.js';
import { moveActor, GLIDER_CLOSE_MIN } from './movement.js';
import { createBotController } from './bots.js';
import { createHud } from './hud.js';
import { createAudio } from './audio.js';
import { createLobby } from './lobby.js';
import { createNet } from './net.js';

const BOT_COUNT = 19; // solo; a team gets a few more (the server says how many)
// coins: every coin on the map is worth COIN_VALUE, plus rewards for
// eliminations, for winning, for a good place and for staying alive
const KILL_COINS = 50;
const WIN_COINS = 300;
const PLACE_BONUS = [[3, 150], [5, 80], [10, 30]]; // top 3 / top 5 / top 10
const SURVIVE_EVERY = 5;                            // +1 coin per 5 seconds alive
const BOT_NAMES = ['נועה', 'איתי', 'מאיה', 'יונתן', 'תמר', 'אורי', 'ליה', 'דניאל', 'שירה', 'עומר', 'הדר', 'רון', 'גאיה', 'אלון', 'טל', 'יעל', 'נדב', 'אביב', 'רוני'];
const TINTS = [0xff8a8a, 0x8ab4ff, 0x9dff8a, 0xffe08a, 0xd28aff, 0x8afff0, 0xffb38a, 0xff8ad8, 0xb8ff8a, 0xa0a0ff];
const GLIDER_COLORS = [0xef4444, 0x3b82f6, 0x22c55e, 0xf59e0b, 0xa855f7, 0x06b6d4, 0xec4899, 0x84cc16];

const $ = (id) => document.getElementById(id);
const touchMode = window.matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;

// ------------------------------------------------------------- renderer
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
$('world').appendChild(renderer.domElement);

const scene = new THREE.Scene();
const FOG = new THREE.Color(0xc9e6ff);
scene.background = FOG;
scene.fog = new THREE.Fog(FOG, 170, 820);

// things past the fog aren't drawn at all
const camera = new THREE.PerspectiveCamera(70, 1, 0.1, 1100);

// sky: a gradient dome
{
    const sky = new THREE.Mesh(
        new THREE.SphereGeometry(700, 32, 16), // inside the view distance (also in low quality)
        new THREE.ShaderMaterial({
            side: THREE.BackSide,
            depthWrite: false,
            fog: false,
            uniforms: { top: { value: new THREE.Color(0x3d8fe0) }, horizon: { value: new THREE.Color(0xd6eeff) } },
            vertexShader: 'varying vec3 vPos; void main() { vPos = (modelMatrix * vec4(position, 1.0)).xyz; gl_Position = projectionMatrix * viewMatrix * vec4(vPos, 1.0); }',
            fragmentShader: 'uniform vec3 top; uniform vec3 horizon; varying vec3 vPos; void main() { float h = clamp(normalize(vPos - cameraPosition).y * 1.6, 0.0, 1.0); gl_FragColor = vec4(mix(horizon, top, h), 1.0); }',
        })
    );
    sky.onBeforeRender = () => sky.position.copy(camera.position);
    scene.add(sky);
}

scene.add(new THREE.HemisphereLight(0xffffff, 0x6b8a5a, 1.45));
const sun = new THREE.DirectionalLight(0xfff2dc, 2.4);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.left = -55;
sun.shadow.camera.right = 55;
sun.shadow.camera.top = 55;
sun.shadow.camera.bottom = -55;
sun.shadow.camera.near = 1;
sun.shadow.camera.far = 220;
sun.shadow.bias = -0.0006;
sun.shadow.normalBias = 0.03;
scene.add(sun);
scene.add(sun.target);

let lobby = null;
let characterGltf = null;

function resize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    if (lobby) lobby.resize(w, h);
}
window.addEventListener('resize', resize);
resize();

// ------------------------------------------------------------- state
const state = {
    mode: 'loading', // loading | ready | playing | paused | over
    time: 0,
    place: 0,
    bigMap: false,
    lastPoi: null,
    hudT: 0,
    earn: { kills: 0, place: 0, survive: 0 },
};

const net = createNet();
// the team match (when you play with friends); team.on is false when alone
const team = {
    on: false, host: true, me: '', hostName: '', members: [], remotes: new Map(),
    sendT: 0, snapT: 0, shots: [], botShots: [], ev: { d: [], k: [], o: [] }, spectate: null,
};

let world;
let loot;
let storm;
let hud;
let player;
let bots = [];
let actors = [];
let botBrain;
const effects = createEffects(scene);
const audio = createAudio();
let combatCtx;

const bridge = createBridge('arena', {
    getRunCoins: () => (player ? player.coins : 0),
    onSaved: (info) => {
        const note = $('savedNote');
        note.classList.remove('hidden', 'warn');
        if (info.error) {
            note.textContent = 'לא הצלחנו לשמור את המטבעות הפעם';
            note.classList.add('warn');
        } else {
            note.textContent = `+${info.earned} מטבעות נשמרו בחשבון · יש לך ${info.coins.toLocaleString()}`;
        }
    },
});

// ------------------------------------------------------------- loading
async function load() {
    const loader = new GLTFLoader();
    const files = {
        character: '../jumper/models/character.glb',
        coin: '../jumper/models/coin.glb',
        cloud: '../jumper/models/cloud.glb',
        buildingA: '../runner/models/city/building-small-a.glb',
        buildingB: '../runner/models/city/building-small-b.glb',
        buildingC: '../runner/models/city/building-small-c.glb',
        buildingD: '../runner/models/city/building-small-d.glb',
        garage: '../runner/models/city/building-garage.glb',
        fountain: './models/city/pavement-fountain.glb',
        truckRed: '../runner/models/racing/vehicle-truck-red.glb',
        truckGreen: '../runner/models/racing/vehicle-truck-green.glb',
        truckYellow: '../runner/models/racing/vehicle-truck-yellow.glb',
        truckPurple: '../runner/models/racing/vehicle-truck-purple.glb',
    };
    const models = {};
    let done = 0;
    const entries = Object.entries(files);
    await Promise.all(entries.map(async ([k, url]) => {
        const g = await loader.loadAsync(url);
        models[k] = k === 'character' ? g : g.scene;
        done += 1;
        $('loadingText').textContent = `בונה את האי... ${Math.round((done / (entries.length + 2)) * 100)}%`;
    }));
    // give the "building the island" text a chance to show
    await new Promise((r) => setTimeout(r, 30));
    world = createWorld(scene, models, { grass: !new URLSearchParams(window.location.search).has('lowgfx') });
    $('loadingText').textContent = 'מפזר שלל...';
    await new Promise((r) => setTimeout(r, 30));

    // coins glow a little
    models.coin.traverse((c) => {
        if (c.isMesh) {
            c.material = c.material.clone();
            c.material.emissive = new THREE.Color(0x8a5a00);
            c.material.emissiveIntensity = 0.5;
        }
    });
    loot = createLoot({ scene, world, coinModel: models.coin, audio });
    // (the loot is spread when the match starts: in a team everyone uses the same seed)
    storm = createStorm(scene, world);
    hud = createHud(world);

    // clouds
    for (let i = 0; i < 70; i++) {
        const c = new THREE.Group();
        for (let j = 0; j < 4; j++) {
            const puff = models.cloud.clone(true);
            puff.scale.setScalar(5 + Math.random() * 6);
            puff.position.set((j - 2) * 6 + Math.random() * 3, Math.random() * 3, Math.random() * 6);
            puff.traverse((ch) => {
                if (ch.isMesh) {
                    ch.material = ch.material.clone();
                    ch.material.emissive = new THREE.Color(0xffffff);
                    ch.material.emissiveIntensity = 0.5;
                }
            });
            c.add(puff);
        }
        c.position.set((Math.random() - 0.5) * 1200, 150 + Math.random() * 70, (Math.random() - 0.5) * 1200);
        c.userData.speed = 1 + Math.random() * 2;
        scene.add(c);
        clouds.push(c);
    }

    characterGltf = models.character;
    lobby = createLobby({ renderer, gltf: models.character, labels: $('lobbyLabels') });
    lobby.resize(window.innerWidth, window.innerHeight);
}
const clouds = [];
const killLog = [];

const TEAM_GLIDERS = [0xfacc15, 0x22d3ee, 0xf472b6, 0xa3e635];

// cfg: { seed, host, members: [names], bots, me } - the same on every computer of the team
function createActors(gltf, cfg) {
    const rng = makeRng(cfg.seed);
    const myIndex = Math.max(0, cfg.members.indexOf(cfg.me));
    // the whole team jumps from the same spot, side by side
    const spawnR = 60 + rng() * 200;
    const a0 = rng() * Math.PI * 2;
    const cx = Math.cos(a0) * spawnR;
    const cz = Math.sin(a0) * spawnR;
    const faceYaw = Math.atan2(-cx, -cz); // facing the middle of the island
    const spawnAt = (actor, i) => {
        const off = (i - (cfg.members.length - 1) / 2) * 4;
        actor.pos.set(cx - Math.cos(faceYaw) * off, 280, cz + Math.sin(faceYaw) * off);
        actor.yaw = faceYaw;
    };
    const teamName = team.on ? 'humans' : null;
    player = createActor({ scene, gltf, name: team.on ? cfg.me : 'אתה', isPlayer: true, team: teamName, gliderColor: TEAM_GLIDERS[myIndex % 4] });
    player.skin = applySkin({ model: player.model, scene, skinId: skinFromUrl(), height: 1.76 });
    player.netName = cfg.me;
    spawnAt(player, myIndex);
    giveStarterKit(player);
    actors = [player];

    // teammates on the other computers
    const skins = Object.fromEntries(((net.party && net.party.members) || []).map((m) => [m.name, m.skin]));
    cfg.members.forEach((name, i) => {
        if (name === cfg.me) return;
        const r = createActor({ scene, gltf, name, human: true, team: teamName, gliderColor: TEAM_GLIDERS[i % 4] });
        r.netName = name;
        r.skin = applySkin({ model: r.model, scene, skinId: skins[name] || '', height: 1.76 });
        spawnAt(r, i);
        giveStarterKit(r);
        r.net = { x: r.pos.x, y: r.pos.y, z: r.pos.z, vx: 0, vy: 0, vz: 0, yaw: r.yaw, pitch: 0, at: 0 };
        team.remotes.set(name, r);
        actors.push(r);
    });

    botBrain = createBotController({
        world, loot, storm,
        get actors() { return actors; },
        get time() { return state.time; },
        startUse,
        get combat() { return combatCtx; },
    });
    for (let i = 0; i < cfg.bots; i++) {
        const bot = createActor({
            scene, gltf,
            tint: TINTS[i % TINTS.length],
            gliderColor: GLIDER_COLORS[i % GLIDER_COLORS.length],
            name: `בוט ${BOT_NAMES[i % BOT_NAMES.length]}${i >= BOT_NAMES.length ? ` ${Math.floor(i / BOT_NAMES.length) + 1}` : ''}`,
        });
        giveStarterKit(bot);
        botBrain.initBot(bot);
        // start in the sky not too far from where the bot wants to land
        const a = Math.random() * Math.PI * 2;
        const r = 40 + Math.random() * 110;
        bot.pos.set(bot.ai.landing.x + Math.cos(a) * r, 250 + Math.random() * 50, bot.ai.landing.z + Math.sin(a) * r);
        if (!team.host) {
            // the leader's computer moves the bots: wait for where they really are
            bot.root.visible = false;
            bot.net = null;
        }
        bots.push(bot);
        actors.push(bot);
    }
    actors.forEach((a) => updateActorVisual(a, 0, camera));

    // the loot: the same seed on every computer gives the same items with the same ids
    loot.spawnInitial(makeRng((cfg.seed ^ 0x5bd1e995) >>> 0));
    loot.setIdPrefix(`${myIndex}:`);

    combatCtx = {
        world,
        get actors() { return actors; },
        effects,
        audio,
        listener: player.pos,
        get time() { return state.time; },
        onHit,
        damage: team.on ? teamDamage : null,
        onShot: team.on ? teamShot : null,
    };
}

function giveStarterKit(actor) {
    actor.slots[0] = makeWeapon('pistol', 0);
    actor.ammo.light = 32;
    actor.current = 0;
    refreshWeaponVisual(actor);
}

// ------------------------------------------------------------- healing
// Heals are in the inventory: select the slot and hold fire to use one.
function startUse(actor, heal) {
    if (actor.using || !healUseful(actor, heal)) return false;
    const cur = currentItem(actor);
    const slot = cur && cur.heal === heal ? actor.current : healSlot(actor, heal);
    if (slot < 0) return false;
    if (slot !== actor.current) {
        actor.current = slot;
        refreshWeaponVisual(actor);
    }
    actor.reloadT = 0;
    actor.using = { heal, slot, t: 0, total: HEALS[heal].time };
    return true;
}

function tickUse(actor, dt) {
    const u = actor.using;
    if (!u) return;
    const stack = actor.slots[u.slot];
    // switched to another slot, or threw it away: cancelled
    if (u.slot !== actor.current || !stack || stack.heal !== u.heal) {
        actor.using = null;
        return;
    }
    u.t += dt;
    if (u.t < u.total) return;
    actor.using = null;
    applyHeal(actor, u.heal);
    stack.count -= 1;
    if (stack.count <= 0) {
        actor.slots[u.slot] = null;
        refreshWeaponVisual(actor);
    }
    if (actor.isPlayer) audio.play('coin', { volume: 0.4, rate: 0.7 });
}

// ------------------------------------------------------------- hits and eliminations
function onHit(shooter, target, dmg, head, killed, point, shieldHit) {
    if (shooter.isPlayer) {
        hud.damageNumber(point, dmg, head, shieldHit);
        hud.hitmarker(head, killed);
        audio.play('enemy_hurt', { volume: 0.35, rate: head ? 1.4 : 1.1 });
    }
    if (target.isPlayer) {
        hud.hurt();
    }
    if (killed) eliminate(target, shooter);
}

// opts.remote: this elimination happened on another computer (its drops come over the network)
function eliminate(victim, killer, cause, opts = {}) {
    // (applyDamage already marks a killed actor as not alive - so use our own flag)
    if (victim.eliminated) return;
    victim.eliminated = true;
    victim.alive = false;
    victim.dieT = 0;
    victim.using = null;
    if (!opts.remote) loot.dropAll(victim);
    victim.slots = [null, null, null, null, null];
    refreshWeaponVisual(victim);
    if (victim.isPlayer) hud.prompt(null);
    playAction(victim, 'idle', 0.1);

    const gun = killer && currentWeapon(killer);
    const how = opts.how || (cause === 'storm' ? 'הסערה' : gun ? WEAPONS[gun.kind].name : '');
    const k = killer ? `<b class="${killer.isPlayer ? 'me' : ''}">${killer.name}</b>` : '';
    const v = `<b class="${victim.isPlayer ? 'me' : ''}">${victim.name}</b>`;
    const whom = victim.isPlayer ? '<b class="me">אותך</b>' : `את ${v}`;
    hud.feed(cause === 'storm' ? `${v} נבלע בסערה` : `${k} חיסל ${whom} <span class="gun">(${how})</span>`);

    if (killer) killer.kills += 1;
    killLog.push({ t: Math.round(state.time), killer: killer ? killer.name : cause, victim: victim.name, dist: killer ? Math.round(killer.pos.distanceTo(victim.pos)) : 0, gun: how });
    if (killer && killer.isPlayer) {
        player.coins += KILL_COINS;
        state.earn.kills += KILL_COINS;
        hud.message(`חיסלת את ${victim.name} · +${KILL_COINS} מטבעות`, 'kill');
        audio.play('eliminate', { volume: 0.7 });
    }
    if (team.on) {
        // tell the team; the leader reports the bots, everyone reports themselves
        if (team.host && !victim.human && !opts.remote) net.relay({ t: 'kill', v: refOf(victim), k: refOf(killer), c: cause || '', how });
        if (victim.isPlayer) net.relay({ t: 'pdead', k: refOf(killer), c: cause || '', how });
        if (victim.human && team.spectate === victim) team.spectate = null;
        checkTeamEnd();
        return;
    }
    const alive = actors.filter((a) => a.alive).length;
    if (victim.isPlayer) {
        state.place = alive + 1;
        endMatch(false);
    } else if (alive === 1 && player.alive) {
        state.place = 1;
        endMatch(true);
    }
}

function endMatch(won) {
    if (state.mode === 'over') return;
    state.mode = 'over';
    $('spectateBar').classList.add('hidden');
    $('pauseScreen').classList.add('hidden');
    if (team.on) net.send({ type: 'matchOver' });
    // end-of-match rewards
    const placeBonus = (PLACE_BONUS.find(([top]) => state.place <= top) || [0, 0])[1];
    const survive = Math.floor(state.time / SURVIVE_EVERY);
    player.coins += placeBonus + survive;
    state.earn.place = placeBonus + (won ? WIN_COINS : 0);
    state.earn.survive = survive;
    if (won) {
        player.coins += WIN_COINS;
        // (the number of wins is kept on the server, in your account)
    }
    if (document.pointerLockElement) document.exitPointerLock();
    $('endTitle').textContent = won ? (team.on ? 'הקבוצה ניצחה! 🏆' : 'ניצחת! 🏆')
        : state.endNote === 'hostLeft' ? 'הקרב הסתיים' : team.on ? 'הקבוצה הודחה' : 'הודחת!';
    $('endPlace').textContent = `#${state.place}`;
    $('endKills').textContent = player.kills;
    $('endCoins').textContent = player.coins;
    const e = state.earn;
    $('endBreakdown').innerHTML = `<span>🪙 איסוף ${player.coins - e.kills - e.place - e.survive}</span><span>🎯 חיסולים ${e.kills}</span><span>🏅 מקום ${e.place}</span><span>⏱️ שרידות ${e.survive}</span>`;
    const m = Math.floor(state.time / 60);
    $('endTime').textContent = `${m}:${Math.floor(state.time % 60).toString().padStart(2, '0')}`;
    const note = $('savedNote');
    note.classList.toggle('hidden', !bridge.embedded || player.coins === 0);
    note.classList.remove('warn');
    note.textContent = 'שומר את המטבעות בחשבון...';
    bridge.runEnded(player.coins, { won });
    hud.message(won ? (team.on ? 'ניצחתם! הקבוצה שלכם האחרונה שנשארה!' : 'ניצחת! אתה האחרון שנשאר!') : `הודחת · מקום ${state.place}`, won ? 'loot' : 'kill');
    setTimeout(() => $('endScreen').classList.remove('hidden'), won ? 1800 : 1400);
}


// ------------------------------------------------------------- team matches
const PHASES = ['sky', 'glide', 'ground'];
const r2 = (v) => Math.round(v * 100) / 100;

// who is who over the network: 'u:<username>' for people, 'b<index>' for bots
function refOf(a) {
    if (!a) return '';
    if (a.human) return `u:${a.netName}`;
    const i = bots.indexOf(a);
    return i >= 0 ? `b${i}` : '';
}
function actorOf(ref) {
    if (!ref) return null;
    if (ref.startsWith('u:')) {
        const n = ref.slice(2);
        return n === team.me ? player : team.remotes.get(n) || null;
    }
    if (ref[0] === 'b') return bots[Number(ref.slice(1))] || null;
    return null;
}
function itemKey(it) {
    if (!it) return '';
    return isHeal(it) ? `h:${it.heal}` : `${it.kind}:${it.rarity}`;
}
// your whole inventory (so a teammate watching you sees your items)
function inventoryState(a) {
    return {
        k: a.slots.map(itemKey),
        n: a.slots.map((it) => (!it ? 0 : isHeal(it) ? it.count : it.ammoInMag)),
        c: a.current,
        a: [a.ammo.light, a.ammo.medium, a.ammo.shells, a.ammo.heavy],
    };
}
function applyInventory(a, inv) {
    const sig = JSON.stringify(inv);
    if (sig === a.invSig) return;
    a.invSig = sig;
    a.slots = inv.k.map((k, i) => {
        const it = itemFromKey(k);
        if (it && isHeal(it)) it.count = inv.n[i];
        else if (it) it.ammoInMag = inv.n[i];
        return it;
    });
    a.current = Math.max(0, Math.min(4, inv.c | 0));
    [a.ammo.light, a.ammo.medium, a.ammo.shells, a.ammo.heavy] = inv.a;
    a.netItem = itemKey(a.slots[a.current]);
    refreshWeaponVisual(a);
}

function itemFromKey(k) {
    if (!k) return null;
    if (k.startsWith('h:')) return HEALS[k.slice(2)] ? { heal: k.slice(2), count: 1 } : null;
    const [kind, r] = k.split(':');
    return WEAPONS[kind] ? { kind, rarity: Number(r) || 0, ammoInMag: 1 } : null;
}
function actorState(a) {
    const flags = (a.aiming ? 1 : 0) | (a.moving ? 2 : 0) | (a.using ? 4 : 0) | (a.onGround ? 8 : 0) | (a.reloadT > 0 ? 16 : 0);
    return [r2(a.pos.x), r2(a.pos.y), r2(a.pos.z), r2(a.vel.x), r2(a.vel.y), r2(a.vel.z), r2(a.yaw), r2(a.pitch),
        PHASES.indexOf(a.phase), itemKey(currentItem(a)), Math.round(a.hp), Math.round(a.shield), flags];
}

// a character run by another computer (a teammate, or a bot when you're not the leader)
function applyActorState(a, st) {
    a.net = a.net || {};
    Object.assign(a.net, { x: st[0], y: st[1], z: st[2], vx: st[3], vy: st[4], vz: st[5], yaw: st[6], pitch: st[7], at: performance.now() });
    const phase = PHASES[st[8]] || 'ground';
    if (a.phase !== 'ground' && phase === 'ground') a.justLanded = 'hard';
    if (!a.netSeen) {
        a.pos.set(st[0], st[1], st[2]);
        a.yaw = st[6];
        a.netSeen = true;
        a.root.visible = true;
    }
    a.phase = phase;
    a.glider.visible = phase === 'glide';
    if (st[9] !== a.netItem && !a.invSig) {
        a.netItem = st[9];
        a.slots = [itemFromKey(st[9]), null, null, null, null];
        a.current = 0;
        refreshWeaponVisual(a);
    }
    a.hp = st[10];
    a.shield = st[11];
    const f = st[12];
    a.aiming = Boolean(f & 1);
    a.moving = Boolean(f & 2);
    a.onGround = Boolean(f & 8);
    a.using = f & 4 ? a.using || { heal: '', t: 0, total: 1 } : null;
    if (f & 16 && !(a.reloadT > 0)) a.reloadT = 1.2;
    if (!(f & 16)) a.reloadT = 0;
}

function angleLerp(a, b, k) {
    let d = b - a;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    return a + d * k;
}

// glide smoothly toward the last known position (guessing ahead a little)
function moveRemote(a, dt) {
    const n = a.net;
    if (!n || !a.netSeen) return;
    const age = Math.min(0.25, (performance.now() - n.at) / 1000);
    const tx = n.x + n.vx * age;
    const ty = n.y + n.vy * age;
    const tz = n.z + n.vz * age;
    const k = Math.min(1, dt * 12);
    if (Math.abs(tx - a.pos.x) + Math.abs(tz - a.pos.z) > 15) a.pos.set(tx, ty, tz);
    else {
        a.pos.x += (tx - a.pos.x) * k;
        a.pos.y += (ty - a.pos.y) * k;
        a.pos.z += (tz - a.pos.z) * k;
    }
    a.vel.set(n.vx, n.vy, n.vz);
    a.yaw = angleLerp(a.yaw, n.yaw, k);
    a.pitch += (n.pitch - a.pitch) * k;
    if (a.phase !== 'ground' || !a.onGround) playAction(a, 'jump', 0.15);
    else if (a.moving) {
        playAction(a, 'walk', 0.12);
        if (a.currentAction) a.currentAction.timeScale = Math.hypot(n.vx, n.vz) / 3.2;
    } else playAction(a, 'idle', 0.15);
    if (a.reloadT > 0) a.reloadT = Math.max(0.01, a.reloadT - dt);
}

// shots fired on another computer: flash, tracers and the sound
function remoteShot(a, ends) {
    if (!a || !a.alive || !a.netSeen) return;
    const w = currentWeapon(a);
    const def = w ? WEAPONS[w.kind] : WEAPONS.pistol;
    const muzzle = muzzlePosition(a, new THREE.Vector3());
    effects.flash(muzzle, def.pellets > 1 ? 1.1 : 0.7);
    for (const e of ends) effects.tracer(muzzle, new THREE.Vector3(e[0], e[1], e[2]));
    audio.shot(def.sound, def.pitch, player ? player.pos.distanceTo(muzzle) : 0);
    if (a.fx) a.fx.recoil = Math.min(1, 0.55 + def.recoil * 9);
}

// combat hook: remember shots to tell the others
function teamShot(actor, ends) {
    const list = ends.map((p) => [r2(p.x), r2(p.y), r2(p.z)]);
    if (actor.isPlayer) team.shots.push(...list);
    else if (team.host && !actor.human && list.length) team.botShots.push([bots.indexOf(actor), ...list[0]]);
}

// combat hook: whose computer applies this damage?
function teamDamage(shooter, target, dmg, head) {
    if (target.isPlayer) return applyDamage(target, dmg); // a bot (on the leader's computer) hit you
    if (target.human) {
        // a bot hit a teammate: their own computer takes the damage
        if (team.host && !shooter.human) net.relay({ t: 'dmg', d: Math.round(dmg * 10) / 10, k: refOf(shooter) }, target.netName);
        if (target.fx) target.fx.flinch = 1;
        return false;
    }
    // a bot was hit: the leader keeps the bots' health
    if (team.host) return applyDamage(target, dmg);
    if (shooter.isPlayer) net.relay({ t: 'hit', b: bots.indexOf(target), d: Math.round(dmg * 10) / 10 }, team.hostName);
    if (target.fx) target.fx.flinch = Math.min(1, 0.4 + dmg / 60);
    return false;
}

function setupTeamHooks() {
    loot.hooks.created = (it) => team.ev.d.push(loot.itemSpec(it));
    loot.hooks.taken = (id, left) => team.ev.k.push([id, left]);
    loot.hooks.opened = (chest) => team.ev.o.push(chest.index);
}

// send what's going on: your character ~15 times a second; the leader also sends the bots and the storm
function teamTick(dt) {
    team.sendT -= dt;
    if (team.sendT <= 0) {
        team.sendT = 1 / 15;
        if (player.alive) net.relay({ t: 'p', s: actorState(player), sh: team.shots.splice(0, 12), inv: inventoryState(player) });
    }
    if (team.host) {
        team.snapT -= dt;
        if (team.snapT <= 0) {
            team.snapT = 1 / 12;
            net.relay({ t: 's', b: bots.map((b) => (b.alive ? actorState(b) : 0)), st: storm.snapshot(), sh: team.botShots.splice(0, 40) });
        }
    }
    const ev = team.ev;
    if (ev.d.length || ev.k.length || ev.o.length) {
        net.relay({ t: 'ev', o: ev.o.splice(0), d: ev.d.splice(0, 60), k: ev.k.splice(0) });
    }
    for (const r of team.remotes.values()) if (r.alive) moveRemote(r, dt);
    if (!team.host) for (const b of bots) if (b.alive) moveRemote(b, dt);
}

function onTeamMessage(from, d) {
    if (!d || !team.on || !player) return;
    switch (d.t) {
        case 'p': {
            const r = team.remotes.get(from);
            if (!r || !r.alive) return;
            applyActorState(r, d.s);
            if (d.inv) applyInventory(r, d.inv);
            if (d.sh && d.sh.length) remoteShot(r, d.sh);
            return;
        }
        case 's': {
            if (from !== team.hostName) return;
            d.b.forEach((st, i) => {
                const b = bots[i];
                if (b && st && b.alive) applyActorState(b, st);
            });
            if (d.st) storm.applySnapshot(d.st);
            (d.sh || []).forEach(([i, x, y, z]) => remoteShot(bots[i], [[x, y, z]]));
            return;
        }
        case 'ev': {
            (d.o || []).forEach((i) => {
                const c = loot.chests[i];
                if (c) loot.openChest(c, false);
            });
            (d.d || []).forEach((spec) => loot.fromSpec(spec));
            (d.k || []).forEach(([id, left]) => loot.takenRemote(id, left));
            return;
        }
        case 'open': {
            // a teammate opened a chest: the leader decides what's inside
            if (!team.host) return;
            const c = loot.chests[d.c];
            if (c && !c.opened) loot.openChest(c);
            return;
        }
        case 'hit': {
            // a teammate hit a bot
            if (!team.host) return;
            const b = bots[d.b];
            const shooter = team.remotes.get(from);
            if (!b || !b.alive || !shooter) return;
            b.lastHitBy = shooter;
            b.lastHitAt = state.time;
            b.healthBarT = 3;
            if (b.fx) b.fx.flinch = Math.min(1, 0.4 + d.d / 60);
            if (applyDamage(b, d.d)) eliminate(b, shooter);
            return;
        }
        case 'dmg': {
            // a bot hit you (on the leader's computer)
            if (!player.alive || state.mode !== 'playing') return;
            const killer = actorOf(d.k);
            player.lastHitBy = killer;
            player.lastHitAt = state.time;
            hud.hurt();
            if (player.fx) player.fx.flinch = 1;
            if (applyDamage(player, d.d)) eliminate(player, killer);
            return;
        }
        case 'kill': {
            if (team.host) return;
            const v = actorOf(d.v);
            if (!v || !v.alive) return;
            eliminate(v, actorOf(d.k), d.c || undefined, { remote: true, how: d.how });
            return;
        }
        case 'pdead': {
            const r = team.remotes.get(from);
            if (!r || !r.alive) return;
            eliminate(r, actorOf(d.k), d.c || undefined, { remote: true, how: d.how });
            return;
        }
        case 'win': {
            if (!team.host) {
                state.place = 1;
                endMatch(true);
            }
            return;
        }
        default:
    }
}

// is the match over for the team?
function checkTeamEnd() {
    if (state.mode === 'over') return;
    const humansAlive = [player, ...team.remotes.values()].filter((a) => a.alive && !a.gone);
    const botsAlive = bots.filter((b) => b.alive).length;
    if (humansAlive.length === 0) {
        state.place = botsAlive + 1;
        endMatch(false);
        return;
    }
    if (team.host && botsAlive === 0) {
        net.relay({ t: 'win' });
        state.place = 1;
        endMatch(true);
        return;
    }
    if (!player.alive) startSpectating();
}

// out of the match, but the team plays on: watch a teammate
function startSpectating() {
    const alive = [...team.remotes.values()].filter((r) => r.alive && !r.gone);
    team.spectate = alive[0] || null;
    $('spectateBar').classList.toggle('hidden', !team.spectate);
    if (team.spectate) $('spectateText').textContent = `הודחת · צופה ב-${team.spectate.netName} · אם הקבוצה תנצח - גם את/ה מנצח/ת!`;
}

function teammateLeft(name) {
    const r = team.remotes.get(name);
    if (!r || r.gone || state.mode !== 'playing') return;
    r.gone = true;
    if (r.alive) {
        r.alive = false;
        r.root.visible = false;
    }
    hud.feed(`<b>${name}</b> יצא מהמשחק`);
    if (name === team.hostName && !team.host) {
        // the leader's computer ran the bots: this match can't go on
        hud.message('מוביל/ת הקבוצה יצא/ה - הקרב הסתיים', 'storm');
        state.place = bots.filter((b) => b.alive).length + 1;
        state.endNote = 'hostLeft';
        endMatch(false);
        return;
    }
    checkTeamEnd();
}

// teammates: names over their heads, and their health in the corner
const teamTagEls = new Map();
const tagPos = new THREE.Vector3();
function updateTeamHud() {
    if (!team.on) return;
    const holder = $('teamTags');
    for (const r of team.remotes.values()) {
        let el = teamTagEls.get(r);
        if (!el) {
            el = document.createElement('div');
            el.className = 'team-tag';
            el.textContent = r.netName;
            holder.appendChild(el);
            teamTagEls.set(r, el);
        }
        tagPos.copy(r.pos);
        tagPos.y += 2.5;
        tagPos.project(camera);
        const show = r.alive && r.netSeen && tagPos.z < 1 && Math.abs(tagPos.x) < 1.1 && Math.abs(tagPos.y) < 1.1;
        el.style.display = show ? '' : 'none';
        if (show) el.style.transform = `translate(${(tagPos.x * 0.5 + 0.5) * window.innerWidth}px, ${(-tagPos.y * 0.5 + 0.5) * window.innerHeight}px) translate(-50%, -100%)`;
    }
}
function updateTeamPanel() {
    if (!team.on) return;
    const html = [...team.remotes.values()].map((r) => {
        const dead = !r.alive;
        return `<div class="mate${dead ? ' dead' : ''}">${r.netName}${r.gone ? ' (יצא)' : ''}<div class="bars"><i class="sh" style="width:${dead ? 0 : r.shield}%"></i><i class="hp" style="width:${dead ? 0 : r.hp}%"></i></div></div>`;
    }).join('');
    const panel = $('teamPanel');
    if (panel.innerHTML !== html) panel.innerHTML = html;
}

// ------------------------------------------------------------- input
const keys = {};
const mouse = { left: false, right: false, clicked: false };
let yaw = 0;
let pitch = -0.15;

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
    if (k === 'Space' && player.phase !== 'ground') state.toggleGlider = true;
    if (k.startsWith('Digit')) {
        const n = Number(k.slice(5)) - 1;
        if (n >= 0 && n < 5) selectSlot(n);
    } else if (k === 'KeyE') interact();
    else if (k === 'KeyR') startReload(player);
    else if (k === 'KeyQ') throwItem();
    else if (k === 'KeyM') state.bigMap = !state.bigMap;
});
window.addEventListener('keyup', (e) => { keys[e.code] = false; });

renderer.domElement.addEventListener('mousedown', (e) => {
    if (state.mode === 'paused' || state.softPause) {
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
    // slower turning when zoomed in, so the scope is steady
    const sens = 0.0022 * (scopeOn() ? (WEAPONS[currentWeapon(player).kind].zoom || 16) / 64 : player.aiming ? 0.6 : 1);
    yaw -= e.movementX * sens;
    pitch -= e.movementY * sens;
    pitch = Math.max(-1.25, Math.min(1.1, pitch));
});
window.addEventListener('wheel', (e) => {
    if (state.mode !== 'playing') return;
    cycleSlot(e.deltaY > 0 ? 1 : -1);
});

document.addEventListener('pointerlockchange', () => {
    if (!locked() && state.mode === 'playing' && !touchMode && !state.softPause) pause();
});
window.addEventListener('blur', () => {
    if (state.mode === 'playing' && !touchMode) pause();
});
document.addEventListener('visibilitychange', () => {
    if (document.hidden && state.mode === 'playing') pause();
});

function pause() {
    mouse.left = false;
    mouse.right = false;
    Object.keys(keys).forEach((k) => { keys[k] = false; });
    $('pauseScreen').classList.remove('hidden');
    // with friends the match can't stop: just show the menu while the game goes on
    if (team.on) {
        state.softPause = true;
        return;
    }
    state.mode = 'paused';
}

function resume() {
    if (state.softPause) {
        state.softPause = false;
        $('pauseScreen').classList.add('hidden');
        requestLock();
        return;
    }
    if (state.mode !== 'paused') return;
    state.mode = 'playing';
    $('pauseScreen').classList.add('hidden');
    requestLock();
    clock.getDelta();
}
$('resumeBtn').addEventListener('click', resume);

function selectSlot(i) {
    if (i === player.current) return;
    player.current = i;
    player.reloadT = 0;
    player.using = null;
    refreshWeaponVisual(player);
    audio.play('weapon_change', { volume: 0.4 });
}

function cycleSlot(dir) {
    for (let k = 1; k <= 5; k++) {
        const i = (player.current + dir * k + 50) % 5;
        if (player.slots[i]) {
            selectSlot(i);
            return;
        }
    }
}

function interact() {
    const near = loot.nearestInteractable(player.pos, 2.6);
    if (!near) return;
    if (near.kind === 'chest') {
        if (team.on && !team.host) {
            // the leader's computer decides what's inside (so everyone sees the same loot)
            const c = near.obj;
            if (!c.askedAt || performance.now() - c.askedAt > 1000) {
                c.askedAt = performance.now();
                net.relay({ t: 'open', c: c.index }, team.hostName);
            }
            return;
        }
        loot.openChest(near.obj);
        hud.message('תיבה נפתחה!', 'loot');
        return;
    }
    const it = near.obj;
    const label = it.type === 'heal' ? `${HEALS[it.heal].name} ×${it.count}` : `${WEAPONS[it.weapon.kind].name} ${RARITIES[it.weapon.rarity].name}`;
    const slot = loot.takeWeapon(player, it, player.current);
    if (slot >= 0 && slot !== player.current) selectSlot(slot);
    player.using = null;
    refreshWeaponVisual(player);
    audio.play('weapon_change', { volume: 0.5 });
    hud.message(label, 'loot');
}

/** Q: throw what's in your hand on the floor in front of you. */
function throwItem() {
    const it = currentItem(player);
    if (!it || player.phase !== 'ground') return;
    player.using = null;
    player.reloadT = 0;
    const fx = Math.sin(yaw);
    const fz = Math.cos(yaw);
    const from = player.pos.clone().add(new THREE.Vector3(fx * 0.7, 1.2, fz * 0.7));
    const dropped = loot.dropSlotItem(from, it, new THREE.Vector3(fx * 4.5, 3.5, fz * 4.5));
    if (dropped) dropped.noAuto = player;
    player.slots[player.current] = null;
    refreshWeaponVisual(player);
    audio.play('weapon_change', { volume: 0.4, rate: 0.8 });
    hud.message(`זרקת: ${isHeal(it) ? HEALS[it.heal].name : WEAPONS[it.kind].name}`);
}

// ---- touch controls
const touch = { stick: null, moveX: 0, moveZ: 0, look: null, fire: false };
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
    // drag anywhere else to look around
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
    hold('tJump', () => {
        keys.Space = true;
        if (player.phase !== 'ground') state.toggleGlider = true;
    }, () => { keys.Space = false; });
    hold('tUse', interact);
    hold('tReload', () => startReload(player));
    hold('tDrop', throwItem);
    hold('tNext', () => cycleSlot(1));
}

// The library page can pause or restart the game.
window.addEventListener('message', (e) => {
    if (e.origin !== window.location.origin) return;
    const msg = e.data && e.data.type;
    if (msg === 'pause' && state.mode === 'playing') pause();
    else if (msg === 'restart' && state.mode !== 'loading') {
        bridge.runEnded(player ? player.coins : 0);
        window.location.reload();
    }
});

// back to the lobby (the party is kept on the server)
$('againBtn').addEventListener('click', () => window.location.reload());
$('spectateExit').addEventListener('click', () => {
    state.place = bots.filter((b) => b.alive).length + 1;
    endMatch(false);
});
$('muteBtn').addEventListener('click', (e) => {
    e.stopPropagation();
    const m = audio.toggleMute();
    $('iconSoundOn').classList.toggle('hidden', m);
    $('iconSoundOff').classList.toggle('hidden', !m);
});

function soundIcons() {
    $('iconSoundOn').classList.toggle('hidden', audio.muted);
    $('iconSoundOff').classList.toggle('hidden', !audio.muted);
}

// cfg: { seed, host, members, bots, me } (from the server for a party, or made up when alone)
function startMatch(cfg) {
    if (state.mode !== 'ready') return;
    team.on = cfg.members.length > 1;
    team.host = !team.on || cfg.host === cfg.me;
    team.me = cfg.me;
    team.hostName = cfg.host;
    team.members = cfg.members;
    createActors(characterGltf, cfg);
    if (team.on) setupTeamHooks();
    $('lobby').classList.add('hidden');
    $('hud').classList.remove('hidden');
    $('muteBtn').classList.remove('hidden');
    $('credits').classList.add('hidden');
    $('teamPanel').classList.toggle('hidden', !team.on);
    soundIcons();
    state.mode = 'playing';
    yaw = player.yaw;
    pitch = -0.5;
    requestLock();
    bridge.runStarted();
    hud.message(team.on ? 'צונחים יחד! רווח פותח את הגליידר · לחצו על המסך כדי לשלוט' : 'קפצת! כוונו לנקודת נחיתה · רווח פותח את הגליידר', 'loot');
    clock.getDelta();
}

// ------------------------------------------------------------- the lobby
function myMember() {
    return net.party ? net.party.members.find((m) => m.name === net.me) : null;
}

function toast(html, cls = '', ms = 5000) {
    const div = document.createElement('div');
    div.className = `toast ${cls}`;
    div.innerHTML = html;
    $('toasts').appendChild(div);
    if (ms) setTimeout(() => div.remove(), ms);
    return div;
}

const esc = (t) => String(t).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// a colour for someone's avatar circle (the same name always gets the same colour)
function avatarColor(name) {
    let h = 0;
    for (const ch of String(name)) h = (h * 31 + ch.charCodeAt(0)) % 360;
    return `hsl(${h}, 62%, 52%)`;
}

function renderLobby() {
    const online = net.status === 'online' && net.party;
    const party = online ? net.party : null;
    const members = party
        ? [...party.members].sort((a, b) => (a.name === net.me ? -1 : b.name === net.me ? 1 : 0))
        : [{ name: 'את/ה', ready: false, skin: skinFromUrl() }];
    const n = members.length;
    lobby.setMembers(members.map((m) => ({ ...m, me: party ? m.name === net.me : true, leader: party ? party.leader === m.name && n > 1 : false })), { canInvite: Boolean(online) });
    $('partyCount').textContent = `${n}/4`;
    $('lobbyMode').textContent = n === 1 ? 'סולו' : n === 2 ? 'זוג' : n === 3 ? 'שלישייה' : 'רביעייה';
    // the drawer: members, invited, invite form
    const rows = members.map((m) => {
        const crown = party && party.leader === m.name && n > 1 ? ' ♛' : '';
        return `<li><span class="av" style="background:${avatarColor(m.name)}">${esc(m.name.charAt(0))}</span><span class="nm">${esc(m.name)}${crown}${party && m.name === net.me ? ' (את/ה)' : ''}</span><span class="st ${m.ready ? 'ok' : ''}">${m.ready ? 'מוכן' : 'ממתין'}</span></li>`;
    });
    if (party) party.invited.forEach((name) => rows.push(`<li><span class="av" style="background:#475569">${esc(name.charAt(0))}</span><span class="nm">${esc(name)}</span><span class="st wait">הוזמן</span></li>`));
    $('partyList').innerHTML = rows.join('');
    $('leaveBtn').classList.toggle('hidden', !party || n < 2);
    $('inviteForm').classList.toggle('hidden', !online);
    $('drawerOffline').classList.toggle('hidden', Boolean(online));
    // the ready button and the line above it
    const me = myMember();
    const btn = $('readyBtn');
    const ready = Boolean(me && me.ready);
    btn.classList.toggle('is-ready', ready);
    $('readyLabel').textContent = ready ? 'מוכן ✓ · ביטול' : 'מוכן';
    btn.disabled = net.status === 'connecting';
    let hint = n === 1 ? 'לחצו "מוכן" כדי לצנוח לאי' : '';
    if (party && n > 1) {
        const waiting = party.members.filter((m) => !m.ready).map((m) => (m.name === net.me ? 'לך' : `ל${esc(m.name)}`));
        const notIn = party.members.filter((m) => !m.inArena).map((m) => m.name);
        if (notIn.length) hint = `מחכים ש-${notIn.map(esc).join(', ')} יפתחו את המשחק<span class="dots"></span>`;
        else if (waiting.length) hint = `צונחים יחד כשכולם מוכנים · מחכים ${waiting.join(', ')}<span class="dots"></span>`;
        else hint = 'כולם מוכנים - צונחים!';
    }
    const bots = BOT_COUNT + 4 * (n - 1);
    $('readyHint').innerHTML = `${hint}${hint ? ' · ' : ''}${bots} בוטים`;
    const note = $('netNote');
    if (net.status === 'offline') {
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

// an invite from a friend: a card slides in at the top (with a 60-second timer)
const incoming = new Map(); // partyId -> card element
function showInvite(msg) {
    if (incoming.has(msg.partyId)) return;
    const card = document.createElement('div');
    card.className = 'lb-inv';
    card.innerHTML = `<span class="av" style="background:${avatarColor(msg.from)}">${esc(msg.from.charAt(0))}</span>`
        + `<div class="tx"><b>${esc(msg.from)}</b>מזמין/ה אותך לשחק יחד (${msg.size}/4)</div>`
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
    if (state.mode !== 'ready') toast(`📨 <b>${esc(msg.from)}</b> הזמין/ה אותך - אפשר להצטרף אחרי הקרב`, 'invite', 6000);
    else if (audio.chime) audio.chime();
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
    net.on('joined', (m) => toast(`🎉 <b>${esc(m.username)}</b> הצטרף/ה לקבוצה`));
    net.on('party', () => {
        // you just joined someone: show the team
        if (net.party && net.party.members.length > 1 && !state.shownParty) {
            state.shownParty = true;
        }
    });
    net.on('declined', (m) => toast(`<b>${esc(m.username)}</b> לא יכול/ה עכשיו`));
    net.on('error', (m) => toast(esc(m.error)));
    net.on('left', (m) => {
        if (state.mode === 'playing') teammateLeft(m.username);
        else if (!m.game) toast(`<b>${esc(m.username)}</b> יצא/ה מהקבוצה`);
    });
    net.on('start', (m) => startMatch({ seed: m.seed, host: m.host, members: m.members, bots: m.bots, me: net.me }));
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
    $('readyBtn').addEventListener('click', async () => {
        await audio.init();
        soundIcons();
        if (net.status === 'online' && net.party) {
            const me = myMember();
            net.send({ type: 'ready', ready: !(me && me.ready) });
        } else {
            // no server: a solo match
            startMatch({ seed: Math.floor(Math.random() * 2 ** 31), host: 'me', members: ['me'], bots: BOT_COUNT, me: 'me' });
        }
    });
    net.connect(skinFromUrl());
    renderLobby();
}

// ------------------------------------------------------------- the game loop
const clock = new THREE.Clock();
const tmpV = new THREE.Vector3();
const camForward = new THREE.Vector3();
const camRight = new THREE.Vector3();
const pivot = new THREE.Vector3();
const desiredCam = new THREE.Vector3();
let camDist = 3.6;
let fov = 70;

function scopeOn() {
    const w = currentWeapon(player);
    return player.aiming && w && WEAPONS[w.kind].scope;
}

function updatePlayer(dt) {
    // aim with the right mouse button (on foot, with a gun)
    const w = currentWeapon(player);
    player.aiming = mouse.right && player.phase === 'ground' && Boolean(w) && player.alive;
    player.yaw = yaw;
    player.pitch = pitch;

    // move relative to where the camera looks
    let fwd = (keys.KeyW || keys.ArrowUp ? 1 : 0) - (keys.KeyS || keys.ArrowDown ? 1 : 0);
    let side = (keys.KeyD || keys.ArrowRight ? 1 : 0) - (keys.KeyA || keys.ArrowLeft ? 1 : 0);
    if (touchMode) {
        fwd += touch.moveZ;
        side += touch.moveX;
    }
    const fx = Math.sin(yaw);
    const fz = Math.cos(yaw);
    // forward = (sin yaw, cos yaw), right = (-cos yaw, sin yaw)
    let mx = fx * fwd - fz * side;
    let mz = fz * fwd + fx * side;
    const len = Math.hypot(mx, mz);
    if (len > 1) {
        mx /= len;
        mz /= len;
    }
    const input = { x: mx, z: mz, jump: Boolean(keys.Space) && player.phase === 'ground', toggleGlider: Boolean(state.toggleGlider) };
    state.toggleGlider = false;
    const ev = moveActor(player, world, input, dt);
    if (ev === 'jump') audio.play('jump_a', { volume: 0.35 });
    if (ev === 'landed') audio.play('land', { volume: 0.5 });
    if (ev === 'glider') hud.message('הגליידר נפתח!', 'loot');
    if (ev === 'freefall') hud.message('נפילה חופשית!', 'loot');
    if (ev === 'landed' && player.phase === 'ground' && !state.landed) {
        state.landed = true;
        hud.message('נחתת! מצאו נשקים ותיבות', 'loot');
    }

    tickWeapon(player, dt);
    tickUse(player, dt);

    // holding heals: fire = use one (keep holding to use the next)
    const held = currentItem(player);
    if (player.phase === 'ground' && isHeal(held) && (mouse.left || mouse.clicked) && !player.using) {
        if (!startUse(player, held.heal) && mouse.clicked) {
            hud.message(held.heal.includes('Shield') ? 'המגן מלא' : 'הבריאות מלאה');
        }
    }

    // shooting
    if (player.phase === 'ground' && w && (mouse.left || mouse.clicked)) {
        const def = WEAPONS[w.kind];
        if (def.auto ? mouse.left : mouse.clicked) {
            if (player.using) player.using = null;
            shootFromCamera();
        }
    }
    mouse.clicked = false;

    loot.autoPickup(player, (it) => {
        if (it.type === 'coin') {
            audio.play('coin', { volume: 0.3 });
            effects.sparkle(it.pos.clone().add(new THREE.Vector3(0, 0.6, 0)));
            hud.floatText(it.pos.clone().add(new THREE.Vector3(0, 1.2, 0)), `+${COIN_VALUE}`, 'coin');
        }
        else if (it.type === 'ammo') {
            audio.play('weapon_change', { volume: 0.3, rate: 1.3 });
        } else if (it.type === 'heal') {
            audio.play('coin', { volume: 0.3, rate: 0.8 });
            hud.message(`נאסף: ${HEALS[it.heal].name}`, 'loot');
            refreshWeaponVisual(player);
        }
    });

    // the prompt for E (on foot) / the glider hint (in the air)
    const near = player.phase === 'ground' ? loot.nearestInteractable(player.pos, 2.6) : null;
    if (player.phase === 'sky') hud.prompt('<kbd>רווח</kbd> פתיחת הגליידר');
    else if (player.phase === 'glide') {
        const h = player.pos.y - world.supportHeight(player.pos.x, player.pos.z, player.pos.y);
        hud.prompt(h > GLIDER_CLOSE_MIN ? '<kbd>רווח</kbd> סגירת הגליידר (נפילה חופשית)' : null);
    } else if (near) {
        const full = player.slots.every(Boolean);
        if (near.kind === 'chest') hud.prompt('<kbd>E</kbd> פתיחת תיבה');
        else if (near.kind === 'heal') {
            const it = near.obj;
            hud.prompt(`<kbd>E</kbd> ${full && healSlot(player, it.heal) < 0 ? 'החלפה ל' : 'איסוף '}${HEALS[it.heal].name} ×${it.count}`);
        } else {
            const it = near.obj.weapon;
            const r = RARITIES[it.rarity];
            hud.prompt(`<kbd>E</kbd> ${full ? 'החלפה ל' : 'איסוף '}<span style="color:${r.color}">${WEAPONS[it.kind].name} ${r.name}</span>`);
        }
    } else hud.prompt(null);

    // where am I?
    const poi = world.poiAt(player.pos.x, player.pos.z);
    if (poi && poi !== state.lastPoi && player.phase === 'ground') hud.location(poi.name);
    if (poi || player.phase === 'ground') state.lastPoi = poi;
}

const aimDir = new THREE.Vector3();
function shootFromCamera() {
    // what's under the crosshair?
    camera.getWorldDirection(camForward);
    let dist = world.raycast(camera.position, camForward, 400);
    for (const a of actors) {
        if (a === player || !a.alive) continue;
        const h = rayHitsActor(a, camera.position, camForward, dist);
        if (h) dist = h.dist;
    }
    const aimPoint = tmpV.copy(camera.position).addScaledVector(camForward, dist);
    // the bullet starts at the player's chest and goes to that point
    const origin = player.pos.clone();
    origin.y += 1.35;
    aimDir.subVectors(aimPoint, origin);
    if (aimDir.lengthSq() < 0.5) aimDir.copy(camForward);
    aimDir.normalize();
    if (fire(player, origin, aimDir, combatCtx)) {
        const def = WEAPONS[currentWeapon(player).kind];
        pitch = Math.min(1.1, pitch + def.recoil * (player.aiming ? 0.55 : 1));
        yaw += (Math.random() - 0.5) * def.recoil * 0.4;
    }
}

function updateCamera(dt) {
    // out of the match but the team plays on: follow a teammate
    const focus = !player.alive && team.spectate && team.spectate.alive ? team.spectate : player;
    const sky = focus.phase !== 'ground';
    const scope = scopeOn();
    const targetDist = sky ? 9 : player.aiming ? 2.1 : 3.7;
    const shoulder = sky ? 0 : player.aiming ? 0.7 : 0.85;
    camDist = THREE.MathUtils.lerp(camDist, targetDist, Math.min(1, dt * 10));
    // wider view while falling fast (feels faster), zoom when aiming
    const targetFov = scope ? WEAPONS[currentWeapon(player).kind].zoom || 16 : player.aiming ? 52 : player.phase === 'sky' ? 84 : 70;
    fov = THREE.MathUtils.lerp(fov, targetFov, Math.min(1, dt * 14));
    if (Math.abs(camera.fov - fov) > 0.01) {
        camera.fov = fov;
        camera.updateProjectionMatrix();
    }

    camForward.set(Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch));
    camRight.set(-Math.cos(yaw), 0, Math.sin(yaw));
    pivot.copy(focus.pos);
    pivot.y += sky ? 1.2 : 1.65;
    // landing: the camera dips and springs back
    state.camDip = Math.max(0, (state.camDip || 0) - dt * 1.6);
    pivot.y -= Math.sin(Math.min(1, state.camDip / 0.45) * Math.PI) * state.camDip * 0.8;
    pivot.addScaledVector(camRight, shoulder);
    desiredCam.copy(pivot).addScaledVector(camForward, -camDist);
    desiredCam.y += sky ? 1.5 : 0.25;
    // don't let walls get between the camera and the player
    tmpV.subVectors(desiredCam, pivot);
    const want = tmpV.length();
    tmpV.normalize();
    const free = world.raycast(pivot, tmpV, want);
    camera.position.copy(pivot).addScaledVector(tmpV, Math.max(0.4, free - 0.3));
    if (scope) camera.position.copy(player.pos).add(new THREE.Vector3(0, 1.55, 0)).addScaledVector(camForward, 0.3);
    camera.lookAt(tmpV.copy(camera.position).add(camForward));
    player.root.visible = !scope;
    hud.scope(Boolean(scope));
}

function stormDamage(dt) {
    const dps = storm.state.dps;
    for (const a of actors) {
        if (!a.alive || a.phase !== 'ground') continue;
        // in a team, everyone's own computer does their storm damage (the leader does the bots')
        if (team.on && !a.isPlayer && (a.human || !team.host)) continue;
        if (!storm.isOutside(a.pos)) continue;
        // the storm goes straight to health (shields don't help)
        a.stormAcc = (a.stormAcc || 0) + dt;
        if (a.stormAcc >= 1) {
            a.stormAcc -= 1;
            a.hp -= dps;
            a.healthBarT = 2;
            if (a.isPlayer) {
                hud.hurt();
                hud.damageNumber(a.pos.clone().add(new THREE.Vector3(0, 2, 0)), dps, false, false);
            }
            if (a.hp <= 0) {
                a.hp = 0;
                eliminate(a, null, 'storm');
            }
        }
    }
}

// bounce out: 0..1 -> 0..1 with a couple of small bounces at the end
function easeOutBounce(x) {
    const n = 7.5625;
    const d = 2.75;
    if (x < 1 / d) return n * x * x;
    if (x < 2 / d) return n * (x -= 1.5 / d) * x + 0.75;
    if (x < 2.5 / d) return n * (x -= 2.25 / d) * x + 0.9375;
    return n * (x -= 2.625 / d) * x + 0.984375;
}

function updateDeadActor(a, dt) {
    if (a.dieT === undefined || a.dieT > 3) return;
    if (a.dieT === 0) a.dieSpin = (Math.random() - 0.5) * 1.2;
    a.dieT += dt;
    // a little hop, then fall over backwards with a bounce, then vanish in a puff
    const k = Math.min(1, a.dieT * 1.6);
    a.model.rotation.x = -easeOutBounce(k) * Math.PI / 2;
    a.model.rotation.z = a.dieSpin * k;
    a.root.position.y = a.pos.y + Math.max(0, Math.sin(Math.min(1, a.dieT * 3.2) * Math.PI)) * 0.6;
    a.root.rotation.y = a.yaw + a.dieSpin * 0.5 * k;
    if (a.glider) a.glider.visible = false;
    if (a.dieT > 2.2 && !a.puffed) {
        a.puffed = true;
        effects.burst(a.pos, a.isPlayer ? 0xfacc15 : 0xc4b5fd);
    }
    if (a.dieT > 2.2) a.root.scale.setScalar(Math.max(0.001, 1 - (a.dieT - 2.2) / 0.35));
    if (a.dieT > 2.6) a.root.visible = false;
}

function updateHud(dt) {
    state.hudT -= dt;
    // watching a teammate: show their health and their items
    const view = !player.alive && team.spectate && team.spectate.alive ? team.spectate : player;
    hud.setBars(view);
    if (state.hudT <= 0) {
        state.hudT = 0.2;
        hud.setSlots(view);
        hud.stats(actors.filter((a) => a.alive).length, player.kills, player.coins);
        hud.storm(storm.status(), player.alive && player.phase === 'ground' && storm.isOutside(player.pos));
        hud.minimap(view, storm, [...team.remotes.values()].filter((r) => r !== view));
        hud.bigMap(state.bigMap, view, storm);
        updateTeamPanel();
    }
    const w = currentWeapon(player);
    const def = w ? WEAPONS[w.kind] : null;
    let spread = def ? (player.aiming ? def.adsSpread : def.spread) : 0;
    if (player.moving) spread *= 1.4;
    if (!player.onGround) spread *= 1.8;
    const px = def ? Math.min(60, (spread / Math.tan((camera.fov * Math.PI) / 360)) * (window.innerHeight / 2)) + 3 : 8;
    hud.crosshair(player.phase === 'ground' && w ? w.kind : null, player.aiming, px);
    if (player.using) hud.progress(player.using.t / player.using.total, HEALS[player.using.heal].name);
    else if (player.reloadT > 0 && w) hud.progress(1 - player.reloadT / WEAPONS[w.kind].reload, 'טוען...');
    else hud.progress(null);
    hud.updateNumbers(dt, camera, window.innerWidth, window.innerHeight);
    // wind streaks while dropping fast
    hud.speedLines(player.alive && player.phase === 'sky' ? Math.min(1, Math.max(0, (-player.vel.y - 12) / 18)) : 0);
}

function update(dt) {
    const t = clock.elapsedTime;
    world.update(t);
    effects.update(dt);
    clouds.forEach((c) => {
        c.position.x += c.userData.speed * dt;
        if (c.position.x > 650) c.position.x = -650;
    });

    const runBots = !team.on || team.host;
    if (state.mode === 'playing') {
        state.time += dt;
        if (player.alive) updatePlayer(dt);
        if (runBots) {
            for (const b of bots) {
                if (!b.alive) continue;
                botBrain.update(b, dt);
                tickWeapon(b, dt);
                tickUse(b, dt);
            }
        }
        if (team.on) teamTick(dt);
        const ev = storm.update(dt, t, camera.position);
        if (ev === 'shrink') hud.message('הסערה מתכווצת!', 'storm');
        stormDamage(dt);
    } else if (state.mode === 'over') {
        if (runBots) {
            for (const b of bots) {
                if (!b.alive) continue;
                botBrain.update(b, dt);
                tickWeapon(b, dt);
            }
        } else if (team.on) {
            for (const b of bots) if (b.alive) moveRemote(b, dt);
        }
        storm.update(dt, t, camera.position);
    }
    if (state.mode !== 'loading') loot.update(dt, t, camera.position);
    if (player && state.mode !== 'loading') world.updateGrass(player.pos.x, player.pos.z);

    for (const a of actors) {
        // dust when someone lands (and a little dip of the camera for you)
        if (a.justLanded && a.alive) {
            const near = a.pos.distanceToSquared(camera.position) < 90 * 90;
            if (near) effects.dust(a.pos, a.justLanded === 'hard');
            if (a.isPlayer) state.camDip = a.justLanded === 'hard' ? 0.45 : 0.15;
        }
        if (a.alive) updateActorVisual(a, dt, camera, t);
        else updateDeadActor(a, dt);
    }
    if (player && player.skin) player.skin.update(dt, { position: player.root.position, worldVelocity: null, moving: player.moving });

    if (player) {
        if (state.mode === 'ready') {
            // slow orbit over the island behind the start screen
            const a = t * 0.05;
            camera.position.set(Math.cos(a) * 330, 170, Math.sin(a) * 330);
            camera.lookAt(0, 10, 0);
        } else updateCamera(dt);
        if (state.mode === 'playing' || state.mode === 'over') updateHud(dt);
        if (team.on) updateTeamHud();
        sun.position.set(player.pos.x + 40, player.pos.y + 90, player.pos.z + 25);
        sun.target.position.copy(player.pos);
    }
}

// Slow computer? After a few seconds of play, turn off shadows and render
// fewer pixels so the game stays smooth.
const perf = { frames: 0, time: 0, lowered: false };
function lowerQuality() {
    if (perf.lowered) return;
    perf.lowered = true;
    renderer.setPixelRatio(1);
    renderer.shadowMap.enabled = false;
    sun.castShadow = false;
    // no grass, and don't draw quite as far
    if (world) world.setGrass(false);
    camera.far = 760;
    scene.fog.far = 680;
    camera.updateProjectionMatrix();
    scene.traverse((o) => {
        if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => { m.needsUpdate = true; });
    });
    resize();
}
if (new URLSearchParams(window.location.search).has('lowgfx')) lowerQuality();

function loop() {
    const raw = clock.getDelta();
    const dt = Math.min(raw, 0.05);
    if (state.mode === 'ready') {
        // the lobby
        lobby.update(dt, clock.elapsedTime);
        lobby.render();
        requestAnimationFrame(loop);
        return;
    }
    if (state.mode !== 'paused') update(dt);
    renderer.render(scene, camera);
    if (state.mode === 'playing' && !perf.lowered && perf.time < 6) {
        perf.frames += 1;
        perf.time += raw;
        if (perf.time > 4 && perf.time / perf.frames > 1 / 24) lowerQuality();
    }
    requestAnimationFrame(loop);
}

async function init() {
    try {
        await load();
    } catch (err) {
        console.error(err);
        $('loadingText').textContent = 'שגיאה בטעינת המשחק. נסו לרענן את העמוד.';
        return;
    }
    $('loadingScreen').classList.add('hidden');
    $('lobby').classList.remove('hidden');
    state.mode = 'ready';
    setupLobby();
    clock.getDelta();
    loop();
    // in a team match a background tab still has to keep the game going (the leader runs the bots)
    let lastHidden = performance.now();
    setInterval(() => {
        const t = performance.now();
        const elapsed = Math.min(1, (t - lastHidden) / 1000);
        lastHidden = t;
        if (!document.hidden || !team.on || state.mode !== 'playing') return;
        for (let left = elapsed; left > 0; left -= 0.05) update(Math.min(0.05, left));
    }, 250);
}

// Peek inside for automated testing: add ?debug to the address.
if (new URLSearchParams(window.location.search).has('debug')) {
    window.__arena = {
        state,
        get player() { return player; },
        get bots() { return bots; },
        get storm() { return storm; },
        get world() { return world; },
        get loot() { return loot; },
        step: (dt) => update(dt),
        net,
        team,
        startMatch,
        setView: (y, p) => { yaw = y; pitch = p; },
        refresh: (a) => refreshWeaponVisual(a),
        keys,
        mouse,
        renderer,
        scene,
        camera,
        get hud() { return hud; },
        killLog,
    };
}

init();
