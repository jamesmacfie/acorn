# The survey: every plugin UI against the kit, 2026-08-31

Part of [docs/future/before-terminal-ui/](./README.md). This is the evidence the phases rest on:
every plugin's UI tier, read file by file for raw DOM, DOM APIs, and pixels, against the rule that a
plugin draws kit nodes and nothing else (`docs/ui-design.md` § The closed kit, `docs/plugins.md`
§ The tree contract).

## The three tiers, and who enforces what

**Loaded tree plugins** — http, linear, rollbar, database — draw under `plugins/*/src/tree/` and are
clean by test: `tools/arch/boundaries.test.ts` ("a loaded plugin that draws a tree writes no DOM and
ships no stylesheet") fails on a raw element, a `class`, a `style`, an `innerHTML`, a stylesheet, or
an import of the components barrel. Nothing to do here.

**Compiled panes** — everything under `plugins/*/src/client/` — are Solid JSX against
`@acorn/plugin-api/ui`, run in-process, and are clean only by discipline. The same scan the arch
rule runs, pointed at these directories, finds seven offending files across four plugins. That list
is the whole gap, and phase 7 turns the discipline into the test.

**No client half** — model-providers, nodes-file, browser — ship node and server code only. The
browser plugin's pairing with preview in the terminal programme's plugin table overstates it: its
agent tools are node-side and it draws nothing.

## Clean already

changes, context, memory, notes, docker, terminal, onboarding, and workflows write only kit nodes.
Several carry the migration in comments — the changes tool card names the `<details>` it replaced,
the editor file tree names its old `<ul>`, docker's container detail names the `<pre>` ref it no
longer holds. Two facts worth keeping:

- **onboarding** is kit-clean but host-coupled: `plugins/onboarding/src/client/OnboardingWizard.tsx`
  imports the `wizard` layout and the ASCII splash from `@acorn/plugin-api/ui/host`, the
  compiled-host-only barrel. That is fine on the terminal — first-party panes run in-process there
  too, and the `wizard` layout has a terminal projection (`docs/panes.md` § Layout model) — but the
  terminal programme's plugin table does not list the plugin at all.
- **workflows** registers a kit-pure settings page (`plugins/workflows/src/client/WorkflowsSettings.tsx`).
  `docs/first-party-plugins.md` still says the plugin "registers a client capability rather than UI",
  which was true when written and is not now.

## The offenders

### agents — must render whole on the terminal

| Site | What | Phase |
| --- | --- | --- |
| `plugins/agents/src/client/composer/AgentContextPickerModal.tsx` | Three `<p class="muted">` (one dragging a class no stylesheet defines), a `<strong>`/`<small>` pair inside a `Checkbox` label that the node's own `hint` prop already covers | 0 |
| `plugins/agents/src/client/settings/AgentConcurrencySettings.tsx` | A raw `<form onSubmit>` around kit nodes, submitted by a `Button submit` | 0 |
| `plugins/agents/src/client/settings/AgentPricingSettings.tsx` | The same `<form>`, plus two hand-rolled `<table>` bodies of editable `Input` cells — the largest raw-DOM site in any plugin | 0, 1 |
| `plugins/agents/src/client/composer/AgentComposer.tsx` | A hidden `<input type="file">` and an `HTMLInputElement` ref whose only job is `.click()` — the platform file dialog, reached through the DOM because the platform seam has no file picker | 3 |
| `plugins/agents/src/client/sessions/AgentEventCard.tsx`, `plugins/agents/src/client/sessions/agentPaneModel.ts` | `document.createElement('a')` download anchors for artifact and export saves — the only two in the repo, because nothing else saves a file and the seam has no verb for it | 3 |

The template is in the same folder: `plugins/agents/src/client/settings/AgentSessionDefaultsSettings.tsx`
is already kit-pure and saves on change. And the composer's drag-and-paste path is already clean —
`MentionTextarea` carries `File` objects through its own `onFiles` prop — so the hidden input is
only about opening the dialog.

One caveat the phases repeat: making these pages kit-pure makes the *plugin* terminal-ready. The
settings chrome around them (`packages/client-core/src/features/settings/SettingsModal.tsx`) is raw
DOM with its own stylesheet, and the terminal draws its own settings surface the way it draws its
own rail. Page purity is the plugin-side prerequisite, not the whole story.

### github

`plugins/github/src/client/pullDetail/PrOverview.tsx` renders ref tokens inside the pull title as
`<a class={REF_LINK_CLASS}>`, because the kit has no word for a clickable run of text inside a
sentence. The class is shared with `linkifyRefs`
(`packages/client-core/src/host/registries/panes/contentLinks.ts`), which mints the same anchors
imperatively over provider-supplied HTML — that half stays, it lives inside rectangle territory.
Phase 2 gives the declarative half a kit node.

### editor

`plugins/editor/src/client/EditorPane.tsx` imports Monaco directly and mounts it into the element a
`Rectangle kind="editor"` hands back — the rectangle contract is fine, the library behind it is the
problem. The pane also roots itself in a raw `<section class="pane editor-pane">` (the ref scopes
the close-pane chord) and reloads the file on a raw `window` focus listener. The host has a second
Monaco of its own in `packages/client-core/src/features/editor/DocumentSurface.tsx` (the SQL and
document surface the database and http panes use), with completions and keybinding interception on
top. Phase 4 replaces both; `plugins/editor/src/client/FileTree.tsx` and the file palette are
already kit-only and cross untouched.

### preview

`plugins/preview/src/client/PreviewPane.tsx` is a webview rectangle by nature and stays one — the
decision is that the page never draws on a terminal. The offences are around the rectangle, not in
it: a raw `<section>` root with an inline grid style, `<code>` in the empty-state prose, a raw
`window` resize listener, and a pane contribution gated on `requires: 'desktop'` when the honest
question is "does this host have the preview seam". A desktop shell built without preview views
still lists the pane and renders a dead end. Phase 6 fixes the gate; the raw root goes with it.

## DOM APIs, for completeness

Beyond the elements above, the client tier touches the DOM in exactly four more places:
`window.addEventListener` for editor reload-on-focus and preview resize (phases 4 and 6),
`window.addEventListener('error')` in the terminal surface (stays — xterm.js is inside a `pty`
rectangle, which is native on the TUI), and `document.createElement('a')` twice (phase 3).
`window.setTimeout` calls are timers, not DOM, and are not offences.

## Verify before building

- The offender list still matches a scan: run the RAW_TAG regex from `tools/arch/boundaries.test.ts`
  (comment-stripped, closing tags and void elements) plus the `class=`/`style=`/`innerHTML` check
  over `plugins/*/src/client`, non-test files. On 2026-08-31 it returned the seven files named
  above and nothing else.
- The four tree directories still have no `src/client/` sibling, so the two rules together cover
  every plugin UI.
- `plugins/agents/src/client` still ships no stylesheet.
