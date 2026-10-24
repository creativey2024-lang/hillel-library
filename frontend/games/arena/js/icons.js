/**
 * Little pictures of items for the inventory slots: each gun (in its rarity
 * colours) and each healing item is drawn once with a tiny 3D renderer and
 * kept as an image.
 */
import * as THREE from 'three';
import { weaponMesh } from './weapons.js';
import { healMesh, isHeal } from './heals.js';

const W = 160;
const H = 80;
let renderer = null;
let scene = null;
let camera = null;
let failed = false;
const cache = {};

function setup() {
    if (renderer || failed) return Boolean(renderer);
    try {
        renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, preserveDrawingBuffer: true });
    } catch (e) {
        failed = true;
        return false;
    }
    renderer.setPixelRatio(1);
    renderer.setSize(W, H, false);
    renderer.setClearColor(0x000000, 0);
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.25;
    scene = new THREE.Scene();
    scene.add(new THREE.HemisphereLight(0xffffff, 0x8899aa, 2.2));
    const key = new THREE.DirectionalLight(0xffffff, 2.6);
    key.position.set(2, 3, 4);
    scene.add(key);
    const rim = new THREE.DirectionalLight(0xbfdfff, 1.6);
    rim.position.set(-3, 1, -2);
    scene.add(rim);
    camera = new THREE.OrthographicCamera(-1, 1, 0.5, -0.5, 0.01, 50);
    return true;
}

const box = new THREE.Box3();
const size = new THREE.Vector3();
const center = new THREE.Vector3();

/** A data-URL picture of a slot item (or null if it can't be drawn). */
export function itemIcon(item) {
    if (!item) return null;
    const heal = isHeal(item);
    const key = heal ? `heal:${item.heal}` : `${item.kind}:${item.rarity}`;
    if (cache[key] !== undefined) return cache[key];
    if (!setup()) {
        cache[key] = null;
        return null;
    }
    const obj = heal ? healMesh(item.heal) : weaponMesh(item.kind, item.rarity);
    const holder = new THREE.Group();
    holder.add(obj);
    if (heal) {
        obj.rotation.set(0.35, -0.6, 0);
    } else {
        // side view, barrel to the left (as guns are usually drawn), tilted a little toward us
        obj.rotation.set(0, -Math.PI / 2, 0);
        holder.rotation.set(0.12, 0, -0.06);
    }
    scene.add(holder);
    holder.updateMatrixWorld(true);
    box.setFromObject(holder);
    box.getSize(size);
    box.getCenter(center);
    // fit the item into the picture with a small margin
    const aspect = W / H;
    const half = Math.max(size.x / 2, (size.y / 2) * aspect) * 1.1;
    camera.left = center.x - half;
    camera.right = center.x + half;
    camera.top = center.y + half / aspect;
    camera.bottom = center.y - half / aspect;
    camera.position.set(center.x, center.y, center.z + 10);
    camera.lookAt(center);
    camera.updateProjectionMatrix();
    renderer.render(scene, camera);
    let url = null;
    try {
        url = renderer.domElement.toDataURL('image/png');
    } catch (e) {
        url = null;
    }
    scene.remove(holder);
    holder.traverse((c) => { if (c.isMesh) c.geometry.dispose(); });
    cache[key] = url;
    return url;
}
