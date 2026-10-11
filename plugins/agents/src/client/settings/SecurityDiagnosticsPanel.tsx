import { createEffect, createSignal, on, onCleanup, Show } from 'solid-js'
import { latestSignal, readJson } from '@acorn/plugin-api/client'
import { Alert, Button, Field, Select, Stack, Text } from '@acorn/plugin-api/ui'
import {
  agentSecurityDiagnosticsRoute,
  type SecurityDiagnostics,
  type SecurityScopeChoices,
} from '../../shared/securityDiagnostics'
import SecurityDiagnosticsResults from './SecurityDiagnosticsResults'

const emptyChoices: SecurityScopeChoices = { projects: [], sessions: [] }

export default function SecurityDiagnosticsPanel(props: { nodeId?: string | null }) {
  const [choices, setChoices] = createSignal(emptyChoices)
  const [projectId, setProjectId] = createSignal('')
  const [sessionId, setSessionId] = createSignal('')
  const [report, setReport] = createSignal<SecurityDiagnostics | null>(null)
  const [busy, setBusy] = createSignal(false)
  const [error, setError] = createSignal('')
  const [clock, setClock] = createSignal(Date.now())
  // The scope read or the security check. Clearing the report aborts it.
  const request = latestSignal()
  let timer: ReturnType<typeof setInterval> | undefined
  const nodeId = () => props.nodeId ?? undefined
  const clearReport = () => {
    request.abort()
    setReport(null)
    setBusy(false)
    setError('')
  }

  createEffect(
    on(nodeId, (selectedNode) => {
      clearReport()
      setChoices(emptyChoices)
      setProjectId('')
      setSessionId('')
      const signal = request.next()
      void readJson<SecurityScopeChoices>(`${agentSecurityDiagnosticsRoute}/scopes`, { nodeId: selectedNode, signal })
        .then((found) => {
          if (!signal.aborted) setChoices(found)
        })
        .catch(() => {
          if (!signal.aborted) setError('Could not load projects and running agents. You can still check this Node.')
        })
    }),
  )
  onCleanup(() => {
    clearReport()
    if (timer) clearInterval(timer)
  })

  const check = async () => {
    clearReport()
    const signal = request.next()
    const selectedNode = nodeId()
    const selectedProject = projectId()
    const selectedSession = sessionId()
    const params = new URLSearchParams()
    if (selectedProject) params.set('projectId', selectedProject)
    if (selectedSession) params.set('sessionId', selectedSession)
    setBusy(true)
    try {
      const result = await readJson<SecurityDiagnostics>(
        `${agentSecurityDiagnosticsRoute}${params.size ? `?${params}` : ''}`,
        { nodeId: selectedNode, signal },
      )
      if (
        !signal.aborted &&
        nodeId() === selectedNode &&
        projectId() === selectedProject &&
        sessionId() === selectedSession
      ) {
        setReport(result)
        setClock(Date.now())
        if (timer) clearInterval(timer)
        timer = setInterval(() => setClock(Date.now()), 15_000)
      }
    } catch {
      if (!signal.aborted) setError('The security check could not finish. Try again.')
    } finally {
      if (!signal.aborted) setBusy(false)
    }
  }

  const visible = () => {
    const current = report()
    return current && current.expiresAt > clock() ? current : null
  }
  return (
    <Stack gap="row">
      <Text emphasis="muted" wrap>
        Check the security settings on this Node. This reads saved settings without starting agents or running commands.
      </Text>
      <Field label="Project (optional)" hint="Include this project's instruction checks and package policies.">
        <Select
          label="Project"
          value={projectId()}
          options={[
            { value: '', label: 'Node settings only' },
            ...choices().projects.map((project) => ({ value: project.id, label: project.name })),
          ]}
          onChange={(value) => {
            clearReport()
            setProjectId(value)
            setSessionId('')
          }}
        />
      </Field>
      <Show when={choices().sessions.some((session) => !projectId() || session.projectId === projectId())}>
        <Field
          label="Running agent (optional)"
          hint="Include the settings an agent is using. These can differ from the defaults for new agents."
        >
          <Select
            label="Running agent"
            value={sessionId()}
            options={[
              { value: '', label: 'Defaults for new agents' },
              ...choices()
                .sessions.filter((session) => !projectId() || session.projectId === projectId())
                .map((session) => ({ value: session.id, label: session.label })),
            ]}
            onChange={(value) => {
              clearReport()
              setSessionId(value)
            }}
          />
        </Field>
      </Show>
      <Button size="sm" busy={busy()} onPress={() => void check()}>
        Check this node
      </Button>
      <Show when={error()}>
        <Alert>{error()}</Alert>
      </Show>
      <Show when={report() && !visible()}>
        <Text emphasis="muted">Evidence expired. Check this node again.</Text>
      </Show>
      <Show when={visible()}>{(current) => <SecurityDiagnosticsResults report={current()} />}</Show>
    </Stack>
  )
}
