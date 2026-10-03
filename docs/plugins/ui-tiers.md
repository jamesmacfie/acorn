# Choosing how a plugin draws

This page gives the rule for choosing between a descriptor, a remote tree, and a rectangle, and the
two host slots a descriptor badge may fill. Read it before you add a surface. It's part of the
[plugin reference](../plugins.md). [Extensibility](../extensibility/ui-and-cooperation.md) holds the
longer reasoning.

## Descriptors for facts, trees for UI, rectangles for pixels

A descriptor is a fact the host draws. A tree is UI, written in the host's own components. A
rectangle is pixels the host can't draw. Ask which of the three a surface is, in that order, and take
the first that fits.

- **Facts.** A status chip, a footer badge, a menu row, and a palette entry are each a fact. As an
  iframe, each would cost a separate document, could never look native, and would be dead whenever no
  frame of that plugin was mounted. None of the small surfaces accept frames. The answer to "I want a
  chip in the topbar" is a wider descriptor vocabulary, not a slot open to an iframe.
- **UI.** A pane, a reference panel body, a settings page, and a card in another plugin's list are UI,
  and they're trees. The host draws the components, so the result has the shell's keyboard handling,
  focus, ARIA, and the reader's style pack, and the same source runs compiled in this process or in a
  worker.
- **Pixels.** A PTY, a webview, a canvas, and a code editor are rectangles.

A tree isn't a static schema such as Slack Block Kit, where the plugin sends JSON and the host has one
renderer per block. A static schema is always one field short: somebody needs an `if`, then a loop,
and a bad programming language grows inside JSON. acorn refuses that. In a tree, the plugin's code
runs in a sandbox, renders with a normal framework against a fake DOM, and streams mutations of named
host components. The plugin's real code does the conditional and emits a different tree. The
vocabulary is the kit, which is already versioned through `@acorn/plugin-api/ui`, so the tree adds no
second vocabulary.

Three options for the middle tier were refused:

- **A remote subtree per item at volume.** One per diff line would be thousands of sandboxed mounts.
  Facts pinned to items are [annotations](./rows-and-annotations.md#annotations), which are batched
  and host-drawn. A tree is for a card, a tab, or a section, things that number in the dozens.
- **A hidden iframe as the sandbox.** A Web Worker has no DOM, is lighter per plugin, and needed only a
  transport swap for the bridge.
- **First-party plugins through the remote root.** Every first-party pane would pay the sandbox hop,
  including the agents transcript. First-party code renders directly against the same API, and the
  two paths produce the same tree, so slots and focus work across both.

## Descriptor slots

The manifest's `slots` enum has two names, and the refusals are recorded beside it in
`@acorn/protocol/plugin/contract.ts`:

| Manifest slot | Host slot | What it is |
| --- | --- | --- |
| `footer` | `task.footer` | The task footer, invisible until a task is open |
| `topbar` | `topbar.right` | The app's status bar, beside the Node chip and the notification bell |

These slots are refused:

- `overlay` is the full-window layer that draws the config-trust gate, the plugin trust dialog, and
  the command palette. A contribution there could paint over the prompt that asks whether to trust
  it.
- `drawer` is a dock with real UI, and its slot context carries shell callbacks a descriptor can't
  receive.
- `topbar.left` and `task.switcher.extra` have no host rendering them, so a manifest naming one would
  parse and never appear.

A slot name this client doesn't know is skipped, not mapped to a default, because a roster row is
bytes a Node sent. [Contribution kinds](../contribution-kinds.md#the-slot-vocabulary) lists the full
`UiSlotId` set.

A rail row isn't a slot. Rail status is published as data, through [rail
markers](./menus-and-markers.md#rail-markers) for a compiled plugin and the `core:task` annotation
point for a loaded one.
