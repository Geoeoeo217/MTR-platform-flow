// Rail Flow AI live system: the end-to-end workflow, each stage feeding the next.
//   1 Input     → camera, uploaded media, virtual CCTV (simulated video), a demo scenario (simulated data) or manual entry
//   2 Counts    → people queuing per door (camera AI, or the entered numbers) and people on board per car
//   3 Capacity  → room per door = capacity − on board + forecast getting off
//   4 Recommend → which door to use, and why
//   5 Guidance  → tunnel sign, door lights, and an optional GenAI announcement in three languages
// Everything runs in the browser. Every value on screen says where it came from.

import { Vision } from './vision.js';
import { Forecaster } from './forecast.js';
import { DecisionEngine } from './decision.js';
import { GenAI, describeError } from './genai.js';
import { VirtualCam } from './virtualcam.js';

const $ = id => document.getElementById(id);
const LS = { get: (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } },
             set: (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* storage blocked */ } } };

const PRESETS = {
  desk:    { capacity: 6,   queueMax: 5,  headway: 60,  dwell: 15 },
  station: { capacity: 230, queueMax: 140, headway: 120, dwell: 25 },   // queue area holds about 60% of a car load
};

// Demo scenarios: SIMULATED data, given as shares of car capacity so they work at both scales
const SCENARIOS = {
  // Enough space overall, but people bunch at one end: the situation the lights are meant to fix
  // Each scenario gives one door of each colour state: red (over-full), amber (filling up), green (room)
  A: { name: 'Scenario A · morning rush', day: 0, hour: 9, min: 0, queue: [1.0, 0.85, 0.5, 0.05], onboard: [0.55, 0.65, 0.55, 0.35] },
  B: { name: 'Scenario B · evening',      day: 4, hour: 18, min: 30, queue: [0.05, 0.5, 0.85, 1.0], onboard: [0.35, 0.55, 0.75, 0.55] },
};

const SOURCES = {
  none:     { name: 'No input yet',     badge: 'off',    label: 'No input' },
  camera:   { name: 'Live webcam',      badge: 'real',   label: 'Live camera · real AI detection' },
  video:    { name: 'Uploaded video',   badge: 'real',   label: 'Uploaded media · real AI detection' },
  image:    { name: 'Uploaded photo',   badge: 'real',   label: 'Uploaded media · real AI detection' },
  virtual:  { name: 'Virtual CCTV',     badge: 'sim',    label: 'Simulated video · real AI detection' },
  scenario: { name: 'Demo scenario',    badge: 'sim',    label: 'Simulated demo data' },
  manual:   { name: 'Manual entry',     badge: 'manual', label: 'Manual entry' },
};

const saved = LS.get('pf-live-cfg', {});
const cfg = Object.assign({ preset: 'desk', doors: 4, holdSec: 4, follow: 60, detail: true, provider: 'ollama', ollamaUrl: 'http://localhost:11434', ollamaModel: 'qwen3-vl:2b-instruct', remember: false, auto: true }, saved);
Object.assign(cfg, PRESETS[cfg.preset] || PRESETS.desk);
let apiKey = cfg.remember ? (LS.get('pf-live-key', '') || '') : '';

const vision = new Vision($('media'), $('overlay'));
const forecaster = new Forecaster();
const engine = new DecisionEngine();
const genai = new GenAI();
vision.detail = cfg.detail;

const state = {
  source: 'none', scenario: null, edited: false,
  entered: { queue: {}, onboard: {} },          // manual entry / scenario values
  feedOnboard: {},                               // simulated train-load feed, used when nothing else gives on-board numbers
  onboardSnapshot: {}, forecastSnapshot: {},
  ai: null, aiAt: 0, aiStatus: '',
  phase: 'waiting', phaseEnds: Date.now() + cfg.headway * 1000,
  decisions: [], flags: [], lastPattern: '', lastGuideAt: 0, guide: null, guidePattern: '', liveSince: 0,
  modelReady: false,
};

// ---------------- setup ----------------
async function init() {
  $('status').textContent = 'Loading history and the people-detection model…';
  const n = await forecaster.load('data/history-sample.csv').catch(() => 0);
  newTrainFeed();
  try { await vision.loadModel(); state.modelReady = true; }
  catch { /* shown as a flag; manual entry and scenarios still work */ }
  $('status').textContent = state.modelReady
    ? `Ready. Press ▶ Run demo, or choose an input. ${n ? n.toLocaleString() + ' history records loaded.' : 'History could not load; forecasts use a flat 20% getting off.'}`
    : 'The people-detection model could not load (it needs internet). Demo scenarios and manual entry still work.';
  vision.defaultZones(cfg.doors);
  vision.onZonesChanged = renderZoneList;
  buildControls(); renderZoneList(); applySettingsForm();
  connectAI(); await refreshAI();
  loop(); setInterval(tickTrain, 250); setInterval(aiCountLoop, 1000); setInterval(renderLearning, 3000);
}

function buildControls() {
  $('runDemo').onclick = () => startScenario($('scenario').value);
  $('scenario').onchange = () => { if (state.source === 'scenario') startScenario($('scenario').value); };
  $('srcCamera').onclick = startCamera;
  $('srcFile').onchange = e => { const f = e.target.files[0]; if (f) useFile(f); e.target.value = ''; };
  $('srcSample').onclick = startVirtual;
  $('srcManual').onclick = () => { setSource('manual'); buildEntryPanel(); };
  $('tool').onchange = $('toolDoor').onchange = () => { vision.tool = { kind: $('tool').value, door: +$('toolDoor').value }; };
  $('resetZones').onclick = () => { vision.zones = state.vcam && state.source === 'virtual' ? state.vcam.zones() : (vision.defaultZones(cfg.doors), vision.zones); renderZoneList(); };
  $('clearZones').onclick = () => { vision.zones = []; renderZoneList(); };
  $('btnArrive').onclick = () => setPhase('arriving');
  $('btnOpen').onclick = () => setPhase('open');
  $('btnClose').onclick = () => setPhase('closed');
  $('auto').onchange = e => { cfg.auto = e.target.checked; save(); };
  $('analyzeNow').onclick = () => runAICount(true);
  $('guideNow').onclick = () => runGuidance(true);
  $('clearLearned').onclick = () => { forecaster.clearObserved(); renderLearning(); };
  $('openSettings').onclick = () => { applySettingsForm(); $('settings').showModal(); };
  $('settingsForm').onsubmit = async e => { e.preventDefault(); readSettingsForm(); $('settings').close(); await refreshAI(); };
  $('cancelSettings').onclick = () => $('settings').close();
  $('setProvider').onchange = showProviderFields;
  $('forgetKey').onclick = () => { apiKey = ''; LS.set('pf-live-key', ''); $('setKey').value = ''; connectAI(); refreshAI(); };
  $('toolDoor').innerHTML = Array.from({ length: cfg.doors }, (_, i) => `<option value="${i + 1}">${i + 1}</option>`).join('');
  $('auto').checked = cfg.auto;
}

// ---------------- inputs ----------------
function startScenario(key) {
  const sc = SCENARIOS[key];
  state.scenario = key; state.edited = false;
  const at = i => sc.queue[Math.min(sc.queue.length - 1, Math.round(i * (sc.queue.length - 1) / Math.max(1, cfg.doors - 1)))];
  const ob = i => sc.onboard[Math.min(sc.onboard.length - 1, Math.round(i * (sc.onboard.length - 1) / Math.max(1, cfg.doors - 1)))];
  for (let d = 1; d <= cfg.doors; d++) { state.entered.queue[d] = Math.round(at(d - 1) * cfg.capacity); state.entered.onboard[d] = Math.round(ob(d - 1) * cfg.capacity); }
  stopMedia(); setSource('scenario'); buildEntryPanel(); engine.reset();
}

function scenarioTime() {
  const sc = SCENARIOS[state.scenario]; if (!sc || state.source !== 'scenario') return new Date();
  const d = new Date(); d.setHours(sc.hour, sc.min, 0, 0);
  d.setDate(d.getDate() + ((sc.day - ((d.getDay() + 6) % 7)) + 7) % 7);   // the next matching weekday
  return d;
}

async function startCamera() {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false });
    const v = ensureVideo(); v.srcObject = stream; await v.play(); vision.defaultZones(cfg.doors); renderZoneList(); setSource('camera');
  } catch { $('status').textContent = 'Camera blocked or not found. Allow camera access in the browser, or use a demo scenario.'; }
}

function useFile(file) {
  if (!file.type.startsWith('image/') && !file.type.startsWith('video/')) { $('status').textContent = 'That file is not a video or photo. Choose an .mp4, .mov, .jpg or .png file.'; return; }
  const url = URL.createObjectURL(file);
  if (file.type.startsWith('image/')) {
    const img = document.createElement('img'); img.alt = 'Uploaded photo'; img.src = url;
    swapMedia(img); img.onload = () => { vision.defaultZones(cfg.doors); renderZoneList(); setSource('image'); };
    img.onerror = () => { $('status').textContent = 'The photo could not be opened.'; };
    return;
  }
  const v = ensureVideo(); v.srcObject = null; v.src = url; v.loop = true; v.muted = true;
  v.onerror = () => { $('status').textContent = 'The video could not be played in this browser. Try an .mp4 file.'; };
  v.play().catch(() => {}); vision.defaultZones(cfg.doors); renderZoneList(); setSource('video');
}

function ensureVideo() {
  if (vision.media.tagName === 'VIDEO') return vision.media;
  const v = document.createElement('video'); v.playsInline = true; v.muted = true; swapMedia(v); return v;
}
function stopMedia() { const m = vision.media; if (m.srcObject) { m.srcObject.getTracks().forEach(t => t.stop()); m.srcObject = null; } if (state.vcam) { state.vcam.stop(); } }
function swapMedia(el) {
  const old = vision.media; if (old.srcObject) old.srcObject.getTracks().forEach(t => t.stop());
  if (state.vcam && el !== state.vcam.canvas) { state.vcam.stop(); vision.minScore = 0.45; }
  el.id = 'media'; old.replaceWith(el); vision.media = el;
}

// Virtual CCTV: a live 3D platform filmed from a wall camera. The video is simulated; the detection on it is real.
function startVirtual() {
  if (state.vcam && state.vcam.doors !== cfg.doors) { state.vcam.stop(); state.vcam = null; }
  if (!state.vcam) {
    state.vcam = new VirtualCam(() => {
      const map = f => Object.fromEntries(state.decisions.map(d => [d.door, f(d)]));
      return { phase: state.phase, lights: map(d => d.light), onboard: map(d => d.onboard), forecastOff: map(d => d.forecastOff), capacity: cfg.capacity };
    }, cfg.doors);
    state.vcam.canvas.setAttribute('aria-label', 'Virtual CCTV view of the platform (simulated)');
  }
  swapMedia(state.vcam.canvas); state.vcam.start();
  vision.minScore = 0.25;                      // 3D figures score lower than real people
  vision.zones = state.vcam.zones(); renderZoneList();
  setSource('virtual');
}

function setSource(s) {
  state.source = s; state.liveSince = Date.now(); state.ai = null; engine.reset();   // new input: no carried-over light hold
  const src = SOURCES[s];
  $('srcBadge').className = 'badge ' + src.badge; $('srcBadge').textContent = src.label;
  const entry = s === 'manual' || s === 'scenario';
  $('manualPanel').hidden = !entry;
  $('camBox').hidden = entry; $('zoneDetails').hidden = entry;     // no camera in scenario and manual modes
  $('camEmpty').hidden = s !== 'none';
  $('camEmpty').textContent = s === 'scenario' ? `${SCENARIOS[state.scenario].name}: simulated counts, no camera. Edit them below.` : s === 'manual' ? 'Manual entry: type the counts below.' : 'Press ▶ Run demo, or choose an input above.';
  if (entry) { const m = vision.media; if (m.tagName === 'VIDEO') m.pause?.(); }
  $('status').textContent = {
    camera: 'Webcam running. Stand in the queue areas to test.',
    video: 'Analysing the uploaded video with the camera AI.',
    image: 'Analysing the uploaded photo with the camera AI.',
    virtual: 'Virtual CCTV: simulated 3D video, analysed by the real camera AI. On-board numbers come from a simulated train-load feed.',
    scenario: `${SCENARIOS[state.scenario]?.name}: simulated counts. Switch scenario to see the recommendation change, or edit any number.`,
    manual: 'Manual entry: type queue and on-board numbers for each door.',
  }[s] || '';
}

// Entry panel for manual mode and scenarios: queue and on-board numbers per door, validated
function buildEntryPanel() {
  const n = cfg.doors, el = $('manualInputs'); el.style.setProperty('--doors', n);
  const cells = (kind) => Array.from({ length: n }, (_, i) => `<input type="number" inputmode="numeric" min="0" max="999" step="1" id="in-${kind}-${i + 1}" data-kind="${kind}" data-door="${i + 1}" value="${state.entered[kind][i + 1] ?? 0}" aria-label="${kind === 'queue' ? 'Queue' : 'On board'} at door ${i + 1}A">`).join('');
  el.innerHTML = `<span></span>${Array.from({ length: n }, (_, i) => `<span class="lbl" style="text-align:center">${i + 1}A</span>`).join('')}
    <span class="lbl">Queuing</span>${cells('queue')}<span class="lbl">On board</span>${cells('onboard')}`;
  for (const inp of el.querySelectorAll('input')) inp.oninput = e => {
    const v = e.target.value.trim(), num = Number(v), ok = v !== '' && Number.isInteger(num) && num >= 0 && num <= 999;
    e.target.style.borderColor = ok ? '' : 'var(--stop)';
    if (!ok) return;                                 // invalid entries are ignored and outlined in red
    state.entered[e.target.dataset.kind][+e.target.dataset.door] = num;
    if (state.source === 'scenario') state.edited = true;
  };
  $('manualHint').textContent = state.source === 'scenario' ? `${SCENARIOS[state.scenario].name}: simulated counts, no camera. Edit any number to see the recommendation respond.` : 'Manual entry: type whole numbers from 0 to 999 for each door.';
}

// ---------------- main loop ----------------
async function loop() {
  let counts = { queue: {}, car: {}, score: {}, mean: null, exits: {}, people: 0 };
  const live = !['none', 'manual', 'scenario'].includes(state.source);
  if (live && state.modelReady) { try { counts = (await vision.step()) || counts; } catch { /* frame not ready */ } }
  vision.draw();
  update(counts, live);
  setTimeout(loop, live ? 300 : 400);
}

function aiFresh() { return state.ai && Date.now() - state.aiAt < 30000; }
function aiCount(label) { return aiFresh() ? state.ai.areas.find(a => a.label === label)?.people : undefined; }

function update(counts, live) {
  const doors = [], flags = [], when = scenarioTime();
  const entry = state.source === 'manual' || state.source === 'scenario';
  const trustAI = genai.provider === 'claude' && genai.enabled;
  for (let d = 1; d <= cfg.doors; d++) {
    let queue = 0, qSource = 'none', conf = null, aiQ;
    if (entry) { queue = state.entered.queue[d] ?? 0; qSource = state.source === 'scenario' ? (state.edited ? 'scenario (edited)' : 'scenario') : 'entered'; }
    else if (live) {
      const det = counts.queue[d] ?? 0; aiQ = aiCount(`QUEUE ${d}A`);
      queue = aiQ !== undefined && trustAI ? Math.max(det, aiQ) : det;
      qSource = aiQ !== undefined && trustAI && aiQ > det ? 'GenAI vision' : 'camera AI';
      conf = counts.score[d] ?? null;
      if (!vision.zones.some(z => z.kind === 'queue' && z.door === d)) flags.push(`No queue area drawn for ${d}A, so its count is 0.`);
      const lowAt = state.source === 'virtual' ? 0.4 : 0.55;   // simulated 3D figures always score lower than real people
      if (conf !== null && conf < lowAt) flags.push(`${d}A: detections are low-confidence (average ${(conf * 100).toFixed(0)}%).`);
      if (aiQ !== undefined && trustAI && Math.abs(aiQ - det) >= Math.max(2, det * 0.3)) flags.push(`${d}A: camera AI counted ${det}, GenAI counted ${aiQ}. Using the higher number.`);
    }
    // People on board: entered numbers, a car camera, or the simulated train-load feed
    let onboard, oSource;
    const carZone = live && vision.zones.some(z => z.kind === 'car' && z.door === d);
    if (state.phase === 'open') { onboard = state.onboardSnapshot[d] ?? 0; oSource = 'at doors-open'; }
    else if (entry) { onboard = state.entered.onboard[d] ?? 0; oSource = qSource; }
    else if (carZone) { onboard = counts.car[d] ?? 0; oSource = 'car camera'; }
    else { onboard = state.feedOnboard[d] ?? 0; oSource = 'simulated feed'; }
    if (onboard > cfg.capacity) { flags.push(`${d}A: ${onboard} on board is more than the car capacity (${cfg.capacity}); capped at ${cfg.capacity}.`); onboard = cfg.capacity; }
    const f = forecaster.alighting(d, onboard, when);
    doors.push({ door: d, label: `${d}A`, queue, qSource, conf, aiQ, onboard, oSource, forecastOff: f.count, f });
  }
  if (live && !state.modelReady) flags.unshift('The people-detection model is not loaded, so camera counts are unavailable. Use a demo scenario or manual entry.');
  else if (live && counts.people === 0 && Date.now() - state.liveSince > 6000) flags.push('No people detected in the image. Check the camera angle and the counting areas.');
  state.flags = flags;
  state.decisions = engine.decide(doors, cfg);
  render(counts, live);
  const pattern = state.decisions.map(d => d.light).join('');
  if (pattern !== state.lastPattern) { state.lastPattern = pattern; maybeGuide(); }
}

// ---------------- recommendation and before/after estimate ----------------
function recommend(ds) {
  const spare = d => d.room - d.queue;
  const pick = ds.filter(d => d.light === 'g').sort((a, b) => spare(b) - spare(a))[0] || ds.filter(d => d.light === 'y').sort((a, b) => spare(b) - spare(a))[0];
  return { best: pick || null, avoid: ds.filter(d => d.light === 'r'), spare };
}

// Estimate only: assumes `follow`% of people at red doors (and above 0.7 × room at amber doors) move to doors with spare room
function afterGuidance(ds) {
  const share = cfg.follow / 100, after = ds.map(d => d.queue);
  let movers = 0;
  ds.forEach((d, i) => {
    const excess = d.light === 'r' ? d.queue : d.light === 'y' ? Math.max(0, d.queue - Math.floor(0.7 * d.room)) : 0;
    const m = Math.floor(excess * share); after[i] -= m; movers += m;
  });
  const spare = ds.map((d, i) => d.light === 'g' ? Math.max(0, d.room - after[i]) : 0);
  const total = spare.reduce((a, b) => a + b, 0);
  if (total > 0) {
    let left = movers;
    spare.forEach((s, i) => { const take = Math.min(s, Math.round(movers * s / total), left); after[i] += take; left -= take; });
    for (let i = 0; left > 0 && i < after.length; i++) { const room = spare[i] - (after[i] - ds[i].queue); const take = Math.max(0, Math.min(room, left)); after[i] += take; left -= take; }
    // anyone who found no space stays where they were
    if (left > 0) ds.forEach((d, i) => { const back = Math.min(left, d.queue - after[i] > 0 ? d.queue - after[i] : 0); after[i] += back; left -= back; });
  } else ds.forEach((d, i) => { after[i] = d.queue; });
  return after;
}

const cv = a => { const m = a.reduce((x, y) => x + y, 0) / a.length; return m > 0 ? Math.sqrt(a.reduce((s, v) => s + (v - m) ** 2, 0) / a.length) / m : 0; };
const over = (q, ds) => q.reduce((s, v, i) => s + Math.max(0, v - ds[i].room), 0);

// ---------------- train cycle ----------------
function newTrainFeed() {
  // SIMULATED stand-in for MTR's train-load data (car weight sensors): people on board each car of the next train
  for (let d = 1; d <= 8; d++) state.feedOnboard[d] = Math.round(cfg.capacity * (0.62 + 0.3 * Math.random()));
}

function setPhase(p) {
  const now = Date.now();
  if (p === 'arriving') { state.phase = 'arriving'; state.phaseEnds = now + 5000; }
  if (p === 'open') {
    if (state.phase !== 'arriving') setPhase('arriving');
    for (const d of state.decisions) { state.onboardSnapshot[d.door] = d.onboard; state.forecastSnapshot[d.door] = d.forecastOff; }
    vision.resetExits(); vision.counting = true;
    state.phase = 'open'; state.phaseEnds = now + cfg.dwell * 1000;
  }
  if (p === 'closed') {
    if (state.phase !== 'open') return;
    vision.counting = false; recordTrain();
    state.phase = 'waiting'; state.phaseEnds = now + cfg.headway * 1000;
    newTrainFeed();
  }
}

function tickTrain() {
  if (!cfg.auto || Date.now() < state.phaseEnds) return;
  setPhase(state.phase === 'waiting' ? 'arriving' : state.phase === 'arriving' ? 'open' : 'closed');
}

// After the doors close, doors with an exit line record how many people the camera AI saw getting off
function recordTrain() {
  const live = ['camera', 'video', 'virtual'].includes(state.source);
  if (!live) return;
  const source = state.source === 'virtual' ? 'simulated' : 'observed';    // simulated-video counts are kept for this session only
  for (let d = 1; d <= cfg.doors; d++) {
    if (!vision.zones.some(z => z.kind === 'exit' && z.door === d)) continue;
    forecaster.observe(d, state.onboardSnapshot[d] ?? 0, vision.exits[d] ?? 0, state.forecastSnapshot[d] ?? 0, new Date(), source);
  }
  renderLearning();
}

// ---------------- GenAI ----------------
async function refreshAI() { state.aiStatus = await genai.check(); renderAI(); }

function aiCountLoop() {
  // Automatic counting only with Claude: a small local model's count isn't used, so it isn't worth the load
  if (genai.provider !== 'claude' || !genai.enabled || genai.busy.count) return;
  if (['none', 'manual', 'scenario'].includes(state.source)) return;
  if (Date.now() - state.aiAt >= 15000) runAICount(false);
}

async function runAICount(manual) {
  if (!genai.enabled) { $('aiStatus').textContent = state.aiStatus; if (manual) $('settings').showModal(); return; }
  if (genai.busy.count) return;
  const frame = vision.frameJPEG(1024);
  if (!frame || !frame.labels.length || ['manual', 'scenario', 'none'].includes(state.source)) { $('aiStatus').textContent = 'Needs a camera, photo, video or the virtual CCTV, with at least one queue area.'; return; }
  genai.busy.count = true; state.aiAt = Date.now(); $('aiStatus').textContent = `${genai.name} is counting the frame…`;
  const t0 = performance.now();
  try { state.ai = await genai.countCrowd(frame.data, frame.labels); state.aiAt = Date.now(); $('aiStatus').textContent = `Counted by ${genai.name} in ${((performance.now() - t0) / 1000).toFixed(1)} s.`; }
  catch (e) { state.ai = null; $('aiStatus').textContent = describeError(e); }
  genai.busy.count = false; renderAI();
}

function maybeGuide() { if (genai.enabled && state.source !== 'none' && Date.now() - state.lastGuideAt > 20000) runGuidance(false); }

async function runGuidance(manual) {
  if (!genai.enabled) { $('guideStatus').textContent = state.aiStatus; if (manual) $('settings').showModal(); return; }
  if (genai.busy.guide || !state.decisions.length) return;
  const by_ = genai.name;                         // remember who was asked, in case Settings change mid-request
  genai.busy.guide = true; state.lastGuideAt = Date.now(); $('guideStatus').textContent = `${by_} is writing…`;
  const pattern = state.decisions.map(d => d.light).join('');
  const by = c => state.decisions.filter(d => d.light === c).map(d => d.label);
  const input = { station: 'Admiralty', walk_to_doors: by('g'), limited_space_doors: by('y'), full_doors_avoid: by('r'),
    details: state.decisions.map(d => ({ door: d.label, light: { g: 'green', y: 'amber', r: 'red' }[d.light], people_queuing: d.queue, space_on_next_train: d.room })) };
  try { state.guide = await genai.writeGuidance(input); state.guidePattern = pattern; state.guideBy = by_; state.guideAt = new Date(); $('guideStatus').textContent = ''; }
  catch (e) { $('guideStatus').textContent = describeError(e); }
  genai.busy.guide = false; renderAI();
}

// ---------------- rendering ----------------
const LIGHT = { g: 'var(--go)', y: 'var(--caution)', r: 'var(--stop)' };
const WORD = { g: 'Room', y: 'Limited', r: 'Full' };
const list = a => a.length <= 1 ? a.join('') : a.slice(0, -1).join(', ') + ' and ' + a[a.length - 1];
const spaces = n => `${n} space${n === 1 ? '' : 's'}`;

function ruleSign(ds) {
  const g = ds.filter(d => d.light === 'g').map(d => d.label);
  return g.length ? `More space at door${g.length > 1 ? 's' : ''} ${list(g)} →` : 'All doors busy: please spread along the platform';
}

function render(counts, live) {
  const ds = state.decisions, { best, avoid, spare } = recommend(ds), src = SOURCES[state.source];
  const warn = state.flags.length > 0, hasInput = state.source !== 'none';
  const pattern = ds.map(d => d.light).join(''), aiCurrent = state.guide && state.guidePattern === pattern;
  const signText = aiCurrent ? state.guide.sign_en : ruleSign(ds);

  // Workflow strip
  $('f1').textContent = src.name;
  $('f1s').textContent = state.source === 'scenario' ? `${SCENARIOS[state.scenario].name} · simulated` : live ? `${state.modelReady ? `COCO-SSD person detection · ${counts.people} people seen` : 'detector not loaded'}` : state.source === 'manual' ? 'typed by the operator' : 'press ▶ Run demo';
  $('f2').textContent = hasInput ? `${ds.reduce((s, d) => s + d.queue, 0)} queuing` : '–';
  $('f2s').textContent = hasInput ? `On board ${ds.map(d => d.onboard).join(' · ')} (${ds[0]?.oSource})${warn ? ' · check flags' : ''}` : '';
  $('st2').classList.toggle('warn', warn);
  $('f3').textContent = hasInput ? ds.map(d => d.room).join(' · ') : '–';
  $('f3s').textContent = hasInput ? `spaces on the next train at ${ds.map(d => d.label).join(' · ')}` : '';
  $('f4').textContent = !hasInput ? '–' : best ? `Use ${best.label}` : 'All doors full';
  $('f4s').textContent = !hasInput ? '' : avoid.length ? `avoid ${list(avoid.map(d => d.label))}` : 'no doors to avoid';
  $('st4').classList.toggle('warn', warn);
  const nG = ds.filter(d => d.light === 'g').length, nY = ds.filter(d => d.light === 'y').length, nR = ds.filter(d => d.light === 'r').length;
  $('f5').textContent = hasInput ? `${nG} green · ${nY} amber · ${nR} red` : '–';
  $('f5s').textContent = hasInput ? (aiCurrent ? `announcement by ${state.guideBy}` : genai.enabled ? 'announcement pending' : 'rule-based sign · GenAI unavailable') : '';

  // Recommendation with its reasoning
  const rec = $('rec');
  if (!hasInput) { rec.className = 'rec none'; rec.innerHTML = '<p class="muted">Press ▶ Run demo to see a recommendation.</p>'; }
  else if (best) {
    rec.className = 'rec';
    rec.innerHTML = `<span class="lbl">Recommended door</span><b class="big">${best.label}</b>
      <p>${best.label} has room for <b>${best.room}</b> (capacity ${cfg.capacity} − ${best.onboard} on board + ${best.forecastOff} forecast getting off) and <b>${best.queue}</b> queuing, so <b>${spaces(spare(best))}</b> spare${best.light === 'y' ? ' (limited: no door has a green light)' : ''}.</p>
      ${avoid.length ? `<p class="small">Avoid ${list(avoid.map(d => `${d.label} (${d.queue} queuing for ${spaces(d.room)})`))}.</p>` : ''}
      <p class="small">Based on ${src.label.toLowerCase()}${warn ? ' · <b style="color:var(--caution)">check the flags below before relying on it</b>' : ''}.</p>`;
  } else {
    rec.className = 'rec none';
    rec.innerHTML = `<span class="lbl">Recommendation</span><b class="big">All doors full</b><p>Every door has more people queuing than space on the next train. Ask passengers to spread out and wait for the following train.</p>`;
  }
  $('flags').hidden = !warn;
  if (warn) $('flags').innerHTML = `<b>Check before relying on this recommendation:</b><ul>${state.flags.map(f => `<li>${escapeHtml(f)}</li>`).join('')}</ul>`;

  // Signs and lights
  const mid = (cfg.doors + 1) / 2;
  $('sign').innerHTML = ds.map(d => `<div class="tile" style="background:${LIGHT[d.light]}"><b>${d.label}</b><span class="arrow">${d.door < mid ? '←' : d.door > mid ? '→' : '↑'}</span><small>${best && d.door === best.door ? '★ Best' : WORD[d.light]}</small></div>`).join('');
  $('doorLights').innerHTML = ds.map(d => `<div class="door"><i style="background:${LIGHT[d.light]}" aria-label="${WORD[d.light]}"></i><span>${d.label}</span></div>`).join('');
  $('signText').textContent = hasInput ? signText : 'Waiting for input';
  $('signSource').textContent = aiCurrent ? `GenAI · ${state.guideBy}` : 'rule-based';
  $('signSource').className = 'badge ' + (aiCurrent ? 'real' : 'off');

  renderTable(live); renderTrain(counts, live); renderBeforeAfter();
}

function renderTable(live) {
  const ds = state.decisions;
  const row = (name, f) => `<tr><th scope="row">${name}</th>${ds.map(f).join('')}</tr>`;
  const lowAt = state.source === 'virtual' ? 0.4 : 0.55;
  const confCell = d => d.conf === null ? (live ? '–' : 'n/a') : `${(d.conf * 100).toFixed(0)}%${d.conf < lowAt ? ' ⚠' : ''}`;
  $('doorTable').innerHTML = `<thead><tr><th></th>${ds.map(d => `<th>${d.label}</th>`).join('')}</tr></thead><tbody>
    ${row('Queuing', d => `<td><b>${d.queue}</b><small>${d.qSource}</small></td>`)}
    ${row('Detection confidence', d => `<td>${confCell(d)}</td>`)}
    ${row('On board', d => `<td>${d.onboard}<small>${d.oSource}</small></td>`)}
    ${row('Forecast getting off', d => `<td>${d.forecastOff}<small>${(d.f.share * 100).toFixed(0)}% of riders</small></td>`)}
    ${row('Room (spaces)', d => `<td><b>${d.room}</b><small>${cfg.capacity} − ${d.onboard} + ${d.forecastOff}</small></td>`)}
    ${row('Ratio', d => `<td>${d.ratio.toFixed(2)}</td>`)}
    ${row('Light', d => `<td><span class="pill" style="background:${LIGHT[d.light]}">${WORD[d.light]}</span></td>`)}</tbody>`;
  $('capNote').textContent = `capacity ${cfg.capacity} per car (${cfg.preset === 'desk' ? 'desk demo scale' : 'real station scale'})`;
}

function renderBeforeAfter() {
  const ds = state.decisions;
  if (!ds.length || state.source === 'none') { $('bars').innerHTML = '<p class="muted">Appears once there is input.</p>'; $('baStats').textContent = ''; $('baNote').textContent = ''; return; }
  const before = ds.map(d => d.queue), after = afterGuidance(ds), max = Math.max(1, ...before, ...after, ...ds.map(d => d.room));
  const bar = (v, col) => `<div class="track"><div class="fill" style="width:${(v / max * 100).toFixed(1)}%;background:${col}"><span>${v}</span></div></div>`;
  $('bars').innerHTML = `<div class="barrow"><span></span><span class="lbl">Before</span><span class="lbl">After (estimate)</span></div>` +
    ds.map((d, i) => `<div class="barrow"><span>${d.label}</span>${bar(before[i], before[i] > d.room ? 'var(--stop)' : 'var(--muted)')}${bar(after[i], after[i] > d.room ? 'var(--stop)' : 'var(--accent)')}</div>`).join('');
  $('baStats').textContent = `Longest queue ${Math.max(...before)} → ${Math.max(...after)} · people beyond the space available ${over(before, ds)} → ${over(after, ds)} · spread (coefficient of variation) ${cv(before).toFixed(2)} → ${cv(after).toFixed(2)}`;
  $('baNote').textContent = `Estimate, not a measurement: assumes ${cfg.follow}% of people at red doors (and above 70% of the room at amber doors) follow the lights to doors with spare space. Change the share in Settings › Advanced. Bars turn red where the queue exceeds the room.`;
}

function renderTrain(counts, live) {
  const left = Math.max(0, Math.ceil((state.phaseEnds - Date.now()) / 1000));
  $('phase').textContent = { waiting: `Next train in ${left} s`, arriving: `Train arriving · doors open in ${left} s`, open: `Doors open · ${left} s` }[state.phase] || '';
  $('phase').dataset.phase = state.phase;
  const exits = vision.zones.filter(z => z.kind === 'exit').map(z => `${z.door}A ${counts.exits[z.door] ?? 0}`);
  $('exitCounts').textContent = state.phase === 'open' && live ? (exits.length ? 'Getting off (exit-line count): ' + exits.join(' · ') : 'No exit lines drawn, so people getting off are not counted.') : '';
  $('perf').textContent = live ? (state.modelReady ? `${counts.people} people detected · ${vision.lastMs.toFixed(0)} ms per frame${counts.mean ? ` · average confidence ${(counts.mean * 100).toFixed(0)}%` : ''}` : 'Detector not loaded.') : '';
}

function renderZoneList() {
  const z = vision.zones;
  $('zoneList').textContent = z.length ? z.map(a => a.kind === 'exit' ? `exit ${a.door}A` : a.kind === 'car' ? `car ${a.door}` : `queue ${a.door}A`).join(' · ') : 'No areas. Pick a type and drag on the image.';
}

function renderAI() {
  $('aiName').textContent = genai.enabled ? genai.name : 'unavailable';
  $('aiName').className = 'badge ' + (genai.enabled ? 'real' : 'off');
  $('aiAvail').textContent = state.aiStatus;
  $('guideNow').disabled = !genai.enabled; $('analyzeNow').disabled = !genai.enabled;
  const g = state.guide, current = g && state.guidePattern === state.decisions.map(d => d.light).join('');
  $('aiGuide').innerHTML = g ? `
    <p class="small">Written by ${escapeHtml(state.guideBy)} at ${state.guideAt.toLocaleTimeString()}${current ? '' : ' · <b style="color:var(--caution)">out of date: the lights have changed since</b>'}.</p>
    <div class="lang"><span>Sign</span><p>${escapeHtml(g.sign_en)}</p><p lang="zh-Hant">${escapeHtml(g.sign_zh_hant)}</p><p lang="zh-Hans">${escapeHtml(g.sign_zh_hans)}</p></div>
    <div class="lang"><span>Announcement</span><p>${escapeHtml(g.announcement_en)}</p><p lang="zh-Hant">${escapeHtml(g.announcement_zh_hant)}</p><p lang="zh-Hans">${escapeHtml(g.announcement_zh_hans)}</p></div>`
    : `<p class="muted">${genai.enabled ? 'An announcement is written when the lights change, or press Write announcement.' : 'No announcement: GenAI is unavailable. The tunnel sign uses rule-based text instead.'}</p>`;
  const c = state.ai;
  $('aiCount').innerHTML = c ? `<p><b>${c.people_total}</b> people · crowding <b>${c.crowding}</b> · ${c.areas.map(a => `${a.label}: ${a.people}`).join(' · ')}</p><p class="muted">${escapeHtml(c.notes)}</p>` : '';
}

function renderLearning() {
  const log = forecaster.log.slice(0, 12);
  $('learnTable').innerHTML = `<thead><tr><th>Time</th><th>Door</th><th>Forecast</th><th>Counted</th><th>From</th></tr></thead><tbody>${log.map(r =>
    `<tr><td>${r.time.toLocaleTimeString()}</td><td>${r.door}A</td><td>${r.forecast}</td><td>${r.actual}</td><td>${r.source === 'observed' ? 'exit line, real video' : 'exit line, simulated video'}</td></tr>`).join('') || '<tr><td colspan="5" class="muted">No trains counted yet. Exit lines on a camera or the virtual CCTV count people getting off when the doors open.</td></tr>'}</tbody>`;
  $('learnStats').textContent = `${forecaster.rows.length.toLocaleString()} history records (sample data) · ${forecaster.observedCount} trains counted from real video on this device`;
  $('learnBasis').textContent = state.decisions.map(d => `${d.label}: ${d.f.basis}, ${d.f.n} records, today’s correction ×${d.f.corr.toFixed(2)}`).join(' · ');
}

// ---------------- settings ----------------
function applySettingsForm() {
  $('setKey').value = apiKey; $('setRemember').checked = cfg.remember;
  $('setProvider').value = cfg.provider; $('setOllamaUrl').value = cfg.ollamaUrl; $('setOllamaModel').value = cfg.ollamaModel; showProviderFields();
  $('setPreset').value = cfg.preset; $('setDoors').value = cfg.doors; $('setHold').value = cfg.holdSec; $('setFollow').value = cfg.follow; $('setDetail').checked = cfg.detail;
}
function readSettingsForm() {
  apiKey = $('setKey').value.trim(); cfg.remember = $('setRemember').checked;
  cfg.provider = $('setProvider').value; cfg.ollamaUrl = $('setOllamaUrl').value.trim() || 'http://localhost:11434'; cfg.ollamaModel = $('setOllamaModel').value.trim() || 'qwen3-vl:2b-instruct';
  const preset = $('setPreset').value; if (preset !== cfg.preset) { cfg.preset = preset; Object.assign(cfg, PRESETS[preset]); newTrainFeed(); if (state.source === 'scenario') startScenario(state.scenario); }
  const doors = Math.min(8, Math.max(2, Math.round(+$('setDoors').value) || 4));
  if (doors !== cfg.doors) {
    cfg.doors = doors; engine.reset(); buildControls();
    if (state.source === 'virtual') startVirtual(); else { vision.defaultZones(doors); renderZoneList(); }
    if (state.source === 'scenario') startScenario(state.scenario); else if (state.source === 'manual') buildEntryPanel();
  }
  cfg.detail = $('setDetail').checked; vision.detail = cfg.detail;
  cfg.holdSec = Math.min(60, Math.max(0, +$('setHold').value || 0)); cfg.follow = Math.min(100, Math.max(0, Math.round(+$('setFollow').value) || 0));
  LS.set('pf-live-key', cfg.remember ? apiKey : '');
  save(); connectAI();
}
function connectAI() { genai.connect({ provider: cfg.provider, apiKey, ollamaUrl: cfg.ollamaUrl, ollamaModel: cfg.ollamaModel }); }
function showProviderFields() { const p = $('setProvider').value; $('claudeFields').hidden = p !== 'claude'; $('ollamaFields').hidden = p !== 'ollama'; }
function save() { const { capacity, queueMax, headway, dwell, ...rest } = cfg; LS.set('pf-live-cfg', rest); }

function escapeHtml(s) { return String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]); }

window.railflow = { state, vision, cfg };   // for checking from the browser console

init();
