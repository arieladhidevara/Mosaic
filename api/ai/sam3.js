/* Authenticated same-origin proxy for an optional Hugging Face SAM 3 ZeroGPU Space. */
'use strict';
const {send,guard} = require('../../lib/auth');
const {segmentImage} = require('../../lib/hf-sam3');

module.exports = async function handler(req,res) {
  if (!await guard(req,res,'POST')) return;
  try {
    const mask = await segmentImage(req.body);
    return send(res,200,{mask});
  } catch (error) {
    const status = error.status || (error.message.startsWith('Invalid ') ? 400 : error.name === 'AbortError' ? 504 : 502);
    return send(res,status,{error:status >= 500 && status !== 503 ? 'SAM 3 is unavailable. Switch Wand to Color and retry.' : error.message,code:'SAM3_UNAVAILABLE'});
  }
};
module.exports.config = {maxDuration:180};
