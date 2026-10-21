import { createEffect, createSignal, on, type Accessor } from 'solid-js'

/** Whether this client draws for a phone. The kit may not import `infra/platform`, so this reads the
 *  root attribute that `formFactor()` reads. */
export const isNarrow = (): boolean =>
  typeof document !== 'undefined' && document.documentElement.dataset.formFactor === 'narrow'

export type NarrowView = 'list' | 'detail'

/**
 * Which half of a narrow `list-detail` is showing: the kit's split and the host's layout both keep
 * it here, so they cannot disagree about when a pick pushes the detail.
 *
 * A key that changes to a new value shows the detail, which is the person picking a row. A key that
 * goes null leaves the view alone, because Back is what returns to the list and it leaves the
 * selection where it was. A caller with no selection passes `undefined`, and the view only moves
 * when asked.
 */
export function createNarrowView(selection: Accessor<string | null | undefined>) {
  const [view, setView] = createSignal<NarrowView>(typeof selection() === 'string' ? 'detail' : 'list')
  createEffect(
    on(
      selection,
      (key) => {
        if (typeof key === 'string') setView('detail')
      },
      { defer: true },
    ),
  )
  return [view, setView] as const
}
