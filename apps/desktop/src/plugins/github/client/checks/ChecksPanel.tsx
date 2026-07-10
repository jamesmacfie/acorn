import { createEffect, createMemo, createResource, createSignal, For, onCleanup, onMount, Show } from 'solid-js'
import { Portal } from 'solid-js/web'
import { createQuery } from '@tanstack/solid-query'
import { jobLogOptions, runJobsOptions } from '../../../../core/client/queries'
import { FAILED_STATUSES } from '../displayMeta'
import { getHighlighter, tokenizeAnsiLines } from '../shiki'
import { splitJobLog } from './splitJobLog'

// One step's log, ANSI-colour highlighted (the colours CI tools emit). Falls back to raw text while
// the highlighter loads and for very large slices. ponytail: 300k-char cap keeps huge logs snappy.
function StepLog(props: { text: string }) {
  const [lines] = createResource(
    () => props.text,
    async (text) => (text.length > 300_000 ? null : tokenizeAnsiLines(await getHighlighter(), text)),
  )
  return (
    <div class="step-log-wrap">
      <button type="button" class="step-log-copy" title="Copy log" aria-label="Copy log" onClick={() => navigator.clipboard?.writeText(props.text)}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
          <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
        </svg>
      </button>
      <pre class="step-log">
        <Show when={lines()} fallback={props.text}>
          {(ls) => (
            <For each={ls()}>
              {(line) => (
                <div class="log-line">
                  <For each={line}>{(t) => <span style={{ '--l': t.light, '--r': t.dark }}>{t.content}</span>}</For>
                </div>
              )}
            </For>
          )}
        </Show>
      </pre>
    </div>
  )
}

// Side panel for one workflow run: the steps of the clicked job (matched by name), GitHub-Actions
// style. Failed steps start expanded; each step's log is sliced from the one job-log fetch that
// fires when the first step opens. Logs load lazily and are cached by the query client.
export default function ChecksPanel(props: { owner: string; repo: string; runId: number; jobName: string; onClose: () => void }) {
  const jobs = createQuery(() => runJobsOptions(props.owner, props.repo, props.runId, true))
  // The clicked check name == its job name. Fall back to the first job if no exact match
  // (matrix / name-format edge case). ponytail.
  const job = createMemo(() => {
    const list = jobs.data?.jobs ?? []
    return list.find((j) => j.name === props.jobName) ?? list[0] ?? null
  })
  const steps = () => job()?.steps ?? []

  const [open, setOpen] = createSignal<Set<number>>(new Set())
  const toggle = (n: number) =>
    setOpen((prev) => {
      const next = new Set(prev)
      if (next.has(n)) next.delete(n)
      else next.add(n)
      return next
    })

  // Seed the open set once per job: failed steps start expanded.
  const [seeded, setSeeded] = createSignal<number | null>(null)
  createEffect(() => {
    const j = job()
    if (!j || seeded() === j.id) return
    setOpen(new Set(j.steps.filter((s) => FAILED_STATUSES.has((s.conclusion ?? '').toLowerCase())).map((s) => s.number)))
    setSeeded(j.id)
  })

  // Fetch the job log only once a step is open (lazy). One fetch covers every step.
  const anyOpen = () => open().size > 0
  const log = createQuery(() => jobLogOptions(props.owner, props.repo, job()?.id ?? 0, anyOpen() && !!job()))
  const split = createMemo(() => (log.data ? splitJobLog(log.data.text, steps()) : null))
  const stepLog = (n: number) => {
    const s = split()
    return s ? (s.byStep.get(n) ?? s.full) : ''
  }

  onMount(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') props.onClose()
    }
    window.addEventListener('keydown', onKey)
    onCleanup(() => window.removeEventListener('keydown', onKey))
  })

  return (
    <Portal>
      <div class="checks-panel-backdrop" onClick={props.onClose} />
      <aside class="checks-panel">
        <header class="checks-panel-head">
          <span class="checks-panel-title">{job()?.name ?? props.jobName}</span>
          <button type="button" class="checks-panel-close" onClick={props.onClose} aria-label="Close">
            ✕
          </button>
        </header>
        <div class="checks-panel-body">
          <Show when={!jobs.isLoading} fallback={<p class="muted">Loading steps…</p>}>
            <Show when={steps().length} fallback={<p class="muted">{jobs.isError ? 'Failed to load steps.' : 'No steps.'}</p>}>
              <ul class="step-list">
                <For each={steps()}>
                  {(s) => {
                    const status = () => (s.conclusion ?? s.status ?? '').toLowerCase()
                    return (
                      <li class="step-row">
                        <button type="button" class="step-head" onClick={() => toggle(s.number)}>
                          <span class={`check-dot check-${status()}`} />
                          <span class="step-name">{s.name}</span>
                        </button>
                        <Show when={open().has(s.number)}>
                          <Show when={!log.isLoading} fallback={<pre class="step-log">Loading log…</pre>}>
                            <StepLog text={stepLog(s.number)} />
                          </Show>
                        </Show>
                      </li>
                    )
                  }}
                </For>
              </ul>
            </Show>
          </Show>
        </div>
      </aside>
    </Portal>
  )
}
