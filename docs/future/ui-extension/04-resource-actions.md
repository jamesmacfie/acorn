# Phase 04: add file and document actions

Status: planned, October 6, 2026. Baseline: `0ce874a15c856db07992cc5f7650b6730c6aadaf`.
Depends on phase 03 and the shipped Editor file identity/read contract.

Expose contributed actions on Editor file rows and document tabs through the shared host menu.
Opening a menu must not select, open, close, save, or drag the target.

## Starting point and owners

`plugins/editor/src/client/FileTree.tsx` draws virtualized `TreeRow` entries with open/expand actions.
`plugins/editor/src/client/EditorPane.tsx` draws `DocumentTabs` and retains dirty documents.
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
4. Keep core file actions and contributed actions in the shared menu. Opening another menu replaces
   the previous one. Preserve tab close guards, file selection, pinning, and drag behavior.
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
