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

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.55;
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.6));
renderer.outputColorSpace = THREE.SRGBColorSpace;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x8ec6e8);
scene.fog = new THREE.Fog(0xc9dceb, 18, 95);

const camera = new THREE.PerspectiveCamera(68, 9 / 16, 0.1, 200);
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
addEventListener('fullscreenchange', () => setTimeout(fit, 40));

const loader = new THREE.TextureLoader();
const load = (p) =>
  new Promise((res, rej) => {
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

async function loadAll(paths) {
  let d = 0;
  return Promise.all(
    paths.map((p) =>
      load(p).then((t) => {
        d += 1;
        const pct = Math.round((d / paths.length) * 100);
        loadFill.style.width = pct + '%';
        loadText.textContent = pct < 100 ? `Laying the road… ${pct}%` : 'Ready';
        return t;
      })
    )
  );
}

const LANE = [-2.4, 0, 2.4];
const LEN = 12;
const RW = 8.4;

const state = { ready: false, playing: false, hp: 100, mem: 0, score: 0, dist: 0 };
const run = { lane: 1, x: 0, y: 0, yaw: 0, vy: 0, grounded: true, slide: 0, inv: 0, speed: 18, si: 0, t: 0 };

const segs = [];
const items = [];
const facing = [];
let cur = { x: 0, z: 0, yaw: 0 };
let hero, ghost, sunLight, tex, mats;
let audioCtx;

function beep(f, d, t = 'sine', g = 0.05) {
  if (!audioCtx) return;
  const o = audioCtx.createOscillator();
  const a = audioCtx.createGain();
  o.type = t;
  o.frequency.value = f;
  a.gain.setValueAtTime(g, audioCtx.currentTime);
  a.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + d);
  o.connect(a).connect(audioCtx.destination);
  o.start();
  o.stop(audioCtx.currentTime + d);
}

function cut(map) {
  return new THREE.ShaderMaterial({
    uniforms: { map: { value: map } },
    transparent: true,
    side: THREE.DoubleSide,
    depthWrite: false,
    vertexShader: `varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }`,
    fragmentShader: `uniform sampler2D map; varying vec2 vUv; void main(){
      vec4 c=texture2D(map,vUv); float lum=max(c.r,max(c.g,c.b));
      float a=smoothstep(0.045,0.16,lum); if(a<0.09) discard; gl_FragColor=vec4(c.rgb*1.12,a);
    }`,
  });
}

function fwd(y) {
  return new THREE.Vector3(Math.sin(y), 0, Math.cos(y));
}
function rgt(y) {
  return new THREE.Vector3(Math.cos(y), 0, -Math.sin(y));
}

function addSeg(kind) {
  if (kind === 'left') cur.yaw += Math.PI / 2;
  if (kind === 'right') cur.yaw -= Math.PI / 2;
  const y = cur.yaw;
  const f = fwd(y);
  const sx = cur.x;
  const sz = cur.z;
  const ex = sx + f.x * LEN;
  const ez = sz + f.z * LEN;
  const pos = new THREE.Vector3((sx + ex) / 2, 0, (sz + ez) / 2);

  const g = new THREE.Group();
  const road = new THREE.Mesh(new THREE.PlaneGeometry(RW, LEN + 0.35, 1, 1), mats.road);
  road.rotation.x = -Math.PI / 2;
  g.add(road);

  [-1, 1].forEach((s) => {
    const line = new THREE.Mesh(new THREE.PlaneGeometry(0.14, LEN), new THREE.MeshBasicMaterial({ color: 0xfff4cc }));
    line.rotation.x = -Math.PI / 2;
    line.position.set(s * 2.4, 0.03, 0);
    g.add(line);
  });

  const wallH = 9;
  const wall = new THREE.PlaneGeometry(LEN + 0.2, wallH);
  const Lw = new THREE.Mesh(wall, mats.cliff);
  const Rw = new THREE.Mesh(wall, mats.cliff);
  Lw.position.set(-RW / 2, wallH / 2, 0);
  Rw.position.set(RW / 2, wallH / 2, 0);
  Lw.rotation.y = Math.PI / 2;
  Rw.rotation.y = -Math.PI / 2;
  g.add(Lw, Rw);

  if (tex && Math.random() < 0.5) {
    const p = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 6.2), cut(tex.pillar));
    p.position.set((Math.random() < 0.5 ? -1 : 1) * (RW / 2 + 1.05), 3.0, 0);
    g.add(p);
    facing.push(p);
  }

  g.position.copy(pos);
  g.rotation.y = y;
  scene.add(g);
  segs.push({ mesh: g, sx, sz, ex, ez, yaw: y, len: LEN, kind });

  if (kind === 'straight' && tex && Math.random() < 0.58) {
    const lane = (Math.random() * 3) | 0;
    const mid = pos.clone().add(rgt(y).multiplyScalar(LANE[lane]));
    const roll = Math.random();
    let mesh, type, h;
    if (roll < 0.4) {
      mesh = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.9), cut(tex.idol));
      type = 'idol';
      h = 1.25;
    } else if (roll < 0.65) {
      mesh = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 1.15), cut(tex.log));
      type = 'jump';
      h = 0.7;
    } else if (roll < 0.85) {
      mesh = new THREE.Mesh(new THREE.PlaneGeometry(3.1, 1.5), cut(tex.gate));
      type = 'slide';
      h = 1.55;
    } else {
      mesh = new THREE.Mesh(new THREE.PlaneGeometry(1.7, 2.3), cut(tex.statue));
      type = 'block';
      h = 1.15;
    }
    mesh.position.set(mid.x, h, mid.z);
    scene.add(mesh);
    facing.push(mesh);
    items.push({ mesh, lane, type, used: false, x: mid.x, z: mid.z });
  }

  cur.x = ex;
  cur.z = ez;
}

function seed() {
  for (let i = 0; i < 10; i++) addSeg('straight');
  for (let i = 0; i < 24; i++) {
    const r = Math.random();
    addSeg(r < 0.74 ? 'straight' : r < 0.87 ? 'left' : 'right');
  }
}

function extend() {
  while (run.si > 4 && segs.length > 18) {
    const gone = segs.shift();
    scene.remove(gone.mesh);
    run.si -= 1;
  }
  while (segs.length - run.si < 16) {
    const r = Math.random();
    addSeg(r < 0.76 ? 'straight' : r < 0.88 ? 'left' : 'right');
  }
}

function near() {
  let b = segs[0],
    d = 1e9;
  for (const s of segs) {
    const q = (s.x - hero.position.x) ** 2 + (s.z - hero.position.z) ** 2;
    if (q < d) {
      d = q;
      b = s;
    }
  }
  return b;
}

function fs() {
  const el = document.documentElement;
  try {
    (el.requestFullscreen || el.webkitRequestFullscreen)?.call(el, { navigationUI: 'hide' })?.catch?.(() => {});
  } catch {}
  try {
    screen.orientation?.lock?.('portrait').catch(() => {});
  } catch {}
}

function startGame() {
  if (!state.ready || state.playing) return;
  fs();
  try {
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    audioCtx.resume?.();
  } catch {}
  splash.classList.add('hidden');
  menu.classList.add('hidden');
  hud.classList.remove('hidden');
  padsEl.classList.remove('hidden');
  state.playing = true;
  setTimeout(fit, 60);
  beep(300, 0.2, 'triangle', 0.05);
}

playBtn.onclick = (e) => {
  e.preventDefault();
  startGame();
};
againBtn.onclick = () => location.reload();

function jump() {
  if (!state.playing || !run.grounded || run.slide > 0) return;
  run.vy = 10.2;
  run.grounded = false;
  beep(340, 0.07, 'square', 0.03);
}
function slide() {
  if (!state.playing || !run.grounded) return;
  run.slide = 0.58;
  beep(150, 0.08, 'sawtooth', 0.03);
}
function lane(d) {
  if (!state.playing) return;
  run.lane = Math.max(0, Math.min(2, run.lane + d));
}

document.getElementById('jumpBtn').onpointerdown = (e) => {
  e.preventDefault();
  e.stopPropagation();
  jump();
};
document.getElementById('slideBtn').onpointerdown = (e) => {
  e.preventDefault();
  e.stopPropagation();
  slide();
};
document.getElementById('leftBtn').onpointerdown = (e) => {
  e.preventDefault();
  e.stopPropagation();
  lane(-1);
};
document.getElementById('rightBtn').onpointerdown = (e) => {
  e.preventDefault();
  e.stopPropagation();
  lane(1);
};

let sw = null;
addEventListener('pointerdown', (e) => {
  if (e.target.closest('button')) return;
  sw = { x: e.clientX, y: e.clientY };
});
addEventListener('pointerup', (e) => {
  if (!sw || !state.playing) return (sw = null);
  const dx = e.clientX - sw.x,
    dy = e.clientY - sw.y;
  sw = null;
  if (Math.hypot(dx, dy) < 28) return;
  if (Math.abs(dx) > Math.abs(dy)) lane(dx < 0 ? -1 : 1);
  else if (dy < 0) jump();
  else slide();
});
addEventListener('keydown', (e) => {
  if (e.code === 'ArrowLeft' || e.code === 'KeyA') lane(-1);
  if (e.code === 'ArrowRight' || e.code === 'KeyD') lane(1);
  if (e.code === 'Space' || e.code === 'ArrowUp' || e.code === 'KeyW') {
    e.preventDefault();
    jump();
  }
  if (e.code === 'ArrowDown' || e.code === 'KeyS') {
    e.preventDefault();
    slide();
  }
});

function die(msg, title) {
  state.playing = false;
  padsEl.classList.add('hidden');
  document.getElementById('end').classList.remove('hidden');
  document.getElementById('endTitle').textContent = title;
  document.getElementById('endText').textContent = msg;
  document.getElementById('endScore').textContent = Math.floor(state.score);
}

function hudSync() {
  document.getElementById('hpFill').style.width = `${Math.max(0, state.hp)}%`;
  document.getElementById('memCount').textContent = state.mem;
  document.getElementById('score').textContent = Math.floor(state.score);
  document.getElementById('dist').textContent = Math.floor(state.dist);
}

async function boot() {
  const [road, cliff, sky, runner, ghostTex, log, gate, idol, pillar, statue] = await loadAll([
    'assets/tex_road.jpg',
    'assets/tex_cliff.jpg',
    'assets/sky.jpg',
    'assets/runner.png',
    'assets/ghost.png',
    'assets/log.png',
    'assets/gate.png',
    'assets/idol.png',
    'assets/pillar.png',
    'assets/statue.png',
  ]);
  [road, cliff].forEach((t) => {
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
  });
  road.repeat.set(2, 3);
  cliff.repeat.set(2, 1);
  tex = { runner, ghost: ghostTex, log, gate, idol, pillar, statue };

  scene.add(new THREE.Mesh(new THREE.SphereGeometry(120, 20, 14), new THREE.MeshBasicMaterial({ map: sky, side: THREE.BackSide })));
  scene.add(new THREE.HemisphereLight(0xfff0d0, 0x6a4a28, 1.15));
  sunLight = new THREE.DirectionalLight(0xfff3d2, 2.1);
  sunLight.position.set(8, 22, 6);
  scene.add(sunLight);
  scene.add(new THREE.AmbientLight(0xffe8c8, 0.55));

  mats = {
    road: new THREE.MeshStandardMaterial({
      map: road,
      roughness: 0.62,
      metalness: 0.04,
      emissive: new THREE.Color(0x4a3518),
      emissiveIntensity: 0.22,
    }),
    cliff: new THREE.MeshStandardMaterial({ map: cliff, roughness: 0.8, emissive: 0x221408, emissiveIntensity: 0.12 }),
  };

  seed();

  hero = new THREE.Group();
  const body = new THREE.Mesh(new THREE.PlaneGeometry(1.35, 2.15), cut(runner));
  hero.add(body);
  facing.push(body);
  hero.position.set(0, 1.05, 4);
  scene.add(hero);

  ghost = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 3.4), cut(ghostTex));
  ghost.position.set(0, 1.7, -4);
  scene.add(ghost);
  facing.push(ghost);

  const fill = new THREE.PointLight(0xffe0a0, 4.5, 22);
  fill.position.set(0, 4, 6);
  scene.add(fill);

  state.ready = true;
  loadFill.style.width = '100%';
  loadText.textContent = 'Ready';
  fit();
  loop();
  setTimeout(() => {
    splash.classList.add('hidden');
    menu.classList.remove('hidden');
  }, 280);
}

function loop() {
  requestAnimationFrame(loop);
  const dt = Math.min(clock.getDelta(), 0.033);
  if (state.playing) tick(dt);
  if (hero) {
    facing.forEach((m) => {
      const p = camera.position.clone();
      p.y = m.getWorldPosition(new THREE.Vector3()).y;
      m.lookAt(p);
    });
    const back = fwd(run.yaw).multiplyScalar(-6.4);
    const cam = hero.position.clone().add(back);
    cam.y = 3.8;
    camera.position.lerp(cam, 1 - Math.pow(0.0007, dt));
    const look = hero.position.clone().add(fwd(run.yaw).multiplyScalar(10));
    look.y = 1.3;
    camera.lookAt(look);
    const gh = hero.position.clone().add(fwd(run.yaw).multiplyScalar(-4.6));
    gh.y = 1.7 + Math.sin(performance.now() * 0.007) * 0.15;
    ghost.position.lerp(gh, 0.14);
  }
  renderer.render(scene, camera);
  if (state.playing) hudSync();
}

function tick(dt) {
  run.speed = Math.min(26, 16.5 + state.dist * 0.014);
  const road = near();
  if (!road) return;
  let dy = road.yaw - run.yaw;
  while (dy > Math.PI) dy -= Math.PI * 2;
  while (dy < -Math.PI) dy += Math.PI * 2;
  run.yaw += dy * Math.min(1, dt * 5.5);

  const f = fwd(run.yaw);
  const r = rgt(run.yaw);
  hero.position.addScaledVector(f, run.speed * dt);
  run.x += (LANE[run.lane] - run.x) * Math.min(1, dt * 13);

  const to = new THREE.Vector3(road.x - hero.position.x, 0, road.z - hero.position.z);
  const along = to.dot(f);
  const center = new THREE.Vector3(road.x, 0, road.z).addScaledVector(f, -along * 0.2);
  hero.position.x = center.x + r.x * run.x;
  hero.position.z = center.z + r.z * run.x;

  run.vy -= 30 * dt;
  run.y += run.vy * dt;
  if (run.y <= 0) {
    run.y = 0;
    run.vy = 0;
    run.grounded = true;
  }
  run.slide = Math.max(0, run.slide - dt);
  run.inv -= dt;
  hero.position.y = 1.05 + run.y - (run.slide > 0 ? 0.5 : 0);
  hero.scale.setScalar(run.slide > 0 ? 0.75 : 1);
  hero.rotation.y = run.yaw;

  state.dist += run.speed * dt * 0.55;
  state.score += run.speed * dt * 5;

  const hx = hero.position.x,
    hz = hero.position.z;
  items.forEach((it) => {
    if (it.used) return;
    if (it.lane !== run.lane) return;
    if (Math.hypot(it.x - hx, it.z - hz) > 1.45) return;
    if (it.type === 'idol') {
      it.used = true;
      it.mesh.visible = false;
      state.mem += 1;
      state.score += 200;
      state.hp = Math.min(100, state.hp + 5);
      beep(780, 0.1, 'sine', 0.06);
      return;
    }
    if (run.inv > 0) return;
    if (it.type === 'jump' && run.y > 1.05) return;
    if (it.type === 'slide' && run.slide > 0) return;
    it.used = true;
    state.hp -= 24;
    run.inv = 0.85;
    run.speed *= 0.7;
    beep(70, 0.2, 'sawtooth', 0.07);
  });

  if (state.hp <= 0) die('The temple ghost took the road. You ran far enough to be a story.', 'CAUGHT');
  extend();
}

boot().catch((e) => {
  console.error(e);
  loadText.textContent = 'Could not load. Refresh.';
});
;
  loadText.textContent = 'Could not load. Refresh.';
});
