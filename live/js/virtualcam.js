// Virtual CCTV camera: a live 3D platform filmed from a wall-mounted camera angle, used as a camera feed
// when no real camera is available. People walk in, queue at the doors (following the lights like real
// passengers mostly do), get off and on the train in step with the system's train cycle.
// The camera AI and the GenAI model read these frames exactly as they would read a real CCTV feed;
// nothing here reports counts to the system directly.

const DOOR_GAP = 5;            // metres between doors
const MAX_PEOPLE = 22;         // keeps the scene light enough to run smoothly on a laptop
const SKIN = [0xe0b89a, 0xc99a72, 0x8d5e3c, 0xf0cfb4];
const SHIRT = [0x2f5d8a, 0x8a3b3b, 0x3d6b4f, 0x5f5288, 0xb07a2a, 0x3f474b, 0xd9dcdc, 0x1f3d5c, 0x9c4f7a];
const PANTS = [0x22262a, 0x2c3440, 0x3a3a3a, 0x4a3b2a, 0x1c2a3c];

export class VirtualCam {
  constructor(getState, doors = 4) {
    this.getState = getState;    // () => ({ phase, lights: {door: 'g'|'y'|'r'}, onboard: {door: n}, forecastOff: {door: n}, capacity })
    this.doors = doors;
    this.canvas = document.createElement('canvas');
    this.canvas.width = 960; this.canvas.height = 540;
    this.people = []; this.lastPhase = null; this.spawnT = 0; this.trainX = -60; this.boardAt = 0;
    this._build();
  }

  doorX(d) { return (d - (this.doors + 1) / 2) * DOOR_GAP; }

  _build() {
    const r = this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true, preserveDrawingBuffer: true });
    r.setPixelRatio(1); r.setSize(960, 540, false);
    const s = this.scene = new THREE.Scene();
    s.background = new THREE.Color(0xc9cfcc);
    s.fog = new THREE.Fog(0xc9cfcc, 30, 60);
    // Camera mounted high on the back wall, looking along and across the platform
    this.camera = new THREE.PerspectiveCamera(64, 16 / 9, 0.1, 100);
    this.camera.position.set(-3.5, 5.2, 10.2);
    this.camera.lookAt(0.4, 0, 1.2);
    this.camera.updateMatrixWorld();
    s.add(new THREE.HemisphereLight(0xffffff, 0x8a8f8c, 0.9));
    const sun = new THREE.DirectionalLight(0xffffff, 0.55); sun.position.set(-4, 10, 8); s.add(sun);

    const mat = c => new THREE.MeshLambertMaterial({ color: c });
    const box = (w, h, d, m, x, y, z) => { const o = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m); o.position.set(x, y, z); s.add(o); return o; };
    const W = this.doors * DOOR_GAP + 16;
    box(W, 0.2, 11, mat(0x9aa19d), 0, -0.1, 5.3);                       // platform floor
    box(W, 0.02, 0.3, mat(0xe2c23a), 0, 0.01, 0.35);                    // yellow safety strip
    box(W, 0.4, 5, mat(0x4b5250), 0, -1.4, -2.6);                       // track bed
    box(W, 7, 0.3, mat(0xdfe2de), 0, 3.3, 11);                          // back wall
    box(W, 7, 0.3, mat(0x9aa29f), 0, 3.3, -5.2);                        // far wall behind the track
    for (let i = 0; i < 6; i++) box(4, 1.6, 0.05, mat(0x4f7d8a), -12 + i * 6, 2.4, -5.0);   // wall panels
    // Platform screen doors with an opening at every door, and a light above each
    const glass = new THREE.MeshLambertMaterial({ color: 0x9fc3d6, transparent: true, opacity: 0.35 });
    box(W, 0.35, 0.25, mat(0x3b4644), 0, 2.45, 0.05);
    this.doorLights = []; this.doorPanels = [];
    for (let d = 1; d <= this.doors; d++) {
      const x = this.doorX(d);
      const L = box(0.9, 2.2, 0.06, glass, x - 0.45, 1.1, 0.05), R = box(0.9, 2.2, 0.06, glass, x + 0.45, 1.1, 0.05);
      this.doorPanels.push({ L, R, x });
      const light = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.22, 0.1), new THREE.MeshBasicMaterial({ color: 0x2fd27a }));
      light.position.set(x, 2.8, 0.1); s.add(light); this.doorLights.push(light);
      if (d < this.doors) box(DOOR_GAP - 1.8, 2.2, 0.06, glass, x + DOOR_GAP / 2, 1.1, 0.05);
      for (const dx of [-0.8, 0.8]) box(0.05, 0.01, 2.6, mat(0xf2f2ee), x + dx, 0.012, 2.0);   // queue guide lines
    }
    box(6, 2.2, 0.06, glass, this.doorX(1) - DOOR_GAP / 2 - 1.1, 1.1, 0.05);
    box(6, 2.2, 0.06, glass, this.doorX(this.doors) + DOOR_GAP / 2 + 1.1, 1.1, 0.05);

    // Train: one car per door
    this.train = new THREE.Group(); s.add(this.train);
    const body = mat(0xcfd6d4), win = mat(0x22313a), stripe = mat(0xb9343c);
    for (let d = 1; d <= this.doors; d++) {
      const g = new THREE.Group(); g.position.x = this.doorX(d);
      const b = new THREE.Mesh(new THREE.BoxGeometry(DOOR_GAP - 0.2, 2.9, 2.8), body); b.position.set(0, 1.0, -2.4); g.add(b);
      const w = new THREE.Mesh(new THREE.BoxGeometry(DOOR_GAP - 0.6, 0.8, 2.84), win); w.position.set(0, 1.6, -2.4); g.add(w);
      const st = new THREE.Mesh(new THREE.BoxGeometry(DOOR_GAP - 0.2, 0.15, 2.84), stripe); st.position.set(0, 0.6, -2.4); g.add(st);
      const dr = new THREE.Mesh(new THREE.BoxGeometry(1.4, 2.0, 2.86), mat(0x8f9896)); dr.position.set(0, 0.55, -2.4); g.add(dr);
      this.train.add(g);
    }
    this.train.position.x = -60;
  }

  _person() {
    const pick = a => a[Math.floor(Math.random() * a.length)];
    const g = new THREE.Group();
    const shirt = new THREE.MeshLambertMaterial({ color: pick(SHIRT) }), pants = new THREE.MeshLambertMaterial({ color: pick(PANTS) });
    const skin = new THREE.MeshLambertMaterial({ color: pick(SKIN) }), hair = new THREE.MeshLambertMaterial({ color: 0x1b1714 });
    const part = (geo, m, x, y, z, parent = g) => { const o = new THREE.Mesh(geo, m); o.position.set(x, y, z); parent.add(o); return o; };
    const legL = new THREE.Group(), legR = new THREE.Group(); legL.position.set(-0.11, 0.86, 0); legR.position.set(0.11, 0.86, 0); g.add(legL, legR);
    part(new THREE.BoxGeometry(0.16, 0.86, 0.18), pants, 0, -0.43, 0, legL); part(new THREE.BoxGeometry(0.16, 0.86, 0.18), pants, 0, -0.43, 0, legR);
    part(new THREE.BoxGeometry(0.46, 0.62, 0.26), shirt, 0, 1.17, 0);
    const armL = new THREE.Group(), armR = new THREE.Group(); armL.position.set(-0.3, 1.44, 0); armR.position.set(0.3, 1.44, 0); g.add(armL, armR);
    part(new THREE.BoxGeometry(0.12, 0.6, 0.14), shirt, 0, -0.3, 0, armL); part(new THREE.BoxGeometry(0.12, 0.6, 0.14), shirt, 0, -0.3, 0, armR);
    part(new THREE.BoxGeometry(0.12, 0.08, 0.12), skin, 0, 1.52, 0);
    part(new THREE.SphereGeometry(0.13, 12, 10), skin, 0, 1.68, 0);
    part(new THREE.SphereGeometry(0.135, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), hair, 0, 1.7, 0);
    g.scale.setScalar(0.95 + Math.random() * 0.12);
    this.scene.add(g);
    return { g, legL, legR, armL, armR, path: [], speed: 1.1 + Math.random() * 0.4, phase: Math.random() * 6, state: '', door: 0 };
  }

  _remove(p) { this.scene.remove(p.g); p.dead = true; }

  queueOf(d) { return this.people.filter(p => p.door === d && (p.state === 'queue' || p.state === 'toQueue')); }
  _slot(d, k) { const side = k % 2 ? 0.5 : -0.5; return new THREE.Vector3(this.doorX(d) + side, 0, 0.9 + Math.floor(k / 2) * 0.62); }

  _spawn(st) {
    if (this.people.filter(p => !p.dead).length >= MAX_PEOPLE) return;
    const doors = Array.from({ length: this.doors }, (_, i) => i + 1);
    // About 60% follow the lights; the rest go to the doors nearest the stairs (left side), like today
    let door;
    if (Math.random() < 0.6) {
      const w = doors.map(d => ({ g: 1, y: 0.3, r: 0.04 })[st.lights[d] || 'g']);
      let r = Math.random() * w.reduce((a, b) => a + b, 0); door = doors.find((d, i) => (r -= w[i]) <= 0) || 1;
    } else door = Math.random() < 0.7 ? 1 + Math.floor(Math.random() * Math.ceil(this.doors / 2)) : doors[Math.floor(Math.random() * this.doors)];
    if (this.queueOf(door).length >= 8) return;
    const p = this._person(); p.door = door; p.state = 'toQueue';
    // Enter from the stairs at the back of the platform
    p.g.position.set(this.doorX(1) - 1 + Math.random() * 2.5, 0, 10.5);
    p.path = [new THREE.Vector3(p.g.position.x + 0.5, 0, 6.5), this._slot(door, this.queueOf(door).length)];
    this.people.push(p);
  }

  _onPhase(phase, st) {
    if (phase === 'open') {
      for (const pn of this.doorPanels) pn.open = true;
      // People getting off: the system's forecast is only a forecast, so the real number varies around it
      for (let d = 1; d <= this.doors; d++) {
        const onboard = st.onboard[d] ?? 0, fc = st.forecastOff[d] ?? 0;
        const n = Math.min(onboard, 4, Math.max(0, Math.round(fc * (0.6 + Math.random() * 0.8) + (Math.random() < 0.35 ? 1 : 0))));
        for (let k = 0; k < n; k++) {
          const p = this._person(); p.state = 'alight'; p.door = d; p.delay = 0.6 + k * 1.1;
          const x = this.doorX(d) + (Math.random() - 0.5) * 0.4; p.g.position.set(x, 0, -1.6); p.g.visible = false;
          p.path = [new THREE.Vector3(x, 0, 0.4), new THREE.Vector3(x + (Math.random() < 0.5 ? -1.3 : 1.3), 0, 2.2), new THREE.Vector3(this.doorX(this.doors) + DOOR_GAP + 1, 0, 8.5)];
          this.people.push(p);
        }
      }
      this.boardAt = performance.now() + 4500;
    }
    if (phase === 'waiting' || phase === 'closed') { for (const pn of this.doorPanels) pn.open = false; this.boardAt = 0; }
  }

  _board(st) {
    for (let d = 1; d <= this.doors; d++) {
      const room = Math.max(0, (st.capacity ?? 6) - (st.onboard[d] ?? 0) + (st.forecastOff[d] ?? 0));
      const q = this.people.filter(p => p.door === d && p.state === 'queue').sort((a, b) => a.g.position.z - b.g.position.z).slice(0, room);
      q.forEach((p, k) => { p.state = 'board'; p.delay = k * 0.8; p.path = [new THREE.Vector3(this.doorX(d) + (p.g.position.x > this.doorX(d) ? 0.2 : -0.2), 0, 0.4), new THREE.Vector3(this.doorX(d), 0, -1.6)]; });
    }
  }

  step(dt) {
    const st = this.getState();
    if (st.phase !== this.lastPhase) { this._onPhase(st.phase, st); this.lastPhase = st.phase; }
    if (this.boardAt && performance.now() > this.boardAt) { this.boardAt = 0; this._board(st); }
    // Train position follows the phase
    const target = st.phase === 'waiting' ? 60 : 0;
    if (st.phase === 'arriving' && this.trainX > 5) this.trainX = -60;
    this.trainX += (target - this.trainX) * Math.min(1, dt * (st.phase === 'waiting' ? 0.5 : 1.2));
    this.train.position.x = this.trainX;
    for (const pn of this.doorPanels) { const k = pn.open ? 0.85 : 0; pn.L.position.x += ((pn.x - 0.45 - k) - pn.L.position.x) * Math.min(1, dt * 4); pn.R.position.x += ((pn.x + 0.45 + k) - pn.R.position.x) * Math.min(1, dt * 4); }
    this.doorLights.forEach((l, i) => l.material.color.setHex({ g: 0x2fd27a, y: 0xf2bd2c, r: 0xff5a4e }[st.lights[i + 1] || 'g']));
    if ((this.spawnT -= dt) <= 0) { this._spawn(st); this.spawnT = 2.2 + Math.random() * 2.5; }

    for (const p of this.people) {
      if (p.dead) continue;
      if (p.delay > 0) { p.delay -= dt; if (p.delay <= 0) p.g.visible = true; continue; }
      const tgt = p.path[0];
      if (!tgt) continue;
      const pos = p.g.position, dx = tgt.x - pos.x, dz = tgt.z - pos.z, d = Math.hypot(dx, dz), stp = p.speed * dt;
      if (d <= stp) {
        pos.set(tgt.x, 0, tgt.z); p.path.shift();
        if (!p.path.length) {
          if (p.state === 'toQueue') { p.state = 'queue'; p.g.rotation.y = Math.PI; }
          else if (p.state === 'board' || p.state === 'alight') this._remove(p);
        }
      } else {
        pos.x += dx / d * stp; pos.z += dz / d * stp; p.g.rotation.y = Math.atan2(dx, dz);
        p.phase += dt * 7; const sw = Math.sin(p.phase) * 0.45;
        p.legL.rotation.x = sw; p.legR.rotation.x = -sw; p.armL.rotation.x = -sw * 0.7; p.armR.rotation.x = sw * 0.7;
        continue;
      }
      p.legL.rotation.x = p.legR.rotation.x = p.armL.rotation.x = p.armR.rotation.x = 0;
    }
    // Queues close up when people at the front board
    for (let d = 1; d <= this.doors; d++) this.people.filter(p => p.door === d && p.state === 'queue').sort((a, b) => a.g.position.z - b.g.position.z)
      .forEach((p, k) => { const s = this._slot(d, k); if (p.g.position.distanceTo(s) > 0.05) { p.state = 'toQueue'; p.path = [s]; } });
    this.people = this.people.filter(p => !p.dead);
    this.renderer.render(this.scene, this.camera);
  }

  // A steady 20 fps timer (not requestAnimationFrame) so the feed keeps moving like a real camera
  start() {
    if (this.timer) return;
    let last = performance.now();
    this.running = true;
    this.timer = setInterval(() => { const now = performance.now(); this.step(Math.min(0.1, (now - last) / 1000)); last = now; }, 50);
  }
  stop() { this.running = false; clearInterval(this.timer); this.timer = null; }

  // Counting areas that match this camera's view: each door's queue area, and an exit line just inside each door
  zones() {
    this.camera.updateMatrixWorld();
    const proj = (x, z) => { const v = new THREE.Vector3(x, 0, z).project(this.camera); return { x: (v.x + 1) / 2, y: (1 - v.y) / 2 }; };
    const out = [];
    for (let d = 1; d <= this.doors; d++) {
      // The queue area is a rectangle on the floor, which the camera sees as a slanted four-sided shape
      const x = this.doorX(d), pts = [proj(x - 1.1, 0.5), proj(x + 1.1, 0.5), proj(x + 1.1, 3.6), proj(x - 1.1, 3.6)];
      const xs = pts.map(p => p.x), ys = pts.map(p => p.y);
      out.push({ kind: 'queue', door: d, pts, x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) });
      const a = proj(x - 0.9, 0.55), b = proj(x + 0.9, 0.55);
      out.push({ kind: 'exit', door: d, x1: a.x, y1: a.y, x2: b.x, y2: b.y });
    }
    return out;
  }
}
