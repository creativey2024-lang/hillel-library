/**
 * קרב באי (Island Battle) - a battle royale against 19 bots.
 *
 * Press "צנח!" and you fall from the sky onto a big island, open your
 * glider, land, find weapons and chests, keep away from the storm and be the
 * last one standing. Coins you pick up, 20 per elimination and 100 for a win
 * are saved to your account by the library site.
 *
 * Original game written for the Hillel library site. Models and sounds:
 * Kenney (CC0). 3D engine: three.js (MIT).
 */
import * as THREE from 'three';
import { GLTFLoader } from '../../shared/lib/loaders/GLTFLoader.js';
import { applySkin, skinFromUrl } from '../../shared/skins.js';
import { createBridge } from '../../shared/bridge.js';
import { createWorld, POIS } from './world.js';
import { WEAPONS, RARITIES, AMMO, makeWeapon } from './weapons.js';
import { createActor, refreshWeaponVisual, updateActorVisual, currentWeapon, currentItem, applyDamage, rayHitsActor, playAction } from './actors.js';
import { createLoot } from './loot.js';
import { HEALS, isHeal, healSlot, healUseful, applyHeal } from './heals.js';
import { createStorm } from './storm.js';
import { createEffects, fire, tickWeapon, startReload } from './combat.js';
import { moveActor, GLIDER_CLOSE_MIN } from './movement.js';
import { createBotController } from './bots.js';
import { createHud } from './hud.js';
import { createAudio } from './audio.js';

const BOT_COUNT = 19;
const KILL_COINS = 20;
const WIN_COINS = 100;
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
scene.fog = new THREE.Fog(FOG, 110, 360);

// things past the fog aren't drawn at all
const camera = new THREE.PerspectiveCamera(70, 1, 0.1, 420);

// sky: a gradient dome
{
    const sky = new THREE.Mesh(
        new THREE.SphereGeometry(400, 32, 16),
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
sun.shadow.camera.left = -45;
sun.shadow.camera.right = 45;
sun.shadow.camera.top = 45;
sun.shadow.camera.bottom = -45;
sun.shadow.camera.near = 1;
sun.shadow.camera.far = 220;
sun.shadow.bias = -0.0006;
sun.shadow.normalBias = 0.03;
scene.add(sun);
scene.add(sun.target);

function resize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
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
    world = createWorld(scene, models);
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
    loot.spawnInitial();
    storm = createStorm(scene, world);
    hud = createHud(world);

    // clouds
    for (let i = 0; i < 26; i++) {
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
        c.position.set((Math.random() - 0.5) * 500, 95 + Math.random() * 40, (Math.random() - 0.5) * 500);
        c.userData.speed = 1 + Math.random() * 2;
        scene.add(c);
        clouds.push(c);
    }

    createActors(models.character);
}
const clouds = [];
const killLog = [];

function createActors(gltf) {
    player = createActor({ scene, gltf, name: 'אתה', isPlayer: true, gliderColor: 0xfacc15 });
    player.skin = applySkin({ model: player.model, scene, skinId: skinFromUrl(), height: 1.76 });
    const SPAWN_R = 70 + Math.random() * 50;
    const a0 = Math.random() * Math.PI * 2;
    player.pos.set(Math.cos(a0) * SPAWN_R, 165, Math.sin(a0) * SPAWN_R);
    player.yaw = Math.atan2(-player.pos.x, -player.pos.z); // facing the middle of the island
    giveStarterKit(player);
    actors = [player];

    botBrain = createBotController({
        world, loot, storm,
        get actors() { return actors; },
        get time() { return state.time; },
        startUse,
        get combat() { return combatCtx; },
    });
    for (let i = 0; i < BOT_COUNT; i++) {
        const bot = createActor({
            scene, gltf,
            tint: TINTS[i % TINTS.length],
            gliderColor: GLIDER_COLORS[i % GLIDER_COLORS.length],
            name: `בוט ${BOT_NAMES[i % BOT_NAMES.length]}`,
        });
        const a = Math.random() * Math.PI * 2;
        const r = 40 + Math.random() * 110;
        bot.pos.set(Math.cos(a) * r, 140 + Math.random() * 45, Math.sin(a) * r);
        giveStarterKit(bot);
        botBrain.initBot(bot);
        bots.push(bot);
        actors.push(bot);
    }
    actors.forEach((a) => updateActorVisual(a, 0, camera));

    combatCtx = {
        world,
        get actors() { return actors; },
        effects,
        audio,
        listener: player.pos,
        get time() { return state.time; },
        onHit,
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

function eliminate(victim, killer, cause) {
    victim.alive = false;
    victim.dieT = 0;
    victim.using = null;
    loot.dropAll(victim);
    victim.slots = [null, null, null, null, null];
    refreshWeaponVisual(victim);
    playAction(victim, 'idle', 0.1);

    const gun = killer && currentWeapon(killer);
    const how = cause === 'storm' ? 'הסערה' : gun ? WEAPONS[gun.kind].name : '';
    const k = killer ? `<b class="${killer.isPlayer ? 'me' : ''}">${killer.name}</b>` : '';
    const v = `<b class="${victim.isPlayer ? 'me' : ''}">${victim.name}</b>`;
    hud.feed(cause === 'storm' ? `${v} נבלע בסערה` : `${k} חיסל את ${v} <span class="gun">(${how})</span>`);

    if (killer) killer.kills += 1;
    killLog.push({ t: Math.round(state.time), killer: killer ? killer.name : cause, victim: victim.name, dist: killer ? Math.round(killer.pos.distanceTo(victim.pos)) : 0, gun: how });
    if (killer && killer.isPlayer) {
        player.coins += KILL_COINS;
        hud.message(`חיסלת את ${victim.name} · +${KILL_COINS} מטבעות`, 'kill');
        audio.play('eliminate', { volume: 0.7 });
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
    if (won) {
        player.coins += WIN_COINS;
        // the game list shows how many times you've won
        try {
            const wins = (parseInt(window.localStorage.getItem('hillel_arena_best'), 10) || 0) + 1;
            window.localStorage.setItem('hillel_arena_best', String(wins));
        } catch (e) {
            // storage blocked - no problem
        }
    }
    if (document.pointerLockElement) document.exitPointerLock();
    $('endTitle').textContent = won ? 'ניצחת! 🏆' : 'הודחת!';
    $('endPlace').textContent = `#${state.place}`;
    $('endKills').textContent = player.kills;
    $('endCoins').textContent = player.coins;
    const m = Math.floor(state.time / 60);
    $('endTime').textContent = `${m}:${Math.floor(state.time % 60).toString().padStart(2, '0')}`;
    const note = $('savedNote');
    note.classList.toggle('hidden', !bridge.embedded || player.coins === 0);
    note.classList.remove('warn');
    note.textContent = 'שומר את המטבעות בחשבון...';
    bridge.runEnded(player.coins);
    hud.message(won ? 'ניצחת! אתה האחרון שנשאר!' : `הודחת · מקום ${state.place}`, won ? 'loot' : 'kill');
    setTimeout(() => $('endScreen').classList.remove('hidden'), won ? 1800 : 1400);
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
    if (state.mode === 'paused') {
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
    if (!locked() && state.mode === 'playing' && !touchMode) pause();
});
window.addEventListener('blur', () => {
    if (state.mode === 'playing' && !touchMode) pause();
});
document.addEventListener('visibilitychange', () => {
    if (document.hidden && state.mode === 'playing') pause();
});

function pause() {
    state.mode = 'paused';
    $('pauseScreen').classList.remove('hidden');
    mouse.left = false;
    mouse.right = false;
    Object.keys(keys).forEach((k) => { keys[k] = false; });
}

function resume() {
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

$('againBtn').addEventListener('click', () => window.location.reload());
$('muteBtn').addEventListener('click', (e) => {
    e.stopPropagation();
    const m = audio.toggleMute();
    $('iconSoundOn').classList.toggle('hidden', m);
    $('iconSoundOff').classList.toggle('hidden', !m);
});

$('dropBtn').addEventListener('click', async () => {
    await audio.init();
    $('iconSoundOn').classList.toggle('hidden', audio.muted);
    $('iconSoundOff').classList.toggle('hidden', !audio.muted);
    $('startScreen').classList.add('hidden');
    $('hud').classList.remove('hidden');
    $('muteBtn').classList.remove('hidden');
    $('credits').classList.add('hidden');
    state.mode = 'playing';
    yaw = player.yaw;
    pitch = -0.5;
    requestLock();
    bridge.runStarted();
    hud.message('קפצת! כוונו לנקודת נחיתה · רווח פותח את הגליידר', 'loot');
    clock.getDelta();
});

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
        if (it.type === 'coin') audio.play('coin', { volume: 0.3 });
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
    const sky = player.phase !== 'ground';
    const scope = scopeOn();
    const targetDist = sky ? 9 : player.aiming ? 2.1 : 3.7;
    const shoulder = sky ? 0 : player.aiming ? 0.7 : 0.85;
    camDist = THREE.MathUtils.lerp(camDist, targetDist, Math.min(1, dt * 10));
    const targetFov = scope ? WEAPONS[currentWeapon(player).kind].zoom || 16 : player.aiming ? 52 : 70;
    fov = THREE.MathUtils.lerp(fov, targetFov, Math.min(1, dt * 14));
    if (Math.abs(camera.fov - fov) > 0.01) {
        camera.fov = fov;
        camera.updateProjectionMatrix();
    }

    camForward.set(Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch));
    camRight.set(-Math.cos(yaw), 0, Math.sin(yaw));
    pivot.copy(player.pos);
    pivot.y += sky ? 1.2 : 1.65;
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

function updateDeadActor(a, dt) {
    if (a.dieT === undefined || a.dieT > 3) return;
    a.dieT += dt;
    // fall over, then fade out in a puff
    a.model.rotation.x = -Math.min(1, a.dieT * 2.5) * Math.PI / 2;
    if (a.dieT > 2.2) a.root.scale.setScalar(Math.max(0.001, 1 - (a.dieT - 2.2) / 0.6));
    if (a.dieT > 2.8) a.root.visible = false;
}

function updateHud(dt) {
    state.hudT -= dt;
    hud.setBars(player);
    if (state.hudT <= 0) {
        state.hudT = 0.2;
        hud.setSlots(player);
        hud.stats(actors.filter((a) => a.alive).length, player.kills, player.coins);
        hud.storm(storm.status(), player.alive && player.phase === 'ground' && storm.isOutside(player.pos));
        hud.minimap(player, storm);
        hud.bigMap(state.bigMap, player, storm);
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
}

function update(dt) {
    const t = clock.elapsedTime;
    world.update(t);
    effects.update(dt);
    clouds.forEach((c) => {
        c.position.x += c.userData.speed * dt;
        if (c.position.x > 260) c.position.x = -260;
    });

    if (state.mode === 'playing') {
        state.time += dt;
        if (player.alive) updatePlayer(dt);
        for (const b of bots) {
            if (!b.alive) continue;
            botBrain.update(b, dt);
            tickWeapon(b, dt);
            tickUse(b, dt);
        }
        const ev = storm.update(dt, t);
        if (ev === 'shrink') hud.message('הסערה מתכווצת!', 'storm');
        stormDamage(dt);
    } else if (state.mode === 'over') {
        for (const b of bots) {
            if (!b.alive) continue;
            botBrain.update(b, dt);
            tickWeapon(b, dt);
        }
        storm.update(dt, t);
    }
    if (state.mode !== 'loading') loot.update(dt, t, state.mode === 'ready' ? null : camera.position);

    for (const a of actors) {
        if (a.alive) updateActorVisual(a, dt, camera, t);
        else updateDeadActor(a, dt);
    }
    if (player && player.skin) player.skin.update(dt, { position: player.root.position, worldVelocity: null, moving: player.moving });

    if (player) {
        if (state.mode === 'ready') {
            // slow orbit over the island behind the start screen
            const a = t * 0.05;
            camera.position.set(Math.cos(a) * 150, 85, Math.sin(a) * 150);
            camera.lookAt(0, 5, 0);
        } else updateCamera(dt);
        if (state.mode === 'playing' || state.mode === 'over') updateHud(dt);
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
    scene.traverse((o) => {
        if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => { m.needsUpdate = true; });
    });
    resize();
}
if (new URLSearchParams(window.location.search).has('lowgfx')) lowerQuality();

function loop() {
    const raw = clock.getDelta();
    const dt = Math.min(raw, 0.05);
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
    $('startScreen').classList.remove('hidden');
    state.mode = 'ready';
    clock.getDelta();
    loop();
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
