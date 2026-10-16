import { createMemo } from 'solid-js'
import { createQuery } from '@tanstack/solid-query'
import type { Check } from '@acorn/change-request-ui/model'
import { ChecksPanel } from '@acorn/change-request-ui/views'
import { jobLogOptions } from './queries'
import { jobSections } from './jobLog'

// One pipeline job's log, in the shared checks panel. GitLab sends a job's log as one text with its
// sections marked, so each section is a step. A failed job opens its last section, where it stopped.
export default function GitlabChecksPanel(props: { address: string; check: Check; onClose: () => void }) {
  const jobId = () => props.check.runId ?? 0
  // The log is the steps, so it's read when the panel opens rather than when a step does.
  const log = createQuery(() => jobLogOptions(props.address, jobId(), true))
  const sections = createMemo(() => jobSections(log.data?.text ?? '', props.check.status))
  return (
    <ChecksPanel
      title={props.check.name}
      jobKey={() => (log.data ? jobId() : null)}
      steps={() => sections().map(({ id, name, status }) => ({ id, name, status }))}
      stepsLoading={() => log.isLoading}
      stepsFailed={() => log.isError}
      onLogWanted={() => {}}
      logLoading={() => false}
      stepLog={(id) => sections().find((section) => section.id === id)?.lines ?? []}
      url={props.check.url}
      hostLabel="GitLab"
      onClose={props.onClose}
    />
  )
}
