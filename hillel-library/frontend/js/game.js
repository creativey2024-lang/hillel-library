// A small self-contained "endless runner" mini-game for the profile menu -
// jump over obstacles, nothing more. Pure vanilla canvas, no dependencies,
// and it never touches the library's own data or the backend API.
(function () {
    const HIGH_SCORE_KEY = 'hillel_runner_highscore';

    const GROUND_HEIGHT = 30;
    const PLAYER_WIDTH = 32;
    const PLAYER_HEIGHT = 34;
    const PLAYER_X = 50;
    const GRAVITY = 1900;       // px / s^2
    const JUMP_VELOCITY = -620; // px / s
    const BASE_SPEED = 260;     // px / s
    const MAX_SPEED = 620;      // px / s
    const SPEED_RAMP_PER_SCORE = 2.2;
    const MIN_SPAWN_GAP = 0.55; // seconds
    const MAX_SPAWN_GAP = 1.4;  // seconds

    let canvas = null;
    let ctx = null;
    let width = 560;
    let height = 220;
    let groundY = height - GROUND_HEIGHT;

    let active = false;      // the game modal is open / loop should run
    let started = false;     // the current run has actually begun (past "press to start")
    let over = false;
    let lastTimestamp = null;
    let rafId = null;

    let player = { y: 0, vy: 0, jumping: false };
    let obstacles = [];
    let nextSpawnIn = 1;
    let elapsed = 0;
    let score = 0;
    let highScore = 0;

    function loadHighScore() {
        try {
            return parseInt(localStorage.getItem(HIGH_SCORE_KEY), 10) || 0;
        } catch (err) {
            return 0;
        }
    }

    function saveHighScore(value) {
        try {
            localStorage.setItem(HIGH_SCORE_KEY, String(value));
        } catch (err) {
            // ignore (private-browsing etc.) - the game still works, just without memory
        }
    }

    function resetGame() {
        player.y = groundY - PLAYER_HEIGHT;
        player.vy = 0;
        player.jumping = false;
        obstacles = [];
        nextSpawnIn = 1.1;
        elapsed = 0;
        score = 0;
        started = false;
        over = false;
        updateScoreDisplay();
    }

    function updateScoreDisplay() {
        const scoreEl = document.getElementById('gameScore');
        const highEl = document.getElementById('gameHighScore');
        if (scoreEl) scoreEl.textContent = String(Math.floor(score));
        if (highEl) highEl.textContent = String(Math.floor(highScore));
    }

    function currentSpeed() {
        return Math.min(MAX_SPEED, BASE_SPEED + score * SPEED_RAMP_PER_SCORE);
    }

    function spawnObstacle() {
        const h = 22 + Math.random() * 30;
        const w = 18 + Math.random() * 16;
        obstacles.push({ x: width + 10, y: groundY - h, width: w, height: h });
        nextSpawnIn = MIN_SPAWN_GAP + Math.random() * (MAX_SPAWN_GAP - MIN_SPAWN_GAP);
    }

    function jump() {
        if (!active) return;
        if (over) {
            resetGame();
            started = true;
            return;
        }
        if (!started) {
            started = true;
            return;
        }
        if (!player.jumping) {
            player.vy = JUMP_VELOCITY;
            player.jumping = true;
        }
    }

    function rectsOverlap(a, b) {
        return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
    }

    function update(dt) {
        if (!started || over) return;

        elapsed += dt;
        score += dt * 10; // 10 points per second survived

        // Physics
        player.vy += GRAVITY * dt;
        player.y += player.vy * dt;
        if (player.y >= groundY - PLAYER_HEIGHT) {
            player.y = groundY - PLAYER_HEIGHT;
            player.vy = 0;
            player.jumping = false;
        }

        // Obstacles
        const speed = currentSpeed();
        nextSpawnIn -= dt;
        if (nextSpawnIn <= 0) spawnObstacle();

        for (let i = obstacles.length - 1; i >= 0; i--) {
            obstacles[i].x -= speed * dt;
            if (obstacles[i].x + obstacles[i].width < -5) {
                obstacles.splice(i, 1);
            }
        }

        // Collision (a few px of forgiveness so near-misses feel fair)
        const margin = 5;
        const playerBox = { x: PLAYER_X + margin, y: player.y + margin, width: PLAYER_WIDTH - margin * 2, height: PLAYER_HEIGHT - margin * 2 };
        for (const obstacle of obstacles) {
            if (rectsOverlap(playerBox, obstacle)) {
                over = true;
                started = false;
                if (score > highScore) {
                    highScore = score;
                    saveHighScore(Math.floor(highScore));
                }
                updateScoreDisplay();
                break;
            }
        }

        updateScoreDisplay();
    }

    function draw() {
        ctx.clearRect(0, 0, width, height);

        // Sky already comes from the canvas's own background color (CSS), so
        // only the ground + characters need drawing here.
        ctx.fillStyle = '#94714a';
        ctx.fillRect(0, groundY, width, GROUND_HEIGHT);
        ctx.fillStyle = '#5f7a4a';
        ctx.fillRect(0, groundY, width, 4);

        // Player
        ctx.fillStyle = '#2563eb';
        const px = PLAYER_X, py = player.y;
        roundRect(px, py, PLAYER_WIDTH, PLAYER_HEIGHT, 6);
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(px + PLAYER_WIDTH - 11, py + 8, 5, 5);

        // Obstacles
        ctx.fillStyle = '#b91c1c';
        for (const obstacle of obstacles) {
            roundRect(obstacle.x, obstacle.y, obstacle.width, obstacle.height, 4);
        }

        if (!started && !over) {
            drawCenteredMessage('לחץ / הקש כדי להתחיל', 'רווח, חץ למעלה, או הקשה על המשחק');
        } else if (over) {
            drawCenteredMessage('המשחק נגמר!', `ניקוד: ${Math.floor(score)} - לחץ כדי לשחק שוב`);
        }
    }

    function roundRect(x, y, w, h, r) {
        ctx.beginPath();
        ctx.moveTo(x + r, y);
        ctx.arcTo(x + w, y, x + w, y + h, r);
        ctx.arcTo(x + w, y + h, x, y + h, r);
        ctx.arcTo(x, y + h, x, y, r);
        ctx.arcTo(x, y, x + w, y, r);
        ctx.closePath();
        ctx.fill();
    }

    function drawCenteredMessage(title, subtitle) {
        ctx.save();
        ctx.fillStyle = 'rgba(15, 23, 42, 0.55)';
        ctx.fillRect(0, 0, width, height);
        ctx.fillStyle = '#ffffff';
        ctx.textAlign = 'center';
        ctx.font = 'bold 22px sans-serif';
        ctx.fillText(title, width / 2, height / 2 - 6);
        ctx.font = '13px sans-serif';
        ctx.fillText(subtitle, width / 2, height / 2 + 18);
        ctx.restore();
    }

    function loop(timestamp) {
        if (!active) return;
        if (lastTimestamp === null) lastTimestamp = timestamp;
        let dt = (timestamp - lastTimestamp) / 1000;
        lastTimestamp = timestamp;
        // Guard against huge jumps (e.g. the tab was backgrounded).
        if (dt > 0.1) dt = 0.1;

        update(dt);
        draw();

        rafId = requestAnimationFrame(loop);
    }

    function ensureCanvas() {
        if (canvas) return true;
        canvas = document.getElementById('gameCanvas');
        if (!canvas) return false;
        ctx = canvas.getContext('2d');
        width = canvas.width;
        height = canvas.height;
        groundY = height - GROUND_HEIGHT;
        return true;
    }

    function start() {
        if (!ensureCanvas()) return;
        highScore = loadHighScore();
        resetGame();
        active = true;
        lastTimestamp = null;
        draw();
        rafId = requestAnimationFrame(loop);
    }

    function stop() {
        active = false;
        if (rafId) {
            cancelAnimationFrame(rafId);
            rafId = null;
        }
    }

    // Input: only acts while the game modal is actually open (active === true),
    // so this never interferes with typing anywhere else in the app.
    document.addEventListener('keydown', (e) => {
        if (!active) return;
        if (e.code === 'Space' || e.code === 'ArrowUp') {
            e.preventDefault();
            jump();
        }
    });

    document.addEventListener('DOMContentLoaded', () => {
        const canvasEl = document.getElementById('gameCanvas');
        if (canvasEl) {
            canvasEl.addEventListener('pointerdown', (e) => {
                e.preventDefault();
                jump();
            });
        }
    });

    window.HillelRunner = { start, stop };
})();
