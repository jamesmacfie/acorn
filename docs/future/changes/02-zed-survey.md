# The Zed git panel, screenshot by screenshot

Part of [docs/future/changes/](./README.md). Status: reference, 2026-09-07.

The owner supplied seven screenshots of Zed's git panel. This file records what each shows and maps
every control onto acorn: **take** means copy the behaviour, **adapt** means the behaviour with a
different control or rule, **leave** means refused, with the argument in [refused.md](./refused.md).
The prototype in [prototype/panel.html](./prototype/panel.html) draws the result.

## Screenshot 1: the list, tracked group, flat view

A `Tracked` group header with a collapse chevron and a tri-state checkbox (drawn as a dash, since some
rows are staged). Rows read: status icon, file name in full weight, then the directory path dimmed and
truncated from the left with an ellipsis, then `+8 −0` in green and red, then a checkbox. A deleted
file (`agent-attachment-image.md`) has its name and path struck through and a minus icon. Under the
list: `acorn / main`, then `↓2 ↑144 Pull ▾`. Under that: a commit editor with the placeholder
`Enter commit message`, a fullscreen glyph and an expand glyph in its corner, a wand glyph at bottom
left, and `Commit ▾` at bottom right.

| Control | Zed | acorn today | Decision |
| --- | --- | --- | --- |
| Row: name first, path dimmed | Yes | Path only, mono | **Take.** `Row label` is the name, `Text emphasis="muted"` the directory. Phase 0. |
| Row: `+N −M` | Yes | Yes | Keep. |
| Row: checkbox for staged | Yes | `+` and `−` hover buttons | **Take.** `Checkbox` as the row's trailing control. Phase 0. |
| Row: struck-through deletion | Yes | `D` badge | **Adapt.** The kit's text roles have no strikethrough. The status badge carries it, and the badge is not going anywhere. |
| Row: status icon | Coloured square, plus, minus | `Badge` with a letter | Keep the badge. It is the vocabulary `fileStatusMeta` already gives the PR pane. |
| Group header with checkbox | Yes, tri-state | `Section` with `++` and `−−` | **Take.** `Fold` with a tri-state `Checkbox` in its actions. Phase 0. |
| Branch line | `acorn / main` | Nothing in the pane | **Adapt.** The project name and branch as a label with a `git-branch` glyph. Not a picker. Phase 3. |
| `↓2 ↑144` | Behind and ahead of upstream | Nothing | **Take.** From `# branch.ab` in the same status call. Phase 0 reads it, phase 3 draws it. |
| Primary remote button | Contextual label | `Push → origin` always | **Take.** Publish, Pull, Push, or Fetch. Phase 3. |
| Commit editor | Multi-line, placeholder | One-line `Input`, hidden until staged | **Take.** `Textarea grow`, always visible when the tree is a git tree. Phase 2. |
| Expand glyphs | Full-screen and pop-out | Nothing | **Adapt.** One control: expand to a `Modal` with the same draft. Two sizes of the same thing is a knob. Phase 2. |
| Wand | Generate a message | Nothing | **Take.** Through `core.models.generateText`. Phase 4. |
| `Commit ▾` | Split button | `Commit staged` | **Adapt.** A `Button` and a `Menu` trigger beside it; the kit has no split button and does not need one. Phase 2. |

## Screenshot 2: the list with the untracked group and the header

The header: `± View Diff +816 −1,091` at left, a sliders glyph, and `Stage All ▾` at right. Rows as
before; a staged deleted file (`hold.ts`) shows a checked checkbox in accent colour. Then an
`Untracked` group whose rows have plus icons, no counts, and unchecked checkboxes.

| Control | Zed | acorn today | Decision |
| --- | --- | --- | --- |
| `View Diff` | Opens the project diff | The diff is the detail column | **Leave.** Already on screen. Below 80 columns the layout's own key switches groups (`docs/panes.md` § Layout model). |
| Totals `+816 −1,091` | Sum over the list | Nothing | **Take.** Summed client-side from the numstat the rows already carry. Phase 0. |
| Sliders glyph | The view menu | Nothing | **Take.** `Button iconOnly opens="menu"`. Phase 1. |
| `Stage All ▾` | Split; flips to `Unstage All` | `++` per group | **Adapt.** One contextual `Button`: Stage all while anything is unstaged, Unstage all once everything is staged. No menu. Phase 0. |
| `Untracked` group | Own group, no counts | Mixed into "Changes" | **Take.** Three groups by default: Conflicts, Tracked, Untracked. Phase 0. |
| Accent-coloured checked box | Staged reads as done | | Comes with `Checkbox`. |

## Screenshot 3: the remote menu

Under `↓2 ↑144 Pull ▴`, a menu: Fetch, Fetch From, Pull, Pull (Rebase), then a separator, Push,
Push To, Force Push. Each has a chord.

| Item | Decision |
| --- | --- |
| Fetch | **Take.** `git fetch`. Phase 3. |
| Fetch From | **Leave.** One remote per task; refused.md § Other remotes. |
| Pull | **Take.** `git pull --ff-only`; a refusal says to use rebase. Phase 3. |
| Pull (Rebase) | **Take.** `git pull --rebase`. Phase 3. |
| Push | **Take.** Already there; keeps `--set-upstream origin HEAD`. |
| Push To | **Leave.** Same as Fetch From. |
| Force Push | **Adapt.** `--force-with-lease`, armed to confirm, and `before-push` sees `force: true`. Phase 3. |
| Chords on every item | **Leave.** Commit and amend get chords; the remote verbs get palette rows. Six more chords for verbs used a few times a day is not what the shared keymap is for. |

## Screenshot 4: the commit menu

Beside **Commit**, a menu: Amend with `⌘⇧↵`, Signoff, Skip Hooks.

| Item | Decision |
| --- | --- |
| Amend | **Take.** Toggling it on fills an empty editor with HEAD's message; the button reads **Amend**. `⌘⇧↵`. Phase 2. |
| Signoff | **Take.** A checked menu item; `--signoff`. Phase 2. |
| Skip Hooks | **Take.** A checked menu item; `--no-verify`. It skips git's hooks, not acorn's `before-commit` chain, and the label says which. Phase 2. |

## Screenshot 5: amend in progress

The editor holds a full message, subject and body, and the button reads **Amend ▾** with the menu
still beside it.

**Take** as drawn. The editor's contents are the draft, so switching amend off keeps the text; the
person can delete it if they meant to start over. Phase 2.

## Screenshot 6: tree view with the view menu open

Rows nest under folders with indent guides, and a folder's single-child chains are collapsed into one
row (`src/`, `tui/src`). Every folder row has a checkbox. The menu reads: View, with List and Tree;
Group By, with None, Tracked & Untracked, and Staged & Unstaged.

| Control | Decision |
| --- | --- |
| Tree view | **Take.** `Rows tree` with `TreeRow`; a pure function turns paths into folders and collapses single-child chains. Phase 1. |
| Folder checkbox | **Take.** Tri-state; toggling stages or unstages every file under it in one call. Phase 1. |
| Group by | **Take.** All three. The staged and unstaged grouping is what the pane draws today. Phase 1. |

## Screenshot 7: list view with the view menu open

The same menu in list view has a third section, Sort By, with Path and Name.

**Take** both sorts. The sort section is hidden in tree view because a tree is sorted by its
folders. Phase 1.
