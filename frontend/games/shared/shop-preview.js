/**
 * Live 3D previews for the shop: each skin is shown on the real character,
 * walking, turning, jumping now and then, with all of its effects. One WebGL
 * renderer draws every preview and copies it into each card's canvas, so it
 * stays light. Hovering a card makes its character jump and spin faster.
 */
import * as THREE from 'three';
import { GLTFLoader } from './lib/loaders/GLTFLoader.js';
import { applySkin, SKIN_IDS } from './skins.js';

const WIDTH = 320;
const HEIGHT = 240;

let started = null;

export function startSkinPreviews() {
    if (!started) started = create();
    return started;
}

async function create() {
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(WIDTH, HEIGHT, false);
    renderer.setClearColor(0x000000, 0);
    renderer.toneMapping = THREE.ACESFilmicToneMapping;

    const gltf = await new GLTFLoader().loadAsync('/games/jumper/models/character.glb');
    const camera = new THREE.PerspectiveCamera(32, WIDTH / HEIGHT, 0.1, 50);
    camera.position.set(0, 1.35, 5.2);
    camera.lookAt(0, 0.85, 0);

    const stages = {};
    SKIN_IDS.forEach((id, i) => {
        const scene = new THREE.Scene();
        scene.add(new THREE.HemisphereLight(0xffffff, 0x8b7fd6, 1.6));
        const sun = new THREE.DirectionalLight(0xfff4e0, 2.2);
        sun.position.set(-2, 5, 4);
        scene.add(sun);

        const root = new THREE.Group();
        const model = gltf.scene.clone(true);
        model.scale.setScalar(1.4);
        root.add(model);
        scene.add(root);

        // soft round shadow under the feet
        const shadow = new THREE.Mesh(
            new THREE.CircleGeometry(0.55, 32),
            new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.22, depthWrite: false })
        );
        shadow.rotation.x = -Math.PI / 2;
        shadow.position.y = 0.005;
        scene.add(shadow);

        const mixer = new THREE.AnimationMixer(model);
        const actions = {};
        gltf.animations.forEach((clip) => { actions[clip.name] = mixer.clipAction(clip); });
        if (actions.jump) {
            actions.jump.setLoop(THREE.LoopOnce, 1);
            actions.jump.clampWhenFinished = true;
        }
        if (actions.walk) actions.walk.play();

        const skin = applySkin({ model, scene, skinId: id, height: 1.54 });
        stages[id] = {
            scene, root, model, shadow, mixer, actions, skin,
            canvas: null, hover: false,
            angle: -0.6 + i * 0.4,
            y: 0, vy: 0, nextJump: 1.2 + i * 0.9,
        };
    });

    const clock = new THREE.Clock();
    const velocity = new THREE.Vector3();

    function jump(stage) {
        if (stage.y > 0.001) return;
        stage.vy = 5.2;
        if (stage.actions.jump) {
            stage.actions.jump.reset().play();
            if (stage.actions.walk) stage.actions.walk.fadeOut(0.1);
        }
        stage.skin.onJump(stage.root.position);
    }

    function tick() {
        requestAnimationFrame(tick);
        const dt = Math.min(clock.getDelta(), 0.05);
        for (const stage of Object.values(stages)) {
            const canvas = stage.canvas;
            // only draw cards that are on the screen
            if (!canvas || !canvas.isConnected || canvas.offsetParent === null) continue;

            stage.angle += dt * (stage.hover ? 2.4 : 0.6);
            stage.model.rotation.y = Math.sin(stage.angle) * 0.9;

            stage.nextJump -= dt;
            if (stage.nextJump <= 0) {
                jump(stage);
                stage.nextJump = stage.hover ? 0.9 : 2.5 + Math.random() * 1.5;
            }
            if (stage.y > 0 || stage.vy > 0) {
                stage.vy -= 16 * dt;
                stage.y += stage.vy * dt;
                if (stage.y <= 0) {
                    stage.y = 0;
                    stage.vy = 0;
                    if (stage.actions.walk) stage.actions.walk.reset().fadeIn(0.15).play();
                    stage.skin.onLand(stage.root.position);
                }
            }
            stage.root.position.y = stage.y;
            const s = 1 - stage.y * 0.35;
            stage.shadow.scale.setScalar(Math.max(0.4, s));

            stage.mixer.update(dt);
            stage.skin.update(dt, { position: stage.root.position, worldVelocity: velocity.set(-0.8, 0, 0), moving: true });

            renderer.render(stage.scene, camera);
            const ctx = canvas.getContext('2d');
            if (canvas.width !== WIDTH * renderer.getPixelRatio()) {
                canvas.width = WIDTH * renderer.getPixelRatio();
                canvas.height = HEIGHT * renderer.getPixelRatio();
            }
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            ctx.drawImage(renderer.domElement, 0, 0, canvas.width, canvas.height);
        }
    }
    tick();

    return {
        /** Point a skin's preview at a canvas in the shop (called each time the shop is drawn). */
        attach(id, canvas) {
            const stage = stages[id];
            if (!stage) return;
            stage.canvas = canvas;
            const card = canvas.closest('.shop-card') || canvas;
            card.addEventListener('pointerenter', () => {
                stage.hover = true;
                jump(stage);
                stage.nextJump = 0.9;
            });
            card.addEventListener('pointerleave', () => { stage.hover = false; });
        },
        celebrate(id) {
            const stage = stages[id];
            if (!stage) return;
            jump(stage);
            stage.vy = 7;
            stage.angle += Math.PI;
        },
    };
}
