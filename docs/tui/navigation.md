# Terminal navigation

This page covers how you move around the terminal client's screen: the region cycle, columns, Escape,
and the shell's global keys. It's part of [the terminal client](../tui.md).

## Navigation

`Tab` and `Shift+Tab` cycle regions, beside `F6`, which is the desktop's key for the same intent
because the browser owns Tab. The cycle reads down the screen: Menu, Browse when it has a list, Tasks,
the pane strip when a task is open, then the pane or source regions. `right`/`l` crosses from the
rail to the main area and `left`/`h` comes back, without wrapping. `Ctrl+Option+Right` and
`Ctrl+Option+Left` take the same edge before they cycle a task pane, so the pane chord works from the
rail too.

In a rail list, Up, Down, `j`, and `k` move, and Enter activates the row and enters the main area. An
overlay or an entered PTY gets Escape first. In a tabbed detail, `left` and `right` choose a tab,
`down` enters its controls, `Tab` steps between controls from inside a field
([typing](./typing.md#tab-in-a-field)), and Escape, Up from the first control, or Left and Right return
to the strip, changing the tab on the way. A control that moves out of view is revealed, and the wheel
scrolls the viewport on its own.

### The shell's topology

The shell installs what the keys module can't know. `setTopology` takes three answers and
`setPaneCycler` a fourth, all from `apps/tui/src/chrome/Shell.tsx`: where Escape goes from the top of
a region, which region takes the keys first, which regions a first crossing into a column skips, and
what "the next pane" means when only one is drawn. No chrome ID is spelled in the keys module.

`apps/tui/src/chrome/topology.ts` holds those answers. Escape climbs one level each press. A source
detail goes to the Browse list it came from, or to the Menu row that chose the source when it has no
list. A task pane's regions go to the strip above them, and the strip goes to the Tasks list. From the
rail, Escape falls through to the shell's layer and clears a notification. The first region is Tasks
when the session opened with a task and no source, and Menu otherwise. A first crossing into the pane
column skips the pane strip, because the strip is a line above the pane, not a place to work.

The region cycle covers the whole screen: the rail panels, the pane strip while a task shows it, the
pane's regions, and back. Browse keeps its frame when a component-only source is selected but
registers no region without a list, so neither it nor an absent strip is an empty Tab stop. The chrome
orders itself around the pane by declaring orders outside the range a layout uses. `nextPane` first
honors the rail and main edge in its direction, and once focus is in main with no further column, it
switches which task pane is drawn.

### Columns

Regions declare a column, counted from 0 at the left. Menu, Browse, and Tasks are 0. The pane strip
and every layout or source region default to 1. A layout that draws two frames side by side declares
the second as 2: `list-detail` for its detail, and `frame-beside-document` for its frame. A bubbled
`expand` moves to the nearest column on the right and a bubbled `collapse` to the nearest on the left,
restoring that column's last-used region, never wrapping. Left in the rail and Right from the
rightmost column do nothing, because Tab already cycles. Collections and layouts answer first: a tree
that can expand, or a narrow `list-detail` that can switch groups, uses the key before the region tier.
Spatial movement is off while an input has the keys.

No digit jumps to a region. The set of regions changes with the screen: Browse registers nothing
without a list, `Ctrl+B` hides the rail, the strip draws only with a task open, and a pane's regions
are its layout's. So `3` would name a different region on nearly every screen, and the footer has no
room to say what each digit does. `Ctrl+1` to `Ctrl+9` belong to the `tabs` layout.

### Global keys

These keys work at the screen's own depth:

| Key | Action |
| --- | --- |
| `Ctrl+K` | Open the command palette, from anywhere except an entered PTY |
| `?` | Open the cheat sheet |
| `w` | Switch workspace |
| `p` | Switch project |
| `;` | Switch to the last workspace |
| `Ctrl+B` | Hide or show the rail |
| `n` | Open the notification inbox |
| `t` | Open the open task's terminal sessions |
| `q` | Quit, asking first when this client started the Node |

`w` and `p` open an overlay, and both schedule a settle, so the caret lands on the first row of the new
list. The palette also offers terminal sessions when the active Node has the Terminal plugin. The task
rail may shorten a title to keep its marker count, so a line across the screen repeats the selected
task's full title. A source row with a promotion contract offers `Shift+F10` to create a task or attach
to one. The source owns the operation, and the terminal supplies the task choices.

A pane opens with the keys already in it, because there's no click to put them there. Menu and Browse
also select the row they open on, and other regions only focus it. Which source a workspace opens on
is one derivation in `apps/tui/src/chrome/model.ts`: the first source Menu draws, once both gates
behind that list have answered.
