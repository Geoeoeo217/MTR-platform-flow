// Original background music for the demo video, written in code (no samples, no third-party audio).
// 96 BPM, so one bar is 2.5 s and every 5-second scene is exactly two bars. Chords: Am – F – C – G.
// renderMix() renders the music and the voiceover lines together with an OfflineAudioContext; the music
// ducks under each spoken line so the voice stays clear.

const BPM = 96, BEAT = 60 / BPM, BAR = BEAT * 4;
const CHORDS = [[57, 60, 64], [53, 57, 60], [48, 52, 55], [55, 59, 62]];   // Am, F, C, G (MIDI notes)
const hz = m => 440 * Math.pow(2, (m - 69) / 12);

function noiseBuffer(ctx, sec = 1) {
  const b = ctx.createBuffer(1, ctx.sampleRate * sec, ctx.sampleRate), d = b.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  return b;
}

function env(g, t, a, peak, dec, sus = 0.0001) {
  g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(peak, t + a);
  g.gain.exponentialRampToValueAtTime(Math.max(sus, 0.0001), t + a + dec);
}

function kick(ctx, out, t, v = 1) {
  const o = ctx.createOscillator(), g = ctx.createGain();
  o.frequency.setValueAtTime(150, t); o.frequency.exponentialRampToValueAtTime(45, t + 0.12);
  env(g, t, 0.003, 0.9 * v, 0.35); o.connect(g).connect(out); o.start(t); o.stop(t + 0.4);
}
function hat(ctx, out, noise, t, v = 0.25, len = 0.05) {
  const s = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain();
  s.buffer = noise; f.type = 'highpass'; f.frequency.value = 7500;
  env(g, t, 0.002, v, len); s.connect(f).connect(g).connect(out); s.start(t); s.stop(t + len + 0.05);
}
function clap(ctx, out, noise, t, v = 0.4) {
  const s = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain();
  s.buffer = noise; f.type = 'bandpass'; f.frequency.value = 1800; f.Q.value = 0.8;
  env(g, t, 0.004, v, 0.18); s.connect(f).connect(g).connect(out); s.start(t); s.stop(t + 0.3);
}
function bass(ctx, out, t, m, len) {
  const o = ctx.createOscillator(), f = ctx.createBiquadFilter(), g = ctx.createGain();
  o.type = 'sawtooth'; o.frequency.value = hz(m); f.type = 'lowpass'; f.frequency.value = 420; f.Q.value = 4;
  env(g, t, 0.01, 0.32, len * 0.9); o.connect(f).connect(g).connect(out); o.start(t); o.stop(t + len + 0.05);
}
function pluck(ctx, out, t, m, v = 0.12) {
  const o = ctx.createOscillator(), f = ctx.createBiquadFilter(), g = ctx.createGain();
  o.type = 'square'; o.frequency.value = hz(m);
  f.type = 'lowpass'; f.frequency.setValueAtTime(3200, t); f.frequency.exponentialRampToValueAtTime(500, t + 0.2);
  env(g, t, 0.004, v, 0.22); o.connect(f).connect(g).connect(out); o.start(t); o.stop(t + 0.3);
}
function pad(ctx, out, t, notes, len, v = 0.07) {
  for (const m of notes) for (const det of [-7, 7]) {
    const o = ctx.createOscillator(), f = ctx.createBiquadFilter(), g = ctx.createGain();
    o.type = 'sawtooth'; o.frequency.value = hz(m); o.detune.value = det; f.type = 'lowpass'; f.frequency.value = 1400;
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(v, t + 0.4);
    g.gain.setValueAtTime(v, t + len - 0.3); g.gain.exponentialRampToValueAtTime(0.0001, t + len);
    o.connect(f).connect(g).connect(out); o.start(t); o.stop(t + len + 0.05);
  }
}
function riser(ctx, out, noise, t, len) {
  const s = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain();
  s.buffer = noise; s.loop = true; f.type = 'bandpass'; f.Q.value = 3;
  f.frequency.setValueAtTime(400, t); f.frequency.exponentialRampToValueAtTime(8000, t + len);
  g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.25, t + len);
  s.connect(f).connect(g).connect(out); s.start(t); s.stop(t + len);
}
function impact(ctx, out, noise, t) {
  kick(ctx, out, t, 1.2);
  const s = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain();
  s.buffer = noise; f.type = 'lowpass'; f.frequency.value = 2500;
  env(g, t, 0.005, 0.35, 1.2); s.connect(f).connect(g).connect(out); s.start(t); s.stop(t + 1.3);
}
function chime(ctx, out, t, m, v = 0.18) {
  for (const [mult, vol] of [[1, 1], [2, 0.3], [3, 0.12]]) {
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = 'sine'; o.frequency.value = hz(m) * mult; env(g, t, 0.005, v * vol, 1.4);
    o.connect(g).connect(out); o.start(t); o.stop(t + 1.5);
  }
}

// voice: [{buffer, start}] ; total: seconds
export async function renderMix(voice, total = 30) {
  const sr = 44100, ctx = new OfflineAudioContext(2, Math.ceil(sr * total), sr);
  const noise = noiseBuffer(ctx, 2);
  const out = ctx.createGain(); out.gain.value = 0.78; out.connect(ctx.destination);     // headroom so peaks never clip
  const master = ctx.createDynamicsCompressor(); master.threshold.value = -12; master.ratio.value = 4; master.connect(out);
  const music = ctx.createGain(); music.connect(master);

  // Ducking: music at full level between lines, lower under the voice
  const FULL = 0.62, DUCK = 0.24;
  music.gain.setValueAtTime(FULL, 0);
  for (const v of voice) {
    music.gain.setTargetAtTime(DUCK, Math.max(0, v.start - 0.15), 0.06);
    music.gain.setTargetAtTime(FULL, v.start + v.buffer.duration + 0.05, 0.25);
  }

  const bars = Math.ceil(total / BAR);
  for (let b = 0; b < bars; b++) {
    const t0 = b * BAR, ch = CHORDS[b % 4];
    const intro = t0 < 5 - 0.01, outro = t0 >= 25 - 0.01;
    pad(ctx, music, t0, ch, BAR, intro || outro ? 0.08 : 0.055);
    for (let s = 0; s < 16; s++) {                      // 16th-note grid
      const t = t0 + s * BEAT / 4; if (t >= total - 0.3) break;
      if (s % 2 === 0) pluck(ctx, music, t, ch[(s / 2) % 3] + 12 + (s % 8 === 6 ? 12 : 0), intro ? 0.07 : 0.1);
      if (intro || outro) continue;
      if (s % 4 === 0) kick(ctx, music, t);
      if (s % 4 === 2) hat(ctx, music, noise, t, 0.22, 0.07);
      if (s % 2 === 1) hat(ctx, music, noise, t, 0.08);
      if (s === 4 || s === 12) clap(ctx, music, noise, t);
      if (s % 2 === 0) bass(ctx, music, t, ch[0] - 24 + (s === 14 ? 7 : 0), BEAT / 2);
    }
  }
  riser(ctx, music, noise, 3.2, 1.8);                    // into the camera scene
  impact(ctx, music, noise, 5);
  riser(ctx, music, noise, 13.8, 1.2);                   // into the lights
  impact(ctx, music, noise, 15);
  impact(ctx, music, noise, 25);
  [[76, 28.9], [79, 29.15], [84, 29.4]].forEach(([m, t]) => t < total && chime(ctx, music, t, m));   // green, yellow, red ding
  // Ending: let the last chord ring out, then fade
  music.gain.setTargetAtTime(0.0001, total - 0.6, 0.2);

  for (const v of voice) { const s = ctx.createBufferSource(), g = ctx.createGain(); g.gain.value = 1.15; s.buffer = v.buffer; s.connect(g).connect(master); s.start(v.start); }
  return ctx.startRendering();
}
