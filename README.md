# Mosaic — AI Collage Workspace

A zero-API, browser-only proof of concept for architectural AI render exploration. Combine the strongest parts of multiple AI-generated renders, group spatial alternatives, and export an AI harmonization handoff.

## What works

- Hidden Revit reference input (stored **in browser memory**, not uploaded to a backend)
- Visible master image with pixel-faithful base canvas
- Multi-upload AI variants, with heuristic automatic change detection versus the master
- Automatic spatial grouping of detected change patches, with one active variant per region (or Original Master)
- Lasso selection (freehand drag, then Enter), brush to reveal mask, eraser to hide mask, mask undo / redo
- Change-sensitivity slider; detect and ignore some subtle tone drift
- Before/after compare, fit and zoom, downloadable ZIP containing `01_Revit_Reference.png`, `02_Final_Collage.png`, and `03_Harmonization_Prompt.txt`
- Built-in synthetic demo scene, client-side image processing, no login or API keys

## Limitations / accuracy

Auto-detection is conventional image comparison (low-pass color, global median color normalization, morphological segmentation, connected components), **not AI design-intent classification**. It will make mistakes on global rerenders, altered perspectives, complex light changes, objects whose shapes moved, or subtle recoloring. Use lasso/brush/eraser to correct auto-generated masks. Input images should share the same camera/crop. The browser aligns sizes, not geometric features. Final harmonization happens manually in an external image AI, which may reinterpret the references.

Masks are stored per-patch and applied non-destructively when selecting a variant. No actual changes are written to the master image. All local project state is lost on refresh in this MVP; export your work. Original export resolution is capped to 2400px for the master to reduce browser RAM; reference images may be kept up to 4000px.

## Run

No npm packages required. Open `index.html` in a modern browser, or run a static server:

```bash
python3 -m http.server 8000
```

Then open `http://localhost:8000`.

## Deploy to Vercel

1. Create a new GitHub repository named `mosaic` and push the contents of this folder to the repository root.
2. In Vercel, choose **Add New → Project → Import Git Repository**.
3. Framework preset: **Other**, build command: **None**, output directory: **.** (root).
4. Deploy.

No environment variables, database, AI API, or server code required.

## Design and architecture

- `index.html` — UI structure
- `styles.css` — dark editor UI and responsive styles
- `app.js` — import, detection, region groups, canvas masking, ZIP writer, demo

Future improvements: true image registration / feature matching, explicit crop/transform controls, persistent project JSON, SAM-style object-aware masking and automatic design-intent classification, shared projects, integration with generative APIs.

License: MIT.