# 08-17. The diff file header: a plain status letter and a tiny fold control

**Status:** not started. Batch B08a. Written 2026-10-01. Line numbers are from 2026-10-01 and may
have moved.

The Changes list draws a file's status as a bordered xs badge. The diff header right beside it draws a
bare coloured letter with a native lower-case tooltip ("modified"). The collapse control is a text "▾"
at 10 pixels in a 16 by 12 button. One status reads two ways a few hundred pixels apart.

## Where to see it

**Review changed files** › Changes. Look at a file header in the diff, and scroll so it sticks.

## The fix

CSS and attributes only, inside the header's fixed 36-pixel height.

- `packages/client-core/src/infra/styles/diff.css:350-360`: `.file-status` takes the xs badge look: a
  1px border in its tone, `--radius-chip`, `--pad-chip` at xs, `--fs-2xs`.
- `diff.css:169-178`: `.diff-file-collapse` is a `--control-h-xs` square.
- `packages/client-core/src/kit/diff/DiffRows.tsx:126-147`: `data-tip` instead of `title`, and
  "Modified" in sentence case from `fileStatusMeta`.

## Copy

| Where | Current text | Decision | New text |
| --- | --- | --- | --- |
| `DiffRows.tsx:132` | Collapse file / Expand file (`title`) | Keep | As `data-tip`. |
| `DiffRows.tsx:138` | modified (status `title`) | Rewrite | Modified, as `data-tip` |
| `DiffRows.tsx:153, 165` | ⋯ Expand {n} lines ⋯ / ⋯ Expand below ⋯ / Expanding… | Rewrite | Show {n} hidden lines / Show the rest of the file / Loading… |
| `DiffRows.tsx:305` | Open {path}:{line} in editor | Keep | As `tip`. |

## Risk and checks

- Before you start, measure the header: it must stay 36 high.
- K3 left the diff rows' native titles alone on purpose, because the diff is perf-sensitive. Moving
  them to `data-tip` is attribute-only, but check the tip host does not attach a listener per row.
- CSS hygiene: no literal border width, radius, or font size. Use the tokens named above.
- Screens: a file header, the sticky header while scrolled, a collapsed file.
- Tests: the client-core diff tests and the CSS hygiene test.
