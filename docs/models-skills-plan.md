# Models, project skills and rounded controls — 2026-10-04

User-approved scope: live provider model catalogue; rounded custom dropdowns; wider composer with project selection; no Discussion/Local controls; working SKILL.md library with project assignments and explicit chat invocation.

## Contract
- GET /models returns deduplicated exact IDs and provider display names. Never invent model names or append stale aliases. Refresh after credential changes and on demand; show errors. Preserve current session model rather than silently redirect requests.
- Import or author SKILL.md instructions, parse real YAML frontmatter, persist library and per-project assignments. Project-local .claude/skills and .agents/skills can be imported explicitly. Project instructions apply automatically unless manual-only. @name, /name and $name explicitly invoke user-invocable skills; arguments expand. Snapshot instructions into each user message so retries and later turns retain their original context.
- Supporting local Markdown/text references are confined to the selected skill directory and bounded. Unsupported script execution or fork/agent requirements produce an actionable incompatibility error, never a silent pretend execution.
- Radix menus provide focus, keyboard navigation and selection; motion respects the existing setting and reduced-motion. Composer grows to 780px; project selector sits inside the input toolbar. New Skills navigation opens a searchable library/editor with project assignments.
- Existing conversations, credentials and project files survive migration. Imported skills are copied into the application's library; source files are not modified.

## Tasks
1. RED tests for model catalogue normalization, skills parsing/import/invocation/project isolation; implement backend and read-only live catalogue probe.
2. Build library/editor and accessible dropdowns; integrate bridge, model refresh, project context and chat skill suggestions.
3. Verify tests/build, browser keyboard flows and native smoke launch; create portable 0.2.0. Fresh final review, fix important findings, document limits and release.

## Review focus
Old workspaces, malformed frontmatter, duplicate skill names/scopes, reference traversal/junctions, disabled invocation, stale model requests across endpoint changes, native UI wiring, draft and project isolation, unsupported skill execution.

## Ledger
The workspace has no Git repository; keep this plan and verification evidence on disk. No commits or worktree operations apply. The user already approved implementation; no repeated design approval gate.

Task 1: complete — model/skills/controller tests observed RED then GREEN. Latest suite 36/36. Live GET /models on 2026-10-04 returned Base, Cheap, Frontier only; no generation request made.
Task 2: complete — TypeScript/Vite pass. Browser UI verified library creation, saved card, invoke-to-chat, @ completion with Enter, rounded model/project menus and keyboard Escape. Native selects removed. Current composer 780px, project control inside toolbar.
Task 3: in progress — fresh review and native/release validation remain.

Final review: fresh read-only review by skills_final_review (gpt-6-astra). No Critical findings or deferred minors. Three Important issues reproduced as failing tests, then fixed in one pass.
Final: fixed personal skill scope on edit — editing a personal skill inside a project filter preserves all project assignments RED→GREEN, suite 39/39.
Final: fixed lost script incompatibility on edit — editing an imported script skill retains incompatibility and cannot enable invocation RED→GREEN, suite 39/39.
Final: fixed stale reference context — editing references removes obsolete context and rejects missing new reference copies RED→GREEN, suite 39/39.
Final review exclusions: live provider generation is not claimed; today only GET /models was requested. Native visual/portable checks are performed separately by the implementer and recorded below, rather than inferred from source review.

Task 3: complete — review fixes verified, 39/39 tests, TypeScript/Vite pass, native single-instance test pass, portable 0.2.0 built and launched successfully. Screenshot inspected; package contains skills/YAML but no user data. Verification: docs/verification.md. Plan retained because there is no Git history.
