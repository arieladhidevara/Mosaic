# Object-aware editing

The existing Groups and Options remain the editing interface. Smart Select is
an unchecked-by-default checkbox in regional prompt bars. Only checking it
enables prompt-based intent and SAM masking; typing and Generate otherwise
keep the manual selection. The prompt shows an indeterminate progress bar
while finding/selecting the object, with the existing HUD labeled Smart Select.
Unchecking restores the original shape and rejects pending results. The same
setting is synchronized across the canvas prompt, area dialog and Group prompt.
Rectangle, oval, polygon/freehand lasso, Wand and brush selections feed the same prompt analysis.
The original drawn region stays available for arbitrary area edits. Confident
object intent changes only the selection preview; Generate remains explicit.

`object-aware.js` orchestrates read-only vision intent, semantic SAM 3, object
identities, per-option geometry and overlap repair. Original object appearances,
valid pixels, hidden support and cropped repair patches are stored on existing
Groups/Options. The version-1 `.moz` codec already supports these optional fields;
legacy files continue to open without migration or credentials.

## Service setup

The application uses its existing account/BYOK authentication. The new
`/api/ai/object-intent` endpoint follows the existing Responses API integration
and requests structured intent from `gpt-4.1-mini` with `store:false`. Background
analysis only runs when an existing connection is ready; it never opens a key
dialog. Debounced auxiliary vision calls are billable provider requests.

Deploy the updated `integrations/hf-sam3-space/` sources to the configured HF
Space to enable `segment_object(image,label,left,top,right,bottom)`. Existing
`segment` and `segment_all` endpoints are preserved. Semantic inference combines
SAM 3's text and normalized box prompts; candidate scores and spatial overlap
must pass validation. An older Space without the new endpoint leaves the user's
original selection intact. Pushes to main automatically sync all five inference files through `.github/workflows/sync-hf-space.yml`. The service must finish rebuilding before semantic selection is available.

## Local repair

OpenCV 5.0.0 (`@techstark/opencv-js@5.0.0-release.1`) loads on the first small,
simple repair. This build includes the `photo` module and `cv.inpaint`; the
4.12.0 npm build does not. ONNX Runtime Web 1.20.1 and the official MI-GAN
`migan_pipeline_v2.onnx` load only when CV is insufficient. The model is pinned
to HF revision `406830d0fa60666da0071c342ad2fbc8f30c5c64`, saved in CacheStorage,
and reused in a persistent worker session. WebGPU is attempted when available;
unsupported operators/session failures fall back to WASM. MI-GAN uses uint8
NCHW RGB and an inverse mask: 255 means known and 0 means missing.

Repairs use contextual tiles with a 512-pixel interior and 64-pixel context.
Only requested missing pixels are composited, at the original document size.
Occluders are excluded from texture samples. Foreground relationships determine
draw order independently of when Groups were edited. Known pixels and cached
repairs are reused first. Rapid switching coalesces work and stale results cannot
commit. Low-confidence/failed repair leaves approved pixels in place.

Optional configuration can be set before loading editor modules:

```js
window.MosaicObjectConfig = {
  debounceMs: 650,
  repairDebounceMs: 100,
  repair: { gapWidth: 40 }
};
```

`repair.opencvURL`, `repair.ortURL` (ending in `/`) and `repair.modelURL` can
point to self-hosted copies using the same runtime/model contracts. Default
downloads need network access on first use; CacheStorage is best-effort where
private browsing or storage quotas restrict it.

## Verification and limits

`npm test` covers binary geometry, ordering, quality gates, proxy validation and
existing regressions. Python's `test_sam3_*.py` tests validate candidate selection
and the ZeroGPU service contract without requiring checkpoints. Browser suites:

```text
python tests/browser-runner.py object-aware-scenarios.js runObjectAwareChecks
python tests/browser-runner.py object-aware-scenarios.js runSmartSelectChecks
python tests/browser-runner.py object-aware-scenarios.js runLocalOpenCVRepairCheck
python tests/browser-runner.py object-aware-scenarios.js runLocalMIGANRepairCheck
```

The full editing scenario mocks intent, SAM, image generation and repair to
exercise races, option independence and persistence deterministically. The two
runtime scenarios exercise actual OpenCV and MI-GAN WASM inference/downloads.
Real semantic segmentation quality and paid generation still require the
updated HF Space and a connected provider. WebGPU must be checked on a supported
device. Image-boundary analysis is a conservative geometry heuristic rather
than a 3D geometry measurement. Automatic reconstruction is best-effort; unknown
fine structure and physically correct shadows cannot be guaranteed. Transformed
options retain the existing safe mask/warp behavior; automatic geometry
re-segmentation and overlap repair are skipped while an option is warped.

MI-GAN's model and weights are MIT licensed by Picsart AI Research; see
`THIRD_PARTY_NOTICES.md` for notices and upstream references.
