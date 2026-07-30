# Editor Client and UI

**Status:** Normative current-plugin migration<br>
**Requirement prefix:** `CUR-EDITOR`

## Contributions and renderer capabilities

| Contribution | V2 identity | Desktop behavior |
| --- | --- | --- |
| Editor pane | `acorn/editor.pane.editor` | file tree, tabs and code surface |
| Search pane | `acorn/editor.pane.search` | query controls and grouped matches |
| File overlay | `acorn/editor.overlay.files` | `Cmd+P` fuzzy quick-open |
| Reveal command | `acorn/editor.command.reveal-active` | expands tree and scrolls active file into view |
| File reveal intent | `acorn/editor.intent.reveal` | opens file and reveals position |
| Renderer provider | `acorn/editor.renderers` | activates built-in code/file-tree/search/diff capabilities |

`CUR-EDITOR-050` The Editor pane retains label “Editor”, pencil glyph, order 50, default
`Cmd+Shift+E`, minimum width 320 px and normal host pane behavior. Search retains label “Find in
Files”, search glyph, order 60 and `Cmd+Shift+F`.

`CUR-EDITOR-051` The file overlay retains title “Go to file”, default `Cmd+P`, maximum 100 rendered
matches, keyboard selection, accessible dialog semantics and fuzzy matching across the active
task's authorized file list.

`CUR-EDITOR-052` The renderer-provider declarations select Electron's allowlisted
`acorn.code-editor/2` features `read,edit,multi-file,selection,reveal,language-id`,
`acorn.file-tree/2` features `lazy,selection,reveal`,
`acorn.search-results/2` features `grouped,ranges,navigation`, and
`acorn.diff-review/2` features `unified,split,virtualized`. Negotiated limits are fixed for each
view session.

`CUR-EDITOR-053` Monaco, diff implementation and language workers are shipped in the Electron
build, outside the plugin bundle, and selected only from the Client allowlist. No language
identifier, repository file, manifest or plugin response can load a package, extension, worker
URL, grammar, stylesheet or executable code.

## Editor pane behavior

`CUR-EDITOR-054` The pane renders a lazy file tree on the left and a tab bar plus one reusable code
editor surface on the right. A loading state precedes root resolution; missing checkout,
permission denied, disconnected Node, unsupported renderer and plugin failure have distinct
standard states and recovery actions.

`CUR-EDITOR-055` Single-clicking a tree or quick-open file creates one italic ephemeral preview
tab. Opening another preview replaces the previous clean ephemeral tab. Double-click, explicit
non-ephemeral open or first edit promotes it.

`CUR-EDITOR-056` Tabs display basename, full relative path tooltip, active state, ephemeral style,
dirty marker and close action. Closing the active tab selects its right neighbor at the same index
or the previous final tab; closing a background tab does not change selection.

`CUR-EDITOR-057` One editor instance may swap file models, but the implementation MUST bind every
asynchronous load/save result to task URI, file URI, worktree generation and model generation so a
late result cannot land in another file.

`CUR-EDITOR-058` `Cmd+S`, editor blur, tab switch, tab close, pane unmount and a 1,500 ms typing
debounce request save. Before application quit, plugin disable, task archive, Node switch or Client
update, the host presents a dirty-buffer decision and does not discard silently.

`CUR-EDITOR-059` Save snapshots content and expected revision. Typing during the request leaves the
model dirty after success. Conflict leaves the model dirty, reports the changed file and offers
compare/reload/merge without automatic overwrite.

`CUR-EDITOR-060` On Client focus or a core file-updated event, a clean model reloads if its
revision changed. A dirty model is never replaced; it receives a conflict indicator even when the
external content equals a previously observed revision.

`CUR-EDITOR-061` Per-file cursor, selection and scroll survive pane/task switches within the
Client session. They are not durable product data and are removed when the task is archived,
authorization is revoked, the checkout generation changes or the installation is removed.

`CUR-EDITOR-062` Open tabs and active tab persist per node-qualified task, up to 32 KiB, without
dirty flags or file bodies. Missing files retain recoverable labeled tabs until closed; an unknown
plugin/layout ID remains inert for reinstall.

`CUR-EDITOR-063` Expanded directories are session-only, scoped by node-qualified task and retained
through pane remount. Revealing a file expands each ancestor, scrolls it into view and acknowledges
the exact reveal revision once.

`CUR-EDITOR-064` Theme changes update editor colors from semantic Acorn tokens. Syntax highlighting
uses trusted bundled grammars; plain text is the fallback. Selection, cursor, line numbers and
dirty/conflict state remain discernible in light/dark, high contrast and without color.

## Search and navigation

`CUR-EDITOR-065` Search waits 200 ms after query input, while case, whole-word and regex toggles
apply immediately and cancel the preceding request. The pane shows prompt, searching, count,
truncation, validation, timeout, cancellation and Node-unavailable states separately.

`CUR-EDITOR-066` Results group by file, show copy-safe relative path, per-file count, 1-based line,
bounded text excerpt and highlighted ranges. Provider text is rendered as text, never markup.

`CUR-EDITOR-067` Mouse single-click selects without navigating; double-click reveals in Editor.
Keyboard/assistive activation navigates on one activation. Navigation opens Editor beside Search,
centers the validated position and focuses the editor.

`CUR-EDITOR-068` `acorn/editor.intent.reveal` accepts node-qualified task/file, 1-based line/column,
optional end position and `add|show` layout policy. Electron validates Node/task match and the Node
revalidates file revision on open; out-of-range positions clamp safely.

`CUR-EDITOR-069` The reveal-active-file command is available only when the Editor is focused in
the active task, a file is active and the tree is available. Predicate truth affects display only,
not file authorization.

## Agent and host integration

`CUR-EDITOR-070` “→ agent” sends either a file URI reference or a file URI plus inclusive selected
line range through `acorn/agents.reference.insert@2`. It does not send file content and cannot
choose or create an Agent session implicitly.

`CUR-EDITOR-071` If Agents is absent, denied or unhealthy, the action is omitted or disabled with
an accessible reason. Editor remains otherwise fully functional.

`CUR-EDITOR-072` Other plugins may invoke only the declared reveal navigation intent or semantic
renderer capability. They MUST NOT import Editor state, Monaco models, pane components or private
Client events.

## Accessibility, fallback and lifecycle

`CUR-EDITOR-073` Tree, tabs, search options, results and editor expose labels, roles, focus order,
keyboard operation, selected/expanded/dirty/conflict states and screen-reader announcements.
Focus returns to the invoking result/tab after a transient dialog.

`CUR-EDITOR-074` At narrow widths the tree may collapse behind a labeled toggle; it does not cover
the editor. Minimum-width and pane overflow behavior remain host-owned.

`CUR-EDITOR-075` A Client lacking edit support uses read-only `acorn.code-editor/2`; lacking code
renderer uses bounded plain text; lacking tree/search uses explicit metadata/unsupported states.
Future mobile is read-only by default and may omit multi-pane Search.

`CUR-EDITOR-076` Client suspension releases editor workers and search pages after preserving
compatible tab/view state. Resume reauthorizes resources and refreshes revisions before enabling
write.

`CUR-EDITOR-077` Task archive closes view sessions, cancels search, prompts for dirty content before
archive commits, evicts tabs/tree/view state and prevents a late save from recreating state.

`CUR-EDITOR-078` Renderer exceptions are contained to the contribution, reported against the
Electron capability plus invoking plugin generation and replaced with a standard error surface.
They do not reload Electron or disable the Node companion automatically.

`CUR-EDITOR-079` UI acceptance MUST exercise mouse, keyboard and screen reader operation; tab
replacement; save/typing races; external edits; conflict recovery; task/Node switching; missing
capabilities; large/binary files; disconnect/reconnect; theme change; and Agent dependency absence.
