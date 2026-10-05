# Chat capabilities implementation plan

Goal: install public GitHub skills from chat, attach real images/documents/video, and call MCP tools including Figma from the Windows app.

Architecture: keep the sandboxed renderer and typed IPC. The main process owns an immutable attachment store, GitHub installer, encrypted MCP configuration/OAuth, and bounded model/tool orchestration. User messages retain attachment IDs and instruction snapshots. Tool calls and results persist as a valid protocol transcript. Existing credentials, sessions, projects, palette, motion, icon states and square outer window remain compatible.

Execution: use dispatching-parallel-agents for the three independent backend modules; integrate and verify in the main task. No change requires another design approval because the user has requested the implementation.

## Contracts and tasks

1. `electron/attachments.cjs`: createAttachmentStore, importFiles/importBytes/get/preview/prepare. Copy files into userData, prepare text and vision content, sample timestamped video frames without claiming audio support. Bound sizes, decode failures, paths, process time and cancellation. Unit fixtures and a native end-to-end attachment probe.
2. `electron/github-skills.cjs`: inspect public repo/tree/blob URLs, pin a revision, enumerate SKILL.md candidates, install selected skill and linked text references through existing skill semantics. Reject silent overwrite and traversal. Mock-network tests; live read-only repo probe.
3. `electron/mcp*.cjs`: SDK Streamable HTTP/stdio, Figma Remote OAuth and Desktop presets, encrypted secrets, explicit connect/disconnect, tool schema enumeration and execution. Local MCP fixture tests and OAuth callback tests; real Figma authentication remains an interactive user action.
4. `electron/api.cjs` and `controller.cjs`: handle fragmented streamed tool calls, multimodal messages, bounded tool rounds, stop and retry, persisted call/result pairs. Tool permission review for MCP operations with side effects. GitHub installation requires the user to approve a concrete repo/skill action in chat unless directly initiated in the Skills UI.
5. `main.cjs`, preload, types and bridge: validated IPC for attachments/clipboard, GitHub, connectors, tool decisions, regenerate/edit branches, chat export. Include saved draft attachments and recover interrupted tools safely.
6. Renderer: plus menu (photos/video, files, clipboard), paste/drop and attachment previews; GitHub install dialog; MCP connectors screen with Figma presets; compact tool cards and actionable permissions. Add edit/resend as a new branch, regenerate, code copy and Markdown export. All menus use existing rounded animated primitives.
7. Verify: node tests for protocol, history, cancellation and modules; build; real saved-provider image/tool probes without logging credentials; browser interaction/console/viewport checks; packaged Windows smoke on isolated profile. Record accurate supported formats and limitations in README/verification ledger.

## Global constraints and review focus

- Preserve real user data and key. Never send local files before user submission.
- No hidden command execution, auto-installed MCP commands, reuse of Codex connector credentials, or fictional success.
- Video is sampled visual frames, not native audio/video understanding; scanned PDFs require images if no extracted text.
- Tools must be advertised and actually available; reject malformed/unknown calls, cap loops/results and honor stop.
- Data received from files, repositories and MCP is untrusted task data.
- Focused Lazyweb references inform the existing product UI; no unrelated redesign.
