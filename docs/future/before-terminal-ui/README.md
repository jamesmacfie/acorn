# Before the terminal: every plugin UI honest about the kit

Status: in progress, 2026-08-31. Phases 0 to 5 have shipped.

The terminal programme ([docs/future/terminal/](../terminal/README.md)) rests on one claim: a plugin
writes its UI once against the closed kit, and a second host draws it without the plugin knowing.
The 2026-08-31 survey ([01-survey.md](./01-survey.md)) checked that claim against every plugin in the
tree and found it holds almost everywhere — the four loaded tree plugins are clean by test, and most
compiled panes are clean by discipline — but not everywhere. The agents plugin writes raw forms,
a raw table, a hidden file input, and two download anchors; the github plugin writes a raw anchor
because the kit has no word for a link; the editor and preview panes root themselves in raw
sections; and nothing enforces any of this in the client tier, so the discipline is one commit from
leaking.

This folder is the fix, phased. When it is done, every first-party client directory draws only kit
nodes, the two behaviours that genuinely need the platform (picking a file, saving a file) go
through the platform seam instead of the DOM, Monaco is gone, and the rule is a test with an empty
baseline. The terminal programme's phase 0 does not wait on any of this — it draws the http and
linear panes, which are already clean. Its phase 6, the sweep of every pane at 80 by 24, does: a
sweep over panes that still write `<form>` and `<table>` would file findings this folder already
knows about.

Where this folder and an owning doc under `docs/` disagree after a phase ships, the owning doc wins.

## Decisions taken

Decided with the owner on 2026-08-31. A phase file may not reopen them.

| Decision | Why | What it forecloses |
| --- | --- | --- |
| **The agents plugin renders whole on the terminal.** Every raw element in `plugins/agents/src/client` is replaced, including the attach and download paths, which move behind the platform seam. | An agent workspace is the product. A terminal client whose agents pane is degraded is a demo, not a client. | Any agents feature whose only implementation is a DOM API; a "desktop-only" carve-out for attachments or exports. |
| **Monaco leaves, everywhere, for CodeMirror 6.** Both instances: the editor plugin's pane and the host's document surface. `monaco-editor` leaves both `package.json`s. | Monaco is 2 to 5 MB of webview-only editor for a feature set the pane barely touches; CodeMirror 6 is modular, MIT, and covers everything both call sites use, completions included. Keeping one instance keeps the dependency and the second editor stack. | Keeping Monaco for the document surface; a webview-only editing tier the terminal must apologise for. |
| **A person may edit in their own terminal editor.** An editor preference whose terminal mode runs `$EDITOR` in an ephemeral PTY inside the same rectangle, on the desktop. | The infrastructure exists: the terminal protocol already carries a `command` override and docker exec proves the throwaway-PTY shape. It is the desktop twin of the TUI's suspend-and-hand-off, and cheap. | Nothing; the graphical editor remains the default. |
| **Preview stays pixels-only and is never offered where it cannot draw.** The pane's gate becomes the platform seam that actually backs it, so a host without the `preview` seam never lists it in a rail. | A rail entry that opens onto "needs the desktop app" is the host lying about what it can draw. The gate exists (`requires` on every filtered contribution); it just asks the wrong question today. | A terminal fallback UI for preview; `requires: 'desktop'` as a proxy for "has a webview". |
| **Clickable text inside a sentence is a kit node.** A `Link` node, not a press handler on `Text`. | `Text` is presentational and stays that way; a node that navigates or acts is a different intent, and the kit is one intent per node. The imperative twin (`linkifyRefs`) keeps minting anchors over provider HTML, which is rectangle territory. | `onPress` on `Text`; plugins keeping `REF_LINK_CLASS` anchors. |
| **The kit grows honest table rows.** `TableHead`, `TableRow`, `TableCell`, so `Table` stops accepting raw `<tr>`s from its callers. | Three callers all write raw row markup because the node gives them nothing else, and the support matrix promises a terminal rendering (`tui: 'reduced'`, truncating columns) no host can honour over DOM it cannot see. | Redesigning the pricing page to avoid tables; a `Table` whose children the host cannot draw. |
| **The kit-purity rule becomes a test over every plugin client directory.** The existing tree-directory rule splits in two: the DOM and stylesheet checks extend to `plugins/*/src/client` with a shrinking baseline; the components-barrel ban stays tree-only. | A rule held by discipline leaks; this repo ratchets with baselines. The offender list is seven files today and this folder empties it, so the rule can land with an empty baseline at the end. | New raw DOM in any plugin client directory, ever again. |

## The files

| File | What it holds |
| --- | --- |
| [01-survey.md](./01-survey.md) | The 2026-08-31 survey: every plugin's UI tier, what is clean, what is not, with file references. Read this first. |
| [refused.md](./refused.md) | What was considered and refused, with the argument. |
| [docs-migration.md](./docs-migration.md) | Every document that changes, which phase changes it, and how. |

## The phases

| Phase | File | What it delivers | What it unblocks | Waits on |
| --- | --- | --- | --- | --- |
| 0 ✅ | [phase-0-agents-dom-hygiene.md](./phase-0-agents-dom-hygiene.md) | The agents plugin's cheap raw DOM gone: the context picker's paragraphs, the two form wrappers | Phase 7's empty baseline | Nothing |
| 1 ✅ | [phase-1-kit-table-rows.md](./phase-1-kit-table-rows.md) | `TableHead`/`TableRow`/`TableCell` in the kit; all three raw-row callers migrated | The pricing page; the terminal's `Table` projection being honest | Nothing |
| 2 ✅ | [phase-2-link-node.md](./phase-2-link-node.md) | A `Link` kit node; the github ref links off raw anchors | Phase 7's empty baseline | Nothing |
| 3 ✅ | [phase-3-platform-file-seams.md](./phase-3-platform-file-seams.md) | `pickFiles` and `saveFile` on the platform seam; the composer's hidden input and both download anchors gone | Agents whole on any host | Nothing |
| 4 ✅ | [phase-4-editor-codemirror.md](./phase-4-editor-codemirror.md) | Both Monaco instances on CodeMirror 6; `monaco-editor` out of the tree; the editor pane on a kit root | Phase 5; a lighter renderer everywhere | Nothing |
| 5 ✅ | [phase-5-editor-pty-handoff.md](./phase-5-editor-pty-handoff.md) | The editor preference; `$EDITOR` in an ephemeral PTY on the desktop | Editing parity with the TUI's handoff | 4 |
| 6 | [phase-6-preview-gating.md](./phase-6-preview-gating.md) | The `{ seam: … }` host requirement; preview absent from every rail on a host without the seam | An honest pane switcher on the TUI and the PWA | Nothing |
| 7 | [phase-7-enforcement-and-docs.md](./phase-7-enforcement-and-docs.md) | The client-tier purity rule with an empty baseline; the terminal programme's plugin table corrected | `docs/future/terminal/` phase 6 | 0 to 6 |

## The order of work

Phases 0 through 4 and 6 wait on nothing and touch disjoint files; run them in any order or in
parallel. Phase 0 is an afternoon and a good first commit. Phase 4 is the largest by an order of
magnitude and can start immediately; nothing else needs to know which editor is behind the
rectangle. Phase 5 waits on 4 because the preference it adds chooses between two editors, one of
which phase 4 builds. Phase 7 goes last on purpose: its arch rule lands with an empty baseline only
because everything before it emptied the list, and its docs true-up records what actually shipped
rather than what was planned.

## How to work a phase

Each phase file has the same sections as the terminal and layout programmes: goal, why now, scope,
design detail, code touched, tests, docs owed, doors left open, done when, verify before building.
Two rules:

- **Verify before building.** File and line references were checked against the tree on 2026-08-31.
  Paths rot. Run the verify list at the end of each phase file before writing code.
- **Update the owning doc in the same change.** [docs-migration.md](./docs-migration.md) says which
  document owns each behaviour afterwards. A phase is not done until that document says the new true
  thing.

## What this folder is not

- It is not the terminal programme. Nothing here draws a cell or boots a TUI;
  [docs/future/terminal/](../terminal/README.md) owns all of that, and its phase 0 does not wait on
  this folder.
- It is not a settings-chrome redesign. Phase 0 makes the agents settings pages kit-pure; the modal
  around them (`packages/client-core/src/features/settings/SettingsModal.tsx`) is desktop chrome the
  terminal draws its own version of, and rebuilding it on the kit is out of scope here.
- It is not a kit redesign. It adds three table nodes and a link node through the standing admission
  conditions (`docs/ui-design.md` § The closed kit) and changes nothing else about the vocabulary.
- It does not schedule anything.
