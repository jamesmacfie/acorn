import { createEffect, createSignal, on, onCleanup, type Accessor } from 'solid-js'

/** Whether this client draws for a phone. The kit may not import `infra/platform`, so this reads the
 *  root attribute that `formFactor()` reads. */
export const isNarrow = (): boolean =>
  typeof document !== 'undefined' && document.documentElement.dataset.formFactor === 'narrow'

export type NarrowView = 'list' | 'detail'

// Back out of a narrow detail. A shell whose own top bar has a Back control claims it, and then a
// `list-detail` draws no Back row of its own and offers the step to the shell instead. The detail that
// opened last answers first, so a split inside a split steps out of the inner one.
const [backClaimed, setBackClaimed] = createSignal(false)
const [backSteps, setBackSteps] = createSignal<readonly (() => void)[]>([])

/** For a shell's own Back control. Returns the release. */
export function claimNarrowBack(): () => void {
  setBackClaimed(true)
  return () => setBackClaimed(false)
}

export const narrowBackClaimed = backClaimed

/** The step out of the innermost narrow detail on screen, if one is showing. */
export const narrowBack = (): (() => void) | undefined => backSteps().at(-1)

/** Offers `step` for as long as the calling scope lives. */
export function offerNarrowBack(step: () => void): void {
  setBackSteps((steps) => [...steps, step])
  onCleanup(() => setBackSteps((steps) => steps.filter((candidate) => candidate !== step)))
}

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
