# Mosaic — AI Collage Workspace

Mosaic is a manual-first architectural AI collage editor with a Premium workflow preview (the OpenAI API is not yet connected). Choose exactly which parts to keep from multiple AI-generated variations, group alternatives by masked location, and export a ready-to-harmonize ZIP for ChatGPT or another image model.

## Workflow

1. Upload a **Revit reference**. It becomes the initial visible canvas when no master has been chosen; enter the project design-intent prompt in the dialog.
2. Optionally upload a separate **master render**, or keep working directly over the Revit image.
3. Upload one or more AI images. Each becomes a temporary top layer, one at a time.
4. Make a selection with **Lasso**, **Rectangle**, or **Ellipse**. Drag Lasso freehand or click points to create straight polygon edges; close the polygon at the starting point, by double-clicking, or with Enter. Hold **Shift** while dragging Rectangle/Ellipse to constrain to a square/circle. Use **New**, **Add**, or **Subtract** for multiple regions; the dotted outline shows selected pixels.
5. Press **Enter** or **Apply** to keep only the selected region of the uploaded image. The unselected pixels are hidden non-destructively.
6. Refine a patch later with **Edit**, **Brush**, or **Eraser**. Overlapping patches from the same region are automatically grouped as alternatives, with the newest active.
7. Use **Compare master**: hold the button with a mouse to compare temporarily; on touch devices tap once to view master and again to return.
8. Export a ZIP with `01_Revit_Reference.png`, `02_Final_Collage.png`, and `03_Harmonization_Prompt.txt`.

The prompt can also be copied directly from the interface. There is **no image-generation API or backend yet**; image processing is local and the UI may fetch Google Fonts.

## Important notes

- **No automatic image difference detection**. The user decides what to select; grouping happens only *after* a mask has been applied.
- Grouping is a heuristic based on patch bounding-box overlap and normalized center distance. Distinct objects that overlap heavily may need a future manual split/ungroup feature.
- Variations should share camera position, aspect ratio, and crop. A different aspect ratio is drawn to fit the canvas and is not automatically geometry-aligned.
- Maximum import size defaults to 2400 pixels on the longest side to limit browser memory; hidden Revit reference can be imported at up to 4000 pixels.
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

## Premium AI workflow preview (no API connected)

The Premium UI and non-destructive data model are implemented for product testing, **not as an active paid entitlement or AI integration**. There is no checkout, authentication, billing, API key, network image request, or security boundary. Implement a server-validated entitlement before charging for or restricting production functionality.

1. Import the Revit reference. The design-intent dialog captures a **project prompt**. This is reused in the harmonization instructions.
2. Lasso an area without importing a new variation, then choose **✦ Prompt area** and enter an edit instruction. Mosaic saves a request including the current composition, original Revit reference, exact selection mask, and prompt. It immediately creates a region-group option marked **awaiting image**.
3. Until an OpenAI image-generation endpoint is wired, click **Add result** in that option and attach a full-frame generated image (same framing/crop). Mosaic automatically clips the attached result to the saved mask; no second manual lasso is needed. Normal manual variation masking remains available.
4. Choose **✧ Harmonize** to review the prompt. For now this makes a **local flattened snapshot** of the current composition and records an intended handoff of originalRevit + collage + prompt. It does **not** claim to generate an AI-harmonized image.
5. **Harmonized 1, 2, ...** appear as gray expandable history groups. Expand them to preview earlier material alternatives; **Branch from edits** restores their editable masks and groups to the canvas, while **Use flattened** starts from the previous flattened image. Old harmonized snapshots remain available after further harmonizations.

Archived nodes preserve: base image, group IDs, every variant source image, edit prompts, selection masks, active variants, flattened output, and the parent history node. The current working image becomes a single flattened base after Harmonize. The original Revit reference never gets overwritten. History remains available in the current browser tab only.

### Backend connection contract (future)

Do not call OpenAI from premium.js, as that would expose an API key to visitors. Add a server-side authenticated endpoint, enforce Premium entitlements and quotas, then replace the local provider placeholders:

- **edit-region**: send baseImage PNG, original Revit PNG, the saved full-resolution transparent selection mask PNG, region prompt, and project prompt. The provider returns a full-frame generated image. On response, clip pixels by the original mask, and attach the result as a new variant in its region group.
- **harmonize**: send original Revit PNG, flattened collage PNG, and harmonization prompt. The provider returns a harmonized full-frame result. Save that returned image as the history node's output/current base, while preserving the pre-harmonization layer tree.
- Validate ownership, premium entitlement, payload sizes and model costs on the server. Add image storage/IndexedDB to persist the larger non-destructive history; browser memory is prototype-only.

**Structural fidelity:** mask compositing locks pixels outside the selection for regional edits. Full-image harmonization can change geometry inside or outside edited areas; preserve the Revit reference and offer visual comparison rather than promising pixel-perfect geometry.

### Important UX limitation

When selecting an alternate archived variant, Mosaic shows a preview of that historical *pre-harmonization collage*. This does **not** retroactively regenerate the old AI result; choose **Branch from edits** to work from that alternative and harmonize again.
