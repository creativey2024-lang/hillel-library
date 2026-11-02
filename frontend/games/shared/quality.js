/**
 * Graphics quality for the big 3D games ("קרב באי" and "הגנה על הספרייה").
 *
 * Three levels: high, medium and low ("חסכונית"). The game decides what each
 * level means (shadows, lights, grass, how far you see); this file decides
 * WHICH level to use:
 *   - a first guess from the computer (its graphics chip, cores, memory, a phone?)
 *   - while playing it watches the frame rate: it first renders slightly fewer
 *     pixels (you hardly notice), and only if that isn't enough it drops a level
 *   - the player can also pick a level by hand (saved on this computer)
 */
const KEY = 'hillel_gfx';
export const LEVELS = ['low', 'medium', 'high'];
export const LEVEL_NAMES = { high: 'גבוהה', medium: 'בינונית', low: 'חסכונית' };
const CHOICES = ['auto', 'high', 'medium', 'low'];

function readChoice() {
    try {
        const v = window.localStorage.getItem(KEY);
        return CHOICES.includes(v) ? v : 'auto';
    } catch (e) {
        return 'auto';
    }
}
function saveChoice(v) {
    try {
        window.localStorage.setItem(KEY, v);
    } catch (e) {
        // (private mode: just not remembered)
    }
}

/** A first guess, before the game has run a single frame. */
export function guessLevel(renderer) {
    let gpu = '';
    try {
        const gl = renderer.getContext();
        const ext = gl.getExtension('WEBGL_debug_renderer_info');
        if (ext) gpu = String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) || '');
    } catch (e) {
        // unknown chip
    }
    const g = gpu.toLowerCase();
    // no real graphics chip at all
    if (/swiftshader|llvmpipe|softpipe|software|basic render|microsoft basic/.test(g)) return 'low';
    let score = 2;
    // chips built into the processor (most school laptops) and phone chips
    const builtIn = /intel|mali|adreno|powervr|videocore|vivante|mesa/.test(g) && !/iris\s*xe|\barc\b/.test(g);
    if (builtIn) score -= 1;
    const cores = navigator.hardwareConcurrency || 4;
    const memory = navigator.deviceMemory || 4;
    if (cores <= 2 || memory <= 2) score -= 1;
    else if (cores <= 4 && memory <= 4) score -= 0.5;
    const phone = window.matchMedia && window.matchMedia('(pointer: coarse)').matches;
    if (phone) score -= 1;
    // a big screen full of pixels is more work
    const pixels = window.screen.width * window.screen.height * (window.devicePixelRatio || 1) ** 2;
    if (pixels > 2560 * 1440) score -= 0.5;
    return score >= 2 ? 'high' : score >= 1 ? 'medium' : 'low';
}

/**
 * renderer: the three.js renderer
 * apply(level): the game switches its shadows / lights / grass / view distance
 * pixelRatio(level): how sharp each level renders (before the automatic scaling)
 * forceLow: start (and stay) at the lowest level (?lowgfx)
 */
export function createQuality({ renderer, apply, pixelRatio, forceLow = false }) {
    let choice = forceLow ? 'low' : readChoice();
    const guessed = guessLevel(renderer);
    let level = choice === 'auto' ? guessed : choice;
    let scale = 1; // fewer pixels when the computer is struggling (0.65 .. 1)
    const minScale = { high: 0.75, medium: 0.65, low: 0.65 };
    const listeners = [];

    function setPixels() {
        const pr = Math.max(0.4, pixelRatio(level) * scale);
        if (Math.abs(renderer.getPixelRatio() - pr) > 0.01) renderer.setPixelRatio(pr);
    }

    function setLevel(next) {
        level = next;
        scale = 1;
        apply(level);
        setPixels();
        listeners.forEach((fn) => fn());
    }

    // watching the frame rate (only while really playing)
    const watch = { frames: 0, time: 0, good: 0, cool: 0 };
    function frame(rawDt, active) {
        if (!active || rawDt > 0.25) return; // a hiccup (or a hidden tab) says nothing
        watch.frames += 1;
        watch.time += rawDt;
        watch.cool = Math.max(0, watch.cool - rawDt);
        if (watch.time < 1.5) return;
        const ms = (watch.time / watch.frames) * 1000;
        watch.frames = 0;
        watch.time = 0;
        if (watch.cool > 0) return;
        if (ms > 21) {
            // slower than ~48 frames a second
            watch.good = 0;
            if (scale > minScale[level] + 0.001) {
                scale = Math.max(minScale[level], scale - (ms > 33 ? 0.15 : 0.08));
                setPixels();
                listeners.forEach((fn) => fn());
            } else if (choice === 'auto' && level !== 'low' && ms > 24) {
                setLevel(LEVELS[LEVELS.indexOf(level) - 1]);
                scale = 0.9;
                setPixels();
                watch.cool = 3; // let it settle (new shaders get built)
            }
        } else if (ms < 14) {
            // smooth: slowly bring the sharpness back
            watch.good += 1;
            if (watch.good >= 2 && scale < 1) {
                scale = Math.min(1, scale + 0.05);
                setPixels();
                watch.good = 0;
            }
        } else watch.good = 0;
    }

    function setChoice(next) {
        if (!CHOICES.includes(next)) return;
        choice = next;
        if (!forceLow) saveChoice(next);
        setLevel(next === 'auto' ? guessed : next);
    }

    // the next option on a "graphics" button
    function cycle() {
        setChoice(CHOICES[(CHOICES.indexOf(choice) + 1) % CHOICES.length]);
    }

    function label() {
        return choice === 'auto' ? `אוטומטי · ${LEVEL_NAMES[level]}` : LEVEL_NAMES[level];
    }

    function start() {
        apply(level);
        setPixels();
    }

    return {
        start,
        frame,
        setChoice,
        cycle,
        label,
        onChange: (fn) => listeners.push(fn),
        get level() { return level; },
        get choice() { return choice; },
        get scale() { return scale; },
        refreshPixels: setPixels,
    };
}

/**
 * A "graphics" button (in the pause menu and in the lobby): each press picks
 * the next setting: automatic -> high -> medium -> low.
 */
export function qualityButton(quality, className = '') {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `gfx-btn ${className}`;
    const paint = () => {
        btn.innerHTML = `<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path fill="currentColor" d="M3 5h18v11H3zM8 19h8v2H8zm3-3h2v3h-2z" opacity=".35"/><path fill="currentColor" d="M5 7h14v7H5z"/></svg><span>גרפיקה: <b>${quality.label()}</b></span>`;
        btn.title = 'לחצו כדי להחליף: אוטומטי / גבוהה / בינונית / חסכונית';
    };
    btn.addEventListener('click', (e) => {
        e.stopPropagation();
        quality.cycle();
    });
    quality.onChange(paint);
    paint();
    return btn;
}

/**
 * Soft round shadows under the characters - for the low setting, where the
 * real shadows are off (so people still look like they stand on the ground).
 */
export function createBlobShadows(THREE, scene) {
    const c = document.createElement('canvas');
    c.width = 64;
    c.height = 64;
    const g = c.getContext('2d');
    const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    grad.addColorStop(0, 'rgba(0,0,0,0.55)');
    grad.addColorStop(0.55, 'rgba(0,0,0,0.3)');
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, 64, 64);
    const tex = new THREE.CanvasTexture(c);
    const material = new THREE.MeshBasicMaterial({ map: tex, transparent: true, opacity: 0.85, depthWrite: false, fog: false });
    const geometry = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
    // all of them in one draw (an instanced mesh): far above the ground = smaller
    const MAX = 96;
    const mesh = new THREE.InstancedMesh(geometry, material, MAX);
    mesh.count = 0;
    mesh.frustumCulled = false;
    mesh.renderOrder = 1;
    mesh.visible = false;
    scene.add(mesh);
    const m4 = new THREE.Matrix4();
    let on = false;
    let used = 0;
    function begin() {
        used = 0;
    }
    // one shadow at (x, groundY, z), `size` wide, smaller the higher the thing is above the ground
    function put(x, groundY, z, size, height = 0) {
        if (!on || used >= MAX) return;
        const k = Math.max(0, 1 - height / 8);
        if (k < 0.05) return;
        const w = size * (0.45 + 0.55 * k);
        m4.makeScale(w, 1, w).setPosition(x, groundY + 0.04, z);
        mesh.setMatrixAt(used, m4);
        used += 1;
    }
    function end() {
        mesh.count = used;
        mesh.instanceMatrix.needsUpdate = true;
    }
    function setEnabled(v) {
        on = v;
        mesh.visible = v;
        if (!on) mesh.count = 0;
    }
    return { begin, put, end, setEnabled, get enabled() { return on; } };
}
