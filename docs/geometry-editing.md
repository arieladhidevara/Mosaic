# Object-aware Shape / Remove editing (initial implementation)

This extends the current mozAI editor without Supabase project storage or a second generative Object-ID render.

## Interaction
- Select a single recognized object, then choose Material (existing cropped edit) or Shape in the floating prompt bar.
- Existing + image reference, drag/paste, Merge Objects and Add to Group remain available.
- Shape uses one full-frame RGB image generation, then the existing SAM segment_object endpoint for the new silhouette.
- Remove uses the selected object's old mask and generates revealed RGB behind it.
- Both operations show a review preview before committing; Discard leaves the project unchanged.

## Non-destructive scene data
- Geometry edits create new Options in the selected Group. Previous Options remain available.
- Compositing covers the union of the old and new silhouette, including newly revealed background.
- A separate geometryObjectMask stores the new object outline.
- Newly exposed pixels and provenance are retained in state.objectReconstruction.events.
- Nearby existing surfaces matched through SAM gain progressive texture/coverage entries, with tentative occlusion evidence.
- Unresolved ownership is unassigned rather than guessed.
- Existing local .moz Save/Open serializes scene metadata and canvases. The existing format is JSON-based, not a ZIP yet. No API keys are stored.

## Alignment and safeguards
- Unselected regions are protected by compositing from the original scene.
- Lightweight image-gradient translation alignment corrects small consistent offsets. If inconclusive, original image coordinates are retained.
- Full ORB/RANSAC homography and independent local geometry correction are not implemented yet.
- Implausible/missing SAM masks fail safely before Apply.
- Revealed pixels are AI-estimated, not guaranteed physical geometry.

## Known limits / next milestones
1. Add calibrated OpenCV homography with robust feature matching excluding edited masks.
2. Extend stable object matching for multiple moved, split, merged or visually identical objects.
3. Add stronger background ownership and confidence review for wall/floor/ceiling.
4. Upgrade .moz to ZIP-based assets and add IndexedDB crash recovery.
5. Add browser end-to-end tests with a configured SAM endpoint and architectural interior pairs.

SAM inference and OpenAI image generation still require their configured services. Project storage does not require Supabase.
