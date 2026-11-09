# mozAI — AI Collage Workspace

mozAI is a manual-first architectural AI collage editor with optional bring-your-own-key image generation powered by OpenAI. Choose exactly which parts to keep from multiple AI-generated variations, group alternatives by masked location, and save the current composition directly as a PNG image.

## Workflow

Open the public welcome page and choose **Continue as guest** for manual editing,
local project files and PNG export, or **Sign in to Pro**. AI actions request an
invited account only when needed. Email/password and Google share the existing
Supabase membership checks. Signing in from the editor preserves its canvas.

1. Upload a **Base image**. mozAI stays on onboarding until you **upload a Master**, **generate a Master from the inline prompt**, or deliberately click **Continue with Base only**. Just uploading Base never silently starts the editor or creates Master. Clicking Generate opens the main canvas immediately with Base and centered generation progress; the Base fades into the generated Master when it is ready. Mask editing remains available while generating.
2. Upload your own **Master image**, generate a Master with Pro, or click **Continue with Base only** to start a local manual working draft. The draft is not registered as an uploaded/generated Master, and a real Master can still be added later (with confirmation if it would replace existing Group work).
3. Upload one or more AI images. Each becomes a temporary top layer, one at a time.
4. Choose **Line**, **Rect**, **Oval** or **Wand (SlimSAM)**. Wand downloads and caches the quantized model in the browser on first load, then highlights objects on hover and selects on click. The right **Groups → Auto Create** action uses the hosted SAM 3 Space to detect objects and create empty Groups immediately; an Option is added only after the user selects a Group and generates. **New / Add / Subtract** work with selection tools and Ctrl/Cmd-click unions multiple masks.
5. Click **Apply** to keep only the selected region of the uploaded image. **Enter** closes an unfinished Line; selection remains a draft until Apply. The unselected pixels are hidden non-destructively.
6. Refine a patch later with **Edit**, **Brush**, or **Eraser**. Overlapping patches from the same region are automatically grouped as alternatives, with the newest active.
7. Use **Compare master**: hold the button with a mouse to compare temporarily; on touch devices tap once to view master and again to return.
8. Click **Save image** to download the current approved composition as one PNG. A Base-only project can also be saved as an image. The image download contains no ZIP or prompt text.

The prompt can also be copied directly from the interface. Manual image processing is local; AI edits and harmonization use same-origin serverless OpenAI API routes with the user's own OpenAI API key.

## Important notes

- **Wand** uses locally cached SlimSAM model weights (no server-side Wand API usage). **Auto Create** uses hosted SAM 3 to create reusable Groups; masking progress is shown during model loading and inference. Browser cache may be evicted under device storage pressure.
- Automatic Group matching requires strong **actual mask intersection**, not just similar bounding boxes. Use the **+ beside Groups** in the right sidebar for a new Group. Desktop drag/drop can move options between Groups without adding a fifth option button.
- Use **Select** to move or reshape an applied image and its mask together. Use the option's **Edit** action to change only its selection. **Edit** beside Base, Master, or a pending upload opens the image position editor. Changes to one option preserve source images shared by other options.
- Maximum import size defaults to 2400 pixels on the longest side to limit browser memory; hidden Base image can be imported at up to 4000 pixels.
- Live project data is kept **in browser memory** and refresh clears unsaved changes. Use **Save project** before leaving and **Open project** to restore it. Editable image content remains local. Account access and metadata analytics use Supabase in production, with an isolated file store for local developer mode.
- Final AI harmonization is done manually and can still reinterpret visual references.

## Run locally

Node.js 18 or newer is required. The included local server serves both the static
editor and the `/api/ai/*` routes that connect to OpenAI:

```bash
npm run dev:local
```

To update a previously cloned local installation to the latest released UX:

```bash
git checkout main
git pull --ff-only origin main
npm run dev:local
```

The local server serves the same frontend JavaScript and model workers as the GitHub `main` branch, including Wand preload, masking progress, and Auto Create. In local development, the SAM 3 backend defaults to the same public `https://arieladhidevara-mozai.hf.space` Space as production; an explicit `MOZAI_HF_SAM3_SPACE_URL` in `.env.local` overrides this. Model downloads require an internet connection.

Open http://127.0.0.1:8000, click **Connect AI**, and enter your OpenAI API
key. Local auto-login uses an isolated development account; production requires Supabase setup described in [Phase 2 setup](docs/phase2-setup.md). The OpenAI key is forwarded by the same-origin server for each OpenAI request; optional browser remembering reconnects it after refresh.

Run the Node.js server or use Vercel for both application authentication and AI endpoints. Opening `index.html` directly cannot establish an application session.

## Deploy to Vercel

The GitHub repository `arieladhidevara/Mosaic` is connected to its Vercel deployment. Pushing to the `main` branch automatically updates its production deployment. Framework: Other/static site with serverless API functions. No bundling step is required. Supabase server environment variables and the Phase 2 database migration are required for login. See [Phase 2 setup](docs/phase2-setup.md).

## Structure

- `index.html`: editor UI
- `styles.css`: visual styles and responsive layout
- `app.js`: masks, Groups, selection modes, canvas rendering and PNG downloads
- `premium.js`: Premium AI edits, local crops, regeneration and Master history
- `project-file.js`: portable lossless Save/Open project serialization
- `regions.js`: Group controls, names, hover and drag/drop
- `vercel.json`: static hosting config

**Source code license:** Proprietary, all rights reserved. See [LICENSE](LICENSE). Earlier versions that were published under MIT retain their previous MIT grants; this change applies to new versions only.

## AI workflow (OpenAI API key only)

Manual editing requires no account. **AI requires an active invited mozAI account
and your own OpenAI key.** Click **Connect AI** or a Generate action to sign in and
follow the key setup guide. The connection check calls OpenAI's models endpoint
without generating an image; it does not establish remaining balance, billing
status, or permission to use a particular image model. Invited accounts display
mozAI Pro with **100 demo credits**; Low/Medium/High generations use 1/2/3 demo
credits after success. These are simulation units, never OpenAI funds, and do not
limit BYOK generation when depleted. See [onboarding setup](docs/onboarding.md).

1. Upload **Base**. A compact prompt bar appears under Base: type the first prompt and press **Enter** to generate a Master, or click the image icon to attach up to 3 visual references. Paste (Ctrl/Cmd+V) or drag image references into the bar too; small thumbnails appear only when attached. Alternatively upload Master manually. Base remains the camera/geometry reference.
2. Draw a Line, Rectangle or Oval selection, click **Area**, and enter the instruction for that region. Each requested area receives a new colored contour and numbered label. Multiple areas can have different prompts.
2a. **Generate Master from Base** uses **high** image quality for a full-resolution first Master; **Advanced Settings** provides Low / Medium / High quality for **AI Edit** (default Medium) and **Harmonize** (default High). Preferences are saved in each `.moz` project; older projects use these defaults.
3. **AI Edit** crops the selected mask bounds with 40% context padding based on the longest dimension (minimum 96px per side), clipped to the canvas edges. It sends the proportional collage crop and transparent mask, the full current composition as scene context, original Base geometry, crop coordinates, the Group's object description, prompt notes and any attached references. Material changes preserve the selected object's identity and details (for example a door's frame and hardware), rather than requesting a material swatch. Colored Region Guide images are never sent to OpenAI. Output uses the model's supported `auto` size and is fitted back to the captured crop window, then clipped to the exact submitted mask.
4. The returned **crop-only output** is resized to the original crop window and composited into the correct position on a transparent full-size working layer. The original selection mask limits the applied pixels; all pixels outside the selected area remain unchanged. Use **✦ Regen** on an option to retry or regenerate; this does not erase the approved option if generation fails.
5. **Harmonize** sends the full approved collage and Base (no local crop) at the selected Harmonize quality to produce a new full Master. Base is always included, regardless of the geometry toggle. The Groups panel retains prior alternatives, and Master 2/3/etc. appear in the Master Versions browser. Previous editable snapshots remain in memory for branching.

Initial Master, AI Edit and Harmonize use `gpt-image-2.6-sunburst` through the Images Edit API. Initial Master always uses High quality and requests roughly 2K output independently of Base pixel count (2048px long edge, 1920px near-square). The generation preview starts at that working resolution, so selections made while generating stay aligned. Existing working canvases retain their dimensions to preserve layers and history. Extreme aspect ratios outside 1:3 to 3:1 retain automatic sizing. Image inputs use JPEG quality 94% within the payload budget; output uses JPEG quality 100%.

API-generated images are not perfectly geometry-constrained; masking guarantees outside-region pixels are left untouched by regional edits, but a full-image Harmonize may still change geometry. Region guide overlays are local display aids and can be toggled off.

### API key and security

- Application login uses verified Supabase sessions and invitation membership. Local auto-login is explicitly enabled with `npm run dev:local` and is blocked on Vercel. The BYOK Remove-key control disconnects only the OpenAI key; it does not sign out of the application.
- OpenAI API key entry uses a masked input. **Remember on this browser** stores an account-scoped AES-GCM envelope in IndexedDB with a nonextractable Web Crypto key, so refresh reconnects automatically. Uncheck it for tab-only use; Remove key deletes the saved credential. Keys never enter server storage, cookies, `localStorage`, analytics, GitHub or project files. Browser encryption does not isolate a key from scripts running on the same origin.
- On each AI action, the browser sends the key in the HTTPS POST body to the mozAI same-origin serverless function. That function checks the request origin, validates the key's format, and forwards it to OpenAI. The app never embeds or shares an API key in its source code.
- This is **BYOK**: every user uses their own API key and is responsible for their OpenAI API charges. Check actual API billing and any account-specific credit benefits in OpenAI; the mozAI demo balance is independent.
- A valid OpenAI key alone cannot access AI endpoints: the server also requires a verified Supabase session and active invitation membership. Admin endpoints additionally require a database admin role. **Only enter your API key in a deployment you trust.**
- AI endpoints: `/api/ai/master`, `/api/ai/edit`, `/api/ai/harmonize`, `/api/ai/classify`, `/api/ai/option-name`, `/api/ai/connection`. Application sessions use `/api/session`; usage uses `/api/credits`. The old shared admin password implementation is no longer used.
- Up to 3 reference images per generation are resized and validated before they are sent. Running the UI from a static file server allows manual editing; AI functions require a deployed Node.js serverless runtime.

## Move & Skew layers

Patch edges use an inward alpha feather: image texture stays sharp, the editable mask stays unchanged, and pixels outside the mask are preserved. Selection outlines remain fully opaque black/white. Click **Simplify** beside Clear selection to straighten noisy edges; Undo restores the previous mask. Wand hover previews use a translucent fill without an outline.

Click an existing region or variation in **Layers** to select it. mozAI activates **Move / Skew** on the canvas:

- Drag inside the outlined mask to move the mask and image together.
- The outline follows the actual mask. Small handles stay at the clicked polygon vertices and drive the existing warp when dragged; raster masks from older projects recover handles from their boundary.
- **Reset warp** restores the original location. Undo/redo also includes move and skew.
- When selecting a moved/skewed option, the current visible mask is reused (not its old location). **Edit Mask** accepts a display-space selection and maps it back to the original source coordinates without losing the warp. Reveal/Erase and Undo/Redo also respect the transformed position.
- Layer transforms are captured in exports, Harmonized snapshots, and restored history branches.

The original Base geometry is preserved separately from the working Master.

## Non-blocking AI generation and masking

Regional generation displays persistent progress and a purple/white shimmer clipped to the submitted mask, even before its new Option appears. Wand analyzes the approved image as soon as it is ready; switching selection tools reuses that analysis. Changed composition pixels trigger fresh analysis. Auto Create also caches its region map for unchanged pixels and shares those detected object masks with Wand.

For an isolated browser regression check, inject `tests/mask-worker-fixture.js` before modules by setting `MOSAIC_BROWSER_INIT_SCRIPT=mask-worker-fixture.js`, then run `python tests/browser-runner.py mask-workflow-scenarios.js runMaskWorkflowChecks` against the local test server and test Chrome described in that runner. This uses fixture generation/segmentation and does not assess live image quality.

- The quick selection prompt's **+ Reference image** and the per-Group inline **+ Ref** controls are explicit buttons that open a native file picker. Both also support pasted images and drag/drop directly into the prompt.
- Canvas pointer events do not intercept clicks inside the floating prompt, so opening the picker or typing cannot dismiss it.
- Regional AI generation captures a copy of the submitted mask/crop; the live mask, lasso, active tool, editor and current option remain editable while requests run and after their results arrive.
- AI result downloads update the corresponding image source behind the current editor. The Groups panel keeps any inline prompt text and attached reference images during AI progress updates.
- Full Master generation closes the prompt modal before the network request and updates an existing Master's background without deleting its Groups. Harmonize stores an archive snapshot from when it was requested and doesn't reset any active mask editor when it finishes.
- If a different project/Master is loaded before a Harmonize response returns, the response is not applied to that new project. Native file import processing remains a separate brief blocking step.

## Paste or drag references into AI prompts

- Every image-generation prompt accepts images by **Ctrl/Cmd+V** (copied screenshot or image), **drag-and-drop into the prompt text area**, or the normal **+ Reference images** file picker.
- This includes Base-to-Master, masked AI Edit, floating quick prompt, inline per-Group prompt, and full Harmonize / Master regeneration.
- Images appear as removable thumbnails next to the prompt and are submitted with that specific AI generation request, up to **3 JPG/PNG/WebP images** of **10 MB each**.
- Plain-text paste and text editing still work normally. Dropping an image into a prompt does not import it as a new working image/variant.
- Reference attachments are temporary to the prompt and are not automatically saved in the project file.

## Portable project files (.moz)

- Click **Save project** to download a versioned, lossless JSON-based `.moz` file. It includes Base, working Master, original uploads, source layers, Groups, Option names/prompts, saved selections, moved/skewed masks, current draft selection, Undo/Redo, queued image files, Master Versions and editable Harmonize history.
- Click **Open project** to restore a previously saved file and resume editing. Imported images are decoded and validated before the current project is replaced. Files over **300 MB** are rejected; large multi-version projects may create correspondingly large files.
- Save/Open is local and does not require an AI API request. **OpenAI API keys are never written into project files**; remembered browser keys reconnect after refresh, while tab-only keys require reconnection.
- Use **Save image** for a single PNG, or **Save project** for an editable `.moz` file. Older `.mosaic` files remain readable.

## UX notes (November 2026)

The left toolbar is organized as **Navigate** (Select and Pan), **Select** (Line, Rectangle, Oval, Wand), and **Edit**. Scroll over the canvas to zoom; **Fit** resets the view. New/Add/Subtract appear only while a selection tool is active. Brush **Size** and **Intensity** appear under Edit, with a circle matching the brush size at the cursor. AI edits use the movable popup or the Group option prompt. The Groups inspector has stable actions on the right of each option, and Advanced Settings is at the bottom.

## Semantic Groups and spatial memory

- Line, rectangle, oval, and Magic Wand selections remain drafts until **Generate** or **Apply** creates an image option. The **+** button starts a new draft without creating an empty Group. Masks with at least **85% overlap in both directions** reuse an existing Group as another option; the comparison uses actual mask pixels at native resolution.
- Drawing or hovering a draft makes no AI calls. Generated edit prompts can infer a category locally; the Identify button can optionally classify an existing Group through /api/ai/classify.
- Without a key, the default category is Region. It can be changed manually, inferred from a subsequent edit prompt, or identified explicitly with the ✦ button. Model categories are suggestions, not guaranteed object detection.
- Each Option has **Edit, Rename, Delete, and ✦ Regen** actions. Local parsing derives concise names (e.g. “Make it black” → “Black”), with optional Premium semantic naming. Manually edited names take precedence.
- Clicking a group heading reuses the **active option's displayed selection**, including its move/skew, on the current image. An imported variation still requires explicit Apply to commit that mask.
- On desktop, hovering a saved selection shows its Group name and a violet area highlight. None of these guides enter exported images.
- Groups and spatial memory remain browser-local. Click the **+ beside Groups** in the right sidebar to start a new selection draft. The old right-side Guide was replaced by a **Help** dialog containing workflow instructions and the advanced harmonization prompt. Desktop drag/drop still moves options between Groups.

## Validation

Run `node --test tests/image-provider.test.cjs tests/mask-geometry.test.cjs` for the server request contract and `node --check <file.js>` for static JavaScript checks. The editor is a static application and has no bundling/build step. `tests/browser-scenarios.js` exercises browser canvas rendering, background generation, quality settings, mask alignment, and project round trips. Run a Node server with the `tests/mock-openai.cjs` preload (for example, `node --require ./tests/mock-openai.cjs local-server.js` when using the local server), load the scenario script into a fresh mozAI browser tab, then call `await runMosaicBrowserChecks()`. The preload replaces OpenAI responses with generated test images and avoids spending API credits. Live image quality requires an OpenAI API key.

## Canvas controls

Click the project name in the header to rename it. The name is preserved through generation and saved in `.moz` files.

- **Line**, Rectangle, Oval, and **Wand** return to the pointer **Select** tool after completing a selection. Wand selects connected pixels with similar colors at the chosen tolerance.
- **Select** hover highlights the actual area and shows its selection name, including unsaved drafts. Outlines, guides, and points use SVG vectors with constant screen-width strokes, so zoom stays sharp. **Select** shows the actual outline and its points. For a draft, drag one point independently or drag inside to move the whole selection. For an applied/generated image, Select moves or skews the image and mask together. Choose **Edit** on its option to change only the mask. Undo restores each action; clicking outside deselects.
- Scroll over the canvas to zoom around the pointer while using Select, Pan, or a selection tool. Click **Fit** in the header to restore the fitted view. There is no separate Zoom tool.
- Drag the **AI Edit** popup by its header to reposition it. Its header also supports arrow keys.
- Brush and Eraser use **Size** and **Intensity** under Edit. The cursor circle matches Size.
- The wider Groups inspector shows Group numbers, names, categories, and fixed option actions on the right. Advanced Settings is at the bottom.

Projects now save with the `.moz` extension. Existing `.mosaic` project files remain supported.

Browser regression scripts: `tests/workspace-scenarios.js` covers the pointer, Line, Wand, popup movement, navigation, layout, and PNG downloads; `tests/initial-generation-scenarios.js` covers Base onboarding, centered generation progress, the Base-to-Master transition, duplicate-request prevention, and `.moz` downloads. Use the mock-provider test server for these scenarios.

- Hover near a selection edge to reveal a separate **+** control. Click it to insert a point without changing image pixels. Clicking a vertex exposes a separate **-** control; dragging the vertex only moves it. Delete requires a direct click and keeps at least three points.
- Click the project name to rename it. The name survives generation and determines its `.moz` filename. Brush Size and Intensity are saved within the project.
- `tests/selection-scenarios.js` checks independent points, deliberate point controls, image placement versus mask editing, brush size/intensity, project naming, and portable Undo/Redo.

- `tests/hover-group-scenarios.js` / `await runHoverGroupChecks()` verifies Select hover, sharp SVG contours, exact 85% two-way grouping at native resolution, no empty draft Groups, and repeated generation as alternatives.

## Phase 2 accounts and local development

The admin Overview and per-user/project pages include action breakdowns and 30-day UTC graphs for generations, tool activity and known estimated API cost. **Wand** counts successful object selections (not hovers); **Auto Create** counts valid user runs, including cached runs; **Mask adjustments** counts completed brush/point/selection adjustments and Simplify actions. AI mask edits, Master and Harmonize counts come from server generation records. Old tool actions cannot be reconstructed. Dollar estimates sum only provider-reported usage; unavailable cost data is shown as unknown.

Production tool tracking and aggregate RPCs require [the analytics migration](supabase/migrations/202611080002_mask_usage_analytics.sql) in the linked Supabase database. The admin portal falls back to existing metadata queries before that migration is applied; local development stores the same event types in its isolated file store.

See [the complete Vercel + Supabase setup guide](docs/phase2-setup.md). Use `npm run dev:local` for loopback-only automatic login as `dev@mosaic.local`, `npm run dev:login` for real Supabase login, and `npm run dev:reset` to reset only isolated local test data. `/admin` uses the same application session. All AI operations still require your own OpenAI key. `npm test` includes auth/security and in-memory PostgreSQL migration tests.

The welcome page fits one viewport without scrolling. The header groups Open/Save project under Project and uses matching AI, account and PNG controls. The floating AI prompt opens from a canvas area click; sidebar option selection only exposes its editable mask. References use a + beside the prompt, with Generate below.

## Launch safety and monitoring

The /privacy and /terms documents linked from the landing page describe beta data practices. The account dialog also links to them. On 5xx API errors, a random X-MozAI-Error-ID is added to the response and a sanitized structured log records only that ID, numeric status, and a validated code. Request bodies, uploaded imagery, user identifiers, prompt contents, and API keys are never intentionally logged by this handler. Run npm test to exercise these guarantees. Production rate limiting still requires independent Vercel WAF configuration and verification. The LICENSE notice is unchanged by this patch.
