# Phase 13: verify the combined UI programme

Status: done with open acceptance items, October 10, 2026. Branch `phase-13-acceptance`, from
`015da06c6`. Planned October 6, 2026, from `0ce874a15c856db07992cc5f7650b6730c6aadaf`.

## Completion note

Every delivered point composed on both hosts with three loaded plugins installed together. No
contract changed. One integration defect landed as a fix: the desktop's plugin-disable golden
didn't know the programme's points. Phase 14 can write its references from the results below.

### What landed

- `apps/desktop/test/client/clientPluginDisable.snapshot.json`, regenerated. The programme added six
  compiled points (`agents:transcript-attachment`, `agents:artifact`, `editor:file`,
  `preview:toolbar-actions`, `terminal:toolbar-actions`, `workflows:step-body`) that it didn't list.
  Each now leaves with its owner's disable. Two other entries, `editor:document` and
  `workflows.tool-card`, were already missing at `c9d8f613f`.
- No fixture is committed. Phase 14 owns authoring examples, and a tree fixture needs a built bundle.
  The fixtures were scratch packages in `/tmp`, rebuilt from the sources phases 01 to 12 recorded:
  - `uix-tree` 1.0.0, then 1.0.1: client only, built outside the workspace with Vite against the
    packed `acorn-plugin-sdk` 1.1.0 and `acorn-plugin-types` 1.0.0. It fills link previews, JSON
    fences, `terminal:command` step bodies, `*.md` documents, both toolbars, and
    `linear:issue-summary`, with one overlay.
  - `uix-routes` 1.0.0, then 1.0.1: built with `build:plugin`. Its own routes serve rows on
    `file.row`, `document.tab`, `agent.message`, `agent.turn`, and `content.selection`, and marks on
    `editor:file`, `core:source`, `core:pane`, and `core:task`. A tree reads transcript media through
    `agents.transcriptMedia`, and a second link preview ties with `uix-tree`.
  - `apps/node/test/__fixtures__/json-diagnostics` 1.0.0, unchanged.
- A scratch seeder added a session with five sent attachments, links, six JSON fences, 100 links,
  and 100 artifacts to the `tui-navigation` fixture on each host, plus `bad.json`, `good.json`, and
  2,000 files in `many/`.

### Matrix results

Desktop is `pnpm dev:agent`. Terminal is `pnpm dev:tui:agent`, at 80 by 24, 120 by 40, and 140 by 90.

| Point | Desktop | Terminal |
| --- | --- | --- |
| Link previews | One match drew the tree with task and project. A tie and a miss drew the owner card. `http:` and credential URLs drew nothing. | Links show their address. The picker wasn't reachable by keys. |
| Transcript media | 105 cards read through the capability. A 70 KiB file got the contributor's refusal. Unicode and JSON read intact. | Bodies drew in cells. |
| Workflow body | A `command` match missed, so the owner drew. `terminal:command` drew run, step, output, and revision. | Not driven. |
| File and tab menus | Owner rows, then the plugin row. The body carried only the file identity, no bytes. | **Shift+F10** row ran on a folder. |
| Message and turn menus | Three Copy rows, then two plugin rows. Bodies matched phase 05. A 500 showed `uix-routes: action failed`. | Menus drew. The keys didn't reach them. |
| Selection | Markdown got Copy and one row. Code got the code row too. Escape kept the selection. | **Actions for the whole text** drew. |
| Detail region | Not run. See open items. | Not run. |
| File marks | One batch of 3 keys. Malformed rows dropped. 400 characters cut to 200. Unicode intact. | Dots and legends on rows and tabs. |
| Document services | `bad.json` got one mark, which cleared once the buffer was fixed. | Not driven. |
| Fences | Four viewers of six. **Preview** on the fifth sent the first back to source. | The same, with **[Source]**, **Copy**, and the plugin. |
| Preview toolbar | After the owner's controls, with the page's `url`. The overlay opened and closed to `null`. | No Preview on this host. |
| Terminal toolbar | A timer and a driver press got `needs_person`. An undeclared overlay got `unknown_overlay`. | Drew and updated in place. Not pressed. |
| Source and pane marks | On Git's source, and on Changes beside its own marker. | `1 marks` on Git, `+1` on Agent and Changes. |
| Task marks | 300 sent, 256 drawn. | `+257` on the row. |
| Editor viewer | `README.md` drew as **Read-only preview**. | The same. |

- **Carrier.** Every point ran as a loaded declaration. Compiled contributors are the phases' unit
  tests, which passed in the full gate.
- **Lifecycle.** **Not now** on an update hid only that plugin's trees, and **Accept update**
  restored them. Disabling both fixtures fell back to every owner. Disabling Preview removed its
  point, the page listed `uix-tree → preview:toolbar-actions` as matching nothing, and other trees
  stayed. The terminal fell back the same way.
- **Identity.** Two tasks share one folder. Task B's batch and row carried B's id. A file menu left
  open across a real task switch closed, and its row posted nothing. The late media read after a
  switch drew nowhere.
- **Measured.** Each plugin bundle runs one worker, so the count stayed at three for 105 media
  cards, 100 hovered links, 2,000 files, and six fences. Fast hover over 100 links kept one preview,
  one mount. The 2,000-file folder sent one batch of 2,003 keys and drew 12 rows.
- **Memory.** Over 20 transcript mounts and unmounts, the DOM came back to 818 nodes each time and
  the web content process grew from 574,464 to 619,024 KB. With both fixtures off, the same cycles
  held between 636,864 and 652,352 KB, and the earlier growth wasn't kept. Unmount releases every
  mount's state in `treeChannel.ts`, and I found no leak.
- **Gates, on Node 26.8.1.** `pnpm lint` fails with the same 65 type errors in the agents, changes,
  git, and workflows plugins as `c9d8f613f`. oxlint is clean with 158 warnings on both. `pnpm test`
  fails only the known reds. `pnpm --filter @acorn/desktop test` fails only
  `persistedState.conformance.test.ts`, 8 slices against 7, the same at base. Its boot test (11)
  and Rust suite (67) pass when run alone. Packed manifests parse with no unknown keys. Budgets:
  service 1,757,603 of 1,759,000 B, terminal startup 692,304 of 700,000 B.

### Decisions and deviations

- **No second Node.** The two-Node cases rest on unit tests: `statusAnnotations`, `LinkPreviewHost`,
  `EditorPane`, `NodeDetail`, `chromeContextMenus`, `PreviewPane`, and `TerminalPanel`.
- **A hidden window.** The `dev:agent` window reports `document.hidden`. Availability panes appeared
  only once I overrode it, and timers ran slowly, so 100 hovers took 95 seconds.
- **No new defects** came from the stress cases. A synthetic `popstate` doesn't switch the rendered
  task, so it can't test a stale menu. Use `dev:agent:ui link acorn://local/t/<id>`.

### Open acceptance items

- Native child-webview overlap and real focus: none of
  [native overlays](../../testing/native-overlays.md) A1 to A16 has a native pass. The overlay
  drew above Preview in the main renderer only.
- A trusted desktop press on a toolbar action. The driver can show only refusals.
- The Linear detail region in the combined session. A fake key now reaches Linear, fails, and flips
  the connection to `needs-auth` before the detail draws. Phase 06 checked it in a real host.
- Terminal key paths for link previews, message menus, and toolbar presses. The driver can't place
  focus there. The cells tests in `apps/tui` cover them.
- A heap-level leak check needs Web Inspector.

Two cosmetic issues predate the programme. The terminal trust prompt prints each grant's icon
name, `puzzle`, as text (`apps/tui/src/plugins/TrustPrompt.tsx`). The Extension points page lists
agents' `core:storage`, `core:security`, and `core:plugin-page` contributions as matching nothing
until those pages load.

### For phase 14

- A workflow command step's kind is `terminal:command`. Examples must use that key.
- `CodeBlock` takes its text as children, not a `code` prop.
- An external tree builds with `vite-plugin-solid` set to `generate: 'universal'` and `moduleName:
  'acorn-plugin-sdk/remote'`. It needs both packed tarballs, because `acorn-plugin-types` isn't on
  npm.
- A `document.tab` body has no `revision` while another plugin draws the file.

Verify that all extension points compose on both hosts and remain bounded across plugin, resource,
and Node transitions. This phase fixes integration defects within the delivered contracts; it adds
no further extension points. Documentation is the next and final phase.

## Owners and fixtures

Read [testing](../../testing.md), [agent drivers](../../local-development/agent-drivers.md),
[native overlay checks](../../testing/native-overlays.md), and [plugin testing](../../plugin-authoring/testing.md).
`apps/tui/src/extensions.test.tsx` exercises loaded extension composition.
`packages/client-core/src/host/tree/Slot.test.tsx` exercises owner/contributor behavior.
`packages/node-core/src/server/plugins/manifest.test.ts` checks loaded declarations.
`packages/create-acorn-plugin/index.test.ts` checks published authoring examples and package shape.

Use the loaded fixtures built by preceding phases, installed in isolated sessions. Include a client-only
tree contributor, an own-route descriptor provider, a capability-backed reader, and an optional overlay.
Do not add fixture packages to the production bundled plugin roster or depend on external accounts.

## Required matrix

Record these dimensions and actual results for each delivered point:

| Dimension | Required cases |
| --- | --- |
| Carrier | Loaded declaration and compiled contribution where supported. |
| Host | Desktop and terminal, with explicit unsupported frame/native behavior. |
| Arbitration | No match, one match, tie or stack overflow, saved pick, missing chosen provider. |
| Lifecycle | Disable, reload, bundle refusal, owner removal, navigation, resource/Node replacement. |
| Data | Empty, error, malformed, over-limit, Unicode, stale revision, late ignored response. |
| Interaction | Keyboard, pointer where available, Escape, outside dismissal, focus restoration. |
| Owner behavior | Source, copy, download, save, selection, approvals, navigation, and menus retained. |

The point list includes link previews, both transcript media points, workflow body, file/tab and
message/turn menus, loaded detail regions, file marks, selection actions, document services, fences,
Preview/Terminal toolbars, and source/pane annotations. Editor viewer checks are prerequisite regressions.

## Steps

1. Run `pnpm lint` and `pnpm test` with the root supported Node runtime and repository concurrency
   limits. Run `pnpm --filter @acorn/desktop test` for desktop/Rust integration. Expect exit zero.
   Do not run `turbo run test` directly. Classify baseline/environment failures with recorded output;
   do not hide them by weakening tests or changing unrelated source.
2. Pack/build the relevant published declaration/SDK/scaffold packages through their package scripts.
   Run package checks on an external loaded example with no private workspace imports. Verify its
   manifest passes Node parsing and device revalidation and its renderer entry names resolve.
3. Start `pnpm dev:agent -- --session ui-extension-acceptance`. Use the matching UI driver to obtain
   snapshots, invoke each contribution, and take screenshots. Refresh snapshots after navigation.
   Install and trust fixtures through the supported isolated-session workflow.
4. Start `pnpm dev:tui:agent -- --session ui-extension-acceptance --fixture tui-navigation`.
   Use the terminal UI driver to snapshot, press, and resize to 80 by 24 and 120 by 40. Exercise
   explicit preview/actions and each rendered contribution without assuming a pointer.
5. Run identity stress cases: two tasks with equal paths, two Nodes with equal plugin/resource IDs,
   disabled owners, a stale menu, and a delayed route response after navigation. No response or
   action from an obsolete identity may reach the replacement owner.
6. Measure workers and route calls for 100 links, 100 media cards, a large file tree, and multiple
   fences. Hidden links/cards start no contributor workers. Fences honor four active mounts per owner.
   Annotations make one request per contributor and distinct visible-key set. Rapid hover retains one
   open preview. Record measured counts and memory deltas; investigate growth after repeated disposal.
7. Perform native child-webview overlap and manual focus checks the driver cannot inspect. Verify the
   popover/menu remains visible and usable under the shipped platform fallback. State platform coverage.
8. Stop both sessions using their matching `dev:agent:ui` and `dev:tui:agent:ui` commands. Record the
   fixture versions, Node runtime, commands, screenshots, measurements, and unresolved checks.

## Completion and review

Complete only when the matrix passes, packed examples work, full lint/test gates pass, and any native
checks outside automation have recorded acceptance. Fix attributable integration failures and rerun
their affected gate before continuing. Missing required manual evidence remains an open acceptance item.

Review that file/media capabilities remain read-only, menu bodies contain only declared data,
cooperative trees remain one level, app trust is unchanged, and contributor failure leaves owner controls.
Do not implement a dynamic App hook or another network/browser authority to complete the matrix.

## Verify before building

- Recheck supported runtime, staged desktop binary ownership, and settled setup before tests.
- Recheck fixture installation and trust flows on the live release.
- Stop if a contract must change incompatibly; update its phase and get the owner decision before release.
