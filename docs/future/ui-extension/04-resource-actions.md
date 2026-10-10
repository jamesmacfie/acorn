# Phase 04: add file and document actions

Status: done, October 10, 2026. Branch `phase-04-resource-actions`, from `07091eb93`.

## Completion note

Another plugin can add rows to Editor's file-tree menu and to each document tab's menu. Both draw
after Editor's own rows in the same kit `Menu`, on both hosts. Opening a menu still selects, opens,
closes, saves, and drags nothing. A `runNodeAction` row sends the file's confined identity and no
bytes, so a route that needs the file declares and calls `editor.files`.

### What landed

- **Protocol.** `file.row` and `document.tab` join `CONTEXT_MENU_LOCATIONS` in
  `packages/protocol/src/chrome/contextMenus.ts`. Both take the facts `projectId`, `extension`,
  `directory`, and `readOnly`. `fileExtensionFact` derives `extension`: the lowercased text after the
  basename's last dot, and `""` for a folder, a dotfile, or a name with no dot. The manifest schema,
  `acorn-plugin.schema.json`, and the `plugin_authoring` brief follow from that list. The brief also
  names the body shape and says to use `editor.files` for bytes.
- **Targets.** `FileMenuTarget` (`FileRowTarget`, `DocumentTabTarget`) and `fileMenuTarget` sit in
  `packages/client-core/src/host/registries/panes/contextMenus.ts`, exported through
  `@acorn/plugin-api/client`. The target is `{ location, nodeId, ownerPluginId, taskId, projectId,
  path, title, directory, readOnly, extension, revision? }`. Neither location takes a `surface`, and
  the rail ownership rule is unchanged.
- **Dispatch.** `chromeContextMenus.ts` binds a loaded row's run. Before the verb runs, it checks the
  registration is still the same object, the plugin still runs on the Node, the target's Node is the
  one in view, and `taskById(taskId)` is still in the target's project. `runNodeAction` then posts
  `{ resource: { kind: 'file', taskId, projectId, path, directory, readOnly, revision? } }`. `openPane`
  gets the target's `taskId`.
- **Editor adapter.** `plugins/editor/src/client/contributedMenuRows.tsx` builds the target and
  draws the registry's rows after a separator. `FileTree.tsx` adds them to its existing entry menu,
  on the armed `FileTarget`, never on the worktree root. `EditorPane.tsx` adds them to `tabMenu`.
  Each row runs inside the owner's guard. The tree checks that the armed target is unchanged, the
  entry is still a visible row, and the tree is still live. The tab uses `withTabTarget`, the same
  identity and custody check its built-in rows use.
- **Desktop tabs.** `DocumentTabs.tsx` opens a tab's menu on right-click, Shift+F10, and the menu key,
  without activating the tab. A right press doesn't move focus, so the document under the strip
  isn't blurred before the menu holds its writes. Opening another tab's menu replaces the open one.
  When the tab opened the menu, focus returns to the tab on close. The tree already had right-click,
  Shift+F10, and focus return.
- **Terminal.** The tree's **Actions** button and Shift+F10, and the tab strip's `⋯` and Shift+F10,
  draw the same rows. `apps/tui/src/App.tsx` installs `setTaskLookup`, which the terminal had never
  done. Without it, the new task check refused every loaded file action there.
- **Docs.** [Context menus](../../plugins/menus-and-markers.md#context-menus) owns the contract.
  [The editor pane](../../editor/editor-pane.md) mentions the tab invocations and the contributed rows.

### Decisions and deviations

- **`readOnly` means Editor shows the file as an image,** using `imageTypeForPath`. Editor has no
  other read-only file. A folder is never read-only.
- **`revision` is the disk SHA-256 a tab's document last acknowledged,** `custody.savedRevision`. It
  matches the revision `editor.files` returns. A tree row has no revision, because a listing carries
  no content hash. It isn't the pane's handover counter that `editor:document` props use.
- **`title` is the basename.** The target has no `id`, so the menu log names `path` for file targets.
- **No contributed rows on the worktree root.** The root menu is the toolbar's **New file or folder**.
- **The host checks task scope through the client's task cache.** A task missing from the cache is
  refused, the same rule `openPane` already applies to a named task.
- **The desktop menus close with their row or tab.** A trash, rename, or refresh that removes the
  entry closes its menu, so the tree's visible-entry check matters for the terminal, whose menu isn't
  tied to the row.
- **The terminal imports `setTaskLookup` from the tasks barrel,** `@acorn/client-core/features/tasks`,
  not from a new `./features/tasks/taskLookup.ts` export. The first frame already loads that barrel:
  `App.tsx` imports `chrome/Shell.tsx`, which imports `chrome/Rail.tsx`, which imports
  `workflowTaskHierarchy` from it. So the import adds no module to the startup graph, and the closure
  grew 108 bytes, the new lines themselves. A direct export would also cost one of client-core's 179
  published entrypoints in `tools/arch/boundaries.test.ts` for no saving.
- **No committed fixture,** as in phases 01 to 03. The automated tests use compiled rows. The loaded
  inspector was a scratch plugin built into `/tmp` (see below).

### Verification

Run with Node 26.8.1.

- `contextMenus.test.ts` (protocol): the two locations and their facts, identity fields kept out,
  `fileExtensionFact`, and the rail rule. `manifest.test.ts` (node-core): file rows parse, `surface`
  is refused, `path` and `revision` are unknown facts, and the route stays confined.
  `pluginAuthoring.test.ts`: the brief names every file fact and the body.
- `chromeContextMenus.test.ts`: the exact body, fact matching, no surface, and refusals for a changed
  Node, a task gone or in another project, a disabled plugin, a disposed row, and a captured row
  after registration replacement. `contextMenuHost.test.tsx`: file rows from any plugin, a row
  replaced while the menu stays open, and a plugin rail row on another plugin's pane still hidden.
  `DocumentTabs.test.tsx`: right-click and Shift+F10 open an inactive tab's menu without activating
  it, another opening replaces it, and focus returns to the tab.
- `FileTree.test.tsx`: five tests covering rows after Editor's own on the right-clicked entry with no
  open, a folder, a refresh that moves rows under the open menu, a removed entry, and a Node change.
  `EditorPane.test.tsx`: an inactive dirty tab targeted by right-click with no activation, no save,
  and no edit, plus a closed tab and a Node change. Removing the tab guard or the tree's `live` check
  fails a test.
- `pnpm test` for `@acorn/protocol`, `@acorn/plugin-api`, `acorn-plugin-types`, `@acorn/node-core`
  (169 files), and `@acorn/client-core` (343 files): all pass. `@acorn/plugin-editor`: only the four
  known status-menu tests in `EditorPane.test.tsx` fail. `@acorn/tui`: only the two known
  `chrome.test.tsx` task-marker tests fail. The terminal's startup closure grew 108 bytes, to 679,966
  of 700,000.
- `pnpm --filter @acorn/arch-tests test`: only the known `docPaths` failure, 15 links.
  `editor-pane.md` stays at 200 lines.
- `pnpm lint`: oxlint reports warnings only, none in this phase's files. Turbo stops at the known
  agents type errors. Run directly, `tsc` is clean for protocol, client-core, node-core, plugin-api,
  plugin-types, and plugin-editor, and the terminal fails only on the known git plugin errors.
- **Desktop, `pnpm dev:agent`.** A throwaway repo with `src/data.json`, `src/app.ts`, a folder named
  `fixtures.json`, and `README.md`. The scratch `inspector` plugin declared `Inspect JSON` (`file.row`,
  `when: { extension: 'json', directory: false }`), `Inspect document` (`document.tab`), and `Open
  inspector` (`file.row`, `openPane`). Its trust prompt listed only **Use capability editor.files**.
  - The `fixtures.json` folder's menu had no inspector rows. Shift+F10 on `src/data.json` drew
    Editor's rows, then **Inspect JSON** and **Open inspector**. Escape returned focus to the row, and
    no tab opened.
  - **Inspect JSON** posted `{"resource":{"kind":"file","taskId":"58b19bd2-…","projectId":"886c29da-…",
    "path":"src/data.json","directory":false,"readOnly":false}}`. The route read 56 bytes through
    `editor.files`, revision `bdce332a…`. **Open inspector** opened the plugin's pane with that result.
  - With `README.md` as the active preview tab, right-clicking the inactive `data.json` tab opened its
    menu, ending with **Inspect document**. README stayed active and stayed a preview. Escape and
    Shift+F10 returned focus to the `data.json` tab. **Inspect document** posted the same body plus
    `"revision":"bdce332a…"`.
  - A tab with unsaved text was right-clicked while inactive, and the menu targeted it. Switching tabs
    autosaves the outgoing file, so the real app can't keep it unsaved without a failing save. The
    unit test covers that case.
  - Reinstalled as 0.0.2 with no capability, the same action reached the route, and
    `ctx.capabilities.get('editor.files')` was absent. Menu metadata grants no file access.
- **Terminal, `pnpm dev:tui:agent`.** The same plugin and repo. The trust overlay listed the
  capability. In the tree, `ctrl+meta+right`, `down`, and Shift+F10 opened **Actions for …**. The
  folder had no inspector rows, `README.md` had only **Open inspector**, and `src/data.json` had both.
  **Inspect JSON** by keyboard posted the same body, the read succeeded, and the caret came back to
  the `data.json` row. That run found the missing `setTaskLookup`. Not checked here: the tab strip's
  menu, because the driver couldn't put focus on the strip. `kit.test.tsx` covers that path.

### What later phases need to know

- Phase 05 can add `agent.message` and `agent.turn` the same way: a location, its facts, a target
  type in the union, a branch in `chromeContextMenus.ts` that rechecks the target, and a body key in
  `runChromeAction`. Tests that used `file.row` as the unknown location now use `agent.message`, so
  they need another unknown name then.
- `taskById` works in both hosts. Anything that checks a task's scope can use it.
- A document owner opts in with `fileMenuTarget` and `contextMenuItems(target.location, target)`
  inside its own `Menu`, guarded by its own target check. `ContributedMenuRows` is Editor's version.
- A fresh worktree has no `packages/plugin-sdk/dist`, so `build:plugin` can't resolve
  `acorn-plugin-sdk/remote` until `pnpm --filter acorn-plugin-sdk build` runs.
- `dev:agent:ui link` takes only `acorn://` addresses. To open a task, pick its project from
  **Project**, then click the task.


Expose contributed actions on Editor file rows and document tabs through the shared host menu.
Opening a menu must not select, open, close, save, or drag the target.

## Starting point and owners

`plugins/editor/src/client/FileTree.tsx` draws virtualized `TreeRow` entries with open/expand actions.
`plugins/editor/src/client/EditorPane.tsx` draws `DocumentTabs` and retains dirty documents.
Built-in file and inactive-tab menus are implemented. Reuse their captured targets, custody holds,
and guarded actions when adding contributed menu rows; do not rebuild the file-operation model.
`packages/protocol/src/chrome/contextMenus.ts` has four closed menu locations and per-location facts.
`packages/client-core/src/host/registries/panes/contextMenus.ts` stores typed targets and checks stale
registrations. `packages/client-core/src/host/chrome/chromeContextMenus.ts` binds loaded menu actions.
`packages/client-core/src/host/chrome/actions.ts` dispatches declared verbs through the bound Node.

Read [context menus](../../plugins/menus-and-markers.md#context-menus),
[UI contributions](../../plugin-authoring/ui-contributions.md), and [Editor saving](../../editor/save-and-recovery.md).

## Contract

Add `file.row` and `document.tab` to the shared menu vocabulary. This phase mounts both in Editor;
other document owners opt in through typed adapters when they have a real target.
Keep `surface` absent, as for `item.row`; these actions can come from another plugin.

Bind target `{ nodeId, ownerPluginId, taskId, projectId, path, title, directory, readOnly, revision? }`.
`path` is the canonical confined relative path from Editor, never a matching basename. A tab targets
its own document even when another tab is active. Facts allowed in `when` are `projectId`,
`extension`, `directory`, and `readOnly`. Identity, title, and revision are payload, not predicates.

For `runNodeAction`, send `{ resource: { kind: 'file', taskId, projectId, path, directory,
readOnly, revision? } }` through the contributor's own route on the bound Node. Do not send absolute
paths or file bytes. A route that needs bytes declares Editor's read capability. The host rechecks
Node, target availability, plugin registration, and task scope immediately before dispatch.

```json
{ "id": "inspect-file", "location": "file.row", "label": "Inspect JSON",
  "when": { "extension": "json", "directory": false },
  "action": { "verb": "runNodeAction", "path": "/v1/p/inspector/inspect" } }
```

## Steps

1. Extend location/fact schemas, target unions, Node/client validation, chrome dispatch, and generated
   authoring schema. Preserve all four earlier location payloads and ownership rules.
2. Add owner adapters beside FileTree and Editor tabs. Use the shared menu component. Keep one menu
   opening per owner list and capture a stable target, not a row object retained after virtualization.
3. Add desktop right-click and keyboard invocation, returning focus to the surviving target. In the
   terminal, expose an explicit Actions control or command for the focused file/tab, using the same rows.
4. Keep built-in file and tab actions beside contributed actions in the shared menu. Preserve
   create/rename/trash admission, descendant recovery, navigation reconciliation, and bulk-close guards.
   Opening another menu replaces the previous one. Preserve file selection, pinning, and drag behavior.
5. Add a loaded inspector fixture that reads a supported file through Editor's capability and opens
   its own view. Verify that menu metadata alone does not grant filesystem access.

## Tests and acceptance

Extend `packages/protocol/src/chrome/contextMenus.test.ts`, `FileTree.test.tsx`, `EditorPane.test.tsx`,
and `packages/client-core/src/host/registries/panes/contextMenuHost.test.tsx`.
Test inactive dirty tabs, directories, virtual row reuse, unknown facts, route confinement, a removed
file, changed task/Node, unloaded contributor, and a menu left open across registration replacement.
Keep a source/pane rail-menu regression to prove the location expansion preserves ownership checks.

Run `pnpm lint`, full suites for `@acorn/protocol`, `@acorn/node-core`, `@acorn/client-core`,
`@acorn/plugin-editor`, `@acorn/tui`, affected declaration packages, and the architecture suite.
Expect exit zero. Real-host checks must prove the menu targets an inactive tab without changing it,
works by keyboard, and restores focus after dismissal. Verify fallback Editor preview tabs too.

Complete when loaded and compiled actions use the same typed target and no menu open changes
document state. Record the Node body and authoring discovery response in delivery evidence.

## Verify before building

- Recheck the Editor capability name and exact relative path normalization after its implementation.
- Recheck tab identity and virtualized row lifetime before binding handlers.
- Stop if an implementation needs file bytes in a menu declaration or bypasses dirty-buffer custody.
