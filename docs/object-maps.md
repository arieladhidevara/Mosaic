# Base object maps

Continue with Base only, an uploaded working Master, or a finished generated
Master starts one background `gpt-image-2.6-sunburst` image edit when the saved
BYOK connection is ready. Base upload alone and the provisional Base shown
during initial Master generation do not start mapping. `/api/ai/object-map` requests a flat
PNG in a fixed 64-color palette at the submitted dimensions. A lightweight
`gpt-4.1-mini` vision call assigns Group categories. Both are billable calls.
The browser validates dimensions and flat colors, then saves the index raster
and categories in `.moz`. Reopening a project or returning to a cached working
image reuses its map. The map request targets about one megapixel, with edges
on a 16-pixel grid and the same framing. For example, 1024x608 becomes 1344x800;
the server rejects requests below the minimum pixel budget before inference.

Colors are split into spatial instances. Distant components sharing a color
become separate objects; nearby small fragments can attach to their dominant
local component. Isolated flecks are removed without bridging distant objects.
Legacy saved maps are upgraded locally, without another provider request.

Wand looks up the prepared instance under the cursor and stays active until a
different tool is chosen. Pointer replaces the former Select label; Pan uses an
icon. A plain Wand click replaces the previous selection, even after Add mode;
Ctrl/Cmd-click adds another independent object and Alt-click subtracts one.
It preserves holes without SAM or a browser model. Prepared objects appear by
name in the inspector; their canvas masks appear only when selected, with a thin
purple overlay. Physical object instances, including adjacent same-material
objects, must get distinct contrasting palette colors in the map prompt.
Auto Select works
with Rectangle, Oval and Line/lasso: objects with at least half their mapped
area inside the drawn shape are selected in full. This avoids selecting a whole
wall from a grazing edge. Manual selections remain available with Auto Select off.

Selection alpha is binary. Bounded contour simplification straightens zigzags
without softening alpha. Real voids stay empty and overlapping boundaries have
one pixel owner; small visible objects take priority at shared boundaries.
The Feather edges control is removed and compositing uses hard masks. With an
active object selection, Add/Subtract via Rectangle, Line or Freehand modifies
the exact pixels rather than snapping the edited mask back to the original
object. Selection history retains the independent object identities.

Generate submits one union crop, its full-image coordinates, mask and context.
Crop padding is 15% with a 48-pixel minimum. The result is placed at that offset,
clipped to the original masks, and split by object instance. The inspector shows
explicit Group containers containing individual objects (Table, Chair), each
with independent Options. A prepared mask is an ungrouped Object. Groups can be
created/renamed manually in the right inspector; the AI group button applies
scene suggestions (e.g. Dining area) from the initial semantic legend. Objects
move through the right-side group menu or Add to group on the multi-selection
prompt bar. Neither action combines masks. Merge to object on that bar creates
a persistent union object, while retaining the pre-merge appearance and options
of archived children. Subsequent Wand clicks on any member select the union.
Generated Options appear after their image arrives. Editing
one object preserves its neighbors and respects newer option choices. Legacy
category-wide Options are split into per-object Options during local migration.
Independent region requests use a pool of three; selecting or submitting a new
object does not wait for an earlier one. Each request freezes its masks, crop
and offsets and can complete out of order without overwriting another object.

Missing AI connection waits for the normal key-connected event. Failed requests
require explicit Retry. Editing Base invalidates its map and requires explicit
preparation again. If category labeling fails, the UI says so and unlabeled
objects use Other. Dimension/palette checks cannot guarantee that generative
object boundaries exactly match Base.

Tests: `node --test tests/object-map-cleanup.test.mjs tests/object-map.test.mjs tests/object-map-provider.test.cjs`.
With an isolated mock-provider server:
`python tests/browser-runner.py object-map-scenarios.js runObjectMapChecks`.
Lifecycle checks: `object-map-failure-scenarios.js runObjectMapFailureChecks`.
Generated-Master checks: `generated-object-map-scenarios.js runGeneratedObjectMapChecks`.
Instance/migration/occlusion checks: `object-instance-scenarios.js runObjectInstanceChecks`.
Current Wand/Groups/merge/concurrency flow:
`wand-management-scenarios.js runWandManagementChecks`.

Regional result validation rejects a fully black or transparent provider frame
before it is saved as an Option. A dark object inside a visible scene remains
valid. `state.lastGenerationIssue` records the failing stage, generation ID and
pixel statistics, without images or credentials. This helps distinguish a bad
provider frame from crop/compositing failures; it does not establish the cause
of an earlier result without its payload. Browser checks:
`region-result-scenarios.js runRegionResultChecks`.
