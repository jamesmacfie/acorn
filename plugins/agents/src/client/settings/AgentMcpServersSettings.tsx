import { createQuery, useQueryClient } from '@tanstack/solid-query'
import { createSignal, For, Index, Show } from 'solid-js'
import { createSettingSave, useSettingsDetail, useUnsavedChanges } from '@acorn/plugin-api/client'
import {
  Alert, Button, Checkbox, EmptyState, Field, Icon, IconButton, Inline, Input,
  SegmentedControl, SettingRow, SettingsSection, Stack, Text, Textarea,
} from '@acorn/plugin-api/ui'
import { confirmAction } from '@acorn/plugin-api/ui/host'
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

// The one piece of the settings page context this page uses. Optional, so the page draws on its own
// in a test.
type PageContext = { navigate: (target: string) => void }

// Settings → Agents → MCP servers (docs/mcp.md § Your own servers): the servers acorn hands every agent
// session, whichever harness runs it. A list, then one server's editor in the same pane, which the
// settings header names and offers the way back from (useSettingsDetail). A server's switch saves when
// it changes. Adding or editing one is a form with Save and Cancel, because a command, its arguments
// and its secrets only work together. Remove sits in the editor's danger zone. The section matches the
// one `../index.ts` declares for search.
export default function AgentMcpServersSettings(props: { context?: PageContext }) {
  const queryClient = useQueryClient()
  const servers = createQuery(() => agentMcpServersOptions())
  const [draft, setDraft] = createSignal<AgentMcpServerDraft | null>(null)
  // The draft as the form opened, which is what its unsaved changes are measured against.
  const [opened, setOpened] = createSignal<AgentMcpServerDraft | null>(null)
  const [saving, setSaving] = createSignal(false)
  const [error, setError] = createSignal('')
  const [tests, setTests] = createSignal<Record<string, TestState>>({})
  const openForm = (next: AgentMcpServerDraft | null) => {
    setError('')
    setOpened(next)
    setDraft(next)
  }

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
      openForm(null)
      void test(name)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The server could not be saved.')
    } finally {
      setSaving(false)
    }
  }

  const remove = async (name: string) => {
    const confirmed = await confirmAction({
      title: `Remove ${name}`,
      actionLabel: 'Remove server',
      goes: `The server ${name} and its stored secrets. Every session drops it the next time it starts, open ones included.`,
      stays: "Servers set up in a CLI's own config files.",
      danger: true,
    })
    if (!confirmed) return
    try {
      await removeAgentMcpServer(name)
      replaceList(current().filter((server) => server.name !== name))
      openForm(null)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The server could not be removed.')
    }
  }

  // The failure goes to the server's own row (the caller's `createSettingSave`), not the page.
  const toggle = async (server: AgentMcpServer, enabled: boolean) => {
    const input = agentMcpServerInput({ ...agentMcpServerDraft(server), enabled })
    const saved = await saveAgentMcpServer(server.name, input)
    replaceList(current().map((each) => (each.name === saved.name ? saved : each)))
  }

  return (
    <>
      <Show when={servers.error}>
        <Alert>{servers.error instanceof Error ? servers.error.message : 'MCP servers could not be loaded.'}</Alert>
      </Show>

      <Show
        when={draft()}
        fallback={
          <>
            <Show when={error()}><Alert>{error()}</Alert></Show>
            <SettingsSection
              id="servers"
              label="Servers"
              description="acorn adds these servers to every agent session."
              help="They go to Claude Code, Codex, and any other harness, including a session you continue in a terminal. A change applies to new sessions. To change an open session, type /mcp in its message box."
              actions={
                <>
                  <Show when={props.context}>
                    {(context) => <Button variant="ghost" onPress={() => context().navigate('mcp')}>MCP config files</Button>}
                  </Show>
                  <Button onPress={() => openForm(blankAgentMcpServerDraft())}><Icon name="plus" /> Add server</Button>
                </>
              }
            >
              <Show when={!current().length && servers.isSuccess}>
                <EmptyState align="start" size="sm">No servers.</EmptyState>
              </Show>
              {/* By name, because a toggle or a refetch hands back new server objects, and a row drawn
                  again would drop the focus on its switch. */}
              <For each={current().map((server) => server.name)}>
                {(name) => {
                  let last = current().find((server) => server.name === name)!
                  const server = () => (last = current().find((candidate) => candidate.name === name) ?? last)
                  return <ServerRow server={server()} test={tests()[name]} onEdit={() => openForm(agentMcpServerDraft(server()))}
                    onTest={() => void test(name)} onToggle={(enabled) => toggle(server(), enabled)} />
                }}
              </For>
            </SettingsSection>
          </>
        }
      >
        {(working) => (
          <ServerEditor draft={working()} opened={opened()} saving={saving()} error={error()} onEdit={edit} onEditPair={editPair}
            onSave={() => void save()} onCancel={() => openForm(null)} onRemove={() => void remove(working().existing!)} />
        )}
      </Show>
    </>
  )
}

function ServerRow(props: {
  server: AgentMcpServer
  test: TestState | undefined
  onEdit: () => void
  onTest: () => void
  onToggle: (enabled: boolean) => Promise<void>
}) {
  const enabled = createSettingSave()
  const server = () => props.server
  return (
    <>
      <SettingRow
        label={server().name}
        description={server().transport === 'stdio' ? [server().command, ...server().args].join(' ') : server().url ?? undefined}
        error={enabled.error()}
      >
        <Inline>
          <Checkbox
            switch
            size="sm"
            label="On for new sessions"
            checked={server().enabled}
            onChange={(checked) => enabled.run(() => props.onToggle(checked))}
          />
          <Button size="sm" variant="ghost" label={`Edit ${server().name}`} onPress={props.onEdit}>Edit</Button>
          <Button size="sm" variant="ghost" label={`Test ${server().name}`} busy={props.test?.testing} onPress={props.onTest}>Test</Button>
        </Inline>
      </SettingRow>
      <TestLine state={props.test} />
    </>
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
  opened: AgentMcpServerDraft | null
  saving: boolean
  error: string
  onEdit: (patch: Partial<AgentMcpServerDraft>) => void
  onEditPair: (index: number, patch: Partial<AgentMcpPairDraft>) => void
  onSave: () => void
  onCancel: () => void
  onRemove: () => void
}) {
  const valuesLabel = () => (props.draft.transport === 'stdio' ? 'Environment variables' : 'Headers')
  // Settings asks before anyone leaves the page while this holds changes, the header's back link and
  // ⌘[ included. The draft only ever changes by spreading a patch over it, so its keys keep their order
  // and a string comparison is enough.
  const dirty = () => JSON.stringify(props.draft) !== JSON.stringify(props.opened)
  useUnsavedChanges(dirty)
  const hostDrawsBack = useSettingsDetail(() => props.draft.existing ?? 'New server', props.onCancel)
  // Drawn outside settings, the page has no header, so it draws its own way back and asks itself.
  const back = () => {
    if (!dirty()) return props.onCancel()
    void confirmAction({
      title: 'Discard unsaved changes',
      actionLabel: 'Discard changes',
      goes: 'Your unsaved changes to this server.',
      stays: props.draft.existing ? 'The server as it was last saved.' : undefined,
      danger: true,
    }).then((discard) => { if (discard) props.onCancel() })
  }
  return (
    <>
      <Show when={!hostDrawsBack}>
        <Inline><Button variant="bare" size="sm" onPress={back}>‹ MCP servers</Button></Inline>
      </Show>
      <SettingsSection id="server" label="Server">
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
            <Field label="Command" hint="A program on your PATH, or its full path.">
              <Input value={props.draft.command} placeholder="npx" onInput={(command) => props.onEdit({ command })} />
            </Field>
            <Field label="Arguments" hint="One per line.">
              <Textarea mono rows={3} value={props.draft.args} placeholder={'-y\n@example/mcp-server'} onInput={(args) => props.onEdit({ args })} />
            </Field>
          </Show>
          <Field label={valuesLabel()} group hint="Secret values are stored encrypted and never shown again. Leave a saved secret empty to keep it.">
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
          <Inline gap="row">
            <Button tone="accent" variant="solid" busy={props.saving} onPress={props.onSave}>Save</Button>
            <Button variant="ghost" onPress={props.onCancel}>Cancel</Button>
          </Inline>
        </Stack>
      </SettingsSection>
      <Show when={props.draft.existing}>
        <SettingsSection id="danger" label="Danger zone" tone="danger">
          <SettingRow label="Remove server" description="Every session drops it the next time it starts.">
            <Button tone="danger" onPress={props.onRemove}>Remove server</Button>
          </SettingRow>
        </SettingsSection>
      </Show>
    </>
  )
}
