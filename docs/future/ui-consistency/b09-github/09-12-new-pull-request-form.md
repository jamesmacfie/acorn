# 09-12. The new pull request form reads right to left and repeats itself

**Status:** not started. Batch B09. Written 2026-10-01. Line numbers are from 2026-10-01 and may
have moved.

The branch row reads **main** ← **Choose a branch…**, base first, under the hint "The pull request
compares head into base.", while the pull's own facts read the other way. The title field's placeholder
is "Title" under the label "Title". The shortcut hides in the description placeholder. **Create pull
request** is outline with accent text, right-aligned, with no **Cancel**. Two sentences, one under the
button and one in the compare column, say the same fact with two verbs.

## Where to see it

GitHub in the left rail › **New** (today "+ New PR").

## The fix

- `plugins/github/src/client/CreatePullForm.tsx:105-171`: **From** [head] → **Into** [base], no hint.
  No title placeholder. The ⌘↵ chord as a `Kbd` hint under the box, through `formatChord`. Actions
  left-aligned: **Create pull request** solid, then **Cancel** ghost, which returns to the list. The
  status line sits above the actions and says only "Choose a branch to merge from.".
- `ComparePreview.tsx:50-62`: [09-8](./09-8-github-states.md)'s centred empty state.

## Copy

| Where | Current text | Decision | New text |
| --- | --- | --- | --- |
| `CreatePullForm.tsx:108` | Branches | Rewrite | Two labels in the row: From, Into |
| `CreatePullForm.tsx:108` | The pull request compares head into base. | Remove | |
| `CreatePullForm.tsx:111, 121` | base / Choose a branch… | Keep | |
| `CreatePullForm.tsx:134` | Title (placeholder) | Remove | |
| `CreatePullForm.tsx:144` | Describe this pull request… (⌘↵ to create) | Rewrite | Placeholder: What changed, and why? Hint under the box: ⌘↵ to create |
| `CreatePullForm.tsx:152` | Create as draft | Keep | |
| `CreatePullForm.tsx:156` | Create pull request / Create draft pull request / Creating… | Keep | |
| (new) | (none) | Rewrite | **Cancel** |
| `CreatePullForm.tsx:160` | Choose a branch to open a pull request. | Rewrite, move above the actions | Choose a branch to merge from. |
| `CreatePullForm.tsx:161` | Comparing… | Keep | |

## What earlier batches give you

- **`formatChord`** (B02), from `@acorn/plugin-api/client` or the kit's rendering helpers. B02 noted
  `CreatePullForm.tsx:144` still writes "⌘↵" in a placeholder.
- **The page-form rule** (plan decision 1): solid primary first, **Cancel** ghost, left-aligned.

## Risk and checks

- Before you start, confirm where **Cancel** should return to (the list, with nothing selected).
- Screens: the form empty, with a head branch picked, and the branch picker open.
- Tests: `plugins/github`.
