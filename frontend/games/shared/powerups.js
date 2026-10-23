/**
 * Power-up items shared by both games: how they look in the world (a glowing
 * badge with an icon inside a spinning ring) and the little timer badges in
 * the corner of the screen. Icons are drawn on a canvas, so no image files.
 */
import * as THREE from 'three';

export const POWERUPS = {
    shoes: { label: 'נעלי קפיצה', color: '#22c55e', seconds: 10 },
    magnet: { label: 'מגנט', color: '#ef4444', seconds: 10 },
    x2: { label: 'מטבעות כפול', color: '#f59e0b', seconds: 12 },
    double: { label: 'קפיצה כפולה', color: '#3b82f6', seconds: 12 },
    shield: { label: 'מגן', color: '#a855f7', seconds: 0 }, // lasts until it saves you once
    jetpack: { label: 'רקטה', color: '#f97316', seconds: 5 },
};

function drawIcon(ctx, kind, s) {
    const c = s / 2;
    ctx.fillStyle = '#fff';
    ctx.strokeStyle = '#fff';
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    if (kind === 'shoes') {
        // sneaker with a wing of speed lines
        ctx.beginPath();
        ctx.moveTo(s * 0.18, s * 0.66);
        ctx.lineTo(s * 0.18, s * 0.42);
        ctx.quadraticCurveTo(s * 0.2, s * 0.32, s * 0.32, s * 0.33);
        ctx.lineTo(s * 0.44, s * 0.36);
        ctx.quadraticCurveTo(s * 0.52, s * 0.52, s * 0.7, s * 0.52);
        ctx.quadraticCurveTo(s * 0.84, s * 0.54, s * 0.84, s * 0.66);
        ctx.closePath();
        ctx.fill();
        ctx.fillRect(s * 0.16, s * 0.68, s * 0.7, s * 0.07);
        ctx.lineWidth = s * 0.05;
        [[0.42, 0.18], [0.56, 0.24], [0.7, 0.32]].forEach(([x, y]) => {
            ctx.beginPath();
            ctx.moveTo(s * x, s * (y + 0.1));
            ctx.lineTo(s * x, s * y);
            ctx.stroke();
        });
    } else if (kind === 'magnet') {
        ctx.lineWidth = s * 0.16;
        ctx.beginPath();
        ctx.arc(c, s * 0.45, s * 0.22, Math.PI, 0, true);
        ctx.stroke();
        ctx.lineCap = 'butt';
        ctx.beginPath();
        ctx.moveTo(c - s * 0.22, s * 0.45);
        ctx.lineTo(c - s * 0.22, s * 0.22);
        ctx.moveTo(c + s * 0.22, s * 0.45);
        ctx.lineTo(c + s * 0.22, s * 0.22);
        ctx.stroke();
        ctx.strokeStyle = 'rgba(255,255,255,0.55)';
        ctx.beginPath();
        ctx.moveTo(c - s * 0.22, s * 0.3);
        ctx.lineTo(c - s * 0.22, s * 0.22);
        ctx.moveTo(c + s * 0.22, s * 0.3);
        ctx.lineTo(c + s * 0.22, s * 0.22);
        ctx.stroke();
    } else if (kind === 'x2') {
        ctx.font = `900 ${Math.round(s * 0.42)}px system-ui, Arial, sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('x2', c, c + s * 0.02);
    } else if (kind === 'double') {
        ctx.lineWidth = s * 0.1;
        [0.62, 0.4].forEach((y) => {
            ctx.beginPath();
            ctx.moveTo(c - s * 0.2, s * y + s * 0.08);
            ctx.lineTo(c, s * y - s * 0.1);
            ctx.lineTo(c + s * 0.2, s * y + s * 0.08);
            ctx.stroke();
        });
    } else if (kind === 'jetpack') {
        // a little rocket with a flame
        ctx.save();
        ctx.translate(c, c);
        ctx.rotate(-Math.PI / 4);
        ctx.beginPath();
        ctx.moveTo(0, -s * 0.34);
        ctx.quadraticCurveTo(s * 0.13, -s * 0.2, s * 0.12, s * 0.12);
        ctx.lineTo(-s * 0.12, s * 0.12);
        ctx.quadraticCurveTo(-s * 0.13, -s * 0.2, 0, -s * 0.34);
        ctx.fill();
        ctx.beginPath();
        ctx.moveTo(s * 0.12, s * 0.02);
        ctx.lineTo(s * 0.22, s * 0.18);
        ctx.lineTo(s * 0.12, s * 0.14);
        ctx.moveTo(-s * 0.12, s * 0.02);
        ctx.lineTo(-s * 0.22, s * 0.18);
        ctx.lineTo(-s * 0.12, s * 0.14);
        ctx.fill();
        ctx.fillStyle = '#fde047';
        ctx.beginPath();
        ctx.moveTo(-s * 0.07, s * 0.15);
        ctx.quadraticCurveTo(0, s * 0.42, s * 0.07, s * 0.15);
        ctx.fill();
        ctx.fillStyle = POWERUPS.jetpack.color;
        ctx.beginPath();
        ctx.arc(0, -s * 0.12, s * 0.05, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
    } else if (kind === 'shield') {
        ctx.beginPath();
        ctx.moveTo(c, s * 0.18);
        ctx.lineTo(s * 0.76, s * 0.28);
        ctx.quadraticCurveTo(s * 0.76, s * 0.66, c, s * 0.84);
        ctx.quadraticCurveTo(s * 0.24, s * 0.66, s * 0.24, s * 0.28);
        ctx.closePath();
        ctx.fill();
        ctx.fillStyle = POWERUPS.shield.color;
        ctx.beginPath();
        ctx.moveTo(c, s * 0.3);
        ctx.lineTo(s * 0.64, s * 0.36);
        ctx.quadraticCurveTo(s * 0.64, s * 0.6, c, s * 0.72);
        ctx.closePath();
        ctx.fill();
    }
}

const iconCache = {};

/** A canvas with the icon on a coloured disc (used for the world badge and the HUD). */
export function iconCanvas(kind, size = 128) {
    const key = `${kind}:${size}`;
    if (iconCache[key]) return iconCache[key];
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    const c = size / 2;
    const def = POWERUPS[kind];
    const g = ctx.createRadialGradient(c * 0.8, c * 0.7, size * 0.05, c, c, c);
    g.addColorStop(0, '#ffffff');
    g.addColorStop(0.18, def.color);
    g.addColorStop(1, shade(def.color, -0.35));
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(c, c, c * 0.94, 0, Math.PI * 2);
    ctx.fill();
    ctx.lineWidth = size * 0.05;
    ctx.strokeStyle = 'rgba(255,255,255,0.9)';
    ctx.stroke();
    ctx.save();
    ctx.translate(size * 0.1, size * 0.1);
    ctx.scale(0.8, 0.8);
    drawIcon(ctx, kind, size);
    ctx.restore();
    iconCache[key] = canvas;
    return canvas;
}

function shade(hex, amount) {
    const n = parseInt(hex.slice(1), 16);
    const f = (v) => Math.max(0, Math.min(255, Math.round(v + v * amount)));
    return `rgb(${f(n >> 16)}, ${f((n >> 8) & 255)}, ${f(n & 255)})`;
}

let glowTex = null;
function glowTexture() {
    if (glowTex) return glowTex;
    const canvas = document.createElement('canvas');
    canvas.width = 64;
    canvas.height = 64;
    const ctx = canvas.getContext('2d');
    const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
    g.addColorStop(0, 'rgba(255,255,255,0.9)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 64, 64);
    glowTex = new THREE.CanvasTexture(canvas);
    return glowTex;
}

/** The floating item in the world. Call item.userData.animate(time) every frame. */
export function createPowerupMesh(kind, size = 1) {
    const group = new THREE.Group();
    const tex = new THREE.CanvasTexture(iconCanvas(kind));
    tex.colorSpace = THREE.SRGBColorSpace;

    const icon = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, fog: false }));
    icon.scale.setScalar(0.9 * size);
    group.add(icon);

    const glow = new THREE.Sprite(new THREE.SpriteMaterial({
        map: glowTexture(), color: POWERUPS[kind].color, transparent: true, opacity: 0.8,
        blending: THREE.AdditiveBlending, depthWrite: false, fog: false,
    }));
    glow.scale.setScalar(1.9 * size);
    group.add(glow);

    const ring = new THREE.Mesh(
        new THREE.TorusGeometry(0.62 * size, 0.05 * size, 8, 40),
        new THREE.MeshBasicMaterial({ color: POWERUPS[kind].color, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false })
    );
    group.add(ring);

    group.userData.kind = kind;
    group.userData.animate = (t) => {
        ring.rotation.y = t * 2.4;
        ring.rotation.x = Math.sin(t * 1.7) * 0.5;
        glow.material.opacity = 0.6 + Math.sin(t * 5) * 0.2;
        icon.position.y = Math.sin(t * 3) * 0.08;
    };
    return group;
}

/** Timer badges in the corner of the screen. */
export function createPowerupHud(parent) {
    const style = document.createElement('style');
    style.textContent = `
        .pu-hud { position:absolute; top:56px; right:10px; display:flex; flex-direction:column; gap:6px; z-index:5; pointer-events:none; }
        .pu-item { display:flex; align-items:center; gap:8px; background:rgba(15,23,42,0.55); color:#fff; border-radius:999px;
            padding:4px 12px 4px 4px; font:700 13px system-ui, Arial, sans-serif; backdrop-filter:blur(4px); direction:rtl;
            animation: pu-pop .25s ease; }
        .pu-item canvas { width:28px; height:28px; border-radius:50%; }
        .pu-bar { width:56px; height:5px; border-radius:3px; background:rgba(255,255,255,0.25); overflow:hidden; }
        .pu-bar i { display:block; height:100%; background:#fff; border-radius:3px; }
        .pu-item.ending { animation: pu-blink .4s steps(2) infinite; }
        @keyframes pu-pop { from { transform:scale(.6); opacity:0 } to { transform:scale(1); opacity:1 } }
        @keyframes pu-blink { 50% { opacity:.4 } }
    `;
    document.head.appendChild(style);
    const box = document.createElement('div');
    box.className = 'pu-hud';
    parent.appendChild(box);
    const items = {};

    return {
        // remaining / total in seconds; total 0 = "until used" (no bar)
        set(kind, remaining, total) {
            let el = items[kind];
            if (!el) {
                el = document.createElement('div');
                el.className = 'pu-item';
                const icon = document.createElement('canvas');
                icon.width = 56;
                icon.height = 56;
                icon.getContext('2d').drawImage(iconCanvas(kind), 0, 0, 56, 56);
                const label = document.createElement('span');
                label.textContent = POWERUPS[kind].label;
                el.append(icon, label);
                if (total > 0) {
                    const bar = document.createElement('div');
                    bar.className = 'pu-bar';
                    bar.appendChild(document.createElement('i'));
                    el.appendChild(bar);
                }
                box.appendChild(el);
                items[kind] = el;
            }
            if (total > 0) {
                el.querySelector('.pu-bar i').style.width = `${Math.max(0, Math.min(1, remaining / total)) * 100}%`;
                el.classList.toggle('ending', remaining < 2);
            }
        },
        remove(kind) {
            if (items[kind]) {
                items[kind].remove();
                delete items[kind];
            }
        },
        clear() {
            Object.keys(items).forEach((k) => this.remove(k));
        },
    };
}
