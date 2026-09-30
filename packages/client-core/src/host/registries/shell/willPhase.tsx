import { createSignal, For, Show } from 'solid-js'
import { createDismissable } from '../../../kit/lib/controls/dismissable'
import { collectConcerns, type Concern, DETAILS_MAX, type WillEventMap } from './willPhaseModel'
import { Button, Checkbox } from '../../../kit/components/primitives'
import { createLogger } from '../../../infra/telemetry/logger'
export { collectConcerns, registerWillHandler } from './willPhaseModel'
export type { Concern, WillEventMap } from './willPhaseModel'

const log = createLogger('will')

type Prompt = {
  title: string
  actionLabel: string
  message?: string
  /** What the action leaves in place, said apart from what it removes. */
  stays?: string
  /** Cancel takes the focus rather than the action. */
  danger?: boolean
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
  message?: string
  /** What the action leaves in place, said apart from what it removes. */
  stays?: string
  alwaysConfirm?: boolean
  concerns?: Concern[]
}): Promise<WillDecision> {
  const concerns = [...(options.concerns ?? []), ...(await collectConcerns(options.kind, options.payload))]
  if (!options.alwaysConfirm && !concerns.length) return { confirmed: true, checked: [] }
  return new Promise<WillDecision>((resolve) => setPrompt({
    title: options.title,
    actionLabel: options.actionLabel,
    message: options.message,
    ...(options.stays ? { stays: options.stays } : {}),
    concerns,
    resolve,
  }))
}

/**
 * The shell's one confirmation, for an action no will handler weighs in on: a danger zone's delete,
 * uninstall, unpair or revoke, and leaving a settings form with unsaved changes. The same dialog as a
 * will event's, so every "are you sure" in the app looks and answers alike. `goes` says what the action
 * removes and `stays` what it leaves, as two sentences, because the second is the one people look for.
 */
export function confirmAction(options: {
  title: string
  actionLabel: string
  goes: string
  stays?: string
  danger?: boolean
}): Promise<boolean> {
  // Back to where the person was, which inside settings is the button that asked. The dialog is drawn
  // outside the settings layer, and a closed dialog leaves the focus on the body otherwise.
  const opener = document.activeElement instanceof HTMLElement ? document.activeElement : undefined
  return new Promise<boolean>((resolve) => setPrompt({
    title: options.title,
    actionLabel: options.actionLabel,
    message: options.goes,
    ...(options.stays ? { stays: options.stays } : {}),
    ...(options.danger ? { danger: true } : {}),
    concerns: [],
    resolve: ({ confirmed }) => {
      // WebKit does not focus a clicked button, so the opener can be the body; and a confirmed delete
      // can take the opener away. Either way the focus goes to the layer the dialog was raised over,
      // settings among them, so its Escape and ⌘[ keep working without a click first.
      if (opener?.isConnected && opener !== document.body) opener.focus()
      else [...document.querySelectorAll<HTMLElement>('[role="dialog"][aria-modal="true"]')].at(-1)?.focus()
      resolve(confirmed)
    },
  }))
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
        log.error(`${concern.feature} onDecision failed`, error, { 'will.feature': concern.feature })
      }
    }
    setChecks({})
    current.resolve({ confirmed, checked })
  }
  const dismiss = createDismissable({ onDismiss: () => finish(false), container: () => dialog })
  const dangerous = (current: Prompt) => !!current.danger || current.concerns.some((concern) => concern.severity === 'danger')
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
              <Show when={current.message}>{(message) => <p>{message()}</p>}</Show>
              <Show when={current.stays}>{(stays) => <p class="muted">{stays()}</p>}</Show>
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
                            label={checkbox().label}
                            checked={checks()[concern.id] ?? checkbox().checked}
                            onChange={(checked) => setChecks((all) => ({ ...all, [concern.id]: checked }))}
                          />
                        )}
                      </Show>
                    </li>
                  ))}
                </ul>
              </Show>
              <div class="close-actions">
                <Button autofocus={dangerous(current)} onPress={() => finish(false)}>Cancel</Button>
                <Button autofocus={!dangerous(current)} tone={current.danger ? 'danger' : undefined} onPress={() => finish(true)}>{current.actionLabel}</Button>
              </div>
            </div>
          </div>
        </div>
      )}
    </Show>
  )
}
