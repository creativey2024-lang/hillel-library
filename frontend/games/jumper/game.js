/**
 * קפיצה בשמיים (Sky Hop)
 *
 * A side-scrolling "jump over things" runner for the Hillel library site's
 * "משחק" menu.
 *
 * Gameplay is based on the Chrome dinosaur game, "T-Rex Runner"
 * (Copyright (c) 2014 The Chromium Authors, BSD-style license; extracted
 * version https://github.com/wayou/t-rex-runner, BSD 3-Clause - see
 * LICENSE-t-rex-runner.txt): constant forward running that slowly speeds up,
 * a jump whose height depends on how long the button is held, a fast drop,
 * obstacles of different sizes that only come in groups once the speed is
 * high enough, and gaps between obstacles that grow with the speed
 * (min gap, MAX_GAP_COEFFICIENT 1.5, MAX_OBSTACLE_DUPLICATION 2).
 *
 * Modified from the original: rebuilt in 3D with three.js and Kenney's CC0
 * "Starter Kit 3D Platformer" models, sky and sounds; time-based (not
 * frame-based) physics; pits to jump over in addition to obstacles; coins,
 * bonus "?" blocks, springs that launch you into the sky, floating ledges
 * and stepping stones (some fall away), a jetpack, worlds
 * that change from day to sunset to night, power-ups (double jump, shield,
 * coin magnet, double coins), skins from the site's shop, dust
 * and brick-break effects; touch controls; a Hebrew interface; a saved high
 * score; restarting without reloading the page.
 */
import * as THREE from 'three';
import { GLTFLoader } from '../shared/lib/loaders/GLTFLoader.js';
import { applySkin, skinFromUrl } from '../shared/skins.js';
import { POWERUPS, createPowerupMesh, createPowerupHud } from '../shared/powerups.js';
import * as bridgeLib from '../shared/bridge.js';
import { createCoinFx } from '../shared/coinfx.js';

window.__gameBooted = true; // (all the game's files loaded - see index.html)

// (read through the module object, so an older copy of bridge.js on the server
// can't stop the whole game from starting)
const createBridge = bridgeLib.createBridge;
const bestFromUrl = bridgeLib.bestFromUrl || (() => null);

// ---------------------------------------------------------------- settings
// T-Rex Runner values converted from pixels-per-frame (60 fps) to world units
// per second, at roughly 40 px = 1 unit (the dino is ~47 px tall, our
// character ~1.1 units).
const START_SPEED = 9;            // T-Rex SPEED 6
const MAX_SPEED = 19.5;           // T-Rex MAX_SPEED 13
const ACCELERATION = 0.09;        // T-Rex ACCELERATION 0.001 per frame
const CLEAR_TIME = 2.6;           // seconds of empty track at the start (T-Rex CLEAR_TIME 3000 ms)

// Jump: a full press reaches JUMP_HEIGHT; letting go early cuts the jump
// short (T-Rex endJump / DROP_VELOCITY); holding down falls fast
// (SPEED_DROP_COEFFICIENT 3).
const JUMP_HEIGHT = 2.4;
const JUMP_TIME = 0.64;                                  // up and down, full jump
const GRAVITY = (8 * JUMP_HEIGHT) / (JUMP_TIME * JUMP_TIME);
const JUMP_VELOCITY = (4 * JUMP_HEIGHT) / JUMP_TIME;
const DROP_VELOCITY = 6;          // upward speed is capped to this on release
const MIN_JUMP_HEIGHT = 0.75;     // a tap still clears a small brick
const SPEED_DROP_COEFFICIENT = 3;

const GAP_COEFFICIENT = 0.6;      // T-Rex GAP_COEFFICIENT
const MAX_GAP_COEFFICIENT = 1.5;  // T-Rex Obstacle.MAX_GAP_COEFFICIENT
const MAX_OBSTACLE_DUPLICATION = 2;

const GROUND_TOP = 0.55;          // height of the platform surface
const TRACK_DEPTH = 3;
const BRICK = 0.9;                // size of one brick
const SPAWN_AHEAD = 60;           // how far ahead the track is built
const CLEANUP_BEHIND = 25;

const CHARACTER_SCALE = 1.15;
const COIN_SCALE = 1.5;

const BEST_KEY = 'hillel_sky_hop_best';
const MUTE_KEY = 'hillel_sky_hop_muted';

// Obstacle types, in the spirit of T-Rex's CACTUS_SMALL / CACTUS_LARGE:
// minSpeed = speed from which it can appear, multipleSpeed = speed from
// which it can come in groups.
const OBSTACLE_TYPES = [
    { type: 'brick', weight: 45, minSpeed: 0, multipleSpeed: 10.5, maxSize: 3, minGap: 3 },
    { type: 'pit', weight: 30, minSpeed: 0, minGap: 3 },
    { type: 'tall', weight: 16, minSpeed: 10.5, multipleSpeed: 15, maxSize: 2, minGap: 3.5 },
    { type: 'bonus', weight: 9, minSpeed: 10, minGap: 2 },
    // extras so it doesn't get boring: springs that throw you high into a
    // trail of coins, and power-ups
    { type: 'spring', weight: 9, minSpeed: 9.4, minGap: 2 },
    { type: 'item', weight: 8, minSpeed: 9.3, minGap: 2 },
    // a wide chasm crossed on floating stepping stones
    { type: 'chasm', weight: 8, minSpeed: 10.2, minGap: 3 },
    // a high path of floating platforms full of coins
    { type: 'upper', weight: 8, minSpeed: 9.8, minGap: 2 },
];

const LEDGE_DEPTH = 2.2;
const JETPACK_HEIGHT = 3.8;      // flying height above the track
// The world changes every WORLD_LENGTH of distance: day -> sunset -> night -> day ...
const WORLD_LENGTH = 600;
const WORLDS = [
    { name: 'יום', sky: 0xffffff, fog: 0xb9a9f2, hemiSky: 0xffffff, hemiGround: 0x9d8fd6, hemi: 1.7, sun: 0xfff1e0, sunI: 2.3, stars: 0 },
    { name: 'שקיעה', sky: 0xffb88c, fog: 0xe7a3a8, hemiSky: 0xffd9b8, hemiGround: 0xb07a9c, hemi: 1.55, sun: 0xff9a5c, sunI: 2.1, stars: 0.15 },
    { name: 'לילה', sky: 0x5a62b8, fog: 0x3d3a7c, hemiSky: 0xb4c0ff, hemiGround: 0x4a3d8a, hemi: 1.35, sun: 0xc0ccff, sunI: 1.4, stars: 1 },
];
const WORLD_BANNERS = ['בוקר טוב! ☀', 'השמש שוקעת...', 'לילה בשמיים ✦'];

const SPRING_BOOST = 1.55;        // a spring jump starts this many times faster than a normal one
const DOUBLE_JUMP_BOOST = 0.85;

// ------------------------------------------------------------------- DOM
const $ = (id) => document.getElementById(id);
const ui = {
    world: $('world'),
    hud: $('hud'),
    scoreBox: $('hudScoreBox'),
    score: $('hudScore'),
    coins: $('hudCoins'),
    best: $('hudBest'),
    loading: $('loadingScreen'),
    loadingText: $('loadingText'),
    start: $('startScreen'),
    pause: $('pauseScreen'),
    gameOver: $('gameOverScreen'),
    gameOverTitle: $('gameOverTitle'),
    finalScore: $('finalScore'),
    finalCoins: $('finalCoins'),
    finalBest: $('finalBest'),
    newBest: $('newBestBadge'),
    savedNote: $('savedNote'),
    mute: $('muteBtn'),
    soundOn: $('iconSoundOn'),
    soundOff: $('iconSoundOff'),
};

function readStorage(key, fallback) {
    try {
        const v = window.localStorage.getItem(key);
        return v === null ? fallback : v;
    } catch (e) {
        return fallback;
    }
}

function writeStorage(key, value) {
    try {
        window.localStorage.setItem(key, String(value));
    } catch (e) {
        // storage blocked - the game still works, the high score just isn't kept
    }
}

const rand = (min, max) => min + Math.random() * (max - min);
const randInt = (min, max) => Math.floor(rand(min, max + 1));
const pick = (list) => list[Math.floor(Math.random() * list.length)];

// ----------------------------------------------------------------- sound
const sounds = {};
let muted = readStorage(MUTE_KEY, '0') === '1';

function loadSound(name) {
    try {
        const audio = new Audio(`./sounds/${name}.ogg`);
        audio.preload = 'auto';
        sounds[name] = audio;
    } catch (e) {
        // no audio support - silently skip
    }
}

function playSound(name, volume = 0.6) {
    if (muted || !sounds[name]) return;
    try {
        const s = sounds[name].cloneNode();
        s.volume = volume;
        const p = s.play();
        if (p && p.catch) p.catch(() => {});
    } catch (e) {
        // ignore
    }
}

function refreshMuteIcon() {
    ui.soundOn.classList.toggle('hidden', muted);
    ui.soundOff.classList.toggle('hidden', !muted);
}

['coin', 'jump', 'fall', 'land', 'break'].forEach(loadSound);
refreshMuteIcon();
ui.mute.addEventListener('click', (e) => {
    e.stopPropagation();
    muted = !muted;
    writeStorage(MUTE_KEY, muted ? '1' : '0');
    refreshMuteIcon();
});
ui.mute.addEventListener('pointerdown', (e) => e.stopPropagation());

// ------------------------------------------------------------- renderer
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
ui.world.appendChild(renderer.domElement);

const scene = new THREE.Scene();
const HAZE = new THREE.Color(0xb9a9f2);
scene.background = HAZE;
scene.fog = new THREE.Fog(HAZE, 30, 85);

const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 200);
let cameraDistance = 15;
let aspectFactor = 1;
let speedProgress = 0;  // 0 at the start speed, 1 at top speed

// The camera pulls back as the game speeds up, so there's always enough
// time to see what's coming (T-Rex gets the same effect from its fixed,
// wide canvas).
function targetCameraDistance() {
    return 15 * aspectFactor * (1 + 0.3 * speedProgress);
}

const hemi = new THREE.HemisphereLight(0xffffff, 0x9d8fd6, 1.7);
scene.add(hemi);
const sun = new THREE.DirectionalLight(0xfff1e0, 2.3);

// The sky is a big sphere around the camera, so it can be tinted for sunset and night.
const skyMaterial = new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.BackSide, fog: false, depthWrite: false });
const skySphere = new THREE.Mesh(new THREE.SphereGeometry(160, 32, 16), skyMaterial);
skySphere.renderOrder = -1;
skySphere.visible = false;
scene.add(skySphere);

const stars = (() => {
    const count = 500;
    const pos = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
        const a = Math.random() * Math.PI * 2;
        const h = 0.05 + Math.random() * 0.95;
        const r = 140;
        pos[i * 3] = Math.cos(a) * Math.sqrt(1 - h * h) * r;
        pos[i * 3 + 1] = h * r;
        pos[i * 3 + 2] = Math.sin(a) * Math.sqrt(1 - h * h) * r;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const pts = new THREE.Points(geo, new THREE.PointsMaterial({ color: 0xffffff, size: 2.2, sizeAttenuation: false, transparent: true, opacity: 0, fog: false, depthWrite: false }));
    pts.renderOrder = -1;
    scene.add(pts);
    return pts;
})();
sun.castShadow = true;
sun.shadow.mapSize.set(1024, 1024);
sun.shadow.camera.left = -16;
sun.shadow.camera.right = 22;
sun.shadow.camera.top = 10;
sun.shadow.camera.bottom = -10;
sun.shadow.camera.near = 1;
sun.shadow.camera.far = 40;
sun.shadow.bias = -0.0008;
scene.add(sun);
scene.add(sun.target);

function resize() {
    const w = ui.world.clientWidth || window.innerWidth;
    const h = ui.world.clientHeight || window.innerHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    // Narrow (portrait) screens move the camera back so you can still see
    // what's coming in time to jump.
    aspectFactor = Math.max(1, 1.15 / camera.aspect);
    cameraDistance = targetCameraDistance();
    camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);
resize();

// --------------------------------------------------------------- models
const MODEL_FILES = [
    'character', 'coin', 'brick', 'cloud', 'grass', 'grass-small', 'platform', 'platform-medium',
    'platform-large', 'platform-grass-large-round', 'platform-falling', 'block-coin', 'flag', 'dust',
    'brick-particle',
];

const models = {};
let characterAnimations = [];

function prepare(object, { cast = true, receive = true } = {}) {
    object.traverse((child) => {
        if (child.isMesh) {
            child.castShadow = cast;
            child.receiveShadow = receive;
        }
    });
    return object;
}

async function loadAssets() {
    const loader = new GLTFLoader();
    let done = 0;
    const total = MODEL_FILES.length + 1;
    const step = () => {
        done += 1;
        ui.loadingText.textContent = `טוען את האיים... ${Math.round((done / total) * 100)}%`;
    };

    const skyPromise = new THREE.TextureLoader().loadAsync('./sky.jpg').then((tex) => {
        tex.colorSpace = THREE.SRGBColorSpace;
        skyMaterial.map = tex;
        skyMaterial.needsUpdate = true;
        skySphere.visible = true;
        step();
    }).catch(() => step()); // the plain haze colour is a fine fallback

    await Promise.all([skyPromise, ...MODEL_FILES.map(async (file) => {
        const gltf = await loader.loadAsync(`./models/${file}.glb`);
        models[file] = gltf.scene;
        if (file === 'character') characterAnimations = gltf.animations;
        step();
    })]);
}

function cloneModel(key, scale = 1, shadows) {
    const obj = prepare(models[key].clone(true), shadows);
    obj.scale.setScalar(scale);
    return obj;
}

// Gives an object its own copies of its materials, so it can fade or be tinted alone.
function ownMaterials(obj) {
    obj.traverse((child) => {
        if (child.isMesh) child.material = child.material.clone();
    });
    return obj;
}

function setOpacity(obj, opacity) {
    obj.traverse((child) => {
        if (child.isMesh) {
            child.material.transparent = true;
            child.material.opacity = opacity;
        }
    });
}

// ----------------------------------------------------------- the track
// The track is a row of floating platforms. Pits are simply places where no
// platform was put. Platforms come in three sizes; the last one before a pit
// is stretched a little so the platforms always end exactly at the pit edge.
const TILE_MODELS = [
    { key: 'platform', size: 2 },
    { key: 'platform-medium', size: 3 },
    { key: 'platform-large', size: 5 },
];

let tiles = [];       // { mesh, x0, x1, size }
let pits = [];        // { x0, x1 }
let groundCursor = 0; // the track is built up to here

function addTile(x0, width) {
    const def = width >= 4.2 ? TILE_MODELS[2] : width >= 2.6 ? TILE_MODELS[1] : TILE_MODELS[0];
    const mesh = cloneModel(def.key, 1, { cast: false, receive: true });
    mesh.scale.set(width / def.size, 1, TRACK_DEPTH / def.size);
    mesh.position.set(x0 + width / 2, 0, 0);
    scene.add(mesh);

    // a few tufts of grass along the back edge
    if (Math.random() < 0.55) {
        const tufts = randInt(1, 3);
        for (let i = 0; i < tufts; i++) {
            const g = cloneModel(Math.random() < 0.5 ? 'grass' : 'grass-small', rand(1.2, 1.8), { cast: false, receive: false });
            g.position.set(rand(x0 + 0.4, x0 + width - 0.4), GROUND_TOP - 0.04, rand(-1.25, -0.85));
            g.rotation.y = rand(0, Math.PI * 2);
            scene.add(g);
            decor.push(g);
        }
    }
    const tile = { mesh, x0, x1: x0 + width, def };
    tiles.push(tile);
    return tile;
}

function stretchTile(tile, newX1) {
    const width = newX1 - tile.x0;
    tile.x1 = newX1;
    tile.mesh.scale.x = width / tile.def.size;
    tile.mesh.position.x = tile.x0 + width / 2;
}

// Lay platforms from groundCursor up to `limit` (the first spot that hasn't
// been decided yet), with whole tiles only.
function buildGroundTo(limit) {
    while (groundCursor + 2 <= limit) {
        const room = limit - groundCursor;
        const options = TILE_MODELS.filter((t) => t.size <= room);
        const def = pick(options);
        addTile(groundCursor, def.size);
        groundCursor += def.size;
    }
}

// A pit starts at x0: close the track up to its edge, then skip over it.
function addPit(x0, x1) {
    const gapToEdge = x0 - groundCursor;
    const last = tiles[tiles.length - 1];
    if (gapToEdge > 0.01) {
        if (gapToEdge < 1.2 && last && Math.abs(last.x1 - groundCursor) < 0.01) {
            stretchTile(last, x0);
        } else {
            addTile(groundCursor, gapToEdge);
        }
    }
    pits.push({ x0, x1 });
    groundCursor = x1;
}

function groundUnder(x) {
    // forgiving: standing with just the toes on the edge still counts
    for (const t of tiles) {
        if (x + 0.28 > t.x0 && x - 0.28 < t.x1) return true;
    }
    return false;
}

// ------------------------------------------------------------ background
// Floating islands, flags and cloud blocks at different depths. Because the
// camera really moves through the world, the far ones drift by slowly -
// that's the parallax.
let decor = [];       // grass tufts on the track
let scenery = [];     // { obj, bob, baseY, phase }
let sceneryCursor = -30;

function makeIsland() {
    const group = new THREE.Group();
    const kind = Math.random();
    if (kind < 0.55) {
        const s = rand(0.55, 1.1);
        const island = cloneModel('platform-grass-large-round', s, { cast: false, receive: true });
        group.add(island);
        const tufts = randInt(2, 5);
        for (let i = 0; i < tufts; i++) {
            const g = cloneModel(Math.random() < 0.5 ? 'grass' : 'grass-small', rand(1.4, 2.2), { cast: false, receive: false });
            const a = rand(0, Math.PI * 2);
            const r = rand(0, 1.9 * s);
            g.position.set(Math.cos(a) * r, 0.48 * s, Math.sin(a) * r);
            group.add(g);
        }
        if (Math.random() < 0.35) {
            const flag = cloneModel('flag', 1.4, { cast: false, receive: false });
            flag.position.set(rand(-1, 1) * s, 0.48 * s, rand(-1, 0.5) * s);
            flag.rotation.y = rand(-0.6, 0.6);
            group.add(flag);
        }
        if (Math.random() < 0.3) {
            const c = cloneModel('coin', 2, { cast: false, receive: false });
            c.position.set(0, 0.48 * s + 0.6, 0);
            c.userData.spin = true;
            group.add(c);
        }
    } else if (kind < 0.75) {
        // red / yellow floating platforms with a little grass or a flag
        // (never bricks - those would look like obstacles)
        const p = cloneModel(Math.random() < 0.5 ? 'platform-falling' : 'platform', rand(0.9, 1.4), { cast: false, receive: true });
        group.add(p);
        if (Math.random() < 0.5) {
            const deco = Math.random() < 0.5
                ? cloneModel('flag', 1.3, { cast: false, receive: false })
                : cloneModel('grass', 2, { cast: false, receive: false });
            deco.position.set(rand(-0.4, 0.4), 0.55, rand(-0.4, 0.2));
            group.add(deco);
        }
    } else {
        // a cluster of soft white cloud blocks
        const puffs = randInt(2, 4);
        for (let i = 0; i < puffs; i++) {
            const c = ownMaterials(cloneModel('cloud', rand(1.2, 2.6), { cast: false, receive: false }));
            c.position.set((i - puffs / 2) * 1.6 + rand(-0.3, 0.3), rand(-0.4, 0.6), rand(-0.6, 0.6));
            c.rotation.y = rand(-0.4, 0.4);
            c.traverse((child) => {
                if (child.isMesh) {
                    child.material.emissive = new THREE.Color(0xffffff);
                    child.material.emissiveIntensity = 0.45;
                }
            });
            group.add(c);
        }
    }
    return group;
}

function addScenery(x) {
    const obj = makeIsland();
    const far = Math.random() < 0.6;
    const z = far ? rand(-34, -14) : rand(-12, -6);
    const y = far ? rand(-3, 4.5) : rand(-5.5, -3.8);
    obj.position.set(x, y, z);
    obj.rotation.y = rand(-0.5, 0.5);
    scene.add(obj);
    scenery.push({ obj, baseY: y, phase: rand(0, Math.PI * 2), bob: rand(0.15, 0.4) });

    // now and then a cloud block drifting below / in front of the track
    if (Math.random() < 0.25) {
        const c = ownMaterials(cloneModel('cloud', rand(1.5, 2.8), { cast: false, receive: false }));
        c.traverse((child) => {
            if (child.isMesh) {
                child.material.emissive = new THREE.Color(0xffffff);
                child.material.emissiveIntensity = 0.5;
            }
        });
        const cy = rand(-6, -3.5);
        c.position.set(x + rand(-3, 3), cy, rand(-2, 4));
        scene.add(c);
        scenery.push({ obj: c, baseY: cy, phase: rand(0, Math.PI * 2), bob: 0.2 });
    }
}

function buildSceneryTo(limit) {
    while (sceneryCursor < limit) {
        addScenery(sceneryCursor);
        sceneryCursor += rand(4, 9);
    }
}

// ------------------------------------------------------------ character
const player = {
    root: null,
    model: null,
    mixer: null,
    actions: {},
    x: 0,
    y: GROUND_TOP,
    vy: 0,
    onGround: true,
    jumping: false,
    reachedMinHeight: false,
    dropping: false,
    jumpHeld: false,
    dustTimer: 0,
    usedDoubleJump: false,
    skin: null,
    standingOn: null,   // the ledge you're standing on (null = the track)
    flying: false,      // jetpack
    invincible: 0,      // seconds left (after the jetpack)
};

function buildPlayer() {
    player.root = new THREE.Group();
    const model = cloneModel('character', CHARACTER_SCALE);
    // the model faces the camera; turn it to run to the right, slightly toward us
    model.rotation.y = Math.PI / 2 - 0.35;
    player.model = model;
    player.root.add(model);
    scene.add(player.root);

    player.mixer = new THREE.AnimationMixer(model);
    characterAnimations.forEach((clip) => {
        player.actions[clip.name] = player.mixer.clipAction(clip);
    });
    if (player.actions.jump) {
        player.actions.jump.setLoop(THREE.LoopOnce, 1);
        player.actions.jump.clampWhenFinished = true;
    }

    // skin bought in the library site's shop
    player.skin = applySkin({ model, scene, skinId: skinFromUrl(), height: 1.1 * CHARACTER_SCALE });

    // shield bubble, shown while the shield power-up is active
    player.bubble = new THREE.Mesh(
        new THREE.SphereGeometry(0.95, 24, 16),
        new THREE.MeshBasicMaterial({ color: 0xc084fc, transparent: true, opacity: 0.28, depthWrite: false })
    );
    player.bubble.position.y = 0.62;
    player.bubble.visible = false;
    player.root.add(player.bubble);

    // jetpack: two little orange tanks with flames, shown while flying
    const pack = new THREE.Group();
    const tankMat = new THREE.MeshStandardMaterial({ color: 0xf97316, roughness: 0.4, metalness: 0.2 });
    const flames = [];
    [-0.17, 0.17].forEach((z) => {
        const tank = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.11, 0.5, 14), tankMat);
        tank.position.set(-0.36, 0.72, z);
        pack.add(tank);
        const nose = new THREE.Mesh(new THREE.ConeGeometry(0.11, 0.16, 14), tankMat);
        nose.position.set(-0.36, 1.05, z);
        pack.add(nose);
        const flame = new THREE.Mesh(new THREE.ConeGeometry(0.1, 0.45, 12), new THREE.MeshBasicMaterial({ color: 0xffcf3a, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false }));
        flame.rotation.z = Math.PI;
        flame.position.set(-0.36, 0.3, z);
        pack.add(flame);
        flames.push(flame);
    });
    pack.visible = false;
    pack.userData.flames = flames;
    player.jetpack = pack;
    player.root.add(pack);

    // blob shadow so you can always see where you'll land
    const shadow = new THREE.Mesh(
        new THREE.CircleGeometry(0.45, 24),
        new THREE.MeshBasicMaterial({ color: 0x2e1065, transparent: true, opacity: 0.25, depthWrite: false })
    );
    shadow.rotation.x = -Math.PI / 2;
    player.shadow = shadow;
    scene.add(shadow);
}

let currentAction = null;
function playAction(name, fade = 0.15) {
    const next = player.actions[name];
    if (!next || next === currentAction) return;
    next.reset().fadeIn(fade).play();
    if (currentAction) currentAction.fadeOut(fade);
    currentAction = next;
}

// ------------------------------------------------------------ obstacles
let obstacles = [];   // bricks: { kind:'brick', x0, x1, h, meshes }, bonus: { kind:'bonus', ... }
let coins = [];       // { mesh, baseY, flying? }
let effects = [];     // short-lived particles

function addCoin(x, y) {
    const mesh = cloneModel('coin', COIN_SCALE, { cast: true, receive: false });
    mesh.position.set(x, y, 0);
    scene.add(mesh);
    coins.push({ mesh, baseY: y });
}

// coins following the arc of a jump centred on x
function addCoinArc(centerX, peak) {
    const count = 5;
    for (let i = 0; i < count; i++) {
        const t = i / (count - 1);
        const x = centerX + (t - 0.5) * 3.2;
        const y = GROUND_TOP + 0.45 + Math.sin(t * Math.PI) * peak;
        addCoin(x, y);
    }
}

function addCoinLine(x0, x1, y = GROUND_TOP + 0.5) {
    const count = Math.min(6, Math.floor((x1 - x0) / 0.9));
    for (let i = 0; i < count; i++) addCoin(x0 + i * 0.9, y);
}

// coin shapes for long empty stretches: a wave you jump through, or a high line
function addCoinPattern(x0, x1) {
    const kind = Math.random();
    const count = Math.min(9, Math.floor((x1 - x0) / 0.85));
    for (let i = 0; i < count; i++) {
        const x = x0 + i * 0.85;
        let y = GROUND_TOP + 0.5;
        if (kind < 0.35) y += (Math.sin((i / (count - 1)) * Math.PI)) * JUMP_HEIGHT * 0.8;
        else if (kind < 0.55) y += 1.0 + Math.sin(i * 0.9) * 0.6;
        addCoin(x, y);
    }
}

function spawnBricks(x0, size, tall) {
    const meshes = [];
    const layers = tall ? 2 : 1;
    for (let i = 0; i < size; i++) {
        for (let j = 0; j < layers; j++) {
            const b = cloneModel('brick', BRICK);
            b.position.set(x0 + BRICK / 2 + i * BRICK, GROUND_TOP + j * BRICK, 0);
            b.rotation.y = (Math.random() < 0.5 ? 0 : Math.PI);
            scene.add(b);
            meshes.push(b);
        }
    }
    const x1 = x0 + size * BRICK;
    obstacles.push({ kind: 'brick', x0, x1, h: layers * BRICK, meshes });
    return x1;
}

function spawnBonus(x0) {
    const mesh = ownMaterials(cloneModel('block-coin', 1));
    const bottom = GROUND_TOP + 2.25;
    mesh.position.set(x0 + 0.55, bottom, 0);
    scene.add(mesh);
    obstacles.push({ kind: 'bonus', x0, x1: x0 + 1.1, bottom, mesh, used: false, bump: 0 });
    return x0 + 1.1;
}

// A springboard: a red pad on a coil. Running over it throws you high up.
function makeSpring() {
    const group = new THREE.Group();
    const base = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.55, 0.12, 24), new THREE.MeshStandardMaterial({ color: 0x475569, roughness: 0.6 }));
    base.position.y = 0.06;
    group.add(base);
    const coil = new THREE.Group();
    const coilMat = new THREE.MeshStandardMaterial({ color: 0xcbd5e1, metalness: 0.4, roughness: 0.35 });
    for (let i = 0; i < 4; i++) {
        const ring = new THREE.Mesh(new THREE.TorusGeometry(0.28, 0.05, 8, 24), coilMat);
        ring.rotation.x = Math.PI / 2;
        ring.position.y = 0.14 + i * 0.09;
        coil.add(ring);
    }
    group.add(coil);
    const pad = new THREE.Mesh(new THREE.CylinderGeometry(0.48, 0.48, 0.14, 24), new THREE.MeshStandardMaterial({ color: 0xef4444, roughness: 0.45 }));
    const stripe = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 0.145, 24), new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.45 }));
    pad.add(stripe);
    pad.position.y = 0.5;
    group.add(pad);
    group.traverse((c) => { if (c.isMesh) { c.castShadow = true; c.receiveShadow = true; } });
    group.userData = { coil, pad, squash: 0 };
    return group;
}

function spawnSpring(x0) {
    const mesh = makeSpring();
    mesh.position.set(x0 + 0.5, GROUND_TOP, 0);
    scene.add(mesh);
    obstacles.push({ kind: 'spring', x0, x1: x0 + 1, mesh, used: false });
    // coins along the flight path
    const v = JUMP_VELOCITY * SPRING_BOOST;
    const flight = (2 * v) / GRAVITY;
    for (let i = 1; i <= 9; i++) {
        const t = (i / 10) * flight;
        addCoin(x0 + 0.5 + state.speed * t, GROUND_TOP + 0.5 + v * t - 0.5 * GRAVITY * t * t);
    }
    return { x1: x0 + 1, flight };
}

// ---- floating ledges (one-way: jump up through them, land on top)
let ledges = []; // { x0, x1, top, mesh, falling, fallTimer, dropVy, dropped }

function addLedge(x0, width, top, falling) {
    const key = falling ? 'platform-falling' : 'platform';
    const size = falling ? 2.2 : 2;
    const modelTop = falling ? 0.5 : 0.55;
    const mesh = cloneModel(key, 1, { cast: true, receive: true });
    mesh.scale.set(width / size, 1, LEDGE_DEPTH / size);
    mesh.position.set(x0 + width / 2, top - modelTop, 0);
    scene.add(mesh);
    const ledge = { x0, x1: x0 + width, top, mesh, falling, fallTimer: -1, dropVy: 0, dropped: false, baseY: top - modelTop };
    ledges.push(ledge);
    return ledge;
}

function ledgeUnder(x, ledge) {
    return !ledge.dropped && x + 0.28 > ledge.x0 && x - 0.28 < ledge.x1;
}

// A wide chasm with stepping stones (some of them red ones that fall after you step on them).
function spawnChasm(x0) {
    const maxGap = Math.min(4, state.speed * JUMP_TIME * 0.5);
    const stones = [];
    let cursor = x0;
    const count = randInt(2, 4);
    let prevTop = GROUND_TOP;
    for (let i = 0; i < count; i++) {
        const gap = rand(Math.min(1.4, maxGap * 0.7), maxGap * 0.8);
        const width = rand(2.6, 3.6);
        let top = GROUND_TOP + pick([0, 0.6, 1.1]);
        if (top - prevTop > 1.1) top = prevTop + 1.1;
        stones.push({ x0: cursor + gap, width, top, falling: Math.random() < 0.4 });
        cursor += gap + width;
        prevTop = top;
    }
    const x1 = cursor + rand(Math.min(1.6, maxGap * 0.8), maxGap * 0.9);
    addPit(x0, x1);
    stones.forEach((st) => {
        addLedge(st.x0, st.width, st.top, st.falling);
        addCoinLine(st.x0 + 0.4, st.x0 + st.width - 0.2, st.top + 0.5);
    });
    return x1;
}

// A high path of floating platforms above the track, with coins on it.
function spawnUpperPath(x0) {
    let cursor = x0;
    const count = randInt(2, 3);
    const top = GROUND_TOP + 2.0;
    for (let i = 0; i < count; i++) {
        const width = rand(2.5, 3.6);
        addLedge(cursor, width, top, false);
        addCoinLine(cursor + 0.3, cursor + width - 0.2, top + 0.5);
        cursor += width + rand(1.0, 1.6);
    }
    return cursor;
}

function spawnItem(x0) {
    const kind = pick(['double', 'double', 'shield', 'magnet', 'x2', 'jetpack', 'jetpack']);
    const mesh = createPowerupMesh(kind, 0.85);
    mesh.position.set(x0 + 0.5, GROUND_TOP + 1.05, 0);
    scene.add(mesh);
    obstacles.push({ kind: 'item', power: kind, x0, x1: x0 + 1, mesh, used: false });
    return x0 + 1;
}

// T-Rex style obstacle stream: each new obstacle is placed `gap` units after
// the previous one; the gap grows with the speed so there's always time to land
// and jump again.
const generator = {
    nextX: 0,          // where the next obstacle starts
    history: [],       // last obstacle types, to limit repeats
};

function getGap(typeDef, width) {
    const minGap = Math.round((width * 0.9 + state.speed * 0.92 + typeDef.minGap * GAP_COEFFICIENT) * 10) / 10;
    const maxGap = minGap * MAX_GAP_COEFFICIENT;
    return rand(minGap, maxGap);
}

function duplicateTooMany(type) {
    const h = generator.history;
    let n = 0;
    for (let i = h.length - 1; i >= 0 && h[i] === type; i--) n++;
    return n >= MAX_OBSTACLE_DUPLICATION;
}

function chooseType() {
    const allowed = OBSTACLE_TYPES.filter((t) => state.speed >= t.minSpeed && !duplicateTooMany(t.type)
        && !(t.type === 'bonus' && generator.history[generator.history.length - 1] === 'bonus'));
    const total = allowed.reduce((sum, t) => sum + t.weight, 0);
    let r = Math.random() * total;
    for (const t of allowed) {
        r -= t.weight;
        if (r <= 0) return t;
    }
    return allowed[0];
}

function spawnNext() {
    const def = chooseType();
    const x0 = generator.nextX;
    buildGroundTo(x0);
    let x1;

    if (def.type === 'pit') {
        // the widest pit still leaves a comfortable margin on a full jump
        const airDistance = state.speed * JUMP_TIME;
        const maxWidth = Math.min(4.6, airDistance * 0.55);
        const width = rand(Math.min(1.8, maxWidth), maxWidth);
        x1 = x0 + width;
        addPit(x0, x1);
        if (Math.random() < 0.45) addCoinArc((x0 + x1) / 2, JUMP_HEIGHT * 0.75);
    } else if (def.type === 'spring') {
        const spring = spawnSpring(x0);
        x1 = spring.x1;
        // leave room to land: nothing until well after the flight ends
        x1 += state.speed * spring.flight;
    } else if (def.type === 'item') {
        x1 = spawnItem(x0);
    } else if (def.type === 'chasm') {
        x1 = spawnChasm(x0);
    } else if (def.type === 'upper') {
        x1 = spawnUpperPath(x0);
    } else if (def.type === 'bonus') {
        x1 = spawnBonus(x0);
        // a few coins on the ground under it, as a hint
        addCoinLine(x0 - 1.2, x1 + 1.2);
    } else {
        const canMultiply = state.speed >= def.multipleSpeed;
        const size = canMultiply ? randInt(1, def.maxSize) : 1;
        x1 = spawnBricks(x0, size, def.type === 'tall');
        if (Math.random() < 0.5) addCoinArc((x0 + x1) / 2, def.type === 'tall' ? JUMP_HEIGHT * 0.95 : JUMP_HEIGHT * 0.7);
    }

    generator.history.push(def.type);
    if (generator.history.length > 6) generator.history.shift();

    // (a spring's landing room is already included in x1)
    const gap = getGap(def, ['spring', 'chasm', 'upper'].includes(def.type) ? 1.5 : x1 - x0);
    // sometimes a row of coins in the empty stretch
    if (gap > 7 && Math.random() < 0.45) addCoinPattern(x1 + 2.5, x1 + gap - 2.5);
    generator.nextX = x1 + gap;
}

function clearWorld() {
    [...tiles.map((t) => t.mesh), ...decor, ...coins.map((c) => c.mesh), ...effects.map((e) => e.obj),
        ...scenery.map((s) => s.obj)].forEach((m) => scene.remove(m));
    obstacles.forEach((o) => {
        if (o.meshes) o.meshes.forEach((m) => scene.remove(m));
        if (o.mesh) scene.remove(o.mesh);
    });
    ledges.forEach((l) => scene.remove(l.mesh));
    ledges = [];
    tiles = [];
    pits = [];
    decor = [];
    coins = [];
    effects = [];
    obstacles = [];
    scenery = [];
}

// -------------------------------------------------------------- effects
function spawnDust(x, y, count, spread) {
    for (let i = 0; i < count; i++) {
        const obj = ownMaterials(cloneModel('dust', rand(0.8, 1.3), { cast: false, receive: false }));
        obj.position.set(x + rand(-spread, spread), y + 0.1, rand(-0.3, 0.3));
        scene.add(obj);
        effects.push({ obj, life: 0, maxLife: rand(0.35, 0.6), vx: rand(-1.5, -0.3), vy: rand(0.3, 1.2), vz: 0, spin: 0, grow: true, gravity: 0 });
    }
}

function spawnBrickBurst(o) {
    o.meshes.forEach((m) => {
        for (let i = 0; i < 3; i++) {
            const obj = cloneModel('brick-particle', rand(0.8, 1.3));
            obj.position.copy(m.position).add(new THREE.Vector3(rand(-0.3, 0.3), rand(0.2, 0.8), rand(-0.3, 0.3)));
            scene.add(obj);
            effects.push({ obj, life: 0, maxLife: 1.4, vx: rand(1, 5), vy: rand(3, 7), vz: rand(-3, 3), spin: rand(-8, 8), grow: false, gravity: 20 });
        }
        scene.remove(m);
    });
    o.meshes = [];
}

function spawnCoinPop(x, y) {
    const obj = cloneModel('coin', COIN_SCALE, { cast: false, receive: false });
    obj.position.set(x, y, 0);
    scene.add(obj);
    effects.push({ obj, life: 0, maxLife: 0.55, vx: 0, vy: 7, vz: 0, spin: 18, grow: false, gravity: 18, fadeOut: true });
}

function updateEffects(dt) {
    effects = effects.filter((e) => {
        e.life += dt;
        const t = e.life / e.maxLife;
        if (t >= 1) {
            scene.remove(e.obj);
            return false;
        }
        e.vy -= e.gravity * dt;
        e.obj.position.x += e.vx * dt;
        e.obj.position.y += e.vy * dt;
        e.obj.position.z += e.vz * dt;
        e.obj.rotation.y += e.spin * dt;
        e.obj.rotation.x += e.spin * 0.5 * dt;
        if (e.grow) {
            e.obj.scale.setScalar(0.6 + t * 1.2);
            setOpacity(e.obj, 0.85 * (1 - t));
        }
        return true;
    });
}

// ------------------------------------------------------------ game state
const state = {
    mode: 'loading', // loading | ready | running | paused | over
    speed: START_SPEED,
    elapsed: 0,
    distance: 0,
    coins: 0,
    score: 0,
    lastMilestone: 0,
    // inside the library site: your own best (from your account); on its own: this computer's
    best: bestFromUrl() ?? (parseInt(readStorage(BEST_KEY, '0'), 10) || 0),
    shake: 0,
    falling: false,
    world: 0,           // index into WORLDS
    combo: 0,
    lastCoinAt: 0,
    jetCoinX: 0,
};

// ------------------------------------------------------------ power-ups
const powerHud = createPowerupHud(document.body);
let coinFx = null; // created once the coin model has loaded
const powers = {}; // kind -> seconds left (shield: Infinity until used)

function activatePower(kind) {
    powers[kind] = POWERUPS[kind].seconds || Infinity;
    if (kind === 'shield') powerHud.set('shield', 1, 0);
    if (kind === 'jetpack') {
        player.flying = true;
        player.onGround = false;
        player.standingOn = null;
        player.jumping = false;
        state.jetCoinX = player.x + 8;
        showBanner('רקטה! ✈');
    }
    playSound('coin', 0.6);
}

function clearPowers() {
    Object.keys(powers).forEach((k) => delete powers[k]);
    powerHud.clear();
}

function updatePowers(dt) {
    for (const kind of Object.keys(powers)) {
        if (powers[kind] === Infinity) continue;
        powers[kind] -= dt;
        // the jetpack only lets go above solid ground
        if (kind === 'jetpack' && powers[kind] <= 0 && !(groundUnder(player.x) && groundUnder(player.x + 2.5))) {
            powers[kind] = 0.05;
        }
        if (kind === 'jetpack' && powers[kind] <= 0) {
            player.flying = false;
            player.vy = 0;
            player.invincible = 1.2;
        }
        if (powers[kind] <= 0) {
            delete powers[kind];
            powerHud.remove(kind);
        } else {
            powerHud.set(kind, powers[kind], POWERUPS[kind].seconds);
        }
    }
    if (player.bubble) {
        player.bubble.visible = Boolean(powers.shield);
        player.bubble.scale.setScalar(1 + Math.sin(performance.now() / 150) * 0.04);
    }
}

// The shield takes one hit (or one fall) instead of you.
function useShield() {
    if (!powers.shield) return false;
    delete powers.shield;
    powerHud.remove('shield');
    state.shake = 0.2;
    playSound('break', 0.5);
    return true;
}

// ---- worlds (day / sunset / night)
const worldFrom = WORLDS.map(() => 0);
const blend = { t: 1, from: WORLDS[0], to: WORLDS[0] };
const tmpColorA = new THREE.Color();
const tmpColorB = new THREE.Color();

function setWorld(index, instant) {
    blend.from = blend.t >= 1 ? blend.to : currentWorldSnapshot();
    blend.to = WORLDS[index];
    blend.t = instant ? 1 : 0;
    if (instant) applyWorld(blend.to, blend.to, 1);
}

function currentWorldSnapshot() {
    // freeze the half-finished colours as a starting point
    return {
        sky: skyMaterial.color.getHex(), fog: scene.fog.color.getHex(), hemiSky: hemi.color.getHex(), hemiGround: hemi.groundColor.getHex(),
        hemi: hemi.intensity, sun: sun.color.getHex(), sunI: sun.intensity, stars: stars.material.opacity,
    };
}

function mixColor(target, a, b, t) {
    target.copy(tmpColorA.setHex(a)).lerp(tmpColorB.setHex(b), t);
}

function applyWorld(a, b, t) {
    mixColor(skyMaterial.color, a.sky, b.sky, t);
    mixColor(scene.fog.color, a.fog, b.fog, t);
    if (!skySphere.visible) scene.background = scene.fog.color;
    mixColor(hemi.color, a.hemiSky, b.hemiSky, t);
    mixColor(hemi.groundColor, a.hemiGround, b.hemiGround, t);
    hemi.intensity = THREE.MathUtils.lerp(a.hemi, b.hemi, t);
    mixColor(sun.color, a.sun, b.sun, t);
    sun.intensity = THREE.MathUtils.lerp(a.sunI, b.sunI, t);
    stars.material.opacity = THREE.MathUtils.lerp(a.stars, b.stars, t);
}

function updateWorld(dt) {
    const index = Math.floor(state.distance / WORLD_LENGTH) % WORLDS.length;
    if (index !== state.world) {
        state.world = index;
        setWorld(index, false);
        showBanner(WORLD_BANNERS[index]);
    }
    if (blend.t < 1) {
        blend.t = Math.min(1, blend.t + dt / 4);
        const e = blend.t * blend.t * (3 - 2 * blend.t);
        applyWorld(blend.from, blend.to, e);
    }
}

// a big message across the top of the screen (new world, jetpack, combos)
const banner = document.createElement('div');
banner.className = 'world-banner hidden';
document.body.appendChild(banner);
let bannerTimer = null;
function showBanner(text, small) {
    banner.textContent = text;
    banner.classList.remove('hidden', 'show', 'small');
    if (small) banner.classList.add('small');
    void banner.offsetWidth;
    banner.classList.add('show');
    clearTimeout(bannerTimer);
    bannerTimer = setTimeout(() => banner.classList.add('hidden'), 1900);
}

const bridge = createBridge('jumper', {
    getRunCoins: () => state.coins,
    onSaved: showSaved,
});

function showSaved(info) {
    if (!ui.savedNote) return;
    ui.savedNote.classList.remove('hidden', 'warn');
    if (info.error) {
        ui.savedNote.textContent = 'לא הצלחנו לשמור את המטבעות הפעם';
        ui.savedNote.classList.add('warn');
    } else {
        ui.savedNote.textContent = info.earned > 0
            ? `נשמרו ${info.earned.toLocaleString()} מטבעות בחשבון · יש לך ${info.coins.toLocaleString()}`
            : `לא נאספו מטבעות הפעם · יש לך ${info.coins.toLocaleString()}`;
    }
}

function resetGame() {
    clearWorld();
    if (coinFx) coinFx.clear();
    clearPowers();
    state.speed = START_SPEED;
    speedProgress = 0;
    state.elapsed = 0;
    state.distance = 0;
    state.coins = 0;
    state.score = 0;
    state.lastMilestone = 0;
    state.shake = 0;
    state.falling = false;
    state.world = 0;
    state.combo = 0;
    state.lastCoinAt = 0;
    setWorld(0, true);

    player.x = 0;
    player.y = GROUND_TOP;
    player.vy = 0;
    player.onGround = true;
    player.jumping = false;
    player.dropping = false;
    player.jumpHeld = false;
    player.usedDoubleJump = false;
    player.standingOn = null;
    player.flying = false;
    player.invincible = 0;
    if (player.jetpack) player.jetpack.visible = false;
    player.root.rotation.set(0, 0, 0);
    player.model.rotation.set(0, Math.PI / 2 - 0.35, 0);

    groundCursor = -16;
    sceneryCursor = -30;
    generator.history = [];
    generator.nextX = START_SPEED * CLEAR_TIME + 4;
    buildGroundTo(generator.nextX);
    fillAhead();
    snapCamera();
    updateHud();
}

function fillAhead() {
    while (generator.nextX < player.x + SPAWN_AHEAD) spawnNext();
    buildSceneryTo(player.x + SPAWN_AHEAD + 20);
}

function cleanupBehind() {
    const limit = player.x - CLEANUP_BEHIND;
    tiles = tiles.filter((t) => {
        if (t.x1 < limit) { scene.remove(t.mesh); return false; }
        return true;
    });
    pits = pits.filter((p) => p.x1 >= limit);
    ledges = ledges.filter((l) => {
        if (l.x1 < limit) { scene.remove(l.mesh); return false; }
        return true;
    });
    decor = decor.filter((d) => {
        if (d.position.x < limit) { scene.remove(d); return false; }
        return true;
    });
    obstacles = obstacles.filter((o) => {
        if (o.x1 < limit) {
            if (o.meshes) o.meshes.forEach((m) => scene.remove(m));
            if (o.mesh) scene.remove(o.mesh);
            return false;
        }
        return true;
    });
    coins = coins.filter((c) => {
        if (c.mesh.position.x < limit) { scene.remove(c.mesh); return false; }
        return true;
    });
    scenery = scenery.filter((s) => {
        if (s.obj.position.x < player.x - 45) { scene.remove(s.obj); return false; }
        return true;
    });
}

function updateHud() {
    ui.score.textContent = state.score;
    ui.coins.textContent = state.coins;
    ui.best.textContent = Math.max(state.best, state.score);
}

function showOnly(screen) {
    [ui.start, ui.pause, ui.gameOver].forEach((el) => el.classList.add('hidden'));
    if (screen) screen.classList.remove('hidden');
}

function startRun() {
    if (state.mode === 'running') return;
    if (state.mode === 'over' || state.mode === 'ready') resetGame();
    state.mode = 'running';
    showOnly(null);
    if (player.mixer) player.mixer.timeScale = 1;
    playAction('walk');
    bridge.runStarted();
    window.focus();
}

function pauseRun() {
    if (state.mode !== 'running') return;
    state.mode = 'paused';
    showOnly(ui.pause);
    if (player.mixer) player.mixer.timeScale = 0;
}

function resumeRun() {
    if (state.mode !== 'paused') return;
    state.mode = 'running';
    showOnly(null);
    if (player.mixer) player.mixer.timeScale = 1;
}

function endRun(reason) {
    if (state.mode === 'over') return;
    state.mode = 'over';
    state.shake = reason === 'fall' ? 0.15 : 0.4;
    playSound(reason === 'fall' ? 'fall' : 'break', 0.7);
    playAction('idle', 0.1);
    const titles = { fall: 'אוי! נפלת לבור', crash: 'אוי! נתקלת בלבנים' };
    ui.gameOverTitle.textContent = titles[reason] || titles.crash;
    if (player.jetpack) player.jetpack.visible = false;
    player.flying = false;

    const isNewBest = state.score > state.best;
    if (isNewBest) {
        state.best = state.score;
        writeStorage(BEST_KEY, state.best);
    }
    ui.finalScore.textContent = state.score;
    ui.finalCoins.textContent = state.coins;
    ui.finalBest.textContent = state.best;
    ui.newBest.classList.toggle('hidden', !isNewBest);
    clearPowers();
    if (ui.savedNote) {
        ui.savedNote.classList.toggle('hidden', !bridge.embedded || state.coins === 0);
        ui.savedNote.classList.remove('warn');
        ui.savedNote.textContent = 'שומר את המטבעות בחשבון...';
    }
    bridge.runEnded(state.coins, { score: state.score });
    setTimeout(() => {
        if (state.mode === 'over') showOnly(ui.gameOver);
    }, reason === 'fall' ? 750 : 500);
}

// --------------------------------------------------------------- input
function startJump() {
    player.jumpHeld = true;
    if (state.mode !== 'running' || state.falling) return;
    if (!player.onGround) {
        // second jump in the air with the double-jump power-up
        if (powers.double && !player.usedDoubleJump) {
            player.usedDoubleJump = true;
            player.jumping = true;
            player.reachedMinHeight = false;
            player.dropping = false;
            player.vy = JUMP_VELOCITY * DOUBLE_JUMP_BOOST;
            playAction('jump', 0.05);
            playSound('jump', 0.4);
            spawnDust(player.x, player.y, 4, 0.3);
            if (player.skin) player.skin.onJump(player.root.position);
        }
        return;
    }
    player.onGround = false;
    player.jumping = true;
    player.reachedMinHeight = false;
    player.dropping = false;
    // a little extra lift at high speed, like T-Rex's speed-based jump velocity
    player.vy = JUMP_VELOCITY + (state.speed - START_SPEED) * 0.06;
    playAction('jump', 0.05);
    playSound('jump', 0.4);
    spawnDust(player.x, GROUND_TOP, 3, 0.2);
    if (player.skin) player.skin.onJump(player.root.position);
}

// T-Rex endJump(): letting go early cuts the climb short
function endJump() {
    player.jumpHeld = false;
    if (player.jumping && player.reachedMinHeight && player.vy > DROP_VELOCITY) {
        player.vy = DROP_VELOCITY;
    }
}

function setDrop(on) {
    player.dropping = on && state.mode === 'running' && !player.onGround;
    if (player.dropping && player.vy > 0) player.vy = 0;
}

const JUMP_KEYS = [' ', 'ArrowUp', 'w', 'W'];
const DROP_KEYS = ['ArrowDown', 's', 'S'];

window.addEventListener('keydown', (e) => {
    const key = e.key;
    if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', ' '].includes(key)) e.preventDefault();
    if (e.repeat) return;

    if (state.mode === 'ready' || state.mode === 'over') {
        if (key === ' ' || key === 'Enter' || key === 'ArrowUp') startRun();
        return;
    }
    if (state.mode === 'paused') {
        if (key === 'p' || key === 'P' || key === ' ' || key === 'Escape') resumeRun();
        return;
    }
    if (JUMP_KEYS.includes(key)) startJump();
    else if (DROP_KEYS.includes(key)) setDrop(true);
    else if (key === 'p' || key === 'P' || key === 'Escape') pauseRun();
});

window.addEventListener('keyup', (e) => {
    if (JUMP_KEYS.includes(e.key)) endJump();
    else if (DROP_KEYS.includes(e.key)) player.dropping = false;
});

// Touch / mouse: press to jump (hold for a higher jump), swipe down to drop.
let pointerStart = null;
ui.world.addEventListener('pointerdown', (e) => {
    pointerStart = { y: e.clientY };
    if (state.mode === 'running') startJump();
});
ui.world.addEventListener('pointermove', (e) => {
    if (pointerStart && e.clientY - pointerStart.y > 40) setDrop(true);
});
const pointerEnd = () => {
    pointerStart = null;
    endJump();
};
ui.world.addEventListener('pointerup', pointerEnd);
ui.world.addEventListener('pointercancel', pointerEnd);
ui.world.addEventListener('pointerleave', pointerEnd);

$('startBtn').addEventListener('click', startRun);
$('restartBtn').addEventListener('click', startRun);
$('resumeBtn').addEventListener('click', resumeRun);

document.addEventListener('visibilitychange', () => {
    if (document.hidden) pauseRun();
});
window.addEventListener('blur', pauseRun);

// The library page can control the game when it's shown in the "משחק" window.
window.addEventListener('message', (e) => {
    if (e.origin !== window.location.origin) return;
    const msg = e.data && e.data.type;
    if (msg === 'pause') pauseRun();
    else if (msg === 'restart' && state.mode !== 'loading') {
        bridge.runEnded(state.coins, { score: state.score }); // keep the coins of the run that was cut short
        state.mode = 'over';
        startRun();
    }
});

// ---------------------------------------------------------------- loop
const clock = new THREE.Clock();
const CAM_HEIGHT = 4.2;
const CAM_LOOK_Y = 2.3;
const camTarget = new THREE.Vector3();
const carryVelocity = new THREE.Vector3();

function cameraAnchorX() {
    // keep the runner on the left third of the screen so you can see ahead
    const halfWidth = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * cameraDistance * camera.aspect;
    return player.x + halfWidth * 0.55;
}

function snapCamera() {
    cameraDistance = targetCameraDistance();
    const ax = cameraAnchorX();
    camera.position.set(ax, CAM_HEIGHT + cameraDistance * 0.1, cameraDistance);
    camTarget.set(ax, CAM_LOOK_Y, 0);
    camera.lookAt(camTarget);
}

// The highest surface you could land on at x, at or below height y.
function landingSurface(x, prevY, y) {
    let best = null;
    if (groundUnder(x) && prevY >= GROUND_TOP - 0.05 && y <= GROUND_TOP) best = { top: GROUND_TOP, ledge: null };
    for (const l of ledges) {
        if (!ledgeUnder(x, l)) continue;
        if (prevY >= l.top - 0.05 && y <= l.top && (!best || l.top > best.top)) best = { top: l.top, ledge: l };
    }
    return best;
}

function landOn(surface) {
    player.y = surface.top;
    player.vy = 0;
    player.onGround = true;
    player.standingOn = surface.ledge;
    player.jumping = false;
    player.dropping = false;
    player.usedDoubleJump = false;
    playSound('land', 0.25);
    playAction('walk', 0.1);
    spawnDust(player.x, surface.top, 4, 0.35);
    if (player.skin) player.skin.onLand(player.root.position);
    // red stepping stones start to wobble and fall once you step on them
    if (surface.ledge && surface.ledge.falling && surface.ledge.fallTimer < 0) surface.ledge.fallTimer = 0.45;
}

function updatePlayer(dt) {
    const prevY = player.y;
    if (player.invincible > 0) player.invincible -= dt;

    if (player.flying) {
        // jetpack: glide up to flying height and stay there
        const target = GROUND_TOP + JETPACK_HEIGHT;
        player.vy = (target - player.y) * 4;
        player.y += player.vy * dt;
        return;
    }

    if (!player.onGround) {
        const g = GRAVITY * (player.dropping ? SPEED_DROP_COEFFICIENT : 1);
        player.vy -= g * dt;
        player.y += player.vy * dt;
        if (player.y - GROUND_TOP >= MIN_JUMP_HEIGHT) player.reachedMinHeight = true;
        if (player.jumping && !player.jumpHeld) endJump();

        // landing on the track or on a ledge
        if (!state.falling && player.vy <= 0) {
            const surface = landingSurface(player.x, prevY, player.y);
            if (surface) landOn(surface);
        }

        // below the track with nothing underneath: it's a fall
        if (!state.falling && player.y < GROUND_TOP - 0.3) {
            if (useShield()) {
                // the shield bounces you back out of the pit
                player.vy = JUMP_VELOCITY * 1.15;
                player.jumping = false;
                player.usedDoubleJump = false;
                spawnDust(player.x, player.y, 6, 0.4);
            } else {
                state.falling = true;
                endRun('fall');
            }
        }
    } else {
        const l = player.standingOn;
        const supported = l ? ledgeUnder(player.x, l) : groundUnder(player.x);
        if (!supported || (l && l.dropped)) {
            // ran off an edge (or the stone fell away)
            player.onGround = false;
            player.standingOn = null;
            player.jumping = false;
            player.vy = 0;
        }
    }
}

function checkCollisions() {
    // Forgiving boxes, like T-Rex's collision boxes that are smaller than the sprites.
    const pMinX = player.x - 0.3;
    const pMaxX = player.x + 0.3;
    const pMinY = player.y + 0.05;
    const pMaxY = player.y + 1.0;

    for (const o of obstacles) {
        if (o.kind === 'brick') {
            if (!o.meshes.length) continue;
            const minX = o.x0 + 0.12;
            const maxX = o.x1 - 0.12;
            const maxY = GROUND_TOP + o.h - 0.12;
            if (pMaxX > minX && pMinX < maxX && pMinY < maxY && pMaxY > GROUND_TOP) {
                spawnBrickBurst(o);
                if (player.flying || player.invincible > 0) { playSound('break', 0.4); continue; }
                if (useShield()) continue; // the shield smashes through
                // knocked back onto the platform
                player.vy = 4;
                player.onGround = false;
                endRun('crash');
                return;
            }
        } else if (o.kind === 'spring' && !o.used) {
            if (player.onGround && pMaxX > o.x0 + 0.15 && pMinX < o.x1 - 0.15) {
                o.used = true;
                o.mesh.userData.squash = 0.3;
                player.onGround = false;
                player.jumping = false; // a spring jump can't be cut short
                player.usedDoubleJump = false;
                player.vy = JUMP_VELOCITY * SPRING_BOOST;
                playAction('jump', 0.05);
                playSound('jump', 0.6);
                if (player.skin) player.skin.onJump(player.root.position);
            }
        } else if (o.kind === 'item' && !o.used) {
            const p = o.mesh.position;
            if (Math.abs(p.x - player.x) < 0.75 && p.y > player.y - 0.3 && p.y < player.y + 1.7) {
                o.used = true;
                scene.remove(o.mesh);
                activatePower(o.power);
            }
        } else if (o.kind === 'bonus' && !o.used) {
            // head-bump from below gives 5 coins, Mario style
            if (player.vy > 0 && pMaxX > o.x0 + 0.1 && pMinX < o.x1 - 0.1 && pMaxY >= o.bottom && player.y < o.bottom) {
                o.used = true;
                o.bump = 0.25;
                player.vy = -1;
                player.y = o.bottom - 1.0;
                state.coins += 5 * (powers.x2 ? 2 : 1);
                playSound('coin', 0.5);
                for (let i = 0; i < 5; i++) setTimeout(() => spawnCoinPop(o.x0 + 0.55, o.bottom + 1), i * 70);
                o.mesh.traverse((child) => {
                    if (child.isMesh) child.material.color.multiplyScalar(0.55);
                });
            }
        }
    }

    // the magnet pulls in coins just ahead
    if (powers.magnet) {
        coins.forEach((c) => {
            const p = c.mesh.position;
            if (!c.magnet && p.x > player.x - 1 && p.x < player.x + 7) c.magnet = true;
        });
    }
    coins = coins.filter((c) => {
        const p = c.mesh.position;
        if (c.magnet) {
            p.x += (player.x - p.x) * 0.12;
            p.y += (player.y + 0.6 - p.y) * 0.12;
            c.baseY = p.y;
        }
        const hit = Math.abs(p.x - player.x) < 0.6 && p.y > player.y - 0.3 && p.y < player.y + 1.4;
        if (hit) {
            // with x2 every coin has a twin next to it - you really pick up two
            const value = c.twin ? 2 : 1;
            scene.remove(c.mesh);
            state.coins += value;
            coinFx.pickup(c.mesh.getWorldPosition(new THREE.Vector3()), value);
            // a quick run of coins makes a combo
            state.combo = state.elapsed - state.lastCoinAt < 0.9 ? state.combo + 1 : 1;
            state.lastCoinAt = state.elapsed;
            if (state.combo > 0 && state.combo % 10 === 0) showBanner(`רצף ${state.combo}!`, true);
            playSound('coin', 0.3);
            return false;
        }
        return true;
    });
}

const PHYSICS_STEP = 1 / 120;
let debugStepHook = null;

function stepRun(dt) {
    state.elapsed += dt;
    state.speed = Math.min(MAX_SPEED, state.speed + ACCELERATION * dt);
    speedProgress = (state.speed - START_SPEED) / (MAX_SPEED - START_SPEED);
    const move = state.speed * dt;
    player.x += move;
    state.distance += move;
    state.score = Math.floor(state.distance) + state.coins * 10;
    if (debugStepHook) debugStepHook();
    updatePlayer(dt);
    if (state.mode === 'running') checkCollisions();
}

function update(dt) {
    const running = state.mode === 'running';
    const now = performance.now() / 1000;

    if (running) {
        // Physics runs in small fixed steps, so even on a slow device at top
        // speed the runner can never skip through a brick or past a ledge.
        const steps = Math.ceil(dt / PHYSICS_STEP);
        for (let i = 0; i < steps && state.mode === 'running'; i++) {
            stepRun(dt / steps);
        }

        // T-Rex flashes the score every 100 points
        const milestone = Math.floor(state.distance / 100);
        if (milestone > state.lastMilestone) {
            state.lastMilestone = milestone;
            ui.scoreBox.classList.remove('pulse');
            void ui.scoreBox.offsetWidth;
            ui.scoreBox.classList.add('pulse');
        }

        updatePowers(dt);
        updateWorld(dt);
        // jetpack: a river of coins along the flight
        if (player.flying && powers.jetpack > 1.2) {
            while (state.jetCoinX < player.x + 18) {
                addCoin(state.jetCoinX, GROUND_TOP + JETPACK_HEIGHT + 0.6 + Math.sin(state.jetCoinX * 0.5) * 0.7);
                state.jetCoinX += 1.0;
            }
        }
        fillAhead();
        cleanupBehind();

        // little puffs of dust while running
        if (player.onGround) {
            player.dustTimer -= dt;
            if (player.dustTimer <= 0) {
                spawnDust(player.x - 0.3, GROUND_TOP, 1, 0.05);
                player.dustTimer = 0.14;
            }
        }
        if (currentAction === player.actions.walk) {
            currentAction.timeScale = 1.5 + speedProgress * 1.1;
        }
        updateHud();
    } else if (state.mode === 'over') {
        // after a crash the runner is knocked back onto the platform; after
        // a missed jump it keeps falling into the clouds
        if (!player.onGround) {
            player.vy -= GRAVITY * dt;
            player.y += player.vy * dt;
            if (!state.falling && player.vy < 0 && player.y <= GROUND_TOP && groundUnder(player.x)) {
                player.y = GROUND_TOP;
                player.vy = 0;
                player.onGround = true;
            }
            if (player.y < -12) player.y = -12;
        }
        player.root.rotation.z = Math.min(player.root.rotation.z + dt * 5, state.falling ? 1.2 : 1.35);
    }

    // coins spin and bob
    coins.forEach((c) => {
        c.mesh.rotation.y += dt * 3.5;
        if (!c.magnet) c.mesh.position.y = c.baseY + Math.sin(now * 4 + c.mesh.position.x) * 0.06;
    });

    // red stepping stones wobble, then fall
    ledges.forEach((l) => {
        if (l.fallTimer > 0 && running) {
            l.fallTimer = Math.max(0, l.fallTimer - dt);
            l.mesh.position.y = l.baseY + Math.sin(now * 60) * 0.03;
            if (l.fallTimer === 0) l.fallTimer = -2; // now dropping
        } else if (l.fallTimer === -2) {
            l.dropVy -= 20 * dt;
            l.mesh.position.y += l.dropVy * dt;
            l.mesh.rotation.z += dt * 0.6;
            if (l.mesh.position.y < l.baseY - 0.4) l.dropped = true;
        }
    });

    // jetpack look
    if (player.jetpack) {
        player.jetpack.visible = player.flying;
        if (player.flying) {
            player.jetpack.userData.flames.forEach((f) => {
                f.scale.set(1, 0.7 + Math.random() * 0.6, 1);
                f.material.opacity = 0.7 + Math.random() * 0.3;
            });
            if (Math.random() < 0.5) spawnDust(player.x - 0.4, player.y + 0.1, 1, 0.1);
        }
    }

    // springs squash and bounce back; power-ups spin
    obstacles.forEach((o) => {
        if (o.kind === 'spring') {
            const u = o.mesh.userData;
            if (u.squash > 0) u.squash = Math.max(0, u.squash - dt);
            const k = u.squash > 0 ? 1 - Math.sin((u.squash / 0.3) * Math.PI) * 0.45 : 1;
            u.coil.scale.y = k;
            u.pad.position.y = 0.14 + 0.36 * k;
        } else if (o.kind === 'item' && !o.used) {
            o.mesh.userData.animate(now);
        }
    });

    // ? blocks bump when hit
    obstacles.forEach((o) => {
        if (o.kind === 'bonus') {
            if (o.bump > 0) o.bump = Math.max(0, o.bump - dt);
            o.mesh.position.y = o.bottom + Math.sin((o.bump / 0.25) * Math.PI) * 0.35;
            if (!o.used) o.mesh.rotation.y = Math.sin(now * 2) * 0.15;
        }
    });

    // floating islands bob gently
    scenery.forEach((s) => {
        s.obj.position.y = s.baseY + Math.sin(now * 0.8 + s.phase) * s.bob;
        s.obj.traverse((child) => {
            if (child.userData.spin) child.rotation.y += dt * 2;
        });
    });

    updateEffects(dt);
    if (coinFx) {
        coinFx.syncTwins(coins, Boolean(powers.x2), dt);
        coinFx.update(dt, running ? carryVelocity.set(state.speed, 0, 0) : null);
    }
    ui.coins.parentElement.classList.toggle('double', Boolean(powers.x2));

    if (player.root) {
        player.root.position.set(player.x, player.y, 0);
        let shadowTop = groundUnder(player.x) && player.y > GROUND_TOP - 0.3 ? GROUND_TOP : null;
        for (const l of ledges) {
            if (ledgeUnder(player.x, l) && l.top <= player.y + 0.05 && (shadowTop === null || l.top > shadowTop)) shadowTop = l.top;
        }
        player.shadow.visible = shadowTop !== null;
        player.shadow.position.set(player.x, (shadowTop ?? GROUND_TOP) + 0.02, 0);
        const s = Math.max(0.3, 1 - (player.y - (shadowTop ?? GROUND_TOP)) / (JUMP_HEIGHT * 2));
        player.shadow.scale.setScalar(s);
        player.shadow.material.opacity = 0.25 * s;
        if (player.skin) player.skin.update(dt, { position: player.root.position, worldVelocity: null, moving: running });
    }
    if (player.mixer) player.mixer.update(dt);

    // camera follows the runner, easing up a little on high jumps, with a shake on a crash
    const ax = cameraAnchorX();
    let shakeX = 0;
    let shakeY = 0;
    if (state.shake > 0) {
        state.shake = Math.max(0, state.shake - dt);
        shakeX = (Math.random() - 0.5) * state.shake * 0.7;
        shakeY = (Math.random() - 0.5) * state.shake * 0.7;
    }
    cameraDistance = THREE.MathUtils.lerp(cameraDistance, targetCameraDistance(), Math.min(1, dt * 2));
    const height = Math.max(0, player.y - GROUND_TOP);
    const lift = height * 0.15 + Math.max(0, height - JUMP_HEIGHT) * 0.5 + (player.flying ? 0.6 : 0);
    camera.position.set(ax + shakeX, CAM_HEIGHT + cameraDistance * 0.1 + lift + shakeY, cameraDistance);
    camTarget.set(ax, CAM_LOOK_Y + lift, 0);
    camera.lookAt(camTarget);

    skySphere.position.copy(camera.position);
    stars.position.copy(camera.position);
    sun.position.set(player.x - 4, 14, 9);
    sun.target.position.set(player.x + 3, 0, 0);
}

function loop() {
    const dt = Math.min(clock.getDelta(), 0.05);
    update(dt);
    renderer.render(scene, camera);
    requestAnimationFrame(loop);
}

// --------------------------------------------------------------- start
async function init() {
    try {
        await loadAssets();
    } catch (err) {
        console.error(err);
        ui.loadingText.textContent = 'שגיאה בטעינת המשחק. נסו לרענן את העמוד.';
        return;
    }

    // coins glow a little, so they stand out at sunset and at night too
    models.coin.traverse((c) => {
        if (c.isMesh) {
            c.material = c.material.clone();
            c.material.emissive = new THREE.Color(0x8a5a00);
            c.material.emissiveIntensity = 0.45;
        }
    });
    coinFx = createCoinFx({ scene, makeCoin: () => cloneModel('coin', 1, { cast: false, receive: false }), coinScale: COIN_SCALE });
    buildPlayer();
    resetGame();
    playAction('idle');

    state.mode = 'ready';
    ui.loading.classList.add('hidden');
    ui.hud.classList.remove('hidden');
    ui.mute.classList.remove('hidden');
    showOnly(ui.start);
    updateHud();
    clock.getDelta();
    loop();
}

// Read-only peek for automated testing: add ?debug to the address.
if (new URLSearchParams(window.location.search).has('debug')) {
    window.__skyHop = {
        state, player, getObstacles: () => obstacles, getPits: () => pits, startJump, endJump, setDrop,
        setStepHook: (fn) => { debugStepHook = fn; },
        activatePower, powers, getLedges: () => ledges, getCoins: () => coins,
        step: (dt) => update(dt),
    };
}

init();
