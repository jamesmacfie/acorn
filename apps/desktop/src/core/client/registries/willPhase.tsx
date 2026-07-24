import { createSignal, Show } from 'solid-js'
import { trapOverlayFocus } from '../ui/focus'
import { collectConcerns, type Concern, type WillEventMap } from './willPhaseModel'
export { collectConcerns, registerWillHandler } from './willPhaseModel'
export type { Concern, WillEventMap } from './willPhaseModel'

type Prompt = {
  title: string
  actionLabel: string
  concerns: Concern[]
  resolve: (confirmed: boolean) => void
}
const [prompt, setPrompt] = createSignal<Prompt | null>(null)

export async function confirmWillEvent<K extends keyof WillEventMap>(options: {
  kind: K
  payload: WillEventMap[K]
  title: string
  actionLabel: string
  alwaysConfirm?: boolean
  concerns?: Concern[]
}): Promise<boolean> {
  const concerns = [...(options.concerns ?? []), ...(await collectConcerns(options.kind, options.payload))]
  if (!options.alwaysConfirm && !concerns.length) return true
  return new Promise<boolean>((resolve) => setPrompt({ title: options.title, actionLabel: options.actionLabel, concerns, resolve }))
}

export function WillConfirmationHost() {
  let dialog!: HTMLDivElement
  // Checkbox state per concern id, seeded from the concern's default on open.
  const [checks, setChecks] = createSignal<Record<string, boolean>>({})
  const finish = (confirmed: boolean) => {
    const current = prompt()
    if (!current) return
    setPrompt(null)
    for (const concern of current.concerns) concern.onDecision?.(confirmed, checks()[concern.id] ?? concern.checkbox?.checked ?? false)
    setChecks({})
    current.resolve(confirmed)
  }
  return (
    <Show when={prompt()} keyed>
      {(current) => (
        <div class="overlay-backdrop" onClick={() => finish(false)}>
          <div
            ref={dialog}
            class="overlay will-confirmation"
            role="alertdialog"
            aria-modal="true"
            onClick={(event) => event.stopPropagation()}
            onKeyDown={(event) => {
              if (event.key === 'Escape') finish(false)
              else trapOverlayFocus(event, dialog)
            }}
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
                      <Show when={concern.checkbox}>
                        {(checkbox) => (
                          <label class="will-concern-option">
                            <input
                              type="checkbox"
                              checked={checks()[concern.id] ?? checkbox().checked}
                              onChange={(event) => setChecks((all) => ({ ...all, [concern.id]: event.currentTarget.checked }))}
                            />
                            {checkbox().label}
                          </label>
                        )}
                      </Show>
                    </li>
                  ))}
                </ul>
              </Show>
              <div class="close-actions">
                <button autofocus={current.concerns.some((concern) => concern.severity === 'danger')} type="button" class="overlay-btn" onClick={() => finish(false)}>Cancel</button>
                <button autofocus={!current.concerns.some((concern) => concern.severity === 'danger')} type="button" class="overlay-btn close-confirm" onClick={() => finish(true)}>{current.actionLabel}</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </Show>
  )
}
