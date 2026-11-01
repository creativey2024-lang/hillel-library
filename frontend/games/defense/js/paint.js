/**
 * Textures painted in code for the library (no image files): rows of book
 * spines for the shelves, a red carpet with a gold border, marble, old stone,
 * a moonlit window, banners, glowing runes, soft glows.
 */
import * as THREE from 'three';

const cache = {};

function canvas(w, h = w) {
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    return [c, c.getContext('2d')];
}

export function makeRand(seed) {
    let a = seed >>> 0;
    return () => {
        a = (a + 0x6d2b79f5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

function finish(c, { repeat = true, srgb = true } = {}) {
    const t = new THREE.CanvasTexture(c);
    if (srgb) t.colorSpace = THREE.SRGBColorSpace;
    if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.anisotropy = 4;
    return t;
}

function once(key, make) {
    if (!cache[key]) cache[key] = make();
    return cache[key];
}

const SPINE_COLORS = ['#7f1d1d', '#991b1b', '#1e3a8a', '#1e40af', '#14532d', '#166534', '#713f12', '#854d0e', '#4c1d95', '#581c87', '#0f766e', '#334155', '#78350f', '#9a3412', '#3f6212', '#1f2937', '#a16207', '#831843'];

/** A bookshelf front: 4 shelves of book spines with gold lettering, wood between them. */
export function shelfTexture(variant = 0) {
    return once(`shelf${variant}`, () => {
        const W = 512;
        const H = 512;
        const [c, ctx] = canvas(W, H);
        const rand = makeRand(101 + variant * 7);
        // the wooden case
        ctx.fillStyle = '#3b2412';
        ctx.fillRect(0, 0, W, H);
        const rows = 4;
        const rowH = H / rows;
        for (let r = 0; r < rows; r++) {
            const y0 = r * rowH;
            // the back of the shelf, in shadow
            ctx.fillStyle = '#1a0f07';
            ctx.fillRect(0, y0 + 10, W, rowH - 22);
            let x = 4;
            while (x < W - 6) {
                const w = 12 + rand() * 20;
                const h = rowH * (0.58 + rand() * 0.3);
                const tilt = rand() < 0.06 ? 1 : 0;
                const col = SPINE_COLORS[Math.floor(rand() * SPINE_COLORS.length)];
                const bottom = y0 + rowH - 12;
                ctx.save();
                if (tilt) {
                    ctx.translate(x + w, bottom);
                    ctx.rotate(-0.22);
                    ctx.translate(-(x + w), -bottom);
                }
                const g = ctx.createLinearGradient(x, 0, x + w, 0);
                g.addColorStop(0, shade(col, -0.35));
                g.addColorStop(0.35, shade(col, 0.15));
                g.addColorStop(1, shade(col, -0.45));
                ctx.fillStyle = g;
                ctx.fillRect(x, bottom - h, w, h);
                // gold bands and a title block
                ctx.fillStyle = 'rgba(234,179,8,0.85)';
                ctx.fillRect(x + 1, bottom - h + 6, w - 2, 2);
                ctx.fillRect(x + 1, bottom - 10, w - 2, 2);
                if (w > 16 && rand() < 0.7) {
                    ctx.fillStyle = 'rgba(250,204,21,0.75)';
                    const ty = bottom - h * (0.45 + rand() * 0.2);
                    for (let k = 0; k < 3; k++) ctx.fillRect(x + 4, ty + k * 5, w - 8, 2);
                }
                ctx.restore();
                x += w + (rand() < 0.08 ? 10 + rand() * 18 : 1);
            }
            // the shelf board in front
            const bg = ctx.createLinearGradient(0, y0 + rowH - 12, 0, y0 + rowH);
            bg.addColorStop(0, '#6b4423');
            bg.addColorStop(1, '#3b2412');
            ctx.fillStyle = bg;
            ctx.fillRect(0, y0 + rowH - 12, W, 12);
            ctx.fillStyle = '#5a3a1e';
            ctx.fillRect(0, y0, W, 8);
        }
        // the side posts
        ctx.fillStyle = '#4a2e16';
        ctx.fillRect(0, 0, 8, H);
        ctx.fillRect(W - 8, 0, 8, H);
        const t = finish(c);
        t.wrapT = THREE.ClampToEdgeWrapping;
        return t;
    });
}

function shade(hex, amt) {
    const n = parseInt(hex.slice(1), 16);
    let r = (n >> 16) & 255;
    let g = (n >> 8) & 255;
    let b = n & 255;
    const f = (v) => Math.max(0, Math.min(255, Math.round(amt < 0 ? v * (1 + amt) : v + (255 - v) * amt)));
    r = f(r);
    g = f(g);
    b = f(b);
    return `rgb(${r},${g},${b})`;
}

/** Warm polished floor boards. */
export function floorTexture() {
    return once('floor', () => {
        const S = 512;
        const [c, ctx] = canvas(S);
        const rand = makeRand(7);
        const rows = 8;
        const h = S / rows;
        for (let r = 0; r < rows; r++) {
            let x = -rand() * 200;
            while (x < S) {
                const w = 140 + rand() * 160;
                const base = 0.75 + rand() * 0.25;
                ctx.fillStyle = `rgb(${Math.round(150 * base)},${Math.round(96 * base)},${Math.round(56 * base)})`;
                ctx.fillRect(x, r * h, w, h);
                // grain
                for (let k = 0; k < 7; k++) {
                    ctx.strokeStyle = `rgba(60,30,10,${0.08 + rand() * 0.1})`;
                    ctx.lineWidth = 1;
                    ctx.beginPath();
                    const yy = r * h + 4 + rand() * (h - 8);
                    ctx.moveTo(x, yy);
                    ctx.bezierCurveTo(x + w * 0.3, yy + rand() * 4 - 2, x + w * 0.7, yy + rand() * 4 - 2, x + w, yy);
                    ctx.stroke();
                }
                ctx.fillStyle = 'rgba(30,15,5,0.55)';
                ctx.fillRect(x, r * h, 2, h);
                x += w;
            }
            ctx.fillStyle = 'rgba(25,12,4,0.6)';
            ctx.fillRect(0, r * h, S, 2);
        }
        return finish(c);
    });
}

/** Cream and grey marble tiles with thin dark veins. */
export function marbleTexture() {
    return once('marble', () => {
        const S = 512;
        const [c, ctx] = canvas(S);
        const rand = makeRand(33);
        const n = 4;
        const s = S / n;
        for (let i = 0; i < n; i++) {
            for (let j = 0; j < n; j++) {
                const light = (i + j) % 2 === 0;
                ctx.fillStyle = light ? '#ece6da' : '#cfc6b6';
                ctx.fillRect(i * s, j * s, s, s);
                for (let k = 0; k < 5; k++) {
                    ctx.strokeStyle = `rgba(90,80,70,${0.12 + rand() * 0.18})`;
                    ctx.lineWidth = 0.6 + rand() * 1.4;
                    ctx.beginPath();
                    let x = i * s + rand() * s;
                    let y = j * s;
                    ctx.moveTo(x, y);
                    for (let q = 0; q < 6; q++) {
                        x += (rand() - 0.5) * 40;
                        y += s / 6;
                        ctx.lineTo(x, y);
                    }
                    ctx.stroke();
                }
                ctx.strokeStyle = 'rgba(60,50,40,0.5)';
                ctx.lineWidth = 2;
                ctx.strokeRect(i * s, j * s, s, s);
            }
        }
        return finish(c);
    });
}

/** Big old stone blocks. */
export function stoneTexture() {
    return once('stone', () => {
        const S = 512;
        const [c, ctx] = canvas(S);
        const rand = makeRand(55);
        ctx.fillStyle = '#4b4a52';
        ctx.fillRect(0, 0, S, S);
        const rows = 6;
        const h = S / rows;
        for (let r = 0; r < rows; r++) {
            let x = r % 2 ? -h * 0.8 : 0;
            while (x < S) {
                const w = h * (1.4 + rand() * 0.9);
                const v = 0.8 + rand() * 0.3;
                ctx.fillStyle = `rgb(${Math.round(112 * v)},${Math.round(108 * v)},${Math.round(118 * v)})`;
                ctx.fillRect(x + 3, r * h + 3, w - 6, h - 6);
                for (let k = 0; k < 40; k++) {
                    ctx.fillStyle = `rgba(${rand() < 0.5 ? '20,20,25' : '200,200,210'},${0.04 + rand() * 0.06})`;
                    ctx.fillRect(x + rand() * w, r * h + rand() * h, 2 + rand() * 6, 2 + rand() * 6);
                }
                x += w;
            }
        }
        return finish(c);
    });
}

/** A long red carpet with a gold border (repeats along its length). */
export function carpetTexture() {
    return once('carpet', () => {
        const [c, ctx] = canvas(256, 512);
        ctx.fillStyle = '#7a1022';
        ctx.fillRect(0, 0, 256, 512);
        const g = ctx.createLinearGradient(0, 0, 256, 0);
        g.addColorStop(0, 'rgba(0,0,0,0.25)');
        g.addColorStop(0.5, 'rgba(255,255,255,0.05)');
        g.addColorStop(1, 'rgba(0,0,0,0.25)');
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, 256, 512);
        ctx.fillStyle = '#d4a017';
        ctx.fillRect(14, 0, 8, 512);
        ctx.fillRect(234, 0, 8, 512);
        ctx.fillStyle = '#a16207';
        ctx.fillRect(28, 0, 3, 512);
        ctx.fillRect(225, 0, 3, 512);
        // diamonds down the middle
        ctx.strokeStyle = 'rgba(234,179,8,0.55)';
        ctx.lineWidth = 3;
        for (let y = 0; y < 512; y += 128) {
            ctx.beginPath();
            ctx.moveTo(128, y + 14);
            ctx.lineTo(200, y + 64);
            ctx.lineTo(128, y + 114);
            ctx.lineTo(56, y + 64);
            ctx.closePath();
            ctx.stroke();
            ctx.fillStyle = 'rgba(234,179,8,0.35)';
            ctx.beginPath();
            ctx.arc(128, y + 64, 10, 0, Math.PI * 2);
            ctx.fill();
        }
        const t = finish(c);
        t.wrapS = THREE.ClampToEdgeWrapping;
        return t;
    });
}

/** A tall arched window with moonlight and a lead grid. */
export function windowTexture() {
    return once('window', () => {
        const W = 128;
        const H = 320;
        const [c, ctx] = canvas(W, H);
        ctx.clearRect(0, 0, W, H);
        const arch = () => {
            ctx.beginPath();
            ctx.moveTo(8, H - 4);
            ctx.lineTo(8, 64);
            ctx.arc(W / 2, 64, W / 2 - 8, Math.PI, 0);
            ctx.lineTo(W - 8, H - 4);
            ctx.closePath();
        };
        const g = ctx.createLinearGradient(0, 0, 0, H);
        g.addColorStop(0, '#dbeafe');
        g.addColorStop(0.5, '#93c5fd');
        g.addColorStop(1, '#4f6db8');
        ctx.fillStyle = g;
        arch();
        ctx.fill();
        ctx.strokeStyle = 'rgba(30,27,75,0.85)';
        ctx.lineWidth = 3;
        for (let x = 8 + 28; x < W - 8; x += 28) {
            ctx.beginPath();
            ctx.moveTo(x, 20);
            ctx.lineTo(x, H);
            ctx.stroke();
        }
        for (let y = 90; y < H; y += 36) {
            ctx.beginPath();
            ctx.moveTo(8, y);
            ctx.lineTo(W - 8, y);
            ctx.stroke();
        }
        ctx.lineWidth = 7;
        ctx.strokeStyle = '#1e1b2e';
        arch();
        ctx.stroke();
        return finish(c, { repeat: false });
    });
}

/** A hanging banner with an open-book emblem. */
export function bannerTexture(color = '#7c1d2a') {
    return once(`banner${color}`, () => {
        const W = 128;
        const H = 320;
        const [c, ctx] = canvas(W, H);
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.lineTo(W, 0);
        ctx.lineTo(W, H - 40);
        ctx.lineTo(W / 2, H);
        ctx.lineTo(0, H - 40);
        ctx.closePath();
        ctx.fill();
        ctx.strokeStyle = '#eab308';
        ctx.lineWidth = 6;
        ctx.stroke();
        // emblem
        ctx.fillStyle = '#facc15';
        ctx.beginPath();
        ctx.moveTo(W / 2, 140);
        ctx.quadraticCurveTo(W / 2 - 30, 120, W / 2 - 44, 130);
        ctx.lineTo(W / 2 - 44, 180);
        ctx.quadraticCurveTo(W / 2 - 30, 170, W / 2, 190);
        ctx.quadraticCurveTo(W / 2 + 30, 170, W / 2 + 44, 180);
        ctx.lineTo(W / 2 + 44, 130);
        ctx.quadraticCurveTo(W / 2 + 30, 120, W / 2, 140);
        ctx.fill();
        ctx.fillStyle = color;
        ctx.fillRect(W / 2 - 1.5, 140, 3, 50);
        ctx.fillStyle = '#facc15';
        ctx.beginPath();
        ctx.arc(W / 2, 92, 14, 0, Math.PI * 2);
        ctx.fill();
        return finish(c, { repeat: false });
    });
}

/** A ring of glowing runes (for the magic circle under the book and the portals). */
export function runeTexture(color = '255,214,102') {
    return once(`rune${color}`, () => {
        const S = 512;
        const [c, ctx] = canvas(S);
        const rand = makeRand(9);
        ctx.clearRect(0, 0, S, S);
        ctx.translate(S / 2, S / 2);
        ctx.strokeStyle = `rgba(${color},0.95)`;
        ctx.shadowColor = `rgba(${color},1)`;
        ctx.shadowBlur = 12;
        [240, 222, 150, 132].forEach((r, i) => {
            ctx.lineWidth = i % 2 ? 2 : 4;
            ctx.beginPath();
            ctx.arc(0, 0, r, 0, Math.PI * 2);
            ctx.stroke();
        });
        // runes between the outer rings
        ctx.lineWidth = 3;
        for (let k = 0; k < 28; k++) {
            ctx.save();
            ctx.rotate((k / 28) * Math.PI * 2);
            ctx.translate(0, -231);
            ctx.beginPath();
            const m = Math.floor(rand() * 4);
            if (m === 0) {
                ctx.moveTo(-5, -6);
                ctx.lineTo(5, 6);
                ctx.moveTo(5, -6);
                ctx.lineTo(-5, 6);
            } else if (m === 1) {
                ctx.arc(0, 0, 5, 0, Math.PI * 1.5);
            } else if (m === 2) {
                ctx.moveTo(0, -7);
                ctx.lineTo(0, 7);
                ctx.moveTo(-5, -2);
                ctx.lineTo(5, -2);
            } else {
                ctx.moveTo(-6, 6);
                ctx.lineTo(0, -6);
                ctx.lineTo(6, 6);
            }
            ctx.stroke();
            ctx.restore();
        }
        // a star inside
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        for (let k = 0; k <= 7; k++) {
            const a = (k * 3 * Math.PI * 2) / 7 - Math.PI / 2;
            const x = Math.cos(a) * 130;
            const y = Math.sin(a) * 130;
            if (k === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
        }
        ctx.stroke();
        return finish(c, { repeat: false });
    });
}

/** A soft round glow (for lights, eyes, magic). */
export function glowTexture() {
    return once('glow', () => {
        const S = 128;
        const [c, ctx] = canvas(S);
        const g = ctx.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
        g.addColorStop(0, 'rgba(255,255,255,1)');
        g.addColorStop(0.25, 'rgba(255,255,255,0.6)');
        g.addColorStop(0.6, 'rgba(255,255,255,0.12)');
        g.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, S, S);
        return finish(c, { repeat: false });
    });
}

/** A light shaft fading from top to bottom (and at the sides). */
export function shaftTexture() {
    return once('shaft', () => {
        const [c, ctx] = canvas(64, 256);
        const g = ctx.createLinearGradient(0, 0, 0, 256);
        g.addColorStop(0, 'rgba(255,255,255,0.55)');
        g.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, 64, 256);
        const s = ctx.createLinearGradient(0, 0, 64, 0);
        s.addColorStop(0, 'rgba(0,0,0,1)');
        s.addColorStop(0.3, 'rgba(0,0,0,0)');
        s.addColorStop(0.7, 'rgba(0,0,0,0)');
        s.addColorStop(1, 'rgba(0,0,0,1)');
        ctx.globalCompositeOperation = 'destination-out';
        ctx.fillStyle = s;
        ctx.fillRect(0, 0, 64, 256);
        return finish(c, { repeat: false });
    });
}

/** The night sky: a deep gradient (stars are separate points). */
export function skyTexture() {
    return once('sky', () => {
        const [c, ctx] = canvas(16, 256);
        const g = ctx.createLinearGradient(0, 0, 0, 256);
        g.addColorStop(0, '#020617');
        g.addColorStop(0.45, '#0b1236');
        g.addColorStop(0.75, '#1e1b4b');
        g.addColorStop(1, '#3b1d5e');
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, 16, 256);
        return finish(c, { repeat: false });
    });
}

/** Pages with lines of "writing" for the Great Book. */
export function pageTexture() {
    return once('page', () => {
        const [c, ctx] = canvas(256, 256);
        const rand = makeRand(77);
        ctx.fillStyle = '#fdf6e3';
        ctx.fillRect(0, 0, 256, 256);
        const g = ctx.createRadialGradient(128, 128, 40, 128, 128, 190);
        g.addColorStop(0, 'rgba(0,0,0,0)');
        g.addColorStop(1, 'rgba(120,80,20,0.35)');
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, 256, 256);
        ctx.fillStyle = 'rgba(180,120,20,0.9)';
        for (let y = 30; y < 230; y += 14) {
            let x = 24;
            while (x < 232) {
                const w = 6 + rand() * 22;
                ctx.fillRect(x, y, Math.min(w, 232 - x), 3);
                x += w + 5;
            }
        }
        ctx.strokeStyle = 'rgba(217,119,6,0.9)';
        ctx.lineWidth = 3;
        ctx.strokeRect(12, 12, 232, 232);
        return finish(c, { repeat: false });
    });
}
