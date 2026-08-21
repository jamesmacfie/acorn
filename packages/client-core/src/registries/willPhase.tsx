import { createSignal, For, Show } from 'solid-js'
import { createDismissable } from '../ui/dismissable'
import { collectConcerns, type Concern, DETAILS_MAX, type WillEventMap } from './willPhaseModel'
import { Button, Checkbox } from '../ui/primitives'
export { collectConcerns, registerWillHandler } from './willPhaseModel'
export type { Concern, WillEventMap } from './willPhaseModel'

type Prompt = {
  title: string
  actionLabel: string
  concerns: Concern[]
  resolve: (decision: WillDecision) => void
}

/** What the caller learns. `checked` is the id of every concern whose checkbox was still ticked when
 *  the owner confirmed. For `task:archive` those are the qualified ids the node matches against its
 *  task-check registry, and the caller passes them straight through to the archive request. */
export type WillDecision = { confirmed: boolean; checked: string[] }

const [prompt, setPrompt] = createSignal<Prompt | null>(null)

export async function confirmWillEvent<K extends keyof WillEventMap>(options: {
  kind: K
  payload: WillEventMap[K]
  title: string
  actionLabel: string
  alwaysConfirm?: boolean
  concerns?: Concern[]
}): Promise<WillDecision> {
  const concerns = [...(options.concerns ?? []), ...(await collectConcerns(options.kind, options.payload))]
  if (!options.alwaysConfirm && !concerns.length) return { confirmed: true, checked: [] }
  return new Promise<WillDecision>((resolve) => setPrompt({ title: options.title, actionLabel: options.actionLabel, concerns, resolve }))
}

export function WillConfirmationHost() {
  let dialog!: HTMLDivElement
  // Checkbox state per concern id, seeded from the concern's default on open.
  const [checks, setChecks] = createSignal<Record<string, boolean>>({})
  const finish = (confirmed: boolean) => {
    const current = prompt()
    if (!current) return
    setPrompt(null)
    const checked: string[] = []
    for (const concern of current.concerns) {
      const ticked = checks()[concern.id] ?? concern.checkbox?.checked ?? false
      if (confirmed && concern.checkbox && ticked) checked.push(concern.id)
      // Contained, because this loop is between the owner clicking and the caller finding out. One
      // handler throwing used to skip the resolve below, leaving the archive promise pending forever:
      // the dialog closed and nothing happened, with no error anyone would connect to it.
      try {
        concern.onDecision?.(confirmed, ticked)
      } catch (error) {
        console.error(`[will] ${concern.feature} onDecision failed:`, error)
      }
    }
    setChecks({})
    current.resolve({ confirmed, checked })
  }
  const dismiss = createDismissable({ onDismiss: () => finish(false), container: () => dialog })
  return (
    <Show when={prompt()} keyed>
      {(current) => (
        <div class="overlay-backdrop" onClick={dismiss.onBackdropClick}>
          <div
            ref={dialog}
            class="overlay will-confirmation"
            role="alertdialog"
            aria-modal="true"
            onClick={dismiss.onContainerClick}
            onKeyDown={dismiss.onKeyDown}
          >
            <div class="overlay-title">{current.title}</div>
            <div class="overlay-body">
              <Show when={current.concerns.length}>
                <ul class="will-concerns">
                  {current.concerns.map((concern) => (
                    <li data-severity={concern.severity}>
                      <span aria-hidden="true">{concern.severity === 'danger' ? '⛔' : '⚠'}</span>
                      <span>{concern.message}</span>
                      <span class="muted">— {concern.feature}</span>
                      <Show when={concern.details?.length}>
                        <ul class="will-concern-details">
                          {/* Sliced here as well as on the node: a client-side producer answers with
                              whatever it holds, and the cap is the dialog's rule, not the producer's. */}
                          <For each={concern.details!.slice(0, DETAILS_MAX)}>{(detail) => <li>{detail}</li>}</For>
                          <Show when={(concern.detailsMore ?? 0) + Math.max(0, concern.details!.length - DETAILS_MAX)}>
                            {(more) => <li class="muted">+{more()} more</li>}
                          </Show>
                        </ul>
                      </Show>
                      <Show when={concern.checkbox}>
                        {(checkbox) => (
                          <Checkbox
                            class="will-concern-option"
                            label={checkbox().label}
                            checked={checks()[concern.id] ?? checkbox().checked}
                            onChange={(event) => setChecks((all) => ({ ...all, [concern.id]: event.currentTarget.checked }))}
                          />
                        )}
                      </Show>
                    </li>
                  ))}
                </ul>
              </Show>
              <div class="close-actions">
                <Button autofocus={current.concerns.some((concern) => concern.severity === 'danger')} onClick={() => finish(false)}>Cancel</Button>
                <Button autofocus={!current.concerns.some((concern) => concern.severity === 'danger')} class="close-confirm" onClick={() => finish(true)}>{current.actionLabel}</Button>
              </div>
            </div>
          </div>
        </div>
      )}
    </Show>
  )
}
