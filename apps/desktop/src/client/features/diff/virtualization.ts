import { createVirtualizer } from '@tanstack/solid-virtual'

// Virtualizer plumbing shared by DiffView's unified/split lists: the two createVirtualizer setups
// are identical apart from their item/key/estimate sources, and both feed the same batched-rAF
// measure scheduling. Mechanical extraction from DiffView — no behaviour change.

export function createDiffVirtualizer<T>(opts: {
  items: () => readonly T[]
  keys: () => readonly string[]
  /** Fallback getItemKey prefix for an index with no identity key (`row`/`band`). */
  keyPrefix: string
  estimateSize: (item: T | undefined) => number
  scrollEl: () => HTMLDivElement | undefined
}) {
  return createVirtualizer({
    get count() {
      return opts.items().length
    },
    getScrollElement: () => opts.scrollEl() ?? null,
    getItemKey: (index) => opts.keys()[index] ?? `${opts.keyPrefix}:${index}`,
    estimateSize: (index) => opts.estimateSize(opts.items()[index]),
    overscan: 20,
  })
}

export type MeasureTarget = 'unified' | 'split'

type MeasurableVirtualizer = {
  measure: () => void
  measureElement: (el: HTMLElement) => void
}

// Batched measure scheduling: `scheduleVirtualMeasure` coalesces whole-list measure() calls and
// `scheduleElementMeasure` coalesces per-row measureElement() calls, each into one rAF pass, so a
// burst of newly-mounted rows triggers one measure per frame instead of one per row.
export function createDiffMeasureSchedulers(
  virtualizers: Record<MeasureTarget, MeasurableVirtualizer>,
  scrollEl: () => Element | undefined,
) {
  let virtualMeasureFrame = 0
  let needsUnifiedMeasure = false
  let needsSplitMeasure = false
  const scheduleVirtualMeasure = (target: MeasureTarget) => {
    if (target === 'unified') needsUnifiedMeasure = true
    else needsSplitMeasure = true
    if (virtualMeasureFrame) return
    virtualMeasureFrame = requestAnimationFrame(() => {
      virtualMeasureFrame = 0
      if (!scrollEl()) return
      if (needsUnifiedMeasure) virtualizers.unified.measure()
      if (needsSplitMeasure) virtualizers.split.measure()
      needsUnifiedMeasure = false
      needsSplitMeasure = false
    })
  }

  const pendingUnifiedMeasures = new Set<HTMLElement>()
  const pendingSplitMeasures = new Set<HTMLElement>()
  let elementMeasureFrame = 0
  const scheduleElementMeasure = (target: MeasureTarget, el: HTMLElement) => {
    if (target === 'unified') pendingUnifiedMeasures.add(el)
    else pendingSplitMeasures.add(el)
    if (elementMeasureFrame) return
    elementMeasureFrame = requestAnimationFrame(() => {
      elementMeasureFrame = 0
      for (const item of pendingUnifiedMeasures) {
        if (item.isConnected) virtualizers.unified.measureElement(item)
      }
      for (const item of pendingSplitMeasures) {
        if (item.isConnected) virtualizers.split.measureElement(item)
      }
      pendingUnifiedMeasures.clear()
      pendingSplitMeasures.clear()
    })
  }

  const cancel = () => {
    cancelAnimationFrame(virtualMeasureFrame)
    cancelAnimationFrame(elementMeasureFrame)
  }

  return { scheduleVirtualMeasure, scheduleElementMeasure, cancel }
}
