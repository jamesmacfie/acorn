# Find in file

Date: October 7, 2026

Status: Proposed product requirements. Implementation has not started.

This PRD defines find and replace controls built from Acorn's UI components for its graphical text
editors. Use it to implement and verify the shared panel without changing document ownership or saving.

## Problem and outcome

The inline editor search shows CodeMirror's stock inputs, buttons, and checkboxes. Acorn supplies
the panel background and text colors, but the controls use a different visual and interaction language
from the surrounding application. Replacement is visible even when the reader only wants to find text.

The reader must be able to find, navigate, select, and replace matches through Acorn controls.
Keep CodeMirror responsible for matching, document highlights, selection, replacement, and undo.
Use the same panel wherever Acorn mounts a graphical text editor.

## Scope

Include these entry points:

| Editor | Owner to inspect | Example |
| --- | --- | --- |
| Worktree file editor | `plugins/editor/src/client/EditorPane.tsx` | A source file opened from the file tree. |
| Host document editor | `packages/client-core/src/features/editor/DocumentSurface.tsx` | The database pane's SQL scratch document. |
| Embedded code editor | `packages/client-core/src/features/editor/embed.ts` | The workflow JSON editor. |

Apply the panel to writable and read-only text documents. Keep the existing document size admission
rules and lazy loading of the editor engine and grammars.

Exclude project-wide [find in files](../editor/find-in-files.md), image and custom file viewers,
terminal editors launched through `$EDITOR`, and a terminal client search redesign. The terminal
host must continue to load and render its editor fallback without importing graphical panel machinery.
Do not add Node routes, database records, plugin permissions, or plugin manifest fields.

## User experience

### Find row

Place the panel at the bottom of the editor, preserving CodeMirror's default placement. It occupies
editor layout space, so the last document line remains reachable and visible above it.

Use the shared `FindBar` with a **Find…** input, match position and total, previous and next controls,
and a close control. Render **Match case**, **Whole word**, and **Regular expression** as compact Acorn
`ToggleButton`s. Give every glyph or abbreviated label an accessible name and a shared tooltip.
Include **Select all matches** and a **Replace** disclosure control through kit components.

An empty query shows no count. A nonempty query with zero results shows **No matches** and disables
navigation, selection, and replacement actions. For a valid query, show the selected match's position
when the selection identifies a match. Do not claim a current match when the cursor is elsewhere.

Treat invalid regular expressions as an input error, with a visible and accessible explanation.
Disable actions until the query becomes valid. Preserve CodeMirror's literal, escape, whole word,
case, and regex semantics rather than defining a second query language.

### Replace row

Start with replacement collapsed when the panel first opens for a document. Expanding **Replace**
reveals an Acorn `Input` and **Replace next** and **Replace all** buttons in a second `Toolbar`.
Collapsing the row preserves its replacement text while that document's panel remains mounted.

An empty replacement value is valid and removes matched text. Preserve CodeMirror's regex replacement
semantics. **Replace next** and **Replace all** operate on the active document through editor commands.
They must participate in undo and the caller's normal saving or `onChange` behavior. Do not introduce
a separate save button or confirmation dialog.

Read-only documents omit the disclosure and replacement row. Re-evaluate this when the editor changes
documents or editability, rather than retaining controls from a writable document.

### Keyboard and focus

Preserve the editor's search commands and use the shared bar's typing behavior:

| Action | Required behavior |
| --- | --- |
| Cmd+F on macOS, Ctrl+F elsewhere | Open the panel and focus the find input. Repeated invocation focuses and selects the query. Preserve selection-based query initialization. |
| Enter in the find input | Navigate to the next match. |
| Shift+Enter in the find input | Navigate to the previous match. |
| Enter in the replacement input | Run **Replace next**. |
| Cmd+G or Ctrl+G, F3, and their Shift variants | Preserve CodeMirror's next and previous commands while focus is in the editor or panel. |
| Escape in the open panel | Close find and return focus to the editor in one press. |
| Tab and Shift+Tab | Reach the fields, option toggles, actions, and close control in a logical order. |

Opening find must not change document text. Closing it must not discard text, undo history, or the
query held by that document's editor state. Opening and closing replacement must not take focus to
another pane. If the editor unmounts, do not restore focus to a detached element.

Resolve Escape with the enclosing `Rectangle` so one press does not also leave the editor or dismiss
an unrelated overlay. Do not install a window-level shortcut handler. Preserve the host's single
keymap and its exception for keys handled inside an input or editor rectangle.

### Appearance and accessibility

Use kit typography, sizes, spacing, borders, focus states, pressed states, and role tokens. Verify
all appearance axes, including light and dark themes, while the panel is open. Use the shared editor
theme for search match and selected match highlights so their colors follow Acorn's appearance.

Keep the query usable in a narrow split pane. Wrap or group secondary controls using kit layout
patterns rather than clipping them or adding horizontal scrolling to the panel. Define the layout
at the narrowest pane size the host supports and verify it in the app.

Label both inputs independently of their placeholders. Announce count changes and query errors
without moving focus. The `FindBar` count already uses a polite live region. If a shared kit prop is
needed for an accessible label or status, add it compatibly rather than weakening the closed kit.

## Architecture and data flow

The shared editor feature owns the integration. The kit owns reusable controls and must not import
CodeMirror, document state, plugin APIs, or editor services.

Implement one search extension beside the editor theme in `packages/client-core/src/features/editor/`.
CodeMirror's [search configuration](https://codemirror.net/docs/ref/#search.search) exposes `createPanel`
for replacing its controls. Use that supported API to render Solid components into a CodeMirror panel.
Retain `basicSetup` unless inspection establishes a concrete conflict that requires a narrower setup.

The data flow is:

1. Editor state supplies its `SearchQuery`, selection, document, and read-only mode to the panel.
2. Acorn controls dispatch `setSearchQuery` effects or invoke CodeMirror's search and replacement commands.
3. Editor updates refresh the displayed query, options, match count, current position, and availability.
4. Replacement transactions reach the caller's existing update listener, document custody, undo
   history, and autosave or `onChange` path.

CodeMirror's search state owns the query, replacement text, and matching options. Solid state mirrors
that state for display. It does not become an independent source of truth. Replacement disclosure
is local presentation state. Do not introduce global search state or persisted search preferences.

The file editor reuses one `EditorView` and swaps per-file `EditorState`s. Refresh the panel against
the incoming state when this happens. Preserve any query and open-panel state carried by that
document's cached state. Do not transfer another file's query, counts, replacement text, or editability
through a stale closure. A document without retained search state starts with replacement collapsed.

Wire the same extension into all three entry points, including relevant empty and reconfigured
states. Publish only the narrow integration needed by the compiled editor through the editor
entrypoint. Preserve the terminal host's aliases and the lazy editor boundary. Declare direct
`@codemirror/search` imports as package dependencies rather than relying on transitive resolution.

## Integration constraints

Inspect these reusable components before adding abstractions:

- `packages/client-core/src/kit/components/inputs/FindBar.tsx` supplies search chrome and field keys.
- `packages/client-core/src/kit/components/inputs/Input.tsx` supplies text inputs.
- `packages/client-core/src/kit/components/inputs/ToggleButton.tsx` supplies matching options.
- `packages/client-core/src/kit/components/layout/Toolbar.tsx` supplies the strip and action grouping.
- `packages/client-core/src/features/diff/DiffToolbar.tsx` demonstrates a native find bar consumer.

Tag the find input with CodeMirror's `main-field` attribute through its element ref, so the engine can
focus and select it. Coordinate panel `mount`, `update`, and `destroy` with Solid ownership, context,
and disposal. Closing, reopening, state replacement, and editor destruction must release subscriptions
and component roots without creating duplicate listeners.

Keep CodeMirror's panel geometry, but avoid applying its stock search-control styles to Acorn
components. Theme document search decorations separately from the panel controls. Do not copy kit
CSS into an editor stylesheet or replace the stock controls by mutating their generated DOM.

Match counts must use CodeMirror's query semantics and refresh after query changes, document edits,
replacement, and undo. Do not scan the whole document on every cursor move. Cache match information
for an unchanged document and query. Bound counting work on large documents, and show an explicit
lower bound or incomplete status when counting stops. Navigation must remain available when an exact
total is unavailable. Assess `FindBar`'s count-based button availability before choosing that contract.

## Acceptance and verification

The implementation is complete when these observable behaviors pass:

- All three graphical editors show Acorn controls with no stock search inputs or buttons.
- Plain text, case-sensitive, whole word, and regex queries produce the engine's expected matches.
  Empty queries, no matches, invalid regexes, and wraparound navigation behave as specified.
- Find from a selection, repeated open, field keyboard actions, close, and focus restoration work.
  Escape closes one layer, including when replacement or an option button has focus.
- **Select all matches**, single replacement, replacement with empty text, and regex replacement work.
  Undo restores replaced text, and normal save or embedded change notification receives the edit.
- Switching files or tasks, external document updates, remounting, and read-only state changes leave
  no stale controls, results, or callbacks. Repeated open and close does not accumulate listeners.
- Narrow panes and appearance changes keep fields and actions readable and reachable. Query fields,
  option toggles, errors, counts, and actions have appropriate accessible names and states.
- A large document remains navigable while counting is bounded. Record the fixture size and observed
  counting behavior. No cursor move triggers another full document scan.
- Terminal editor entry points still import and render without DOM-only initialization.

Add focused tests for query synchronization, replacement through normal document transactions,
read-only transitions, state switching, and lifecycle cleanup. Test observable behavior rather than
component structure or copies of CodeMirror's matching implementation.

Run `pnpm lint`, the full suites for touched packages and their consumers, and
`pnpm --filter @acorn/arch-tests test`. Verify the graphical behavior in a real isolated desktop
session using the [agent driver workflow](../local-development/agent-drivers.md). Capture and inspect
screenshots for find, expanded replacement, a narrow pane, and contrasting appearances. Stop the
session after verification. Run the terminal driver if terminal behavior or its aliases change.

Update [Editor](../editor.md) and [The document surface](../editor/document-surface.md) with shipped
behavior, and record any shared component contract change in its owning UI documentation. Report
the checks, graphical evidence, counting limits, and unmet acceptance criteria at handoff.

## Why this approach

A shared adapter gives each graphical editor the same Acorn controls while keeping document behavior
inside CodeMirror. Styling the stock panel would retain separate control implementations and keyboard
behavior. Reimplementing search would add matching, replacement, and undo rules Acorn would own.
Neither alternative meets the ownership and component reuse requirements of this PRD.

## Verify before building

Confirm these assumptions against the implementation checkout:

- Read the owning editor, UI kit, focus, saving, package boundary, and testing documentation.
- Recheck the three editor entry points, per-file state cache, lazy imports, and terminal aliases.
- Verify the installed CodeMirror search and panel lifecycle APIs, focus marker, query effects,
  replacement semantics, and key scopes.
- Inspect `FindBar`'s labels, slots, keyboard handling, navigation availability, and count contract.
- Confirm panel geometry, supported pane widths, appearance tokens, and search decoration selectors.
- Trace replacement through each caller's update listener to autosave or `onChange`, including undo.

Paths in this proposal are starting points. If ownership has moved, preserve the requirements and
place the integration beside the feature that owns the editor.
