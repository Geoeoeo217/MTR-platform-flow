// Records the Rail Flow AI demo video (about 30 s) from the running live system, with the voiceover.
// Every frame shows real output: the virtual CCTV with the camera AI's boxes, the system's recommendation and
// lights, and the announcement Ollama wrote. Run from the browser console on http://localhost:8000/live/:
//   const m = await import('./tools/record-demo.js'); await m.prepare(); then click the "Record demo" button.
// The finished file is sent to a local helper that saves it (see the save URL below).

const W = 1280, H = 720, SAVE = 'http://127.0.0.1:8791/rail-flow-ai-demo';
const C = { bg: '#0f1514', panel: '#172120', ink: '#e4ecea', muted: '#a9bab5', accent: '#7ea2ee', go: '#2fd27a', amber: '#f2bd2c', stop: '#ff5a4e' };
const LIGHT = { g: C.go, y: C.amber, r: C.stop }, WORD = { g: 'ROOM', y: 'LIMITED', r: 'FULL' };
const $ = id => document.getElementById(id);
const wait = ms => new Promise(r => setTimeout(r, ms));

export async function prepare() {
  const rf = window.railflow;
  // 1. A real announcement for scenario A, written by the GenAI model (Ollama)
  $('scenario').value = 'A'; $('runDemo').click(); await wait(6000);
  $('guideNow').click();
  for (let i = 0; i < 60 && !rf.state.guide; i++) await wait(1000);
  rf.guideA = rf.state.guide; rf.guideBy = rf.state.guideBy;
  // 2. Back to the virtual CCTV and let people walk in
  $('srcSample').click(); await wait(18000);
  const b = document.createElement('button'); b.textContent = '● Record demo'; b.id = 'recBtn';
  Object.assign(b.style, { position: 'fixed', right: '20px', bottom: '20px', zIndex: 999, padding: '14px 20px', font: '600 16px sans-serif', background: '#ff5a4e', color: '#fff', border: 0, borderRadius: '8px' });
  b.onclick = () => { b.remove(); record(); };
  document.body.appendChild(b);
  return { guide: !!rf.guideA, by: rf.guideBy };
}

function text(g, s, x, y, font, color, align = 'left') { g.font = font; g.fillStyle = color; g.textAlign = align; g.textBaseline = 'alphabetic'; g.fillText(s, x, y); }
function wrap(g, s, x, y, maxW, lh, font, color) {
  g.font = font; const words = s.split(/(\s+)/); let line = '', yy = y;
  const chars = /[㐀-鿿]/.test(s);
  const parts = chars ? [...s] : words;
  for (const p of parts) { const t = line + p; if (g.measureText(t).width > maxW && line) { text(g, line.trim(), x, yy, font, color); line = p.trimStart(); yy += lh; } else line = t; }
  if (line.trim()) text(g, line.trim(), x, yy, font, color); return yy + lh;
}
function caption(g, s) {
  g.fillStyle = 'rgba(8,12,11,.85)'; g.fillRect(40, H - 110, W - 80, 70);
  text(g, s, W / 2, H - 64, '600 30px "IBM Plex Sans", sans-serif', C.ink, 'center');
}
function brand(g) {
  [C.go, C.amber, C.stop].forEach((c, i) => { g.fillStyle = c; g.beginPath(); g.arc(52 + i * 22, 40, 8, 0, 7); g.fill(); });
  text(g, 'RAIL FLOW AI', 128, 48, '700 26px "Barlow Condensed", sans-serif', C.ink);
}
function cctv(g, x, y, w, h) {
  const rf = window.railflow, cam = rf.state.vcam?.canvas, ov = $('overlay');
  g.fillStyle = '#070b0a'; g.fillRect(x, y, w, h);
  if (cam) g.drawImage(cam, x, y, w, h);
  if (ov && ov.width) g.drawImage(ov, x, y, w, h);
  g.fillStyle = 'rgba(8,12,11,.8)'; g.fillRect(x + 12, y + 12, 330, 34);
  text(g, 'CAMERA AI · LIVE DETECTION', x + 24, y + 36, '500 18px "IBM Plex Mono", monospace', C.go);
}
function tiles(g, ds, x, y, w, h) {
  const n = ds.length, gap = 14, tw = (w - gap * (n - 1)) / n;
  ds.forEach((d, i) => {
    g.fillStyle = LIGHT[d.light]; g.beginPath(); g.roundRect(x + i * (tw + gap), y, tw, h, 10); g.fill();
    text(g, d.label, x + i * (tw + gap) + tw / 2, y + h * 0.55, `700 ${Math.round(h * 0.42)}px "Barlow Condensed", sans-serif`, '#0b1110', 'center');
    text(g, WORD[d.light], x + i * (tw + gap) + tw / 2, y + h * 0.85, `700 ${Math.round(h * 0.13)}px "IBM Plex Sans", sans-serif`, '#0b1110', 'center');
  });
}
function best(ds) { const s = d => d.room - d.queue; return ds.filter(d => d.light === 'g').sort((a, b) => s(b) - s(a))[0] || ds.filter(d => d.light === 'y').sort((a, b) => s(b) - s(a))[0]; }

function frame(g, t) {
  const rf = window.railflow, ds = rf.state.decisions;
  g.fillStyle = C.bg; g.fillRect(0, 0, W, H);
  if (t < 5.2) {                                                   // title
    [C.go, C.amber, C.stop].forEach((c, i) => { g.fillStyle = c; g.beginPath(); g.arc(W / 2 - 44 + i * 44, 250, 14, 0, 7); g.fill(); });
    text(g, 'RAIL FLOW AI', W / 2, 360, '700 120px "Barlow Condensed", sans-serif', C.ink, 'center');
    text(g, 'AI that guides passengers to the train doors with space', W / 2, 425, '400 32px "IBM Plex Sans", sans-serif', C.muted, 'center');
    return;
  }
  if (t < 9.6) { cctv(g, 0, 0, W, H); brand(g); caption(g, 'Camera AI counts the queue at every door'); return; }
  if (t < 15.2) {                                                  // camera + recommendation
    cctv(g, 0, 70, 800, 450); brand(g);
    const b = best(ds); const x = 830;
    text(g, 'RECOMMENDED DOOR', x, 110, '500 18px "IBM Plex Mono", monospace', C.accent);
    text(g, b ? b.label : 'ALL FULL', x, 200, '700 96px "Barlow Condensed", sans-serif', C.ink);
    if (b) {
      wrap(g, `Space ${b.room} = capacity ${rf.cfg.capacity} − ${b.onboard} on board + ${b.forecastOff} getting off`, x, 250, 410, 32, '400 22px "IBM Plex Sans", sans-serif', C.muted);
      text(g, `${b.queue} queuing → ${b.room - b.queue} spare`, x, 340, '600 24px "IBM Plex Sans", sans-serif', C.ink);
    }
    tiles(g, ds, 40, 540, 760, 90);
    caption(g, 'Space on the next train → best door, with the reason');
    return;
  }
  if (t < 19.3) {                                                  // lights for scenario A
    brand(g);
    text(g, 'TUNNEL SIGN AND DOOR LIGHTS', W / 2, 140, '500 22px "IBM Plex Mono", monospace', C.accent, 'center');
    tiles(g, ds, 120, 180, W - 240, 300);
    const b = best(ds); if (b) text(g, `Use ${b.label}`, W / 2, 560, '700 64px "Barlow Condensed", sans-serif', C.ink, 'center');
    caption(g, 'Red = full · Amber = filling up · Green = room');
    return;
  }
  if (t < 25.2) {                                                  // Ollama announcement
    brand(g); const gd = rf.guideA;
    text(g, `ANNOUNCEMENT · WRITTEN BY ${String(rf.guideBy || 'GenAI').toUpperCase()}`, 60, 120, '500 20px "IBM Plex Mono", monospace', C.accent);
    if (gd) {
      let y = wrap(g, gd.announcement_en, 60, 180, W - 120, 42, '500 32px "IBM Plex Sans", sans-serif', C.ink);
      y = wrap(g, gd.announcement_zh_hant, 60, y + 16, W - 120, 42, '500 30px "PingFang HK", "PingFang TC", sans-serif', C.ink);
      wrap(g, gd.announcement_zh_hans, 60, y + 16, W - 120, 42, '500 30px "PingFang SC", sans-serif', C.ink);
    }
    caption(g, 'Free local GenAI (Ollama): English · Traditional · Simplified Chinese');
    return;
  }
  [C.go, C.amber, C.stop].forEach((c, i) => { g.fillStyle = c; g.beginPath(); g.arc(W / 2 - 44 + i * 44, 230, 14, 0, 7); g.fill(); });   // end card
  text(g, 'RAIL FLOW AI', W / 2, 330, '700 104px "Barlow Condensed", sans-serif', C.ink, 'center');
  text(g, 'geoeoeo217.github.io/rail-flow-ai', W / 2, 410, '500 34px "IBM Plex Mono", monospace', C.accent, 'center');
  text(g, 'github.com/Geoeoeo217/rail-flow-ai', W / 2, 460, '400 28px "IBM Plex Mono", monospace', C.muted, 'center');
}

async function record() {
  const canvas = document.createElement('canvas'); canvas.width = W; canvas.height = H; const g = canvas.getContext('2d');
  const ctx = new AudioContext(); await ctx.resume();
  const buf = await ctx.decodeAudioData(await (await fetch('./tools/vo/voiceover.wav')).arrayBuffer());
  const dest = ctx.createMediaStreamDestination(), src = ctx.createBufferSource(); src.buffer = buf; src.connect(dest);
  const stream = new MediaStream([...canvas.captureStream(30).getVideoTracks(), ...dest.stream.getAudioTracks()]);
  const types = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm', 'video/mp4'];
  const mime = types.find(t => MediaRecorder.isTypeSupported(t));
  const rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 5_000_000 }); const chunks = [];
  rec.ondataavailable = e => e.data.size && chunks.push(e.data);
  const done = new Promise(r => rec.onstop = r);
  frame(g, 0); rec.start(250); const t0 = ctx.currentTime + 0.05; src.start(t0);
  let switched = false;
  const timer = setInterval(() => {
    const t = ctx.currentTime - t0;
    if (t >= 15.2 && !switched) { switched = true; $('scenario').value = 'A'; $('runDemo').click(); }   // show the three light states
    frame(g, Math.max(0, t)); window.__recT = t;
    if (t >= buf.duration) { clearInterval(timer); rec.stop(); }
  }, 33);
  await done;
  const blob = new Blob(chunks, { type: mime.split(';')[0] });
  const ext = mime.startsWith('video/mp4') ? 'mp4' : 'webm';
  const data = await new Promise(r => { const fr = new FileReader(); fr.onload = () => r(fr.result); fr.readAsDataURL(blob); });
  const res = await fetch(`${SAVE}.${ext}`, { method: 'POST', body: data });
  window.railflowRecording = { ext, bytes: blob.size, saved: await res.text(), mime };
}
