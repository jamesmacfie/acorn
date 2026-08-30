# Survey: what comparable systems do

Kept because each row still informs one decision. One decision per row; the arguments live in the
numbered file the row points at.

| System | What it does | What we take | Where |
| --- | --- | --- | --- |
| **OpenTUI** (`references/opentui`) | A TypeScript TUI with a Zig render core, a retained renderable tree, a Solid reconciler (`@opentui/solid`), and the keymap engine acorn already uses (`@opentui/keymap`). Runs under Node as well as Bun: the core package has a `node` export condition, and `@opentui/core-darwin-arm64@0.5.9` is already in our lockfile through the keymap. | The renderer, the reconciler, and the keymap's terminal adapter (`createDefaultOpenTuiKeymap`). The Zig core is a native dependency and is counted as one in [08-deployables.md](./08-deployables.md). | [04-rendering.md](./04-rendering.md), [05-keys-and-focus.md](./05-keys-and-focus.md) |
| **Zellij** | Sandboxed WASM plugins given a cell rectangle. | The model for the isolation boundary: plugin code out of the host's realm, a fixed region, a message port. Not the rendering; a Zellij plugin draws its own cells, and we refused that. | [06-isolation.md](./06-isolation.md) |
| **Textual** | Widgets declare bindings, the focus chain is derived from the tree, and active bindings render as a footer. | The keyboard story: bindings are declared, not handled; the footer shows what the focused thing accepts. Acorn's intents table is the declaration. | [05-keys-and-focus.md](./05-keys-and-focus.md), [07-chrome.md](./07-chrome.md) |
| **ratatui** | Immediate mode; selection state is owned outside the widget. | The lesson the host-owned collection store already took: `active`, `selected`, and `offset` live in the host, keyed by the item's own key, so a refetch keeps your place on any host. | [05-keys-and-focus.md](./05-keys-and-focus.md) |
| **VS Code** | Never solved "webview in a terminal"; its remote surfaces are descriptors, its rich ones are webviews and absent elsewhere. | The negative example. Descriptors alone leave the interesting panes behind. The tree is what lets acorn carry a pane's logic to a second host without carrying its pixels. | [01-why.md](./01-why.md) |
| **cmux** (`references/cmux/cmux-tui`) | A terminal multiplexer with a TUI client over a daemon: one long-lived process owns the sessions, thin clients attach and detach. | The process shape. The node is the daemon; `acorn` is a client that attaches to a running one or starts one. cmux is Rust and shares no code with us. | [03-process-model.md](./03-process-model.md) |
| **lazygit, k9s** | Single-binary TUIs that assume a running thing (git, a cluster) and never own it. | What a TUI user expects of a footer, a help overlay, and `?`. The refusal to own the backend is the half we do not take: our node may not be running yet. | [07-chrome.md](./07-chrome.md) |

## What was not surveyed, and why

- **Ink and React-based TUIs.** Acorn's kit is Solid. A second reactive runtime in the same process is
  the failure the shell guards against.
- **Bubble Tea, Ratatui as a host.** Rust and Go hosts would mean a second implementation of the tree
  host, the keymap, and the query layer, with none of client-core reused. The point of this folder is
  that client-core runs in a terminal.
- **Blessed, neo-blessed, terminal-kit.** Node TUI libraries without a reconciler or a maintained
  keymap. OpenTUI covers the same ground with the engine we already depend on.
