// Platform Flow Live: wires the camera AI, generative AI (Claude or a local Ollama model), the forecast and the decision engine together
// and drives the on-screen signs. Everything runs in the browser.

import { Vision } from './vision.js';
import { Forecaster } from './forecast.js';
import { DecisionEngine } from './decision.js';
import { GenAI, describeError } from './genai.js';
import { VirtualCam } from './virtualcam.js';

const $ = id => document.getElementById(id);
const LS = { get: (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } },
             set: (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* storage blocked */ } } };

const PRESETS = {
  desk:    { capacity: 6,   queueMax: 5,  headway: 60,  dwell: 15, label: 'Desk demo (small numbers for a webcam test)' },
  station: { capacity: 230, queueMax: 63, headway: 120, dwell: 25, label: 'Real station (230 per car)' },
};

const cfg = Object.assign({ preset: 'desk', doors: 4, holdSec: 4, aiEvery: 15, provider: 'ollama', model: 'claude-opus-5-5', ollamaUrl: 'http://localhost:11434', ollamaModel: 'qwen3-vl:2b-instruct', remember: false, auto: true },
  LS.get('pf-live-cfg', {}));
Object.assign(cfg, PRESETS[cfg.preset], LS.get('pf-live-cfg', {}));
let apiKey = cfg.remember ? (LS.get('pf-live-key', '') || '') : '';

const vision = new Vision($('media'), $('overlay'));
const forecaster = new Forecaster();
const engine = new DecisionEngine();
const genai = new GenAI();

const state = {
  source: 'none',            // camera | video | image | manual
  manualQueue: {}, feedOnboard: {}, onboardSnapshot: {}, forecastSnapshot: {},
  claude: null, claudeAt: 0, claudeMs: 0,
  phase: 'waiting', phaseEnds: Date.now() + cfg.headway * 1000, trains: 0,
  decisions: [], lastPattern: '', lastGuideAt: 0, guide: null,
};

// ---------------- setup ----------------
async function init() {
  $('status').textContent = 'Loading history and the people-detection model…';
  const n = await forecaster.load('data/history-sample.csv');
  newTrainFeed();
  try { await vision.loadModel(); $('status').textContent = `Ready. ${n.toLocaleString()} history records loaded. Start a camera, or use manual counts.`; }
  catch (e) { $('status').textContent = 'The people-detection model could not load (needs internet). Manual counts still work.'; }
  vision.defaultZones(cfg.doors);
  connectAI();
  vision.onZonesChanged = renderZoneList;
  buildControls(); renderZoneList(); renderGenAI(); applySettingsForm();
  loop(); setInterval(tickTrain, 250); setInterval(claudeLoop, 1000);
}

function buildControls() {
  $('srcCamera').onclick = startCamera;
  $('srcFile').onchange = e => { const f = e.target.files[0]; if (f) useFile(f); e.target.value = ''; };
  $('srcSample').onclick = startVirtual;
  $('srcManual').onclick = () => setSource('manual');
  $('tool').onchange = $('toolDoor').onchange = () => { vision.tool = { kind: $('tool').value, door: +$('toolDoor').value }; };
  $('resetZones').onclick = () => { if (state.vcam && state.source === 'virtual') vision.zones = state.vcam.zones(); else vision.defaultZones(cfg.doors); renderZoneList(); };
  $('clearZones').onclick = () => { vision.zones = []; renderZoneList(); };
  $('btnArrive').onclick = () => setPhase('arriving');
  $('btnOpen').onclick = () => setPhase('open');
  $('btnClose').onclick = () => setPhase('closed');
  $('auto').onchange = e => { cfg.auto = e.target.checked; save(); };
  $('analyzeNow').onclick = () => runClaudeCount(true);
  $('guideNow').onclick = () => runGuidance(true);
  $('clearLearned').onclick = () => { forecaster.clearObserved(); renderLearning(); };
  $('openSettings').onclick = () => { applySettingsForm(); $('settings').showModal(); };
  $('settingsForm').onsubmit = e => { e.preventDefault(); readSettingsForm(); $('settings').close(); };
  $('cancelSettings').onclick = () => $('settings').close();
  $('setProvider').onchange = showProviderFields;
  $('forgetKey').onclick = () => { apiKey = ''; LS.set('pf-live-key', ''); $('setKey').value = ''; connectAI(); renderGenAI(); };
  for (const sel of [$('toolDoor')]) sel.innerHTML = Array.from({ length: cfg.doors }, (_, i) => `<option value="${i + 1}">${i + 1}</option>`).join('');
  $('auto').checked = cfg.auto;
}

async function startCamera() {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false });
    const v = ensureVideo(); v.srcObject = stream; await v.play(); setSource('camera');
  } catch (e) { $('status').textContent = 'Camera blocked or not found. Allow camera access in the browser, or upload a video.'; }
}

function useFile(file) {
  const url = URL.createObjectURL(file);
  if (file.type.startsWith('image/')) return useImage(url, 'image');
  const v = ensureVideo(); v.srcObject = null; v.src = url; v.loop = true; v.muted = true; v.play(); setSource('video');
}

function useImage(url, kind) {
  const img = document.createElement('img'); img.id = 'media'; img.alt = 'Camera frame';
  if (/^https?:/.test(url)) img.crossOrigin = 'anonymous';   // lets the detector read pixels from another site
  img.src = url;
  swapMedia(img); img.onload = () => setSource(kind === 'sample' ? 'image' : kind);
}

function ensureVideo() {
  if (vision.media.tagName === 'VIDEO') return vision.media;
  const v = document.createElement('video'); v.id = 'media'; v.playsInline = true; v.muted = true; swapMedia(v); return v;
}
function swapMedia(el) {
  const old = vision.media; if (old.srcObject) old.srcObject.getTracks().forEach(t => t.stop());
  if (state.vcam && el !== state.vcam.canvas) { state.vcam.stop(); state.vcam = null; vision.minScore = 0.45; }
  el.id = 'media'; old.replaceWith(el); vision.media = el;
}

// Virtual CCTV: a live 3D platform filmed from a wall camera, for testing without a real camera
function startVirtual() {
  if (state.vcam && state.vcam.doors !== cfg.doors) { state.vcam.stop(); state.vcam = null; }
  if (!state.vcam) {
    state.vcam = new VirtualCam(() => {
      const map = f => Object.fromEntries(state.decisions.map(d => [d.door, f(d)]));
      return { phase: state.phase, lights: map(d => d.light), onboard: map(d => d.onboard), forecastOff: map(d => d.forecastOff), capacity: cfg.capacity };
    }, cfg.doors);
    state.vcam.canvas.setAttribute('aria-label', 'Virtual CCTV view of the platform');
  }
  swapMedia(state.vcam.canvas); state.vcam.start(); window.vcam = state.vcam;   // handy for checking from the console
  vision.minScore = 0.25;                      // 3D figures score lower than real people
  vision.zones = state.vcam.zones(); renderZoneList();
  setSource('virtual');
}

function setSource(s) {
  state.source = s;
  $('manualPanel').hidden = s !== 'manual';
  if (s === 'manual') buildManualPanel();
  $('camEmpty').hidden = s !== 'none' && s !== 'manual';
  $('camEmpty').textContent = s === 'manual' ? 'Manual counts: type queue numbers in the table below.' : 'No camera yet';
  $('status').textContent = { camera: 'Webcam running. Stand in the queue areas to test.', video: 'Playing the uploaded video.', image: 'Using a still frame.', virtual: 'Virtual CCTV running: a 3D platform filmed from a wall camera. The camera AI counts it like a real feed.', manual: 'Manual mode: edit the queue numbers in the door table.' }[s] || '';
}

// ---------------- main loop: camera → counts → decision → lights ----------------
async function loop() {
  let counts = { queue: {}, car: {}, exits: {}, people: 0 };
  if (state.source !== 'manual' && state.source !== 'none') {
    try { counts = (await vision.step()) || counts; } catch (e) { /* frame not ready */ }
  }
  vision.draw();
  update(counts);
  setTimeout(loop, state.source === 'none' || state.source === 'manual' ? 400 : 120);
}

function claudeFresh() { return state.claude && Date.now() - state.claudeAt < cfg.aiEvery * 2000; }
function claudeCount(label) { return claudeFresh() ? state.claude.areas.find(a => a.label === label)?.people : undefined; }

function update(counts) {
  const doors = [];
  for (let d = 1; d <= cfg.doors; d++) {
    const det = state.source === 'manual' ? (state.manualQueue[d] ?? 0) : (counts.queue[d] ?? 0);
    // Claude's count backs up the detector in dense crowds; a small local model's count is shown but not used
    const cq = claudeCount(`QUEUE ${d}A`), trustAI = genai.provider === 'claude';
    const queue = cq === undefined || !trustAI ? det : Math.max(det, cq);
    const hasCarZone = vision.zones.some(z => z.kind === 'car' && z.door === d) && state.source !== 'manual';
    const carCam = hasCarZone ? Math.max(counts.car[d] ?? 0, trustAI ? claudeCount(`CAR ${d}`) ?? 0 : 0) : null;
    const onboard = state.phase === 'open' || state.phase === 'closed' ? (state.onboardSnapshot[d] ?? 0) : (carCam ?? state.feedOnboard[d] ?? 0);
    const f = forecaster.alighting(d, onboard);
    doors.push({ door: d, label: `${d}A`, queue, queueDetector: det, queueClaude: cq, onboard, onboardSource: carCam !== null ? 'car camera' : 'train data', forecastOff: f.count, f, exits: counts.exits[d] ?? 0 });
  }
  state.decisions = engine.decide(doors, cfg);
  renderLights(); renderTable(); renderTrain(counts);
  const pattern = state.decisions.map(d => d.light).join('');
  if (pattern !== state.lastPattern) { state.lastPattern = pattern; maybeGuide(); }
}

// ---------------- train cycle ----------------
function newTrainFeed() {
  // Stand-in for MTR's train data feed (car load sensors): people on board each car of the next train
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
    vision.counting = false;
    recordTrain();
    state.phase = 'waiting'; state.phaseEnds = now + cfg.headway * 1000; state.trains++;
    newTrainFeed();
  }
}

function tickTrain() {
  if (!cfg.auto || Date.now() < state.phaseEnds) return;
  setPhase(state.phase === 'waiting' ? 'arriving' : state.phase === 'arriving' ? 'open' : 'closed');
}

// After the doors close: store what actually happened so the forecast learns
function recordTrain() {
  const when = new Date();
  for (let d = 1; d <= cfg.doors; d++) {
    const onboard = state.onboardSnapshot[d] ?? 0, fc = state.forecastSnapshot[d] ?? 0;
    const hasExit = vision.zones.some(z => z.kind === 'exit' && z.door === d) && state.source !== 'manual' && state.source !== 'none';
    if (hasExit) forecaster.observe(d, onboard, vision.exits[d] ?? 0, fc, when, 'observed');
    else if ($('simAlight').checked) {
      // No exit camera on this door: generate a test outcome around the forecast (kept in memory, never saved)
      const actual = Math.max(0, Math.round(fc * (0.7 + 0.6 * Math.random()) + (Math.random() < 0.3 ? 1 : 0)));
      forecaster.observe(d, onboard, Math.min(onboard, actual), fc, when, 'simulated');
    }
    if (state.source === 'manual') state.manualQueue[d] = Math.max(0, (state.manualQueue[d] ?? 0) - Math.max(0, cfg.capacity - onboard + fc));
  }
  if (state.source === 'manual') buildManualPanel();
  renderLearning();
}

// ---------------- Generative AI (Claude or Ollama) ----------------
function claudeLoop() {
  if (!genai.enabled || genai.busy.count || state.source === 'manual' || state.source === 'none') return;
  if (Date.now() - state.claudeAt >= cfg.aiEvery * 1000) runClaudeCount(false);
}

async function runClaudeCount(manual) {
  if (!genai.enabled) { if (manual) { $('settings').showModal(); } return; }
  if (genai.busy.count) return;
  const frame = vision.frameJPEG(1024);
  if (!frame || !frame.labels.length) { $('aiStatus').textContent = 'Start a camera or video and draw at least one queue or car area first.'; return; }
  genai.busy.count = true; state.claudeAt = Date.now(); $('aiStatus').textContent = `${genai.name} is counting the frame…`;
  const t0 = performance.now();
  try {
    state.claude = await genai.countCrowd(frame.data, frame.labels);
    state.claudeAt = Date.now(); state.claudeMs = performance.now() - t0;
    $('aiStatus').textContent = `Counted in ${(state.claudeMs / 1000).toFixed(1)} s.`;
  } catch (e) { $('aiStatus').textContent = describeError(e); }
  genai.busy.count = false; renderGenAI();
}

function maybeGuide() { if (genai.enabled && Date.now() - state.lastGuideAt > 20000) runGuidance(false); }

async function runGuidance(manual) {
  if (!genai.enabled) { if (manual) $('settings').showModal(); return; }
  if (genai.busy.guide) return;
  genai.busy.guide = true; state.lastGuideAt = Date.now(); $('guideStatus').textContent = `${genai.name} is writing guidance…`;
  // The decision is already made by the rules; the model only has to put it into words
  const by = c => state.decisions.filter(d => d.light === c).map(d => d.label);
  const input = { station: 'Admiralty', time: new Date().toLocaleTimeString('en-HK', { hour: '2-digit', minute: '2-digit' }),
    walk_to_doors: by('g'), limited_space_doors: by('y'), full_doors_avoid: by('r'),
    details: state.decisions.map(d => ({ door: d.label, light: { g: 'green', y: 'amber', r: 'red' }[d.light], people_queuing: d.queue, space_on_next_train: d.room })) };
  try { state.guide = await genai.writeGuidance(input); state.guideAt = new Date(); $('guideStatus').textContent = 'Updated ' + state.guideAt.toLocaleTimeString(); }
  catch (e) { $('guideStatus').textContent = describeError(e); }
  genai.busy.guide = false; renderGenAI();
}

// ---------------- rendering ----------------
const LIGHT = { g: 'var(--go)', y: 'var(--caution)', r: 'var(--stop)' };
const WORD = { g: 'Room', y: 'Limited', r: 'Full' };

function renderLights() {
  const ds = state.decisions, mid = (cfg.doors + 1) / 2;
  const best = ds.filter(d => d.light === 'g').sort((a, b) => (b.room - b.queue) - (a.room - a.queue))[0]?.door;
  $('sign').innerHTML = ds.map(d => `<div class="tile" style="background:${LIGHT[d.light]}"><b>${d.label}</b><span class="arrow">${d.door < mid ? '←' : d.door > mid ? '→' : '↑'}</span><small>${d.door === best ? '★ Best' : WORD[d.light]}</small></div>`).join('');
  $('doorLights').innerHTML = ds.map(d => `<div class="door"><i style="background:${LIGHT[d.light]}" aria-label="${WORD[d.light]}"></i><span>${d.label}</span></div>`).join('');
}

function renderTable() {
  const ds = state.decisions, manual = state.source === 'manual';
  const row = (name, f) => `<tr><th scope="row">${name}</th>${ds.map(f).join('')}</tr>`;
  $('doorTable').innerHTML = `<thead><tr><th></th>${ds.map(d => `<th>${d.label}</th>`).join('')}</tr></thead><tbody>
    ${row('Queue (fused)', d => `<td><b>${d.queue}</b></td>`)}
    ${row('· camera detector', d => `<td>${manual ? '–' : d.queueDetector}</td>`)}
    ${row(genai.provider === 'claude' ? '· GenAI vision' : '· GenAI vision (shown only)', d => `<td>${d.queueClaude ?? '–'}</td>`)}
    ${row('On board', d => `<td>${d.onboard}<small>${d.onboardSource}</small></td>`)}
    ${row('Forecast getting off', d => `<td>${d.forecastOff}<small>${(d.f.share * 100).toFixed(0)}% of riders</small></td>`)}
    ${row('Predicted room', d => `<td>${d.room}</td>`)}
    ${row('Ratio', d => `<td>${d.ratio.toFixed(2)}</td>`)}
    ${row('Light', d => `<td><span class="pill" style="background:${LIGHT[d.light]}">${WORD[d.light]}</span></td>`)}</tbody>`;
}

// Manual mode: one number box per door, built once so typing isn't interrupted by the refresh
function buildManualPanel() {
  $('manualInputs').innerHTML = Array.from({ length: cfg.doors }, (_, i) => `<label>${i + 1}A <input type="number" min="0" max="999" value="${state.manualQueue[i + 1] ?? 0}" data-door="${i + 1}" id="mq${i + 1}"></label>`).join('');
  for (const inp of $('manualInputs').querySelectorAll('input')) inp.oninput = e => { state.manualQueue[+e.target.dataset.door] = Math.max(0, +e.target.value || 0); };
}

function renderTrain(counts) {
  const left = Math.max(0, Math.ceil((state.phaseEnds - Date.now()) / 1000));
  const txt = { waiting: `Next train in ${left} s`, arriving: `Train arriving · doors open in ${left} s`, open: `Doors open · counting people getting off · ${left} s` }[state.phase] || '';
  $('phase').textContent = txt;
  $('phase').dataset.phase = state.phase;
  $('exitCounts').textContent = state.phase === 'open' ? 'Exit lines: ' + (Object.entries(counts.exits).map(([d, n]) => `${d}A ${n}`).join(' · ') || 'none drawn') : '';
  $('perf').textContent = vision.model && state.source !== 'manual' && state.source !== 'none' ? `${counts.people} people seen · detector ${vision.lastMs.toFixed(0)} ms/frame` : '';
}

function renderZoneList() {
  const z = vision.zones;
  $('zoneList').textContent = z.length ? z.map(a => a.kind === 'exit' ? `exit ${a.door}A` : a.kind === 'car' ? `car ${a.door}` : `queue ${a.door}A`).join(' · ') : 'No areas. Pick a tool and drag on the image.';
}

function renderGenAI() {
  $('aiOff').hidden = genai.enabled; $('aiOn').hidden = !genai.enabled; $('aiName').textContent = genai.enabled ? genai.name : 'off';
  const c = state.claude;
  $('aiCount').innerHTML = c ? `<p><b>${c.people_total}</b> people · crowding <b>${c.crowding}</b> · ${c.areas.map(a => `${a.label}: ${a.people}`).join(' · ')}</p><p class="muted">${escapeHtml(c.notes)}</p>` : '<p class="muted">No frame analysed yet.</p>';
  const g = state.guide;
  $('aiGuide').innerHTML = g ? `
    <div class="lang"><span>Sign</span><p>${escapeHtml(g.sign_en)}</p><p lang="zh-Hant">${escapeHtml(g.sign_zh_hant)}</p><p lang="zh-Hans">${escapeHtml(g.sign_zh_hans)}</p></div>
    <div class="lang"><span>Announcement</span><p>${escapeHtml(g.announcement_en)}</p><p lang="zh-Hant">${escapeHtml(g.announcement_zh_hant)}</p><p lang="zh-Hans">${escapeHtml(g.announcement_zh_hans)}</p></div>
    <div class="lang"><span>Staff note</span><p>${escapeHtml(g.staff_note)}</p></div>` : '<p class="muted">Guidance appears when the lights change, or press Write now.</p>';
  $('signText').textContent = g?.sign_en || 'Follow the green lights for doors with room';
}

function renderLearning() {
  const log = forecaster.log.slice(0, 12);
  $('learnTable').innerHTML = `<thead><tr><th>Time</th><th>Door</th><th>Forecast</th><th>Actual</th><th>Source</th></tr></thead><tbody>${log.map(r =>
    `<tr><td>${r.time.toLocaleTimeString()}</td><td>${r.door}A</td><td>${r.forecast}</td><td>${r.actual}</td><td>${r.source === 'observed' ? 'exit camera' : 'test data'}</td></tr>`).join('') || '<tr><td colspan="5" class="muted">No trains recorded yet. Draw an exit line, or turn on test outcomes, then let a train run.</td></tr>'}</tbody>`;
  $('learnStats').textContent = `${forecaster.rows.length.toLocaleString()} history records · ${forecaster.observedCount} counted by the camera on this device`;
  const basis = state.decisions.map(d => `${d.label}: ${d.f.basis}, ${d.f.n} records, correction ×${d.f.corr.toFixed(2)}`);
  $('learnBasis').textContent = basis.join(' · ');
}
setInterval(renderLearning, 3000);

// ---------------- settings ----------------
function applySettingsForm() {
  $('setKey').value = apiKey; $('setRemember').checked = cfg.remember; $('setModel').value = cfg.model;
  $('setProvider').value = cfg.provider; $('setOllamaUrl').value = cfg.ollamaUrl; $('setOllamaModel').value = cfg.ollamaModel; showProviderFields();
  $('setPreset').value = cfg.preset; $('setDoors').value = cfg.doors; $('setEvery').value = cfg.aiEvery; $('setHold').value = cfg.holdSec;
}
function readSettingsForm() {
  apiKey = $('setKey').value.trim(); cfg.remember = $('setRemember').checked; cfg.model = $('setModel').value.trim() || 'claude-opus-5-5';
  cfg.provider = $('setProvider').value; cfg.ollamaUrl = $('setOllamaUrl').value.trim() || 'http://localhost:11434'; cfg.ollamaModel = $('setOllamaModel').value.trim() || 'qwen3-vl:2b-instruct';
  const preset = $('setPreset').value; if (preset !== cfg.preset) { cfg.preset = preset; Object.assign(cfg, PRESETS[preset]); newTrainFeed(); }
  const doors = Math.min(8, Math.max(2, +$('setDoors').value || 4)); if (doors !== cfg.doors) { cfg.doors = doors; vision.defaultZones(doors); engine.reset(); buildControls(); renderZoneList(); if (state.source === 'manual') buildManualPanel(); }
  cfg.aiEvery = Math.max(5, +$('setEvery').value || 15); cfg.holdSec = Math.max(0, +$('setHold').value || 0);
  LS.set('pf-live-key', cfg.remember ? apiKey : '');
  save(); connectAI(); renderGenAI();
}
function connectAI() { genai.connect({ provider: cfg.provider, apiKey, model: cfg.model, ollamaUrl: cfg.ollamaUrl, ollamaModel: cfg.ollamaModel }); }
function showProviderFields() { const o = $('setProvider').value === 'ollama'; $('claudeFields').hidden = o; $('ollamaFields').hidden = !o; }
function save() { const { capacity, queueMax, headway, dwell, label, ...rest } = cfg; LS.set('pf-live-cfg', rest); }

function escapeHtml(s) { return String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]); }

init();
