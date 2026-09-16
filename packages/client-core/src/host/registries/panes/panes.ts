import { createComponent, lazy, onMount, Suspense, type Component, type JSX } from 'solid-js'
import type { QueryClient } from '@tanstack/solid-query'
import { isPaneLayout, regionProblem, type PaneLayoutName } from '@acorn/protocol/paneLayouts.ts'
import type { Region } from '../../layouts'
import { suppliedLayout } from '../../layouts/table'
import type { Task } from '../../../infra/queries'
import { hasHostCapability, type HostCapabilityRequirement } from '../../../infra/node/hostCapabilities'
import { paneModel } from './paneModels'
import { recordSample, startSpan, type SpanHandle } from '../../../infra/telemetry/emitter'
import { Registry, type Disposable } from '../../../kit/lib/registry'
import { createLogger } from '../../../infra/telemetry/logger'

const log = createLogger('pane')

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
  /**
   * Warm this pane's first read for a task the reader is pointing at but has not opened
   * (docs/panes.md § Contributions).
   *
   * Called on a deliberate hover over a rail row rather than on a scroll past one, for every pane
   * this task could show. It is best-effort by construction: it returns nothing, and a rejection
   * inside it only means the first paint is not instant. A pane with nothing worth warming — or
   * whose first read spawns a process rather than fetching a row — declares nothing.
   */
  prefetch?: (task: Task, queryClient: QueryClient) => void
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

// There is no `keepAlive` here either, and there was: the field promised the host would keep a pane's
// DOM across a task switch, exactly one pane set it, and nothing ever read it. What keeps a pane cheap
// to leave and come back to is ./paneModels.ts within a task and the query cache across tasks, warmed
// by `prefetch` above. A hidden element tree per task is the memory shape this codebase already
// declined for the agent transcript (docs/managed-agents.md), so it is not coming back as a pane field.
//
// There is no per-pane `freshness` hook here (docs/panes.md § Contributions has the reason).
//
// A pane's own query status is only knowable reactively. TanStack's `getQueryState` is a snapshot, so
// a `freshness(task)` field returning one would render a badge that never updated, which is worse
// than no badge. Making it reactive means either a QueryObserver subscription per pane per render
// inside the host's `<For>`, or each pane publishing a signal it does not currently have.

/**
 * Ends a `pane.region` span once its region has actually drawn something.
 *
 * Inside the region's own `Suspense` rather than around it, which is what makes the span measure to
 * content: Solid holds effects created under a suspended boundary until it resolves, so a region
 * waiting on a `lazy()` import or a resource ends its span when the reader can see it, not when the
 * host asked for it.
 */
function MeasuredRegion(props: { span: SpanHandle; children: JSX.Element }): JSX.Element {
  onMount(() => {
    recordSample('core', 'pane.region.mount', 1)
    props.span.end()
  })
  return props.children
}

/** Turn a declared layout into the component every consumer of this registry already expects. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- as PaneRegistration above
function drawLayout(entry: PaneLayoutContribution<any>, owner?: string): PaneContribution {
  if (!isPaneLayout(entry.layout)) throw new Error(`pane '${entry.id}' names an unknown layout '${entry.layout}'`)
  const problem = regionProblem(entry.layout, Object.keys(entry.regions))
  // At registration rather than at render: a pane missing a region is a programming error, and finding
  // it when someone opens the pane means finding it in front of a user.
  if (problem) throw new Error(`pane '${entry.id}': ${problem}`)
  const layout = entry.layout
  // The host's own table first, the DOM's as the fallback, because a second host draws its layouts
  // with its own components and this registry is the one place that decided otherwise
  // (../../layouts/table.ts).
  //
  // Behind `lazy` for the reason plugins/frames/register.ts states: this module is imported by
  // bare-Node test suites, and the repo's vitest configs have no Solid transform, so a static import
  // of a `.tsx` file would make it unimportable there. The `??` short-circuits, so a host that
  // supplied a table never reaches for the DOM one at all.
  const Draw = lazy(async () => ({ default: suppliedLayout(layout) ?? (await import('../../layouts')).LAYOUTS[layout] }))
  return {
    ...entry,
    component: (props) => {
      const regions: Record<string, Region> = {}
      // A getter, so the model is looked up when a region renders rather than when the pane is built,
      // and a pane that switches task hands its regions the new task's model without remounting them.
      const model = () => (entry.model ? paneModel(entry.id, props.task.id, () => entry.model!(props.task), owner ?? 'core') : undefined)
      for (const [name, Region] of Object.entries(entry.regions)) {
        // Under a `Suspense` of its own, because a region is a `lazy()` component and a pending one
        // renders as an empty string, which draws the region's rectangle empty until the module
        // lands. One boundary per region rather than one per pane, so a slow region does not blank
        // the ones beside it. It used to be here for a harder reason, a cell host that refused a bare
        // string outright; that rule went with the terminal rewrite
        // (apps/tui/src/tree/renderer.ts).
        //
        // The boundary covers the module arriving and nothing after it. Everything under a region
        // shares it, and `@tanstack/solid-query` suspends whatever boundary is above it whenever
        // `.data` is read on an empty cache, so a query that starts once the region is already on
        // screen used to take the region back out of the document for the length of its fetch. The
        // solid-js patch is what stops that: a boundary that has drawn never swaps back to its
        // fallback, and patches/README.md holds the reasoning.
        regions[name] = () => {
          // Opened here, where the host asks for the region, and ended when the region's content
          // mounts. A region that suspends is the case worth measuring: everything between those two
          // moments is a rectangle the reader is looking at with nothing in it.
          const span = startSpan(owner ?? 'core', {
            name: 'pane.region',
            attrs: { seam: 'pane.region', 'pane.id': entry.id, 'pane.region': name },
          })
          return createComponent(Suspense, {
            fallback: null,
            get children() {
              return createComponent(MeasuredRegion, {
                span,
                get children() {
                  return createComponent(Region, {
                    get task() { return props.task },
                    get model() { return model() },
                  })
                },
              })
            },
          })
        }
      }
      // The layout is a `lazy` too, and a pending one renders as an empty string for the same
      // reason a region does, so it gets the same boundary.
      return createComponent(Suspense, { fallback: null, get children() { return createComponent(Draw, {
        stateKey: entry.id,
        label: entry.label,
        regions,
        ...(entry.tabs ? { tabs: entry.tabs } : {}),
        // A getter, so a pane that hides a region on a signal re-renders the layout rather than the
        // pane. Collapsing a library must not remount the note being edited.
        get hidden() { return entry.hidden?.(props.task) },
      }) } })
    },
  }
}

/** The registry, plus the one thing it does beyond holding entries: it draws a declared layout. */
class PaneRegistry extends Registry<PaneContribution> {
  override register(entry: PaneRegistration, owner?: string): Disposable {
    return super.register('regions' in entry ? drawLayout(entry, owner) : entry, owner)
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

/** A hover shorter than this is the pointer crossing the rail, not a reader looking at a row. */
export const PANE_PREFETCH_HOVER_MS = 150

/** Every available pane's `prefetch` for one task, run once. Failures are the pane's to swallow. */
export const prefetchPanes = (task: Task, queryClient: QueryClient): void => {
  for (const pane of paneContributions()) {
    if (!pane.prefetch || !paneAvailable(pane, task)) continue
    try {
      pane.prefetch(task, queryClient)
    } catch (error) {
      // A pane that throws on the way to warming a cache must not take the rail's pointer handler
      // with it. Nothing is missing afterwards; the pane fetches on mount as it always did.
      log.error(`'${pane.id}' failed to prefetch`, error, { 'pane.id': pane.id })
    }
  }
}

/**
 * The hover half: a rail row calls this on pointer enter and cancels it on leave, so scrolling the
 * rail past twenty rows fetches nothing.
 */
export const schedulePanePrefetch = (task: Task, queryClient: QueryClient): { cancel: () => void } => {
  const timer = setTimeout(() => prefetchPanes(task, queryClient), PANE_PREFETCH_HOVER_MS)
  return { cancel: () => clearTimeout(timer) }
}
