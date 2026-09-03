import type { Disposable } from '../../../kit/lib/registry'

// Who draws a command that cannot be run.
//
// A leaf action has an executor and `executeCommand` calls it. A group has none, and neither will a
// search, an input or a setting: they are entered at a frame, and the thing that draws frames is the
// palette session (./session.ts). So a shortcut aimed at one has to reach whichever host is drawing,
// and this is the one wire between them.
//
// A registry of one rather than the usual `Registry`, because there is exactly one palette per
// client and a second registration is a bug rather than a second contributor. Registering hands back
// the previous presenter on dispose, so a test that installs one does not leave the next test
// talking to a disposed session.
//
// This is not a second dispatcher. The keymap remains the only thing that turns a key into a command
// id (docs/command-palette-and-shortcuts.md § Focus and typing); what changes is what happens to the
// id once `executeCommand` has it and finds no executor behind it.

/** What opens the palette at a command's own frame. The session implements it. */
export type CommandPresenter = {
  openAt: (commandId: string) => void
}

let current: CommandPresenter | null = null

export function setCommandPresenter(presenter: CommandPresenter): Disposable {
  const previous = current
  current = presenter
  return {
    dispose: () => {
      if (current === presenter) current = previous
    },
  }
}

/** Ask the presenter to open at `commandId`. `false` when nothing is drawing a palette, which is a
 *  bare-Node test and the moments before the shell has mounted. */
export const presentCommand = (commandId: string): boolean => {
  if (!current) return false
  current.openAt(commandId)
  return true
}
