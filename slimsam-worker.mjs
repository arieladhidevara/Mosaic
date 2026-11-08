// Local-only SlimSAM-77 inference worker. No image pixels are sent to mozAI's server.
// Hugging Face hosts the ~13.1MB Apache-2.0 quantized ONNX model and
// jsDelivr hosts the browser-bundled Transformers.js v3.8.1. Browser's WASM runtime performs inference.
import {selectSlimMask} from './slimsam-mask-utils.mjs';

const CDN = 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.8.1/dist/transformers.min.js';
const MODEL = 'Xenova/slimsam-77-uniform';
let loader = null, model = null, processor = null, Tensor = null, RawImage = null;
let embedding = null, imageWidth = 0, imageHeight = 0, imageFingerprint = '';
let activeEpoch = 0, jobs = Promise.resolve();

function report(type, extra = {}) {self.postMessage({type, ...extra});}

async function loadModel() {
  if (!loader) {
    loader = (async () => {
      report('status', {status:'Downloading SlimSAM (~14 MB)…'});
      const hf = await import(CDN);
      Tensor = hf.Tensor;
      RawImage = hf.RawImage;
      hf.env.allowRemoteModels = true;
      hf.env.allowLocalModels = false;
      if (hf.env?.backends?.onnx?.wasm) hf.env.backends.onnx.wasm.numThreads = 1;
      const opts = {
        dtype:'q8',
        progress_callback: info => {
          if (info?.status === 'progress' && Number.isFinite(info.progress)) {
            report('status', {status:'Downloading SlimSAM ' + Math.min(100, Math.round(info.progress)) + '%…'});
          }
        }
      };
      [model, processor] = await Promise.all([
        hf.SamModel.from_pretrained(MODEL, opts),
        hf.AutoProcessor.from_pretrained(MODEL),
      ]);
      report('status', {status:'AI Tiny ready · preparing image…'});
    })().catch(error => {loader = null; throw error;});
  }
  await loader;
}

async function prepare(job) {
  await loadModel();
  if (job.epoch !== activeEpoch) return;
  if (embedding && job.fingerprint === imageFingerprint &&
      imageWidth === job.width && imageHeight === job.height) {
    report('ready', {epoch: job.epoch, reused:true});
    return;
  }
  report('status', {epoch:job.epoch,status:'Analyzing image locally…'});
  const raw = new RawImage(new Uint8ClampedArray(job.pixels), job.width, job.height, 4);
  const inputs = await processor(raw);
  const nextEmbedding = await model.get_image_embeddings(inputs);
  if (job.epoch !== activeEpoch) return;
  embedding = nextEmbedding;
  imageWidth = job.width;
  imageHeight = job.height;
  imageFingerprint = job.fingerprint;
  report('ready', {epoch:job.epoch,reused:false});
}

async function infer(job) {
  if (job.epoch !== activeEpoch || !embedding) return;
  const sx = job.x, sy = job.y;
  if (!(sx >= 0 && sx < imageWidth && sy >= 0 && sy < imageHeight)) {
    report('mask', {epoch:job.epoch,id:job.id,click:job.click,mask:null});return;
  }
  // SAM preprocesses by resizing the longest image edge to 1024; the shorter
  // edge is zero-padded. Positive point coordinates must use the same scale.
  const scale = 1024 / Math.max(imageWidth, imageHeight);
  const input_points = new Tensor('float32', new Float32Array([sx * scale, sy * scale]), [1, 1, 1, 2]);
  const input_labels = new Tensor('int64', new BigInt64Array([1n]), [1, 1, 1]);
  const output = await model({...embedding, input_points, input_labels});
  if (job.epoch !== activeEpoch) return;
  const selected = selectSlimMask(
    output.pred_masks.data, output.iou_scores.data,
    imageWidth, imageHeight, sx, sy
  );
  if (!selected) {
    report('mask', {epoch:job.epoch,id:job.id,click:job.click,mask:null});
    return;
  }
  const msg = {
    type:'mask', epoch:job.epoch,id:job.id,click:job.click,
    x:sx,y:sy,width:selected.width,height:selected.height,
    mask:selected.mask,coverage:selected.coverage
  };
  self.postMessage(msg, [selected.mask.buffer]);
}

self.onmessage = event => {
  const data = event.data;
  if (data.type === 'prepare') activeEpoch = data.epoch;
  jobs = jobs.then(async () => {
    if (data.type === 'prepare') await prepare(data);
    else if (data.type === 'infer') await infer(data);
  }).catch(error => {
    report('error', {epoch:data.epoch,id:data.id,click:!!data.click,
      stage:data.type,message:String(error?.message || error).slice(0,260)});
  });
};
