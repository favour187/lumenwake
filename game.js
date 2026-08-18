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

function sizeOf() {
  return { w: Math.max(2, innerWidth), h: Math.max(2, innerHeight) };
}

const mobile = matchMedia('(pointer: coarse)').matches || innerWidth < 900;
const renderer = new THREE.WebGLRenderer({ canvas, antialias: !mobile, powerPreference: 'high-performance' });
renderer.shadowMap.enabled = false;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.12;
renderer.setPixelRatio(Math.min(devicePixelRatio, mobile ? 1.15 : 1.5));

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x060a12);
scene.fog = new THREE.FogExp2(0x081018, 0.018);

const camera = new THREE.PerspectiveCamera(58, 16 / 9, 0.1, 220);
const clock = new THREE.Clock();

function fit() {
  const { w, h } = sizeOf();
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
addEventListener('resize', fit);

const loader = new THREE.TextureLoader();
const cache = {};
function load(p) {
  if (cache[p]) return cache[p];
  cache[p] = new Promise((res, rej) => {
    loader.load(
      p,
      (t) => {
        t.colorSpace = THREE.SRGBColorSpace;
        t.anisotropy = 2;
        t.generateMipmaps = true;
        res(t);
      },
      undefined,
      () => rej(new Error(p))
    );
  });
  return cache[p];
}

let done = 0;
const TOTAL = 12;
function tickLoad() {
  done += 1;
  const pct = Math.min(100, Math.round((done / TOTAL) * 100));
  loadFill.style.width = pct + '%';
  loadText.textContent = pct < 100 ? `Waking the lantern… ${pct}%` : 'Ready';
}

async function loadAll(paths) {
  const out = [];
  for (const p of paths) {
    out.push(await load(p));
    tickLoad();
  }
  return out;
}

const keys = {};
const stick = { x: 0, y: 0, down: false };
addEventListener('keydown', (e) => {
  keys[e.code] = true;
  if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
});
addEventListener('keyup', (e) => (keys[e.code] = false));

const state = {
  ready: false,
  playing: false,
  hp: 100,
  memories: 0,
  score: 0,
  combo: 1,
  comboT: 0,
  time: 0,
  pulse: 0,
};

const player = {
  pos: new THREE.Vector3(0, 2.2, 8),
  vel: new THREE.Vector3(),
  yaw: 0,
  grounded: false,
  dash: 0,
  invuln: 0,
};

let lanternLight, playerGroup, pulseMesh;
const memories = [];
const wraiths = [];
const sparks = [];
const facing = [];
let audioCtx;

function beep(freq, dur, type = 'sine', gain = 0.06) {
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

function startGame() {
  if (!state.ready || state.playing) return;
  try {
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    audioCtx.resume?.();
  } catch {}
  splash.classList.add('hidden');
  menu.classList.add('hidden');
  hud.classList.remove('hidden');
  padsEl.classList.remove('hidden');
  fit();
  state.playing = true;
  beep(220, 0.35, 'triangle', 0.05);
}

playBtn.addEventListener('click', (e) => {
  e.preventDefault();
  startGame();
});
againBtn.addEventListener('click', (e) => {
  e.preventDefault();
  location.reload();
});

function glowSprite(tex, w, h) {
  const s = new THREE.Sprite(
    new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending })
  );
  s.scale.set(w, h, 1);
  return s;
}

function cutoutMat(tex) {
  return new THREE.ShaderMaterial({
    uniforms: { map: { value: tex } },
    transparent: true,
    side: THREE.DoubleSide,
    depthWrite: false,
    vertexShader: `varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }`,
    fragmentShader: `uniform sampler2D map; varying vec2 vUv; void main(){
      vec4 c=texture2D(map,vUv); float lum=max(c.r,max(c.g,c.b));
      float a=smoothstep(0.035,0.14,lum); if(a<0.08) discard; gl_FragColor=vec4(c.rgb,a);
    }`,
  });
}

function prop(tex, w, h, pos) {
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h), cutoutMat(tex));
  mesh.position.copy(pos);
  scene.add(mesh);
  facing.push(mesh);
}

function mkMat(map, opts = {}) {
  return new THREE.MeshStandardMaterial({
    map,
    roughness: opts.roughness ?? 0.75,
    metalness: opts.metalness ?? 0.15,
    emissive: opts.emissive ?? 0x000000,
    emissiveIntensity: opts.emissiveIntensity ?? 0,
  });
}

function addIsland(x, z, r, h, mats) {
  const g = new THREE.Group();
  const top = new THREE.Mesh(new THREE.CylinderGeometry(r, r * 0.92, 0.55, 12), mats.moss);
  top.position.y = h;
  const body = new THREE.Mesh(new THREE.ConeGeometry(r * 0.95, h + 4, 8), mats.stone);
  body.position.y = h / 2 - 2.2;
  g.add(top, body);
  g.position.set(x, 0, z);
  scene.add(g);
  return { x, z, r, h };
}

function spawnMemory(pos, orbTex) {
  const s = glowSprite(orbTex, 1.15, 1.15);
  s.position.copy(pos);
  scene.add(s);
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.55, 0.035, 6, 16), new THREE.MeshBasicMaterial({ color: 0xf0c36a }));
  ring.position.copy(pos);
  scene.add(ring);
  memories.push({ mesh: s, ring, taken: false, base: pos.clone() });
}

function spawnWraith(pos, tex) {
  const s = glowSprite(tex, 2.4, 2.8);
  s.position.copy(pos);
  scene.add(s);
  wraiths.push({ mesh: s, pos: pos.clone(), speed: 3.1 + Math.random() * 1.6 });
}

function spark(pos, color, n = 8) {
  for (let i = 0; i < n; i++) {
    const m = new THREE.Mesh(new THREE.SphereGeometry(0.06, 5, 5), new THREE.MeshBasicMaterial({ color, transparent: true }));
    m.position.copy(pos);
    scene.add(m);
    sparks.push({
      m,
      v: new THREE.Vector3((Math.random() - 0.5) * 6, Math.random() * 5, (Math.random() - 0.5) * 6),
      life: 0.55,
    });
  }
}

function setHud() {
  document.getElementById('hpFill').style.width = `${Math.max(0, state.hp)}%`;
  document.getElementById('memCount').textContent = state.memories;
  document.getElementById('score').textContent = Math.floor(state.score);
  document.getElementById('combo').textContent = `x${state.combo.toFixed(1)}`;
}

function endGame(win) {
  state.playing = false;
  document.getElementById('end').classList.remove('hidden');
  document.getElementById('endTitle').textContent = win ? 'DAWN RETURNS' : 'THE DREAM FADES';
  document.getElementById('endText').textContent = win
    ? 'Seven memories braid back into the sky. Reverie remembers its own name.'
    : 'Night unspooled the isles. Wake again — a dream can be fought twice.';
  document.getElementById('endScore').textContent = Math.floor(state.score);
}

function firePulse() {
  if (!state.playing || state.pulse > 0.15) return;
  state.pulse = 1;
  beep(520, 0.18, 'sine', 0.07);
}

function bindStick() {
  const el = document.getElementById('stick');
  const knob = document.getElementById('knob');
  const setFrom = (cx, cy) => {
    const b = el.getBoundingClientRect();
    const x = (cx - (b.left + b.width / 2)) / (b.width / 2);
    const y = (cy - (b.top + b.height / 2)) / (b.height / 2);
    const m = Math.min(1, Math.hypot(x, y) || 0);
    const nx = (x / (Math.hypot(x, y) || 1)) * m;
    const ny = (y / (Math.hypot(x, y) || 1)) * m;
    stick.x = nx;
    stick.y = ny;
    knob.style.left = `${33 + nx * 26}px`;
    knob.style.top = `${33 + ny * 26}px`;
  };
  const end = () => {
    stick.down = false;
    stick.x = stick.y = 0;
    knob.style.left = '33px';
    knob.style.top = '33px';
  };
  el.addEventListener('pointerdown', (e) => {
    el.setPointerCapture(e.pointerId);
    stick.down = true;
    setFrom(e.clientX, e.clientY);
  });
  el.addEventListener('pointermove', (e) => {
    if (stick.down) setFrom(e.clientX, e.clientY);
  });
  el.addEventListener('pointerup', end);
  el.addEventListener('pointercancel', end);
}

document.getElementById('jumpBtn').addEventListener('pointerdown', (e) => {
  e.preventDefault();
  keys.Space = true;
  setTimeout(() => (keys.Space = false), 120);
});
document.getElementById('dashBtn').addEventListener('pointerdown', (e) => {
  e.preventDefault();
  keys.ShiftLeft = true;
  setTimeout(() => (keys.ShiftLeft = false), 140);
});
document.getElementById('pulseBtn').addEventListener('pointerdown', (e) => {
  e.preventDefault();
  firePulse();
});
bindStick();

async function boot() {
  const [stone, moss, sky, lanternTex, orbTex, wraithTex, portalTex, treeTex, rockTex, bridgeTex, weaverTex, moteTex] =
    await loadAll([
      'assets/tex_stone.jpg',
      'assets/tex_moss.jpg',
      'assets/sky.jpg',
      'assets/lantern_sprite.jpg',
      'assets/memory_orb.jpg',
      'assets/wraith.jpg',
      'assets/portal.jpg',
      'assets/tree.jpg',
      'assets/rock.jpg',
      'assets/bridge.jpg',
      'assets/weaver.jpg',
      'assets/mote.jpg',
    ]);

  [stone, moss].forEach((t) => {
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(2, 2);
  });

  scene.add(new THREE.Mesh(new THREE.SphereGeometry(140, 20, 14), new THREE.MeshBasicMaterial({ map: sky, side: THREE.BackSide })));
  scene.add(new THREE.HemisphereLight(0x6aa0c8, 0x1a1008, 0.6));
  const moon = new THREE.DirectionalLight(0xc8d8ff, 0.75);
  moon.position.set(-20, 40, -10);
  scene.add(moon);

  lanternLight = new THREE.PointLight(0xffc56a, 8, 20, 1.4);
  scene.add(lanternLight);

  const mats = {
    stone: mkMat(stone, { roughness: 0.86 }),
    moss: mkMat(moss, { roughness: 0.9 }),
  };

  const water = new THREE.Mesh(
    new THREE.CircleGeometry(80, 32),
    new THREE.MeshStandardMaterial({ color: 0x0a1c28, metalness: 0.85, roughness: 0.18, transparent: true, opacity: 0.72 })
  );
  water.rotation.x = -Math.PI / 2;
  water.position.y = -0.4;
  scene.add(water);

  const isles = [
    addIsland(0, 0, 9, 1.6, mats),
    addIsland(18, -8, 6.2, 3.2, mats),
    addIsland(-16, -14, 7, 2.4, mats),
    addIsland(8, 20, 5.5, 4.1, mats),
    addIsland(-22, 10, 6.8, 2.8, mats),
    addIsland(26, 12, 5, 5.2, mats),
    addIsland(-6, -26, 6, 3.6, mats),
  ];

  [
    [0, 1], [0, 2], [0, 3], [1, 5], [2, 6], [3, 5], [2, 4],
  ].forEach(([a, b]) => {
    const A = isles[a], B = isles[b];
    const mid = new THREE.Vector3((A.x + B.x) / 2, (A.h + B.h) / 2 + 1.15, (A.z + B.z) / 2);
    const dx = B.x - A.x, dz = B.z - A.z;
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(Math.hypot(dx, dz) * 0.92, 2.4), cutoutMat(bridgeTex));
    mesh.position.copy(mid);
    mesh.rotation.y = Math.atan2(dx, dz);
    scene.add(mesh);
  });

  isles.forEach((isle, i) => {
    const a = i * 1.7;
    prop(treeTex, 3.6, 4.8, new THREE.Vector3(isle.x + Math.cos(a) * isle.r * 0.4, isle.h + 2.5, isle.z + Math.sin(a) * isle.r * 0.4));
    prop(rockTex, 2.1, 1.7, new THREE.Vector3(isle.x + isle.r * 0.35, isle.h + 0.95, isle.z - isle.r * 0.2));
  });

  const portal = glowSprite(portalTex, 5.6, 5.6);
  portal.position.set(0, 3.4, -2.2);
  scene.add(portal);

  playerGroup = new THREE.Group();
  const weaver = new THREE.Mesh(new THREE.PlaneGeometry(1.35, 2.05), cutoutMat(weaverTex));
  const lamp = glowSprite(lanternTex, 0.85, 1.05);
  lamp.position.set(0.42, 0.35, 0.12);
  playerGroup.add(weaver, lamp);
  facing.push(weaver);
  scene.add(playerGroup);

  pulseMesh = new THREE.Mesh(
    new THREE.SphereGeometry(1, 14, 10),
    new THREE.MeshBasicMaterial({ color: 0xffd27a, transparent: true, opacity: 0, side: THREE.DoubleSide })
  );
  scene.add(pulseMesh);

  [
    [18, 4.6, -8], [-16, 3.8, -14], [8, 5.6, 20], [-22, 4.2, 10], [26, 6.6, 12], [-6, 5.1, -26], [0, 3.4, -6],
  ].forEach(([x, y, z]) => spawnMemory(new THREE.Vector3(x, y, z), orbTex));

  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    spawnWraith(new THREE.Vector3(Math.cos(a) * 28, 4, Math.sin(a) * 28), wraithTex);
  }
  for (let i = 0; i < 16; i++) {
    const mote = glowSprite(moteTex, 0.55, 0.55);
    mote.position.set((Math.random() - 0.5) * 60, 2 + Math.random() * 10, (Math.random() - 0.5) * 60);
    scene.add(mote);
  }

  state.ready = true;
  loadFill.style.width = '100%';
  loadText.textContent = 'Ready';
  fit();
  loop();
  setTimeout(() => {
    splash.classList.add('hidden');
    menu.classList.remove('hidden');
  }, 400);
}

function groundY(x, z) {
  const pads = [
    [0, 0, 9, 1.88], [18, -8, 6.2, 3.48], [-16, -14, 7, 2.68], [8, 20, 5.5, 4.38],
    [-22, 10, 6.8, 3.08], [26, 12, 5, 5.48], [-6, -26, 6, 3.88],
  ];
  let y = -8;
  for (const [px, pz, r, h] of pads) {
    if (Math.hypot(x - px, z - pz) < r) y = Math.max(y, h);
  }
  return y;
}

function loop() {
  requestAnimationFrame(loop);
  const dt = Math.min(clock.getDelta(), 0.033);
  state.time += dt;
  if (state.playing) {
    updatePlayer(dt);
    updateWorld(dt);
    state.score += dt * 4 * state.combo;
    state.comboT -= dt;
    if (state.comboT <= 0) state.combo = Math.max(1, state.combo - dt * 0.8);
    if (state.hp <= 0) endGame(false);
    if (state.memories >= 7) {
      state.score += 2500;
      endGame(true);
    }
  }

  playerGroup.position.copy(player.pos);
  facing.forEach((m) => {
    const p = camera.position.clone();
    p.y = m.getWorldPosition(new THREE.Vector3()).y;
    m.lookAt(p);
  });
  lanternLight.position.copy(player.pos).add(new THREE.Vector3(0.3, 0.8, 0.1));
  lanternLight.intensity = 7 + Math.sin(state.time * 6) * 1.4 + state.pulse * 16;
  pulseMesh.position.copy(player.pos);
  pulseMesh.scale.setScalar(1 + (1 - state.pulse) * 10);
  pulseMesh.material.opacity = state.pulse * 0.35;

  const camOff = new THREE.Vector3(Math.sin(player.yaw) * 7.4, 3.2, Math.cos(player.yaw) * 7.4);
  camera.position.lerp(player.pos.clone().add(camOff), 1 - Math.pow(0.001, dt));
  camera.lookAt(player.pos.x, player.pos.y + 1.0, player.pos.z);
  renderer.render(scene, camera);
  setHud();
}

function updatePlayer(dt) {
  const turn = (keys.KeyD || keys.ArrowRight ? -1 : 0) + (keys.KeyA || keys.ArrowLeft ? 1 : 0) + -stick.x * 1.4;
  player.yaw += turn * 2.3 * dt;
  const fwd = (keys.KeyW || keys.ArrowUp ? 1 : 0) + (keys.KeyS || keys.ArrowDown ? -1 : 0) + -stick.y;
  const dir = new THREE.Vector3(-Math.sin(player.yaw), 0, -Math.cos(player.yaw));
  const speed = (player.dash > 0 ? 16 : 8.2) * Math.max(-1, Math.min(1, fwd));
  player.vel.x = dir.x * speed;
  player.vel.z = dir.z * speed;
  player.vel.y -= 22 * dt;
  if (keys.ShiftLeft && player.dash <= -0.4) {
    player.dash = 0.22;
    beep(180, 0.1, 'sawtooth', 0.03);
  }
  if (keys.Space && player.grounded) {
    player.vel.y = 9.2;
    player.grounded = false;
    beep(300, 0.08, 'square', 0.03);
  }
  if (keys.KeyF) firePulse();
  player.pos.addScaledVector(player.vel, dt);
  player.dash -= dt;
  player.invuln -= dt;
  state.pulse = Math.max(0, state.pulse - dt * 1.6);
  const gy = groundY(player.pos.x, player.pos.z);
  if (player.pos.y <= gy + 1.05 && player.vel.y <= 0 && gy > -4) {
    player.pos.y = gy + 1.05;
    player.vel.y = 0;
    player.grounded = true;
  } else player.grounded = false;
  if (player.pos.y < -6) {
    player.pos.set(0, 4, 8);
    player.vel.set(0, 0, 0);
    state.hp -= 18;
  }
}

function updateWorld(dt) {
  memories.forEach((m, i) => {
    if (m.taken) return;
    m.mesh.position.y = m.base.y + Math.sin(state.time * 2 + i) * 0.25;
    m.ring.rotation.y += dt * 0.7;
    m.ring.position.copy(m.mesh.position);
    if (m.mesh.position.distanceTo(player.pos) < 1.5) {
      m.taken = true;
      m.mesh.visible = m.ring.visible = false;
      state.memories++;
      state.combo = Math.min(8, state.combo + 0.5);
      state.comboT = 6;
      state.score += 400 * state.combo;
      state.hp = Math.min(100, state.hp + 8);
      spark(m.mesh.position, 0xf0c36a, 12);
      beep(660, 0.15, 'sine', 0.07);
    }
  });
  wraiths.forEach((w) => {
    const to = player.pos.clone().sub(w.pos);
    const d = to.length() || 1;
    to.normalize();
    w.pos.addScaledVector(to, w.speed * dt);
    w.mesh.position.copy(w.pos);
    if (state.pulse > 0.4 && d < 7.5) {
      w.pos.addScaledVector(to, -8);
      state.score += 80 * state.combo;
      spark(w.pos, 0x7ee0d0, 5);
    }
    if (d < 1.35 && player.invuln <= 0 && state.playing) {
      state.hp -= 14;
      player.invuln = 0.85;
      player.vel.addScaledVector(to, -10);
    }
  });
  for (let i = sparks.length - 1; i >= 0; i--) {
    const s = sparks[i];
    s.life -= dt;
    s.v.y -= 8 * dt;
    s.m.position.addScaledVector(s.v, dt);
    s.m.material.opacity = Math.max(0, s.life);
    if (s.life <= 0) {
      scene.remove(s.m);
      sparks.splice(i, 1);
    }
  }
}

boot().catch((err) => {
  console.error(err);
  startBtn.disabled = false;
  startBtn.textContent = 'RETRY';
  loadNote.textContent = 'Could not finish loading. Tap retry.';
  startBtn.onclick = () => location.reload();
});
ot finish loading. Tap retry.';
  startBtn.onclick = () => location.reload();
});
