// Alighting forecast: how many people will get off at each door of the next train.
//
// History rows store the SHARE of people on board who got off at a door (not a head count), so the
// same history works for a full-size train and for a desk demo. The forecast for a door is:
//   1. the average share for the same weekday and 15-minute slot over the most recent 2 weeks of history,
//      falling back to the same slot on any day, then to the door's overall average;
//   2. times a correction learned from today's trains (actual ÷ forecast, smoothed);
//   3. times the number of people on board that car right now.
// Every train the system counts is appended to the history and saved on this device, so the averages keep
// renewing: a train counted on Thursday at 09:00 is part of the forecast for the next two Thursdays at 09:00.
// Counts from real video and from the virtual CCTV are saved in separate stores and labelled, so simulated
// learning can be cleared without touching real counts. A real deployment would keep this in a station database.

const STORE = { observed: 'pf-history-observed-v1', simulated: 'pf-history-simulated-v1' };
const WINDOW_DAYS = 14;
const SLOT = 15;

export class Forecaster {
  constructor() {
    this.rows = [];          // {date:'YYYY-MM-DD', weekday:0-6 (Mon=0), slot:min, door:1.., share, source}
    this.correction = {};    // door -> learned multiplier for today
    this.log = [];           // recent trains: {time, door, forecast, actual}
  }

  async load(url) {
    const text = await (await fetch(url)).text();
    const lines = text.trim().split('\n').slice(1);
    for (const l of lines) {
      const [date, weekday, slot, door, share, source] = l.split(',');
      this.rows.push({ date, weekday: +weekday, slot: +slot, door: +door, share: +share, source });
    }
    for (const src of Object.keys(STORE)) for (const r of readStore(src)) this.rows.push({ ...r, source: src });
    return this.rows.length;
  }

  get observedCount() { return this.rows.filter(r => r.source === 'observed').length; }
  get simulatedCount() { return this.rows.filter(r => r.source === 'simulated').length; }

  // What the history holds for one door at this weekday and 15-minute slot (±15 min), by source
  slotStats(door, when = new Date()) {
    const weekday = (when.getDay() + 6) % 7, slot = Math.floor((when.getHours() * 60 + when.getMinutes()) / SLOT) * SLOT;
    const rows = this.rows.filter(r => r.door === door && r.weekday === weekday && Math.abs(r.slot - slot) <= SLOT);
    const by = { sample: 0, observed: 0, simulated: 0 };
    for (const r of rows) by[r.source] = (by[r.source] ?? 0) + 1;
    return { weekday, slot, ...by, dates: [...new Set(rows.map(r => r.date))].sort() };
  }

  // Share of riders expected to get off at `door` for a train at `when`, with how it was derived
  // `only` limits the history to some sources, e.g. ['sample'] for the virtual CCTV's simulated "truth"
  share(door, when = new Date(), only = null) {
    const weekday = (when.getDay() + 6) % 7, slot = Math.floor((when.getHours() * 60 + when.getMinutes()) / SLOT) * SLOT;
    const latest = this.rows.reduce((m, r) => r.date > m ? r.date : m, '0000');
    const cutoff = shiftDate(latest, -WINDOW_DAYS);
    const all = only ? this.rows.filter(r => only.includes(r.source)) : this.rows;
    const recent = all.filter(r => r.door === door && r.date > cutoff);
    const pick = (rows) => rows.length ? rows.reduce((s, r) => s + r.share, 0) / rows.length : null;
    let basis = 'same weekday & time, last 2 weeks';
    let rows = recent.filter(r => r.weekday === weekday && Math.abs(r.slot - slot) <= SLOT);
    let s = pick(rows);
    if (s === null) { basis = 'same time, any day, last 2 weeks'; rows = recent.filter(r => Math.abs(r.slot - slot) <= SLOT); s = pick(rows); }
    if (s === null) { basis = 'door average'; rows = all.filter(r => r.door === door); s = pick(rows) ?? 0.2; }
    const corr = only ? 1 : this.correction[door] ?? 1;
    return { share: Math.min(0.95, s * corr), base: s, corr, n: rows.length, basis };
  }

  // People expected to get off, given how many are on board that car now
  alighting(door, onboard, when = new Date()) {
    const f = this.share(door, when);
    return { count: Math.round(f.share * onboard), ...f };
  }

  // Record what really happened at one door of one train; updates today's correction and the history
  // `source` is 'observed' (real video) or 'simulated' (virtual CCTV); both are saved on this device, separately
  observe(door, onboard, actual, forecastCount, when = new Date(), source = 'observed') {
    if (onboard <= 0) return;
    const share = Math.min(1, actual / onboard);
    const row = { date: isoDate(when), weekday: (when.getDay() + 6) % 7, slot: Math.floor((when.getHours() * 60 + when.getMinutes()) / SLOT) * SLOT, door, share: +share.toFixed(3), source };
    this.rows.push(row);
    if (STORE[source]) { const saved = readStore(source); saved.push(row); writeStore(source, saved); }
    if (forecastCount > 0) {
      const ratio = Math.max(0.3, Math.min(3, actual / forecastCount));
      this.correction[door] = (this.correction[door] ?? 1) * 0.7 + ratio * 0.3;
    }
    this.log.unshift({ time: when, door, forecast: forecastCount, actual, source });
    this.log.length = Math.min(this.log.length, 40);
  }

  clearObserved() { for (const src of Object.keys(STORE)) writeStore(src, []); this.rows = this.rows.filter(r => r.source === 'sample'); this.correction = {}; this.log = []; }
}

function isoDate(d) { return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; }
function shiftDate(iso, days) { const d = new Date(iso + 'T00:00:00'); d.setDate(d.getDate() + days); return isoDate(d); }
function readStore(src) { try { return JSON.parse(localStorage.getItem(STORE[src]) || '[]'); } catch { return []; } }
function writeStore(src, rows) { try { localStorage.setItem(STORE[src], JSON.stringify(rows.slice(-20000))); } catch { /* storage full or blocked: history stays in memory */ } }
