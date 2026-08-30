# Why a terminal client, and what it gets

## The question, and how the answer changed

Could a plugin's UI render in a terminal? The 2026-08-10 analysis said: descriptors render anywhere
for free; a terminal frame is an optional, opt-in ANSI rectangle a plugin draws itself; and a
host-owned widget vocabulary (the Textual model) was rejected as "grow descriptors into a UI
framework".

The layout programme reversed the third point, and the reversal is argued in
[docs/plugins.md § Descriptors for facts, trees for UI, rectangles for pixels](../../plugins.md). The
thing rejected was a static JSON schema. What shipped is a **remote component tree**: plugin code runs
in a sandbox and emits a tree of kit node names; the host mounts its own component per node. The
vocabulary is the closed kit, the logic stays in the plugin, and the schema never grows an `if`. That
object was not on the table in August, and it is exactly the one a terminal renderer needs: a tree of
intents with no pixels in it.

So the terminal client stops being "descriptors plus an optional TUI frame per plugin" and becomes
**a second host for the same tree**. A plugin writes its UI once against the kit; the desktop draws it
with Solid and the DOM, and the terminal draws it with Solid and cells.

## Who it is for

Three people, none of them hypothetical:

- **Someone at a server.** A node runs on a machine reached over ssh. Today the only way to look at it
  is to pair a desktop from a laptop on the same network. With `acorn` on that machine, the person
  already in the ssh session opens the workspace where they are.
- **Someone without the desktop.** A Linux laptop, a machine where the app is not installed, a
  container. The node runs there already (`docs/node-distribution.md`); the client did not.
- **Someone in tmux.** An agent workspace is mostly a PTY and a transcript. A person who lives in a
  terminal wants the transcript, the approvals, and the diff beside the PTY without leaving it.

## What a terminal client gets, and does not

Recorded so the door stays open and so phase 6 has a checklist. This is the 2026-08-28 survey of every
plugin, read column by column against the kit's 80×24 table
(`docs/ui-design.md § Every node at 80 by 24`):

| Plugin | Crosses | Does not |
| --- | --- | --- |
| agents | sessions, transcript, tool cards, composer, approvals | image attachments as images |
| github | list, overview, checks, conversation, diff with annotations, merge | nothing of note |
| changes | stage, diff, notes, commit, push | nothing |
| editor | file tree, search, read-only text view | CodeMirror; editing hands off to `$EDITOR` |
| terminal | the PTY, natively | nothing |
| docker | containers, info, logs with find, stats as bars, exec natively | nothing |
| context, memory, notes | all of it | nothing |
| http, linear, rollbar | all of it | inline images |
| database | SQL as a text region, results as a table | CodeMirror completions |
| onboarding | all of it; the wizard layout has a terminal projection and the splash is already ASCII | nothing |
| workflows | the settings page | nothing |
| preview | URL, run state, capture filenames | the page |

model-providers, nodes-file, and browser have no client half at all. The browser plugin's tools are
node-side, so pairing it with preview overstated it: it draws nothing to lose.

Settings pages are contributions like any other, so the four plugins that register one cross even
though the desktop's settings modal does not. The terminal draws its own settings surface the way it
draws its own rail, and fills it with the same pages.

Also not: charts beyond block and braille characters, and hover, which is never load-bearing anywhere.

A terminal client is not a subset. It is nearly the whole workspace minus three rectangles, and the
rectangle that defines an agent workspace, the PTY, is the one a terminal does best.

## What it costs

Honestly, in the order the phases pay it:

- **A second component per kit node.** Seventy of them. Fifty-two are `full`, fourteen `reduced`,
  three `absent`, one `fallback` (`packages/client-core/src/kit/tokens/support.ts`). Each already has a
  sentence saying what it draws. This is volume, not design.
- **Seven layout components.** Each has a written projection. Volume again.
- **A focus and key story without a DOM.** `host/layouts/regions.ts` and `keys/trap.ts` are DOM-deep. The
  intents, the layers, and the collection state are not. Phase 2 owns the split.
- **A process that is shell and broker at once.** The desktop puts the renderer and the helper in two
  processes so the renderer never holds a token. A terminal is one process. Phase 3 and
  [06-isolation.md](./06-isolation.md) say what that changes and what it does not.
- **Chrome.** The rail, topbar, palette, and overlays are bespoke DOM today, not kit. The TUI draws
  its own, and reuses the provider contracts `docs/future/client-plugins/` writes for the rail and
  topbar when those land.
- **A second native module.** OpenTUI's core is Zig, prebuilt per platform. `bundle.md` said node-pty
  was the only one. It was.

## What it proves

The kit was closed on the promise that a second host would not be a rewrite. Until one exists that is
a claim held by tests that check a column is filled in (`kitTable.test.ts`, `support.test.ts`,
`roles.test.ts`). Phase 0 turns the claim into a screenshot. If the http pane is unreadable at 80 by
24, the kit is dishonest somewhere, and finding out now, with two panes, is cheaper than finding out
after twenty more are written.
