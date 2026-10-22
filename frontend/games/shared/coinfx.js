/**
 * Coin effects shared by both games:
 *  - With the x2 power-up every coin in the world really becomes TWO coins
 *    (a twin pops in and spins next to it), and you collect both.
 *  - Collected coins fly up, spin and shrink, with a "+1"/"+2" number and a
 *    few sparkles.
 */
import * as THREE from 'three';

const textCache = {};
function textTexture(text, color) {
    const key = `${text}|${color}`;
    if (textCache[key]) return textCache[key];
    const canvas = document.createElement('canvas');
    canvas.width = 128;
    canvas.height = 64;
    const ctx = canvas.getContext('2d');
    ctx.font = '900 46px system-ui, Arial, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineWidth = 9;
    ctx.strokeStyle = 'rgba(80, 40, 0, 0.85)';
    ctx.strokeText(text, 64, 34);
    ctx.fillStyle = color;
    ctx.fillText(text, 64, 34);
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    textCache[key] = tex;
    return tex;
}

let sparkTex = null;
function sparkTexture() {
    if (sparkTex) return sparkTex;
    const canvas = document.createElement('canvas');
    canvas.width = 32;
    canvas.height = 32;
    const ctx = canvas.getContext('2d');
    const g = ctx.createRadialGradient(16, 16, 0, 16, 16, 16);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.4, 'rgba(255,230,120,0.8)');
    g.addColorStop(1, 'rgba(255,200,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 32, 32);
    sparkTex = new THREE.CanvasTexture(canvas);
    return sparkTex;
}

const rand = (a, b) => a + Math.random() * (b - a);

/**
 * @param scene
 * @param makeCoin  () => a fresh coin object at scale 1 (unscaled model)
 * @param coinScale the scale the game draws coins at
 */
export function createCoinFx({ scene, makeCoin, coinScale = 1.5 }) {
    const flying = []; // { obj, life, max, vel, spin, kind }
    const tmp = new THREE.Vector3();

    function add(obj, max, vel, spin, kind) {
        scene.add(obj);
        flying.push({ obj, life: 0, max, vel, spin, kind });
    }

    return {
        /**
         * Give every coin a twin while x2 is on, and take the twins away when it ends.
         * coins: array of { mesh, twin? }
         */
        syncTwins(coins, on, dt) {
            for (const c of coins) {
                if (on && !c.twin) {
                    const twin = makeCoin();
                    // offset in the coin's own (unscaled) units; it spins with the coin
                    twin.position.set(0.24, 0.24, 0.02);
                    twin.scale.setScalar(0.001);
                    twin.userData.grow = 0;
                    c.mesh.add(twin);
                    c.twin = twin;
                } else if (!on && c.twin) {
                    c.mesh.remove(c.twin);
                    c.twin = null;
                }
                if (c.twin && c.twin.userData.grow < 1) {
                    // pop in with a little overshoot
                    const g = Math.min(1, c.twin.userData.grow + dt * 4);
                    c.twin.userData.grow = g;
                    const s = g < 1 ? Math.sin(g * Math.PI * 0.75) / Math.sin(Math.PI * 0.75) : 1;
                    c.twin.scale.setScalar(Math.max(0.001, s));
                }
            }
        },

        /** A coin (or two) was collected at `position`. */
        pickup(position, amount) {
            for (let i = 0; i < amount; i++) {
                const coin = makeCoin();
                coin.scale.setScalar(coinScale);
                coin.position.copy(position).add(tmp.set(i * 0.35 - (amount - 1) * 0.17, i * 0.2, 0));
                add(coin, 0.5, new THREE.Vector3(rand(-0.6, 0.6), 6 + i, 0), 22, 'coin');
            }
            const label = new THREE.Sprite(new THREE.SpriteMaterial({
                map: textTexture(`+${amount}`, amount > 1 ? '#fde047' : '#ffffff'),
                transparent: true, depthWrite: false, depthTest: false, fog: false, toneMapped: false,
            }));
            label.scale.set(1.1, 0.55, 1);
            label.renderOrder = 10;
            label.position.copy(position).add(tmp.set(0, 0.9, 0));
            add(label, 0.7, new THREE.Vector3(0, 2.6, 0), 0, 'text');
            for (let i = 0; i < 5; i++) {
                const spark = new THREE.Sprite(new THREE.SpriteMaterial({
                    map: sparkTexture(), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false,
                }));
                spark.scale.setScalar(0.35);
                spark.position.copy(position);
                const a = (i / 5) * Math.PI * 2;
                add(spark, 0.35, new THREE.Vector3(Math.cos(a) * 3, Math.sin(a) * 3, 0), 0, 'spark');
            }
        },

        /** carry: how fast the effects should travel along with the player (or null). */
        update(dt, carry) {
            for (let i = flying.length - 1; i >= 0; i--) {
                const f = flying[i];
                f.life += dt;
                const t = f.life / f.max;
                if (t >= 1) {
                    scene.remove(f.obj);
                    if (f.obj.material) f.obj.material.dispose();
                    flying.splice(i, 1);
                    continue;
                }
                f.obj.position.addScaledVector(f.vel, dt);
                if (carry) f.obj.position.addScaledVector(carry, dt);
                if (f.kind === 'coin') {
                    f.vel.y -= 10 * dt;
                    f.obj.rotation.y += f.spin * dt;
                    f.obj.scale.setScalar(coinScale * (1 - t * 0.7));
                } else if (f.kind === 'text') {
                    f.obj.material.opacity = t < 0.6 ? 1 : 1 - (t - 0.6) / 0.4;
                    f.vel.y *= 0.92;
                } else {
                    f.obj.material.opacity = 1 - t;
                }
            }
        },

        clear() {
            flying.forEach((f) => scene.remove(f.obj));
            flying.length = 0;
        },
    };
}
