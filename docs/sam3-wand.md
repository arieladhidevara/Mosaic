# SAM 3 Auto Create (Hugging Face ZeroGPU)

**Color Wand** is the only Wand tool and remains local/free. AI segmentation
has moved into **Groups → ✦ Auto Create**: sign in, detect candidate objects
within the image, click one, then Generate. Draft Groups may appear after
selection; a new **option appears only after image generation succeeds**.

The existing `/segment` single-click endpoint remains for compatibility but
is not part of the Wand UI. The new `/segment_all` endpoint creates a labeled
2D object map without running SAM 3D reconstruction. Not every object will
necessarily be detected. The Hugging Face Space and Vercel server-side URL
must be configured for live use.

## ZeroGPU startup workaround

Meta SAM 3 creates a mix of hardcoded CUDA and CPU tensors while cloning
transformer layers at model construction. ZeroGPU intercepts CUDA at module
scope, which can raise a mixed-device `copy.deepcopy` error during Space
startup. Instead of loading at import time, mozAI now loads the model
inside the `@spaces.GPU` worker and memoizes it for warm workers.
This is deliberately a reliability workaround, not an optimization:
cold requests need to load the checkpoint and can take longer or exceed
ZeroGPU duration/quota. The model requires an authorized
`facebook/sam3` checkpoint and the `HF_TOKEN` Space secret.

## Auto Create — detect first, save options only after generation

The standard **Wand** is **Color Wand only** (local, no AI costs). Object
segmentation moved to a separate **✦ Auto Create** action in the **Groups**
toolbar.

1. Upload an image / create a Master, then click **✦ Auto Create**.
2. Sign in to mozAI (guest users do not get segmentation access). This step
   does *not* require an OpenAI API key. Auto Create sends the image preview
   to the configured Hugging Face SAM 3 Space.
3. The Space creates best-effort 2D object-mask proposals from a **single
   shared image embedding** and a sparse grid of point prompts. This is not
   SAM 3D reconstruction, not guaranteed exhaustive segmentation, and may
   miss tiny or ambiguous elements.
4. Region highlights exist only over the **image canvas**. No objects or
   options are created in the Groups list by the detection pass.
5. Hover and click a highlighted region to use its temporary mask; a draft
   Group may appear in the right sidebar. Enter an edit prompt and Generate.
6. **A new option is visible in Groups only after successful image generation.**
   A failed first generation does not leave a phantom option behind.
   Other manual selections and imported options continue working.

The same authenticated `POST /api/ai/sam3` route accepts
`{"mode":"auto","image":"data:image/jpeg;base64,...","width":768,"height":512}`
and returns `{"labels":"data:image/png;base64,...","count":N}`.
The PNG is an 8-bit grayscale *object index map*: 0 is background, 1…N are
candidate regions. This one map replaces shipping up to 28 full-size PNGs.
The Gradio endpoint is `/gradio_api/call/segment_all`, while legacy
single-click `/segment` remains available server-side for compatibility.
Both share a concurrency limit of one for the model instance.

On the first run, HF ZeroGPU may take longer than expected or hit free quota.
If Auto Create cannot isolate an object, fall back to Color Wand, Rect or
Lasso. Do not upload client-confidential images to an external HF Space
without authorization.

## Automatic GitHub → Hugging Face sync

The checked-in workflow [sync-hf-space.yml](../.github/workflows/sync-hf-space.yml)
publishes `app.py`, `requirements.txt`, `mask_utils.py`, and `auto_regions.py` from
`integrations/hf-sam3-space/` to the **existing** Hugging Face Space
`arieladhidevara/mozAI` on pushes to `main` that modify this folder.
It can also be started manually from GitHub Actions using **Run workflow**.
It does not remove extra Space files or replace the Hugging Face Space README,
SDK or hardware settings.

**One-time setup required (do not paste tokens into source code or chat):**

1. Create a **fine-grained Hugging Face write token** at
   https://huggingface.co/settings/tokens with write access to
   **arieladhidevara/mozAI**. Use an account that owns or can write to the Space.
2. Store this token in the GitHub repository secret
   `HF_SPACE_WRITE_TOKEN` at
   https://github.com/arieladhidevara/Mosaic/settings/secrets/actions.
3. Go to https://github.com/arieladhidevara/Mosaic/actions/workflows/sync-hf-space.yml
   and choose **Run workflow** to deploy the current files immediately.
   A missing token fails the workflow with a clear error; it never logs the token.
4. Check the Space **Build logs** followed by **Container logs**.
   The SAM 3 package currently needs `setuptools==80.9.0` because it imports
   `pkg_resources`, which was removed from newer setuptools versions.
5. Separately, gated `facebook/sam3` checkpoint download requires approved
   model access and a Hugging Face **Space secret** named `HF_TOKEN`.
   This runtime-read token is distinct from the GitHub deployment token.
6. Only once SAM 3 is healthy, configure the actual `.hf.space` inference URL
   in Vercel `MOZAI_HF_SAM3_SPACE_URL` and redeploy mozAI.

The workflow sync is only a code delivery mechanism: it does **not** grant
ZeroGPU quota, accept gated model terms, fix CUDA/runtime memory issues,
set Vercel variables, or guarantee that SAM 3 inference succeeds.

## Deploy the Space

1. Create your own Hugging Face Gradio Space with ZeroGPU hardware using
   the files in [integrations/hf-sam3-space](../integrations/hf-sam3-space/).
   ZeroGPU availability, GPU quotas and hosting eligibility are subject to HF
   rules. If your account is not eligible for free hosting, use suitable paid
   GPU hosting instead.
2. Request/accept checkpoint access to **facebook/sam3** and configure the
   Space secret **HF_TOKEN** authorized to download that checkpoint.
3. Verify the Space builds and manually test its /gradio_api/call/segment
   endpoint. It must accept [JPEG data URI, x, y], and respond with a base64
   **transparent PNG data URI** in a string output (not a Gradio image/file URL).
   Verify model memory, runtime and request duration; 45s is an initial limit.
4. In Vercel server-side project environment variables, configure
   MOZAI_HF_SAM3_SPACE_URL=https://YOUR-SPACE.hf.space
   and optionally HF_SAM3_TOKEN=YOUR_TOKEN. The URL must be an HTTPS subdomain
   of .hf.space with no path/query. Tokens stay on the server, never in JS.
5. Redeploy Vercel and test a masked click on mozAI. Test New, Add,
   Subtract, Undo, editing an existing group, slow queue handling, and failure.

Do not commit tokens to GitHub. Ensure the Space access policy is appropriate
for private architectural imagery. The request forwards previews to a separate
third-party service; users should not send confidential design images unless
their rights, employer/client rules, and service controls permit it.

## Operational notes

- The same-origin route authenticates the logged-in user and validates dimensions,
  content type, request size, and the configured Space hostname. It does not
  require the user's OpenAI API key.
- The Gradio request is asynchronous. A stale response is ignored when the
  user switches Wand engine, project, tool, selection mode or edit target.
- A failure does not erase an existing selection. The user can select Color Wand.
- GPU quota and cold starts/queue times depend on Hugging Face and the
  caller identity/token, and **are not a guaranteed number of selections**.
  With a shared server-side token, users generally share the token's limits.
- The Space has to load a large model, even for one click. Budget, privacy,
  rate limiting and workload isolation should be assessed before public SaaS use.
- Never expose Hugging Face secrets in browser code, logs or project files.

## Testing

Run npm test for local route validation and HF Gradio SSE contract tests.
Live end-to-end testing needs a deployed Space and cannot be simulated by
the unit tests. SAM 3 model correctness and mask quality for complex
architectural edges still require manual evaluation.
