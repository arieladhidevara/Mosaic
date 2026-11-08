/* Hugging Face Gradio ZeroGPU client. Only a fixed, server-configured HF Space is contacted. */
'use strict';

const MAX_IMAGE_BYTES = 2_500_000;
const MAX_MASK_BYTES = 4_000_000;
const TIMEOUT_MS = 165_000;

function configuredSpace() {
  const raw = process.env.MOZAI_HF_SAM3_SPACE_URL;
  if (!raw) return null;
  const url = new URL(raw);
  if (url.protocol !== 'https:' || !url.hostname.endsWith('.hf.space') ||
      url.hostname === '.hf.space' || url.username || url.password ||
      url.port || url.pathname !== '/' || url.search || url.hash) {
    throw new Error('Invalid SAM 3 Space configuration.');
  }
  return url.origin;
}

function validateRequest(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('Invalid request.');
  const { image, width, height, x, y } = body;
  if (typeof image !== 'string' || image.length > MAX_IMAGE_BYTES ||
      !/^data:image\/jpeg;base64,[A-Za-z0-9+/]+={0,2}$/.test(image))
    throw new Error('Invalid Wand image.');
  if (![width,height,x,y].every(Number.isInteger) || width < 1 || height < 1 ||
      width > 1024 || height > 1024 || x < 0 || y < 0 || x >= width || y >= height)
    throw new Error('Invalid Wand coordinates.');
  return {image, width, height, x, y};
}

function parseCompleteEvent(sseText) {
  for (const block of sseText.split(/\r?\n\r?\n/)) {
    const lines = block.split(/\r?\n/);
    const type = lines.find(line => line.startsWith('event:'))?.slice(6).trim();
    if (type === 'error') throw new Error('SAM 3 inference failed.');
    if (type !== 'complete') continue;
    const payload = lines.filter(line => line.startsWith('data:')).map(line => line.slice(5).trim()).join('\n');
    let result;
    try { result = JSON.parse(payload); } catch { throw new Error('Invalid SAM 3 response.'); }
    const mask = Array.isArray(result) ? result[0] : null;
    if (typeof mask !== 'string' || mask.length > MAX_MASK_BYTES ||
        !/^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/.test(mask))
      throw new Error('Invalid SAM 3 mask.');
    return mask;
  }
  throw new Error('SAM 3 did not return a mask.');
}

async function segmentImage(body) {
  const data = validateRequest(body);
  const origin = configuredSpace();
  if (!origin) {
    const error = new Error('SAM 3 is not configured yet. Use Color Wand for now.');
    error.status = 503;
    throw error;
  }
  const headers = {'Content-Type':'application/json'};
  if (process.env.HF_SAM3_TOKEN) headers.Authorization = 'Bearer ' + process.env.HF_SAM3_TOKEN;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const create = await fetch(origin + '/gradio_api/call/segment', {
      method:'POST', headers, signal:controller.signal,
      body: JSON.stringify({data:[data.image, data.x, data.y]})
    });
    if (!create.ok) {
      const error = new Error(create.status === 429 ? 'SAM 3 quota or rate limit reached.' : 'SAM 3 Space is unavailable.');
      error.status = create.status === 429 ? 429 : 502;
      throw error;
    }
    const ticket = await create.json();
    if (typeof ticket.event_id !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(ticket.event_id))
      throw new Error('Invalid SAM 3 job ID.');
    const result = await fetch(origin + '/gradio_api/call/segment/' + encodeURIComponent(ticket.event_id), {
      method:'GET', headers:process.env.HF_SAM3_TOKEN ? {Authorization:headers.Authorization} : {},
      signal:controller.signal
    });
    if (!result.ok) {
      const error = new Error(result.status === 429 ? 'SAM 3 quota or rate limit reached.' : 'SAM 3 processing failed.');
      error.status = result.status === 429 ? 429 : 502;
      throw error;
    }
    const text = await result.text();
    if (text.length > MAX_MASK_BYTES + 100_000) throw new Error('SAM 3 response too large.');
    return parseCompleteEvent(text);
  } finally {
    clearTimeout(timer);
  }
}


function parseAutoCompleteEvent(sseText) {
  for (const block of sseText.split(/\r?\n\r?\n/)) {
    const lines = block.split(/\r?\n/);
    const type = lines.find(line => line.startsWith('event:'))?.slice(6).trim();
    if (type === 'error') throw new Error('Auto Create inference failed.');
    if (type !== 'complete') continue;
    const payload = lines.filter(line => line.startsWith('data:')).map(line => line.slice(5).trim()).join('\n');
    let result;
    try {
      const values = JSON.parse(payload);
      result = JSON.parse(Array.isArray(values) ? values[0] : '');
    } catch { throw new Error('Invalid Auto Create response.'); }
    if (!result || typeof result !== 'object' ||
        typeof result.labels !== 'string' || result.labels.length > MAX_MASK_BYTES ||
        !/^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/.test(result.labels) ||
        !Number.isInteger(result.count) || result.count < 1 || result.count > 64)
      throw new Error('Invalid Auto Create region map.');
    return {labels: result.labels, count: result.count};
  }
  throw new Error('Auto Create did not return object masks.');
}

async function segmentAllImage(body) {
  // The same authenticated path as point selection, but no click coordinates.
  const data = validateRequest({...body, x: 0, y: 0});
  const origin = configuredSpace();
  if (!origin) {
    const error = new Error('Auto Create is not configured yet. Use Color Wand for now.');
    error.status = 503;
    throw error;
  }
  const headers = {'Content-Type': 'application/json'};
  if (process.env.HF_SAM3_TOKEN) headers.Authorization = 'Bearer ' + process.env.HF_SAM3_TOKEN;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const create = await fetch(origin + '/gradio_api/call/segment_all', {
      method: 'POST', headers, signal: controller.signal,
      body: JSON.stringify({data: [data.image]})
    });
    if (!create.ok) {
      const error = new Error(create.status === 429 ? 'Auto Create quota reached.' : 'Auto Create Space is unavailable.');
      error.status = create.status === 429 ? 429 : 502;
      throw error;
    }
    const ticket = await create.json();
    if (typeof ticket.event_id !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(ticket.event_id))
      throw new Error('Invalid Auto Create job ID.');
    const result = await fetch(origin + '/gradio_api/call/segment_all/' + encodeURIComponent(ticket.event_id), {
      method: 'GET',
      headers: process.env.HF_SAM3_TOKEN ? {Authorization: headers.Authorization} : {},
      signal: controller.signal
    });
    if (!result.ok) {
      const error = new Error(result.status === 429 ? 'Auto Create quota reached.' : 'Auto Create processing failed.');
      error.status = result.status === 429 ? 429 : 502;
      throw error;
    }
    const stream = await result.text();
    if (stream.length > MAX_MASK_BYTES + 180_000) throw new Error('Auto Create response too large.');
    return parseAutoCompleteEvent(stream);
  } finally { clearTimeout(timer); }
}

module.exports = {configuredSpace, validateRequest, parseCompleteEvent, segmentImage, parseAutoCompleteEvent, segmentAllImage};
