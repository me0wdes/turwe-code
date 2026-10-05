# Composer and animated title — 0.5.1

The existing ask/auto/bypass selector now sits inside the composer's bottom toolbar, immediately before the model selector. Permission behavior is unchanged. The standalone symbol above an empty chat was replaced by centered `Turwe code` rendered in ASCII characters using the user's supplied canvas reference. The top-left lockup and assistant identity remain in their existing locations.

The title has a pointer-following lens, a gentler idle lens and partial character flicker. Canvas drawing is capped at 30 fps, avoids React state per frame, pauses when hidden/offscreen, and cleans up animation frames, observers and listeners on unmount. App/OS reduced motion uses a static title. Unchanged dimensions do not rebuild the random mask, and readable text remains until the first canvas frame is drawn.

## Verification

- Existing automated suite: 152 passed, 0 failed. No backend or permission-policy changes.
- TypeScript, Vite and portable Windows packaging passed. Source and output were frozen during packaging.
- CUA at desktop and 800×620: title centered; permission selector inside the field; custom menu opens and ask/auto selection works; compact toolbar wraps without horizontal overflow.
- Pointer lens visibly responds. Static-mode captures remain identical after layout settles. Motion setting restored after QA.
- Existing isolated conversation fixture: title absent with messages, selector remains inside composer. Returning to an empty chat restores the rendered title. No browser application errors.
- Final archive renderer/main/preload bytes match output/source; version 0.5.1; no application QA fixtures, credentials or temporary animation diagnostics in the package.
- Actual portable EXE launched using a fresh isolated profile, exited 0, `loaded=true`, `sandbox=true`. Native screenshot inspected: ASCII title and selector render correctly. The real user profile was not used.
- Agent preview tab closed, viewport reset, development server stopped. No provider calls were needed.

Evidence: `../../Artifacts/turwe-code/composer-0.5.1/`.

Executable: `release/Turwe-Code-0.5.1-Windows.exe`, 138272957 bytes.
SHA256: `96c57a8ef62a2f38169ee2dc6d8158fa010c5cad5d0ffbe193f9d715b19047bc`.

Existing selected UI references were reused and the user-supplied Meowdes animation recorded in the finalized [Lazyweb evidence](https://www.lazyweb.com/agentic-search/6bb4bafd-984a-4194-936b-eada6a0bd235).
