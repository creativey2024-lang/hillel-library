/**
 * Small textures painted in code (no image files): wood planks, stone
 * bricks, plaster, roof tiles, corrugated metal, grass detail, water ripples,
 * gun metal. They are mostly light grey so a material's colour tints them.
 */
import * as THREE from 'three';

const cache = {};

function canvas(size) {
    const c = document.createElement('canvas');
    c.width = size;
    c.height = size;
    return [c, c.getContext('2d')];
}

// cheap repeatable noise for painting
function makeRand(seed) {
    let a = seed >>> 0;
    return () => {
        a = (a + 0x6d2b79f5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

function speckle(ctx, size, rand, count, minA, maxA, dark = true) {
    for (let i = 0; i < count; i++) {
        const a = minA + rand() * (maxA - minA);
        ctx.fillStyle = dark ? `rgba(0,0,0,${a})` : `rgba(255,255,255,${a})`;
        const s = 1 + rand() * 2;
        ctx.fillRect(rand() * size, rand() * size, s, s);
    }
}

function finish(c, repeat = true, srgb = true) {
    const t = new THREE.CanvasTexture(c);
    if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
    if (srgb) t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 4;
    return t;
}

const painters = {
    planks(size, rand, ctx) {
        ctx.fillStyle = '#e8e2d8';
        ctx.fillRect(0, 0, size, size);
        const rows = 8;
        const h = size / rows;
        for (let r = 0; r < rows; r++) {
            const shade = 0.88 + rand() * 0.14;
            ctx.fillStyle = `rgb(${232 * shade},${224 * shade},${212 * shade})`;
            ctx.fillRect(0, r * h, size, h);
            // grain
            for (let g = 0; g < 7; g++) {
                ctx.strokeStyle = `rgba(90,60,30,${0.05 + rand() * 0.08})`;
                ctx.lineWidth = 1;
                ctx.beginPath();
                const y = r * h + rand() * h;
                ctx.moveTo(0, y);
                ctx.bezierCurveTo(size * 0.3, y + rand() * 3 - 1.5, size * 0.7, y + rand() * 3 - 1.5, size, y);
                ctx.stroke();
            }
            // board ends
            const cut = rand() * size;
            ctx.fillStyle = 'rgba(60,40,20,0.35)';
            ctx.fillRect(cut, r * h, 2, h);
            ctx.fillStyle = 'rgba(50,30,15,0.55)';
            ctx.fillRect(0, r * h + h - 2, size, 2);
            // nails
            ctx.fillStyle = 'rgba(40,40,40,0.5)';
            ctx.fillRect(cut + 5, r * h + h / 2 - 1, 2, 2);
            ctx.fillRect(cut - 7, r * h + h / 2 - 1, 2, 2);
        }
    },
    bricks(size, rand, ctx) {
        ctx.fillStyle = '#9a958c';
        ctx.fillRect(0, 0, size, size);
        const rows = 8;
        const h = size / rows;
        const w = size / 4;
        for (let r = 0; r < rows; r++) {
            const off = r % 2 ? w / 2 : 0;
            for (let k = -1; k < 5; k++) {
                const s = 0.82 + rand() * 0.22;
                ctx.fillStyle = `rgb(${220 * s},${216 * s},${206 * s})`;
                ctx.fillRect(k * w + off + 2, r * h + 2, w - 4, h - 4);
            }
        }
        speckle(ctx, size, rand, 900, 0.04, 0.16);
    },
    plaster(size, rand, ctx) {
        ctx.fillStyle = '#f2f0ec';
        ctx.fillRect(0, 0, size, size);
        for (let i = 0; i < 60; i++) {
            const g = ctx.createRadialGradient(rand() * size, rand() * size, 0, rand() * size, rand() * size, 10 + rand() * 30);
            g.addColorStop(0, `rgba(0,0,0,${rand() * 0.05})`);
            g.addColorStop(1, 'rgba(0,0,0,0)');
            ctx.fillStyle = g;
            ctx.fillRect(0, 0, size, size);
        }
        speckle(ctx, size, rand, 1400, 0.02, 0.08);
    },
    tiles(size, rand, ctx) {
        ctx.fillStyle = '#d9d2cc';
        ctx.fillRect(0, 0, size, size);
        const rows = 8;
        const h = size / rows;
        const w = size / 6;
        for (let r = 0; r < rows; r++) {
            const off = r % 2 ? w / 2 : 0;
            for (let k = -1; k < 7; k++) {
                const s = 0.85 + rand() * 0.18;
                const g = ctx.createLinearGradient(0, r * h, 0, r * h + h);
                g.addColorStop(0, `rgb(${250 * s},${244 * s},${238 * s})`);
                g.addColorStop(1, `rgb(${170 * s},${160 * s},${152 * s})`);
                ctx.fillStyle = g;
                ctx.beginPath();
                if (ctx.roundRect) ctx.roundRect(k * w + off + 1, r * h + 1, w - 2, h - 1, [0, 0, 6, 6]);
                else ctx.rect(k * w + off + 1, r * h + 1, w - 2, h - 1);
                ctx.fill();
            }
        }
    },
    metal(size, rand, ctx) {
        // corrugated sheet: vertical ribs
        const ribs = 16;
        for (let i = 0; i < ribs; i++) {
            const g = ctx.createLinearGradient((i * size) / ribs, 0, ((i + 1) * size) / ribs, 0);
            g.addColorStop(0, '#bfc4c9');
            g.addColorStop(0.5, '#f4f6f8');
            g.addColorStop(1, '#a9aeb4');
            ctx.fillStyle = g;
            ctx.fillRect((i * size) / ribs, 0, size / ribs + 1, size);
        }
        // a little rust
        for (let i = 0; i < 18; i++) {
            ctx.fillStyle = `rgba(150,80,30,${rand() * 0.12})`;
            ctx.fillRect(rand() * size, rand() * size, 3 + rand() * 12, 6 + rand() * 30);
        }
    },
    grass(size, rand, ctx) {
        // terrain detail: tiny blades and pebbles (multiplied on top of the ground colour)
        ctx.fillStyle = '#f4f4f4';
        ctx.fillRect(0, 0, size, size);
        for (let i = 0; i < 2200; i++) {
            const x = rand() * size;
            const y = rand() * size;
            const v = 170 + rand() * 85;
            ctx.strokeStyle = `rgba(${v},${v},${v},0.55)`;
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(x, y);
            ctx.lineTo(x + rand() * 3 - 1.5, y - 2 - rand() * 5);
            ctx.stroke();
        }
        speckle(ctx, size, rand, 600, 0.05, 0.18);
        speckle(ctx, size, rand, 300, 0.05, 0.2, false);
    },
    gunmetal(size, rand, ctx) {
        ctx.fillStyle = '#e6e8ea';
        ctx.fillRect(0, 0, size, size);
        // brushed lines
        for (let i = 0; i < 260; i++) {
            const y = rand() * size;
            ctx.strokeStyle = `rgba(${rand() < 0.5 ? '0,0,0' : '255,255,255'},${0.03 + rand() * 0.06})`;
            ctx.beginPath();
            ctx.moveTo(0, y);
            ctx.lineTo(size, y + rand() * 2 - 1);
            ctx.stroke();
        }
        speckle(ctx, size, rand, 300, 0.03, 0.08);
    },
};

/** A tiling colour texture: planks, bricks, plaster, tiles, metal, grass, gunmetal. */
export function texture(name, size = 256) {
    if (cache[name]) return cache[name];
    const [c, ctx] = canvas(size);
    painters[name](size, makeRand(name.length * 977 + 13), ctx);
    cache[name] = finish(c);
    return cache[name];
}

/** A normal map of soft ripples for the sea. */
export function waterNormals(size = 256) {
    if (cache.waterN) return cache.waterN;
    const rand = makeRand(4242);
    // height field: a few sine waves plus noise, made seamless by using whole periods
    const hgt = new Float32Array(size * size);
    const waves = [];
    for (let i = 0; i < 9; i++) waves.push({ kx: Math.round(rand() * 6 - 3) || 1, ky: Math.round(rand() * 6 - 3) || 2, a: 0.4 + rand(), p: rand() * 6.28 });
    for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
            let v = 0;
            for (const w of waves) v += Math.sin(((w.kx * x + w.ky * y) / size) * Math.PI * 2 + w.p) * w.a;
            hgt[y * size + x] = v;
        }
    }
    const [c, ctx] = canvas(size);
    const img = ctx.createImageData(size, size);
    for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
            const l = hgt[y * size + ((x - 1 + size) % size)];
            const r = hgt[y * size + ((x + 1) % size)];
            const u = hgt[((y - 1 + size) % size) * size + x];
            const d = hgt[((y + 1) % size) * size + x];
            let nx = (l - r) * 0.35;
            let ny = (u - d) * 0.35;
            let nz = 1;
            const len = Math.hypot(nx, ny, nz);
            nx /= len; ny /= len; nz /= len;
            const k = (y * size + x) * 4;
            img.data[k] = (nx * 0.5 + 0.5) * 255;
            img.data[k + 1] = (ny * 0.5 + 0.5) * 255;
            img.data[k + 2] = (nz * 0.5 + 0.5) * 255;
            img.data[k + 3] = 255;
        }
    }
    ctx.putImageData(img, 0, 0);
    cache.waterN = finish(c, true, false);
    return cache.waterN;
}

/**
 * Give a geometry (already placed in the world) texture coordinates from
 * its world position, so textures keep the same size on big and small boxes.
 */
export function worldUV(geo, scale = 2) {
    const pos = geo.attributes.position;
    const nrm = geo.attributes.normal;
    const uv = new Float32Array(pos.count * 2);
    for (let i = 0; i < pos.count; i++) {
        const nx = Math.abs(nrm.getX(i));
        const ny = Math.abs(nrm.getY(i));
        const nz = Math.abs(nrm.getZ(i));
        let u;
        let v;
        if (ny >= nx && ny >= nz) {
            u = pos.getX(i);
            v = pos.getZ(i);
        } else if (nx >= nz) {
            u = pos.getZ(i);
            v = pos.getY(i);
        } else {
            u = pos.getX(i);
            v = pos.getY(i);
        }
        uv[i * 2] = u / scale;
        uv[i * 2 + 1] = v / scale;
    }
    geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    return geo;
}
