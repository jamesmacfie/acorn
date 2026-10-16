import { createMemo, createSignal } from 'solid-js'
import { createQuery } from '@tanstack/solid-query'
import type { Check } from '@acorn/change-request-ui/model'
import { ChecksPanel } from '@acorn/change-request-ui/views'
import { jobLogOptions, runJobsOptions } from '../queries'
import { splitJobLog } from './splitJobLog'

// One workflow run's steps, GitHub-Actions style: the steps of the clicked job matched by name, each
// step's log sliced from the one job-log fetch that fires when the first step opens. The panel is the
// shared one; this is where its steps and log come from.
export default function GithubChecksPanel(props: { owner: string; repo: string; check: Check; onClose: () => void }) {
  const jobs = createQuery(() => runJobsOptions(props.owner, props.repo, props.check.runId ?? 0, true))
  const job = createMemo(() => {
    const list = jobs.data?.jobs ?? []
    return list.find((candidate) => candidate.name === props.check.name) ?? list[0] ?? null
  })
  const steps = () =>
    (job()?.steps ?? []).map((step) => ({ id: step.number, name: step.name, status: step.conclusion ?? step.status }))

  const [logWanted, setLogWanted] = createSignal(false)
  const log = createQuery(() => jobLogOptions(props.owner, props.repo, job()?.id ?? 0, logWanted() && !!job()))
  const split = createMemo(() => (log.data ? splitJobLog(log.data.text, job()?.steps ?? []) : null))
  const stepLog = (step: number): string[] => {
    const sliced = split()
    const text = sliced ? (sliced.byStep.get(step) ?? sliced.full) : ''
    return text ? text.split('\n') : []
  }

  return (
    <ChecksPanel
      title={job()?.name ?? props.check.name}
      jobKey={() => job()?.id ?? null}
      steps={steps}
      stepsLoading={() => jobs.isLoading}
      stepsFailed={() => jobs.isError}
      onLogWanted={() => setLogWanted(true)}
      logLoading={() => log.isLoading}
      stepLog={stepLog}
      url={props.check.url}
      hostLabel="GitHub"
      onClose={props.onClose}
    />
  )
}
