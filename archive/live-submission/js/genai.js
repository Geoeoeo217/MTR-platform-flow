// Generative AI in two roles, using either Claude (API key) or a free local model through Ollama:
//   1. Crowd analyst: looks at a camera frame (with the counting areas drawn on it) and counts people per area.
//      This backs up the on-device detector, which undercounts when people stand close together.
//   2. Communicator: turns the current decision into sign text and a short announcement in three languages.
// Claude runs from the browser with the user's own API key; Ollama runs entirely on this computer.

import Anthropic from 'https://cdn.jsdelivr.net/npm/@anthropic-ai/sdk@0.131.0/+esm';

const FALLBACK_BETA = 'server-side-fallback-2026-07-01';

const COUNT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['areas', 'people_total', 'crowding', 'notes'],
  properties: {
    areas: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false,
        required: ['label', 'people'],
        properties: { label: { type: 'string' }, people: { type: 'integer' } },
      },
    },
    people_total: { type: 'integer' },
    crowding: { type: 'string', enum: ['empty', 'light', 'moderate', 'heavy', 'crush'] },
    notes: { type: 'string' },
  },
};

const GUIDE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['sign_en', 'sign_zh_hant', 'sign_zh_hans', 'announcement_en', 'announcement_zh_hant', 'announcement_zh_hans'],
  properties: {
    sign_en: { type: 'string' }, sign_zh_hant: { type: 'string' }, sign_zh_hans: { type: 'string' },
    announcement_en: { type: 'string' }, announcement_zh_hant: { type: 'string' }, announcement_zh_hans: { type: 'string' },
  },
};

const COUNT_SYSTEM = `You count people in CCTV frames from a metro platform. Coloured rectangles labelled "QUEUE nA" mark the queue area of platform door n; rectangles labelled "CAR n" mark the inside of train car n. Count every person whose feet are inside each queue area, and every person inside each car area, including people who are partly hidden behind others. Count real people only, not posters or reflections. If an area is not visible, give 0 and say so in notes. Keep notes to one short sentence.`;

const GUIDE_SYSTEM = `You write passenger guidance for MTR platform signs and announcements in Hong Kong. The input already says which doors to send people to (walk_to_doors), which have limited space, and which are full (full_doors_avoid). Do not change that decision; only put it into words. "Space" means space on the train, never a room.
Fields:
- sign_en: English, at most 60 characters, naming the walk_to_doors. Template: "More space at doors <walk_to_doors> →"
- sign_zh_hant: the same line in Traditional Chinese for Hong Kong. Template: 「<walk_to_doors>車門較多空位」
- sign_zh_hans: the same line in Simplified Chinese. Template: “<walk_to_doors>车门较多空位”
- announcement_en: one or two calm, polite sentences in English, MTR style, asking passengers to use the walk_to_doors and avoid the full doors.
- announcement_zh_hant: that announcement in Traditional Chinese (Hong Kong).
- announcement_zh_hans: that announcement in Simplified Chinese.
Replace <walk_to_doors> with the actual doors from the input. Use door labels exactly as given. If walk_to_doors is empty, ask passengers to spread along the platform. Never tell people to run or rush.`;

export class GenAI {
  constructor() {
    this.provider = 'claude'; this.client = null; this.model = 'claude-opus-5-5';
    this.ollamaUrl = 'http://localhost:11434'; this.ollamaModel = 'qwen3-vl:2b-instruct';
    this.busy = { count: false, guide: false };
  }

  // provider 'claude' needs an API key; provider 'ollama' runs a free local model on this computer
  connect({ provider, apiKey, model, ollamaUrl, ollamaModel }) {
    this.provider = provider || 'claude';
    this.client = this.provider === 'claude' && apiKey ? new Anthropic({ apiKey, dangerouslyAllowBrowser: true }) : null;
    if (model) this.model = model;
    if (ollamaUrl) this.ollamaUrl = ollamaUrl.replace(/\/+$/, '');
    if (ollamaModel) this.ollamaModel = ollamaModel;
  }

  get enabled() { return this.provider === 'ollama' ? this.ollamaOk === true : this.provider === 'claude' && !!this.client; }

  // Is the chosen model actually usable right now? Returns a sentence for the status line.
  async check() {
    if (this.provider === 'off') return 'GenAI is off.';
    if (this.provider === 'claude') return this.client ? 'Claude: key set (checked on first use).' : 'Claude: add an API key in Settings.';
    this.ollamaOk = false;
    try {
      const ctl = new AbortController(); const timer = setTimeout(() => ctl.abort(), 2500);
      const res = await fetch(`${this.ollamaUrl}/api/tags`, { signal: ctl.signal }); clearTimeout(timer);
      const names = ((await res.json()).models || []).map(m => m.name);
      if (!names.includes(this.ollamaModel)) return `Ollama is running but doesn’t have ${this.ollamaModel}. Run: ollama pull ${this.ollamaModel}`;
      this.ollamaOk = true; return `Ollama ready (${this.ollamaModel}).`;
    } catch {
      const online = !/^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname);
      return `Ollama not reachable at ${this.ollamaUrl}. ` + (online
        ? 'If Ollama is running on this computer, this website still needs permission to use it: open the page from localhost instead, or allow this site (README › Using Ollama). Or choose Claude in Settings.'
        : 'Start the Ollama app on this computer, or choose Claude in Settings.');
    }
  }
  get name() { return this.provider === 'ollama' ? `Ollama · ${this.ollamaModel}` : this.provider === 'claude' ? 'Claude' : 'GenAI (off)'; }

  async countCrowd(jpegB64, labels) {
    const prompt = `Areas to count: ${labels.join(', ')}. Return one entry per area, using these exact labels.`;
    if (this.provider === 'ollama') return this._ollama(COUNT_SYSTEM, prompt, [jpegB64], COUNT_SCHEMA);
    return this._json(COUNT_SYSTEM, [
      { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: jpegB64 } },
      { type: 'text', text: prompt },
    ], COUNT_SCHEMA, 'low');
  }

  async writeGuidance(state) {
    if (this.provider === 'ollama') return this._ollama(GUIDE_SYSTEM, JSON.stringify(state), [], GUIDE_SCHEMA);
    return this._json(GUIDE_SYSTEM, [{ type: 'text', text: JSON.stringify(state) }], GUIDE_SCHEMA, 'low');
  }

  // Ollama's chat API, with the same JSON schema so the answer has the same shape as Claude's
  async _ollama(system, text, images, schema) {
    let res;
    try {
      res = await fetch(`${this.ollamaUrl}/api/chat`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: this.ollamaModel, stream: false, format: schema, options: { temperature: 0 },
          messages: [{ role: 'system', content: system }, { role: 'user', content: text, ...(images.length ? { images } : {}) }],
        }),
      });
    } catch {
      throw new Error(`Can’t reach Ollama at ${this.ollamaUrl}. Make sure the Ollama app is running. If you opened this page from GitHub, see “Using Ollama” in the README.`);
    }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(res.status === 404 ? `Ollama doesn’t have the model “${this.ollamaModel}”. Run: ollama pull ${this.ollamaModel}` : `Ollama error ${res.status}: ${data.error || res.statusText}`);
    const out = data.message?.content;
    if (!out) throw new Error('Ollama returned no answer.');
    return JSON.parse(out);
  }

  async _json(system, content, schema, effort) {
    const response = await this.client.beta.messages.create({
      model: this.model,
      max_tokens: 4000,
      system,
      messages: [{ role: 'user', content }],
      output_config: { effort, format: { type: 'json_schema', schema } },
      betas: [FALLBACK_BETA],
      fallbacks: 'default',
    });
    if (response.stop_reason === 'refusal') throw new Error('Claude declined this request' + (response.stop_details?.explanation ? `: ${response.stop_details.explanation}` : '.'));
    if (response.stop_reason === 'max_tokens') throw new Error('The reply was cut off. Try again.');
    const text = response.content.find(b => b.type === 'text')?.text;
    if (!text) throw new Error('Claude returned no answer.');
    return JSON.parse(text);
  }
}

// Turns SDK errors into a sentence the operator can act on
export function describeError(err) {
  if (err instanceof Anthropic.AuthenticationError) return 'The API key was rejected. Check it in Settings.';
  if (err instanceof Anthropic.PermissionDeniedError) return 'This API key cannot use that model.';
  if (err instanceof Anthropic.NotFoundError) return 'Model not found. Check the model name in Settings.';
  if (err instanceof Anthropic.RateLimitError) return 'Rate limit reached. Slow the analysis interval in Settings.';
  if (err instanceof Anthropic.APIConnectionError) return 'Could not reach the Claude API. Check the internet connection.';
  if (err instanceof Anthropic.APIError) return `Claude API error ${err.status ?? ''}: ${err.message}`;
  return err?.message || String(err);
}
