// The shell's arrangement, as the three questions the keys module cannot answer for itself.
//
// `../keys/regions.ts` knows five levels and no chrome. Where Escape goes from the top of a region is
// a relation *between* regions, so no single region can declare it; which region takes the keys when
// the screen first has any depends on how the session started; and which regions a first crossing
// into a column passes over is a fact about what the shell calls chrome. All three were literals
// spread between `./Rail.tsx`, `./Shell.tsx` and the keys module before this file
// (docs/tui.md § Navigation).
//
// This is the one file in `chrome/` that names region ids as strings anywhere but at the
// `regionFocus` call that declares them. Everywhere else the ids arrive as a `RegionRef` from here.

import { activeTaskId, selectedSource } from '@acorn/client-core/features/tasks/tasks.ts'
import { sourceRegistry } from '@acorn/client-core/host/registries/sources/sources.ts'
import type { RegionRef, Topology } from '../keys/regions'

const region = (regionId: string): RegionRef => ({ paneId: 'chrome', regionId })

/** The three panels of the left column, the strip above the pane, and the browse surface in it. */
export const MENU = region('menu')
export const BROWSE = region('browse')
export const TASKS = region('tasks')
export const PANES = region('panes')
export const SOURCE = region('source')

/** From the rail there is nowhere further left, so Escape falls through to the shell's own layer and
 *  clears a notification instead (./Shell.tsx). */
const RAIL = new Set([MENU.regionId, BROWSE.regionId, TASKS.regionId])

/** Whether the Browse panel has a list a reader can climb back to. A source that declared no regions
 *  keeps its whole surface in the main panel, and the panel beside it says so
 *  (client-core/host/registries/sources/sources.ts § regions). */
const browseLists = (): boolean => !!sourceRegistry.get(selectedSource() ?? '')?.regions?.list

export const topology: Topology = {
  // A task opened deliberately starts in Tasks. With no explicit view, Menu owns the initial focus so
  // its selected first source and the caret agree about where the session began (./model.ts).
  opensOn: () => (activeTaskId() && !selectedSource() ? TASKS : MENU),

  // The pane strip is a line above the pane, so Ctrl+Option+Right from the rail enters the pane's own
  // first region. Tab still stops on the strip, which is where its Left/Right belong.
  skips: (ref) => ref.paneId === PANES.paneId && ref.regionId === PANES.regionId,

  home: (ref) => {
    // A task pane's own regions climb to the strip that chose the pane.
    if (ref.paneId !== PANES.paneId) return PANES
    if (RAIL.has(ref.regionId)) return null
    // A source detail climbs to the list it came from, or to the Menu row that chose the source when
    // the source draws no list of its own.
    if (ref.regionId === SOURCE.regionId) return browseLists() ? BROWSE : MENU
    // The strip climbs to the list the task was opened from.
    if (ref.regionId === PANES.regionId) return TASKS
    return null
  },
}
