# Optional SAM 3 AI Wand (Hugging Face ZeroGPU)

The existing **Color** Wand stays the default and is fully local/free. The new
**AI · SAM 3** choice takes a single click and sends the current *visible
composition preview* (max 1024px JPEG) to an optional server-configured
Hugging Face Gradio Space. The returned transparent mask is drawn into the
same selection canvas as Color Wand, preserving New / Add / Subtract, Undo,
Edit Mask, Apply and Group workflows. The Space compares SAM 3's candidate masks,
prioritizes regions containing the click, retains only the connected object near
the click, and rejects empty / near-whole-image selections (>=90%). The browser
also rejects masks covering >=92% as a safety fallback during deployments.
Click *inside* the desired object, rather than on its boundary or background.
This improves selection reliability but does not provide automatic semantic
object categories or guarantee perfect furniture/floor/wall boundaries.

**Not automatically activated after merge:** The Hugging Face Space
`arieladhidevara/mozAI` exists, but the model still needs a healthy runtime,
authorized checkpoint access and the `MOZAI_HF_SAM3_SPACE_URL` environment
variable on Vercel. Until configured, AI Wand reports an error; use Color Wand.


## Automatic GitHub → Hugging Face sync

The checked-in workflow [sync-hf-space.yml](../.github/workflows/sync-hf-space.yml)
publishes `app.py`, `requirements.txt`, and `mask_utils.py` from
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
