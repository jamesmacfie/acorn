# Phase 08: add selected-content actions

Status: done, October 10, 2026. Branch `phase-08-selection-actions`, from `06bea7166`.

## Completion note

Another plugin can act on text a person selected in an agent transcript message, in Editor, and in a
plugin's document editor. Nothing watches the selection. The host reads it only when the person opens
the menu, and the text goes only to the row they pick. A row refuses once the owner's content changed.

### What landed

- **Protocol.** `content.selection` joins `CONTEXT_MENU_LOCATIONS`, with the facts `contentKind`,
  `languageId`, and `readOnly`. `SELECTION_CONTENT_KINDS` and `MAX_SELECTION_BYTES` (64 KiB) sit
  beside it. The manifest schema, `acorn-plugin.schema.json`, and the `plugin_authoring` brief follow.
  The brief names the body and where each host can invoke the menu.
- **Target and dispatch.** `ContentSelectionTarget` and `SelectionRange` are in client-core's
  `contextMenus.ts`, exported through `@acorn/plugin-api/client`. `chromeContextMenus.ts` checks the
  Node, and the task's project when there's a task, then posts `{ selection: { taskId?, projectId?,
  ownerId, contentKind, languageId?, readOnly, text, revision, resource?, range? } }`.
- **Helpers.** `contentSelection.ts` holds `selectionTooLarge` (UTF-8 bytes) and `documentSelection`,
  which turns a CodeMirror state's main selection into text and a one-based range with an exclusive end.
- **Host component.** `SelectionActions.tsx`, exported through `@acorn/plugin-api/ui/host`, wraps an
  owner's content in a `display: contents` element. On `contextmenu` it reads the page selection
  inside itself, asks the owner's `select` for a target, and opens **Actions for selection** with
  **Copy** and the rows. A selection inside one fence is `code`, with the fence's hint mapped to the
  editor's language ids. Its terminal twin in `apps/tui/src/kit/host.tsx` reads no selection and
  offers the owner's `whole` block from an **Actions for the whole text** menu.
- **Owners.** `MessageSelectionActions` in `transcriptMenus.tsx` wraps user and assistant message
  text. Its revision and identity come from the phase 05 message target, and its whole block is the
  message as plain text. `EditorPane.tsx` and `DocumentSurface.tsx` wrap their editor rectangle and
  read the live buffer, with `custody.revision` as the revision. Neither offers a whole block.
- **Markdown.** A fence's wrapper carries `data-language` too, because highlighting replaces the
  `<pre>` that had it.
- **Docs.** [Context menus](../../plugins/menus-and-markers.md#context-menus) owns the contract.
  [The transcript](../../managed-agents/transcript.md#message-and-turn-menus) and
  [the document surface](../../editor/document-surface.md) each gained a paragraph.

### Decisions and deviations

- **One door per host.** The desktop uses `contextmenu`: right-click, Shift+F10, or the menu key with
  focus inside the owner. No palette command, because opening the palette moves focus, and WebKit
  clears a page selection when focus moves. In a transcript, keyboard focus is rarely inside the text,
  so a keyboard reader there has `agent.message` for the whole message.
- **The platform menu stays** with no row to offer, a link under the pointer, Option held, an empty
  selection, or a selection that crosses into another owner.
- **The selection comes back.** WebKit clears the page's selection when the menu's first item takes
  focus. The host keeps the range and restores it on close, if its text is still there.
- **`revision` is a number on every owner:** the message's newest event sequence or the buffer's edit
  counter. A save doesn't change it, and an edit or a reload does.
- **`ownerId` is the drawing plugin's id**: `agents`, `editor`, or the document surface's plugin.
- **`resource`** is `{ kind: 'file', path }` in Editor and `{ kind: 'message', sessionId, itemId }`
  in a transcript. A plugin document has none. `taskId` and `projectId` sit beside it, not inside.
- **The terminal offers no Editor or document selection.** It has no range selection, and a whole
  file would break the rule that a row can't read the whole document.
- **Reasoning, plan proposals, tool output, and the kit `CodeBlock`** take no selection actions. Only
  message text and the fences inside it do.
- `tools/arch/boundaries.test.ts` raises client-core's entrypoint ceiling from 179 to 180 for
  `SelectionActions.tsx`, which the terminal can't load from a JSX-free barrel.
- **No committed fixture,** as in earlier phases. The loaded **Explain selection** plugin was a
  scratch build in `/tmp`.

### Verification

Run with Node 26.8.1.

- `SelectionActions.test.tsx` (7): no owner call or row run while the selection changes, the target
  and run, fence language, the platform menu cases, the 64 KiB UTF-8 limit with four-byte characters,
  a change while open, restoring the selection, and unmount. Removing the cross-owner check or the
  `isCurrent` check fails a test. `contentSelection.test.ts`: byte limits and ranges.
  `MarkdownLifetime.test.tsx`: a fence keeps its language and a selection in it while text streams in.
- `chromeContextMenus.test.ts`: the exact bodies, a project document with no task, `contentKind`
  matching, and refusals for a changed Node, a task gone or moved, a disabled plugin, and a replaced
  registration. Protocol, `manifest.test.ts`, and `pluginAuthoring.test.ts` cover the facts and brief.
- `AgentEventCard.test.tsx`: assistant and user messages, a refusal after streaming on, and no target
  without a bound Node. `EditorPane.test.tsx`: an unsaved range with its revision, and a refusal after
  an edit while open. Removing the revision check fails it. `DocumentSurface.test.tsx`: the same for a
  task's SQL document. `apps/tui/src/agents.test.tsx`: the whole-text menu reached by keys.
- Suites: `@acorn/protocol`, `@acorn/plugin-api`, `acorn-plugin-types`, `@acorn/node-core`, and
  `@acorn/client-core` (2,676) pass. `@acorn/plugin-editor` fails only the four known status-menu
  tests, `@acorn/plugin-agents` only `managedBridge`, and `@acorn/tui` only the two `chrome.test.tsx`
  marker tests. `@acorn/arch-tests` fails only the 15 known dead links. Lint errors are only in the
  known agents, changes, git, and workflows files. The terminal startup closure is 683,095 of 700,000 B.
- **Desktop, `pnpm dev:agent --fixture tui-navigation`.** The scratch plugin declared **Explain
  selection**, **Explain this code** (`when: { contentKind: 'code' }`), and **Open explanation**
  (`openPane`). Selections were made by script and the `contextmenu` event dispatched on them.
  - Rendered Markdown in a response posted `contentKind: 'markdown'`, `text: 'Turn 0 summar'`,
    `revision: 15`, and the message resource. **Explain this code** wasn't offered there.
  - A selection in the response's fence offered all three rows and posted `contentKind: 'code'`,
    `languageId: 'typescript'`. **Open explanation** opened the plugin's pane, which drew the code.
  - A selection across two messages left the platform menu. Escape closed the menu and restored the
    selection, which the first run had shown WebKit clears.
  - In Editor, an edit to `README.md` showed **Unsaved**. Shift+End and the menu posted `contentKind:
    'document'`, `languageId: 'markdown'`, line 1 columns 1 to 58 with the unsaved text, the file
    resource, and `revision: 2`. Focus returned to the editor.
- **Terminal, `pnpm dev:tui:agent --fixture tui-navigation`.** The trust overlay listed the plugin.
  Each message drew **Actions for the whole text** with the loaded rows. The driver couldn't move keys
  out of this externally controlled session's disabled message box, so invoking it is covered by the
  full-shell test above.
- Not checked in a real host: a plugin document surface (the unit test covers it), and an oversized
  selection.

### What later phases need to know

- An owner opts in by wrapping its content in `SelectionActions` with `select` and `isCurrent`, plus
  `whole` if the terminal should offer the block. Phase 10's fence viewers draw inside a message, so a
  viewer that replaces a fence should keep `.ui-code-wrap` and `data-language` on its wrapper, or
  selections in it become `markdown`.
- Phase 09's hover and diagnostics can reuse `documentSelection` for one-based positions.
- A menu that takes focus clears a WebKit page selection. Any new menu over selected text needs the
  same restore.

## Original plan

Planned October 6, 2026. Baseline: `0ce874a15c856db07992cc5f7650b6730c6aadaf`.
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
