# The palette session

This page covers the session behind the command palette: what it owns, how commands nest, the
search, input, and setting kinds, and when the session closes. Read it before you add a command kind
or change how either palette draws. It's part of
[command palette and shortcuts](../command-palette-and-shortcuts.md).

## One session draws both palettes

`packages/client-core/src/host/registries/commands/sessionStore.ts` owns what's open, where in the
command tree it is, what's under the cursor, and what Enter does. The desktop's `CommandPalette.tsx`
and the terminal's `apps/tui/src/chrome/Palette.tsx` render it and bind keys to it. Neither fetches a
row or runs one, so a nested or asynchronous command works on both hosts at once.

## Groups

`CommandContribution` is a discriminated union of five kinds: an action, a group, a search, an
input, and a setting. A static command can name a group registered by the same contributor as its
`parentId`. The graph refuses a parent from another contributor, duplicate IDs, a parent that isn't a
group, and a cycle. Each refused command is dropped with one diagnostic, so the palette still draws
(`packages/client-core/src/host/registries/commands/graph.ts`).

An empty root lists top-level commands. A query at the root searches every available command at any
depth, against its title, keywords, hint, and joined breadcrumb. A hit below the top level shows the
trail it came from, so nesting reduces noise without hiding a command. Inside a group, the query
narrows that group's children.

Enter runs a leaf and opens a group. Escape goes back one frame and restores that frame's query and
cursor exactly, because the session keeps the whole frame object. At the root, Escape closes the
palette and hands focus back. Focus is restored on the final close, never on an intermediate step
back. Clicking a result activates it. Backspace edits the query and never steps back.

A shortcut aimed at a group opens the palette at it. The keymap is the only global dispatcher: it
hands a command ID to `executeCommand` whether the command is a leaf or not. A command with no
executor goes to the registered palette presenter, which opens the session at that command's frame
(`packages/client-core/src/host/registries/commands/presenter.ts`). A leaf named this way opens at
its parent with the cursor on it.

## Search, input, and setting commands

A `search` command owns the field. The host waits 250 ms after typing stops and for at least two
characters by default, asks the provider with an `AbortSignal`, and draws the instruction, loading,
empty, error, or result state that comes back. When a search provides a placeholder, the field shows
it. The breadcrumb shows parent groups only, so a top-level search starts with the field.

An `input` command has no delay. You press Enter once and see a pending row, and you can't submit
twice. A failure keeps the frame, the text, and the message. Nothing is scheduled while an input
method editor is composing a character, and the end of the composition schedules once.

A `setting` command shows the current value before it changes it. Entering the frame asks the owner
for the value, draws the 2 to 32 declared choices, and marks the one that's set. Picking a choice
writes it, keeps the frame open, and marks whatever the owner says it stored, never what was asked
for, so a failed write leaves the list accurate. The session refuses a value that names none of the
declared choices. A stored value the choices don't name leaves the list unmarked, and a failed read
is one line that Enter retries. Typing narrows the choices and asks nobody.

Every Boolean setting is an explicit **On** and **Off**, not a toggle, so the command shows the value
and means the same thing pressed twice. Free text, secrets, dependent fields, and anything that saves
several values at once stay on Settings pages.

## Stale answers

Every request carries a generation number taken when it was scheduled, and the session applies an
answer only if that generation is still current. The abort saves work, and the generation makes it
correct, because a provider can ignore its signal. A new query, a step back, a close, or a context
change aborts what's outstanding.

## Scope

A command says which identity it's about. `scope` is `none`, `task`, `project`, `workspace`, `node`
(the default), or `fleet`. The palette doesn't offer a command whose scope names an identity the
session didn't capture, and a shortcut can't open at it. `node` says where a request goes and isn't a
gate, because a client serving its own origin has no Node ID.

Only `fleet` fans out. It asks the host's fan-out adapter for its Nodes, runs one request each, and
namespaces every row as `<nodeId>:<itemId>` with the Node's label on the row. When one Node's request
fails, the other Nodes' rows stay.

## Outcomes

An action that returns nothing closes the palette. `{ effect: 'stay' }` keeps the frame open and can
carry a line to show. A throw or a rejected promise keeps the frame open with the message on it. A
second Enter while one is running is ignored. The palette awaits a loaded plugin's action, so a
`runNodeAction` the Node refused keeps the palette open with the Node's message.

## When the session closes

The session captures one fixed execution context when it opens: host, Node, workspace, project,
task, pane, and surface. It passes that context to every provider and executor. A change to the Node,
workspace, project, or task from outside closes the session and aborts what's outstanding. A command
that navigates closes through its own outcome first, so its error still has somewhere to show.

## A surface can lend its menu

A surface can register commands for its own menu while it's on screen. The agent pane registers the
open session's `•••` actions from the region that draws them and disposes them when it unmounts
(`plugins/agents/src/client/commands.ts`, [managed agents](../managed-agents.md) § From the command
palette). Use this shape for anything that needs a selection the palette can't name. The surface that
holds the selection owns the registration, so the rows exist exactly while they can work, and their
dialogs have somewhere to draw. It isn't a way to mirror a whole toolbar: stopping an agent stays out
of the palette.

Registry changes don't track. A reactive owner can reconcile its commands without subscribing to the
registry signal it writes, which would make it register itself again in a loop.
