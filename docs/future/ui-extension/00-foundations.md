# Phase 00: confirm prerequisites and contracts

Status: done, October 10, 2026. Branch `phase-00-foundations`, from `c9d8f613f`.

## Completion note

The Editor prerequisite is complete and matches what later phases assume. One small source change
landed: **Settings > Advanced > Extension points** now shows what step 5 found missing. Nothing
else in the runtime changed.

### What landed

- `packages/client-core/src/host/tree/treeFailures.ts` keeps the last reason each remote
  contribution's tree failed. `TreeHost` takes an optional `onFailed`, and `RemoteTree` records
  through it. A failed tree still draws nothing for the person.
- The Extension points page shows a `stack` point's cap, a point's declared owner actions, each
  contributor's `matches`, and its last failure. The owning doc section,
  [Seeing what matched](../../plugins/cooperative-extension-points.md#seeing-what-matched), says so.
- `EditorPane.test.tsx` gains "drops a document handover that lands after a node switch". It fails
  when the `live()` guard in `readRendered` is removed.

### Editor evidence

| Fact | Live source |
| --- | --- |
| Point | `editor:document`, `remote`, `replace`, `max: 1`, registered in compiled code at `plugins/editor/src/client/index.ts`. No manifest declares it. |
| Names | `EDITOR_DOCUMENT_POINT` and `EditorDocumentProps` in `packages/protocol/src/chrome/extensionPoints.ts`. |
| Key | Lowercased basename, built in `EditorPane.tsx`. Props carry the case-preserving worktree-relative `path`. |
| Capability | `editor.files`, `EDITOR_FILES` in `plugins/editor/src/contract/files.ts`, mirrored in `packages/plugin-types/src/contracts/editorFiles.ts`. |
| Confinement | Same worktree and symlink rules as the editor's routes, rechecked on every call. Anything outside answers `missing`. Over 12 MiB answers `too_large`. |
| Text and disk | `text` is the pooled buffer when one exists and is dirty or fresh, otherwise a disk read. `editor.files` always reads disk. |
| Revision | `revision` is one counter per mounted editor pane, shared by all its files. It rises on every handover, so a lower number is stale. It isn't per document and isn't the SHA-256 that `editor.files` and the text route return. |
| Node binding | The pane binds its node at mount. A handover that lands after a node switch is dropped. |

Real-host checks used a scratch loaded plugin made with `create-acorn-plugin`. It declared
`{ "point": "editor:document", "remote": "doc", "matches": ["*.md", "*.markdown"] }` and drew
`props.text` with the kit `Markdown` node. It lived in `/tmp` and isn't committed.

- Desktop, `pnpm dev:agent`: the preview drew with **Read-only preview**. **Preview** returned to
  CodeMirror, and an edit reached the renderer on return (revision 3). Leaving CodeMirror blurred it,
  so autosave had written the file. The strictly unsaved case, with the save held, is covered by
  "lets another plugin draw a file and keeps the source one toggle away". A tab switch kept each
  tab's Source choice, and the page listed `Markdown preview (md-preview) draws *.md, *.markdown`.
- Terminal, `pnpm dev:tui:agent`: the trust prompt listed the grant, the preview drew in cells with
  the **Preview** toggle beside the tab strip, and a tab switch redrew at a higher revision. I didn't
  drive the toggle there, because the terminal driver doesn't report keyboard focus.
- Node switch: neither session had a second node. The new unit test covers it.

### Inventory

No shipped manifest declares an extension point. Every point is registered in compiled code, so
node manifest validation never sees one. A loaded plugin can still fill a compiled point, because
the client matches at delivery. `agent-cost` fills `agents:session-header` that way, and the
scratch renderer filled `editor:document`. Compiled points default to `max: 1` and manifest points
to `max: 4`.

| Point | Kind and arbitration | Shipped contributors |
| --- | --- | --- |
| `agents:tool-card` | remote, replace, key tool name | changes, memory, workflows (compiled) |
| `agents:attachment` | remote, replace, key media type, action `replace` | none |
| `agents:composer-actions` | remote, stack 4 | none |
| `agents:session-header` | remote, stack 2 | agent-cost (loaded) |
| `agents:request-card` | remote, stack 2 | none |
| `changes:push-actions` | remote, stack 2 | github (compiled) |
| `github:summary-badges` | remote, stack 4 | none |
| `docker:stats-beside` | remote, stack 2 | none |
| `context:section` | remote, stack 2, key section id | none |
| `editor:document` | remote, replace, key basename | none |
| `core:storage`, `core:security`, `core:plugin-page` | remote, stack 4 | agents (compiled) |
| `changes:diff-line`, `github:diff-line` | annotation, key `file`, `line`, `side` | none |
| `docker:container` | annotation, key `container` | none |
| `core:task` | annotation, key `task`, 256 accepted marks | none |

Node-side points (`workflows:step-kind`, `editor:line-markers`, `editor:file-status`, and others)
and the hook points are handler registries, not UI, and this programme doesn't touch them.

Context menu locations are `task.row`, `item.row`, `rail.source`, and `rail.pane`. Rail menus are
integrated: `TabRail.tsx` hosts `task.row` and `rail.source`, and `TaskPaneHost.tsx` hosts
`rail.pane`, with the owner check in `host/registries/panes/contextMenus.ts`.

Remote composition is one level. The SDK `Slot` takes only a host-minted `slotRef`, its node type
is outside `KIT_NODES`, and `TreeHost` reads no `point` prop. `NestedChromeSlot` clears the
reference before mounting its child. `TreeHost.test.tsx` shows a forged `slotRef` draws nothing.

Arbitration and action limits: `replace` draws one match alone, and on a tie draws the owner's
default until the person picks. A pick for a plugin that no longer matches falls back to the
default. `stack` draws the default plus the first `max` matches and a count of the rest. A point
declares at most eight actions. A tree can have eight host requests in flight, each payload and
reply is capped at 64 KiB, and a handler times out after 10 seconds. An action must be declared by
the point and bound by that `Slot`.

### Finalized names

Every proposed name stands; none collides with a shipped id. Where each contract lives:

- **Protocol**, because core consumes it: `core:link-preview` and `core:markdown-fence` beside
  `EDITOR_DOCUMENT_POINT`. The `core:source` and `core:pane` keys go beside `CORE_TASK_KEY`. The
  menu locations `file.row`, `document.tab`, `agent.message`, `agent.turn`, and `content.selection`
  and their targets go in `contextMenus.ts`. The `mounts`, `statusAnnotations`, `hover`,
  `diagnostics`, and `documentServices` fields go in the manifest schema.
- **The owner's `src/contract/`**, exported through its `./contract/*` map: props for
  `agents:transcript-attachment`, `agents:artifact`, `workflows:step-body`,
  `preview:toolbar-actions`, and `terminal:toolbar-actions`, the `editor:file` key, and
  `agents.transcriptMedia`. Mirror a capability into `plugin-types` the way `editor.files` is.
- `linear:issue-summary` and `rollbar:item-summary` are declared in those plugins' manifests. They
  are the first manifest-declared points.

`EditorDocumentProps` and the agents point props stay in protocol. Moving them is churn outside
this programme.

### Ownership and loaded examples

| Phase | Owner packages | Suites to run |
| --- | --- | --- |
| 01, 10 | `client-core` (kit content, host), `protocol` | `@acorn/client-core`, `@acorn/tui` |
| 02, 05 | `plugin-agents`, `protocol`, `plugin-types` | `@acorn/plugin-agents`, `@acorn/client-core` |
| 03 | `plugin-workflows` | `@acorn/plugin-workflows` |
| 04, 07 | `plugin-editor`, `protocol`, `client-core` menus and annotations | `@acorn/plugin-editor`, `@acorn/client-core` |
| 06 | `protocol`, `node-core` manifest validation, `client-core` chrome, `plugin-linear`, `plugin-rollbar` | those packages |
| 08 | `protocol`, `client-core`, `plugin-editor`, `plugin-agents` | those packages |
| 09 | `protocol`, `node-core`, `plugin-editor`, `plugin-database` | those packages |
| 11 | `plugin-preview`, `plugin-terminal`, `client-core` host requests | those packages |
| 12 | `protocol`, `client-core` rail and pane hosts | `@acorn/client-core`, `@acorn/tui` |

Every phase also runs `pnpm --filter @acorn/arch-tests test`.

Loaded examples: for an automated check, write a temporary package in the test, as
`node-core/src/server/plugins/fiveKinds.test.ts` does, or follow `plugins/agent-cost` and its
loader test. For a real-host check, scaffold with `create-acorn-plugin` into `/tmp` and add the
`extensions` entry. In `dev:agent`, install it from **Settings > Plugins > Install** as a local
folder, accept it, and restart the node. The terminal client has no install page, so post
`{ "source": { "path": "..." } }` to `/v1/core/plugins/install` with the session's device token and
an `idempotency-key` header, then relaunch with `--reuse`. Don't add example plugins to a roster.

### Open issues for later phases

- `plugin_authoring` reads only the manifest schema. It doesn't list points registered in code,
  which is all of them, or any point's keys, actions, or props. An agent can't discover
  `editor:document` from it. Phase 14 owns the fix. Each phase should at least name its point in
  the brief text.
- The tie picker on the Extension points page is point-wide and ignores `matches`. `agents:tool-card`
  shows it although its three contributors' patterns don't overlap. Many-contributor `replace`
  points such as `core:link-preview` will show a misleading picker until it does.
- A failed `replace` occupant still counts as an occupant, so the box stays blank instead of
  falling back to the owner's default. The page reports the failure, but phases 01, 02, 03, and 10
  need the fallback.
- A compiled `component` contributor has no error boundary in `Slot`. Only first-party code takes
  that path.
- The terminal client has no Extension points page.
- Owner absence has one message: "no plugin on this node declares that point" covers a missing,
  disabled, untrusted, or renamed owner. `selector` and `accepts` parse but nothing reads them.

### Verification

Run with Node 26.8.1. The shell default, 24.11.0, is below the root `engines` floor of 24.18.1.

- `Slot.test.tsx` and `manifest.test.ts`: pass.
- `ExtensionPointsDev.test.tsx`, `TreeHost.test.tsx`, and both editor renderer tests: pass.
- `pnpm test --filter=@acorn/plugin-editor`: four failures, all in the file status menu's
  **Word wrap** and indentation tests. They fail on an untouched checkout and predate this phase.
- `pnpm --filter @acorn/arch-tests test`: one failure, `docPaths`, with 15 links into the deleted
  `docs/future/editor/` folder and missing `docs/future/git-client/screenshots/`. Also unrelated.
- `pnpm test --filter=@acorn/client-core`: 2,631 tests pass.
- `pnpm test --filter=@acorn/tui`: two failures in `src/chrome/chrome.test.tsx`, both about task
  annotation markers. They fail the same way with this phase's changes removed.
- `pnpm lint`: `client-core`, `plugin-editor`, and `plugin-database` are clean. `plugin-changes`,
  `tui`, `desktop`, and `node` fail type checks in files this phase doesn't touch: the core services
  type that the agents and changes plugins use, which lacks `checkoutAdmission` and
  `secretPublication`, and the git plugin's `RevisionView.tsx` props.

## Original plan

Planned October 6, 2026. Baseline: `0ce874a15c856db07992cc5f7650b6730c6aadaf`.
Depends on [Editor file renderers](../../editor/file-renderers.md), which shipped. Execute before phase 01.

This phase records the post-Editor baseline and establishes the contracts and verification inventory
for contextual UI. It does not introduce an unused extension framework.

## Starting point and owners

`packages/protocol/src/chrome/extensionPoints.ts` defines five kinds and shared point props.
`packages/protocol/src/plugin/manifest/extensionDescriptors.ts` parses declarations.
`packages/node-core/src/server/plugins/manifestValidation/extensions.ts` checks owner/carrier rules.
`packages/client-core/src/host/tree/Slot.tsx` mounts compiled components or remote trees.
`packages/client-core/src/host/registries/extensionPoints/extensionPoints.ts` owns registrations.
`packages/plugin-sdk/src/remote/public.ts` exposes a chrome-only `Slot({ slotRef })`.

Built-in file menus, tab actions, and `editor:file-status` are implemented. They do not provide
the public file-viewer, resource-menu, or annotation contracts in this programme. The baseline has no
Editor client point. The prerequisite must have supplied `editor:document`, live
text/revision props, an owner-held source toggle, fallback rendering, and confined read-only bytes.
Its matching key must remain separate from the case-preserving worktree-relative `path`.

Read [UI tiers](../../plugins/ui-tiers.md), [remote points](../../plugins/remote-points.md),
[the manifest](../../plugin-authoring/the-manifest.md), and [testing](../../testing.md).

## Steps

1. Compare the live source with the baseline. Record the Editor point declaration, public capability
   name/types, Node confinement, text versus disk behavior, and revision semantics in delivery evidence.
   Test an unsaved Markdown preview, source return, tab switch, and Node switch in both supported hosts.
2. Confirm shipped UI contributions rather than copying the earlier conversation inventory. Distinguish
   client-only compiled contributions from loaded declarations. Confirm rail menus have integrated.
3. Finalize the proposed names from the following phases. Declare owner-specific props beside their
   owner, promoting only contracts that core consumers need into protocol. Do not put plugin names
   or imports into core to special-case a contributor.
4. Record per-phase package/test ownership and a small loaded example strategy. Extend test fixtures
   or plugin scaffolds when possible; do not install permanent example plugins into production rosters.
5. Confirm discovery reports point kind, matching, declared actions, absent owners, and renderer errors.
   Add coverage only for a demonstrated missing behavior; no source changes are required if it works.

## Contract decisions

Use `replace` for viewers and `stack` with a cap for additive UI. Preserve arbitration ties and picks.
Use host menus for actions and batched annotations for marks. Nested cooperative tree slots remain
unsupported. Every read uses the contributor's own route or a declared Node capability.

This programme keeps API major 3 unless an incompatible contract is found. It does not assume that
every major-3 host understands vocabulary added by later phases. Schemas and authoring discovery
must tell authors which declarations this running host accepts.

## Verify and complete

Run these commands on the supported runtime and expect exit zero:

```sh
pnpm test:focus @acorn/client-core src/host/tree/Slot.test.tsx
pnpm test:focus @acorn/node-core src/server/plugins/manifest.test.ts
pnpm test --filter=@acorn/plugin-editor
pnpm --filter @acorn/arch-tests test
```

Complete when Editor evidence and the point/consumer inventory are recorded, the live source confirms
one-level remote composition, and the commands pass. If source changes were needed, also run
`pnpm lint` and the changed packages' full suites and direct consumers.

## Scope and stop conditions

Do not rebuild Editor viewers, change app trust, clear persisted state, or introduce generalized
resource services. Stop if the prerequisite is incomplete or its public contract conflicts with a
later requirement. Resolve that contract before moving to phase 01.

## Verify before building

- Recheck Editor fallback and dirty-buffer ownership after upstream work lands.
- Confirm `Slot` arbitration and action limits in the running source.
- Confirm task setup has settled and the Node runtime meets root `package.json`.
