/**
 * Character skins shared by both games. Bought in the library site's game
 * shop; the site tells the game which one is worn with ?skin=<id> in the
 * game's address. The more effects a skin has, the more it costs:
 *
 *   gold   (1,000) - shiny gold body + twinkling sparkles
 *   neon   (2,500) - glow-in-the-dark body + light trail + flash ring on jumps
 *   galaxy (5,000) - colour-shifting body + star trail + spinning halo
 *                    + star burst on landing
 *
 * Everything is drawn with three.js (no extra files), so it can't clash with
 * the games' own models.
 */
import * as THREE from 'three';

export const SKIN_IDS = ['gold', 'neon', 'galaxy'];

export function skinFromUrl() {
    try {
        const id = new URLSearchParams(window.location.search).get('skin');
        return SKIN_IDS.includes(id) ? id : '';
    } catch (e) {
        return '';
    }
}

// ------------------------------------------------------------- textures
function canvasTexture(size, draw) {
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    draw(canvas.getContext('2d'), size);
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
}

let glowTexture = null;
let starTexture = null;

function getGlowTexture() {
    if (!glowTexture) {
        glowTexture = canvasTexture(64, (ctx, s) => {
            const g = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
            g.addColorStop(0, 'rgba(255,255,255,1)');
            g.addColorStop(0.35, 'rgba(255,255,255,0.6)');
            g.addColorStop(1, 'rgba(255,255,255,0)');
            ctx.fillStyle = g;
            ctx.fillRect(0, 0, s, s);
        });
    }
    return glowTexture;
}

function getStarTexture() {
    if (!starTexture) {
        starTexture = canvasTexture(64, (ctx, s) => {
            const c = s / 2;
            const g = ctx.createRadialGradient(c, c, 0, c, c, c * 0.5);
            g.addColorStop(0, 'rgba(255,255,255,1)');
            g.addColorStop(1, 'rgba(255,255,255,0)');
            ctx.fillStyle = g;
            ctx.fillRect(0, 0, s, s);
            ctx.fillStyle = 'rgba(255,255,255,0.95)';
            ctx.beginPath();
            // four-pointed sparkle
            for (let i = 0; i < 8; i++) {
                const r = i % 2 === 0 ? c * 0.95 : c * 0.16;
                const a = (i / 8) * Math.PI * 2 - Math.PI / 2;
                const x = c + Math.cos(a) * r;
                const y = c + Math.sin(a) * r;
                if (i === 0) ctx.moveTo(x, y);
                else ctx.lineTo(x, y);
            }
            ctx.closePath();
            ctx.fill();
        });
    }
    return starTexture;
}

// ------------------------------------------------------------ particles
// A small pool of camera-facing sprites. Particles live in world space; the
// game passes the velocity the ground is moving at, so trails are left behind
// correctly in both the forward-running and the side-scrolling game.
class Particles {
    constructor(scene, max = 70) {
        this.scene = scene;
        this.items = [];
        for (let i = 0; i < max; i++) {
            const mat = new THREE.SpriteMaterial({
                map: getGlowTexture(),
                transparent: true,
                depthWrite: false,
                fog: false,
                toneMapped: false, // keep the sparkles' colours bright
            });
            const sprite = new THREE.Sprite(mat);
            sprite.visible = false;
            scene.add(sprite);
            this.items.push({ sprite, life: 0, maxLife: 1, vel: new THREE.Vector3(), size: 1, spin: 0, alive: false, grow: 0 });
        }
        this.next = 0;
    }

    emit({ position, velocity, color, size = 0.3, life = 0.6, star = false, spin = 0, grow = 0, additive = false }) {
        const p = this.items[this.next];
        this.next = (this.next + 1) % this.items.length;
        p.alive = true;
        p.life = 0;
        p.maxLife = life;
        p.size = size;
        p.spin = spin;
        p.grow = grow;
        p.vel.copy(velocity || new THREE.Vector3());
        p.sprite.position.copy(position);
        p.sprite.material.map = star ? getStarTexture() : getGlowTexture();
        // additive glows look great on dark colours but vanish on a light sky,
        // so only the neon trail uses it
        p.sprite.material.blending = additive ? THREE.AdditiveBlending : THREE.NormalBlending;
        p.sprite.material.color.set(color);
        p.sprite.material.rotation = Math.random() * Math.PI;
        p.sprite.visible = true;
        p.sprite.scale.setScalar(size);
    }

    update(dt, worldVelocity) {
        for (const p of this.items) {
            if (!p.alive) continue;
            p.life += dt;
            const t = p.life / p.maxLife;
            if (t >= 1) {
                p.alive = false;
                p.sprite.visible = false;
                continue;
            }
            p.sprite.position.addScaledVector(p.vel, dt);
            if (worldVelocity) p.sprite.position.addScaledVector(worldVelocity, dt);
            p.sprite.material.opacity = Math.sin(Math.min(1, t * 4) * Math.PI / 2) * (1 - t);
            p.sprite.material.rotation += p.spin * dt;
            p.sprite.scale.setScalar(p.size * (1 + p.grow * t));
        }
    }

    dispose() {
        this.items.forEach((p) => {
            this.scene.remove(p.sprite);
            p.sprite.material.dispose();
        });
    }
}

function eachMaterial(model, fn) {
    model.traverse((child) => {
        if (child.isMesh) {
            const mats = Array.isArray(child.material) ? child.material : [child.material];
            const cloned = mats.map((m) => {
                const c = m.clone();
                fn(c);
                return c;
            });
            child.material = Array.isArray(child.material) ? cloned : cloned[0];
        }
    });
}

const rand = (a, b) => a + Math.random() * (b - a);

// A glowing outline: a copy of each part, pushed out along its normals and
// drawn from the inside, so a coloured rim shows around the character.
function addOutline(model, color, thickness) {
    const material = new THREE.MeshBasicMaterial({ color, side: THREE.BackSide, fog: false });
    material.onBeforeCompile = (shader) => {
        shader.vertexShader = shader.vertexShader.replace(
            '#include <begin_vertex>',
            `#include <begin_vertex>\n transformed += normalize(normal) * ${thickness.toFixed(3)};`
        );
    };
    const meshes = [];
    model.traverse((child) => { if (child.isMesh) meshes.push(child); });
    meshes.forEach((mesh) => {
        const shell = new THREE.Mesh(mesh.geometry, material);
        shell.castShadow = false;
        shell.receiveShadow = false;
        mesh.add(shell);
    });
    return material;
}

/**
 * Puts a skin on the character model.
 * @param model   the character's three.js object (its meshes get new materials)
 * @param scene   where particles go
 * @param skinId  'gold' | 'neon' | 'galaxy' | '' (no skin)
 * @param height  the character's height in world units
 * @returns { update(dt, info), onJump(pos), onLand(pos) }
 *          info = { position: feet position (Vector3), worldVelocity: Vector3, moving: bool }
 */
export function applySkin({ model, scene, skinId, height = 1.4 }) {
    const noop = { update() {}, onJump() {}, onLand() {}, id: '' };
    if (!SKIN_IDS.includes(skinId)) return noop;

    const particles = new Particles(scene);
    const tmp = new THREE.Vector3();
    const vel = new THREE.Vector3();
    let time = 0;
    let emitTimer = 0;

    if (skinId === 'gold') {
        eachMaterial(model, (m) => {
            m.color = new THREE.Color(0xffe27a);
            if ('metalness' in m) {
                m.metalness = 0.3;
                m.roughness = 0.25;
            }
            m.emissive = new THREE.Color(0xc08a00);
            m.emissiveIntensity = 0.55;
        });
        return {
            id: skinId,
            update(dt, info) {
                time += dt;
                emitTimer -= dt;
                if (emitTimer <= 0) {
                    emitTimer = rand(0.08, 0.18);
                    tmp.copy(info.position).add(vel.set(rand(-0.45, 0.45), rand(0.1, height * 1.05), rand(-0.3, 0.3)));
                    particles.emit({ position: tmp, velocity: vel.set(0, 0.3, 0), color: 0xfff06a, size: rand(0.3, 0.5), life: rand(0.35, 0.6), star: true, spin: 3 });
                }
                particles.update(dt, info.worldVelocity);
            },
            onJump() {},
            onLand() {},
        };
    }

    if (skinId === 'neon') {
        const baseColor = new THREE.Color(0x00e5ff);
        eachMaterial(model, (m) => {
            m.emissiveMap = m.map || null;
            m.color = new THREE.Color(0x05040d);
            m.emissive = baseColor.clone();
            m.emissiveIntensity = 1.8;
        });
        const mats = [];
        model.traverse((c) => { if (c.isMesh) mats.push(c.material); });
        const outline = addOutline(model, 0x22e6ff, 0.035);
        // a ring of light that flashes out from the feet on every jump
        const ring = new THREE.Mesh(
            new THREE.RingGeometry(0.3, 0.42, 40),
            new THREE.MeshBasicMaterial({ color: 0xff3df2, transparent: true, opacity: 0, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false, fog: false })
        );
        ring.rotation.x = -Math.PI / 2;
        scene.add(ring);
        let ringT = 1;
        return {
            id: skinId,
            update(dt, info) {
                time += dt;
                const pulse = 1.6 + Math.sin(time * 6) * 0.4;
                mats.forEach((m) => { m.emissiveIntensity = pulse; });
                outline.color.setHSL(0.52 + Math.sin(time * 2) * 0.08, 1, 0.55);
                emitTimer -= dt;
                if (info.moving && emitTimer <= 0) {
                    emitTimer = 0.025;
                    const pink = Math.random() < 0.35;
                    tmp.copy(info.position).add(vel.set(rand(-0.15, 0.15), rand(0.2, height * 0.8), rand(-0.1, 0.1)));
                    particles.emit({ position: tmp, velocity: vel.set(0, 0, 0), color: pink ? 0xff3df2 : 0x22e6ff, size: rand(0.25, 0.45), life: 0.45, additive: true });
                }
                if (ringT < 1) {
                    ringT = Math.min(1, ringT + dt * 2.2);
                    ring.scale.setScalar(1 + ringT * 3);
                    ring.material.opacity = (1 - ringT) * 0.9;
                    if (info.worldVelocity) ring.position.addScaledVector(info.worldVelocity, dt);
                }
                particles.update(dt, info.worldVelocity);
            },
            onJump(pos) {
                ring.position.copy(pos).add(vel.set(0, 0.06, 0));
                ringT = 0;
            },
            onLand() {},
        };
    }

    // galaxy
    const mats = [];
    eachMaterial(model, (m) => {
        m.emissiveMap = m.map || null;
        m.color = new THREE.Color(0x0d0620);
        m.emissive = new THREE.Color(0x8a5cff);
        m.emissiveIntensity = 0.85;
        mats.push(m);
    });
    const halo = new THREE.Mesh(
        new THREE.TorusGeometry(0.62, 0.045, 10, 48),
        new THREE.MeshBasicMaterial({ color: 0xb48cff, transparent: true, opacity: 0.9, depthWrite: false, fog: false })
    );
    halo.rotation.x = Math.PI / 2;
    scene.add(halo);
    const halo2 = halo.clone();
    halo2.material = halo.material.clone();
    halo2.material.color.set(0x5ce1ff);
    halo2.scale.setScalar(0.75);
    scene.add(halo2);
    const hsl = new THREE.Color();
    const COLORS = [0xffffff, 0x9b6bff, 0x38bdf8, 0xff5fc8, 0xffe14d];

    return {
        id: skinId,
        update(dt, info) {
            time += dt;
            hsl.setHSL((0.62 + time * 0.08) % 1, 1, 0.5);
            mats.forEach((m) => m.emissive.copy(hsl));
            halo.material.color.copy(hsl);

            halo.position.copy(info.position).add(vel.set(0, height * 0.55, 0));
            halo.rotation.z += dt * 2.5;
            halo.rotation.x = Math.PI / 2 + Math.sin(time * 2) * 0.35;
            halo2.position.copy(info.position).add(vel.set(0, height * 0.18, 0));
            halo2.rotation.x = Math.PI / 2 + Math.cos(time * 2.3) * 0.3;

            emitTimer -= dt;
            if (emitTimer <= 0) {
                emitTimer = info.moving ? 0.03 : 0.12;
                tmp.copy(info.position).add(vel.set(rand(-0.4, 0.4), rand(0.1, height), rand(-0.3, 0.3)));
                particles.emit({
                    position: tmp,
                    velocity: vel.set(rand(-0.3, 0.3), rand(0, 0.5), rand(-0.3, 0.3)),
                    color: COLORS[Math.floor(Math.random() * COLORS.length)],
                    size: rand(0.18, 0.4),
                    life: rand(0.5, 0.9),
                    star: Math.random() < 0.7,
                    spin: 2,
                });
            }
            particles.update(dt, info.worldVelocity);
        },
        onJump() {},
        onLand(pos) {
            for (let i = 0; i < 18; i++) {
                const a = (i / 18) * Math.PI * 2;
                tmp.copy(pos).add(vel.set(0, 0.15, 0));
                particles.emit({
                    position: tmp,
                    velocity: vel.set(Math.cos(a) * 3, rand(0.5, 2), Math.sin(a) * 3),
                    color: COLORS[i % COLORS.length],
                    size: 0.32,
                    life: 0.55,
                    star: true,
                    spin: 4,
                });
            }
        },
    };
}
