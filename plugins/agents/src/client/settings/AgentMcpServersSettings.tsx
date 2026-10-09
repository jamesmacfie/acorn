import { createQuery, useQueryClient } from '@tanstack/solid-query'
import { createMemo, createSignal, For, Index, onCleanup, onMount, Show } from 'solid-js'
import { createSettingSave, useSettingsDetail, useUnsavedChanges } from '@acorn/plugin-api/client'
import {
  Alert, Button, Checkbox, CodeBlock, EmptyState, Field, Fold, Icon, IconButton, Inline, Input,
  SegmentedControl, SettingRow, SettingsSection, Stack, Text, Textarea,
} from '@acorn/plugin-api/ui'
import { confirmAction } from '@acorn/plugin-api/ui/host'
import {
  agentMcpServerInputSchema,
  validateAgentMcpServerName,
  type AgentMcpProbeResult,
  type AgentMcpServer,
  type AgentMcpPackagePlan,
  type AgentMcpPackageTest,
  type AgentMcpPendingReview,
} from '../../shared/mcpServers'
import {
  agentMcpServersOptions,
  agentMcpServersQueryKey,
  removeAgentMcpServer,
  saveAgentMcpServer,
  testAgentMcpServer,
  planAgentMcpPackage,
  activateAgentMcpPackage,
  testAgentMcpPackagePlan,
  consentAgentMcpServer,
  pendingAgentMcpReviews,
  approveAgentMcpReview,
} from './mcpServersClient'
import {
  agentMcpServerDraft,
  agentMcpServerInput,
  blankAgentMcpServerDraft,
  type AgentMcpPairDraft,
  type AgentMcpServerDraft,
} from './mcpServerDraft'

type TestState = { testing: true } | { testing: false; result: AgentMcpProbeResult }

export function consentSource(server: AgentMcpServer): string {
  if (server.managed) return `${server.managed.package}@${server.managed.version} (${server.managed.bin})`
  if (server.transport === 'stdio') return `${server.command ?? 'Command'} (${server.args.length} arguments hidden)`
  try {
    const url = new URL(server.url ?? '')
    return `${url.origin}/… (path and credentials hidden)`
  } catch { return 'HTTP endpoint (address hidden)' }
}

// Settings → Agents → MCP, Servers tab (docs/mcp.md § Your own servers): the servers acorn hands every agent
// session, whichever harness runs it. A list, then one server's editor in the same pane, which the
// settings header names and offers the way back from (useSettingsDetail). A server's switch saves when
// it changes. Adding or editing one is a form with Save and Cancel, because a command, its arguments
// and its secrets only work together. Remove sits in the editor's danger zone. The section matches the
// one `../index.ts` declares for search. ./McpSettingsPage.tsx draws it as a tab.
export default function AgentMcpServersSettings() {
  const queryClient = useQueryClient()
  const servers = createQuery(() => agentMcpServersOptions())
  const [draft, setDraft] = createSignal<AgentMcpServerDraft | null>(null)
  // The draft as the form opened, which is what its unsaved changes are measured against.
  const [opened, setOpened] = createSignal<AgentMcpServerDraft | null>(null)
  const [saving, setSaving] = createSignal(false)
  const [error, setError] = createSignal('')
  const [tests, setTests] = createSignal<Record<string, TestState>>({})
  const [packageOpen, setPackageOpen] = createSignal(false)
  const [packageUpdate, setPackageUpdate] = createSignal<AgentMcpServer | null>(null)
  const [reviews, setReviews] = createSignal<AgentMcpPendingReview[]>([])
  const [reviewError, setReviewError] = createSignal('')
  const refreshReviews = async () => {
    try { setReviews(await pendingAgentMcpReviews()); setReviewError('') }
    catch (cause) { setReviewError(cause instanceof Error ? cause.message : 'MCP reviews could not be loaded.') }
  }
  onMount(() => {
    void refreshReviews()
    const timer = setInterval(() => { void refreshReviews() }, 5_000)
    onCleanup(() => clearInterval(timer))
  })
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
    const server = current().find((item) => item.name === name)
    if (!server) return
    if (!server.consented) {
      const source = consentSource(server)
      const approved = await confirmAction({
        title: `Use ${name}`,
        actionLabel: 'Consent and test',
        goes: `${server.transport === 'stdio' ? 'Execute local code' : 'Contact the HTTP server'}: ${source}. Declared credential names: ${server.values.filter((value) => value.secret).map((value) => value.name).join(', ') || 'none'}. The test connects and lists tools.`,
        stays: 'The server can be edited again; any change requires fresh consent.',
      })
      if (!approved) return
      try {
        const consented = await consentAgentMcpServer(name, server.revision)
        replaceList(current().map((item) => item.name === name ? consented : item))
      } catch (cause) {
        setTests((all) => ({ ...all, [name]: { testing: false, result: { ok: false, error: cause instanceof Error ? cause.message : 'The server changed before consent.' } } }))
        return
      }
    }
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
              help="They go to Claude Code, Codex, and any other harness, including a session you continue in a terminal. Test executes a command or contacts the URL. A change applies to new sessions. To change an open session, type /mcp in its message box."
              actions={
                <>
                  <Button onPress={() => openForm(blankAgentMcpServerDraft())}><Icon name="plus" /> Add server</Button>
                  <Button onPress={() => { setPackageUpdate(null); setPackageOpen(true) }}>Install an MCP package</Button>
                  <Button variant="ghost" onPress={() => void refreshReviews()}>Refresh tool reviews</Button>
                </>
              }
            >
              <Show when={packageOpen()}>
                <PackageInstaller existing={current().map((server) => server.name)} updating={packageUpdate()} onClose={() => setPackageOpen(false)} onInstalled={(server) => {
                  replaceList([...current().filter((each) => each.name !== server.name), server].sort((a, b) => a.name.localeCompare(b.name)))
                  setPackageOpen(false)
                }} />
              </Show>
              <Show when={reviewError()}><Alert>{reviewError()}</Alert></Show>
              <For each={reviews()}>{(review) => <CatalogueReview review={review} onApproved={() => void refreshReviews()} />}</For>
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
                    onTest={() => void test(name)} onToggle={(enabled) => toggle(server(), enabled)}
                    onUpdate={() => { setPackageUpdate(server()); setPackageOpen(true) }} />
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

function stableMcpJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableMcpJson).join(',')}]`
  if (value && typeof value === 'object') return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${stableMcpJson(item)}`).join(',')}}`
  return JSON.stringify(value)
}

export function CatalogueReview(props: { review: AgentMcpPendingReview; onApproved: () => void }) {
  const [busy, setBusy] = createSignal(false)
  const [error, setError] = createSignal('')
  const changes = createMemo(() => {
    const before = new Map(props.review.previousTools.map((tool) => [String(tool.name), tool]))
    const after = new Map(props.review.tools.map((tool) => [String(tool.name), tool]))
    return [
      ...props.review.tools.flatMap((tool) => {
        const name = String(tool.name)
        const prior = before.get(name)
        return !prior ? [{ name, status: 'Added', tool }] : stableMcpJson(prior) !== stableMcpJson(tool) ? [{ name, status: 'Changed', tool }] : []
      }),
      ...props.review.previousTools.flatMap((tool) => after.has(String(tool.name)) ? [] : [{ name: String(tool.name), status: 'Removed', tool }]),
    ]
  })
  const approve = async () => {
    setBusy(true); setError('')
    try { await approveAgentMcpReview(props.review); props.onApproved() }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'The catalogue changed. Refresh the review.') }
    finally { setBusy(false) }
  }
  return <SettingsSection id={`review-${props.review.sessionId}-${props.review.name}`} label={`Review ${props.review.name} tools`}
    description={`Actual session connection ${props.review.sessionId}. Catalogue SHA-256: ${props.review.digest}. Calls remain blocked until approval.`}>
    <Stack gap="stack">
      <Show when={error()}><Alert>{error()}</Alert></Show>
      <For each={props.review.findings}>{(finding) => <Alert tone="warn">{finding.tool}: {finding.detail} ({finding.category}). Review the declaration in context.</Alert>}</For>
      <Show when={!changes().length}><Text>{props.review.previousTools.length ? 'A redacted field or tool ordering changed.' : `First review: ${props.review.tools.length} tools.`}</Text></Show>
      <For each={changes()}>{(change) => <Stack gap="stack">
        <Text>{change.status}: {change.name}</Text>
        <CodeBlock wrap maxHeight="block">{JSON.stringify(change.tool, null, 2)}</CodeBlock>
      </Stack>}</For>
      <Button tone="accent" variant="solid" busy={busy()} onPress={() => void approve()}>Approve these tool definitions</Button>
      <Text>Codex may keep its initial empty tool list after approval. Start a new managed session to use approved tools if they remain absent.</Text>
    </Stack>
  </SettingsSection>
}

function PackageInstaller(props: { existing: string[]; updating: AgentMcpServer | null; onClose: () => void; onInstalled: (server: AgentMcpServer) => void }) {
  const [name, setName] = createSignal(props.updating?.name ?? '')
  const [coordinate, setCoordinate] = createSignal(props.updating?.managed ? `${props.updating.managed.package}@${props.updating.managed.version}` : '')
  const [exceptionText, setExceptionText] = createSignal('')
  const [plan, setPlan] = createSignal<AgentMcpPackagePlan | null>(null)
  const [packageTest, setPackageTest] = createSignal<AgentMcpPackageTest | null>(null)
  const [bin, setBin] = createSignal('')
  const [busy, setBusy] = createSignal(false)
  const [error, setError] = createSignal('')
  const prepare = async () => {
    const nameError = validateAgentMcpServerName(name())
    if (nameError) return setError(nameError)
    if (props.existing.includes(name()) && props.updating?.name !== name()) return setError('A server with that name already exists.')
    setBusy(true); setError('')
    try {
      const exceptions = exceptionText().split('\n').map((line) => line.trim()).filter(Boolean).map((line) => {
        const separator = line.indexOf(' | ')
        if (separator < 0) throw new Error('Write each exception as package@version | reason.')
        return { coordinate: line.slice(0, separator).trim(), reason: line.slice(separator + 3).trim() }
      })
      const next = await planAgentMcpPackage(coordinate(), name(), props.updating?.revision ?? null, exceptions)
      setPlan(next)
      setPackageTest(null)
      if (next.bins.length === 1) setBin(next.bins[0]!)
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'The package could not be planned.') }
    finally { setBusy(false) }
  }
  const testPlan = async () => {
    const selected = plan()
    if (!selected || !bin()) return setError('Choose the executable to test.')
    const approved = await confirmAction({
      title: `Test ${selected.package}@${selected.version}`,
      actionLabel: 'Run package test',
      goes: `Execute the staged ${bin()} program as local code and contact its MCP server. ${props.updating ? 'The previous program also runs for a catalogue comparison.' : ''} Credential names: ${props.updating?.values.filter((value) => value.secret).map((value) => value.name).join(', ') || 'none'}.`,
      stays: 'The selected package and running sessions.',
    })
    if (!approved) return
    setBusy(true); setError('')
    try { setPackageTest(await testAgentMcpPackagePlan(name(), selected.id, bin())) }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'The staged package test failed.') }
    finally { setBusy(false) }
  }
  const activate = async () => {
    const selected = plan()
    if (!selected || !bin() || !packageTest()) return setError('Test the selected binary and review its tool declarations before activation.')
    const approved = await confirmAction({
      title: `Install ${selected.package}@${selected.version}`,
      actionLabel: 'Install and enable',
      goes: `The exact package graph from ${selected.registry} is selected. New sessions can execute ${bin()} as local code. ${props.updating ? 'The previous version stays selected until this activation succeeds.' : ''} Declared credential names: ${props.updating?.values.filter((value) => value.secret).map((value) => value.name).join(', ') || 'none'}.`,
      stays: 'Your other MCP servers and running sessions.',
    })
    if (!approved) return
    setBusy(true); setError('')
    try { props.onInstalled(await activateAgentMcpPackage(name(), selected.id, bin(), props.updating)) }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'The package could not be activated.') }
    finally { setBusy(false) }
  }
  return <SettingsSection id="package" label="Install an MCP package" description="Install an exact npm version with scripts disabled. Packages published within seven days are refused.">
    <Stack gap="stack">
      <Field label="Server name"><Input value={name()} onInput={setName} disabled={!!props.updating} placeholder="docs" /></Field>
      <Field label="Package and exact version"><Input value={coordinate()} onInput={(value) => { setCoordinate(value); setPlan(null) }} placeholder="@example/mcp@1.2.3" /></Field>
      <Field label="Publication exceptions" hint="Optional. For a recent version or missing publication evidence, write exact package@version | reason, one per line. The exception is saved with the installed graph.">
        <Textarea mono rows={2} value={exceptionText()} onInput={(value) => { setExceptionText(value); setPlan(null) }} />
      </Field>
      <Show when={error()}><Alert>{error()}</Alert></Show>
      <Show when={plan()}>
        {(ready) => <>
          <Text wrap>{ready().graph.length} locked packages from {ready().registry}. Lock SHA-256: {ready().lockDigest}.</Text>
          <Text wrap>Installed tree SHA-256: {ready().treeDigest}.</Text>
          <Text wrap>Installer: {ready().installer}. Runtime: {ready().runtime}.</Text>
          <For each={ready().exceptions}>{(exception) => <Alert tone="warn">Publication exception: {exception.coordinate}. Reason: {exception.reason}</Alert>}</For>
          <For each={ready().graph}>{(entry) => <Text wrap>{entry.name}@{entry.version} · {entry.publishedAt} · {entry.resolved}</Text>}</For>
          <Show when={props.updating?.managed}>{(prior) => <Text wrap>Previously selected: {prior().package}@{prior().version}, lock {prior().lockDigest}. Compare the full graph above before activating.</Text>}</Show>
          <Field label="Executable" group hint="Choose the declared binary. Activation runs this file with the Node runtime.">
            <SegmentedControl ariaLabel="Executable" value={bin()} options={ready().bins.map((value) => ({ value, label: value }))} onChange={(value) => { setBin(value); setPackageTest(null) }} />
          </Field>
        </>}
      </Show>
      <Show when={packageTest()}>{(tested) => <>
        <Text wrap>Staged catalogue SHA-256: {tested().digest}. {tested().tools.length} tools. The actual session connection is reviewed separately when review is enabled.</Text>
        <For each={tested().findings}>{(finding) => <Alert tone="warn">{finding.tool}: {finding.detail} ({finding.category}).</Alert>}</For>
        <For each={tested().tools}>{(tool) => <Fold label={`${String(tool.name)} ${(() => {
          const old = tested().previousTools.find((item) => item.name === tool.name)
          return !old ? 'added' : stableMcpJson(old) !== stableMcpJson(tool) ? 'changed' : 'retained'
        })()}`} defaultOpen={false}>
          <Show when={tested().previousTools.find((item) => item.name === tool.name && stableMcpJson(item) !== stableMcpJson(tool))}>{(old) => <CodeBlock wrap maxHeight="block">Before: {JSON.stringify(old(), null, 2)}</CodeBlock>}</Show>
          <CodeBlock wrap maxHeight="block">{JSON.stringify(tool, null, 2)}</CodeBlock>
        </Fold>}</For>
        <For each={tested().previousTools.filter((old) => !tested().tools.some((tool) => tool.name === old.name))}>{(old) => <Text>Removed: {String(old.name)}</Text>}</For>
      </>}</Show>
      <Inline gap="row">
        <Show when={!plan()} fallback={<>
          <Button variant="ghost" busy={busy()} onPress={() => void testPlan()}>Test staged package (runs code)</Button>
          <Show when={packageTest()}><Button tone="accent" variant="solid" busy={busy()} onPress={() => void activate()}>{props.updating ? 'Activate update' : 'Install and enable'}</Button></Show>
        </>}>
          <Button tone="accent" variant="solid" busy={busy()} onPress={() => void prepare()}>Review package graph</Button>
        </Show>
        <Button variant="ghost" onPress={props.onClose}>Cancel</Button>
      </Inline>
    </Stack>
  </SettingsSection>
}

function ServerRow(props: {
  server: AgentMcpServer
  test: TestState | undefined
  onEdit: () => void
  onTest: () => void
  onToggle: (enabled: boolean) => Promise<void>
  onUpdate: () => void
}) {
  const enabled = createSettingSave()
  const server = () => props.server
  return (
    <>
      <SettingRow
        label={server().name}
        description={consentSource(server())}
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
          <Button size="sm" variant="ghost" label={`Test ${server().name}`} busy={props.test?.testing} onPress={props.onTest}>{server().transport === 'stdio' ? 'Test (runs code)' : 'Test (contacts server)'}</Button>
          <Show when={server().managed}><Button size="sm" variant="ghost" onPress={props.onUpdate}>Update package</Button></Show>
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
            <Field label="Command" hint={props.draft.managed ? 'The selected package owns this executable. Use Update package to change it.' : 'A program on your PATH, or its full path.'}>
              <Input value={props.draft.command} disabled={!!props.draft.managed} placeholder="npx" onInput={(command) => props.onEdit({ command })} />
            </Field>
            <Field label="Arguments" hint="One per line.">
              <Textarea mono rows={3} value={props.draft.args} disabled={!!props.draft.managed} placeholder={'-y\n@example/mcp-server'} onInput={(args) => props.onEdit({ args })} />
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
          <Checkbox switch label="Review tool definition changes" checked={props.draft.reviewTools} onChange={(reviewTools) => props.onEdit({ reviewTools })} />
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
