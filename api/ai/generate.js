'use strict';
// One Vercel Function handles the three long-running image generation operations.
// Public URLs stay unchanged through the rewrites in vercel.json.
const { trackGeneration } = require('../../lib/generation-tracking');
const { send, guard, loadApiKey } = require('../../lib/auth');
const { generate } = require('../../lib/image-provider');

const MODES = new Set(['edit', 'harmonize', 'master']);

function operationFor(req) {
  const url = new URL(req.url || '/', 'http://localhost');
  const lastSegment = url.pathname.split('/').filter(Boolean).pop();
  // Local server keeps the original URL; Vercel may expose the rewritten URL.
  if (MODES.has(lastSegment)) return lastSegment;
  const selected = req.query?._mozai_mode ?? url.searchParams.get('_mozai_mode');
  return typeof selected === 'string' && MODES.has(selected) ? selected : null;
}

module.exports = async function handler(req, res) {
  const operation = operationFor(req);
  if (!operation) return send(res, 404, { error: 'Unknown generation operation.' });
  if (!await guard(req, res, 'POST') || !await loadApiKey(req, res)) return;
  try {
    return send(res, 200, await trackGeneration(req, operation, () =>
      generate(req, operation === 'edit', operation === 'master' ? 'master' : undefined)
    ));
  } catch (error) {
    const fallback = operation === 'edit' ? 'AI edit failed'
      : operation === 'harmonize' ? 'Harmonization failed'
      : 'Master generation failed';
    return send(res, error.status || 400, { error: error.message || fallback });
  }
};

module.exports.config = { maxDuration: 300 };
