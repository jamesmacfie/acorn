# Phase 1: the terminal on the phone

Date: October 23, 2026. Status: proposed. Depends on nothing.

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
  tab does? The default is yes, because the shell lives on the Node.
- Does the iOS keyboard send composition events that xterm reads twice? Checkpoint 4 answers it.

## Evidence

None yet.

## Verify before building

`drawerContribution.tsx` says there's no PTY engine in a browser. Find out what that comment meant,
and check that it doesn't hold for a phone, whose frames come over the channel.
