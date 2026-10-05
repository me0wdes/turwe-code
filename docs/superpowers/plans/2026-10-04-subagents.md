# Subagents Implementation Plan

> Execution: superpowers:executing-plans, directly in the existing non-Git workspace.
**Goal:** Real concurrent subagents, durable activity tree, inherited permissions and live UI.
**Architecture:** Reuse controller.run for nested sessions stored in Message.agents. delegate_tasks joins children and returns explicit results. A semaphore limits only child model requests so nested joins cannot deadlock.
**Tech Stack:** Existing Electron CJS, React/TypeScript, Motion, OpenAI-compatible gateway.
**Spec:** ../specs/2026-10-04-subagents-design.md

## Constraints
No new runtime dependencies. 3 parallel child requests; 6 children per root reply; 2 nesting levels. Preserve existing credentials, projects, messages, attachments, skills and MCP. Do not mutate real user state in QA. Freeze production files during packaging.

## Review focus
Cancellation during queued request; duplicate tool IDs in sibling agents; inherited ask/auto/bypass changes; restart with pending question; retry after successful child tool mutation.

## Task 1: Runtime and lifecycle
- [x] Add tests/subagents.test.cjs using real createStore/createController and deterministic stream stubs. Assert concurrency, isolation, result synthesis, nesting/depth/total bounds, stopping one/tree, question/approval routing, restart and retry.
- [x] Run new tests and inspect expected failures.
- [x] Create electron/agents.cjs with definition, task validation, tree traversal and cancellable request gate. Extend controller.cjs run context, delegate handler, child input routing and stopAgent.
- [x] Extend store.cjs startup interruption recursively and settings.subagents default true.
- [x] Run targeted tests then npm test.

## Task 2: UI and desktop bridge
- [x] Add AgentRun/Message.agents types, stopAgent and optional agentId on approval/answer IPC.
- [x] Extract reusable ToolCalls from Conversation. Add AgentActivity widget/list and AgentPanel with real outputs, questions and approvals.
- [x] Integrate historical launch links and composer widget into App; propagate child attention into sidebar.
- [x] Add settings toggle and restrained motion/styles with reduced-motion support.
- [x] Run TypeScript/Vite and exercise the actual app plus isolated UI fixture via CUA at 1280x800 and 800x620.

## Task 3: Production verification
- [x] Run full tests, controlled synthetic live API round trip with only test prompts, no project content.
- [x] Update version/README, finalize Lazyweb useful references, package frozen source.
- [x] Verify ASAR bytes, native portable launch and restart fixture; inspect screenshots; clean owned processes/tabs. Deliver executable and material limits.
