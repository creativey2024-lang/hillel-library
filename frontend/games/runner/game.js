/**
 * ריצה בעיר (City Run)
 *
 * A three-lane endless runner for the Hillel library site's "משחק" menu.
 *
 * Gameplay is based on "Boxy Run" by Wan Fung Chui
 * (https://github.com/wanfungchui/boxy-run, Apache License 2.0 - see
 * LICENSE-boxy-run.txt): three lanes, lane switching, jumping, rows of
 * obstacles that get denser over time, and box-vs-box collisions.
 *
 * Modified from the original: ported to the current three.js module build,
 * frame-rate independent movement, the scene and characters replaced with
 * Kenney's CC0 3D models (city street, buildings, trucks, character, coins,
 * clouds, sounds), coins to collect, jumpable barriers vs. trucks you must
 * dodge, trucks and trains that drive toward you (placed so there is always a
 * way through), train roofs you can run on, power-ups (super-jump shoes, coin
 * magnet, double coins), skins from the site's shop, touch/swipe controls, a
 * Hebrew interface, a saved high score, and restarting without reloading.
 */
import * as THREE from 'three';
import { GLTFLoader } from '../shared/lib/loaders/GLTFLoader.js';
import { applySkin, skinFromUrl } from '../shared/skins.js';
import { POWERUPS, createPowerupMesh, createPowerupHud } from '../shared/powerups.js';
import { createBridge } from '../shared/bridge.js';

// ---------------------------------------------------------------- settings
const TILE = 2.7;                 // size of one city tile in world units
const LANE_WIDTH = 1.8;
const LANES = [-1, 0, 1];
// The road tile is asphalt in the middle with a curb strip on each side;
// this width puts all three lanes on the asphalt.
const ROAD_WIDTH = 8.6;
const SEGMENT_COUNT = 34;         // street segments kept alive (~92 units of street)
const VIEW_DISTANCE = SEGMENT_COUNT * TILE;

const START_SPEED = 11;           // units / second
const MAX_SPEED = 25;
const SPEED_GAIN = 0.22;          // extra speed per second survived

// Jumps use real gravity so you can land on train roofs. Normal jumps clear
// barriers; with the super-jump shoes you can jump over trucks and up onto trains.
const JUMPS = {
    normal: { height: 1.35, time: 0.62 },
    super: { height: 3.3, time: 1.0 },
};
for (const j of Object.values(JUMPS)) {
    j.gravity = (8 * j.height) / (j.time * j.time);
    j.velocity = (4 * j.height) / j.time;
}
const LANE_SWITCH_SPEED = 15;     // units / second sideways
const PLAYER_HALF_DEPTH = 0.35;

const CHARACTER_SCALE = 1.4;
const TRUCK_SCALE = 1.1;
const BARRIER_SCALE = 0.85;
const COIN_SCALE = 1.7;

// Trains are built from simple shapes in the same low-poly style.
const CAR_LENGTH = 5.4;
const CAR_GAP = 0.35;
const TRAIN_WIDTH = 1.5;
const TRAIN_ROOF = 2.05;
const TRUCK_ROOF = 1.3 * TRUCK_SCALE;

// Vehicles coming toward you are placed only where you can still get past:
// at any moment at least one lane stays open, with this much time to spare.
const FAIRNESS_MARGIN = 0.5;      // seconds

const BEST_KEY = 'hillel_city_runner_best';
const MUTE_KEY = 'hillel_city_runner_muted';

// ------------------------------------------------------------------- DOM
const $ = (id) => document.getElementById(id);
const ui = {
    world: $('world'),
    hud: $('hud'),
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

const rand = (a, b) => a + Math.random() * (b - a);
const pick = (list) => list[Math.floor(Math.random() * list.length)];
const shuffle = (list) => [...list].sort(() => Math.random() - 0.5);

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

function playSound(name, volume = 0.6, rate = 1) {
    if (muted || !sounds[name]) return;
    try {
        const s = sounds[name].cloneNode();
        s.volume = volume;
        s.playbackRate = rate;
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

['coin', 'jump', 'fall', 'land'].forEach(loadSound);
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
renderer.toneMappingExposure = 1.05;
ui.world.appendChild(renderer.domElement);

const scene = new THREE.Scene();
const SKY = new THREE.Color(0x9fd6ff);
scene.background = SKY;
scene.fog = new THREE.Fog(SKY, VIEW_DISTANCE * 0.45, VIEW_DISTANCE * 0.95);

const camera = new THREE.PerspectiveCamera(58, 1, 0.1, VIEW_DISTANCE * 1.5);
const CAMERA_OFFSET = new THREE.Vector3(0, 4.3, 7.2);
const CAMERA_LOOK = new THREE.Vector3(0, 1.1, -7);

scene.add(new THREE.HemisphereLight(0xffffff, 0x7d8ca3, 1.5));
const sun = new THREE.DirectionalLight(0xfff4e0, 2.4);
sun.position.set(-6, 14, 6);
sun.castShadow = true;
sun.shadow.mapSize.set(1024, 1024);
sun.shadow.camera.left = -14;
sun.shadow.camera.right = 14;
sun.shadow.camera.top = 14;
sun.shadow.camera.bottom = -24;
sun.shadow.camera.near = 1;
sun.shadow.camera.far = 50;
sun.shadow.bias = -0.0008;
scene.add(sun);
scene.add(sun.target);

function resize() {
    const w = ui.world.clientWidth || window.innerWidth;
    const h = ui.world.clientHeight || window.innerHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    // Narrow (portrait) screens need a wider view to keep all three lanes visible.
    camera.fov = camera.aspect < 1 ? 72 : 58;
    camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);
resize();

// --------------------------------------------------------------- models
const MODEL_FILES = {
    character: 'platformer/character',
    coin: 'platformer/coin',
    brick: 'platformer/brick',
    cloud: 'platformer/cloud',
    road: 'city/road-straight',
    pavement: 'city/pavement',
    grass: 'city/grass',
    trees: 'city/grass-trees',
    treesTall: 'city/grass-trees-tall',
    buildingA: 'city/building-small-a',
    buildingB: 'city/building-small-b',
    buildingC: 'city/building-small-c',
    buildingD: 'city/building-small-d',
    garage: 'city/building-garage',
    truckRed: 'racing/vehicle-truck-red',
    truckYellow: 'racing/vehicle-truck-yellow',
    truckGreen: 'racing/vehicle-truck-green',
    truckPurple: 'racing/vehicle-truck-purple',
};

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

async function loadModels() {
    const loader = new GLTFLoader();
    const entries = Object.entries(MODEL_FILES);
    let done = 0;
    await Promise.all(entries.map(async ([key, file]) => {
        const gltf = await loader.loadAsync(`./models/${file}.glb`);
        models[key] = gltf.scene;
        if (key === 'character') characterAnimations = gltf.animations;
        done += 1;
        ui.loadingText.textContent = `טוען את העיר... ${Math.round((done / entries.length) * 100)}%`;
    }));
}

function cloneModel(key, scale = 1, shadows) {
    const obj = prepare(models[key].clone(true), shadows);
    obj.scale.setScalar(scale);
    return obj;
}

let glowTex = null;
function glowTexture() {
    if (glowTex) return glowTex;
    const canvas = document.createElement('canvas');
    canvas.width = 64;
    canvas.height = 64;
    const ctx = canvas.getContext('2d');
    const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
    g.addColorStop(0, 'rgba(255,255,240,1)');
    g.addColorStop(0.3, 'rgba(255,250,200,0.55)');
    g.addColorStop(1, 'rgba(255,250,200,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 64, 64);
    glowTex = new THREE.CanvasTexture(canvas);
    return glowTex;
}

// A pair of glowing headlights, so you can see a vehicle is driving at you.
function addHeadlights(group, xOffset, y, z, size = 1) {
    [-1, 1].forEach((side) => {
        const glow = new THREE.Sprite(new THREE.SpriteMaterial({
            map: glowTexture(), color: 0xfff6c8, transparent: true, depthWrite: false,
            blending: THREE.AdditiveBlending, fog: false,
        }));
        glow.position.set(side * xOffset, y, z);
        glow.scale.setScalar(1.3 * size);
        group.add(glow);
    });
}

// ---------------------------------------------------------------- trains
const trainMats = {};
function trainMaterial(key, color, extra = {}) {
    if (!trainMats[key]) trainMats[key] = new THREE.MeshStandardMaterial({ color, roughness: 0.6, metalness: 0.1, ...extra });
    return trainMats[key];
}

let carBodyGeometry = null;
function getCarBodyGeometry() {
    if (carBodyGeometry) return carBodyGeometry;
    // rounded-corner cross-section, pushed along the length of the car
    const w = TRAIN_WIDTH;
    const h = TRAIN_ROOF - 0.3;
    const r = 0.32;
    const shape = new THREE.Shape();
    shape.moveTo(-w / 2, 0);
    shape.lineTo(w / 2, 0);
    shape.lineTo(w / 2, h - r);
    shape.quadraticCurveTo(w / 2, h, w / 2 - r, h);
    shape.lineTo(-w / 2 + r, h);
    shape.quadraticCurveTo(-w / 2, h, -w / 2, h - r);
    shape.closePath();
    carBodyGeometry = new THREE.ExtrudeGeometry(shape, { depth: CAR_LENGTH, bevelEnabled: false, curveSegments: 6 });
    carBodyGeometry.translate(0, 0.3, -CAR_LENGTH / 2);
    return carBodyGeometry;
}

const TRAIN_COLORS = [0xe11d48, 0x2563eb, 0x16a34a, 0xf59e0b, 0x7c3aed];

function box(w, h, d, mat, x, y, z) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    m.position.set(x, y, z);
    m.castShadow = true;
    m.receiveShadow = true;
    return m;
}

// A train of `cars` carriages. Its front (facing the player) is at z = +length/2.
function makeTrain(cars, moving) {
    const group = new THREE.Group();
    const stripeColor = pick(TRAIN_COLORS);
    const bodyMat = trainMaterial('body', 0xf1f5f9);
    const stripeMat = trainMaterial(`stripe-${stripeColor}`, stripeColor);
    const glassMat = trainMaterial('glass', 0x1e293b, { roughness: 0.2, emissive: 0x0b1a33, emissiveIntensity: 0.6 });
    const darkMat = trainMaterial('dark', 0x334155);
    const roofMat = trainMaterial('roof', 0x94a3b8);
    const noseMat = trainMaterial('nose', 0xfacc15);
    const lampMat = trainMaterial(moving ? 'lamp-on' : 'lamp-off', 0xffffff, { emissive: moving ? 0xfff2b0 : 0x333333, emissiveIntensity: moving ? 2 : 0.3 });

    const length = cars * CAR_LENGTH + (cars - 1) * CAR_GAP;
    for (let i = 0; i < cars; i++) {
        const z = length / 2 - CAR_LENGTH / 2 - i * (CAR_LENGTH + CAR_GAP);
        const body = new THREE.Mesh(getCarBodyGeometry(), bodyMat);
        body.position.z = z;
        body.castShadow = true;
        body.receiveShadow = true;
        group.add(body);
        // coloured stripe and window band on both sides
        [-1, 1].forEach((side) => {
            group.add(box(0.04, 0.22, CAR_LENGTH - 0.3, stripeMat, side * (TRAIN_WIDTH / 2 + 0.01), 0.75, z));
            group.add(box(0.04, 0.5, CAR_LENGTH - 0.9, glassMat, side * (TRAIN_WIDTH / 2 + 0.01), 1.35, z));
        });
        group.add(box(0.7, 0.18, CAR_LENGTH * 0.45, roofMat, 0, TRAIN_ROOF + 0.06, z));
        // wheels
        [-1, 1].forEach((end) => group.add(box(TRAIN_WIDTH * 0.8, 0.3, 1.2, darkMat, 0, 0.15, z + end * (CAR_LENGTH / 2 - 1))));
        // connector to the next car
        if (i < cars - 1) group.add(box(1.0, 1.2, CAR_GAP + 0.1, darkMat, 0, 1.0, z - CAR_LENGTH / 2 - CAR_GAP / 2));
    }

    // the front: yellow nose, windscreen and lamps
    const front = length / 2 + 0.02;
    group.add(box(TRAIN_WIDTH * 0.98, 0.75, 0.06, noseMat, 0, 0.75, front));
    group.add(box(TRAIN_WIDTH * 0.8, 0.55, 0.06, glassMat, 0, 1.45, front));
    [-1, 1].forEach((side) => {
        const lamp = new THREE.Mesh(new THREE.CircleGeometry(0.12, 16), lampMat);
        lamp.position.set(side * 0.48, 0.62, front + 0.04);
        group.add(lamp);
    });
    if (moving) addHeadlights(group, 0.48, 0.62, front + 0.1, 1.2);
    return { group, length };
}

// ----------------------------------------------------------- the street
// Each segment is one TILE-long slice of street: the road, the sidewalks,
// and a building or trees on each side. Segments scroll toward the camera
// and are recycled to the far end, so the street never ends.
const segments = [];
const SIDE_PROPS = ['buildingA', 'buildingB', 'buildingC', 'buildingD', 'garage', 'trees', 'treesTall', 'buildingA', 'buildingC'];

function makeSegment(index) {
    const group = new THREE.Group();

    const road = cloneModel('road', 1, { cast: false, receive: true });
    // stretch the road tile sideways to fit three lanes
    road.scale.set(ROAD_WIDTH, 1, TILE);
    group.add(road);

    const roadHalf = ROAD_WIDTH / 2;
    [-1, 1].forEach((side) => {
        const walk = cloneModel('pavement', TILE, { cast: false, receive: true });
        walk.scale.y = 1;
        walk.position.set(side * (roadHalf + TILE / 2), 0, 0);
        group.add(walk);

        const propKey = SIDE_PROPS[Math.floor(Math.random() * SIDE_PROPS.length)];
        const prop = cloneModel(propKey, TILE);
        prop.position.set(side * (roadHalf + TILE * 1.5), 0, 0);
        // buildings face the street
        prop.rotation.y = side < 0 ? Math.PI / 2 : -Math.PI / 2;
        group.add(prop);

        const back = cloneModel(Math.random() < 0.5 ? 'treesTall' : 'grass', TILE, { cast: false, receive: true });
        back.position.set(side * (roadHalf + TILE * 2.5), 0, 0);
        group.add(back);
    });

    group.position.z = -index * TILE + TILE;
    scene.add(group);
    return group;
}

// --------------------------------------------------------------- clouds
const clouds = [];
function makeClouds() {
    for (let i = 0; i < 12; i++) {
        const c = new THREE.Group();
        const puffs = 3 + Math.floor(Math.random() * 3);
        for (let j = 0; j < puffs; j++) {
            const size = 1.6 + Math.random() * 1.6;
            const puff = cloneModel('cloud', size, { cast: false, receive: false });
            puff.position.set((j - puffs / 2) * 1.5 + Math.random() * 0.6, Math.random() * 0.8, Math.random() * 1.5);
            puff.traverse((child) => {
                if (child.isMesh) {
                    child.material = child.material.clone();
                    child.material.emissive = new THREE.Color(0xffffff);
                    child.material.emissiveIntensity = 0.55;
                    child.material.fog = false;
                }
            });
            c.add(puff);
        }
        resetCloud(c, true);
        scene.add(c);
        clouds.push(c);
    }
}

function resetCloud(c, anywhere) {
    const side = Math.random() < 0.5 ? -1 : 1;
    c.position.set(side * (8 + Math.random() * 18), 11 + Math.random() * 7,
        anywhere ? -Math.random() * VIEW_DISTANCE : -VIEW_DISTANCE);
}

// ------------------------------------------------------------ character
const player = {
    root: null,
    model: null,
    mixer: null,
    actions: {},
    skin: null,
    lane: 0,
    x: 0,
    y: 0,
    vy: 0,
    gravity: JUMPS.normal.gravity,
    onGround: true,
};

function buildPlayer() {
    player.root = new THREE.Group();
    const model = cloneModel('character', CHARACTER_SCALE);
    model.rotation.y = Math.PI; // the model faces the camera; turn it to run into the street
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

    // blob shadow keeps the runner grounded visually even mid-jump
    const shadow = new THREE.Mesh(
        new THREE.CircleGeometry(0.55, 24),
        new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.22, depthWrite: false })
    );
    shadow.rotation.x = -Math.PI / 2;
    shadow.position.y = 0.07;
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
// { mesh, type: 'barrier'|'truck'|'train', lane, halfLength, halfWidth, maxY, vz, jumpable, roof }
let obstacles = [];
let coins = [];       // { mesh, lane, baseY, magnet }
let pickups = [];     // power-ups lying on the street: { mesh, kind, lane }
const TRUCKS = ['truckRed', 'truckYellow', 'truckGreen', 'truckPurple'];

function laneX(lane) {
    return lane * LANE_WIDTH;
}

// When will this thing be level with the runner (z = 0)? [start, end] in seconds.
function passWindow(z, halfLength, vz) {
    const closing = state.speed + vz;
    const start = Math.max(0, (-PLAYER_HALF_DEPTH - (z + halfLength)) / closing);
    const end = (PLAYER_HALF_DEPTH - (z - halfLength)) / closing;
    return [start, end];
}

// True if adding this unjumpable thing still leaves a lane you can actually
// reach at every moment. Allowed at the same time: nothing, one side lane,
// the middle lane alone, or both side lanes (then the middle is open). Never
// the middle plus a side lane - you could be trapped on the far side.
function leavesAWayThrough(lane, z, halfLength, vz) {
    const [start, end] = passWindow(z, halfLength, vz);
    if (end < 0) return true;
    const blocked = new Set([lane]);
    for (const o of obstacles) {
        if (o.jumpable) continue;
        const [s, e] = passWindow(o.mesh.position.z, o.halfLength, o.vz);
        if (e < 0) continue;
        if (s < end + FAIRNESS_MARGIN && e > start - FAIRNESS_MARGIN) blocked.add(o.lane);
    }
    if (blocked.size === LANES.length) return false;
    return !(blocked.has(0) && blocked.size > 1);
}

// Something already standing in this lane around z?
function laneTaken(lane, z, halfLength) {
    return obstacles.some((o) => o.lane === lane
        && Math.abs(o.mesh.position.z - z) < o.halfLength + halfLength + 1.5);
}

// A vehicle can only drive toward you if it won't drive into something
// standing in its lane before that thing has gone past you.
function laneClearAhead(lane, frontZ, vz) {
    for (const o of obstacles) {
        if (o.lane !== lane) continue;
        const back = o.mesh.position.z - o.halfLength;
        if (back <= frontZ) continue; // behind it
        if (vz <= o.vz) continue;     // never catches up
        const catchUp = (back - frontZ) / (vz - o.vz);
        const goneBy = (12 - back) / (state.speed + o.vz); // out of sight behind the camera
        if (catchUp < goneBy) return false;
    }
    return true;
}

function addBarrier(lane, z) {
    const mesh = cloneModel('brick', BARRIER_SCALE);
    mesh.scale.x = BARRIER_SCALE * 1.5;
    mesh.position.set(laneX(lane), 0, z);
    scene.add(mesh);
    obstacles.push({ mesh, type: 'barrier', lane, halfLength: 0.4, halfWidth: 0.6, maxY: BARRIER_SCALE * 0.78, vz: 0, jumpable: true, roof: 0 });
    // coins arcing over the barrier reward a good jump
    if (Math.random() < 0.5) {
        for (let i = -2; i <= 2; i++) {
            const t = (i + 2) / 4;
            addCoin(lane, z + i * 1.1, 0.75 + Math.sin(t * Math.PI) * JUMPS.normal.height * 0.85);
        }
    }
}

function addTruck(lane, z, vz) {
    const mesh = cloneModel(pick(TRUCKS), TRUCK_SCALE);
    mesh.position.set(laneX(lane), 0, z);
    if (vz > 0) addHeadlights(mesh, 0.42, 0.55, 1.45, 0.8);
    scene.add(mesh);
    obstacles.push({ mesh, type: 'truck', lane, halfLength: 1.45 * TRUCK_SCALE, halfWidth: 0.72 * TRUCK_SCALE, maxY: TRUCK_ROOF, vz, jumpable: false, roof: TRUCK_ROOF });
}

function addTrain(lane, z, cars, vz) {
    const { group, length } = makeTrain(cars, vz > 0);
    // z is where the front of the train is
    group.position.set(laneX(lane), 0, z - length / 2);
    scene.add(group);
    obstacles.push({ mesh: group, type: 'train', lane, halfLength: length / 2, halfWidth: TRAIN_WIDTH / 2, maxY: TRAIN_ROOF, vz, jumpable: false, roof: TRAIN_ROOF });
    // coins along the roof, for whoever gets up there with the jump shoes
    if (vz === 0 && Math.random() < 0.6) {
        const count = Math.floor(length / 1.6);
        for (let i = 0; i < count; i++) addCoin(lane, z - 1 - i * 1.6, TRAIN_ROOF + 0.75);
    }
}

// Picks what goes into one blocked lane of a row, keeping the game fair.
// vz > 0 asks for a vehicle driving toward you.
function placeBlocker(lane, z, vz = 0) {
    const p = progress();
    if (laneTaken(lane, z, 2)) return;

    let kind;
    if (vz > 0) {
        kind = state.elapsed > 14 && Math.random() < 0.4 ? 'train' : 'truck';
    } else {
        const r = Math.random();
        kind = 'barrier';
        if (state.elapsed > 12 && r < 0.18 + p * 0.1) kind = 'train';
        else if (r < 0.62) kind = 'truck';
    }
    if (kind === 'barrier') {
        addBarrier(lane, z);
        return;
    }

    if (kind === 'train') {
        const cars = vz > 0 ? (Math.random() < 0.5 ? 2 : 3) : (Math.random() < 0.4 ? 2 : 3);
        const length = cars * CAR_LENGTH + (cars - 1) * CAR_GAP;
        const half = length / 2;
        if (!laneTaken(lane, z - half, half)) {
            if (vz > 0 && laneClearAhead(lane, z, vz) && leavesAWayThrough(lane, z - half, half, vz)) return addTrain(lane, z, cars, vz);
            if (leavesAWayThrough(lane, z - half, half, 0)) return addTrain(lane, z, cars, 0);
        }
    } else {
        const half = 1.45 * TRUCK_SCALE;
        if (vz > 0 && laneClearAhead(lane, z + half, vz) && leavesAWayThrough(lane, z, half, vz)) return addTruck(lane, z, vz);
        if (leavesAWayThrough(lane, z, half, 0)) return addTruck(lane, z, 0);
    }
    // no fair way to put a vehicle here - a barrier you can jump over instead
    addBarrier(lane, z);
}

// Vehicles that drive toward you are announced a few rows early: those rows
// keep that lane empty, so the vehicle has a clear road and never drives
// through other obstacles (like the train lanes in Subway Surfers).
const RESERVE_ROWS = 3;

function spawnRow(z) {
    const p = progress();
    const r = state.reserve;
    let blockedCount = Math.random() < 0.35 + p * 0.4 ? 2 : 1;
    let candidates = shuffle(LANES);
    let movingLane = null;

    if (r && r.rowsLeft > 0) {
        // keep the coming vehicle's lane free, and leave one more lane open
        candidates = candidates.filter((l) => l !== r.lane).concat([r.lane]);
        blockedCount = 1;
        r.rowsLeft -= 1;
    } else if (r) {
        movingLane = r.lane;
        candidates = [r.lane, ...candidates.filter((l) => l !== r.lane)];
        blockedCount = Math.min(blockedCount, 2);
        state.reserve = null;
    } else if (state.elapsed > 7 && Math.random() < 0.14 + p * 0.2) {
        state.reserve = { lane: pick(LANES), rowsLeft: RESERVE_ROWS };
    }

    const blocked = candidates.slice(0, blockedCount);
    const free = candidates.slice(blockedCount);
    blocked.forEach((lane) => {
        const vz = lane === movingLane ? (rand(5, 7) + p * 4) : 0;
        placeBlocker(lane, z, vz);
    });

    if (!free.length) return;
    const lane = pick(free);
    // now and then a power-up instead of a line of coins
    if (state.elapsed > 4 && pickups.length === 0 && Math.random() < 0.11) {
        addPickup(pick(['shoes', 'shoes', 'magnet', 'x2']), lane, z + 1);
    } else if (Math.random() < 0.75 && !laneTaken(lane, z, 2) && !(state.reserve && state.reserve.lane === lane)) {
        const count = 4 + Math.floor(Math.random() * 4);
        for (let i = 0; i < count; i++) addCoin(lane, z + 2 - i * 1.4, 0.75);
    }
}

function addCoin(lane, z, y) {
    const mesh = cloneModel('coin', COIN_SCALE, { cast: true, receive: false });
    mesh.position.set(laneX(lane), y, z);
    scene.add(mesh);
    coins.push({ mesh, lane, baseY: y, magnet: false });
}

function addPickup(kind, lane, z) {
    const mesh = createPowerupMesh(kind, 1);
    mesh.position.set(laneX(lane), 1.0, z);
    scene.add(mesh);
    pickups.push({ mesh, kind, lane });
}

function clearObstacles() {
    obstacles.forEach((o) => scene.remove(o.mesh));
    coins.forEach((c) => scene.remove(c.mesh));
    pickups.forEach((p) => scene.remove(p.mesh));
    obstacles = [];
    coins = [];
    pickups = [];
}

// ------------------------------------------------------------ power-ups
const powerHud = createPowerupHud(document.body);
const powers = {}; // kind -> seconds left

function activatePower(kind) {
    powers[kind] = POWERUPS[kind].seconds;
    playSound('coin', 0.6, 0.7);
}

function updatePowers(dt) {
    for (const kind of Object.keys(powers)) {
        powers[kind] -= dt;
        if (powers[kind] <= 0) {
            delete powers[kind];
            powerHud.remove(kind);
        } else {
            powerHud.set(kind, powers[kind], POWERUPS[kind].seconds);
        }
    }
}

// ------------------------------------------------------------ game state
const state = {
    mode: 'loading', // loading | ready | running | paused | over
    speed: START_SPEED,
    elapsed: 0,
    distance: 0,
    coins: 0,
    score: 0,
    best: parseInt(readStorage(BEST_KEY, '0'), 10) || 0,
    nextRowIn: 0,
    queuedJump: false,
    shake: 0,
    reserve: null, // { lane, rowsLeft } - a vehicle is coming in this lane
};

function progress() {
    return Math.min(1, (state.speed - START_SPEED) / (MAX_SPEED - START_SPEED));
}

const bridge = createBridge('runner', {
    getRunCoins: () => state.coins,
    onSaved: showSaved,
});

function showSaved(info) {
    if (!ui.savedNote) return;
    ui.savedNote.classList.remove('hidden', 'warn');
    if (info.error) {
        ui.savedNote.textContent = 'לא הצלחנו לשמור את המטבעות הפעם';
        ui.savedNote.classList.add('warn');
    } else if (info.limitedByDay) {
        ui.savedNote.textContent = `+${info.earned} נשמרו בחשבון · הגעת למגבלה היומית (יש לך ${info.coins.toLocaleString()})`;
        ui.savedNote.classList.add('warn');
    } else {
        ui.savedNote.textContent = `+${info.earned} מטבעות נשמרו בחשבון · יש לך ${info.coins.toLocaleString()}`;
    }
}

function resetGame() {
    clearObstacles();
    Object.keys(powers).forEach((k) => delete powers[k]);
    powerHud.clear();
    state.speed = START_SPEED;
    state.elapsed = 0;
    state.distance = 0;
    state.coins = 0;
    state.score = 0;
    state.queuedJump = false;
    state.shake = 0;
    state.reserve = null;
    player.lane = 0;
    player.x = 0;
    player.y = 0;
    player.vy = 0;
    player.onGround = true;
    player.root.rotation.set(0, 0, 0);

    // first obstacles appear a little way ahead, giving time to get going
    let z = -34;
    while (z > -VIEW_DISTANCE) {
        spawnRow(z);
        z -= rowGap();
    }
    // z is now where the next row belongs; it reaches the spawn point after this distance
    state.nextRowIn = (-VIEW_DISTANCE + 4) - z;
    updateHud();
}

function rowGap() {
    // Gap scales with speed so there's always ~1 second to react, and slowly
    // tightens as the run goes on (Boxy Run's difficulty levels, smoothed out).
    const reactionSeconds = 1.15 - progress() * 0.35;
    return Math.max(9, state.speed * reactionSeconds + 3);
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
    state.mode = 'over';
    state.shake = 0.35;
    playSound('fall', 0.7);
    playAction('idle', 0.1);
    Object.keys(powers).forEach((k) => delete powers[k]);
    powerHud.clear();

    const isNewBest = state.score > state.best;
    if (isNewBest) {
        state.best = state.score;
        writeStorage(BEST_KEY, state.best);
    }
    const titles = { train: 'אוי! נתקלת ברכבת', truck: 'אוי! נתקלת במשאית', barrier: 'אוי! נתקלת במחסום' };
    if (ui.gameOverTitle) ui.gameOverTitle.textContent = titles[reason] || 'אוי! נתקלת במכשול';
    ui.finalScore.textContent = state.score;
    ui.finalCoins.textContent = state.coins;
    ui.finalBest.textContent = state.best;
    ui.newBest.classList.toggle('hidden', !isNewBest);
    if (ui.savedNote) {
        ui.savedNote.classList.toggle('hidden', !bridge.embedded || state.coins === 0);
        ui.savedNote.classList.remove('warn');
        ui.savedNote.textContent = 'שומר את המטבעות בחשבון...';
    }
    bridge.runEnded(state.coins);
    setTimeout(() => {
        if (state.mode === 'over') showOnly(ui.gameOver);
    }, 450);
}

// --------------------------------------------------------------- input
function moveLane(dir) {
    if (state.mode !== 'running') return;
    player.lane = Math.max(-1, Math.min(1, player.lane + dir));
}

function jump() {
    if (state.mode !== 'running') return;
    if (!player.onGround) {
        state.queuedJump = true; // buffered like Boxy Run's action queue
        return;
    }
    const profile = powers.shoes ? JUMPS.super : JUMPS.normal;
    player.onGround = false;
    player.vy = profile.velocity;
    player.gravity = profile.gravity;
    playAction('jump', 0.05);
    playSound('jump', 0.45, powers.shoes ? 0.8 : 1);
    if (player.skin) player.skin.onJump(player.root.position);
}

// down while in the air: come back down quickly
function fastDrop() {
    if (state.mode !== 'running' || player.onGround) return;
    player.vy = Math.min(player.vy, -JUMPS.normal.velocity * 1.4);
}

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
    if (key === 'ArrowLeft' || key === 'a' || key === 'A') moveLane(-1);
    else if (key === 'ArrowRight' || key === 'd' || key === 'D') moveLane(1);
    else if (key === 'ArrowUp' || key === ' ' || key === 'w' || key === 'W') jump();
    else if (key === 'ArrowDown' || key === 's' || key === 'S') fastDrop();
    else if (key === 'p' || key === 'P' || key === 'Escape') pauseRun();
});

// Swipe left/right to change lane, swipe up or tap to jump, swipe down to drop.
let touchStart = null;
ui.world.addEventListener('pointerdown', (e) => {
    touchStart = { x: e.clientX, y: e.clientY, t: performance.now() };
});
ui.world.addEventListener('pointerup', (e) => {
    if (!touchStart) return;
    const dx = e.clientX - touchStart.x;
    const dy = e.clientY - touchStart.y;
    const dt = performance.now() - touchStart.t;
    touchStart = null;

    if (state.mode !== 'running') return;
    const absX = Math.abs(dx);
    const absY = Math.abs(dy);
    if (absX < 20 && absY < 20 && dt < 350) {
        jump();
    } else if (absX > absY && absX > 30) {
        moveLane(dx > 0 ? 1 : -1);
    } else if (dy < -30) {
        jump();
    } else if (dy > 30) {
        fastDrop();
    }
});

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
        bridge.runEnded(state.coins); // keep the coins of the run that was cut short
        state.mode = 'over';
        startRun();
    }
});

// ---------------------------------------------------------------- loop
const clock = new THREE.Clock();
const tmpLook = new THREE.Vector3();
const worldVelocity = new THREE.Vector3();
const magnetTarget = new THREE.Vector3();

// Height of whatever the runner is standing on: a train or truck roof, or the street.
function supportHeight() {
    let h = 0;
    for (const o of obstacles) {
        if (!o.roof) continue;
        const p = o.mesh.position;
        if (Math.abs(p.x - player.x) < o.halfWidth + 0.15
            && PLAYER_HALF_DEPTH > p.z - o.halfLength && -PLAYER_HALF_DEPTH < p.z + o.halfLength) {
            h = Math.max(h, o.roof);
        }
    }
    return h;
}

function update(dt) {
    const running = state.mode === 'running';
    const now = performance.now() / 1000;

    if (running) {
        state.elapsed += dt;
        state.speed = Math.min(MAX_SPEED, START_SPEED + state.elapsed * SPEED_GAIN);
        const move = state.speed * dt;
        state.distance += move;
        state.score = Math.floor(state.distance) + state.coins * 10;

        // scroll the street
        segments.forEach((seg) => {
            seg.position.z += move;
            if (seg.position.z > TILE * 2) seg.position.z -= SEGMENT_COUNT * TILE;
        });

        // scroll obstacles, coins and power-ups; vehicles also drive toward you
        obstacles.forEach((o) => { o.mesh.position.z += move + o.vz * dt; });
        coins.forEach((c) => { if (!c.magnet) c.mesh.position.z += move; });
        pickups.forEach((p) => { p.mesh.position.z += move; });
        obstacles = obstacles.filter((o) => {
            if (o.mesh.position.z - o.halfLength > 10) { scene.remove(o.mesh); return false; }
            return true;
        });
        coins = coins.filter((c) => {
            if (c.mesh.position.z > 10) { scene.remove(c.mesh); return false; }
            return true;
        });
        pickups = pickups.filter((p) => {
            if (p.mesh.position.z > 10) { scene.remove(p.mesh); return false; }
            return true;
        });

        // new rows appear at the far end as the street scrolls
        state.nextRowIn -= move;
        if (state.nextRowIn <= 0) {
            spawnRow(-VIEW_DISTANCE + 4);
            state.nextRowIn += rowGap();
        }

        // sideways movement toward the chosen lane
        const targetX = laneX(player.lane);
        const diff = targetX - player.x;
        const step = LANE_SWITCH_SPEED * dt;
        player.x = Math.abs(diff) <= step ? targetX : player.x + Math.sign(diff) * step;
        player.root.rotation.z = THREE.MathUtils.lerp(player.root.rotation.z, -diff * 0.12, 0.25);

        // jumping, falling, landing on roofs
        const support = supportHeight();
        if (player.onGround) {
            if (player.y > support + 0.01) {
                // ran off the end of a roof
                player.onGround = false;
                player.vy = 0;
                player.gravity = JUMPS.normal.gravity;
            } else {
                player.y = support;
            }
        }
        if (!player.onGround) {
            const prevY = player.y;
            player.vy -= player.gravity * dt;
            player.y += player.vy * dt;
            if (player.vy <= 0 && player.y <= support && prevY >= support - 0.25) {
                player.y = support;
                player.vy = 0;
                player.onGround = true;
                playSound('land', 0.3);
                if (player.skin) player.skin.onLand(player.root.position);
                if (state.queuedJump) {
                    state.queuedJump = false;
                    jump();
                } else {
                    playAction('walk', 0.1);
                }
            }
        }

        // the run animation speeds up with the street
        if (currentAction === player.actions.walk) {
            currentAction.timeScale = 1.6 + progress() * 1.2;
        }

        updatePowers(dt);
        checkCollisions(dt);
        updateHud();
    }

    // coins spin and bob even on the start screen
    coins.forEach((c) => {
        c.mesh.rotation.y += dt * 3.5;
        if (!c.magnet) c.mesh.position.y = c.baseY + Math.sin(now * 4 + c.mesh.position.z) * 0.06;
    });
    pickups.forEach((p) => p.mesh.userData.animate(now));

    clouds.forEach((c) => {
        c.position.z += (running ? state.speed * 0.25 : 0.6) * dt;
        if (c.position.z > 12) resetCloud(c, false);
    });

    if (player.root) {
        player.root.position.set(player.x, player.y, 0);
        const ground = supportHeight();
        player.shadow.position.set(player.x, ground + 0.07, 0);
        const s = Math.max(0.3, 1 - (player.y - ground) / (JUMPS.normal.height * 2.2));
        player.shadow.scale.setScalar(s);
        player.shadow.material.opacity = 0.22 * s;
        worldVelocity.set(0, 0, running ? state.speed : 0);
        if (player.skin) player.skin.update(dt, { position: player.root.position, worldVelocity, moving: running });
    }
    if (player.mixer) player.mixer.update(dt);

    // camera follows the runner sideways and up onto roofs, with a little shake on a crash
    const camX = THREE.MathUtils.lerp(camera.position.x, player.x * 0.55, Math.min(1, dt * 6));
    let shakeX = 0;
    let shakeY = 0;
    if (state.shake > 0) {
        state.shake = Math.max(0, state.shake - dt);
        shakeX = (Math.random() - 0.5) * state.shake * 0.8;
        shakeY = (Math.random() - 0.5) * state.shake * 0.8;
    }
    const camY = THREE.MathUtils.lerp(camera.position.y || CAMERA_OFFSET.y, CAMERA_OFFSET.y + player.y * 0.45, Math.min(1, dt * 4));
    camera.position.set(camX + shakeX, camY + shakeY, CAMERA_OFFSET.z);
    tmpLook.set(camX * 0.6, CAMERA_LOOK.y + player.y * 0.3, CAMERA_LOOK.z);
    camera.lookAt(tmpLook);

    sun.position.set(player.x - 6, 14, 6);
    sun.target.position.set(player.x, 0, -6);
}

function checkCollisions(dt) {
    // Box-vs-box test like Boxy Run's collisionsDetected(), with forgiving
    // hitboxes so near-misses that look fine also feel fine.
    const pMinX = player.x - 0.42;
    const pMaxX = player.x + 0.42;
    const pMinY = player.y;
    const pMaxY = player.y + 1.3;

    for (const o of obstacles) {
        const p = o.mesh.position;
        // standing on (or flying over) it is fine
        if (pMinY >= o.maxY - 0.08) continue;
        const minX = p.x - o.halfWidth;
        const maxX = p.x + o.halfWidth;
        const minZ = p.z - o.halfLength;
        const maxZ = p.z + o.halfLength;
        if (pMaxX > minX && pMinX < maxX && pMinY < o.maxY && pMaxY > 0 && PLAYER_HALF_DEPTH > minZ && -PLAYER_HALF_DEPTH < maxZ) {
            if (state.testNoCrash) continue;
            endRun(o.type);
            return;
        }
    }

    // power-ups
    pickups = pickups.filter((pu) => {
        const p = pu.mesh.position;
        if (Math.abs(p.x - player.x) < 0.9 && Math.abs(p.z) < 0.9 && p.y > player.y - 0.5 && p.y < player.y + 2) {
            scene.remove(pu.mesh);
            activatePower(pu.kind);
            return false;
        }
        return true;
    });

    // the magnet pulls nearby coins in
    magnetTarget.set(player.x, player.y + 0.8, 0);
    coins.forEach((c) => {
        const p = c.mesh.position;
        if (powers.magnet && !c.magnet && p.z > -16 && p.z < 1.5) c.magnet = true;
        // coins already flying keep coming even if the magnet just ran out
        if (c.magnet) p.lerp(magnetTarget, Math.min(1, dt * 9));
    });

    const value = powers.x2 ? 2 : 1;
    coins = coins.filter((c) => {
        const p = c.mesh.position;
        const hit = c.magnet
            ? p.distanceTo(magnetTarget) < 0.7
            : Math.abs(p.x - player.x) < 0.8 && Math.abs(p.z) < 0.8 && p.y > player.y - 0.4 && p.y < player.y + 1.8;
        if (hit) {
            scene.remove(c.mesh);
            state.coins += value;
            playSound('coin', 0.35);
            return false;
        }
        return true;
    });
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
        await loadModels();
    } catch (err) {
        console.error(err);
        ui.loadingText.textContent = 'שגיאה בטעינת המשחק. נסו לרענן את העמוד.';
        return;
    }

    for (let i = 0; i < SEGMENT_COUNT; i++) segments.push(makeSegment(i));
    makeClouds();
    buildPlayer();
    camera.position.copy(CAMERA_OFFSET);
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
    window.__cityRun = {
        state, player, powers, getObstacles: () => obstacles, getPickups: () => pickups, jump, moveLane, activatePower,
        step: (dt) => update(dt),
    };
}

init();
