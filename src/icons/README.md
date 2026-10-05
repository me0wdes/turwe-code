# Mishanaer icons

Source: https://mishanaer-icons.vercel.app/

Round Stroke and Round Filled pairs are downloaded from the catalogue links in `source-manifest.json`. Original SVGs are kept in `assets`; `geometry.ts` contains their static path geometry. Any local adaptations are explicitly listed under `derivations` in the manifest and kept alongside their unchanged source pair. Regenerate with `node scripts/import-mishanaer-icons.mjs`.

`Icon.tsx` renders both variants at the same size. `active` or a selected/open/checked parent control switches to Filled; the ordinary state is Stroke. CSS transitions respect the app's reduced-motion setting. Icons are bundled locally and require no runtime network requests. The full-24px clip in `code.svg` is represented by the outer SVG viewport clip to avoid shared DOM IDs; path geometry is unchanged.

Export names describe the existing app actions; `source-manifest.json` records the mapping to catalogue names. The sidebar toggle uses `PanelLeft`, a documented adaptation of `grid-columns-2`: the outside frame, corner radii and edge thickness follow the original, while the left section is narrower. In Filled, only that section and the outer frame are filled, keeping the window silhouette instead of resembling a pause button. The older `PanelLeftOpen` and `PanelLeftClose` exports remain available for compatibility. File search uses `magnifying-glass`, and the spinner uses the catalogue's rotate arrows. The Turwe mascot and chat status dots are separate app graphics.

`ListQueued` uses the unchanged catalogue pair `indent-increase`: list lines with a right-pointing chevron identify pending messages and the next queue item. Its Filled variant fills the chevron; it is not a locally drawn replacement.
