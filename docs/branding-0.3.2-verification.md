# Turwe branding 0.3.2

Source: [user-provided Figma component set 27:30](https://www.figma.com/design/MXoC4WtWzmBIxNTXSdLxEK/Turwe?node-id=27-30). Exported through the Figma Plugin API as SVG: symbol `137:1280`, lockup `27:31`.

The symbol matches the exported SVG byte for byte. The lockup changes only the wordmark fill from `#DFE4FD` to `#ECECEC`; geometry and silver gradients are unchanged. The header lockup is 32 px tall, the composer symbol 46 px, and the assistant identity 20 px. The sidebar toggle remains accessible next to the lockup.

Windows icons use the original symbol on a neutral `#212121` tile. The PNG is 512 px; ICO frames are 16, 20, 24, 32, 40, 48, 64, 128 and 256 px. Both the portable launcher and packaged Electron executable contain all nine frames, each matching the source PNG bytes. Window, favicon and UI assets are local and included in the package.

## Verification

- 126/126 existing tests pass; TypeScript, Vite and electron-builder pass.
- CUA checked the header, source asset loading and sidebar open/close at 1280×800 and 800×620. No horizontal overflow, broken logo, framework overlay, console warnings or errors. Exterior window radius remains 0.
- Native portable launch with an isolated profile: exit 0, loaded=true, sandbox=true. Screenshot inspected. No real user profile or API credentials were used.
- The first launch under the restricted terminal environment stalled. The identical executable launched successfully outside those terminal restrictions; no application code or runtime sandbox settings were changed.
- ASAR branding assets, main process and entry HTML match the source build. Source and generated assets were kept unchanged during packaging.
- Existing [Lazyweb reference selection](https://www.lazyweb.com/agentic-search/6bb4bafd-984a-4194-936b-eada6a0bd235) was reused and annotated for this direct branding change.

Evidence: `../../Artifacts/turwe-code/branding-0.3.2/`. Includes original Figma SVGs, build/test logs, browser and native screenshots, the reproducible icon conversion script, and PE/ASAR verification. Deliverable: `release/Turwe-Code-0.3.2-Windows.exe`, 138,259,466 bytes.

SHA-256: `7ba259ee5198f9e96c8121e8e451bd02987c77101aa7dc421be694dde03705e1`.
