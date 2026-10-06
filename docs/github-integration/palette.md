# GitHub from the command palette

This page covers the GitHub plugin's commands, which of them the palette shows, and why some stay out.

## From the command palette

Seven commands: six built as a function of what the router says
(`plugins/github/src/client/commands.ts`) and one registered at boot beside the rail source
(`plugins/github/src/client/index.ts`). How the palette itself works is
[command-palette-and-shortcuts.md](../command-palette-and-shortcuts.md); what belongs here is this
plugin's share of it.

| Command | Kind | Chord | In the palette |
| --- | --- | --- | --- |
| Open GitHub (`source.github.open`) | action | `⌘0` | Yes |
| Edit keyboard shortcuts (`help.shortcuts.open`) | action | `?` | No. The reference is a Settings page, and the palette already has a row that opens Settings |
| Find file in this pull request (`github.files.find`) | `search` | `/` | Yes |
| Next changed file (`github.files.next`) | action | `]` | No |
| Previous changed file (`github.files.previous`) | action | `[` | No |
| Find pull request (`github.pull.find`) | `search`, project-scoped | none | Yes |
| Create pull request (`github.pull.create`) | action | `c` | Yes |

`plugins/github/src/client/commands.test.ts` pins the six the component builds, in that order, and the
three of them that carry `palette`. Cycling is not one of the three: `[` and `]` step through a list
that is already on screen, and opening a palette to move one file forward costs more than the move.
Five of the six are gated on the route: the three file commands need a pull request open, and finding
or creating one needs the routed project to have a GitHub repository. `when` on the command and
`active` on the binding read the same accessors, so a palette row disappears for the same reason its
key stops doing anything.

They are registered per mount from `plugins/github/src/client/Shortcuts.tsx` rather than through
`ctx.commands`, because every one of the six needs the router: which project is routed, which pull
request is open, and where to navigate. A plugin's `init` runs at boot with no router in scope. The
decisions are still built in `commands.ts` out of eight accessors the component passes in, for the
reason `plugins/github/src/client/pullList/model.ts` exists: a decision worth testing should not need
a DOM to reach. The rail-source command needs no router and is registered the ordinary way.

**The changed-file finder is a `search` command on the shared palette session.** These rules hold:

- **`/` keeps its typing exemption and its route gate.** The binding is `typing-exempt`, so the bare
  key fires wherever the reader is in the pull request but not from inside a filter box or a comment
  composer, where a slash is a slash. It exists only while a pull request is open.
- **The order is the one order.** `plugins/github/src/client/changedFiles.ts` owns a pull request's
  changed-file order and its `?file=` target, and three places write that parameter, this finder, `[`
  and `]` cycling, and the file list in the navigator, so all three read the same file-summaries
  query. An empty query is that order; a ranked query keeps it as the tie-break. Ranking is over the
  whole path rather than over the filename and the directory a row draws separately, so `client/App`
  still matches `src/client/App.tsx`.
- **Picking a file writes `?file=`, and that is what makes the pick outlive the palette closing.** The
  URL is the selection and the diff reads it as its scroll anchor, so nothing has to be handed back
  out of a dialog that is already gone. A file the pull request no longer changes is refused rather
  than selected.

**The `overlay` slot component draws nothing, and is not dead code.** `Shortcuts.tsx` returns `null`.
It is kept because a registration that needs the router has to be mounted inside one, and a slot is how
this plugin gets a component mounted in the shell at all. It stays a `.tsx` sibling rather than a line
in `index.ts` (`plugins/github/src/client/slotContribution.tsx`) because this is the one slot whose
component needs a prop wired from the slot context, `onOpenShortcuts`, which the contribution fills
from `props.context.openSettings('shortcuts')`, and a JSX wrapper is how a slot adapts a component to
the host's props contract.

The cost of mounting that way is named in [what a plugin loses here](../tui/plugin-losses.md): the terminal host
does not fill the `overlay` slot, so both of these searches are desktop-only. The editor's `⌘P` is not,
because it is registered in its plugin's `init` ([editor.md](../editor/editor-pane.md) § From the command palette).

**Finding a pull request stays project-scoped and capped.** `scope: 'project'`, because the list is the
routed repository's open pull requests and there is no fleet or workspace query behind it to widen it
to. One read serves a whole palette session, so typing after the frame opens costs nothing, and
matching reuses the browse list's own `filterPulls`, so the palette finds a pull request by the same
words the filter box does: its number, its title, its author and its branch. `MAX_PULL_ROWS` is 50,
the same number the session caps any search at, said here so the provider keeps its own promise
rather than leaning on the host to keep it. Picking a row selects the GitHub rail source and then navigates, in
that order, because the shell draws from the selected source rather than from the location.

What is deliberately not a command: merging, converting a draft, submitting a review, commenting,
changing labels or reviewers, and rerunning checks. Every one of them needs the pull request in front
of you: which pull, which file, which thread, and what state it is in. So every one of them stays in
the surface that shows it. A palette row would have to rebuild that context or act without it.
