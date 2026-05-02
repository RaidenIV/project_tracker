const THREE_MODULE_URL = "https://unpkg.com/three@0.160.1/build/three.module.js";

const mount = document.getElementById("authThreeBg");
const overlay = document.getElementById("authOverlay");

if (mount && overlay) {
    const fallbackCanvas = document.createElement("canvas");
    const fallbackGl = fallbackCanvas.getContext("webgl") || fallbackCanvas.getContext("experimental-webgl");

    if (!fallbackGl) {
        mount.style.background = "#000";
    } else {
        import(THREE_MODULE_URL)
            .then((THREE) => initAuthThreeBackground(THREE))
            .catch(() => {
                mount.style.background = "#000";
            });
    }
}

function initAuthThreeBackground(THREE) {
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setClearColor(0x000000, 1);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    mount.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    scene.fog = new THREE.Fog(0x000000, 40, 100);

    const camera = new THREE.PerspectiveCamera(
        12.5,
        window.innerWidth / window.innerHeight,
        0.1,
        200
    );
    camera.position.set(0, 18, 28);
    camera.lookAt(0, 0, 0);

    const key = new THREE.DirectionalLight(0xffffff, 4.0);
    key.position.set(10, 30, 10);
    key.castShadow = true;
    key.shadow.mapSize.width = 2048;
    key.shadow.mapSize.height = 2048;
    key.shadow.camera.left = -30;
    key.shadow.camera.right = 30;
    key.shadow.camera.top = 30;
    key.shadow.camera.bottom = -30;
    key.shadow.camera.near = 0.5;
    key.shadow.camera.far = 100;
    key.shadow.bias = -0.0001;
    scene.add(key);

    const rim = new THREE.DirectionalLight(0xffffff, 2.5);
    rim.position.set(-20, 15, -10);
    rim.castShadow = true;
    rim.shadow.mapSize.width = 2048;
    rim.shadow.mapSize.height = 2048;
    rim.shadow.camera.left = -30;
    rim.shadow.camera.right = 30;
    rim.shadow.camera.top = 30;
    rim.shadow.camera.bottom = -30;
    scene.add(rim);

    scene.add(new THREE.AmbientLight(0xffffff, 0.3));

    const HEX_R = 0.65;
    const HEX_H = 4.5;
    const hexGeo = new THREE.CylinderGeometry(HEX_R, HEX_R, 1, 6, 1, false);
    hexGeo.rotateY(Math.PI / 6);

    const mat = new THREE.MeshStandardMaterial({
        color: 0x242424,
        roughness: 0.0,
        metalness: 0.9,
        emissive: 0x000000,
        emissiveIntensity: 0.0
    });

    const isMobile = matchMedia("(max-width: 768px)").matches;
    const GRID = isMobile ? 34 : 52;
    const rows = Math.round(GRID * 0.72 * 2);
    const count = GRID * rows;

    const mesh = new THREE.InstancedMesh(hexGeo, mat, count);
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    scene.add(mesh);

    const groundGeo = new THREE.PlaneGeometry(100, 100);
    const groundMat = new THREE.MeshStandardMaterial({
        color: 0x0a0a0a,
        roughness: 0.8,
        metalness: 0.2
    });
    const ground = new THREE.Mesh(groundGeo, groundMat);
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -2.5;
    ground.receiveShadow = true;
    scene.add(ground);

    const xStep = HEX_R * 1.5;
    const zStep = HEX_R * Math.sqrt(3);
    const tile = new Array(count);
    let k = 0;

    for (let r = 0; r < rows; r += 1) {
        for (let c = 0; c < GRID; c += 1) {
            const x = (c - GRID / 2) * xStep;
            const z = (r - rows / 2) * zStep + (c % 2 ? zStep * 0.5 : 0);
            tile[k] = { x, z };
            k += 1;
        }
    }

    function fBm(x, z, t) {
        let a = 1.0;
        let f = 0.12;
        let sum = 0.0;

        for (let i = 0; i < 4; i += 1) {
            sum += a * Math.sin((x * f + t * 0.35) + Math.cos(z * f - t * 0.25));
            sum += a * Math.cos((z * f - t * 0.30) + Math.sin(x * f + t * 0.20));
            a *= 0.5;
            f *= 2.05;
        }

        return sum * 0.55;
    }

    const pointer = { x: 0, y: 0 };
    const dummy = new THREE.Object3D();
    const baseY = -2.0;
    let animationFrame = null;
    let lastFrameTime = 0;
    let animationTime = 0;
    let isRunning = false;

    function updatePointer(e) {
        pointer.x = (e.clientX / window.innerWidth) * 2 - 1;
        pointer.y = (e.clientY / window.innerHeight) * 2 - 1;
    }

    function resizeRenderer() {
        camera.aspect = window.innerWidth / window.innerHeight;
        camera.updateProjectionMatrix();
        renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
        renderer.setSize(window.innerWidth, window.innerHeight);
    }

    function animate(tMs) {
        if (!isRunning) return;

        const deltaTime = lastFrameTime === 0 ? 0 : (tMs - lastFrameTime) * 0.001;
        lastFrameTime = tMs;
        animationTime += deltaTime;

        const px = pointer.x * 1.6;
        const py = pointer.y * 0.9;
        camera.position.x = THREE.MathUtils.lerp(camera.position.x, px, 0.04);
        camera.position.y = THREE.MathUtils.lerp(camera.position.y, 18 + (-py), 0.04);
        camera.lookAt(0, 0, 0);

        for (let i = 0; i < count; i += 1) {
            const { x, z } = tile[i];
            const n = fBm(x, z, animationTime);
            const h = THREE.MathUtils.clamp((n + 1.25) * 0.55, 0.1, 1.0);

            dummy.position.set(x, baseY + h * (HEX_H * 0.35), z);
            dummy.scale.set(1, h * HEX_H, 1);
            dummy.rotation.y = 0.10 * Math.sin(animationTime * 0.35 + (x + z) * 0.05);
            dummy.updateMatrix();
            mesh.setMatrixAt(i, dummy.matrix);
        }

        mesh.instanceMatrix.needsUpdate = true;
        renderer.render(scene, camera);
        animationFrame = requestAnimationFrame(animate);
    }

    function start() {
        if (isRunning || overlay.classList.contains("hidden")) return;
        isRunning = true;
        lastFrameTime = 0;
        resizeRenderer();
        animationFrame = requestAnimationFrame(animate);
    }

    function stop() {
        isRunning = false;
        if (animationFrame !== null) {
            cancelAnimationFrame(animationFrame);
            animationFrame = null;
        }
    }

    window.addEventListener("mousemove", updatePointer, { passive: true });
    window.addEventListener("resize", resizeRenderer, { passive: true });

    const visibilityObserver = new MutationObserver(() => {
        if (overlay.classList.contains("hidden")) {
            stop();
        } else {
            start();
        }
    });

    visibilityObserver.observe(overlay, { attributes: true, attributeFilter: ["class"] });
    start();
}
