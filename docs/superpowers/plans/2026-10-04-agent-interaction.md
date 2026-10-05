# Agent interaction implementation plan

> Execute sequentially using the executing-plans workflow. The user's requested changes authorize implementation; no additional design approval is needed.

**Goal:** Compact sessions, meaningful activity indicators, interactive agent questions, and a visible permission-mode selector.

**Architecture:** Keep permission decisions and pending answers in the Electron controller. Persist session mode and question/answer snapshots in the existing store. Expose typed IPC methods and render question cards in the conversation. Keep the current neutral palette, rounded internal controls, square application frame and reduced-motion support.

**Permission contract:** `ask` confirms every tool, `auto` allows declared reads and confirms writes/unknown tools, `bypass` allows available tools without prompts. Questions always wait for human input. New and legacy sessions default to `auto`; mode is scoped to the session and inherited by branches. Changing mode applies to pending permission requests, never to questions. This is an explicit local policy, not Anthropic's classifier.

**Question contract:** The model may call `ask_user` with 1–3 questions, up to six choices, optional multi-select, and free text. The app validates both the question and response, resumes the same run, stores the answer in tool history, supports explicit skip, and cancels pending input on stop/exit. Stale or cross-session responses are rejected.

**UI contract:** 32px chat rows with 2px gaps. No dot for draft, completed, stopped or error states; a pulsing neutral dot for active work, solid yellow for pending permission or question. Mode selector sits below the composer. Question cards use custom rounded choices; no native dropdowns.

- [x] Add failing tests for permission policies, mode persistence, question validation, answer/skip/cancel/restart/history isolation.
- [x] Implement policy and question validation, controller waiting/resumption, tool schema, store migration, IPC.
- [x] Implement compact sidebar, mode dropdown, question cards and wiring.
- [x] Validate actual UI at desktop and minimum window size; verify mode changes, answering and status transitions.
- [x] Run tests/build, package 0.3.1 after freezing source, smoke the packaged executable with isolated data, document results.

Verification: 126 tests passed, real claude-opus-5-5 question/answer roundtrip passed, browser UI at 1280×900 and 800×620 passed, package integrity and portable launch passed. See `docs/interaction-0.3.1-verification.md`.

Ruling: render multi-question forms one step at a time after visual QA showed stacked forms obscuring the first question at the minimum window size. Reposition a pending question on resize and suppress stream-follow while input is pending. This preserves the question/answer contract and makes all primary controls usable in a compact window.

Review focus: pending-mode changes; stop/answer race; concurrent sessions with duplicate provider call IDs; malformed multi-select responses; restart recovery without phantom running indicators or repeated external effects.
