# Phase 05: wording

## Completion note — October 8, 2026

Status: implemented on `phase-05-wording`.

Review follow-up, October 8, 2026:

- The queued-turn limit notice reads **per project** or **per workspace** from the active Node's
  mode. A component test renders the blocked-by-limits view in each mode and checks the full limit
  sentence. The earlier desktop walk remains the UI evidence for the other surfaces.
- Settings projects its core declarations once for each Node mode before rail search and palette
  registration. Separate mode removes the unavailable **new workspace** and move-project search
  terms and the hidden Workspace row, and renames the last-scope shortcut. The search index receives
  the same category label as the rail. Focused tests cover off/on search results and command
  registrations rebuilt after a mode change; grouped wording remains intact.
- A TypeScript AST audit of first-party desktop, client, Node, protocol, and plugin literals found
  the remaining visible agent handoff prompt, database restoration error, Linear connection hint,
  and reachable Node errors. The Linear hint explicitly names Linear workspaces. Grouped-only
  controls, the first-run grouping question, and stable identifiers retain their workspace terms.
  The `WorkspaceWords` type is readonly and its shared values are frozen. Workflow server formatting
  and the duplicate words import are corrected.
- Focused runs passed: Settings index (4), Settings view (21), command registration (10), queued
  turns (4), Node workspace mode (9), linked projects (4), issue detail (4), source context (1),
  database restoration (1), notes storage (11), and Linear provider (14). Client-core, desktop,
  Node-core, agents, workflows, notes, Linear, and plugin-api scoped type checks passed; all 87
  architecture checks passed. The stock Node build measured 3,149,554 B against the 3,150,000 B
  ceiling. The database restoration test passed.
- Coordinator integration, October 8, 2026: the database route fixture was the remaining consumer
  missing the identity argument introduced in phase 01. It uses the testkit's memory identity store
  bound to the fixture caller. The database typecheck and 47 route tests passed. Merged Settings,
  palette, and command-session checks passed (94 tests), as did the queued-turn checks (four).

- `client-core` exports `workspaceWords(mode)` and the reactive `createWorkspaceWords()` through
  `plugin-api`. Desktop components and first-party plugins read the active Node's mode when they
  render. Palette commands evaluate their labels, hints, and placeholders when read; the palette
  toggle and last-scope shortcut registrations refresh when the mode changes. This keeps labels
  aligned when the active Node changes without changing command IDs or routes.
- Separate mode says **project** in the desktop picker, rail feedback, Home and archive surfaces,
  data-source reach, Settings navigation and search, Agent Center, notes, and workflows. Grouped
  mode retains **workspace** in those views. Registration-time plugin metadata and Node-built
  descriptions use neutral scope wording where they cannot safely read a reactive client mode.
  The first-run grouping question remains intact while the mode is unset. TUI wording remains for
  phase 06, which can use the shared helper.
- The separate-mode project deletion confirmation says that deleting the project removes its
  project scope, links, and datasets. It also says that Home boards, notes, saved queries, and
  workflow definitions remain stored but become inaccessible. Disk content remains untouched.
- Focused checks passed for navigation commands, Settings, project deletion, source queries,
  notes commands, workflow launch, agent limits, Node task-source fields, and the plugin API.
  Touched-package TypeScript checks, scoped oxlint, and all 87 architecture checks passed.
  The stock Node build passed its size gate at 3,149,589 B of 3,150,000 B. The combined repository
  lint and test gates remain for the coordinator after phase 06; the previously recorded backup,
  client ratchet, and desktop plugin-disable failures have no established baseline here.
- Isolated `--vite` desktop sessions with `--workspaces off` and `--workspaces on` covered the
  picker, Home, Settings and deletion, Agent Center, workflows, archive, and notes. Off-mode
  snapshots showed project wording; grouped-mode snapshots retained workspace wording. Screenshots
  were inspected under `.acorn/agent-dev/pw-words-off/screenshots/` and
  `.acorn/agent-dev/pw-words-on/screenshots/`. Both sessions were stopped. The desktop driver
  cannot operate native menus or dialogs, so palette activation was checked through command tests
  and shortcut labels in Settings. Automatic approval review rejected a computer-wide UI inventory
  because it could enumerate unrelated desktop surfaces; no wider UI automation was used.
- The task script status probe failed on sandbox loopback access, then reported `Task launch Node
  identity changed` in a narrow unsandboxed run. Frozen-lockfile installation and the supported
  Node 26 runtime succeeded for dependency-dependent checks.

Date: October 7, 2026. Status: planned; implementation not started. Dependencies: [phase 02](./02-desktop-chrome.md).
Read the [plan](./README.md) first, especially [decision](./README.md#decisions) 7.

## Deliverable

While workspaces are off, nothing the desktop or a first-party plugin shows says "workspace". One
helper picks the word, and plugins reach it through `plugin-api`.

## Steps

1. Add the helper in `packages/client-core/src/features/workspaces/`, using the mode accessor from
   phase 02. It returns the word in the forms the strings need: singular, plural, and capitalized.
   Keep it to the forms that callers use.
2. Export it from `packages/plugin-api/src/client.ts`, beside `workspaceForProject` at line 185.
3. Find the strings. This search finds about 235 lines in core, plugins, and the terminal client,
   with some false positives:

   ```sh
   git ls-files plugins packages/client-core/src apps/tui/src | grep -E '\.tsx?$' | grep -v test \
     | xargs grep -n -E "['\"\`>][^'\"\`<]*\b[Ww]orkspace\b[^'\"\`<]*['\"\`<]"
   ```

   Ignore identifiers, query keys, route paths, and comments. Change only text a person reads.
4. Replace the strings in core first:
   - Palette commands and their keybinding descriptions, such as `core.goto.workspace-last` ("Switch
     to the last workspace", Cmd+;) in `apps/desktop/src/client/App.tsx:150`.
   - The **Add project** hint "from a folder, into this workspace" (`App.tsx:119`).
   - The rail toast "This workspace has no visible projects yet" (`TabRail.tsx:264`).
   - Home, Archive, and dashboard text.
5. Then the first-party plugins: notes scope labels, Agent Center filters and empty states, workflows,
   GitHub, Linear, and Rollbar empty states.
6. Leave the terminal client's strings to [phase 06](./06-terminal-client.md). It uses the same
   helper.
7. Leave command IDs and preference keys as they are. Only the words change.
8. Note the helper in the plugin docs, beside the other workspace helpers in
   `docs/plugin-authoring/` or `docs/plugins/`, wherever `workspaceForProject` is documented.

## Acceptance

- Existing tests pass, with string assertions updated to read through the helper or to cover both
  modes.
- In `pnpm dev:agent -- --session pw-words --workspaces off`, walk the topbar, rail, palette, Home,
  Agent Center, notes, workflows, Settings, and the archive. Check each snapshot for "workspace". None
  should appear.
- The same walk with `--workspaces on` reads as it does today.
- `pnpm lint` and `pnpm test` pass, because this phase touches many packages.

## Verify before building

- Which strings plugins build on the Node side, such as agent tool descriptions and notice text. The
  helper is client-side, so Node-side text needs the mode from phase 01 or a neutral word.
- Whether any loaded plugin outside this repository imports the strings you change. Loaded plugins
  only see `plugin-api`, so a new export doesn't break them.
