// Records the Rail Flow AI demo video (30 s) from the running live system, with voiceover and original music.
// Every frame shows real output: the virtual CCTV with the camera AI's boxes, the system's counts, recommendation
// and lights, and the announcement Ollama wrote. Run from the browser console on http://localhost:8000/live/:
//   const m = await import('./tools/record-demo.js'); await m.prepare(); then click the "Record demo" button.
// The finished file is sent to a local helper that saves it (see the save URL below).
// Scene timing matches slide 7 of the deck: 0:00 intro · 0:05 camera AI · 0:10 best door and lights · 0:20 GenAI.

import { renderMix } from './music.js';

const W = 1280, H = 720, T = 30, SAVE = 'http://127.0.0.1:8791/rail-flow-ai-demo';
const C = { bg: '#0b100f', panel: '#152020', line: '#26332f', ink: '#eef4f2', muted: '#9fb2ad', accent: '#7ea2ee', go: '#2fd27a', amber: '#f2bd2c', stop: '#ff5a4e' };
const LIGHT = { g: C.go, y: C.amber, r: C.stop }, WORD = { g: 'ROOM', y: 'FILLING UP', r: 'FULL' };
const SANS = '"IBM Plex Sans", sans-serif', MONO = '"IBM Plex Mono", monospace', COND = '"Barlow Condensed", sans-serif';
const LINES = [
  { start: 0.5, text: 'Rush hour. Everyone crowds the same door. Meet Rail Flow AI.' },
  { start: 5.4, text: 'Camera AI spots every person, in every queue.' },
  { start: 10.2, text: 'It works out the space on the next train, door by door.' },
  { start: 15.3, text: 'Then the lights point the way. Green, yellow, red.' },
  { start: 20.5, text: 'And GenAI writes the announcement, in three languages.' },
  { start: 25.6, text: 'Same trains. Same platform. Smarter boarding.' },
];
const $ = id => document.getElementById(id);
const wait = ms => new Promise(r => setTimeout(r, ms));
const clamp = (x, a = 0, b = 1) => Math.max(a, Math.min(b, x));
const ease = x => 1 - Math.pow(1 - clamp(x), 3);
const back = x => { x = clamp(x); const c = 1.9; return 1 + (c + 1) * Math.pow(x - 1, 3) + c * Math.pow(x - 1, 2); };
let MIX = null;

export async function prepare() {
  const rf = window.railflow;
  // 1. A real announcement for scenario A, written by the GenAI model (Ollama)
  if (!rf.guideA) {
    $('scenario').value = 'A'; $('runDemo').click(); await wait(6000);
    $('guideNow').click();
    for (let i = 0; i < 60 && !rf.state.guide; i++) await wait(1000);
    rf.guideA = rf.state.guide; rf.guideBy = rf.state.guideBy;
  }
  // 2. Voiceover lines + original music, mixed offline
  const ac = new AudioContext();
  const voice = [];
  for (let i = 0; i < LINES.length; i++) {
    const buf = await ac.decodeAudioData(await (await fetch(`./tools/vo2/l${i + 1}.wav`, { cache: "no-store" })).arrayBuffer());
    voice.push({ buffer: buf, start: LINES[i].start }); LINES[i].end = LINES[i].start + buf.duration;
  }
  MIX = await renderMix(voice, T); ac.close();
  // 3. Back to the virtual CCTV and let people walk in
  if (rf.state.source !== 'virtual') { $('srcSample').click(); await wait(18000); }
  const b = document.createElement('button'); b.textContent = '● Record demo'; b.id = 'recBtn';
  Object.assign(b.style, { position: 'fixed', right: '20px', bottom: '20px', zIndex: 999, padding: '14px 20px', font: '600 16px sans-serif', background: '#ff5a4e', color: '#fff', border: 0, borderRadius: '8px' });
  b.onclick = () => { b.remove(); record(); };
  document.body.appendChild(b);
  return { guide: !!rf.guideA, by: rf.guideBy, mix: MIX.duration };
}

// ---------- drawing helpers ----------
function text(g, s, x, y, font, color, align = 'left', alpha = 1) {
  g.save(); g.globalAlpha *= alpha; g.font = font; g.fillStyle = color; g.textAlign = align; g.textBaseline = 'alphabetic'; g.fillText(s, x, y); g.restore();
}
function wrapLines(g, s, maxW, font) {
  g.font = font; const cjk = /[㐀-鿿]/.test(s), parts = cjk ? [...s] : s.split(/(\s+)/), out = []; let line = '';
  for (const p of parts) { const t = line + p; if (g.measureText(t).width > maxW && line.trim()) { out.push(line.trim()); line = p.trimStart(); } else line = t; }
  if (line.trim()) out.push(line.trim()); return out;
}
function typed(g, s, x, y, maxW, lh, font, color, progress) {     // typewriter: show the first part of the text
  const n = Math.floor(s.length * clamp(progress)), lines = wrapLines(g, s, maxW, font); let used = 0, yy = y;
  for (const l of lines) { const k = clamp(n - used, 0, l.length); if (k > 0) text(g, l.slice(0, k), x, yy, font, color); used += l.length + (/[㐀-鿿]/.test(s) ? 0 : 1); yy += lh; }
  if (progress > 0 && progress < 1 && Math.floor(performance.now() / 300) % 2) { g.fillStyle = C.accent; g.fillRect(x + Math.min(maxW, g.measureText(lines[Math.min(lines.length - 1, Math.floor((yy - y) / lh) - 1)] || '').width) + 4, yy - lh - 26, 3, 30); }
  return y + lines.length * lh;
}
function dots(g, cx, cy, r, gap, t0, t) {
  [C.go, C.amber, C.stop].forEach((c, i) => {
    const s = back((t - t0 - i * 0.12) / 0.35); if (s <= 0) return;
    g.fillStyle = c; g.beginPath(); g.arc(cx + (i - 1) * gap, cy, r * s, 0, 7); g.fill();
  });
}
function brand(g) { dots(g, 50, 42, 8, 22, -9, 0); text(g, 'RAIL FLOW AI', 124, 50, `700 26px ${COND}`, C.ink); }
function chip(g, s, x, y, color, font = `600 16px ${MONO}`) {
  g.font = font; const w = g.measureText(s).width + 24;
  g.fillStyle = 'rgba(6,10,9,.82)'; g.beginPath(); g.roundRect(x, y, w, 32, 6); g.fill();
  g.fillStyle = color; g.beginPath(); g.arc(x + 12, y + 16, 4, 0, 7); g.fill();
  text(g, s, x + 22, y + 22, font, color); return w;
}
function caption(g, t) {
  const l = LINES.find(l => t >= l.start - 0.1 && t <= (l.end ?? l.start + 3) + 0.3); if (!l) return;
  const a = clamp((t - l.start + 0.1) / 0.2) * clamp(((l.end ?? l.start + 3) + 0.3 - t) / 0.2);
  g.save(); g.globalAlpha = a; g.font = `600 28px ${SANS}`; const w = g.measureText(l.text).width + 48;
  g.fillStyle = 'rgba(5,8,7,.86)'; g.beginPath(); g.roundRect(W / 2 - w / 2, H - 88, w, 52, 10); g.fill();
  text(g, l.text, W / 2, H - 52, `600 28px ${SANS}`, C.ink, 'center'); g.restore();
}
function progressBar(g, t) {
  const segs = [C.go, C.amber, C.stop], w = W / 3;
  segs.forEach((c, i) => { const f = clamp((t / T) * 3 - i); g.fillStyle = c; g.fillRect(i * w, H - 6, w * f, 6); });
}
// A crop of the virtual CCTV (u0..u1 across the full multi-camera frame) with the camera AI overlay on top
function cctv(g, x, y, w, h, u0 = 0, u1 = 1, zoom = 1) {
  const rf = window.railflow, cam = rf.state.vcam?.canvas;
  g.save(); g.beginPath(); g.rect(x, y, w, h); g.clip(); g.fillStyle = '#070b0a'; g.fillRect(x, y, w, h);
  if (cam) {
    // Keep the picture's true shape: the crop's height follows from its width and the target box
    const cw = (u1 - u0) / zoom, cu = (u0 + u1) / 2 - cw / 2;
    const vh = Math.min(1, (cw * cam.width) * (h / w) / cam.height), v0 = clamp(0.4 - vh / 2, 0, 1 - vh);
    g.drawImage(cam, cu * cam.width, v0 * cam.height, cw * cam.width, vh * cam.height, x, y, w, h);
    // The camera AI's own detections and counting areas, redrawn crisply at video size (all coordinates are 0–1)
    const X = u => x + (u - cu) / cw * w, Y = v => y + (v - v0) / vh * h, s = w / (cw * 1280);
    for (const z of rf.vision.zones) {
      if (z.kind === 'queue' && z.pts) { g.strokeStyle = 'rgba(126,162,238,.75)'; g.lineWidth = 2.5; g.beginPath(); z.pts.forEach((p, i) => i ? g.lineTo(X(p.x), Y(p.y)) : g.moveTo(X(p.x), Y(p.y))); g.closePath(); g.stroke(); }
      if (z.kind === 'exit') { g.strokeStyle = 'rgba(197,140,255,.9)'; g.lineWidth = 3; g.setLineDash([10, 8]); g.beginPath(); g.moveTo(X(z.x1), Y(z.y1)); g.lineTo(X(z.x2), Y(z.y2)); g.stroke(); g.setLineDash([]); }
    }
    for (const p of rf.vision.persons) {
      const bx = X(p.x), by = Y(p.y), bw = p.w / cw * w, bh = p.h / vh * h;
      g.strokeStyle = C.go; g.lineWidth = Math.max(2, 3 * s); g.beginPath(); g.roundRect(bx, by, bw, bh, 4); g.stroke();
      const lbl = `person ${Math.round(p.score * 100)}%`, fs = Math.round(clamp(13 * s, 11, 18));
      g.font = `600 ${fs}px ${MONO}`; const lw = g.measureText(lbl).width + 10;
      g.fillStyle = C.go; g.fillRect(bx - 1, by - fs - 8, lw, fs + 8); text(g, lbl, bx + 4, by - 6, `600 ${fs}px ${MONO}`, '#04110a');
    }
  }
  g.restore();
}
function flash(g, t, at) {                                 // quick colour wipe between scenes
  const k = (t - at) / 0.32; if (k < 0 || k > 1) return;
  [C.go, C.amber, C.stop].forEach((c, i) => {
    const p = ease(k * 1.6 - i * 0.18), q = ease(k * 1.6 - 0.45 - i * 0.18);
    g.fillStyle = c; g.fillRect(W * q, (H / 3) * i, W * (p - q), H / 3 + 1);
  });
}
function best(ds) { const s = d => d.room - d.queue; return ds.filter(d => d.light === 'g').sort((a, b) => s(b) - s(a))[0] || ds.filter(d => d.light === 'y').sort((a, b) => s(b) - s(a))[0]; }

// ---------- scenes ----------
function sceneIntro(g, t) {
  cctv(g, 0, 0, W, H, 0, 1 / 2.4 + t * 0.01, 1.05 + t * 0.02);          // the live CCTV, darkened, behind the title
  g.fillStyle = 'rgba(8,12,11,.78)'; g.fillRect(0, 0, W, H);
  dots(g, W / 2, 230, 16, 46, 0.3, t);
  const s = back((t - 0.7) / 0.5);
  g.save(); g.translate(W / 2, 350); g.scale(0.6 + 0.4 * s, 0.6 + 0.4 * s); g.globalAlpha = clamp(s);
  text(g, 'RAIL FLOW AI', 0, 0, `700 132px ${COND}`, C.ink, 'center'); g.restore();
  typed(g, 'AI that guides passengers to the train doors with space', W / 2 - 400, 420, 820, 40, `400 30px ${SANS}`, C.muted, (t - 1.5) / 1.6);
  text(g, 'HACK4SDG 2026 · TEAM 1100 HACK-A-KILOGRAM', W / 2, 500, `500 18px ${MONO}`, C.accent, 'center', clamp((t - 3) / 0.4));
}

function sceneCamera(g, t, rf) {
  const k = t - 5, half = 1 / (rf.state.vcam?.cams || 2);
  // Camera 1 with a slow push-in, then a whip pan to camera 2
  const pan = ease((k - 2.4) / 0.35), u0 = pan * half, zoom = 1.04 + 0.05 * (k < 2.4 ? k / 2.4 : (k - 2.4) / 2.6);
  cctv(g, 0, 0, W, H, u0, u0 + half, zoom);
  if (k > 2.4 && k < 2.8) { g.fillStyle = `rgba(255,255,255,${0.18 * (1 - Math.abs(k - 2.6) / 0.2)})`; g.fillRect(0, 0, W, H); }
  const sy = (k * 0.55 % 1) * H; const gr = g.createLinearGradient(0, sy - 60, 0, sy);    // scan line
  gr.addColorStop(0, 'rgba(47,210,122,0)'); gr.addColorStop(1, 'rgba(47,210,122,.18)'); g.fillStyle = gr; g.fillRect(0, sy - 60, W, 60);
  g.fillStyle = 'rgba(47,210,122,.7)'; g.fillRect(0, sy, W, 2);
  brand(g);
  const rec = Math.floor(t * 2) % 2; g.fillStyle = rec ? C.stop : 'rgba(255,90,78,.35)'; g.beginPath(); g.arc(W - 200, 42, 7, 0, 7); g.fill();
  text(g, 'LIVE · CAMERA AI', W - 185, 49, `600 18px ${MONO}`, C.ink);
  const n = rf.vision.persons.length; chip(g, `${Math.round(n * ease(k / 0.8))} PEOPLE DETECTED`, 40, 80, C.go);
  const ds = rf.state.decisions, doors = k < 2.6 ? ds.slice(0, 2) : ds.slice(2, 4);
  let x = 40; doors.forEach((d, i) => { const a = clamp((k - (k < 2.6 ? 0.6 : 3) - i * 0.25) / 0.3); if (a > 0) x += chip(g, `${d.label}: ${d.queue} QUEUING`, x, 124, C.accent) + 10; });
}

function sceneSpace(g, t, rf) {
  const k = t - 10, ds = rf.state.decisions, cap = rf.cfg.capacity;
  g.fillStyle = C.bg; g.fillRect(0, 0, W, H);
  const sh = 270; cctv(g, 0, 66, W, Math.max(1, sh * ease(k / 0.5)), 0, 1, 1);
  brand(g);
  text(g, 'SPACE ON THE NEXT TRAIN', W - 40, 50, `500 18px ${MONO}`, C.accent, 'right');
  const n = ds.length, gap = 18, cw = (W - 80 - gap * (n - 1)) / n, top = 436;
  const b = best(ds);
  ds.forEach((d, i) => {
    const x = 40 + i * (cw + gap), a = ease((k - 0.5 - i * 0.15) / 0.4); if (a <= 0) return;
    g.save(); g.globalAlpha = a; g.translate(0, 30 * (1 - a));
    const isBest = b && d.door === b.door && k > 3.2;
    g.fillStyle = C.panel; g.strokeStyle = isBest ? C.go : C.line; g.lineWidth = isBest ? 4 : 1.5;
    g.beginPath(); g.roundRect(x, top - 40, cw, 220, 12); g.fill(); g.stroke();
    text(g, d.label, x + 18, top - 4, `700 40px ${COND}`, C.ink);
    const f = ease((k - 1 - i * 0.15) / 0.9);
    text(g, `${Math.round(d.room * f)}`, x + cw - 18, top - 2, `700 44px ${COND}`, C.ink, 'right');
    text(g, 'spaces', x + cw - 18, top + 18, `400 15px ${SANS}`, C.muted, 'right');
    // bar: space vs queue
    const bx = x + 18, bw = cw - 36, by = top + 48;
    g.fillStyle = '#0d1514'; g.beginPath(); g.roundRect(bx, by, bw, 26, 6); g.fill();
    const fill = clamp(d.queue / Math.max(1, d.room)) * f;
    g.fillStyle = LIGHT[d.light]; g.beginPath(); g.roundRect(bx, by, Math.max(8, bw * fill), 26, 6); g.fill();
    text(g, `${d.queue} queuing`, bx, by + 54, `500 17px ${SANS}`, C.muted);
    text(g, `${cap} − ${d.onboard} + ${d.forecastOff}`, bx, by + 82, `400 15px ${MONO}`, C.muted, 'left', clamp((k - 1.8) / 0.4));
    if (isBest) { const s = back((k - 3.2) / 0.4); g.save(); g.translate(x + cw / 2, top - 46); g.scale(s, s);
      g.fillStyle = C.go; g.beginPath(); g.roundRect(-70, -18, 140, 34, 17); g.fill(); text(g, '★ BEST DOOR', 0, 6, `700 17px ${SANS}`, '#06120c', 'center'); g.restore(); }
    g.restore();
  });
  text(g, 'space = capacity − on board + getting off', W / 2, 368, `400 18px ${MONO}`, C.muted, 'center', clamp((k - 1.6) / 0.4));
}

function sceneLights(g, t, rf) {
  const k = t - 15, ds = rf.state.decisions;
  g.fillStyle = C.bg; g.fillRect(0, 0, W, H);
  brand(g);
  text(g, 'DOOR LIGHTS · UPDATED LIVE', W / 2, 120, `500 20px ${MONO}`, C.accent, 'center');
  const n = ds.length, gap = 22, tw = (W - 200 - gap * (n - 1)) / n, top = 170, th = 300, b = best(ds);
  ds.forEach((d, i) => {
    const x = 100 + i * (tw + gap), f = clamp((k - 0.15 - i * 0.14) / 0.45);
    const s = f < 1 ? Math.sin(f * Math.PI / 2) : 1;                             // flip in
    g.save(); g.translate(x + tw / 2, top + th / 2); g.scale(s, 1);
    const isBest = b && d.door === b.door && k > 1.4;
    if (isBest) { const p = (k - 1.4) % 1; g.strokeStyle = `rgba(47,210,122,${1 - p})`; g.lineWidth = 6; g.beginPath(); g.roundRect(-tw / 2 - 14 * p - 6, -th / 2 - 14 * p - 6, tw + 28 * p + 12, th + 28 * p + 12, 18); g.stroke(); }
    g.fillStyle = LIGHT[d.light]; g.shadowColor = LIGHT[d.light]; g.shadowBlur = 40; g.beginPath(); g.roundRect(-tw / 2, -th / 2, tw, th, 14); g.fill(); g.shadowBlur = 0;
    text(g, d.label, 0, 10, `700 ${Math.round(th * 0.36)}px ${COND}`, '#0b1110', 'center');
    text(g, WORD[d.light], 0, th / 2 - 34, `700 ${Math.round(th * 0.09)}px ${SANS}`, '#0b1110', 'center');
    g.restore();
  });
  if (b) { const a = back((k - 1.6) / 0.45); g.save(); g.translate(W / 2, 560); g.scale(a, a);
    text(g, `→ USE ${b.label}`, 0, 0, `700 70px ${COND}`, C.ink, 'center'); g.restore(); }
}

function sceneGenAI(g, t, rf) {
  const k = t - 20, gd = rf.guideA;
  g.fillStyle = C.bg; g.fillRect(0, 0, W, H);
  const gr = g.createRadialGradient(W * 0.8, 80, 10, W * 0.8, 80, 700); gr.addColorStop(0, 'rgba(126,162,238,.16)'); gr.addColorStop(1, 'rgba(126,162,238,0)'); g.fillStyle = gr; g.fillRect(0, 0, W, H);
  brand(g);
  const by = String(rf.guideBy || 'GenAI');
  chip(g, `WRITTEN LIVE BY ${by.toUpperCase()}`, 60, 92, C.accent, `600 17px ${MONO}`);
  if (!gd) return;
  let y = typed(g, gd.announcement_en, 60, 186, W - 120, 44, `500 34px ${SANS}`, C.ink, (k - 0.3) / 2.1);
  const tags = [['繁', gd.announcement_zh_hant, '"PingFang HK", "PingFang TC", sans-serif', 2.4], ['简', gd.announcement_zh_hans, '"PingFang SC", sans-serif', 3.5]];
  for (const [tag, s, font, at] of tags) {
    const a = ease((k - at) / 0.35); if (a <= 0) continue;
    y += 22; g.save(); g.globalAlpha = a; g.translate(30 * (1 - a), 0);
    g.fillStyle = C.panel; g.beginPath(); g.roundRect(60, y - 32, 40, 40, 8); g.fill(); text(g, tag, 80, y - 2, `600 24px ${font}`, C.accent, 'center');
    const lines = wrapLines(g, s, W - 200, `500 30px ${font}`); lines.forEach((l, i) => text(g, l, 120, y + i * 42, `500 30px ${font}`, C.ink));
    g.restore(); y += lines.length * 42;
  }
}

function sceneEnd(g, t) {
  const k = t - 25;
  g.fillStyle = C.bg; g.fillRect(0, 0, W, H);
  dots(g, W / 2, 200, 18, 50, 25.1, t);
  const s = back((k - 0.3) / 0.5);
  g.save(); g.translate(W / 2, 320); g.scale(0.7 + 0.3 * s, 0.7 + 0.3 * s); g.globalAlpha = clamp(s);
  text(g, 'STAND SMART. RIDE SMOOTH.', 0, 0, `700 92px ${COND}`, C.ink, 'center'); g.restore();
  const a = ease((k - 1.1) / 0.5);
  g.save(); g.globalAlpha = a; g.translate(0, 20 * (1 - a));
  text(g, 'geoeoeo217.github.io/rail-flow-ai', W / 2, 410, `500 34px ${MONO}`, C.accent, 'center');
  text(g, 'github.com/Geoeoeo217/rail-flow-ai', W / 2, 458, `400 26px ${MONO}`, C.muted, 'center');
  g.restore();
  // The three lights flash in time with the closing chime
  [[C.go, 3.9], [C.amber, 4.15], [C.stop, 4.4]].forEach(([c, at], i) => { const p = clamp((k - at) / 0.5); if (p > 0 && p < 1) { g.strokeStyle = c; g.globalAlpha = 1 - p; g.lineWidth = 4; g.beginPath(); g.arc(W / 2 + (i - 1) * 50, 200, 18 + 40 * p, 0, 7); g.stroke(); g.globalAlpha = 1; } });
}

function frame(g, t) {
  const rf = window.railflow;
  g.fillStyle = C.bg; g.fillRect(0, 0, W, H);
  if (t < 5) sceneIntro(g, t);
  else if (t < 10) sceneCamera(g, t, rf);
  else if (t < 15) sceneSpace(g, t, rf);
  else if (t < 20) sceneLights(g, t, rf);
  else if (t < 25) sceneGenAI(g, t, rf);
  else sceneEnd(g, t);
  for (const at of [5, 10, 15, 20, 25]) flash(g, t, at - 0.16);
  caption(g, t); progressBar(g, t);
}

async function record() {
  const canvas = document.createElement('canvas'); canvas.width = W; canvas.height = H; const g = canvas.getContext('2d');
  const ctx = new AudioContext(); await ctx.resume();
  const dest = ctx.createMediaStreamDestination(), src = ctx.createBufferSource(); src.buffer = MIX; src.connect(dest);
  const stream = new MediaStream([...canvas.captureStream(30).getVideoTracks(), ...dest.stream.getAudioTracks()]);
  const types = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'];
  const mime = types.find(t => MediaRecorder.isTypeSupported(t));
  const rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 6_000_000, audioBitsPerSecond: 160_000 }); const chunks = [];
  rec.ondataavailable = e => e.data.size && chunks.push(e.data);
  const done = new Promise(r => rec.onstop = r);
  frame(g, 0); rec.start(250); const t0 = ctx.currentTime + 0.05; src.start(t0);
  let switched = false;
  const timer = setInterval(() => {
    const t = ctx.currentTime - t0;
    if (t >= 14.6 && !switched) { switched = true; $('scenario').value = 'A'; $('runDemo').click(); }   // show all three light colours
    frame(g, clamp(t, 0, T)); window.__recT = t;
    if (t >= MIX.duration) { clearInterval(timer); rec.stop(); }
  }, 33);
  await done;
  const blob = new Blob(chunks, { type: 'video/webm' });
  const data = await new Promise(r => { const fr = new FileReader(); fr.onload = () => r(fr.result); fr.readAsDataURL(blob); });
  const res = await fetch(`${SAVE}.webm`, { method: 'POST', body: data });
  window.railflowRecording = { bytes: blob.size, saved: await res.text(), mime };
}

// For checking scenes without recording: draws frame t onto a canvas
export function still(t) { const c = document.createElement('canvas'); c.width = W; c.height = H; frame(c.getContext('2d'), t); return c; }
export function previewMusic() { if (!MIX) return 'run prepare() first'; const ctx = new AudioContext(), s = ctx.createBufferSource(); s.buffer = MIX; s.connect(ctx.destination); s.start(); return MIX.duration; }
