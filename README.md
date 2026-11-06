# Mosaic — AI Collage Workspace

Mosaic is a manual-first architectural AI collage editor with optional single-account Premium image generation powered by OpenAI. Choose exactly which parts to keep from multiple AI-generated variations, group alternatives by masked location, and export a ready-to-harmonize ZIP for ChatGPT or another image model.

## Workflow

1. Upload a **Base image**. It becomes the initial visible canvas when no master has been chosen; enter the project design-intent prompt in the dialog.
2. Optionally upload a separate **master render**, or keep working directly over the Base image.
3. Upload one or more AI images. Each becomes a temporary top layer, one at a time.
4. Choose **Lasso**, **Rect**, **Oval**, or **Magic Wand**. Lasso uses click-to-place polygon points or freehand dragging; close at the start, double-click, or press Enter. Start/draw outside the image if needed: the live outline stays visible in the surrounding viewport and the applied selection automatically clips to the image rectangle. Rect/Oval support Shift-constrained shapes. Magic Wand flood-selects connected, similar-colored pixels under the click, with an adjustable **Tolerance** slider. **New / Add / Subtract** work with every selection tool.
5. Press **Enter** or **Apply** to keep only the selected region of the uploaded image. The unselected pixels are hidden non-destructively.
6. Refine a patch later with **Edit**, **Brush**, or **Eraser**. Overlapping patches from the same region are automatically grouped as alternatives, with the newest active.
7. Use **Compare master**: hold the button with a mouse to compare temporarily; on touch devices tap once to view master and again to return.
8. Export a ZIP with `01_Base.png`, `02_Final_Collage.png`, and `03_Harmonization_Prompt.txt`.

The prompt can also be copied directly from the interface. Manual image processing is local; Premium edits and harmonization use authenticated serverless OpenAI API routes.

## Important notes

- **No automatic image difference detection**. The Magic Wand operates on connected pixels of similar color in the visible composition, not semantic objects. Region grouping still happens only *after* applying a mask.
- Grouping is a heuristic based on patch bounding-box overlap and normalized center distance. Distinct objects that overlap heavily may need a future manual split/ungroup feature.
- Variations should share camera position, aspect ratio, and crop. A different aspect ratio is drawn to fit the canvas and is not automatically geometry-aligned.
- Maximum import size defaults to 2400 pixels on the longest side to limit browser memory; hidden Base image can be imported at up to 4000 pixels.
- All project data, including Premium archived snapshots and masks, is **in browser memory**, so refresh clears the session. Export the finished composition before leaving. No backend persistence or synchronization.
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
- `app.js`: masks, region groups, selection modes, canvas drawing, ZIP export
- `vercel.json`: static hosting config

MIT License.

## Premium AI workflow (OpenAI via authenticated backend)

Premium is a private, **single-account** feature (no public signup or billing). The username is `arieladhidevara`. The password is never stored in GitHub. Before login will work, configure the Vercel server environment variables listed below.

1. Upload **Base**, then provide a project-wide design intent. Base remains permanent and is included as the geometric reference for every AI request.
2. Draw a Lasso, Rectangle or Oval selection, click **Area**, and enter the instruction for that region. Each requested area receives a new colored contour and numbered label. Multiple areas can have different prompts.
3. The browser sends the current accepted collage, original Base, exact *transparent edit mask*, a separate colored annotation image, and all active region comments to an authenticated Vercel function. The function sends them to OpenAI Images Edit using `gpt-image-2.5-sunburst`.
4. The full-frame AI output is stored as the result of the corresponding region. **The original user mask is still used for pixel compositing**, so output outside that region is ignored. If a request fails, use the region's **Generate** button to retry or **Add result** to attach an external result.
5. Click **Harmonize** to send the original Base, current flattened collage and prompt for a full-image AI harmonization. Upon success, the output becomes the new working Master. All earlier masks, options and layer structure are archived under **Harmonized 1, 2, ...**, with **Preview collage**, **Branch from edits** and **Use flattened**.

API-generated images are not perfectly geometry-constrained; masking guarantees outside-region pixels are left untouched by regional edits, but a full-image Harmonize may still change geometry. Region guide overlays are only for reference and can be toggled off.

### Activation / security

Required Vercel environment variables, set for Production (and Preview if using previews):

- `MOSAIC_ADMIN_USERNAME=arieladhidevara`
- `MOSAIC_PASSWORD_HASH` — run `node scripts/hash-password.cjs` locally, type the admin password (hidden), and paste the generated `scrypt:...` value into Vercel.
- `MOSAIC_SESSION_SECRET` — generate a strong random value with `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"`.

Never commit the real values. Redeploy to apply newly configured variables. Login uses a secure HTTP-only signed session cookie with an eight-hour expiry. There is an in-memory login attempt throttle, but for a public website you should also enable distributed rate limiting in Vercel Firewall.

The OpenAI API key is entered during Premium login and is kept **only in the current tab's JavaScript memory**; it is forwarded over HTTPS to the authenticated server function on each generation and then to OpenAI. It is not stored in the project history, cookies, localStorage, repository or environment variables. Refreshing the tab requires re-entering the key. ChatGPT subscription billing and OpenAI API usage are separate.

Endpoints: `/api/login`, `/api/session`, `/api/logout`, `/api/ai/edit`, `/api/ai/harmonize`. Requests are same-origin and require a valid session for the image endpoints. Image payloads are resized for the Vercel request size limit. All project editing/history remains browser-local; there is no persistent image database yet.

Use Vercel to run Premium; a plain local static file server runs only the manual editor.

## Move & Skew layers

Click an existing region or variation in **Layers** to select it. Mosaic activates **Move / Skew** on the canvas:

- Drag inside the outlined patch or its center handle to move the mask and image together.
- Drag any of the four corner handles independently to skew its shape.
- **Reset warp** restores the original location. Undo/redo also includes move and skew.
- Switching to Lasso / Rect / Oval edits the original mask; transforms are retained separately.
- Layer transforms are captured in exports, Harmonized snapshots, and restored history branches.

The original Base geometry is preserved separately from the working Master.

## UX notes (November 2026)

The main toolbar is grouped into **Select**, **Edit / Move**, and **Selection Mode**, while the primary actions **AI Edit** and **Harmonize** remain at the right. Wand tolerance only appears while Wand is active; brush size only appears while Brush/Eraser is active. Manual **Apply** appears only for an imported variation or edited saved mask. A concise workflow appears in the right inspector, with the full AI prompt behind an expandable Advanced section. Selection cursors remain regular arrows; Pan has a grab cursor. On small screens, selection tools scroll horizontally independently from the main AI buttons.
