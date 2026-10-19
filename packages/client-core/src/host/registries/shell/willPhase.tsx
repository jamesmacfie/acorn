import { Portal } from 'solid-js/web'
import { createSignal, For, onCleanup, Show } from 'solid-js'
import { collectConcerns, type Concern, DETAILS_MAX, type WillEventMap } from './willPhaseModel'
import { Alert, Button, Checkbox } from '../../../kit/components/primitives'
import { IconButton } from '../../../kit/components/inputs/IconButton'
import { Menu } from '../../../kit/components/overlays/Menu'
import { Toolbar } from '../../../kit/components/layout/Toolbar'
import Icon from '../../../kit/components/content/Icon'
import { Heading } from '../../../kit/components/content/Heading'
import { Modal } from '../../../kit/components/overlays/Modal'
import { createLogger } from '../../../infra/telemetry/logger'
export { registerWillHandler } from './willPhaseModel'
export type { Concern, WillEventMap } from './willPhaseModel'

const log = createLogger('will')

/** One way to confirm. More than one turns the confirm button into a split button whose menu picks
 *  between them: the task dialog's Archive and Delete. `warning` shows above the buttons while the
 *  action is chosen. */
export type WillAction = { id: string; label: string; danger?: boolean; warning?: string }

type Prompt = {
  title: string
  subject?: string
  /** The first is the default. A prompt with no actions of its own has one, `confirm`. */
  actions: WillAction[]
  message?: string
  /** What the action leaves in place, said apart from what it removes. */
  stays?: string
  /** Cancel takes the focus rather than the action. */
  danger?: boolean
  concerns: Concern[]
  /** Aborted when there is nothing left to confirm, which cancels the dialog. */
  signal?: AbortSignal
  resolve: (decision: WillDecision) => void
}

/** What the caller learns. `checked` is the id of every concern whose checkbox was still ticked when
 *  the owner confirmed. For `task:archive` those are the qualified ids the node matches against its
 *  task-check registry, and the caller passes them straight through to the archive request. `action`
 *  is the id of the chosen action, `confirm` for a prompt that offered none. */
export type WillDecision = { confirmed: boolean; checked: string[]; action: string }

const CONFIRM = 'confirm'

const [prompt, setPrompt] = createSignal<Prompt | null>(null)

export async function confirmWillEvent<K extends keyof WillEventMap>(
  options: {
    kind: K
    payload: WillEventMap[K]
    title: string
    subject?: string
    message?: string
    /** What the action leaves in place, said apart from what it removes. */
    stays?: string
    alwaysConfirm?: boolean
    concerns?: Concern[]
    /** Aborted when there is nothing left to confirm, such as a task another client archived. */
    signal?: AbortSignal
    // One confirm button, or a choice of actions (see WillAction).
  } & ({ actionLabel: string; actions?: never } | { actions: [WillAction, ...WillAction[]]; actionLabel?: never }),
): Promise<WillDecision> {
  const actions = options.actions ?? [{ id: CONFIRM, label: options.actionLabel }]
  const concerns = [...(options.concerns ?? []), ...(await collectConcerns(options.kind, options.payload))]
  if (options.signal?.aborted) return { confirmed: false, checked: [], action: actions[0]!.id }
  if (!options.alwaysConfirm && !concerns.length) return { confirmed: true, checked: [], action: actions[0]!.id }
  return new Promise<WillDecision>((resolve) =>
    setPrompt({
      title: options.title,
      subject: options.subject,
      actions,
      message: options.message,
      ...(options.stays ? { stays: options.stays } : {}),
      concerns,
      ...(options.signal ? { signal: options.signal } : {}),
      resolve,
    }),
  )
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
  return new Promise<boolean>((resolve) =>
    setPrompt({
      title: options.title,
      actions: [{ id: CONFIRM, label: options.actionLabel }],
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
    }),
  )
}

export function WillConfirmationHost() {
  // Checkbox state per concern id, seeded from the concern's default on open.
  const [checks, setChecks] = createSignal<Record<string, boolean>>({})
  // The chosen action's id, or null for the prompt's default.
  const [chosen, setChosen] = createSignal<string | null>(null)
  const selected = (current: Prompt): WillAction =>
    current.actions.find((action) => action.id === chosen()) ?? current.actions[0]!
  const finish = (confirmed: boolean) => {
    const current = prompt()
    if (!current) return
    const action = selected(current).id
    setPrompt(null)
    setChosen(null)
    const checked: string[] = []
    for (const concern of current.concerns) {
      const ticked = checks()[concern.id] ?? concern.checkbox?.checked ?? false
      if (confirmed && concern.checkbox && ticked) checked.push(concern.id)
      // Contained, because this loop is between the owner clicking and the caller finding out. One
      // handler throwing would skip the resolve below, leaving the archive promise pending forever:
      // the dialog closes and nothing happens, with no error anyone would connect to it.
      try {
        concern.onDecision?.(confirmed, ticked)
      } catch (error) {
        log.error(`${concern.feature} onDecision failed`, error, { 'will.feature': concern.feature })
      }
    }
    setChecks({})
    current.resolve({ confirmed, checked, action })
  }
  const dangerous = (current: Prompt) =>
    !!current.danger || !!selected(current).danger || current.concerns.some((concern) => concern.severity === 'danger')
  // Focus starts on the action unless something would be lost, when it is Modal's own choice for an
  // `alertdialog`: Cancel. The newest alert dialog is this one, because it is the last one mounted.
  const action = (current: Prompt) =>
    dangerous(current)
      ? undefined
      : ([...document.querySelectorAll<HTMLElement>('[role="alertdialog"]')]
          .at(-1)
          ?.querySelector<HTMLElement>('.ui-modal-actions [data-variant="solid"]') ?? undefined)
  // Each concern names its own subject, because the dialog does not add the feature's name to it.
  return (
    <Portal>
      <Show when={prompt()} keyed>
        {(current) => {
          const cancel = () => finish(false)
          current.signal?.addEventListener('abort', cancel, { once: true })
          onCleanup(() => current.signal?.removeEventListener('abort', cancel))
          return (
            <Modal
              title={current.title}
              size="sm"
              role="alertdialog"
              autoFocus={() => action(current)}
              onDismiss={() => finish(false)}
            >
              <Modal.Body>
                <Show when={current.subject}>
                  {(subject) => (
                    <div class="will-subject">
                      <Heading level={2}>{subject()}</Heading>
                    </div>
                  )}
                </Show>
                <Show when={current.message}>{(message) => <p>{message()}</p>}</Show>
                <Show when={current.stays}>{(stays) => <p class="muted">{stays()}</p>}</Show>
                <Show when={current.concerns.length}>
                  <ul class="will-concerns">
                    {current.concerns.map((concern) => (
                      <li data-severity={concern.severity}>
                        <Icon
                          name={concern.severity === 'danger' ? 'octagon-alert' : 'triangle-alert'}
                          tone={concern.severity}
                        />
                        <span>{concern.message}</span>
                        <Show when={concern.details?.length}>
                          <ul class="will-concern-details">
                            {/* Sliced here as well as on the node: a client-side producer answers with
                            whatever it holds, and the cap is the dialog's rule, not the producer's. */}
                            <For each={concern.details!.slice(0, DETAILS_MAX)}>{(detail) => <li>{detail}</li>}</For>
                            <Show
                              when={(concern.detailsMore ?? 0) + Math.max(0, concern.details!.length - DETAILS_MAX)}
                            >
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
                <Show when={selected(current).warning}>
                  {(warning) => (
                    <Alert tone="danger" variant="banner">
                      {warning()}
                    </Alert>
                  )}
                </Show>
              </Modal.Body>
              <Modal.Actions>
                <Button variant="ghost" onPress={() => finish(false)}>
                  Cancel
                </Button>
                <Show
                  when={current.actions.length > 1}
                  fallback={
                    <Button
                      variant="solid"
                      tone={dangerous(current) ? 'danger' : undefined}
                      onPress={() => finish(true)}
                    >
                      {selected(current).label}
                    </Button>
                  }
                >
                  {/* Drawn the way the commit footer draws Commit and its options
                  (plugins/git/src/client/changes/ChangesPane.tsx), with both halves solid. Keyed on the chosen
                  action, so both are drawn again in its tone: Button reads its tone once, and Delete has
                  to turn them red. */}
                  <Show when={selected(current)} keyed>
                    {(chosenAction) => {
                      const tone = dangerous(current) ? 'danger' : undefined
                      return (
                        <Toolbar.Group joined>
                          <Button variant="solid" tone={tone} onPress={() => finish(true)}>
                            {chosenAction.label}
                          </Button>
                          <Menu
                            ariaLabel={`${current.title} options`}
                            placement="bottom-end"
                            trigger={({ open, toggle }) => (
                              <IconButton
                                icon="chevron-down"
                                variant="solid"
                                size="md"
                                tone={tone}
                                label={`${current.title} options`}
                                opens="menu"
                                expanded={open()}
                                onPress={toggle}
                              />
                            )}
                          >
                            {(menu) => (
                              <For each={current.actions}>
                                {(option) => (
                                  <Menu.Item
                                    context={menu}
                                    kind="radio"
                                    checked={option.id === chosenAction.id}
                                    onSelect={() => setChosen(option.id)}
                                  >
                                    {option.label}
                                  </Menu.Item>
                                )}
                              </For>
                            )}
                          </Menu>
                        </Toolbar.Group>
                      )
                    }}
                  </Show>
                </Show>
              </Modal.Actions>
            </Modal>
          )
        }}
      </Show>
    </Portal>
  )
}
