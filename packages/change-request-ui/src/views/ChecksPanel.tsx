import { createEffect, createSignal, For, Show } from 'solid-js'
import { Portal } from 'solid-js/web'
import { checkStatusTone, checkStatusWord, FAILED_STATUSES } from '../model/checkStatus'
import { Button, EmptyState, Fold, Log, Modal, Stack, StatusDot } from '@acorn/plugin-api/ui'

/** One step of a check's job, with its status in the `Check.status` vocabulary. */
export type CheckStep = { id: number; name: string; status: string | null }

// One check's steps, failed ones open, each step's log handed over by the host. The host fetches the
// steps when the panel opens and the log only once a step is open (`onLogWanted`), because a log is
// the expensive read.
//
// The step logs are the kit's `Log` and carry no ANSI colour, because a log is text and the kit draws
// text in one place.
export function ChecksPanel(props: {
  title: string
  /** Identity of the job the steps belong to. A new one opens its failed steps afresh. */
  jobKey: () => string | number | null
  steps: () => CheckStep[]
  stepsLoading: () => boolean
  stepsFailed: () => boolean
  /** Called once, when the first step opens. */
  onLogWanted: () => void
  logLoading: () => boolean
  stepLog: (stepId: number) => string[]
  /** The check's page on the host, and the host's name for the button. */
  url?: string | null
  hostLabel: string
  onClose: () => void
}) {
  const [open, setOpen] = createSignal<Set<number>>(new Set())
  const toggle = (step: number, next: boolean) =>
    setOpen((current) => {
      const updated = new Set(current)
      if (next) updated.add(step)
      else updated.delete(step)
      return updated
    })

  // Seed the open set once per job: failed steps start expanded.
  const [seeded, setSeeded] = createSignal<string | number | null>(null)
  createEffect(() => {
    const key = props.jobKey()
    if (key == null || seeded() === key) return
    setOpen(
      new Set(
        props
          .steps()
          .filter((step) => FAILED_STATUSES.has((step.status ?? '').toLowerCase()))
          .map((step) => step.id),
      ),
    )
    setSeeded(key)
  })
  createEffect(() => {
    if (open().size > 0) props.onLogWanted()
  })

  // Portalled, because the pane that opens this sets `contain: layout paint`, which would make a
  // fixed-position overlay inside it a box the size of the pane.
  return (
    <Portal>
      <Modal size="wide" title={props.title} onDismiss={props.onClose}>
        <Modal.Body>
          <Show
            when={!props.stepsLoading()}
            fallback={
              <EmptyState align="start" busy>
                Loading steps…
              </EmptyState>
            }
          >
            <Show
              when={props.steps().length}
              fallback={
                <EmptyState align="start" size="sm">
                  {props.stepsFailed() ? "Couldn't load this run's steps." : 'This run has no steps.'}
                </EmptyState>
              }
            >
              <Stack gap="row">
                <For each={props.steps()}>
                  {(step) => {
                    const status = () => (step.status ?? '').toLowerCase()
                    return (
                      <Fold
                        level="sub"
                        label={step.name}
                        open={open().has(step.id)}
                        onOpenChange={(next) => toggle(step.id, next)}
                        meta={
                          <StatusDot
                            tone={checkStatusTone(status())}
                            label={checkStatusWord(status())}
                            tip={checkStatusWord(status())}
                          />
                        }
                      >
                        <Show
                          when={!props.logLoading()}
                          fallback={
                            <EmptyState align="start" busy>
                              Loading log…
                            </EmptyState>
                          }
                        >
                          <Log lines={props.stepLog(step.id)} ariaLabel={`${step.name} log`} />
                        </Show>
                      </Fold>
                    )
                  }}
                </For>
              </Stack>
            </Show>
          </Show>
        </Modal.Body>
        <Modal.Actions>
          <Button variant="ghost" onPress={props.onClose}>
            Close
          </Button>
          <Show when={props.url}>
            {(url) => (
              <Button variant="solid" href={url()}>
                Open on {props.hostLabel}
              </Button>
            )}
          </Show>
        </Modal.Actions>
      </Modal>
    </Portal>
  )
}
