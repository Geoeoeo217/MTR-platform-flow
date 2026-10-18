// Decision engine: turns counts and forecasts into a light colour for every door.
//   room  = car capacity − people on board + people forecast to get off
//   ratio = people queuing at the door ÷ room
//   green under 0.7, amber under 1.0, red otherwise; red at once if the queue area itself is over-full.
// A light only relaxes (red→amber→green) after the new colour has held for `holdSec`, so signs don't flicker.

export const COLORS = { g: 'green', y: 'amber', r: 'red' };

export class DecisionEngine {
  constructor() { this.state = {}; }

  decide(doors, cfg, now = Date.now()) {
    return doors.map(d => {
      const room = Math.max(0, cfg.capacity - d.onboard + d.forecastOff);
      const ratio = d.queue / Math.max(1, room);
      let want = (d.queue >= cfg.queueMax || ratio >= 1) ? 'r' : ratio >= 0.7 ? 'y' : 'g';
      const s = this.state[d.door] ?? (this.state[d.door] = { shown: want, pending: want, since: now });
      if (want !== s.pending) { s.pending = want; s.since = now; }
      const worse = rank(want) > rank(s.shown);
      if (worse || now - s.since >= cfg.holdSec * 1000) s.shown = s.pending;
      return { ...d, room, ratio, light: s.shown, wanted: want, reason: explain(d, room, ratio, s.shown, cfg) };
    });
  }

  reset() { this.state = {}; }
}

const rank = c => ({ g: 0, y: 1, r: 2 })[c];

function explain(d, room, ratio, light, cfg) {
  if (d.queue >= cfg.queueMax) return `queue area full (${d.queue} ≥ ${cfg.queueMax})`;
  return `${d.queue} queuing for room ${room} → ratio ${ratio.toFixed(2)}`;
}
