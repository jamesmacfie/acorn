import { createEffect, createMemo, createSignal, on, onCleanup, Show } from 'solid-js'
import { clientEvents, latestSignal, readJson, writeJson } from '@acorn/plugin-api/client'
import { Alert, Button, Field, Inline, Link, Select, Stack, Text } from '@acorn/plugin-api/ui'
import {
  instructionReviewRoute as route,
  type InstructionReview,
  type InstructionReviewProject,
} from '../../shared/instructionReview'
import InstructionReviewResults from './InstructionReviewResults'

export default function InstructionReviewPanel(props: {
  nodeId?: string | null
  enabled?: boolean
  preferredProjectId?: string | null
}) {
  const [projects, setProjects] = createSignal<InstructionReviewProject[]>([])
  const [loadingProjects, setLoadingProjects] = createSignal(true)
  const [projectId, setProjectId] = createSignal('')
  const [review, setReview] = createSignal<InstructionReview | null>(null)
  const [reviewNodeId, setReviewNodeId] = createSignal<string | undefined>()
  const [busy, setBusy] = createSignal(false)
  const [error, setError] = createSignal('')
  const [approved, setApproved] = createSignal(false)
  // The project list read, the review read, or the approval. Each clear aborts it.
  const request = latestSignal()
  const nodeId = () => props.nodeId ?? undefined
  const enabled = createMemo(() => props.enabled ?? false)

  const clear = () => {
    request.abort()
    setReview(null)
    setReviewNodeId(undefined)
    setApproved(false)
    setBusy(false)
    setError('')
  }
  createEffect(
    on(nodeId, (selectedNode) => {
      clear()
      const signal = request.next()
      setProjects([])
      setProjectId('')
      setLoadingProjects(true)
      const preferred = props.preferredProjectId
      void readJson<InstructionReviewProject[]>(`${route}/projects`, { nodeId: selectedNode, signal })
        .then((found) => {
          if (signal.aborted) return
          setProjects(found)
          setLoadingProjects(false)
          setProjectId(found.some((project) => project.id === preferred) ? preferred! : (found[0]?.id ?? ''))
        })
        .catch(() => {
          if (!signal.aborted) {
            setLoadingProjects(false)
            setError('Could not load projects for instruction review. Reopen Settings to try again.')
          }
        })
    }),
  )
  onCleanup(clear)

  const load = async () => {
    const selectedNode = nodeId()
    const selectedProject = projectId()
    if (!selectedProject) return
    clear()
    const signal = request.next()
    setBusy(true)
    try {
      const result = await readJson<InstructionReview>(`${route}?projectId=${encodeURIComponent(selectedProject)}`, {
        nodeId: selectedNode,
        signal,
      })
      if (!signal.aborted && projectId() === selectedProject) {
        setReview(result)
        setReviewNodeId(selectedNode)
      }
    } catch (cause) {
      if (!signal.aborted)
        setError(cause instanceof Error ? cause.message : 'Instruction scan incomplete. Retry the review.')
    } finally {
      if (!signal.aborted) setBusy(false)
    }
  }
  // Opening Settings or enabling review checks the selected project before the next agent turn.
  createEffect(
    on([enabled, projectId], ([reviewEnabled, selectedProject]) => {
      if (reviewEnabled && selectedProject) void load()
    }),
  )
  const approve = async () => {
    const current = review()
    if (!current?.id || nodeId() !== reviewNodeId() || projectId() !== current.projectId) return
    const selectedNode = nodeId()
    // Approval joins the current lifetime rather than starting one, so it doesn't abort the review read.
    const signal = request.signal
    setBusy(true)
    setError('')
    try {
      await writeJson(
        `${route}/${encodeURIComponent(current.id)}/approve`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ projectId: current.projectId }),
          nodeId: selectedNode,
          signal,
        },
        (response) =>
          response.status === 409
            ? 'The instructions changed while this review was open. Check again before approving.'
            : 'Could not approve these instructions. Try again.',
      )
      if (!signal.aborted) {
        setApproved(true)
        setReview(null)
      }
    } catch (cause) {
      if (!signal.aborted) setError(cause instanceof Error ? cause.message : 'Instructions changed. Open a new review.')
    } finally {
      if (!signal.aborted) setBusy(false)
    }
  }

  return (
    <Stack gap="row">
      <Show
        when={projects().length}
        fallback={
          <Text emphasis="muted" wrap>
            {loadingProjects()
              ? 'Loading projects…'
              : 'Add a project folder on this Node to review its instruction files before starting an agent.'}
          </Text>
        }
      >
        <Field
          label="Project"
          hint={
            review()?.branch
              ? `Reviewing the project folder on ${review()!.branch}. Worktrees with the same files share the approval.`
              : 'Review the instructions in the project folder on its current branch.'
          }
        >
          <Select
            label="Project for instruction review"
            value={projectId()}
            options={projects().map((project) => ({ value: project.id, label: project.name }))}
            onChange={(value) => {
              clear()
              setProjectId(value)
            }}
          />
        </Field>
        <Button size="sm" busy={busy()} onPress={() => void load()}>
          {review() || approved() ? 'Check again' : 'Review instruction files'}
        </Button>
      </Show>
      <Show when={error()}>
        <Alert>{error()}</Alert>
      </Show>
      <Show when={approved()}>
        <Alert variant="banner" tone="ok" title="Instructions approved">
          Acorn will ask you to review them again if the files change.
        </Alert>
      </Show>
      <Show when={review()}>
        {(result) => <InstructionReviewResults review={result()} busy={busy()} onApprove={() => void approve()} />}
      </Show>
      <Show when={review() && !review()?.approved && !review()?.empty}>
        <Inline wrap>
          <Text emphasis="muted">Other approvals:</Text>
          <Link onPress={() => clientEvents.emit('presentation:open-settings', { tab: 'plugins' })}>
            Plugins and skills
          </Link>
          <Show when={projectId()}>
            {(selected) => (
              <Link onPress={() => clientEvents.emit('presentation:open-settings', { tab: `project/${selected()}` })}>
                Project configuration
              </Link>
            )}
          </Show>
        </Inline>
      </Show>
    </Stack>
  )
}
