import { createComponent, lazy, type Component } from 'solid-js'
import { isPaneLayout, regionProblem, type PaneLayoutName } from '@acorn/protocol/paneLayouts.ts'
import type { Region } from '../../layouts'
import type { Task } from '../../../infra/queries'
import { hasHostCapability, type HostCapabilityRequirement } from '../../../infra/node/hostCapabilities'
import { paneModel } from './paneModels'
import { Registry, type Disposable } from '../../../kit/lib/registry'

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
export type PaneLayoutContribution<M = undefined> = PaneCommon & {
  layout: PaneLayoutName
  /**
   * What every region of this pane shares, built once per task and disposed when the task is evicted
   * (./paneModels.ts, docs/panes.md § Layout model).
   *
   * Regions are separate components the host mounts side by side, so a selection, a draft or an
   * autosave timer that two of them touch has to outlive both — and a region can be unmounted while
   * the pane is still open, which is what a collapsed list column is. Declaring it here is what makes
   * `list-detail` usable at all; without it a pane with two regions has to be one region with a split
   * drawn inside it.
   *
   * Called inside the model's own reactive root, so resources and effects it creates are disposed
   * together. Omit it and the regions are handed `undefined`, which is every pane whose regions share
   * nothing.
   */
  model?: (task: Task) => M
  regions: Record<string, Component<{ task: Task; model: M }>>
  tabs?: readonly { id: string; label: string }[]
  /** Regions this pane is not showing right now, asked per render. */
  hidden?: (task: Task) => readonly string[]
}

// `any` for the reason `sourceRegistry` is `SourceContribution<any>`: the registry is heterogeneous by
// construction and each entry's model type is the pane's, not the registry's.
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- see above
export type PaneRegistration = PaneContribution | PaneLayoutContribution<any>

// There is no per-pane `freshness` hook here (docs/panes.md § Contributions has the reason).
//
// A pane's own query status is only knowable reactively. TanStack's `getQueryState` is a snapshot, so
// a `freshness(task)` field returning one would render a badge that never updated, which is worse
// than no badge. Making it reactive means either a QueryObserver subscription per pane per render
// inside the host's `<For>`, or each pane publishing a signal it does not currently have.

/** Turn a declared layout into the component every consumer of this registry already expects. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- as PaneRegistration above
function drawLayout(entry: PaneLayoutContribution<any>): PaneContribution {
  if (!isPaneLayout(entry.layout)) throw new Error(`pane '${entry.id}' names an unknown layout '${entry.layout}'`)
  const problem = regionProblem(entry.layout, Object.keys(entry.regions))
  // At registration rather than at render: a pane missing a region is a programming error, and finding
  // it when someone opens the pane means finding it in front of a user.
  if (problem) throw new Error(`pane '${entry.id}': ${problem}`)
  const layout = entry.layout
  // Behind `lazy` for the reason plugins/frames/register.ts states: this module is imported by
  // bare-Node test suites, and the repo's vitest configs have no Solid transform, so a static import
  // of a `.tsx` file would make it unimportable there.
  const Draw = lazy(async () => ({ default: (await import('../../layouts')).LAYOUTS[layout] }))
  return {
    ...entry,
    component: (props) => {
      const regions: Record<string, Region> = {}
      // A getter, so the model is looked up when a region renders rather than when the pane is built,
      // and a pane that switches task hands its regions the new task's model without remounting them.
      const model = () => (entry.model ? paneModel(entry.id, props.task.id, () => entry.model!(props.task)) : undefined)
      for (const [name, Region] of Object.entries(entry.regions)) {
        regions[name] = () => createComponent(Region, {
          get task() { return props.task },
          get model() { return model() },
        })
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
