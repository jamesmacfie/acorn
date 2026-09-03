import { registerCommands } from './commands'
import { localSearch } from './localSearch'
import type { Disposable } from '../../../kit/lib/registry'

// One group with four children, so the hierarchy and the interactive kinds are real in a running app
// and not only in a test.
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
// the whole of the outcome contract a reader can see. The search and the input beside them are the
// two interactive kinds, drawn from data that is already in this process, so a person can walk every
// state — instruction, loading, results, pending — without a plugin installed.

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
    {
      id: 'core.commands.example.search',
      parentId: 'core.commands.example',
      kind: 'search',
      title: 'Search a list (temporary)',
      category: 'navigation',
      palette: true,
      order: 300,
      placeholder: 'Type to narrow the colours…',
      // The load-once adapter, which is what the terminal's run targets and the workflow rows become
      // when they migrate: nothing is debounced and there is no minimum, because the list is already
      // here (./localSearch.ts).
      ...localSearch(() => ['amber', 'cyan', 'magenta', 'teal'].map((colour) => ({
        id: colour, title: colour, subtitle: 'a colour, and nothing else',
      }))),
      select: (item) => ({ effect: 'stay', status: `You picked ${item.title}. Escape goes back.` }),
    },
    {
      id: 'core.commands.example.input',
      parentId: 'core.commands.example',
      kind: 'input',
      title: 'Say something back (temporary)',
      category: 'navigation',
      palette: true,
      order: 400,
      placeholder: 'Type a line and press Enter…',
      validate: (text) => (text.length < 3 ? 'A little more than that.' : undefined),
      submit: (text) => ({ effect: 'stay', status: `You said “${text}”. Escape goes back.` }),
    },
  ])
}
