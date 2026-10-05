# Attachments, drop feedback and error notifications — 0.5.2

## Causes and changes

The installed Electron 44.5.1 exposes the asynchronous ClipboardItem API. A native probe reproduced `clipboard.readImage is not a function`; the old image/raw-format methods were being called by the main-process paste handler. The handler now reads Blob payloads through `clipboard.read()` and `item.getType()`. Copied Windows file lists take priority over thumbnails; supported images and UTF-8 text have bounded reads. Text copying also awaits the current API. Reference: [Electron clipboard documentation](https://www.electronjs.org/docs/latest/api/clipboard).

The exact reported `Invalid PNG image` error was reproduced with JPEG bytes saved under a PNG extension. Image imports now identify supported PNG/JPEG/GIF/WebP content, normalize mismatched image extensions, then perform the existing dimension, size and decoder validation. This is not a bypass for damaged files or arbitrary binary attachments. The user confirmed dragging from Explorer; the exact failing source file was requested but not provided during this turn, so its particular cause remains unverified.

The entire chat workspace accepts file drops. A short reversible opacity/scale transition shows readiness, count/capacity or blocked archive/processing states. Child-element drag transitions, drag cancellation and drops outside the target are handled; file drops do not navigate the app. Processing identifies the current file inside the composer. Successful items survive other failures in the same drop batch. Paste/drop are guarded against duplicate imports and archived sessions. Failed persistence no longer updates the visible attachment list as if it had saved.

Application errors now use a top toast with a six-second reading window, close control, live-region semantics and pause while hovered, focused or hidden. Repeated errors renew the timer. Failed model replies also notify while retaining their history error state. Existing success notifications share the same top position. The Enter hint and its styles were removed; keyboard behavior is unchanged. Motion respects app and system reduced-motion settings.

## Verification

- 159 automated tests passed. Six new ClipboardItem tests and one image-extension regression; the PNG test first reproduced the exact reported error. Existing malformed input, corrupt media, storage integrity and size limits remain covered.
- A real Electron process imported a constructed native ClipboardItem and an actual image from the current Windows clipboard. Preview and model image parts were produced. The clipboard was read, never overwritten. The temporary stored image snapshots were removed after verification.
- The same native checks passed against modules from the final packaged ASAR, including JPEG stored under a PNG extension. No provider/API calls.
- CUA exercised the real App with isolated fixture bridge responses and DOM DragEvents/FileReader: enter, child transition, leave, drop, processing, successful preview, partial failure preserving valid files/draft, plus-menu clipboard success/empty error, eight-file limit, archived chat, reduced motion, manual dismissal, automatic dismissal and hover pause.
- Desktop 1280×800 and compact 800×620 inspected; no horizontal overflow or browser application errors. Browser fixture controls are excluded from the release. Native OS Explorer mouse gestures are not directly automated by this environment; browser drag-event coverage and native backend verification are separate.
- TypeScript/Vite and portable packaging passed. Source/output frozen during packaging. Final renderer and changed Electron module bytes match ASAR; version 0.5.2; no application fixtures/credentials in the package; removed hint absent from runtime JS.
- Actual portable EXE launch exited 0, `loaded=true`, `sandbox=true`, with a fresh isolated profile. Native screenshot inspected. Real user key, chat history and settings were untouched. Temporary browser tab, viewport override and dev server cleaned up.

Executable: `release/Turwe-Code-0.5.2-Windows.exe` (138273872 bytes).
SHA256: `7d5cf1d8e4c79865dec0a586453dbb3779403fde6910018ecbb9ff5af3a32f98`.
Evidence: `../../Artifacts/turwe-code/attachments-0.5.2/`.
Selected [Lazyweb evidence](https://www.lazyweb.com/agentic-search/6bb4bafd-984a-4194-936b-eada6a0bd235) finalized privately; no growth report or public sharing.
