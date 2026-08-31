# Docs migration: every document under `docs/` that changes, and when

Part of [docs/future/client-plugins/](./README.md). A phase is not done until the owning doc says
the new true thing. This file says which document owns each behaviour afterwards and which phase
rewrites it. Paths were checked on 2026-08-29.

## By document

| Document | Section | Phase | Change |
| --- | --- | --- | --- |
| `docs/plugins.md` | § The client half of a loaded plugin | 0 | A second provenance. "Nodes hold plugins" becomes "nodes hold plugins with a node half; a device may hold a client-only plugin." The resolution rule (device wins). |
| `docs/plugins.md` | § Replacing a core surface | 1, 2 | The slot list grows; core is a provider; the contract-per-surface rule; the nested-slot allowance for `rail` and `topbar`. |
| `docs/plugins.md` | new § Device-held plugins | 0 | Install sources, the no-node-half rule, device-scoped state, uninstall, the Settings section. |
| `docs/security.md` | § Third-party plugin bundles | 0 | Provenance on the acknowledgement row; the prompt's provenance line; the device dev grant. The `(pluginId, hash)` key is unchanged and the doc says so. |
| `docs/security.md` | § The containment ladder | 0 | One sentence: a device-held bundle sits on the same rung as a node-held one because it renders through the same path. |
| `docs/security.md` | § The dev grant | 0 | The grant key gains a device form. |
| `docs/state-ownership.md` | § Device | 0 | `plugin:<device-plugin-id>:*` joins the device set by prefix rule; why. |
| `docs/state-ownership.md` | § Device | 4 | The config file as a second door onto device prefs. |
| `docs/frontend.md` | § Composition | 1, 2 | The shell's chrome is providers of exclusive slots. `App.tsx` and `TabRail.tsx` become hosts. |
| `docs/frontend.md` | § Registries and plugins | 1 | `exclusiveSlots.ts` no longer has a `core` prop special case. |
| `docs/ui-design.md` | § Shell hierarchy | 2 | Rail and topbar are slots. |
| `docs/ui-design.md` | § Token axes | 3 | Style packs are contributable as data; the value alphabet table; the 25-selector cap is first-party only. |
| `docs/ui-design.md` | § Icons | none | Unchanged. The parked door lives in this folder, not in the owning doc, until it opens. |
| `docs/plugin-authoring.md` | § Themes | 3 | "Style packs are not contributable" becomes the `styles` contribution with the alphabet. |
| `docs/plugin-authoring.md` | new § Client-only plugins | 0 | How to write one, how to install it on a device, what it cannot declare. |
| `docs/contribution-kinds.md` | the table | 3 | `styles` row. |
| `docs/contribution-kinds.md` | the table | 0 | A "device-installable" column, or a footnote: which kinds a client-only plugin may declare. |
| `docs/command-palette-and-shortcuts.md` | § Focus and typing | 1 | The pane chords route to `pane.switcher` verbs. |
| `docs/panes.md` | § Layout model | 1 | The switcher is a slot; the layout row stays the reducer's. |
| `docs/shell.md` | § The renderer bridge | 0 | `plugins-install`, `plugins-remove`, and the provenance on `plugins-state`. |
| `docs/shell.md` | § Files on disk | 4 | `acorn.json`. |
| `docs/testing.md` | smoke checklist | 0, 1, 2 | Install a device plugin, pick a replacement switcher, break it, watch core return. |
| `docs/architecture-overview.md` | the plugin paragraph | 0 | One sentence on device provenance. |
| `docs/future/remote.md` | § Browser-side fan-out | 0 | `WebBroker` owes a `PluginCustody`; pointer to 07-hosts.md. |
| `docs/tui.md` (was `docs/future/terminal/06-isolation.md`, deleted) | § Custody | 0 | The file-backed custody; pointer to 07-hosts.md. |
| `docs/future/ecosystem/README.md` | the programmes | 0 | One line: device provenance does not change signing or discovery. |
| `docs/future/compiled-tier.md` | the map | 1 | The switcher and rail chrome are no longer reasons a plugin stays compiled. |
| `docs/future/README.md` | the programmes table | now | This folder's row. |

## What this folder deletes when done

Nothing under `docs/`. This folder itself shrinks phase by phase: a shipped phase's file becomes a
pointer to the owning doc and is deleted when the pointer is the only content, as the layout
programme does. `05-appearance-and-icons.md § Icons` stays until the door opens or the owner closes
it.
