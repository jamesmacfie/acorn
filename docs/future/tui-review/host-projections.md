# Host projections

Date: 2026-09-27. Status: decisions for terminal-specific presentation.

The shared closed kit is the right boundary. Product data, command outcomes, and permission rules
remain shared. A host can choose how to draw them and whether it has a capability. For an unavailable
capability, hide the control or replace it with a working terminal flow. Never leave a control that
acknowledges a press but performs no work.

| Desktop element | Terminal decision | Rationale and success criteria |
| --- | --- | --- |
| Lucide and SVG icons | Omit decorative icons. Use explicit text for actions and state; keep structural caret, border, checkbox, and scrollbar marks. | The terminal has no SVG. Users must identify an action without learning an arbitrary symbol table. The review removes the Lucide substitution map from the TUI kit. |
| Icon-only buttons | Draw the `label`; wrap or move the action to a second line when space is short. | Labels already exist in the shared component contract. No button can become invisible or `[object Object]`. |
| Status icons in PR, agent, and Changes rows | Show status words, counts, or a compact text state in the row or focused detail. | Removing a decorative icon must not remove the only distinction between open, closed, failed, active, or selected. Audit every `Icon` call whose `title` is absent. |
| Desktop side rail and hover tooltips | Keep named Menu, Browse, and Tasks panels. Add a full selected-item line where row truncation loses identity. | Terminal users cannot hover. A narrow list may abbreviate, but selection must reveal the whole name. |
| Desktop context menus and row ellipsis | Use a menu key or a labeled Actions control. Keep actions in a modal list when the row is narrow. | A trailing run of full labels can consume the row and obscure its title. All actions remain keyboard reachable. |
| Desktop settings pages and OS pickers | Provide terminal settings panels, typed paths, and text import/export where possible. Hide only operations that require an unavailable host service, with a reason and external path. | Settings are necessary for a standalone app. `acorn.json` is useful for automation but does not replace discoverable setup. |
| Agent Attach, Export, artifact download | Use the new typed local-path file seam, and verify each caller's full round trip. Show overwrite confirmation and write errors. | The seam now transfers bytes across the host boundary; a local path never reaches the Node. |
| Continue in terminal and terminal drawer | Use the native session list and PTY pane; verify managed resume and exit in a real CLI run. | A mode change must keep a reachable terminal and return route. |
| Preview webview | Keep gated off. Offer a readable URL and an explicit external-browser instruction when the task supplies one. | A text pane cannot reproduce an interactive browser preview. A missing tab is better than an inert browser frame. |
| Desktop source-item promotion menu | Use the TUI task picker to create or link a task. Verify the round trip with a connected provider. | `SourcePanel` passes the source's promotion contract to the picker. The source still owns its seed, create, and link steps. |
| Dashboard grid and `pane.aside` | Use a full-width list or table pane for data that informs decisions. For visual-only panels, show a named unavailable explanation. | A muted point name is not enough when a dashboard is the only view of its data. |
| Workflow graph canvas | Keep the indented card list and connection picker. Add clear parent and dependency text. | The list uses shared graph ordering and can be navigated without coordinates or dragging. |
| Desktop notification bell | Keep count plus `n` inbox. Name the count in help and retain actionable text for each row. | No hover or popover is required for the same attention data. |
| Native menu and file dialogs | Use palette commands and in-pane forms. Hide commands that call an absent platform seam. | The palette is a terminal-native discovery point; invoking a desktop-only dialog must not be a dead end. |

## Ownership and migration

Implement generic text projection in `apps/tui/src/kit`. Keep feature-specific status words in the
feature model or its shared kit props, so desktop and terminal agree on state. Make capability gates
read `packages/client-core/src/infra/platform` rather than checking `__ACORN_HOST__` throughout
plugins. A terminal-only control can be wrapped in the kit's host selection component and stays
hidden on desktop. The TUI chrome owns terminal-only setup, session navigation, and help. Node API
changes are justified only when a needed action cannot be expressed through the existing contract.

## Verify before building

- Search every shared `Icon`, `IconButton`, `iconOnly`, menu, `Only`, and platform file operation call.
- For each removed visual, write down the fact it conveyed and locate that fact in text on the same
  screen or in the focused detail.
- Check the desktop after shared component changes; the host selection must leave its behavior intact.
