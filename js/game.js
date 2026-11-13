// Three.js world: endless country road, a bike + rider seen from behind,
// obstacles to dodge and coins to collect.
import * as THREE from 'three';

const ROAD_HALF = 5; // road is 10 units wide
const TILE = 10; // texture tile length (world units)
const GROUND_LEN = 420;
const VIEW_AHEAD = 170; // how far ahead obstacles are spawned
const IDLE_SPEED = 8;
const BASE_SPEED = 13;
const MAX_SPEED = 30;
const SCENERY_SPAN = 240;
const BIKE_HALF_W = 0.28;

const UP = new THREE.Vector3(0, 1, 0);
const tmpDir = new THREE.Vector3();
const tmpEuler = new THREE.Euler();

const rand = (a, b) => a + Math.random() * (b - a);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const damp = (cur, target, rate, dt) => cur + (target - cur) * (1 - Math.exp(-rate * dt));
const lam = (color, extra = {}) => new THREE.MeshLambertMaterial({ color, ...extra });

const cylCache = new Map();
function unitCyl(r) {
  if (!cylCache.has(r)) cylCache.set(r, new THREE.CylinderGeometry(r, r, 1, 10));
  return cylCache.get(r);
}

/** Stretch a unit-height mesh so it spans from a to b. */
function placeBetween(mesh, a, b) {
  tmpDir.subVectors(b, a);
  const len = tmpDir.length() || 1e-6;
  mesh.position.copy(a).addScaledVector(tmpDir, 0.5);
  mesh.scale.set(1, len, 1);
  mesh.quaternion.setFromUnitVectors(UP, tmpDir.multiplyScalar(1 / len));
}

function canvasTexture(w, h, paint) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  paint(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = THREE.RepeatWrapping;
  t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  return t;
}

function speckle(g, w, h, n, colors, size = 2) {
  for (let i = 0; i < n; i++) {
    g.fillStyle = colors[(Math.random() * colors.length) | 0];
    g.fillRect(Math.random() * w, Math.random() * h, size, size);
  }
}

const roadTexture = () =>
  canvasTexture(256, 256, (g, w, h) => {
    g.fillStyle = '#55585e';
    g.fillRect(0, 0, w, h);
    speckle(g, w, h, 2200, ['#4b4e54', '#62656b', '#5a5d63', '#6b6e74']);
    g.fillStyle = '#f4f4f4';
    g.fillRect(6, 0, 7, h);
    g.fillRect(w - 13, 0, 7, h);
    g.fillStyle = '#ffd34d';
    for (const x of [w / 3, (2 * w) / 3]) g.fillRect(x - 3, 0, 6, h / 2);
  });

const grassTexture = () =>
  canvasTexture(256, 256, (g, w, h) => {
    g.fillStyle = '#6aac4f';
    g.fillRect(0, 0, w, h);
    speckle(g, w, h, 3000, ['#5f9f45', '#77b95a', '#64a64a', '#82c164'], 3);
    speckle(g, w, h, 40, ['#f7f3c2', '#ffffff', '#f6c1d9'], 3);
  });

const stripeTexture = () =>
  canvasTexture(128, 32, (g, w, h) => {
    g.fillStyle = '#ffffff';
    g.fillRect(0, 0, w, h);
    g.fillStyle = '#e63946';
    for (let x = -h; x < w + h; x += 32) {
      g.beginPath();
      g.moveTo(x, h);
      g.lineTo(x + 16, h);
      g.lineTo(x + 16 + h, 0);
      g.lineTo(x + h, 0);
      g.fill();
    }
  });

export class Game {
  constructor(container) {
    this.handlers = {};
    const r = (this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' }));
    r.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    r.outputColorSpace = THREE.SRGBColorSpace;
    container.appendChild(r.domElement);

    const sky = 0xa8d8ff;
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(sky);
    this.scene.fog = new THREE.Fog(sky, 45, 165);
    this.camera = new THREE.PerspectiveCamera(60, 1, 0.1, 700);

    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x5c8a45, 2.2));
    const sun = new THREE.DirectionalLight(0xfff1d6, 2.4);
    sun.position.set(-30, 50, 20);
    this.scene.add(sun);

    this.bikeX = 0;
    this.bikeZ = 0;
    this.speed = IDLE_SPEED;
    this.steer = 0;
    this.camX = 0;
    this.shake = 0;
    this.time = 0;
    this.crank = 0;
    this.obstacles = [];
    this.coinsList = [];

    this.buildWorld();
    this.buildBike();
    this.reset();

    window.addEventListener('resize', () => this.resize());
    this.resize();
  }

  on(evt, fn) {
    (this.handlers[evt] ||= []).push(fn);
  }
  emit(evt, ...args) {
    (this.handlers[evt] || []).forEach((fn) => fn(...args));
  }

  get score() {
    return Math.floor(this.distance) + this.coins * 25;
  }
  get kmh() {
    return Math.round(this.speed * 2);
  }

  resize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    // Narrow (portrait) screens: widen FOV a bit so the road still fits.
    this.baseFov = w / h < 0.8 ? 72 : 60;
    this.camera.updateProjectionMatrix();
  }

  // ---------------------------------------------------------------- world
  buildWorld() {
    const roadTex = roadTexture();
    roadTex.wrapS = THREE.ClampToEdgeWrapping;
    roadTex.repeat.set(1, GROUND_LEN / TILE);
    this.road = new THREE.Mesh(
      new THREE.PlaneGeometry(ROAD_HALF * 2, GROUND_LEN),
      new THREE.MeshLambertMaterial({ map: roadTex }),
    );
    this.road.rotation.x = -Math.PI / 2;
    this.road.position.y = 0.01;
    this.scene.add(this.road);

    const grassTex = grassTexture();
    grassTex.repeat.set(40, GROUND_LEN / TILE);
    this.grass = new THREE.Mesh(
      new THREE.PlaneGeometry(400, GROUND_LEN),
      new THREE.MeshLambertMaterial({ map: grassTex }),
    );
    this.grass.rotation.x = -Math.PI / 2;
    this.scene.add(this.grass);

    const shoulderMat = lam(0xd9c38f);
    this.shoulders = [-1, 1].map((side) => {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(1.2, GROUND_LEN), shoulderMat);
      m.rotation.x = -Math.PI / 2;
      m.position.set(side * (ROAD_HALF + 0.6), 0.005, 0);
      this.scene.add(m);
      return m;
    });

    // Trees (recycled as the bike moves forward)
    const trunkGeo = new THREE.CylinderGeometry(0.16, 0.22, 1.3, 6);
    const pineGeo = new THREE.ConeGeometry(1.1, 2.8, 7);
    const roundGeo = new THREE.IcosahedronGeometry(1.25, 0);
    const trunkMat = lam(0x7a5230, { flatShading: true });
    const leafMats = [0x2f7d32, 0x3c8f3a, 0x4f9d3a, 0x2a6b3f].map((c) => lam(c, { flatShading: true }));
    this.trees = [];
    for (let i = 0; i < 80; i++) {
      const t = new THREE.Group();
      const trunk = new THREE.Mesh(trunkGeo, trunkMat);
      trunk.position.y = 0.65;
      t.add(trunk);
      const pine = Math.random() < 0.55;
      const leaves = new THREE.Mesh(pine ? pineGeo : roundGeo, leafMats[i % leafMats.length]);
      leaves.position.y = pine ? 2.5 : 2.2;
      leaves.rotation.y = Math.random() * Math.PI;
      t.add(leaves);
      this.placeTree(t, this.bikeZ + 15 - Math.random() * SCENERY_SPAN);
      this.scene.add(t);
      this.trees.push(t);
    }

    // Roadside posts every 10 units: a strong sense of speed.
    const postGeo = new THREE.BoxGeometry(0.14, 0.8, 0.14);
    const postCapGeo = new THREE.BoxGeometry(0.15, 0.14, 0.15);
    const postMat = lam(0xf5f5f5);
    const capMat = lam(0xe63946);
    this.posts = [];
    for (let i = 0; i < 48; i++) {
      const p = new THREE.Group();
      const body = new THREE.Mesh(postGeo, postMat);
      body.position.y = 0.4;
      const cap = new THREE.Mesh(postCapGeo, capMat);
      cap.position.y = 0.72;
      p.add(body, cap);
      p.position.set((i % 2 ? 1 : -1) * (ROAD_HALF + 1.0), 0, 15 - Math.floor(i / 2) * TILE);
      this.scene.add(p);
      this.posts.push(p);
    }

    // Distant mountains + clouds follow the bike (no fog so they stay visible).
    this.backdrop = new THREE.Group();
    const mountainMats = [0x7d9cc4, 0x6f8fb8, 0x8fb0d4].map((c) => lam(c, { fog: false, flatShading: true }));
    for (let i = 0; i < 22; i++) {
      const ang = rand(-Math.PI * 0.9, Math.PI * 0.9);
      const dist = rand(330, 420);
      const h = rand(50, 110);
      const m = new THREE.Mesh(new THREE.ConeGeometry(rand(60, 110), h, 5), mountainMats[i % 3]);
      m.position.set(Math.sin(ang) * dist, h / 2 - 8, -Math.cos(ang) * dist);
      m.rotation.y = Math.random() * Math.PI;
      this.backdrop.add(m);
    }
    const cloudMat = new THREE.MeshLambertMaterial({ color: 0xffffff, fog: false, emissive: 0x99a4b3 });
    const puffGeo = new THREE.IcosahedronGeometry(1, 1);
    for (let i = 0; i < 12; i++) {
      const cloud = new THREE.Group();
      for (let j = 0; j < 4; j++) {
        const puff = new THREE.Mesh(puffGeo, cloudMat);
        puff.scale.setScalar(rand(8, 14));
        puff.position.set(j * 11 + rand(-3, 3), rand(-2, 3), rand(-4, 4));
        cloud.add(puff);
      }
      const ang = rand(-1.3, 1.3);
      const dist = rand(250, 380);
      cloud.position.set(Math.sin(ang) * dist, rand(70, 110), -Math.cos(ang) * dist);
      cloud.scale.y = 0.45;
      this.backdrop.add(cloud);
    }
    this.scene.add(this.backdrop);

    // Obstacles & coins share geometry/materials.
    const stripe = stripeTexture();
    stripe.repeat.set(2, 1);
    this.obstacleTypes = {
      cone: {
        halfW: 0.32,
        make: () => {
          const g = new THREE.Group();
          const cone = new THREE.Mesh(new THREE.ConeGeometry(0.3, 0.78, 14), lam(0xff7b00));
          cone.position.y = 0.42;
          const band = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.2, 0.12, 14), lam(0xffffff));
          band.position.y = 0.45;
          const base = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.06, 0.62), lam(0x2b2d42));
          base.position.y = 0.03;
          g.add(cone, band, base);
          return g;
        },
      },
      rock: {
        halfW: 0.65,
        make: () => {
          const m = new THREE.Mesh(new THREE.DodecahedronGeometry(0.68, 0), lam(0x8d8f99, { flatShading: true }));
          m.scale.set(1, 0.7, 0.9);
          m.position.y = 0.32;
          m.rotation.set(Math.random(), Math.random() * 3, 0);
          const g = new THREE.Group();
          g.add(m);
          return g;
        },
      },
      barrier: {
        halfW: 1.05,
        make: () => {
          const g = new THREE.Group();
          const board = new THREE.Mesh(
            new THREE.BoxGeometry(2.1, 0.36, 0.1),
            new THREE.MeshLambertMaterial({ map: stripe }),
          );
          board.position.y = 0.72;
          const legMat = lam(0x2b2d42);
          for (const x of [-0.85, 0.85]) {
            const leg = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.9, 0.45), legMat);
            leg.position.set(x, 0.45, 0);
            g.add(leg);
          }
          g.add(board);
          return g;
        },
      },
    };
    this.coinGeo = new THREE.CylinderGeometry(0.34, 0.34, 0.08, 22);
    this.coinGeo.rotateX(Math.PI / 2);
    this.coinMat = new THREE.MeshLambertMaterial({ color: 0xffc300, emissive: 0x7a4b00 });
  }

  placeTree(t, z) {
    const side = Math.random() < 0.5 ? -1 : 1;
    t.position.set(side * (ROAD_HALF + 3 + Math.random() ** 1.5 * 40), 0, z);
    t.scale.setScalar(rand(0.75, 1.7));
  }

  // ----------------------------------------------------------------- bike
  buildBike() {
    const P = (x, y, z) => new THREE.Vector3(x, y, z);
    const root = (this.bike = new THREE.Group());
    const lean = (this.lean = new THREE.Group());
    root.add(lean);
    this.scene.add(root);

    const frameMat = lam(0xe63946);
    const dark = lam(0x23252f);
    const metal = lam(0xc0c6d0);
    const tube = (a, b, r, mat, parent = lean) => {
      const m = new THREE.Mesh(unitCyl(r), mat);
      placeBetween(m, a, b);
      parent.add(m);
      return m;
    };

    const R = P(0, 0.36, 0.62); // rear hub
    const F = P(0, 0.36, -0.66); // front hub
    const BB = (this.BB = P(0, 0.3, 0.08)); // bottom bracket
    const S = P(0, 0.86, 0.26); // seat tube top
    const H1 = P(0, 0.92, -0.4); // head tube top
    const H2 = P(0, 0.7, -0.46); // head tube bottom
    tube(R, BB, 0.028, frameMat);
    tube(R, S, 0.024, frameMat);
    tube(BB, S, 0.034, frameMat);
    tube(S, H1, 0.034, frameMat);
    tube(BB, H2, 0.04, frameMat);
    tube(H1, H2, 0.042, frameMat);
    tube(S, P(0, 0.95, 0.28), 0.02, metal);
    const saddle = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.06, 0.3), dark);
    saddle.position.set(0, 0.97, 0.28);
    lean.add(saddle);

    this.rearWheel = this.makeWheel();
    this.rearWheel.position.copy(R);
    lean.add(this.rearWheel);

    // Front assembly turns with the handlebar.
    const steer = (this.steerGroup = new THREE.Group());
    steer.position.set(0, 0, -0.46);
    lean.add(steer);
    const off = (v) => v.clone().sub(steer.position);
    tube(off(H2), off(F), 0.026, metal, steer);
    tube(off(H1), off(P(0, 1.02, -0.44)), 0.025, metal, steer);
    tube(off(P(-0.32, 1.02, -0.44)), off(P(0.32, 1.02, -0.44)), 0.022, metal, steer);
    for (const x of [-1, 1]) tube(off(P(x * 0.24, 1.02, -0.44)), off(P(x * 0.34, 1.02, -0.44)), 0.032, dark, steer);
    this.frontWheel = this.makeWheel();
    this.frontWheel.position.copy(off(F));
    steer.add(this.frontWheel);
    this.gripLocal = [P(-0.3, 1.02, -0.44), P(0.3, 1.02, -0.44)].map(off);

    // Crank
    this.crankGroup = new THREE.Group();
    this.crankGroup.position.copy(BB);
    const ring = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.11, 0.02, 18), metal);
    ring.rotation.z = Math.PI / 2;
    ring.position.x = 0.05;
    this.crankGroup.add(ring);
    lean.add(this.crankGroup);

    // Rider
    const shirt = lam(0x2a6fdb);
    const pants = lam(0x2b2d42);
    const skin = lam(0xc68642);
    const helmet = lam(0xffd166);
    const hip = P(0, 1.0, 0.24);
    const shoulder = (this.shoulder = P(0, 1.42, -0.06));
    const torso = new THREE.Mesh(new THREE.BoxGeometry(0.38, 1, 0.24), shirt);
    placeBetween(torso, hip, shoulder);
    lean.add(torso);
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.13, 16, 12), skin);
    head.position.set(0, 1.6, -0.16);
    const lid = new THREE.Mesh(new THREE.SphereGeometry(0.155, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), helmet);
    lid.position.set(0, 1.62, -0.15);
    lid.rotation.x = -0.25;
    lean.add(head, lid);

    this.limbs = [-1, 1].map((side) => {
      const arm = new THREE.Mesh(unitCyl(0.05), shirt);
      const hand = new THREE.Mesh(new THREE.SphereGeometry(0.055, 10, 8), skin);
      const thigh = new THREE.Mesh(unitCyl(0.07), pants);
      const shin = new THREE.Mesh(unitCyl(0.055), pants);
      const shoe = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.07, 0.22), dark);
      const crankArm = new THREE.Mesh(unitCyl(0.018), metal);
      lean.add(arm, hand, thigh, shin, shoe, crankArm);
      return {
        side,
        arm,
        hand,
        thigh,
        shin,
        shoe,
        crankArm,
        hip: P(side * 0.12, 0.98, 0.24),
        shoulder: P(side * 0.2, 1.4, -0.07),
        knee: new THREE.Vector3(),
        pedal: new THREE.Vector3(),
        grip: new THREE.Vector3(),
        crankStart: P(side * 0.1, BB.y, BB.z),
      };
    });

    // Soft blob shadow
    const shadow = new THREE.Mesh(
      new THREE.CircleGeometry(0.5, 24),
      new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.25, depthWrite: false }),
    );
    shadow.rotation.x = -Math.PI / 2;
    shadow.scale.set(0.9, 2.1, 1);
    shadow.position.y = 0.02;
    root.add(shadow);
  }

  makeWheel() {
    const wheel = new THREE.Group();
    const tire = new THREE.Mesh(new THREE.TorusGeometry(0.34, 0.045, 8, 30), lam(0x1b1b1f));
    tire.rotation.y = Math.PI / 2;
    wheel.add(tire);
    const rim = new THREE.Mesh(new THREE.TorusGeometry(0.3, 0.015, 6, 30), lam(0xc0c6d0));
    rim.rotation.y = Math.PI / 2;
    wheel.add(rim);
    const spokeGeo = new THREE.BoxGeometry(0.012, 0.6, 0.012);
    const spokeMat = lam(0xdfe3ea);
    for (let i = 0; i < 6; i++) {
      const s = new THREE.Mesh(spokeGeo, spokeMat);
      s.rotation.x = (i * Math.PI) / 6;
      wheel.add(s);
    }
    const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.12, 10), lam(0x777b85));
    hub.rotation.z = Math.PI / 2;
    wheel.add(hub);
    return wheel;
  }

  // ----------------------------------------------------------- game state
  reset() {
    for (const o of this.obstacles) this.scene.remove(o.mesh);
    for (const c of this.coinsList) this.scene.remove(c.mesh);
    this.obstacles = [];
    this.coinsList = [];
    this.lives = 3;
    this.coins = 0;
    this.distance = 0;
    this.elapsed = 0;
    this.invuln = 0;
    this.crashed = false;
    this.crashLean = 0;
    this.crashDir = 1;
    this.bikeX = 0;
    this.running = false;
  }

  startRun() {
    this.running = true;
    this.startZ = this.bikeZ;
    this.nextSpawnZ = this.bikeZ - 45;
  }

  spawnRow(z) {
    const difficulty = clamp(this.distance / 2500, 0, 1);
    const count = Math.random() < 0.3 + difficulty * 0.45 ? 2 : 1;
    const placed = [];
    const types = difficulty > 0.15 ? ['cone', 'cone', 'rock', 'barrier'] : ['cone', 'cone', 'rock'];
    for (let i = 0; i < count; i++) {
      const type = types[(Math.random() * types.length) | 0];
      const def = this.obstacleTypes[type];
      let x;
      let tries = 0;
      do {
        x = rand(-ROAD_HALF + def.halfW + 0.2, ROAD_HALF - def.halfW - 0.2);
        tries++;
      } while (tries < 20 && placed.some((p) => Math.abs(p.x - x) < p.halfW + def.halfW + 2.2));
      if (tries >= 20) continue;
      const mesh = def.make();
      mesh.position.set(x, 0, z);
      mesh.rotation.y = rand(-0.2, 0.2);
      this.scene.add(mesh);
      const o = { mesh, x, z, halfW: def.halfW, hit: false, vel: new THREE.Vector3(), spin: 0 };
      this.obstacles.push(o);
      placed.push(o);
    }

    if (Math.random() < 0.65) {
      // A short line of coins in a free spot, sometimes drifting across the road.
      let x;
      let tries = 0;
      do {
        x = rand(-ROAD_HALF + 0.8, ROAD_HALF - 0.8);
        tries++;
      } while (tries < 20 && placed.some((p) => Math.abs(p.x - x) < p.halfW + 1.2));
      if (tries < 20) {
        const drift = Math.random() < 0.4 ? rand(-0.35, 0.35) : 0;
        for (let k = 0; k < 5; k++) {
          const cx = clamp(x + drift * (k - 2), -ROAD_HALF + 0.6, ROAD_HALF - 0.6);
          if (placed.some((p) => Math.abs(p.x - cx) < p.halfW + 0.6)) continue;
          const mesh = new THREE.Mesh(this.coinGeo, this.coinMat);
          const cz = z + 4 - k * 2;
          mesh.position.set(cx, 0.75, cz);
          this.scene.add(mesh);
          this.coinsList.push({ mesh, x: cx, z: cz, taken: false, t: 0 });
        }
      }
    }
  }

  /**
   * @param {number} dt seconds
   * @param {number} input steering -1..1
   * @param {'idle'|'run'|'pause'} mode
   */
  update(dt, input, mode) {
    if (mode === 'pause') return;
    this.time += dt;
    const controllable = !this.crashed;
    this.steer = damp(this.steer, controllable ? clamp(input, -1, 1) : 0, 9, dt);

    const offroad = Math.abs(this.bikeX) > ROAD_HALF - 0.35;
    if (this.crashed) {
      this.speed = damp(this.speed, 0, 2.5, dt);
      this.crashLean = damp(this.crashLean, 1.25, 4, dt);
    } else if (mode === 'run' && this.running) {
      this.elapsed += dt;
      const cruise = Math.min(MAX_SPEED, BASE_SPEED + this.elapsed * 0.22);
      const target = offroad ? cruise * 0.5 : cruise;
      this.speed = damp(this.speed, target, this.speed < target ? 0.7 : 2.5, dt);
    } else {
      this.speed = damp(this.speed, IDLE_SPEED, 1.2, dt);
    }

    if (controllable) {
      this.bikeX += this.steer * (3 + this.speed * 0.28) * dt;
      this.bikeX = clamp(this.bikeX, -ROAD_HALF - 0.6, ROAD_HALF + 0.6);
    }
    this.bikeZ -= this.speed * dt;

    if (this.running && !this.crashed) {
      this.distance = this.startZ - this.bikeZ;
      while (this.nextSpawnZ > this.bikeZ - VIEW_AHEAD) {
        this.spawnRow(this.nextSpawnZ);
        const difficulty = clamp(this.distance / 2500, 0, 1);
        this.nextSpawnZ -= rand(18, 26) - difficulty * 9;
      }
      this.checkCollisions();
    }
    this.invuln = Math.max(0, this.invuln - dt);
    this.shake = Math.max(0, this.shake - dt * 1.6);
    if (offroad && !this.crashed && this.speed > 3) this.shake = Math.max(this.shake, 0.08);

    this.updateEntities(dt);
    this.updateScenery();
    this.updateBike(dt);
    this.updateCamera(dt);
  }

  checkCollisions() {
    for (const o of this.obstacles) {
      if (o.hit || this.invuln > 0) continue;
      if (Math.abs(o.z - this.bikeZ) < 0.7 && Math.abs(o.x - this.bikeX) < o.halfW + BIKE_HALF_W) {
        o.hit = true;
        o.vel.set(Math.sign(o.x - this.bikeX || 1) * rand(3, 6), 6, -this.speed * 0.6);
        o.spin = rand(4, 9);
        this.lives -= 1;
        this.speed *= 0.35;
        this.invuln = 1.6;
        this.shake = 0.6;
        this.emit('hit', this.lives);
        if (this.lives <= 0) {
          this.crashed = true;
          this.crashDir = Math.sign(this.steer) || 1;
          this.running = false;
          this.emit('over');
          return;
        }
      }
    }
    for (const c of this.coinsList) {
      if (c.taken) continue;
      if (Math.abs(c.z - this.bikeZ) < 0.8 && Math.abs(c.x - this.bikeX) < 0.7) {
        c.taken = true;
        this.coins += 1;
        this.emit('coin', this.coins);
      }
    }
  }

  updateEntities(dt) {
    const behind = this.bikeZ + 8;
    this.obstacles = this.obstacles.filter((o) => {
      if (o.hit) {
        o.vel.y -= 18 * dt;
        o.mesh.position.addScaledVector(o.vel, dt);
        if (o.mesh.position.y < 0) {
          o.mesh.position.y = 0;
          o.vel.set(o.vel.x * 0.5, 0, o.vel.z * 0.5);
          o.spin *= 0.5;
        }
        o.mesh.rotation.x += o.spin * dt;
        o.mesh.rotation.z += o.spin * 0.6 * dt;
      }
      if (o.mesh.position.z > behind) {
        this.scene.remove(o.mesh);
        return false;
      }
      return true;
    });
    this.coinsList = this.coinsList.filter((c) => {
      c.mesh.rotation.y = this.time * 3 + c.z;
      if (c.taken) {
        c.t += dt;
        c.mesh.position.y = 0.75 + c.t * 4;
        c.mesh.position.z = this.bikeZ - 0.5;
        c.mesh.scale.setScalar(Math.max(0.01, 1 - c.t * 3));
        if (c.t > 0.33) {
          this.scene.remove(c.mesh);
          return false;
        }
      } else {
        c.mesh.position.y = 0.75 + Math.sin(this.time * 4 + c.z) * 0.08;
      }
      if (c.mesh.position.z > behind) {
        this.scene.remove(c.mesh);
        return false;
      }
      return true;
    });
  }

  updateScenery() {
    const snapZ = Math.round(this.bikeZ / TILE) * TILE - GROUND_LEN / 2 + 30;
    this.road.position.z = snapZ;
    this.grass.position.z = snapZ;
    for (const s of this.shoulders) s.position.z = snapZ;
    for (const t of this.trees) {
      if (t.position.z > this.bikeZ + 15) this.placeTree(t, t.position.z - SCENERY_SPAN);
    }
    const postSpan = (this.posts.length / 2) * TILE;
    for (const p of this.posts) if (p.position.z > this.bikeZ + 15) p.position.z -= postSpan;
    this.backdrop.position.set(this.camX * 0.2, 0, this.bikeZ);
  }

  updateBike(dt) {
    const s = this.steer;
    this.bike.position.set(this.bikeX, 0, this.bikeZ);
    this.bike.rotation.y = -s * 0.18;
    const wobble = Math.abs(this.bikeX) > ROAD_HALF - 0.35 ? Math.sin(this.time * 40) * 0.015 : 0;
    this.lean.rotation.z = -s * 0.42 + wobble - this.crashLean * this.crashDir;
    this.steerGroup.rotation.y = -s * 0.45;
    this.bike.visible = this.invuln <= 0 || this.crashed || Math.floor(this.time * 14) % 2 === 0;

    const spin = (this.speed * dt) / 0.38;
    this.rearWheel.rotation.x -= spin;
    this.frontWheel.rotation.x -= spin;
    this.crank -= spin * 0.55;
    this.crankGroup.rotation.x = this.crank;

    const BB = this.BB;
    const crankR = 0.17;
    tmpEuler.set(0, this.steerGroup.rotation.y, 0);
    for (const L of this.limbs) {
      const a = this.crank + (L.side > 0 ? Math.PI : 0);
      L.pedal.set(L.side * 0.15, BB.y + Math.cos(a) * crankR, BB.z - Math.sin(a) * crankR);
      placeBetween(L.crankArm, L.crankStart, L.pedal);
      L.shoe.position.copy(L.pedal);
      L.shoe.position.y += 0.04;

      solveKnee(L.hip, L.pedal, 0.47, 0.47, L.knee);
      placeBetween(L.thigh, L.hip, L.knee);
      placeBetween(L.shin, L.knee, L.pedal);

      L.grip
        .copy(this.gripLocal[L.side > 0 ? 1 : 0])
        .applyEuler(tmpEuler)
        .add(this.steerGroup.position);
      placeBetween(L.arm, L.shoulder, L.grip);
      L.hand.position.copy(L.grip);
    }
  }

  updateCamera(dt) {
    this.camX = damp(this.camX, this.bikeX * 0.75, 4, dt);
    const sh = this.shake * this.shake;
    const sx = (Math.random() - 0.5) * sh;
    const sy = (Math.random() - 0.5) * sh;
    const cam = this.camera;
    cam.position.set(this.camX + sx, 2.5 + sy, this.bikeZ + 5.4);
    cam.lookAt(this.bikeX * 0.85, 1.05, this.bikeZ - 7);
    cam.rotateZ(-this.steer * 0.035);
    const fov = this.baseFov + Math.max(0, this.speed - BASE_SPEED) * 0.45;
    if (Math.abs(cam.fov - fov) > 0.01) {
      cam.fov = damp(cam.fov, fov, 3, dt);
      cam.updateProjectionMatrix();
    }
  }

  render() {
    this.renderer.render(this.scene, this.camera);
  }
}

/** Two-bone IK in the bike's Y/Z plane; knee bends forward (-z). */
function solveKnee(hip, foot, l1, l2, out) {
  const dy = foot.y - hip.y;
  const dz = foot.z - hip.z;
  const d = Math.min(Math.hypot(dy, dz), l1 + l2 - 1e-4);
  const a = (l1 * l1 - l2 * l2 + d * d) / (2 * d);
  const h = Math.sqrt(Math.max(0, l1 * l1 - a * a));
  const uy = dy / d;
  const uz = dz / d;
  // Perpendicular with negative z (forward).
  let py = uz;
  let pz = -uy;
  if (pz > 0) {
    py = -py;
    pz = -pz;
  }
  out.set((hip.x + foot.x) / 2, hip.y + uy * a + py * h, hip.z + uz * a + pz * h);
}
