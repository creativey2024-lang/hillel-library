/**
 * ריצה בעיר (City Run)
 *
 * A three-lane endless runner for the Hillel library site's "משחק" menu.
 *
 * Gameplay is based on "Boxy Run" by Wan Fung Chui
 * (https://github.com/wanfungchui/boxy-run, Apache License 2.0 - see
 * LICENSE-boxy-run.txt): three lanes, lane switching, a sinusoidal jump,
 * rows of obstacles that get denser over time, and box-vs-box collisions.
 *
 * Modified from the original: ported to the current three.js module build,
 * frame-rate independent movement, the scene and characters replaced with
 * Kenney's CC0 3D models (city street, buildings, trucks, character, coins,
 * clouds, sounds), coins to collect, jumpable barriers vs. trucks you must
 * dodge, touch/swipe controls, a Hebrew interface, a saved high score, and
 * restarting without reloading the page.
 */
import * as THREE from 'three';
import { GLTFLoader } from './lib/loaders/GLTFLoader.js';

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

const JUMP_DURATION = 0.62;       // seconds
const JUMP_HEIGHT = 1.35;
const LANE_SWITCH_SPEED = 15;     // units / second sideways

const CHARACTER_SCALE = 1.4;
const TRUCK_SCALE = 1.1;
const BARRIER_SCALE = 0.85;
const COIN_SCALE = 1.7;

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
    finalScore: $('finalScore'),
    finalCoins: $('finalCoins'),
    finalBest: $('finalBest'),
    newBest: $('newBestBadge'),
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

['coin', 'jump', 'fall', 'land'].forEach(loadSound);
refreshMuteIcon();
ui.mute.addEventListener('click', (e) => {
    e.stopPropagation();
    muted = !muted;
    writeStorage(MUTE_KEY, muted ? '1' : '0');
    refreshMuteIcon();
});

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
// Based on Boxy Run's Character: lane switching, a queued jump, and a
// sinusoidal jump arc - now driving Kenney's animated character model.
const player = {
    root: null,
    mixer: null,
    actions: {},
    lane: 0,
    x: 0,
    y: 0,
    jumping: false,
    jumpTime: 0,
};

function buildPlayer() {
    player.root = new THREE.Group();
    const model = cloneModel('character', CHARACTER_SCALE);
    model.rotation.y = Math.PI; // the model faces the camera; turn it to run into the street
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
let obstacles = [];   // { mesh, type: 'truck' | 'barrier', lane }
let coins = [];       // { mesh, lane, baseY }
const TRUCKS = ['truckRed', 'truckYellow', 'truckGreen', 'truckPurple'];

function laneX(lane) {
    return lane * LANE_WIDTH;
}

function spawnRow(z, progress) {
    // How many lanes get blocked: never all three with something you can't
    // jump - there is always a way through (the original could block every lane).
    const blockedCount = Math.random() < 0.35 + progress * 0.4 ? 2 : 1;
    const shuffled = [...LANES].sort(() => Math.random() - 0.5);
    const blocked = shuffled.slice(0, blockedCount);
    const free = shuffled.slice(blockedCount);

    let trucksInRow = 0;
    blocked.forEach((lane) => {
        const wantTruck = Math.random() < 0.6;
        // with two blocked lanes, allow at most... both trucks is fine since one lane is free
        if (wantTruck) {
            trucksInRow += 1;
            const mesh = cloneModel(TRUCKS[Math.floor(Math.random() * TRUCKS.length)], TRUCK_SCALE);
            mesh.position.set(laneX(lane), 0, z);
            scene.add(mesh);
            obstacles.push({ mesh, type: 'truck', lane, halfLength: 1.45 * TRUCK_SCALE });
        } else {
            const mesh = cloneModel('brick', BARRIER_SCALE);
            mesh.scale.x = BARRIER_SCALE * 1.5;
            mesh.position.set(laneX(lane), 0, z);
            scene.add(mesh);
            obstacles.push({ mesh, type: 'barrier', lane, halfLength: 0.4 });

            // coins arcing over the barrier reward a good jump
            if (Math.random() < 0.5) {
                for (let i = -2; i <= 2; i++) {
                    const t = (i + 2) / 4;
                    addCoin(lane, z + i * 1.1, 0.75 + Math.sin(t * Math.PI) * JUMP_HEIGHT * 0.85);
                }
            }
        }
    });

    // a line of coins down one of the free lanes
    if (free.length && Math.random() < 0.75) {
        const lane = free[Math.floor(Math.random() * free.length)];
        const count = 4 + Math.floor(Math.random() * 4);
        for (let i = 0; i < count; i++) addCoin(lane, z + 2 - i * 1.4, 0.75);
    }
    return trucksInRow;
}

function addCoin(lane, z, y) {
    const mesh = cloneModel('coin', COIN_SCALE, { cast: true, receive: false });
    mesh.position.set(laneX(lane), y, z);
    scene.add(mesh);
    coins.push({ mesh, lane, baseY: y });
}

function clearObstacles() {
    obstacles.forEach((o) => scene.remove(o.mesh));
    coins.forEach((c) => scene.remove(c.mesh));
    obstacles = [];
    coins = [];
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
};

function progress() {
    return Math.min(1, (state.speed - START_SPEED) / (MAX_SPEED - START_SPEED));
}

function resetGame() {
    clearObstacles();
    state.speed = START_SPEED;
    state.elapsed = 0;
    state.distance = 0;
    state.coins = 0;
    state.score = 0;
    state.queuedJump = false;
    state.shake = 0;
    player.lane = 0;
    player.x = 0;
    player.y = 0;
    player.jumping = false;
    player.root.rotation.set(0, 0, 0);

    // first obstacles appear a little way ahead, giving time to get going
    let z = -34;
    while (z > -VIEW_DISTANCE) {
        spawnRow(z, 0);
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

function endRun() {
    state.mode = 'over';
    state.shake = 0.35;
    playSound('fall', 0.7);
    playAction('idle', 0.1);

    const isNewBest = state.score > state.best;
    if (isNewBest) {
        state.best = state.score;
        writeStorage(BEST_KEY, state.best);
    }
    ui.finalScore.textContent = state.score;
    ui.finalCoins.textContent = state.coins;
    ui.finalBest.textContent = state.best;
    ui.newBest.classList.toggle('hidden', !isNewBest);
    setTimeout(() => {
        if (state.mode === 'over') showOnly(ui.gameOver);
    }, 450);
}

// --------------------------------------------------------------- input
function moveLane(dir) {
    if (state.mode !== 'running') return;
    const target = Math.max(-1, Math.min(1, player.lane + dir));
    player.lane = target;
}

function jump() {
    if (state.mode !== 'running') return;
    if (player.jumping) {
        state.queuedJump = true; // buffered like Boxy Run's action queue
        return;
    }
    player.jumping = true;
    player.jumpTime = 0;
    playAction('jump', 0.05);
    playSound('jump', 0.45);
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
    else if (key === 'p' || key === 'P' || key === 'Escape') pauseRun();
});

// Swipe left/right to change lane, swipe up or tap to jump.
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
        state.mode = 'over';
        startRun();
    }
});

// ---------------------------------------------------------------- loop
const clock = new THREE.Clock();
const tmpLook = new THREE.Vector3();

function update(dt) {
    const running = state.mode === 'running';

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

        // scroll obstacles and coins, dropping the ones behind the camera
        obstacles.forEach((o) => { o.mesh.position.z += move; });
        coins.forEach((c) => { c.mesh.position.z += move; });
        obstacles = obstacles.filter((o) => {
            if (o.mesh.position.z - o.halfLength > 10) { scene.remove(o.mesh); return false; }
            return true;
        });
        coins = coins.filter((c) => {
            if (c.mesh.position.z > 10) { scene.remove(c.mesh); return false; }
            return true;
        });

        // new rows appear at the far end as the street scrolls
        state.nextRowIn -= move;
        if (state.nextRowIn <= 0) {
            spawnRow(-VIEW_DISTANCE + 4, progress());
            state.nextRowIn += rowGap();
        }

        // sideways movement toward the chosen lane
        const targetX = laneX(player.lane);
        const diff = targetX - player.x;
        const step = LANE_SWITCH_SPEED * dt;
        player.x = Math.abs(diff) <= step ? targetX : player.x + Math.sign(diff) * step;
        player.root.rotation.z = THREE.MathUtils.lerp(player.root.rotation.z, -diff * 0.12, 0.25);

        // jump arc (Boxy Run's sinusoidal jump)
        if (player.jumping) {
            player.jumpTime += dt;
            const t = player.jumpTime / JUMP_DURATION;
            if (t >= 1) {
                player.jumping = false;
                player.y = 0;
                playSound('land', 0.3);
                if (state.queuedJump) {
                    state.queuedJump = false;
                    jump();
                } else {
                    playAction('walk', 0.1);
                }
            } else {
                player.y = Math.sin(t * Math.PI) * JUMP_HEIGHT;
            }
        }

        // the run animation speeds up with the street
        if (currentAction === player.actions.walk) {
            currentAction.timeScale = 1.6 + progress() * 1.2;
        }

        checkCollisions();
        updateHud();
    }

    // coins spin and bob even on the start screen
    const now = performance.now() / 1000;
    coins.forEach((c) => {
        c.mesh.rotation.y += dt * 3.5;
        c.mesh.position.y = c.baseY + Math.sin(now * 4 + c.mesh.position.z) * 0.06;
    });

    clouds.forEach((c) => {
        c.position.z += (running ? state.speed * 0.25 : 0.6) * dt;
        if (c.position.z > 12) resetCloud(c, false);
    });

    if (player.root) {
        player.root.position.set(player.x, player.y, 0);
        player.shadow.position.x = player.x;
        const s = 1 - player.y / (JUMP_HEIGHT * 2.2);
        player.shadow.scale.setScalar(s);
        player.shadow.material.opacity = 0.22 * s;
    }
    if (player.mixer) player.mixer.update(dt);

    // camera follows the runner sideways, with a little shake on a crash
    const camX = THREE.MathUtils.lerp(camera.position.x, player.x * 0.55, Math.min(1, dt * 6));
    let shakeX = 0;
    let shakeY = 0;
    if (state.shake > 0) {
        state.shake = Math.max(0, state.shake - dt);
        shakeX = (Math.random() - 0.5) * state.shake * 0.8;
        shakeY = (Math.random() - 0.5) * state.shake * 0.8;
    }
    camera.position.set(camX + shakeX, CAMERA_OFFSET.y + player.y * 0.25 + shakeY, CAMERA_OFFSET.z);
    tmpLook.set(camX * 0.6, CAMERA_LOOK.y, CAMERA_LOOK.z);
    camera.lookAt(tmpLook);

    sun.position.set(player.x - 6, 14, 6);
    sun.target.position.set(player.x, 0, -6);
}

function checkCollisions() {
    // Box-vs-box test like Boxy Run's collisionsDetected(), with forgiving
    // hitboxes so near-misses that look fine also feel fine.
    const pMinX = player.x - 0.42;
    const pMaxX = player.x + 0.42;
    const pMinY = player.y;
    const pMaxY = player.y + 1.3;
    const pMinZ = -0.35;
    const pMaxZ = 0.35;

    for (const o of obstacles) {
        const p = o.mesh.position;
        let minX;
        let maxX;
        let maxY;
        if (o.type === 'truck') {
            minX = p.x - 0.72 * TRUCK_SCALE;
            maxX = p.x + 0.72 * TRUCK_SCALE;
            maxY = 1.3 * TRUCK_SCALE;
        } else {
            minX = p.x - 0.6;
            maxX = p.x + 0.6;
            maxY = BARRIER_SCALE * 0.78;
        }
        const minZ = p.z - o.halfLength;
        const maxZ = p.z + o.halfLength;
        if (pMaxX > minX && pMinX < maxX && pMinY < maxY && pMaxY > 0 && pMaxZ > minZ && pMinZ < maxZ) {
            endRun();
            return;
        }
    }

    coins = coins.filter((c) => {
        const p = c.mesh.position;
        const hit = Math.abs(p.x - player.x) < 0.8 && Math.abs(p.z) < 0.8
            && p.y > player.y - 0.4 && p.y < player.y + 1.8;
        if (hit) {
            scene.remove(c.mesh);
            state.coins += 1;
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

init();
