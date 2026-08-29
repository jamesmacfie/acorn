import { createEffect, createMemo, createSignal, For, Show } from 'solid-js'
import { Portal } from 'solid-js/web'
import { createQuery } from '@tanstack/solid-query'
import { jobLogOptions, runJobsOptions } from '../queries'
import { checkStatusTone, FAILED_STATUSES } from '@acorn/plugin-api/client'
import { EmptyState, Fold, Log, Modal, Stack, StatusDot } from '@acorn/plugin-api/ui'
import { splitJobLog } from './splitJobLog'

// One workflow run's steps, GitHub-Actions style: the steps of the clicked job matched by name,
// failed ones open, each step's log sliced from the one job-log fetch that fires when the first step
// opens.
//
// A `Modal` rather than the hand-drawn right-hand drawer it used to be. Accepted difference: the
// step logs are the kit's `Log` and no longer carry ANSI colour, because a log is text and the kit
// draws text in one place. Everything else — lazy fetch, one request for every step, failed steps
// open — is unchanged.
export default function ChecksPanel(props: {
  owner: string
  repo: string
  runId: number
  jobName: string
  onClose: () => void
}) {
  const jobs = createQuery(() => runJobsOptions(props.owner, props.repo, props.runId, true))
  const job = createMemo(() => {
    const list = jobs.data?.jobs ?? []
    return list.find((candidate) => candidate.name === props.jobName) ?? list[0] ?? null
  })
  const steps = () => job()?.steps ?? []

  const [open, setOpen] = createSignal<Set<number>>(new Set())
  const toggle = (step: number, next: boolean) =>
    setOpen((current) => {
      const updated = new Set(current)
      if (next) updated.add(step)
      else updated.delete(step)
      return updated
    })

  // Seed the open set once per job: failed steps start expanded.
  const [seeded, setSeeded] = createSignal<number | null>(null)
  createEffect(() => {
    const current = job()
    if (!current || seeded() === current.id) return
    setOpen(new Set(current.steps
      .filter((step) => FAILED_STATUSES.has((step.conclusion ?? '').toLowerCase()))
      .map((step) => step.number)))
    setSeeded(current.id)
  })

  // Fetch the job log only once a step is open. One fetch covers every step.
  const anyOpen = () => open().size > 0
  const log = createQuery(() => jobLogOptions(props.owner, props.repo, job()?.id ?? 0, anyOpen() && !!job()))
  const split = createMemo(() => (log.data ? splitJobLog(log.data.text, steps()) : null))
  const stepLog = (step: number): string[] => {
    const sliced = split()
    const text = sliced ? (sliced.byStep.get(step) ?? sliced.full) : ''
    return text ? text.split('\n') : []
  }

  // Portalled, because the pane that opens this sets `contain: layout paint`, which would make a
  // fixed-position overlay inside it a box the size of the pane.
  return (
    <Portal>
      <Modal size="wide" title={job()?.name ?? props.jobName} onDismiss={props.onClose}>
        <Modal.Body>
          <Show when={!jobs.isLoading} fallback={<EmptyState align="start" busy>Loading steps…</EmptyState>}>
            <Show
              when={steps().length}
              fallback={<EmptyState align="start">{jobs.isError ? 'Failed to load steps.' : 'No steps.'}</EmptyState>}
            >
              <Stack gap="row">
                <For each={steps()}>
                  {(step) => {
                    const status = () => (step.conclusion ?? step.status ?? '').toLowerCase()
                    return (
                      <Fold
                        label={step.name}
                        open={open().has(step.number)}
                        onOpenChange={(next) => toggle(step.number, next)}
                        meta={<StatusDot tone={checkStatusTone(status())} />}
                      >
                        <Show when={!log.isLoading} fallback={<EmptyState align="start" busy>Loading log…</EmptyState>}>
                          <Log lines={stepLog(step.number)} ariaLabel={`${step.name} log`} />
                        </Show>
                      </Fold>
                    )
                  }}
                </For>
              </Stack>
            </Show>
          </Show>
        </Modal.Body>
      </Modal>
    </Portal>
  )
}
