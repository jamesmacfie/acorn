# UI design

acorn's UI is a dense keyboard-driven workspace. The visual system separates semantic theme tokens
from style-pack geometry so a user can choose color and shape/density independently.

## Shell hierarchy

```text
Topbar: Node/workspace context, repo/PR controls, global actions
TabRail: sources → workspaces → tasks
Main: Fleet home, source browse, or active task
Task: ordered pane row
Bottom drawer: terminals and raw provider sessions
Overlays: palette, settings, onboarding, notices, confirmations
```

The shell owns navigation chrome and modal prompts. Plugins supply feature content through registries
and slots. A native preview view is positioned over a pane host by Electron main; page content never
owns the surrounding chrome.

## Appearance

Themes provide semantic colors for backgrounds, text, borders, accents, diff states, notices, and
focus. Style packs provide typography, radius, spacing, density, chrome, and motion. The two choices
compose without feature components selecting literal colors. CSS variables are the runtime contract;
feature CSS is scoped to its plugin.

All 12 shipped themes and 4 style packs are registered literals and covered by parity tests. Device
preferences persist locally; they do not depend on which Node is active.

Feature-owned styles live beside the feature components that consume them. For example, the GitHub
pull list, pull detail, and checks panel import their own plugin styles; genuinely shared integration
settings remain in the client-core `integrations.css` role sheet. This keeps plugin presentation out
of the core aggregate without changing tokens or selector behavior.

## Primitive adoption ratchet

`packages/client-core/src/ui/adoption.test.ts` tracks the incremental migration from hand-written
controls to the shared UI primitives. Its `CONVERTED` list may only grow; every listed file must
avoid raw buttons, selects, textareas, and retired shared classes. New components should use the
primitives from the start, and the retired-class check must remain clean while older surfaces are
migrated.

## Interaction rules

- Command palette opens with `⌘K` and uses contributed actions and rows.
- `⌘1`–`⌘9` activates the corresponding visible task.
- `⌘⇧T` toggles the terminal drawer; `⌘⇧N` creates a task; `⌘P` opens the file finder.
- Pane chords are contribution-owned and user-overridable through Settings → Shortcuts.
- Typing fields, editors, terminals, and contenteditable elements stop global shortcuts unless the
  action is explicitly text-safe.
- Destructive actions and approvals use shell-owned confirmation chrome.

## States

Every Node-backed surface can show live, refreshing, stale, offline, disabled, or error. Stale data
retains its last value and names the Node. Offline mutations fail fast and keep typed input. Empty
states explain whether a feature is unconfigured, provider-gated, disabled, or simply has no data.

## Accessibility and density

Focus rings, keyboard traversal, text labels, tooltip delays, and reduced-motion tokens are shared by
client-core primitives. Dense layouts must preserve readable line height and a visible focus target;
style packs may compress spacing but must not hide status or action affordances.
