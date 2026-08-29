import { createComponent, lazy, type Component } from 'solid-js'
import { isPaneLayout, regionProblem, type PaneLayoutName } from '@acorn/protocol/paneLayouts.ts'
import type { Region } from '../layouts'
import type { Task } from '../queries'
import { hasHostCapability, type HostCapabilityRequirement } from '../hostCapabilities'
import { Registry, type Disposable } from './registry'

export type PaneId = string

/** Everything about a pane that is true whichever way it draws itself. */
type PaneCommon = {
  id: PaneId
  providerId?: string
  label: string
  glyph: string
  description?: string
  order: number
  defaultChord?: string
  requires?: HostCapabilityRequirement
  when?: (task: Task) => boolean
  keepAlive?: 'dom' | 'none'
  minWidth?: number
}

export type PaneContribution = PaneCommon & {
  component: Component<{ task: Task }>
  /** Set when the pane declared a layout. Read by nothing but a test; the component below draws it. */
  layout?: PaneLayoutName
}

/**
 * A pane that names one of the host's layouts and fills its regions
 * (@acorn/protocol/paneLayouts.ts, docs/panes.md § Layout model).
 *
 * The regions are components rather than elements, so a layout that draws one region at a time mounts
 * one. `tabs` names its panels `panel:<tab id>` and takes the bar from `tabs`.
 */
export type PaneLayoutContribution = PaneCommon & {
  layout: PaneLayoutName
  regions: Record<string, Component<{ task: Task }>>
  tabs?: readonly { id: string; label: string }[]
  /** Regions this pane is not showing right now, asked per render. */
  hidden?: (task: Task) => readonly string[]
}

export type PaneRegistration = PaneContribution | PaneLayoutContribution

// There is no per-pane `freshness` hook here (docs/panes.md § Contributions has the reason).
//
// A pane's own query status is only knowable reactively. TanStack's `getQueryState` is a snapshot, so
// a `freshness(task)` field returning one would render a badge that never updated, which is worse
// than no badge. Making it reactive means either a QueryObserver subscription per pane per render
// inside the host's `<For>`, or each pane publishing a signal it does not currently have.

/** Turn a declared layout into the component every consumer of this registry already expects. */
function drawLayout(entry: PaneLayoutContribution): PaneContribution {
  if (!isPaneLayout(entry.layout)) throw new Error(`pane '${entry.id}' names an unknown layout '${entry.layout}'`)
  const problem = regionProblem(entry.layout, Object.keys(entry.regions))
  // At registration rather than at render: a pane missing a region is a programming error, and finding
  // it when someone opens the pane means finding it in front of a user.
  if (problem) throw new Error(`pane '${entry.id}': ${problem}`)
  const layout = entry.layout
  // Behind `lazy` for the reason plugins/frames/register.ts states: this module is imported by
  // bare-Node test suites, and the repo's vitest configs have no Solid transform, so a static import
  // of a `.tsx` file would make it unimportable there.
  const Draw = lazy(async () => ({ default: (await import('../layouts')).LAYOUTS[layout] }))
  return {
    ...entry,
    component: (props) => {
      const regions: Record<string, Region> = {}
      for (const [name, Region] of Object.entries(entry.regions)) {
        regions[name] = () => createComponent(Region, { get task() { return props.task } })
      }
      return createComponent(Draw, {
        stateKey: entry.id,
        label: entry.label,
        regions,
        ...(entry.tabs ? { tabs: entry.tabs } : {}),
        // A getter, so a pane that hides a region on a signal re-renders the layout rather than the
        // pane. Collapsing a library must not remount the note being edited.
        get hidden() { return entry.hidden?.(props.task) },
      })
    },
  }
}

/** The registry, plus the one thing it does beyond holding entries: it draws a declared layout. */
class PaneRegistry extends Registry<PaneContribution> {
  override register(entry: PaneRegistration): Disposable {
    return super.register('regions' in entry ? drawLayout(entry) : entry)
  }
}

export const paneRegistry = new PaneRegistry('pane')

export const paneContributions = (): readonly PaneContribution[] =>
  [...paneRegistry.entries()].sort((a, b) => a.order - b.order || a.id.localeCompare(b.id))

export const paneContribution = (id: PaneId): PaneContribution | undefined => paneRegistry.get(id)
export const paneIds = (): PaneId[] => paneContributions().map((pane) => pane.id)
export const paneLabel = (id: PaneId): string => paneContribution(id)?.label ?? id
export const paneAvailable = (pane: PaneContribution, task?: Task): boolean =>
  hasHostCapability(pane.requires) && (!task || !pane.when || pane.when(task))
