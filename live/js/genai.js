// Generative AI (Claude) in two roles:
//   1. Crowd analyst: looks at a camera frame (with the counting areas drawn on it) and counts people per area.
//      This backs up the on-device detector, which undercounts when people stand close together.
//   2. Communicator: turns the current decision into sign text, multilingual announcements and a staff note.
// Runs in the browser with the user's own API key, which never leaves their device except to call the API.

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
  required: ['sign_en', 'sign_zh_hant', 'sign_zh_hans', 'announcement_en', 'announcement_zh_hant', 'announcement_zh_hans', 'staff_note'],
  properties: {
    sign_en: { type: 'string' }, sign_zh_hant: { type: 'string' }, sign_zh_hans: { type: 'string' },
    announcement_en: { type: 'string' }, announcement_zh_hant: { type: 'string' }, announcement_zh_hans: { type: 'string' },
    staff_note: { type: 'string' },
  },
};

const COUNT_SYSTEM = `You count people in CCTV frames from a metro platform. Coloured rectangles labelled "QUEUE nA" mark the queue area of platform door n; rectangles labelled "CAR n" mark the inside of train car n. Count every person whose feet are inside each queue area, and every person inside each car area, including people who are partly hidden behind others. Count real people only, not posters or reflections. If an area is not visible, give 0 and say so in notes. Keep notes to one short sentence.`;

const GUIDE_SYSTEM = `You write passenger guidance for MTR platform signs and announcements in Hong Kong. You receive the current state of each platform door: its light colour (green = room predicted on the next train, amber = limited, red = full), the queue, and the predicted room. Write:
- sign_en / sign_zh_hant / sign_zh_hans: one line for the tunnel sign, at most 60 characters in English, telling people which doors to walk to.
- announcement_en / announcement_zh_hant / announcement_zh_hans: one calm, polite platform announcement of one or two sentences, in MTR's style. Traditional Chinese should read naturally for Hong Kong.
- staff_note: one or two sentences for station staff explaining why the lights are set this way and anything to watch.
Use door labels exactly as given (for example 3A). Never tell people to run or rush.`;

export class GenAI {
  constructor() { this.client = null; this.model = 'claude-opus-5-5'; this.busy = { count: false, guide: false }; }

  connect(apiKey, model) {
    this.client = apiKey ? new Anthropic({ apiKey, dangerouslyAllowBrowser: true }) : null;
    if (model) this.model = model;
  }

  get enabled() { return !!this.client; }

  async countCrowd(jpegB64, labels) {
    const prompt = `Areas to count: ${labels.join(', ')}. Return one entry per area, using these exact labels.`;
    return this._json(COUNT_SYSTEM, [
      { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: jpegB64 } },
      { type: 'text', text: prompt },
    ], COUNT_SCHEMA, 'low');
  }

  async writeGuidance(state) {
    return this._json(GUIDE_SYSTEM, [{ type: 'text', text: JSON.stringify(state) }], GUIDE_SCHEMA, 'low');
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
