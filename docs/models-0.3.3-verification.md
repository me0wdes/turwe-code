# Model selection 0.3.3

User-requested choices for ai.lab.pics: Claude Opus 5.5 (`claude-opus-5-5`), Claude Sonnet 5 (`claude-sonnet-5`), GLM 5.3 (provisionally `glm-5.3`). Exact IDs and display names live in `electron/model-catalogue.json`, shared with the frontend.

Base, Frontier and Cheap are removed case-insensitively from this provider's choices, including catalogue refreshes. Known direct IDs stay selectable even when omitted by the provider or when a catalogue request fails. Other valid returned IDs and manually entered custom IDs are retained. Other providers keep their own catalogues.

New installations default to Opus. Existing lab routing selections in settings and sessions migrate to Opus; past assistant model metadata remains unchanged. Older assistant messages without model metadata retain their former session model as a historical label. Custom selections survive migration. Browser preview uses the same catalogue and equivalent migration rules.

## Verification

- 131/131 tests pass, including repeated catalogue updates, exact IDs/order, alias filtering, provider isolation, rejected catalogue requests and idempotent old-profile migration.
- TypeScript/Vite/electron-builder succeeded. Existing bundle-size warning remains; no runtime errors observed.
- CUA at 1280×800 and 800×620: three choices, stable order, Sonnet selection survives reload, GLM selectable, exact Sonnet ID in settings, presets remain after a failed refresh. No console warnings/errors, clipping or horizontal overflow. Temporary browser settings restored; tab, viewport override and development server cleaned up.
- Live saved-provider request with `claude-sonnet-5`: HTTP 200, answer `OK`.
- Live `glm-5.3`: HTTP 400 `upstream rejected request` for both streaming and non-streaming requests. `glm-5-3` also returns HTTP 400. GLM's exact working provider ID/availability remains unconfirmed; this is not represented as a successful generation test. An optional clarification about the provider's exact ID was sent to the user.
- Live catalogue refresh through the application's adapter returns the three configured choices and no routing aliases. This is the application-normalized catalogue, not a claim that the raw provider catalogue lists the direct IDs.
- All changed packaged backend files, shared JSON, entry HTML and frontend assets match the frozen source build. The verification script normalizes Windows paths before reading nested ASAR entries.
- Portable Windows executable launched with an isolated legacy fixture: exit 0, loaded=true, sandbox=true. Former Base default and Frontier session both persisted as `claude-opus-5-5`. Native screenshot inspected; test process exited. Actual user history/settings were not modified by verification; saved credentials were only read for synthetic provider probes.

Evidence: `../../Artifacts/turwe-code/models-0.3.3/` (logs, screenshots, provider reports, migration fixture and archive verification). Reused [Lazyweb selection](https://www.lazyweb.com/agentic-search/6bb4bafd-984a-4194-936b-eada6a0bd235).

Deliverable: `release/Turwe-Code-0.3.3-Windows.exe`, 138,261,033 bytes.
SHA-256: `ae5a02eec6b5da61662ba2ab16964df2045f0bb6263e521122b1d477d6624138`.
