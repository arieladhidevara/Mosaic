# Mosaic — AI Collage Workspace

Mosaic is a manual-first architectural AI collage editor with optional single-account Premium image generation powered by OpenAI. Choose exactly which parts to keep from multiple AI-generated variations, group alternatives by masked location, and export a ready-to-harmonize ZIP for ChatGPT or another image model.

## Workflow

1. Upload a **Base image**. Mosaic stays on onboarding until you **upload a Master**, **generate a Master from the inline prompt**, or deliberately click **Continue with Base only**. Just uploading Base never silently starts the editor or creates Master.
2. Upload your own **Master image**, generate a Master with Premium, or click **Continue with Base only** to start a local manual working draft. The draft is not registered as an uploaded/generated Master, and a real Master can still be added later (with confirmation if it would replace existing Group work).
3. Upload one or more AI images. Each becomes a temporary top layer, one at a time.
4. Choose **Lasso**, **Rect**, **Oval**, or **Magic Wand**. Lasso uses click-to-place polygon points or freehand dragging; close at the start, double-click, or press Enter. Start/draw outside the image if needed: the live outline stays visible in the surrounding viewport and the applied selection automatically clips to the image rectangle. Rect/Oval support Shift-constrained shapes. Magic Wand flood-selects connected, similar-colored pixels under the click, with an adjustable **Tolerance** slider. **New / Add / Subtract** work with every selection tool.
5. Click **Apply** to keep only the selected region of the uploaded image. **Enter** closes an unfinished Lasso; selection remains a draft until Apply. The unselected pixels are hidden non-destructively.
6. Refine a patch later with **Edit**, **Brush**, or **Eraser**. Overlapping patches from the same region are automatically grouped as alternatives, with the newest active.
7. Use **Compare master**: hold the button with a mouse to compare temporarily; on touch devices tap once to view master and again to return.
8. Export a ZIP with `01_Base.png`, `02_Final_Collage.png`, and `03_Harmonization_Prompt.txt`.

The prompt can also be copied directly from the interface. Manual image processing is local; Premium edits and harmonization use authenticated serverless OpenAI API routes.

## Important notes

- **No automatic image difference detection**. The Magic Wand operates on connected pixels of similar color in the visible composition, not semantic objects. Region grouping still happens only *after* applying a mask.
- Automatic Group matching requires strong **actual mask intersection**, not just similar bounding boxes. Use the **+ beside Groups** in the right sidebar for a new Group. Desktop drag/drop can move options between Groups without adding a fifth option button.
- For position/crop mismatches, click **Edit** beside Base, Master, a pending upload, or an option in Groups. A 20%-opacity image overlay and bounding box appear directly on canvas. On an **applied option**, its visible image and selection mask move/scale/rotate together, preserving the mask-to-image relationship. Changes to one option never mutate a source shared by other options.
- Maximum import size defaults to 2400 pixels on the longest side to limit browser memory; hidden Base image can be imported at up to 4000 pixels.
- Live project data is kept **in browser memory** and refresh clears unsaved changes. Use **Save project** before leaving and **Open project** to restore it. No backend database/persistence or synchronization is required.
- Final AI harmonization is done manually and can still reinterpret visual references.

## Run

Static HTML, JavaScript and CSS. Open `index.html` or serve from the directory:

```bash
python3 -m http.server 8000
```

Open http://localhost:8000.

## Deploy to Vercel

The public GitHub repository `arieladhidevara/Mosaic` is connected to the Mosaic project on Vercel. Pushing to the `main` branch automatically updates its production deployment. Framework: Other/static site. No build or environment variables are required.

## Structure

- `index.html`: editor UI
- `styles.css`: visual styles and responsive layout
- `app.js`: masks, Groups, selection modes, canvas rendering and ZIP export
- `premium.js`: Premium AI edits, local crops, regeneration and Master history
- `project-file.js`: portable lossless Save/Open project serialization
- `regions.js`: Group controls, names, hover and drag/drop
- `vercel.json`: static hosting config

MIT License.

## Premium AI workflow (OpenAI via authenticated backend)

Premium is a private, **single-account** feature (no public signup or billing). The username is `arieladhidevara`. The password is never stored in GitHub. Before login will work, configure the Vercel server environment variables listed below.

1. Upload **Base**. Enter the first prompt below the Base card, with up to three optional visual reference images; Generate creates the first Master as a separate image. Alternatively upload Master manually. Base remains the camera/geometry reference.
2. Draw a Lasso, Rectangle or Oval selection, click **Area**, and enter the instruction for that region. Each requested area receives a new colored contour and numbered label. Multiple areas can have different prompts.
3. **AI Edit** crops the selected mask's bounding box plus about 30% of its dimensions (minimum 72px on each side) for context. It sends only those aligned crops of the current collage and Base, together with the local mask, colored guide and prompt notes. The OpenAI Image Edit request uses **medium** quality and an output resolution proportional to this crop. It does **not** render the full architecture image for a local material variation.
4. The returned **crop-only output** is resized to the original crop window and composited into the correct position on a transparent full-size working layer. The original selection mask limits the applied pixels; all pixels outside the selected area remain unchanged. Use **✦ Regen** on an option to retry or regenerate; this does not erase the approved option if generation fails.
5. **Harmonize** sends the full approved collage and Base (no local crop) at **high** quality to produce a new full Master. The Groups panel retains prior alternatives, and Master 2/3/etc. appear in the Master Versions browser. Previous editable snapshots remain in memory for branching.

API-generated images are not perfectly geometry-constrained; masking guarantees outside-region pixels are left untouched by regional edits, but a full-image Harmonize may still change geometry. Region guide overlays are only for reference and can be toggled off.

### Activation / security

Required Vercel environment variables, set for Production (and Preview if using previews):

- `MOSAIC_ADMIN_USERNAME=arieladhidevara`
- `MOSAIC_PASSWORD_HASH` — run `node scripts/hash-password.cjs` locally, type the admin password (hidden), and paste the generated `scrypt:...` value into Vercel.
- `MOSAIC_SESSION_SECRET` — generate a strong random value with `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"`.

Never commit the real values. Redeploy to apply newly configured variables. Login uses a secure HTTP-only signed session cookie with an eight-hour expiry. There is an in-memory login attempt throttle, but for a public website you should also enable distributed rate limiting in Vercel Firewall.

The OpenAI API key is entered during Premium login and is kept **only in the current tab's JavaScript memory**; it is forwarded over HTTPS to the authenticated server function on each generation and then to OpenAI. It is not stored in the project history, cookies, localStorage, repository or environment variables. Refreshing the tab requires re-entering the key. ChatGPT subscription billing and OpenAI API usage are separate.

Endpoints: `/api/login`, `/api/session`, `/api/logout`, `/api/ai/master`, `/api/ai/edit`, `/api/ai/harmonize`, `/api/ai/classify`, and `/api/ai/option-name`. AI routes require a valid Premium session and the user's OpenAI API key. Up to three optional image references per generation are resized and validated. Browser state is not persisted.

Use Vercel to run Premium; a plain local static file server runs only the manual editor.

## Move & Skew layers

Click an existing region or variation in **Layers** to select it. Mosaic activates **Move / Skew** on the canvas:

- Drag inside the outlined patch or its center handle to move the mask and image together.
- Drag any of the four corner handles independently to skew its shape.
- **Reset warp** restores the original location. Undo/redo also includes move and skew.
- When selecting a moved/skewed option, the current visible mask is reused (not its old location). **Edit Mask** accepts a display-space selection and maps it back to the original source coordinates without losing the warp. Reveal/Erase and Undo/Redo also respect the transformed position.
- Layer transforms are captured in exports, Harmonized snapshots, and restored history branches.

The original Base geometry is preserved separately from the working Master.

## Portable project files (.mosaic)

- Click **Save project** to download a versioned, lossless JSON-based `.mosaic` file. It includes Base, working Master, original uploads, source layers, Groups, Option names/prompts, saved selections, moved/skewed masks, current draft selection, Undo/Redo, queued image files, Master Versions and editable Harmonize history.
- Click **Open project** to restore a previously saved file and resume editing. Imported images are decoded and validated before the current project is replaced. Files over **300 MB** are rejected; large multi-version projects may create correspondingly large files.
- Save/Open is local and does not require an AI API request. **Premium passwords and OpenAI API keys are never written into project files**; the user signs in again to use AI.
- Finished composite export remains separate from project save: use **Export package** for the approved flat images/ZIP, or **Save project** to continue editing later.

## UX notes (November 2026)

The main toolbar is grouped into **Select**, **Edit / Move**, and **Selection Mode**, with **AI Edit** and **Harmonize** on the right. Wand tolerance and brush size appear only when their tools are active. Manual **Apply** appears for an imported variation or edited saved mask. The right inspector now contains **Groups**, and **Help** opens the workflow and advanced full prompt. Selection cursors remain regular arrows; Pan has a grab cursor. The image is fitted with room around its edges so outside-image lasso outlines are visible. On small screens, selection tools scroll horizontally independently from the main AI buttons.

## Semantic Groups and spatial memory

- The first completed lasso, rectangle, oval, or Magic Wand selection creates a reusable named Group. Groups can also be explicitly created using **+** before selecting any pixels. Their reusable union mask is stored separately from individual option masks.
- With Premium login and a user-provided OpenAI API key, Mosaic automatically classifies the highlighted crop using the gpt-4.1-mini vision model through /api/ai/classify. This incurs separate API charges. No hidden calls are made while logged out.
- Without a key, the default category is Region. It can be changed manually, inferred from a subsequent edit prompt, or identified explicitly with the ✦ button. Model categories are suggestions, not guaranteed object detection.
- Each Option has **Edit, Rename, Delete, and ✦ Regen** actions. Local parsing derives concise names (e.g. “Make it black” → “Black”), with optional Premium semantic naming. Manually edited names take precedence.
- Clicking a group heading reuses the **active option's displayed selection**, including its move/skew, on the current image. An imported variation still requires explicit Apply to commit that mask.
- On desktop, hovering a recognized Region shows a category tooltip and subtle violet boundary. None of these guides enter exported images.
- Groups and spatial memory remain browser-local. Click the **+ beside Groups** in the right sidebar to add a Group. The old right-side Guide was replaced by a **Help** dialog containing workflow instructions and the advanced harmonization prompt. Desktop drag/drop still moves options between Groups.
