# The focus model

Design, 2026-09-02. The target the phases build towards, written once so every phase points at a
sentence here rather than restating it. Where this file and `docs/tui.md` disagree, `docs/tui.md`
describes the build and this file describes the intent; when a phase ships, the owning doc changes
and this file shrinks.

The model is small. Five levels, five key groups, one settle pass, eight invariants. If an
implementer finds the code needs a sixth level or a ninth invariant, the right move is to add it
here first and say why, so the next person argues with a rule rather than with a special case.

## Vocabulary

A **renderable** is an OpenTUI node. **Focus** is the renderer's: one renderable has it. The
**caret** `›` is drawn wherever focus is, by the node that has it. Nothing draws a caret from
collection state alone.

A **stop** is a renderable the keyboard can land on. The kit decides which nodes are stops
(`packages/client-core/src/kit/tokens/focusRoles.ts`), and on this host a stop is a renderable with
`focusable = true` plus an `activate` handler. A **collection** is one stop from outside with a
roving caret inside, and its rows are **items**. A **parent stop** is a stop that owns panels: Down
enters the active panel's first stop and Escape from anything in a panel returns to the parent. A
**trap** owns the keys while open and gives them back on dismiss. A **viewport** is a
`ScrollViewport`; it is a stop only while it holds no other stop.

A **region** is a focus group a layout or the chrome registers, with a declared order and a column.
A **column** is `rail` or `main`. The **topology** is what the shell knows and the keys module does
not: which column is where, which region opens the screen, and where Escape goes from the top of a
main region.

## The five levels

```text
Screen
└─ Column            rail | main                       Right/Left cross, no wrap
   └─ Region         Menu, Browse, Tasks, strip, a layout's regions   Tab/Shift+Tab cycle the screen
      └─ Parent stop a Tabs strip with panels, a Fold with children  Down enters, Escape returns
         └─ Stop     a Row (via its collection), Button, Input, Composer, Rectangle, a viewport with nothing in it
```

A region's **entry** is the first parent stop in reading order, else the first collection's active
row, else the first stop, else the region's own box. Entry is remembered per region by the logical
identity of the stop, not the renderable, so a row a query replaced is still the row the reader was
on.

Reading order is the retained tree walked depth first. Nothing derives order from screen position.

## The five key groups

Every key is an intent first (`packages/client-core/src/kit/keys/intents.ts`). The table below says
where each intent goes on this host. An intent bubbles: the innermost thing that can answer does,
and a handler that returns `false` passes it on.

| Group | Keys | Inside a collection | On a parent stop | On a plain stop | On a viewport with no stops | Bubbled to the region tier |
| --- | --- | --- | --- | --- | --- | --- |
| **Move** | `↓` `j` / `↑` `k` | next/prev row, wraps as `collectionIntents.ts` says | Down enters the active panel; Up goes to the previous stop in the region | next/prev stop in reading order within the panel, revealed in every enclosing viewport; edges are walls | scroll one fifth of a page | nothing |
| **Cross** | `→` `l` / `←` `h` | `expand`/`collapse`: a tree answers, a horizontal collection moves | choose the next/prev tab; edges are walls | nothing | nothing | rail → main / main → rail, landing on the destination column's last region, no wrap |
| **Act** | `⏎` `space` | `activate` the row: `onActivate`, then enter main if the region says so | nothing | press: `onPress`, toggle, open a `Select`, submit an `Input`, enter a rectangle | nothing | nothing |
| **Back** | `esc` | to the parent stop if the collection is inside one, else the region's home | to the region's home | to the parent stop, else the region's home | to the region's home | overlay closes; rectangle leaves; notifications clear |
| **Page** | `pgup` `pgdn` `home` `end` | `pagePrev`/`pageNext`/`first`/`last` on the collection | scroll the enclosing viewport | scroll the enclosing viewport | scroll | nothing |

Two keys are fixed at the screen level and do not bubble: Tab and Shift+Tab cycle regions in
declared order across the whole screen and wrap, and the pane chords cross the column edge first and
then switch the task pane. Both are unchanged from `docs/tui.md` § Navigation.

**Region home.** Escape from the top of a main region goes to a place the topology names, never to
"whatever was last focused": a source detail's home is Browse, a task pane's home is the pane strip,
the pane strip's home is Tasks. From a rail region Escape returns `false` and the shell's own Escape
layer clears notifications. From an entered rectangle or an open overlay, Escape belongs to that
thing first.

**Commit.** `ctrl+⏎` is `commit` and it submits the `Composer` or `Input` that has the keys. It is
typing-exempt, so it fires inside the text. A `Composer`'s submit button is also a plain stop
reachable with Down, for readers who do not know the chord.

**Typing.** While an `Input` or `Textarea` has focus, bare keys type. The move, cross, and page groups
are inert except `↑`/`↓` inside a multi-line `Textarea`, which move the cursor. Escape leaves the
field to its parent stop or region home, which is how a reader gets out of a composer without
sending. Tab, Shift+Tab, `ctrl+⏎`, and the pane chords work from inside a field.

## The settle pass

Focus decisions that need a renderable which does not exist until after a render happen in one
place: `settleFocus()`, scheduled at most once per render, running after Solid has committed and
before the next frame. It does, in this order:

1. If the focused renderable is destroyed or invisible, re-enter its region by remembered identity,
   else by entry rule.
2. If a region asked to open the screen and nothing has been focused yet, enter it.
3. If the focused region is holding the keys only because it had nothing better (provisional), and
   it has an entry stop, enter it and run the region's pick-on-enter if declared.
4. If an overlay closed this render, restore what it took, or re-enter that region if what it took
   is gone.
5. Reveal the focused renderable in every enclosing viewport.

Nothing else in `apps/tui/src` schedules a focus decision in a microtask. A component that wants
focus to move asks the store synchronously and the store settles.

## The invariants

Each is a sentence a test can check. Phase 6 turns them into properties over the pane roster.

1. **Every declared stop is reachable.** For every renderable with `focusable = true` on screen,
   some bounded sequence of Tab, Down, Right, and Enter-on-a-parent lands the caret on it.
2. **Every stop acts.** For every kit node whose focus role is `stop`, `collection`, or
   `conditional` with a handler, focusing it and pressing Enter (or Space where the table says
   Space) calls the handler.
3. **One caret.** At most one `›` and one lit control are on screen, and both mark the renderable
   that has focus.
4. **Escape is bounded.** From any stop in main, at most `depth + 1` Escapes reach the rail, where
   depth is the number of parent stops above it. It never wraps and never lands on a stop the reader
   did not pass through on the way in.
5. **One deferred decision.** `queueMicrotask` appears once in `apps/tui/src/keys/` and nowhere in
   `apps/tui/src/kit/`. Everything else is synchronous or is the settle pass.
6. **Focus never sits on a corpse.** After any render, the focused renderable is attached and
   visible.
7. **No chord this host cannot press.** The string `super+` does not appear in `apps/tui/src`
   outside the one rewrite that turns it into `ctrl+`.
8. **The footer tells the truth.** Every key the footer names is live at the focused renderable, and
   the word beside it is what that key does there.

## What the model does not decide

- **Which node is a stop.** That is `focusRoles.ts` and it is shared. This host realises the table;
  it does not edit it.
- **Where a region sits.** That is the layout's, through `regionFocus`, and the chrome's, through
  the topology. The keys module reads both and knows neither by name.
- **What a plugin sees.** A plugin receives `onSelect`, `onActivate`, `onPress`, `onChange`,
  `onSubmit`, and never a key. Unchanged.
- **Pointer behaviour.** Click focuses, wheel scrolls. Nothing else, unchanged from `docs/tui.md`
  § What the TUI never does.

## Worked example: the pull request

At 100 by 32, Menu on GitHub, Browse on pull 42, Enter:

```text
press   focus                              footer
⏎       source region → Details strip      h/l tab · j enter · esc back
l       Description tab
l       Labels tab
j       first Chip in the Labels panel     j/k move · enter press · del remove · esc back
esc     Labels strip
h h     Details tab
j       merge-method Select                j/k move · enter open · esc back
j       [Merge] button                     enter press
esc     Details strip
esc     Browse, on pull 42                 j/k move · enter open
```

Comments: strip → `l` to Comments → `j` lands on the composer's `Textarea`. Type. `ctrl+⏎` posts.
`esc` leaves the field to the strip without posting. `j` from the composer reaches `[Comment]`,
`[Approve]`, `[Request changes]` in reading order, then the first card's reply composer.
