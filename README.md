# Mosaic — AI Collage Workspace

Mosaic is a manual-first, zero-API architectural AI collage editor. Choose exactly which parts to keep from multiple AI-generated variations, group alternatives by masked location, and export a ready-to-harmonize ZIP for ChatGPT or another image model.

## Workflow

1. Upload a **Revit reference** (stored locally in the browser and hidden from the canvas).
2. Upload a **master render** to display under all other images.
3. Upload one or more AI images. Each becomes a temporary top layer, one at a time.
4. Make a selection with **Lasso**, **Rectangle**, or **Ellipse**. Lasso supports both freehand dragging and click-to-place straight polygon edges. Close a polygon by clicking its first point, double-clicking, or pressing Enter. Hold **Shift** while dragging Rectangle/Ellipse for a perfect square/circle. Use **New**, **Add**, or **Subtract** for multiple regions; the dotted outline shows selected pixels.
5. Press **Enter** or **Apply** to keep only the selected region of the uploaded image. The unselected pixels are hidden non-destructively.
6. Refine a patch later with **Edit**, **Brush**, or **Eraser**. Overlapping patches from the same region are automatically grouped as alternatives, with the newest active.
7. Use **Compare master**: hold the button with a mouse to compare temporarily; on touch devices tap once to view master and again to return.
8. Export a ZIP with `01_Revit_Reference.png`, `02_Final_Collage.png`, and `03_Harmonization_Prompt.txt`.

The prompt can also be copied directly from the interface. No image-generation API or backend is used; the only network request is for the UI's Google Fonts, if available.

## Important notes

- **No automatic image difference detection**. The user decides what to select; grouping happens only *after* a mask has been applied.
- Grouping is a heuristic based on patch bounding-box overlap and normalized center distance. Distinct objects that overlap heavily may need a future manual split/ungroup feature.
- Variations should share camera position, aspect ratio, and crop. A different aspect ratio is drawn to fit the canvas and is not automatically geometry-aligned.
- Maximum import size defaults to 2400 pixels on the longest side to limit browser memory; hidden Revit reference can be imported at up to 4000 pixels.
- All project data is **in browser memory**, so refresh clears the session. Export the finished composition before leaving. No backend persistence or synchronization.
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