# 07-16. The Add step menu is one flat list in id order

**Status:** done 2026-10-02 on `more-ui`. Batch B07a. Written 2026-10-01. Line numbers are from 2026-10-01 and may
have moved.

**Add** lists 17 step kinds in one run, sorted by plugin then kind id, so the order reads "Ask an
agent, Fix the checks, Ask AI to decide, Find records, Wait for a person…". Built-in and plugin kinds
are not separated. **Plan with AI, then For each** has no icon, so its label starts 28 pixels left of
every other item. The overflow menu has no separator before **Delete**, and **Schedule…** and
**Export to repository…** are disabled on an unpublished workflow with nothing saying why. **Move up**
and **Move down** are `Button iconOnly` with a native `title`.

## Where to see it

Workflows › any definition › **Add step** in the outline header, and the editor's overflow menu.

## Already done

- K4a gave the terminal `Menu` `Menu.Label` and `Menu.Separator`, so a plugin can group on both hosts.
  The kit part of this finding is finished.
- K4a set `.ui-menu` to at least 10rem, so the overflow menu's long items no longer wrap as badly.
- K3 routes a `Menu.Item`'s `title` to the styled tip, and `IconButton`'s tip defaults to its label.

## The fix

- `plugins/workflows/src/client/editor/NodeList.tsx:73-113`: group **Add** as **Ask AI** (agent,
  decide, ci-loop, AI list), **Records** (find, details, for each), **Flow** (if, gate, policy, run a
  workflow), then one group per plugin under its name. Sort each group by label. Give every item an
  icon. The description moves from the native `title` to the styled tip.
- `WorkflowEditor.tsx:348-368`: a `Menu.Separator` before **Delete** in the overflow menu, which puts
  it last below a separator per the destructive-item rule.
- `NodeList.tsx:82-85`: the move buttons become `IconButton` with `tip`. They move to the inspector
  header in [07-17](./07-17-buttons.md); do both together.
- A disabled item gets no hover, so its tip may never show. If it does not, put the reason in the
  label: "Schedule… (publish first)".

## Copy

| Where | Current text | Decision | New text |
| --- | --- | --- | --- |
| `NodeList.tsx:82, 84` | Move selected step up / Move selected step down (native `title`) | Rewrite | Tip "Move up" / "Move down" |
| `NodeList.tsx:97` | Plan with AI, then For each | Rewrite | Ask AI for a list, then run each |
| `WorkflowEditor.tsx:362` | Delete this workflow? | Rewrite | Delete workflow? |

## What earlier batches give you

- **`Menu.Label` and `Menu.Separator`** on both hosts (K4a). The terminal draws a muted line and a
  rule.
- **`pluginLabel`** (K5) for the per-plugin group names. K5 noted `NodeList.tsx:103` still prints an id.

## Risk and checks

- Before you start, check whether a disabled `Menu.Item` shows its tip in the real window.
- Screens: the Add menu, the overflow menu, and the overflow menu with **Delete** armed.
- Tests: `plugins/workflows` (`NodeList`), and `pnpm --filter @acorn/tui test` for the menu grouping.
