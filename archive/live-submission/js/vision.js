// Camera AI: detects people in each frame (COCO-SSD running in the browser with TensorFlow.js)
// and turns detections into counts for three kinds of areas drawn on the image:
//   queue zone (door N)  → people standing in that door's queue area (counted by where their feet are)
//   car zone (car N)     → people inside a train car
//   exit line (door N)   → people crossing the line downward, i.e. stepping off the train onto the platform
// The train is assumed to be at the top of the image, so "downward" means leaving the train.

// The same person can be found by the full-frame pass and a half-frame pass: keep the most confident box
// and drop any other that overlaps it heavily or sits mostly inside it
function mergeBoxes(boxes) {
  const kept = [];
  for (const b of boxes.sort((a, c) => c.score - a.score)) {
    const dup = kept.some(k => {
      const ix = Math.max(0, Math.min(b.x + b.w, k.x + k.w) - Math.max(b.x, k.x)), iy = Math.max(0, Math.min(b.y + b.h, k.y + k.h) - Math.max(b.y, k.y));
      const inter = ix * iy, small = Math.min(b.w * b.h, k.w * k.h);
      return inter / (b.w * b.h + k.w * k.h - inter) > 0.45 || inter / small > 0.7;
    });
    if (!dup) kept.push(b);
  }
  return kept;
}

// Is point (x, y) inside polygon pts? (ray casting)
function inPoly(x, y, pts) {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const a = pts[i], b = pts[j];
    if ((a.y > y) !== (b.y > y) && x < (b.x - a.x) * (y - a.y) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

const KIND_COLOR = { queue: '#7ea2ee', car: '#f2bd2c', exit: '#c58cff' };

export class Vision {
  constructor(media, overlay) {
    this.media = media;            // <video> or <img>
    this.overlay = overlay;        // <canvas> drawn on top
    this.model = null;
    this.zones = [];               // {kind, door, x, y, w, h} or exit {kind:'exit', door, x1, y1, x2, y2}; all 0–1
    this.persons = [];             // latest detections, normalised {x, y, w, h, score}
    this.tracks = []; this.nextId = 1;
    this.exits = {};               // door -> people counted crossing its exit line since reset
    this.counting = false;         // exit lines only count while doors are open
    this.minScore = 0.45;
    this.detail = true;            // also scan each half of the frame (finds far and edge people; about 3x the work)
    this.tool = { kind: 'queue', door: 1 };
    this.drag = null;
    this.lastMs = 0;
    this._bindDrawing();
  }

  async loadModel() {
    this.model = await cocoSsd.load({ base: this.base || 'mobilenet_v2' });
  }

  get ready() {
    const m = this.media;
    if (!this.model) return false;
    if (m.tagName === 'CANVAS') return m.width > 0;
    return m.tagName === 'IMG' ? m.complete && m.naturalWidth > 0 : m.readyState >= 2 && m.videoWidth > 0;
  }

  size() {
    const m = this.media;
    if (m.tagName === 'CANVAS') return [m.width, m.height];
    return m.tagName === 'IMG' ? [m.naturalWidth, m.naturalHeight] : [m.videoWidth, m.videoHeight];
  }

  defaultZones(doors) {
    this.zones = [];
    for (let i = 0; i < doors; i++) this.zones.push({ kind: 'queue', door: i + 1, x: i / doors + 0.01, y: 0.4, w: 1 / doors - 0.02, h: 0.58 });
  }

  // One detection pass over the whole frame, plus (in detail mode) one over each overlapping half.
  // The model shrinks every image to a small square, so people far away or near the edges become a few
  // pixels and are missed; scanning each half separately makes them about twice as large to the model.
  async step() {
    if (!this.ready) return null;
    const t0 = performance.now();
    const [W, H] = this.size();
    const found = [];
    const add = (preds, x0, y0, sw, sh) => { for (const p of preds) if (p.class === 'person')
      found.push({ x: x0 + p.bbox[0] / sw, y: y0 + p.bbox[1] / sh, w: p.bbox[2] / sw, h: p.bbox[3] / sh, score: p.score }); };
    add(await this.model.detect(this.media, 40, this.minScore), 0, 0, W, H);
    if (this.detail) {
      const c = this._tile || (this._tile = document.createElement('canvas')), g = c.getContext('2d');
      for (const [fx0, fx1] of [[0, 0.56], [0.44, 1]]) {
        const sx = fx0 * W, sw = (fx1 - fx0) * W;
        c.width = Math.round(sw); c.height = H;
        g.drawImage(this.media, sx, 0, sw, H, 0, 0, c.width, c.height);
        // boxes come back in tile pixels; convert to 0–1 of the whole frame
        add(await this.model.detect(c, 40, this.minScore), fx0, 0, c.width / (fx1 - fx0), H);
      }
    }
    this.persons = mergeBoxes(found);
    this.lastMs = performance.now() - t0;
    this._track();
    return this.counts();
  }

  // People per area, plus the detector's average confidence for the people it found in each area
  counts() {
    const queue = {}, car = {}, score = {};
    for (const z of this.zones) {
      if (z.kind === 'exit') continue;
      const inside = this.persons.filter(p => {
        const px = p.x + p.w / 2, py = z.kind === 'queue' ? p.y + p.h : p.y + p.h / 2;   // feet for queues, centre for cars
        return z.pts ? inPoly(px, py, z.pts) : px >= z.x && px <= z.x + z.w && py >= z.y && py <= z.y + z.h;
      });
      const bucket = z.kind === 'queue' ? queue : car;
      bucket[z.door] = (bucket[z.door] ?? 0) + inside.length;
      if (z.kind === 'queue' && inside.length) score[z.door] = inside.reduce((s, p) => s + p.score, 0) / inside.length;
    }
    const mean = this.persons.length ? this.persons.reduce((s, p) => s + p.score, 0) / this.persons.length : null;
    return { queue, car, score, mean, exits: { ...this.exits }, people: this.persons.length };
  }

  resetExits() { this.exits = {}; for (const t of this.tracks) t.side = {}; }

  // Nearest-centroid tracker so the same person is followed between frames
  _track() {
    const pts = this.persons.map(p => ({ cx: p.x + p.w / 2, cy: p.y + p.h * 0.97 }));   // follow the feet
    const used = new Set();
    for (const t of this.tracks) {
      let best = -1, bd = 0.12;
      pts.forEach((p, i) => { if (used.has(i)) return; const d = Math.hypot(p.cx - t.cx, p.cy - t.cy); if (d < bd) { bd = d; best = i; } });
      if (best >= 0) { used.add(best); this._move(t, pts[best]); t.missed = 0; } else t.missed++;
    }
    pts.forEach((p, i) => { if (!used.has(i)) this.tracks.push({ id: this.nextId++, cx: p.cx, cy: p.cy, side: {}, missed: 0 }); });
    this.tracks = this.tracks.filter(t => t.missed < 8);
  }

  _move(t, p) {
    for (const [zi, z] of this.zones.entries()) {
      if (z.kind !== 'exit') continue;
      const minX = Math.min(z.x1, z.x2) - 0.02, maxX = Math.max(z.x1, z.x2) + 0.02;
      if (p.cx < minX || p.cx > maxX) continue;
      const lineY = z.y1 + (z.y2 - z.y1) * ((p.cx - z.x1) / ((z.x2 - z.x1) || 1e-6));
      const side = p.cy > lineY ? 1 : -1;                 // 1 = below the line (platform side)
      const prev = t.side[zi];
      if (prev === -1 && side === 1 && this.counting) this.exits[z.door] = (this.exits[z.door] ?? 0) + 1;
      t.side[zi] = side;
    }
    t.cx = p.cx; t.cy = p.cy;
  }

  // JPEG of the current frame for Claude, longest side at most `maxSide` px, with the queue and car areas
  // drawn and labelled so Claude can count per area. Returns the image and the labels it drew.
  frameJPEG(maxSide = 1024) {
    const [W, H] = this.size(); if (!W) return null;
    const k = Math.min(1, maxSide / Math.max(W, H));
    const c = document.createElement('canvas'); c.width = Math.round(W * k); c.height = Math.round(H * k);
    const g = c.getContext('2d'); g.drawImage(this.media, 0, 0, c.width, c.height);
    const labels = [];
    g.lineWidth = Math.max(2, c.width / 400); g.font = `bold ${Math.max(14, c.width / 50)}px sans-serif`;
    for (const z of this.zones) {
      if (z.kind === 'exit') continue;
      const label = z.kind === 'queue' ? `QUEUE ${z.door}A` : `CAR ${z.door}`;
      labels.push(label);
      g.strokeStyle = g.fillStyle = KIND_COLOR[z.kind];
      if (z.pts) { g.beginPath(); z.pts.forEach((p, i) => i ? g.lineTo(p.x * c.width, p.y * c.height) : g.moveTo(p.x * c.width, p.y * c.height)); g.closePath(); g.stroke(); }
      else g.strokeRect(z.x * c.width, z.y * c.height, z.w * c.width, z.h * c.height);
      const lx = z.pts ? Math.min(...z.pts.map(p => p.x)) : z.x, ly = z.pts ? Math.min(...z.pts.map(p => p.y)) : z.y;
      g.fillText(label, lx * c.width + 6, ly * c.height + Math.max(16, c.width / 45));
    }
    return { data: c.toDataURL('image/jpeg', 0.82).split(',')[1], labels };
  }

  draw() {
    const cv = this.overlay, r = cv.getBoundingClientRect(), dpr = Math.min(2, devicePixelRatio || 1);
    if (cv.width !== Math.round(r.width * dpr) || cv.height !== Math.round(r.height * dpr)) { cv.width = Math.round(r.width * dpr); cv.height = Math.round(r.height * dpr); }
    const g = cv.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, r.width, r.height);
    const box = this._contentBox(r.width, r.height);
    const X = v => box.x + v * box.w, Y = v => box.y + v * box.h;
    g.font = '600 13px "IBM Plex Mono", monospace'; g.lineWidth = 2;
    const c = this.counts();
    for (const z of this.zones) {
      g.strokeStyle = KIND_COLOR[z.kind]; g.fillStyle = KIND_COLOR[z.kind];
      if (z.kind === 'exit') {
        g.setLineDash([8, 6]); g.beginPath(); g.moveTo(X(z.x1), Y(z.y1)); g.lineTo(X(z.x2), Y(z.y2)); g.stroke(); g.setLineDash([]);
        if (this.counting) g.fillText(`↓${c.exits[z.door] ?? 0} off`, X(Math.max(z.x1, z.x2)) + 4, Y(Math.max(z.y1, z.y2)));
      } else {
        const n = (z.kind === 'queue' ? c.queue : c.car)[z.door] ?? 0, text = `${z.kind === 'queue' ? z.door + 'A' : 'car ' + z.door}: ${n}`;
        if (z.pts) {
          g.beginPath(); z.pts.forEach((p, i) => i ? g.lineTo(X(p.x), Y(p.y)) : g.moveTo(X(p.x), Y(p.y))); g.closePath();
          g.globalAlpha = 0.14; g.fill(); g.globalAlpha = 1; g.stroke();
          const bottom = z.pts.reduce((a, p) => p.y > a.y ? p : a); g.fillText(text, X(bottom.x) + 4, Y(bottom.y) + 14);
        } else {
          g.globalAlpha = 0.12; g.fillRect(X(z.x), Y(z.y), z.w * box.w, z.h * box.h); g.globalAlpha = 1;
          g.strokeRect(X(z.x), Y(z.y), z.w * box.w, z.h * box.h);
          g.fillText(text, X(z.x) + 6, Y(z.y) + 16);
        }
      }
    }
    g.strokeStyle = '#2fd27a'; g.fillStyle = '#2fd27a';
    for (const p of this.persons) {
      g.strokeRect(X(p.x), Y(p.y), p.w * box.w, p.h * box.h);
      g.fillText(`${(p.score * 100) | 0}%`, X(p.x) + 2, Y(p.y) - 4);
    }
    if (this.drag?.cur) {
      const d = this.drag; g.strokeStyle = KIND_COLOR[this.tool.kind]; g.setLineDash([4, 4]);
      if (this.tool.kind === 'exit') { g.beginPath(); g.moveTo(X(d.x0), Y(d.y0)); g.lineTo(X(d.cur.x), Y(d.cur.y)); g.stroke(); }
      else g.strokeRect(X(Math.min(d.x0, d.cur.x)), Y(Math.min(d.y0, d.cur.y)), Math.abs(d.cur.x - d.x0) * box.w, Math.abs(d.cur.y - d.y0) * box.h);
      g.setLineDash([]);
    }
  }

  // Where the video actually sits inside the element (object-fit: contain)
  _contentBox(cw, ch) {
    const [W, H] = this.size(); if (!W) return { x: 0, y: 0, w: cw, h: ch };
    const k = Math.min(cw / W, ch / H), w = W * k, h = H * k;
    return { x: (cw - w) / 2, y: (ch - h) / 2, w, h };
  }

  _bindDrawing() {
    const pos = e => { const r = this.overlay.getBoundingClientRect(), b = this._contentBox(r.width, r.height);
      return { x: Math.min(1, Math.max(0, (e.clientX - r.left - b.x) / b.w)), y: Math.min(1, Math.max(0, (e.clientY - r.top - b.y) / b.h)) }; };
    this.overlay.addEventListener('pointerdown', e => { const p = pos(e); this.drag = { x0: p.x, y0: p.y, cur: null }; this.overlay.setPointerCapture(e.pointerId); });
    this.overlay.addEventListener('pointermove', e => { if (this.drag) this.drag.cur = pos(e); });
    this.overlay.addEventListener('pointerup', e => {
      const d = this.drag; this.drag = null; if (!d?.cur) return;
      const { kind, door } = this.tool, p = d.cur;
      if (Math.hypot(p.x - d.x0, p.y - d.y0) < 0.03) return;
      this.zones = this.zones.filter(z => !(z.kind === kind && z.door === door));      // one area per kind and door
      if (kind === 'exit') this.zones.push({ kind, door, x1: d.x0, y1: d.y0, x2: p.x, y2: p.y });
      else this.zones.push({ kind, door, x: Math.min(d.x0, p.x), y: Math.min(d.y0, p.y), w: Math.abs(p.x - d.x0), h: Math.abs(p.y - d.y0) });
      this.onZonesChanged?.();
    });
  }
}
