# Phase 1: the terminal on the phone

Date: October 23, 2026. Status: built. Real-device checkpoint skipped. Depends on nothing.

## Completion note

October 23, 2026, on branch `phase-1-terminal`.

What landed:

- `TerminalSessions.tsx` holds the drawer's old body: the tab strip, the profile menu, the toolbar
  slot, and a surface per session. `TerminalPanel.tsx` is the drawer around it, with its height,
  grip, maximized state, and Hide. `TerminalPane.tsx` is the phone's pane around it, with the key
  row.
- `paneContribution.ts` registers the `terminal` pane for phones only, loaded after the first frame.
- `keyRow.ts` holds the bytes each key sends and the one-shot Ctrl. `liveXterm.ts` feeds every
  terminal's input through `withCtrl`, gives each terminal a `press(key)`, and publishes which one has
  focus as `focusedTerminal`.
- The kit `Button` takes `keepsFocus`, which cancels the `mousedown` default so a press leaves focus
  in the field that has it. `ToggleButton` and `IconButton` pass it through.
- `installPlatform` in `apps/mobile/src/client/platform.ts` opens the event feed for the Node on
  screen when the paired list arrives after client-core named that Node. Before this, a phone that
  loaded the app straight onto a task heard no events at all: no terminal output, no keystrokes
  delivered, and no live updates in any pane, until the person picked another Node.

Decisions and deviations:

- The pane's `formFactor` is `['narrow']`, not `['mobile']`. A pane's form factors are `desktop`,
  `narrow`, and `tui` (`FormFactor` in `@acorn/protocol/chrome.ts`). `mobile` is a frame surface's
  word, which `packages/client-core/src/host/frames/register.ts` maps from `narrow`.
- The feed fix is outside the terminal, in the phone's platform module. Checkpoint 2 can't pass
  without it, and it was a one-line cause with a test that fails without it.
- Ctrl is one-shot and page-wide: one keyboard, so one Ctrl. It spends itself on the next input to
  any terminal, and a multi-character input, such as an arrow from the row, passes through unchanged.
- The key row types through `term.input`, not by sending bytes to the Node directly. xterm then
  scrolls to the bottom as it does for typing, and the arrows follow the application cursor-key mode
  that `vi` and `less` switch on.
- The WebGL renderer needed no change. `liveXterm.ts` already drops to the DOM renderer on a lost
  context and asks for WebGL again on the next show.
- Adding `arrow-right` to the key row put about 100 B of icon geometry in client-core's eager icon
  map, which `icon-census.mjs --check` requires. The first screen still shrank, see the evidence.

Found and left alone: the drawer grip's arrow keys run backwards. ArrowUp shrinks the drawer and
ArrowDown grows it, because `createSplitDrag` flips the key's direction for `invert` and the drawer's
`onDelta` subtracts the delta again. This phase moved that code without changing it.

What later phases need to know:

- A plugin's client code can only draw kit nodes (`tools/arch/boundaries.test.ts`), so a control that
  must keep focus uses `keepsFocus` rather than its own `mousedown` handler.
- Checkpoint 4 still needs the owner on an iPhone and an Android phone. It decides whether
  cancelling `mousedown` keeps the iOS keyboard up, and whether the iOS keyboard sends composition
  events that xterm reads twice.

## Design

**The pane.** ID `terminal`, label **Terminal**, glyph `terminal`, `order: 90`, so it sits last in
the bar, after Preview's 80. A task opens on the first pane in the bar, so it never opens on this
one, which can start a shell. `requires: { plugin: 'terminal' }` and `formFactor: ['narrow']`. The
desktop keeps its drawer and never lists the pane. The layout is `single`, whose body drops its inline
padding around a rectangle.

**With no sessions.** The pane does what the drawer does on open. If **Settings** > **Terminal** names
a default profile, it starts that one. Otherwise it shows **No terminals** and a **New terminal**
button, which starts a shell.

**A session started from the phone.** It is an ordinary session on the Node: `POST
/v1/p/terminal/sessions` with the task ID, then `term:attach` with the fitted size over the phone's
channel. Leaving the pane unmounts its surfaces. The xterm stays held and detaches after 10 seconds,
and the shell keeps running on the Node, as it does when the desktop hides its drawer. Closing a tab
removes its session. Closing the last one leaves the pane empty.

**The key row.** It shows while a terminal has focus, at the foot of the pane, which ends where the
keyboard begins. Each key goes in through xterm, so it reaches the Node as a `term:input` frame:

| Key | Bytes |
| --- | --- |
| Esc | `1b` |
| Tab | `09` |
| Up, Down, Right, Left | `1b 5b 41` to `1b 5b 44` (`ESC [ A` to `ESC [ D`). In application cursor-key mode, `1b 4f 41` to `1b 4f 44`. |
| Ctrl, then a character | The character's C0 code: `c` is `03`, `[` is `1b`, space is `00`, `?` is `7f`. A character with no control form goes unchanged. |

**Owning documents.** [The terminal drawer](../../terminal/client.md#the-phones-terminal-pane) gains
the phone's pane. [Features](../../features.md#phone), [the mobile web app](../../mobile.md#limits),
and [the terminal](../../terminal.md) change their phone lines. No route, frame, or header changes.

## Goal

Open a terminal on a task from the phone, read its output, and type into it, including the keys a
phone keyboard can't send.

## What works at the end

A **Terminal** pane sits in the phone's bar of panes. It lists the task's terminal sessions, opens
one, and starts one from the default profile. Above the on-screen keyboard, a row of keys sends Esc,
Tab, Ctrl with the next key, and the four arrows.

## Starting point

- The terminal registers one UI slot, `terminal.drawer`, in
  `plugins/terminal/src/client/drawerContribution.tsx`. The phone's shell draws panes and no
  drawers, so the terminal never appears there.
- `plugins/terminal/src/client/TerminalPanel.tsx` wraps its tab strip and surfaces in the kit's
  `Drawer`. `plugins/terminal/src/client/TerminalSurface.tsx` draws one session with xterm.js through
  `plugins/terminal/src/client/liveXterm.ts`, which loads the WebGL addon.
- Output arrives as `term:out` frames, and input leaves as frames on the same hub
  (`plugins/terminal/src/client/wsChannel.ts`). The phone channel carries both
  ([the phone channel](../../relay/phone-channel.md)).
- [Features](../../features.md#phone) says typing in a terminal draws on a phone. With no drawer, it
  doesn't.
- [Narrow mode](../../mobile/narrow-mode.md#the-keyboard) tracks the keyboard's height in
  `--keyboard-inset` and hides the bar of panes while the keyboard is up.

## In scope

- A phone-only pane contribution with `formFactor: ['mobile']` and `requires: { plugin: 'terminal' }`.
- Splitting `TerminalPanel` so the drawer and the pane share the tab strip and surfaces, and only the
  drawer wears `Drawer`.
- The key row, in narrow mode only, while a terminal has focus.
- xterm's renderer on iOS Safari: the WebGL addon while it holds, and the DOM renderer after a lost
  context.
- Correcting the phone paragraph in [features](../../features.md#phone).

## Out of scope

Layout recipes, run targets from the palette, and other plugins' toolbar actions. They stay on the
desktop until someone asks for them on a phone.

## Steps and checkpoints

### 1. Write the design

Name the pane's ID, its place in the bar, and what it shows with no sessions. Say how a session
started from the phone attaches, and what happens to it when the person leaves the pane. List the
bytes each key in the row sends.

### 2. Share the panel body

Move `TerminalPanel`'s body out of the `Drawer`, so the drawer and the pane draw one component.

**Checkpoint 1: the desktop drawer is unchanged.** In `pnpm dev:agent`, open the drawer, add two tabs,
close one, drag the drawer taller, and switch tasks and back. Each should behave as it did before.

### 3. The pane

Register the pane for phones only. Load its code lazily, so the first screen doesn't grow.

**Checkpoint 2: a shell in a phone-sized browser.** In Playwright WebKit at 390 by 844, open a task,
pick **Terminal**, start a session, and run `ls`. The output should draw, and the session should
survive a switch to another pane and back.

### 4. The key row

**Checkpoint 3: control keys.** In the same setup, run `sleep 100`, then press Ctrl and type `c`. The
shell should print a prompt. Press Esc to leave insert mode in `vi`, Tab to complete a path, and the
up arrow to recall a command.

**Checkpoint 4: real phones.** On an iPhone and an Android phone, through the relay, repeat
checkpoints 2 and 3 with the on-screen keyboard. Record whether xterm kept its WebGL renderer and
whether the key row stayed above the keyboard.

## Acceptance

- The terminal pane opens a session, takes typing, and survives a pane switch on both phones.
- Ctrl-C, Esc, Tab, and the arrows reach the shell.
- The desktop drawer behaves as before.
- The phone's first screen stays under its ceiling.

## Docs to update when it ships

- [Features](../../features.md#phone): the terminal on a phone.
- [The mobile web app](../../mobile.md#limits): what's left of the terminal limit.
- [The terminal](../../terminal.md): the phone pane beside the drawer.

## Open questions

- Should a session started on the phone keep running after the person leaves the pane, as a desktop
  tab does? Answered: yes. The shell lives on the Node, and leaving the pane detaches the phone
  without ending the session.
- Does the iOS keyboard send composition events that xterm reads twice? Deferred to checkpoint 4,
  because only a real iPhone can answer it.

## Evidence

October 23, 2026:

- **Build.** `pnpm --filter @acorn/mobile build`: the first screen is 506,722 B of scripts, against a
  520,000 B ceiling and 506,975 B before this phase.
- **Tests.** `@acorn/plugin-terminal`: 31 files, 229 tests passed, including `keyRow.test.ts`.
  `@acorn/mobile`: 55 passed, and `platform.test.ts`'s feed test fails with the fix taken out.
  `@acorn/client-core`: 382 files passed. `@acorn/arch-tests`: 97 passed.
- **Checkpoint 2, passed in WebKit and Chromium at 390 by 844.** Setup: `pnpm dev:account`,
  `pnpm dev:mobile`, and a throwaway standalone Node signed in to the stand-in with remote access on.
  The phone signed in, paired, opened a task, and picked **Terminal**. **New terminal** started a
  shell, `ls` printed `notes.txt` on screen and in the Node's output, and the session was still
  running, the same session, after a switch to **Git** and back. xterm drew with WebGL in both.
- **Checkpoint 3, passed in WebKit and Chromium at 390 by 844.** `sleep 100`, then **Ctrl** and `c`
  printed `^C` and a prompt. **Ctrl** showed pressed, and the focus stayed in the terminal through the
  press. **Tab** completed `ls note` to `ls notes.txt`. **Up** recalled `echo recall-me`. **Esc** left
  insert mode in `vi`, so `:wq` saved the file. No pane drew "This view stopped working".
- **Checkpoint 1, passed in `pnpm dev:agent`.** The drawer opened at 360 px with its grip, **Hide**,
  and **No terminals**. **New terminal** and the **+** menu's **Shell** added **Shell** and
  **Shell 2**. Closing **Shell** left **Shell 2** on its own surface. The grip grew the drawer to 504
  px and the terminal refit to it. A switch to another task and back brought the drawer back at 504 px
  on **Shell 2**. The task's pane switcher listed no **Terminal** pane, only the drawer's toggle. The
  driver's synthetic pointer drag fails at `setPointerCapture`, so the grip was moved with its arrow
  keys.
- **Checkpoint 4, skipped.** It needs the owner with an iPhone and an Android phone. No agent holds a
  phone.

## Verify before building

`drawerContribution.tsx` says there's no PTY engine in a browser. Find out what that comment meant,
and check that it doesn't hold for a phone, whose frames come over the channel.

Checked: the comment was stale. The gate beside it is `{ plugin: 'terminal' }`, which asks whether the
Node runs the terminal plugin, and every session lives on the Node. A browser reaches it over the same
`term` frames as the desktop. The comment says so after this phase.
