import { createEffect, createSignal, For, on, onCleanup, Show } from 'solid-js'
import { clientEvents, readJson } from '@acorn/plugin-api/client'
import { Alert, Button, Link, Select, Stack, Text } from '@acorn/plugin-api/ui'
import { agentSecurityDiagnosticsRoute, type SecurityDiagnostics, type SecurityFinding, type SecurityScopeChoices } from '../../shared/securityDiagnostics'

const emptyChoices: SecurityScopeChoices = { projects: [], sessions: [] }

const settingsFor = (finding: SecurityFinding): string | null => {
  if (finding.id.startsWith('mcp.')) return 'agent-mcp-servers'
  if (finding.id.startsWith('agent-tools.')) return 'agent-tools'
  if (finding.id.startsWith('plugins.')) return 'plugins'
  if (finding.id.startsWith('harness.')) return 'agent-defaults'
  if (finding.id.startsWith('instructions.')) return 'security'
  if (finding.id.startsWith('project.') && finding.projectId) return `project/${finding.projectId}`
  return null
}

/** The route has already reduced external data to safe, bounded evidence. */
function Finding(props: { finding: SecurityFinding }) {
  const finding = () => props.finding
  const settings = () => settingsFor(finding())
  return <Stack gap="row">
    <Text wrap>{finding().severity === 'warning' ? '⚠ ' : ''}{finding().summary}</Text>
    <Text emphasis="muted" wrap>{finding().state.replace('_', ' ')} · {finding().source} · {finding().owner} · {finding().id}</Text>
    <Text emphasis="muted" wrap>Limit: {finding().limits}</Text>
    <Text emphasis="muted" wrap>Action: {finding().repair}</Text>
    <Show when={settings()}>{(tab) => <Link onPress={() => clientEvents.emit('presentation:open-settings', { tab: tab() })}>Open setting</Link>}</Show>
  </Stack>
}

export default function SecurityDiagnosticsPanel(props: { nodeId?: string | null }) {
  const [choices, setChoices] = createSignal(emptyChoices)
  const [projectId, setProjectId] = createSignal('')
  const [sessionId, setSessionId] = createSignal('')
  const [report, setReport] = createSignal<SecurityDiagnostics | null>(null)
  const [busy, setBusy] = createSignal(false)
  const [error, setError] = createSignal('')
  const [clock, setClock] = createSignal(Date.now())
  let generation = 0
  let request: AbortController | null = null
  let timer: ReturnType<typeof setInterval> | undefined
  const nodeId = () => props.nodeId ?? undefined
  const clearReport = () => { request?.abort(); request = null; ++generation; setReport(null); setBusy(false); setError('') }

  createEffect(on(nodeId, (selectedNode) => {
    clearReport()
    setChoices(emptyChoices)
    setProjectId('')
    setSessionId('')
    const current = generation
    const controller = new AbortController()
    request = controller
    void readJson<SecurityScopeChoices>(`${agentSecurityDiagnosticsRoute}/scopes`, { nodeId: selectedNode, signal: controller.signal })
      .then((found) => { if (generation === current) setChoices(found) })
      .catch(() => { if (generation === current) setError('Scope choices could not be loaded. You can still check this Node.') })
  }))
  onCleanup(() => { clearReport(); if (timer) clearInterval(timer) })

  const check = async () => {
    clearReport()
    const current = generation
    const selectedNode = nodeId()
    const selectedProject = projectId()
    const selectedSession = sessionId()
    const params = new URLSearchParams()
    if (selectedProject) params.set('projectId', selectedProject)
    if (selectedSession) params.set('sessionId', selectedSession)
    const controller = new AbortController()
    request = controller
    setBusy(true)
    try {
      const result = await readJson<SecurityDiagnostics>(`${agentSecurityDiagnosticsRoute}${params.size ? `?${params}` : ''}`,
        { nodeId: selectedNode, signal: controller.signal })
      if (generation === current && nodeId() === selectedNode && projectId() === selectedProject && sessionId() === selectedSession) {
        setReport(result)
        setClock(Date.now())
        if (timer) clearInterval(timer)
        timer = setInterval(() => setClock(Date.now()), 15_000)
      }
    } catch {
      if (generation === current) setError('Diagnostics could not finish. Retry Check this node.')
    } finally { if (generation === current) setBusy(false) }
  }

  const visible = () => { const current = report(); return current && current.expiresAt > clock() ? current : null }
  return <Stack gap="row">
    <Text emphasis="muted" wrap>Read current evidence on this Node. The check runs no configured commands, servers, package manager, or model. The owner still has host access, and global harness settings may be invisible.</Text>
    <Select label="Project" value={projectId()} options={[{ value: '', label: 'No project' }, ...choices().projects.map((project) => ({ value: project.id, label: project.name }))]}
      onChange={(value) => { clearReport(); setProjectId(value); setSessionId('') }} />
    <Select label="Running session" value={sessionId()} options={[{ value: '', label: 'No session' }, ...choices().sessions
      .filter((session) => !projectId() || session.projectId === projectId())
      .map((session) => ({ value: session.id, label: session.label }))]}
      onChange={(value) => { clearReport(); setSessionId(value) }} />
    <Button size="sm" busy={busy()} onPress={() => void check()}>Check this node</Button>
    <Show when={error()}><Alert>{error()}</Alert></Show>
    <Show when={report() && !visible()}><Text emphasis="muted">Evidence expired. Check this node again.</Text></Show>
    <Show when={visible()}>{(current) => <Stack gap="row">
      <Text emphasis="muted">Checked {new Date(current().checkedAt).toLocaleString()}. Evidence expires in five minutes.</Text>
      <For each={current().findings}>{(finding) => <Finding finding={finding} />}</For>
    </Stack>}</Show>
  </Stack>
}
