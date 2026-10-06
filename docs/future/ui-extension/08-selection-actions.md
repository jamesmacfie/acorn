# Phase 08: add selected-content actions

Status: planned, October 6, 2026. Baseline: `0ce874a15c856db07992cc5f7650b6730c6aadaf`.
Depends on phase 07 and the typed action dispatch from phases 04 and 05.

Let a person invoke plugin actions on selected text in host-owned Markdown, code, and Editor content.
Capture a selection only when the person opens its action menu, rather than broadcasting selection changes.

## Starting point and owners

`packages/client-core/src/kit/components/content/Markdown.tsx` preserves block nodes and text selection.
`packages/client-core/src/kit/components/content/CodeBlock.tsx` draws code and copy controls.
`packages/client-core/src/features/editor/DocumentSurface.tsx` and
`plugins/editor/src/client/EditorPane.tsx` own document selection and dirty buffers.
`packages/client-core/src/host/registries/panes/contextMenus.ts` stores typed menu targets.
`apps/tui/src/kit/showing/documents.tsx` supplies terminal content projections.

Read [document ownership](../../editor/document-surface.md), [saving](../../editor/save-and-recovery.md),
and [menus](../../plugins/menus-and-markers.md#context-menus).

## Contract

Add `content.selection` to context-menu locations. Allowed facts are `contentKind`, `languageId`,
and `readOnly`. Supported kinds are `markdown`, `code`, and `document`.
Bind `{ nodeId, taskId?, projectId?, ownerId, contentKind, languageId?, text, revision,
resource?, range? }`. `resource` is the host-known file or transcript identity from earlier phases.
Document `range` uses the owner's one-based line/column convention, with an exclusive end.
Rendered Markdown selections carry plain selected text and no invented Markdown source offsets.

Capture at most 64 KiB of UTF-8 text on invocation. Over-limit selections show an owner explanation
and do not dispatch a silently shortened selection. Empty and cross-owner selections expose no action.
Send `{ selection: {...} }` to the contributor's own route for `runNodeAction`. Bind the captured
revision and refuse after the owner content changes; do not silently apply an action to changed text.

The first contract is read-only. It cannot replace text, save a file, send a message, or obtain a
whole document. A future replace-selection action needs owner validation and its own explicit design.
Plugin frames, browser pages, terminal PTY output, password fields, and ordinary form inputs are excluded.

## Steps

1. Extend menu vocabulary, typed payloads, schema/discovery, and stale-target dispatch checks.
2. Add small owner adapters for Markdown/CodeBlock host content and Editor/document regions. Host
   code maps an explicit menu invocation to a snapshot. Keep registries and DOM selection APIs out
   of remote workers and presentation-only kit contracts.
3. Add an accessible Actions for selection command beside each supported owner's menus. The desktop
   adapter can use its native selection. Terminal adapters use the host's selection/range facilities;
   if a component lacks range selection, offer whole-block selection explicitly through that command.
4. Preserve selection during streaming and menu open. Recheck revision, resource, owner, Node, and
   contributor before dispatch. Clear snapshots when menus close or owners unmount.
5. Add a loaded Explain selection fixture that opens its own pane from the captured text. Handle
   errors in the shared action reporting path, and keep ordinary copy and navigation intact.

## Tests and acceptance

Extend shared menu/dispatch tests, `MarkdownLifetime.test.tsx`, Editor/document tests, and terminal
content tests. Cover empty, oversized, cross-owner, rendered Markdown, fenced code, unsaved text,
Unicode byte limits, content changed while open, and a switched Node or disposed contributor.
Assert no request or plugin callback runs while a person merely changes the selection.

Run `pnpm lint`, full suites for `@acorn/protocol`, `@acorn/node-core`, `@acorn/client-core`,
`@acorn/plugin-editor`, `@acorn/plugin-agents`, `@acorn/tui`, affected SDK/schema packages, and architecture.
Expect exit zero. Invoke an action on Markdown, code, and an unsaved Editor range in the real desktop.
In the terminal, exercise the declared range or whole-block interaction and document that host distinction.

Complete when each supported owner has an explicit invocation path, selection text goes only to the
chosen action, and changed content or scope invalidates the captured request.

## Verify before building

- Recheck desktop versus terminal selection facilities and state their actual support in discovery.
- Recheck revision changes from streaming content and Editor live buffers.
- Stop if implementation would need global selection listeners, worker DOM access, or writable editor objects.
