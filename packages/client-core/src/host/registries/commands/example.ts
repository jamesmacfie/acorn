import { registerCommands } from './commands'
import type { Disposable } from '../../../kit/lib/registry'

// One group with two children, so the hierarchy is real in a running app and not only in a test.
//
// **Temporary, and it goes in phase 3.** The production catalogue is not migrated yet: no core
// command has a parent, so without this the desktop and the terminal would ship a palette that can
// push, pop and search descendants with nothing in it that does. That is the kind of feature that is
// green in a suite and broken in the app, so both hosts register these three and a person can press
// Enter on a group and Escape back out of it
// (docs/future/command-palette/phase-1-command-graph-and-session.md § Migration steps).
//
// The children are deliberately harmless and deliberately different: one closes, which is what a leaf
// action means, and one stays with a line, which is what a setting will mean. Between them they are
// the whole of the outcome contract a reader can see.

export function registerCommandGroupExample(): Disposable {
  return registerCommands([
    {
      id: 'core.commands.example',
      kind: 'group',
      title: 'Command groups (temporary)',
      hint: 'proves nesting until the catalogue moves',
      category: 'navigation',
      palette: true,
      // Last among its siblings. It is scaffolding, and scaffolding does not go at the top of the
      // list somebody uses every day.
      order: 900,
    },
    {
      id: 'core.commands.example.stay',
      parentId: 'core.commands.example',
      title: 'Stay open and say so',
      category: 'action',
      palette: true,
      order: 100,
      run: () => ({ effect: 'stay', status: 'Still here. Escape goes back.' }),
    },
    {
      id: 'core.commands.example.close',
      parentId: 'core.commands.example',
      title: 'Close the palette',
      category: 'action',
      palette: true,
      order: 200,
      run: () => {},
    },
  ])
}
