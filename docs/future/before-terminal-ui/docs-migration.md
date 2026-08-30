# Docs migration: which document says the new true thing, and when

Part of [docs/future/before-terminal-ui/](./README.md). A phase is not done until its rows here are
applied. Where a row and the owning doc disagree after shipping, the owning doc wins.

## By document

| Document | Section | Phase | Change |
| --- | --- | --- | --- |
| `docs/ui-design.md` | Every node at 80 by 24 | 1 | Rows for `TableHead`, `TableRow`, `TableCell`; `Table`'s row notes author-declared truncation priority. |
| `docs/ui-design.md` | Every node at 80 by 24 | 2 | Row for `Link`: the text, underlined, pressable. |
| `docs/ui-design.md` | The closed kit | 1, 2 | Node counts and any enumerations updated for the four new nodes. |
| `docs/frontend.md` | The platform seam's verb list, wherever `pickFolder` is documented | 3 | `pickFiles` and `saveFile`, both probe-only groups, bytes across the seam. |
| `docs/frontend.md` | The desktop gate audit | 6 | The preview pane's row retires; the `{ seam: … }` variant is named as the replacement for capability-shaped gates. |
| `docs/managed-agents.md` | Attachments, if the flow is narrated | 3 | The dialog goes through the platform seam; no file input. |
| `docs/editor-monaco.md` | Whole document | 4 | Rewritten for CodeMirror and renamed `docs/editor.md` (new); linking docs repoint. The old name is deleted. |
| `docs/first-party-plugins.md` | The plugins | 4, 5 | The editor row stops naming Monaco; gains the two editing modes after phase 5. |
| `docs/first-party-plugins.md` | The plugins | 7 | The workflows row stops claiming the plugin registers no UI. |
| `docs/plugins.md` | The tree contract, if node names are enumerated | 1, 2 | The four new node names. |
| `docs/panes.md` or `docs/plugin-authoring.md` | Wherever `requires` is documented | 6 | The `{ seam: … }` variant beside `'desktop'` and `{ plugin }`. |
| `docs/testing.md` | Test layers, if the arch rules are enumerated | 7 | The client-tier purity rule beside the tree-directory rule. |
| `docs/future/terminal/01-why.md` | The plugin table | 7 | Rows for onboarding and workflows; model-providers and nodes-file noted as UI-less; the browser half of the preview row corrected; a settings-pages note. |
| `docs/future/README.md` | The programmes | each | The status cell tracks phases as they ship. |

## What this folder deletes when done

Phase 7 deletes this folder in the change that lands the arch rule, per the future-folder rules:
the survey's facts live on in the corrected terminal plugin table and in the arch test's baseline
comment, the decisions live in the owning docs above, and `docs/future/README.md` moves the entry
to Retired folders with a pointer to each.

## Untouched on purpose

`docs/plugins.md` § Descriptors for facts, trees for UI, rectangles for pixels — the argument this
folder executes, not amends. `docs/security.md` — no trust boundary moves; the file seams are shell
dialogs with the same custody as the folder picker. Everything under `docs/future/terminal/` except
the plugin table row above; the terminal programme's own docs-migration owns its documents.
