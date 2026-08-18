import * as THREE from 'three';

const canvas = document.getElementById('c');
const splash = document.getElementById('splash');
const menu = document.getElementById('menu');
const hud = document.getElementById('hud');
const padsEl = document.getElementById('pads');
const playBtn = document.getElementById('playBtn');
const againBtn = document.getElementById('againBtn');
const loadText = document.getElementById('loadText');
const loadFill = document.getElementById('loadFill');

const mobile = matchMedia('(pointer: coarse)').matches || innerWidth < 900;
const renderer = new THREE.WebGLRenderer({ canvas, antialias: !mobile, powerPreference: 'high-performance' });
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.12;
renderer.setPixelRatio(Math.min(devicePixelRatio, mobile ? 1.15 : 1.5));

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x060a12);
scene.fog = new THREE.FogExp2(0x081018, 0.022);

const camera = new THREE.PerspectiveCamera(62, 16 / 9, 0.1, 220);
const clock = new THREE.Clock();

function fit() {
  const w = Math.max(2, innerWidth);
  const h = Math.max(2, innerHeight);
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
fit();
addEventListener('resize', fit);
addEventListener('fullscreenchange', () => setTimeout(fit, 50));

const loader = new THREE.TextureLoader();
function load(p) {
  return new Promise((res, rej) => {
    loader.load(
      p,
      (t) => {
        t.colorSpace = THREE.SRGBColorSpace;
        res(t);
      },
      undefined,
      () => rej(new Error(p))
    );
  });
}

async function loadAll(paths) {
  const n = paths.length;
  let d = 0;
  return Promise.all(
    paths.map((p) =>
      load(p).then((t) => {
        d += 1;
        const pct = Math.round((d / n) * 100);
        loadFill.style.width = pct + '%';
        loadText.textContent = pct < 100 ? `Waking the lantern… ${pct}%` : 'Ready';
        return t;
      })
    )
  );
}

const LANE_X = [-2.15, 0, 2.15];
const SEG_LEN = 10;
const ROAD_W = 7.2;

const state = {
  ready: false,
  playing: false,
  hp: 100,
  mem: 0,
  score: 0,
  dist: 0,
  pulse: 0,
};
const runner = {
  lane: 1,
  x: 0,
  y: 0,
  s: 0,
  yaw: 0,
  vy: 0,
  grounded: true,
  slide: 0,
  invuln: 0,
  speed: 16,
  turnLock: 0,
};

const pieces = [];
const pickups = [];
const hazards = [];
const facing = [];
let cursor = { x: 0, y: 0, z: 0, yaw: 0 };
let weaverGroup, lampLight, chaseWraith, pulseMesh, mats, tex;
let audioCtx;

function beep(freq, dur, type = 'sine', gain = 0.05) {
  if (!audioCtx) return;
  const o = audioCtx.createOscillator();
  const g = audioCtx.createGain();
  o.type = type;
  o.frequency.value = freq;
  g.gain.setValueAtTime(gain, audioCtx.currentTime);
  g.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + dur);
  o.connect(g).connect(audioCtx.destination);
  o.start();
  o.stop(audioCtx.currentTime + dur);
}

function goFullscreen() {
  const el = document.documentElement;
  const req = el.requestFullscreen || el.webkitRequestFullscreen;
  try {
    req?.call(el, { navigationUI: 'hide' })?.catch?.(() => {});
  } catch {}
  try {
    screen.orientation?.lock?.('landscape').catch(() => {});
  } catch {}
}

function glow(texMap, w, h) {
  const s = new THREE.Sprite(
    new THREE.SpriteMaterial({ map: texMap, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending })
  );
  s.scale.set(w, h, 1);
  return s;
}

function cutout(texMap) {
  return new THREE.ShaderMaterial({
    uniforms: { map: { value: texMap } },
    transparent: true,
    side: THREE.DoubleSide,
    depthWrite: false,
    vertexShader: `varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }`,
    fragmentShader: `uniform sampler2D map; varying vec2 vUv; void main(){
      vec4 c=texture2D(map,vUv); float lum=max(c.r,max(c.g,c.b));
      float a=smoothstep(0.04,0.16,lum); if(a<0.08) discard; gl_FragColor=vec4(c.rgb,a);
    }`,
  });
}

function heading(yaw) {
  return new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw));
}
function rightOf(yaw) {
  return new THREE.Vector3(Math.cos(yaw), 0, -Math.sin(yaw));
}

function addSegment(kind) {
  const yaw0 = cursor.yaw;
  let dYaw = 0;
  if (kind === 'left') dYaw = Math.PI / 2;
  if (kind === 'right') dYaw = -Math.PI / 2;
  const yaw1 = yaw0 + dYaw;

  const midYaw = yaw0 + dYaw * 0.5;
  const fwd = heading(kind === 'straight' ? yaw0 : midYaw);
  const pos = new THREE.Vector3(cursor.x, cursor.y, cursor.z).addScaledVector(fwd, SEG_LEN * 0.5);

  const g = new THREE.Group();
  const road = new THREE.Mesh(
    new THREE.PlaneGeometry(ROAD_W, SEG_LEN + 0.4),
    mats.road
  );
  road.rotation.x = -Math.PI / 2;
  road.rotation.z = kind === 'straight' ? 0 : dYaw * 0.5;
  g.add(road);

  const railL = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, SEG_LEN, 6), mats.rail);
  const railR = railL.clone();
  railL.rotation.z = Math.PI / 2;
  railR.rotation.z = Math.PI / 2;
  railL.position.set(-ROAD_W / 2 + 0.15, 0.12, 0);
  railR.position.set(ROAD_W / 2 - 0.15, 0.12, 0);
  railL.rotation.y = Math.PI / 2;
  railR.rotation.y = Math.PI / 2;
  g.add(railL, railR);

  g.position.copy(pos);
  g.rotation.y = kind === 'straight' ? yaw0 : midYaw;
  scene.add(g);

  const piece = { mesh: g, x: pos.x, y: pos.y, z: pos.z, yaw: kind === 'straight' ? yaw0 : yaw1, kind, s0: 0 };
  pieces.push(piece);

  cursor.x += fwd.x * SEG_LEN;
  cursor.z += fwd.z * SEG_LEN;
  cursor.yaw = yaw1;

  if (kind === 'straight' && Math.random() < 0.55) {
    const lane = Math.floor(Math.random() * 3);
    const r = rightOf(yaw0);
    const spot = pos.clone().addScaledVector(r, LANE_X[lane]);
    if (Math.random() < 0.45) {
      const orb = glow(tex.orb, 1.05, 1.05);
      orb.position.copy(spot).setY(1.15);
      scene.add(orb);
      pickups.push({ mesh: orb, lane, taken: false, px: spot.x, pz: spot.z, py: 1.15 });
    } else {
      const hz = Math.random() < 0.5 ? 'rock' : 'low';
      const spr = new THREE.Mesh(
        new THREE.PlaneGeometry(hz === 'rock' ? 1.8 : 2.4, hz === 'rock' ? 1.5 : 1.3),
        cutout(hz === 'rock' ? tex.rock : tex.banner)
      );
      spr.position.copy(spot).setY(hz === 'low' ? 0.7 : 0.85);
      scene.add(spr);
      facing.push(spr);
      hazards.push({ mesh: spr, lane, type: hz, hit: false, px: spot.x, pz: spot.z });
    }
  }

  if (Math.random() < 0.4) {
    const tree = new THREE.Mesh(new THREE.PlaneGeometry(3.2, 4.4), cutout(tex.tree));
    const side = Math.random() < 0.5 ? -1 : 1;
    tree.position.copy(pos).add(rightOf(yaw0).multiplyScalar(side * 5.4));
    tree.position.y = 2.1;
    scene.add(tree);
    facing.push(tree);
  }
}

function seedPath() {
  for (let i = 0; i < 8; i++) addSegment('straight');
  for (let i = 0; i < 18; i++) {
    const r = Math.random();
    if (r < 0.72) addSegment('straight');
    else addSegment(r < 0.86 ? 'left' : 'right');
  }
}

function pruneAndExtend() {
  const px = weaverGroup.position.x;
  const pz = weaverGroup.position.z;
  while (pieces.length && Math.hypot(pieces[0].x - px, pieces[0].z - pz) > 55 && pieces.length > 14) {
    const p = pieces.shift();
    scene.remove(p.mesh);
  }
  const last = pieces[pieces.length - 1];
  if (last && Math.hypot(last.x - px, last.z - pz) < 90) {
    const r = Math.random();
    if (r < 0.7) addSegment('straight');
    else addSegment(r < 0.85 ? 'left' : 'right');
  }
}

function nearestRoad() {
  let best = pieces[0],
    bd = 1e9;
  const p = weaverGroup.position;
  for (const s of pieces) {
    const d = (s.x - p.x) ** 2 + (s.z - p.z) ** 2;
    if (d < bd) {
      bd = d;
      best = s;
    }
  }
  return best;
}

function goFullscreenStart() {
  goFullscreen();
}

function startGame() {
  if (!state.ready || state.playing) return;
  goFullscreenStart();
  try {
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    audioCtx.resume?.();
  } catch {}
  splash.classList.add('hidden');
  menu.classList.add('hidden');
  hud.classList.remove('hidden');
  padsEl.classList.remove('hidden');
  state.playing = true;
  setTimeout(fit, 80);
  beep(240, 0.3, 'triangle', 0.05);
}

playBtn.addEventListener('click', (e) => {
  e.preventDefault();
  startGame();
});
againBtn.addEventListener('click', () => location.reload());

function jump() {
  if (!state.playing || !runner.grounded || runner.slide > 0) return;
  runner.vy = 9.4;
  runner.grounded = false;
  beep(320, 0.08, 'square', 0.03);
}
function slide() {
  if (!state.playing || !runner.grounded) return;
  runner.slide = 0.55;
  beep(140, 0.1, 'sawtooth', 0.03);
}
function lane(dir) {
  if (!state.playing) return;
  runner.lane = Math.max(0, Math.min(2, runner.lane + dir));
  beep(260, 0.05, 'sine', 0.03);
}

document.getElementById('jumpBtn').addEventListener('pointerdown', (e) => {
  e.preventDefault();
  e.stopPropagation();
  jump();
});
document.getElementById('slideBtn').addEventListener('pointerdown', (e) => {
  e.preventDefault();
  e.stopPropagation();
  slide();
});
document.getElementById('leftBtn').addEventListener('pointerdown', (e) => {
  e.preventDefault();
  e.stopPropagation();
  lane(-1);
});
document.getElementById('rightBtn').addEventListener('pointerdown', (e) => {
  e.preventDefault();
  e.stopPropagation();
  lane(1);
});

let swipe = null;
canvas.addEventListener('pointerdown', (e) => {
  swipe = { x: e.clientX, y: e.clientY };
});
canvas.addEventListener('pointerup', (e) => {
  if (!swipe || !state.playing) {
    swipe = null;
    return;
  }
  const dx = e.clientX - swipe.x;
  const dy = e.clientY - swipe.y;
  swipe = null;
  if (Math.hypot(dx, dy) < 36) return;
  if (Math.abs(dx) > Math.abs(dy)) lane(dx < 0 ? -1 : 1);
  else if (dy < 0) jump();
  else slide();
});

addEventListener('keydown', (e) => {
  if (e.code === 'ArrowLeft' || e.code === 'KeyA') lane(-1);
  if (e.code === 'ArrowRight' || e.code === 'KeyD') lane(1);
  if (e.code === 'ArrowUp' || e.code === 'Space' || e.code === 'KeyW') {
    e.preventDefault();
    jump();
  }
  if (e.code === 'ArrowDown' || e.code === 'KeyS') {
    e.preventDefault();
    slide();
  }
});

function endGame(caught) {
  state.playing = false;
  padsEl.classList.add('hidden');
  document.getElementById('end').classList.remove('hidden');
  document.getElementById('endTitle').textContent = caught ? 'CAUGHT' : 'THE DREAM FADES';
  document.getElementById('endText').textContent = caught
    ? 'The Night Wraith took the road. You ran far enough to be remembered.'
    : 'You stepped off Reverie’s path. The lantern guttered.';
  document.getElementById('endScore').textContent = Math.floor(state.score);
}

function setHud() {
  document.getElementById('hpFill').style.width = `${Math.max(0, state.hp)}%`;
  document.getElementById('memCount').textContent = state.mem;
  document.getElementById('score').textContent = Math.floor(state.score);
  document.getElementById('dist').textContent = Math.floor(state.dist);
}

async function boot() {
  const [stone, moss, sky, lantern, orb, wraith, portal, tree, rock, banner, weaver, mote] = await loadAll([
    'assets/tex_stone.jpg',
    'assets/tex_moss.jpg',
    'assets/sky.jpg',
    'assets/lantern_sprite.jpg',
    'assets/memory_orb.jpg',
    'assets/wraith.jpg',
    'assets/portal.jpg',
    'assets/tree.jpg',
    'assets/rock.jpg',
    'assets/banner.jpg',
    'assets/weaver.jpg',
    'assets/mote.jpg',
  ]);
  [stone, moss].forEach((t) => {
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(1.4, 2.2);
  });
  tex = { orb, rock, banner, tree, weaver, lantern, wraith, mote, portal };

  scene.add(new THREE.Mesh(new THREE.SphereGeometry(140, 20, 14), new THREE.MeshBasicMaterial({ map: sky, side: THREE.BackSide })));
  scene.add(new THREE.HemisphereLight(0x6aa0c8, 0x1a1008, 0.65));
  const moon = new THREE.DirectionalLight(0xc8d8ff, 0.7);
  moon.position.set(-12, 30, 8);
  scene.add(moon);

  const water = new THREE.Mesh(
    new THREE.CircleGeometry(160, 28),
    new THREE.MeshStandardMaterial({ color: 0x08141c, metalness: 0.8, roughness: 0.22, transparent: true, opacity: 0.7 })
  );
  water.rotation.x = -Math.PI / 2;
  water.position.y = -3.2;
  scene.add(water);

  mats = {
    road: new THREE.MeshStandardMaterial({ map: moss, roughness: 0.88 }),
    rail: new THREE.MeshStandardMaterial({ map: stone, roughness: 0.5, metalness: 0.25 }),
  };

  seedPath();

  weaverGroup = new THREE.Group();
  const body = new THREE.Mesh(new THREE.PlaneGeometry(1.2, 1.85), cutout(weaver));
  const lamp = glow(lantern, 0.7, 0.9);
  lamp.position.set(0.38, 0.28, 0.1);
  weaverGroup.add(body, lamp);
  facing.push(body);
  weaverGroup.position.set(0, 0, 2);
  scene.add(weaverGroup);

  lampLight = new THREE.PointLight(0xffc56a, 7, 18, 1.3);
  scene.add(lampLight);

  chaseWraith = glow(wraith, 3.4, 4.0);
  chaseWraith.position.set(0, 2.2, -8);
  scene.add(chaseWraith);

  pulseMesh = new THREE.Mesh(
    new THREE.SphereGeometry(1, 12, 10),
    new THREE.MeshBasicMaterial({ color: 0xffd27a, transparent: true, opacity: 0 })
  );
  scene.add(pulseMesh);

  for (let i = 0; i < 18; i++) {
    const m = glow(mote, 0.5, 0.5);
    m.position.set((Math.random() - 0.5) * 20, 1 + Math.random() * 6, Math.random() * 80);
    scene.add(m);
  }

  const gate = glow(portal, 5, 5);
  gate.position.set(0, 2.4, 6);
  scene.add(gate);

  state.ready = true;
  loadFill.style.width = '100%';
  loadText.textContent = 'Ready';
  fit();
  loop();
  setTimeout(() => {
    splash.classList.add('hidden');
    menu.classList.remove('hidden');
  }, 350);
}

function loop() {
  requestAnimationFrame(loop);
  const dt = Math.min(clock.getDelta(), 0.033);
  if (state.playing) step(dt);

  if (weaverGroup) {
    facing.forEach((m) => {
      const p = camera.position.clone();
      p.y = m.getWorldPosition(new THREE.Vector3()).y;
      m.lookAt(p);
    });
    lampLight.position.copy(weaverGroup.position).add(new THREE.Vector3(0.2, 1.1, 0.2));
    const back = heading(runner.yaw).multiplyScalar(-7.2);
    const camT = weaverGroup.position.clone().add(back).add(new THREE.Vector3(0, 3.4, 0));
    camera.position.lerp(camT, 1 - Math.pow(0.0008, dt));
    const look = weaverGroup.position.clone().add(heading(runner.yaw).multiplyScalar(8));
    look.y += 1.1;
    camera.lookAt(look);

    const chase = weaverGroup.position.clone().add(heading(runner.yaw).multiplyScalar(-5.5));
    chase.y = 1.8 + Math.sin(performance.now() * 0.006) * 0.2;
    chaseWraith.position.lerp(chase, 0.12);
  }
  renderer.render(scene, camera);
  if (state.playing) setHud();
}

function step(dt) {
  runner.speed = Math.min(28, 15.5 + state.dist * 0.012);
  const road = nearestRoad();
  if (!road) return;

  const wantYaw = road.yaw;
  let dy = wantYaw - runner.yaw;
  while (dy > Math.PI) dy -= Math.PI * 2;
  while (dy < -Math.PI) dy += Math.PI * 2;
  runner.yaw += dy * Math.min(1, dt * 6);

  const fwd = heading(runner.yaw);
  const rgt = rightOf(runner.yaw);
  weaverGroup.position.addScaledVector(fwd, runner.speed * dt);
  runner.x += (LANE_X[runner.lane] - runner.x) * Math.min(1, dt * 12);
  const base = weaverGroup.position.clone();
  // re-project onto road center then apply lane
  const toC = new THREE.Vector3(road.x - weaverGroup.position.x, 0, road.z - weaverGroup.position.z);
  const along = toC.dot(fwd);
  const center = new THREE.Vector3(road.x, 0, road.z).addScaledVector(fwd, -along * 0.15);
  weaverGroup.position.x = center.x + rgt.x * runner.x;
  weaverGroup.position.z = center.z + rgt.z * runner.x;

  runner.vy -= 28 * dt;
  runner.y += runner.vy * dt;
  if (runner.y <= 0) {
    runner.y = 0;
    runner.vy = 0;
    runner.grounded = true;
  }
  runner.slide = Math.max(0, runner.slide - dt);
  runner.invuln -= dt;
  weaverGroup.position.y = 0.95 + runner.y - (runner.slide > 0 ? 0.45 : 0);
  weaverGroup.scale.setScalar(runner.slide > 0 ? 0.78 : 1);
  weaverGroup.rotation.y = runner.yaw;

  state.dist += runner.speed * dt;
  state.score += runner.speed * dt * 4;

  const px = weaverGroup.position.x;
  const pz = weaverGroup.position.z;

  pickups.forEach((o) => {
    if (o.taken) return;
    o.mesh.position.y = o.py + Math.sin(performance.now() * 0.006) * 0.15;
    if (o.lane === runner.lane && Math.hypot(o.px - px, o.pz - pz) < 1.6 && runner.y < 1.4) {
      o.taken = true;
      o.mesh.visible = false;
      state.mem += 1;
      state.score += 250;
      state.hp = Math.min(100, state.hp + 6);
      beep(720, 0.12, 'sine', 0.06);
    }
  });

  hazards.forEach((h) => {
    if (h.hit || runner.invuln > 0) return;
    if (h.lane !== runner.lane) return;
    if (Math.hypot(h.px - px, h.pz - pz) > 1.35) return;
    if (h.type === 'rock' && runner.y > 1.15) return;
    if (h.type === 'low' && runner.slide > 0) return;
    h.hit = true;
    state.hp -= 22;
    runner.invuln = 0.9;
    runner.speed *= 0.72;
    beep(80, 0.22, 'sawtooth', 0.07);
  });

  const off = Math.abs(runner.x) > 3.5 && runner.grounded;
  if (off) {
    state.hp -= 40 * dt;
  }
  if (state.hp <= 0) endGame(true);

  pruneAndExtend();
}

boot().catch((err) => {
  console.error(err);
  if (loadText) loadText.textContent = 'Could not load. Refresh.';
});
