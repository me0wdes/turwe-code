# Subagents 0.5.0

## Behaviour

`delegate_tasks` runs 1–3 real independent child conversations concurrently through the configured OpenAI-compatible provider. Children inherit the project, selected attachments, a snapshot of the user's skills, and the root session's live permission mode. They can use the same available tools and delegate one further level. Limits: 3 concurrent child API requests across the controller, 6 descendants per root response, depth 2. Waiting for descendants releases the API slot.

Root stop cancels the tree; individual stop cancels only that agent's subtree. Duplicate provider tool IDs in different agents are namespaced. Results, questions, tool receipts and nested histories persist inside the parent response. Restart interrupts unfinished work and reconstructs the interrupted delegation result from saved children, including completed tool outcomes. Retry does not re-execute completed child actions.

The composer widget shows real task and tool activity. Its side panel supports questions, approvals, cancellation and navigation among all agents belonging to the saved response. Historical siblings remain reachable after newer messages. Settings → Interface → Subagents controls future delegation; disabling it preserves history.

## Evidence

- Test-first runtime checks include concurrency, isolated context, inherited project/attachments/skills/model, nesting and total bounds, cancellation in queue, one-child vs root stop, sibling duplicate call IDs, dynamic permission changes, questions, restart and retries.
- A full MCP catalogue regression reproduced 129 tools; reserving a delegation slot keeps the provider request at 128.
- Fresh reviewer identified inaccessible historical siblings and missing completed results after interrupted-group restart. Both reproduced before fixes, then verified in the renderer / real store-controller tests.
- Live `claude-opus-5-5` test at `ai.lab.pics/v1`: root delegated two arithmetic tasks, two child requests overlapped, each returned 42, then root synthesized both. Four actual API requests; no project or user content sent. Saved key remained encrypted and was never logged.
- CUA renderer QA at 1280×800 and 800×620: nested list, selected panel, question submission, permission approval, separate stop, collapsed attention shortcut, historical sibling access, settings. No application console errors or horizontal overflow.
- Production package and native smoke evidence is recorded in `Artifacts/turwe-code/subagents-0.5.0` and the project progress ledger after packaging.

## Boundaries

This implements orchestration over the configured API, not Anthropic's Agent SDK. Additional agents use additional API requests. Delegation requires a model/provider that supports function calls; unsupported calls surface as errors. Existing local read / GitHub skills / MCP tools remain the tool set; no shell or local file-edit tools are added. Partial results sent to the parent are bounded; complete transcripts remain in the panel. Do not delegate overlapping external mutations.

## Final production checks

Full suite: 152/152. TypeScript/Vite and electron-builder portable package passed. Final ASAR matches all changed backend files and renderer assets byte-for-byte; application QA fixtures and credentials excluded. Native packaged launch and interrupted-history launch both exit 0, loaded=true, sandbox=true. Recovered root/unfinished child stopped; completed sibling still returns 42 in reconstructed parent history. Screenshots inspected. Test browser tabs, viewport override, dev server and temporary encryption profile cleaned up. Real user profile not modified.

Deliverable: release/Turwe-Code-0.5.0-Windows.exe, 138268510 bytes. SHA256: 22642478623e2d17c1dc7bb449ffc8831f108973909c623c18e5830c12501d5d.
