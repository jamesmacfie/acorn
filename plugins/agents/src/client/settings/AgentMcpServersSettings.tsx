import { createQuery, useQueryClient } from '@tanstack/solid-query'
import { createSignal, For, Index, Show } from 'solid-js'
import {
  Alert, Badge, Button, Card, Checkbox, ConfirmButton, Field, IconButton, Inline, Input, Section,
  SegmentedControl, Stack, Text, Textarea, Toolbar,
} from '@acorn/plugin-api/ui'
import {
  agentMcpServerInputSchema,
  validateAgentMcpServerName,
  type AgentMcpProbeResult,
  type AgentMcpServer,
} from '../../shared/mcpServers'
import {
  agentMcpServersOptions,
  agentMcpServersQueryKey,
  removeAgentMcpServer,
  saveAgentMcpServer,
  testAgentMcpServer,
} from './mcpServersClient'
import {
  agentMcpServerDraft,
  agentMcpServerInput,
  blankAgentMcpServerDraft,
  type AgentMcpPairDraft,
  type AgentMcpServerDraft,
} from './mcpServerDraft'

type TestState = { testing: true } | { testing: false; result: AgentMcpProbeResult }

// Settings → MCP servers (docs/mcp.md § Your own servers): the servers acorn hands every agent session,
// whichever harness runs it.
export default function AgentMcpServersSettings() {
  const queryClient = useQueryClient()
  const servers = createQuery(() => agentMcpServersOptions())
  const [draft, setDraft] = createSignal<AgentMcpServerDraft | null>(null)
  const [saving, setSaving] = createSignal(false)
  const [error, setError] = createSignal('')
  const [tests, setTests] = createSignal<Record<string, TestState>>({})

  const replaceList = (next: AgentMcpServer[]) => queryClient.setQueryData(agentMcpServersQueryKey, next)
  const current = () => servers.data ?? []

  const edit = (patch: Partial<AgentMcpServerDraft>) => {
    setDraft((before) => before && { ...before, ...patch })
    setError('')
  }
  const editPair = (index: number, patch: Partial<AgentMcpPairDraft>) => {
    const before = draft()
    if (!before) return
    edit({ values: before.values.map((pair, i) => (i === index ? { ...pair, ...patch } : pair)) })
  }

  const test = async (name: string) => {
    setTests((all) => ({ ...all, [name]: { testing: true } }))
    try {
      const result = await testAgentMcpServer(name)
      setTests((all) => ({ ...all, [name]: { testing: false, result } }))
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : 'The test could not run.'
      setTests((all) => ({ ...all, [name]: { testing: false, result: { ok: false, error: message } } }))
    }
  }

  // Button-only submit, like the other settings pages: Enter in a field does not save.
  const save = async () => {
    const working = draft()
    if (!working || saving()) return
    const name = working.existing ?? working.name.trim()
    const nameError = validateAgentMcpServerName(name)
    if (nameError) return setError(nameError)
    if (!working.existing && current().some((server) => server.name === name)) {
      return setError(`A server named ${name} already exists.`)
    }
    // The route runs the same schema, so a bad field is caught here rather than coming back as a 400.
    const parsed = agentMcpServerInputSchema.safeParse(agentMcpServerInput(working))
    if (!parsed.success) return setError(parsed.error.issues.map((issue) => issue.message).join(' '))
    setSaving(true)
    try {
      const saved = await saveAgentMcpServer(name, parsed.data)
      replaceList([...current().filter((server) => server.name !== name), saved].sort((a, b) => a.name.localeCompare(b.name)))
      setDraft(null)
      void test(name)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The server could not be saved.')
    } finally {
      setSaving(false)
    }
  }

  const remove = async (name: string) => {
    try {
      await removeAgentMcpServer(name)
      replaceList(current().filter((server) => server.name !== name))
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The server could not be removed.')
    }
  }

  const toggle = async (server: AgentMcpServer, enabled: boolean) => {
    const input = agentMcpServerInput({ ...agentMcpServerDraft(server), enabled })
    try {
      const saved = await saveAgentMcpServer(server.name, input)
      replaceList(current().map((each) => (each.name === saved.name ? saved : each)))
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The server could not be changed.')
    }
  }

  return (
    <Stack gap="section">
      <Text emphasis="muted" wrap>
        Servers you add here go to every agent session acorn runs, in Claude Code, Codex, and any other
        harness, and they go with a session when you continue it in a terminal. A server that is on for
        new sessions starts in each session you open from now on. To change an open session, type /mcp
        in its composer. Servers set up in a CLI's own config keep loading as well, and Settings → MCP
        config files lists them.
      </Text>

      <Show when={servers.error}>
        <Alert>{servers.error instanceof Error ? servers.error.message : 'MCP servers could not be loaded.'}</Alert>
      </Show>
      <Show when={error() && !draft()}>
        <Alert>{error()}</Alert>
      </Show>

      <Section
        label="Servers"
        actions={
          <Button disabled={!!draft()} onPress={() => { setError(''); setDraft(blankAgentMcpServerDraft()) }}>
            Add server
          </Button>
        }
      >
        <Stack gap="row">
          <Show when={draft() && !draft()!.existing}>
            <ServerEditor draft={draft()!} saving={saving()} error={error()} onEdit={edit} onEditPair={editPair}
              onSave={() => void save()} onCancel={() => { setDraft(null); setError('') }} />
          </Show>
          <Show when={!current().length && !draft() && !servers.isPending}>
            <Text emphasis="muted">No servers yet.</Text>
          </Show>
          <For each={current()}>
            {(server) => (
              <Show
                when={draft()?.existing !== server.name}
                fallback={
                  <ServerEditor draft={draft()!} saving={saving()} error={error()} onEdit={edit} onEditPair={editPair}
                    onSave={() => void save()} onCancel={() => { setDraft(null); setError('') }} />
                }
              >
                <Card pad="sm">
                  <Stack gap="inline">
                    <Inline spread>
                      <Inline>
                        <Text emphasis="strong">{server.name}</Text>
                        <Badge size="xs">{server.transport === 'stdio' ? 'stdio' : 'HTTP'}</Badge>
                      </Inline>
                      <Checkbox
                        switch
                        size="sm"
                        label="On for new sessions"
                        checked={server.enabled}
                        onChange={(enabled) => void toggle(server, enabled)}
                      />
                    </Inline>
                    <Text emphasis="mono">
                      {server.transport === 'stdio' ? [server.command, ...server.args].join(' ') : server.url}
                    </Text>
                    <TestLine state={tests()[server.name]} />
                    <Toolbar variant="actions" size="sm">
                      <Button size="sm" disabled={!!draft()} onPress={() => { setError(''); setDraft(agentMcpServerDraft(server)) }}>Edit</Button>
                      <Button size="sm" busy={tests()[server.name]?.testing} onPress={() => void test(server.name)}>Test</Button>
                      <ConfirmButton size="sm" confirmLabel="Remove from acorn?" onConfirm={() => void remove(server.name)}>Remove</ConfirmButton>
                    </Toolbar>
                  </Stack>
                </Card>
              </Show>
            )}
          </For>
        </Stack>
      </Section>
    </Stack>
  )
}

const testSummary = (result: AgentMcpProbeResult): string | null => {
  if (!result.ok) return null
  const count = result.tools.length === 1 ? '1 tool' : `${result.tools.length} tools`
  return result.tools.length ? `Connected. ${count}: ${result.tools.map((tool) => tool.name).join(', ')}` : `Connected. ${count}.`
}

const testFailure = (result: AgentMcpProbeResult): string => (result.ok ? '' : result.error)

function TestLine(props: { state: TestState | undefined }) {
  const result = () => (props.state && !props.state.testing ? props.state.result : null)
  return (
    <>
      <Show when={props.state?.testing}><Text emphasis="muted">Testing…</Text></Show>
      <Show when={result()}>
        {(done) => (
          <Show when={testSummary(done())} fallback={<Alert tone="warn">{testFailure(done())}</Alert>}>
            {(line) => <Text emphasis="muted" wrap>{line()}</Text>}
          </Show>
        )}
      </Show>
    </>
  )
}

function ServerEditor(props: {
  draft: AgentMcpServerDraft
  saving: boolean
  error: string
  onEdit: (patch: Partial<AgentMcpServerDraft>) => void
  onEditPair: (index: number, patch: Partial<AgentMcpPairDraft>) => void
  onSave: () => void
  onCancel: () => void
}) {
  const valuesLabel = () => (props.draft.transport === 'stdio' ? 'Environment variables' : 'Headers')
  return (
    <Card pad="md">
      <Stack gap="stack">
        <Field label="Name" hint={props.draft.existing ? 'A server keeps its name. Remove it and add it again to rename it.' : 'What agents and the session panel call it.'}>
          <Input value={props.draft.name} disabled={!!props.draft.existing} placeholder="linear" onInput={(name) => props.onEdit({ name })} />
        </Field>
        <Field label="Transport" group>
          <SegmentedControl
            ariaLabel="Transport"
            value={props.draft.transport}
            options={[{ value: 'stdio', label: 'Command (stdio)' }, { value: 'http', label: 'URL (HTTP)' }]}
            onChange={(transport) => props.onEdit({ transport })}
          />
        </Field>
        <Show
          when={props.draft.transport === 'stdio'}
          fallback={
            <Field label="URL">
              <Input type="url" value={props.draft.url} placeholder="https://mcp.example.com/mcp" onInput={(url) => props.onEdit({ url })} />
            </Field>
          }
        >
          <Field label="Command" hint="Found on the PATH agents run with, or give a full path.">
            <Input value={props.draft.command} placeholder="npx" onInput={(command) => props.onEdit({ command })} />
          </Field>
          <Field label="Arguments" hint="One per line.">
            <Textarea mono rows={3} value={props.draft.args} placeholder={'-y\n@example/mcp-server'} onInput={(args) => props.onEdit({ args })} />
          </Field>
        </Show>
        <Field label={valuesLabel()} group hint="Mark a value secret to store it encrypted. acorn never shows it again, and a stored secret left empty keeps its value.">
          <Stack gap="inline">
            <Index each={props.draft.values}>
              {(pair, index) => (
                <Inline>
                  <Input size="sm" label={`${valuesLabel()} name`} value={pair().name} placeholder="API_KEY" onInput={(name) => props.onEditPair(index, { name })} />
                  <Input
                    size="sm"
                    type={pair().secret ? 'password' : 'text'}
                    label={`${pair().name || valuesLabel()} value`}
                    value={pair().value}
                    placeholder={pair().stored ? 'Stored. Leave empty to keep it.' : 'Value'}
                    onInput={(value) => props.onEditPair(index, { value })}
                  />
                  <Checkbox size="sm" label="Secret" checked={pair().secret} onChange={(secret) => props.onEditPair(index, { secret, stored: secret && pair().stored })} />
                  <IconButton icon="x" label="Remove" onPress={() => props.onEdit({ values: props.draft.values.filter((_, i) => i !== index) })} />
                </Inline>
              )}
            </Index>
            <Inline>
              <Button size="sm" variant="ghost" onPress={() => props.onEdit({ values: [...props.draft.values, { name: '', value: '', secret: false, stored: false }] })}>
                {props.draft.transport === 'stdio' ? 'Add variable' : 'Add header'}
              </Button>
            </Inline>
          </Stack>
        </Field>
        <Checkbox switch label="On for new sessions" checked={props.draft.enabled} onChange={(enabled) => props.onEdit({ enabled })} />
        <Show when={props.error}><Alert>{props.error}</Alert></Show>
        <Toolbar variant="actions">
          <Button tone="accent" variant="solid" busy={props.saving} onPress={props.onSave}>Save</Button>
          <Button variant="ghost" onPress={props.onCancel}>Cancel</Button>
        </Toolbar>
      </Stack>
    </Card>
  )
}
