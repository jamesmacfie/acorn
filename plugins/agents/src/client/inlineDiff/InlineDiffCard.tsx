import { createEffect, createMemo, createResource, createSignal, Index, onCleanup, Show } from 'solid-js'
import { createQuery, useQueryClient } from '@tanstack/solid-query'
import { Alert, Button, Card, Inline, Select, Stack, Text, Textarea } from '@acorn/plugin-api/ui'
import type { AgentConfigOption, AgentNormalizedEvent, AgentProviderDescriptor } from '../../contract/wire.ts'
import { sameInlineLine, type InlineDiffOrigin } from '../../contract/inlineDiff.ts'
import { defaultAgentSessionDefaults } from '../../shared/sessionDefaults.ts'
import { agentSessionDefaultsOptions, writeAgentSessionDefaults } from '../settings/sessionDefaultsClient.ts'
import { managedAgentApi } from '../sessions/managedClient.ts'
import { managedAgentStore } from '../sessions/managedStore.ts'
import { buildConversationItems, isChatItem, visibleConversationItems } from '../sessions/conversationItems.ts'
import { openManagedSession } from '../sessions/managedSelection.ts'
import AgentEventCard from '../sessions/AgentEventCard.tsx'
import RuntimeStateIcon from '../sessions/RuntimeStateIcon.tsx'

type Props = { origin: InlineDiffOrigin; loadContext: () => Promise<string>; onClose?: () => void }

// The thread's "chats only" view, drawn by the thread's own cards: messages, and the agent's questions
// so they can be answered here. The reader's turn is cut back to the question they typed: the line
// context and read-only instruction are for the agent.
const chatItems = (items: ReturnType<typeof buildConversationItems>) => items.filter(isChatItem).map((item) => {
  if (item.event.type !== 'user_message') return item
  const text = item.event.text.split('\n\nQuestion:\n').at(-1)!
    .replace(/^Please answer without changing files or running write commands\.\n\n/, '')
  return { ...item, event: { ...item.event, text } }
})

// Which chats the reader has folded away, by session. Held outside the card because the diff drops a
// line's block when it scrolls out of view, and a fold that reopened on the way back would be lost.
const [collapsedChats, setCollapsedChats] = createSignal(new Set<string>())
const setChatCollapsed = (id: string, collapsed: boolean) => setCollapsedChats((previous) => {
  const next = new Set(previous)
  if (collapsed) next.add(id)
  else next.delete(id)
  return next
})

export default function InlineDiffCard(props: Props) {
  const queryClient = useQueryClient()
  const [sessionId, setSessionId] = createSignal<string | null>(null)
  const [draft, setDraft] = createSignal('')
  const [busy, setBusy] = createSignal(false)
  const [error, setError] = createSignal('')
  const [access, setAccess] = createSignal<'read-only' | 'full'>('read-only')
  const [providerOverride, setProviderOverride] = createSignal<string | null>(null)
  const [modelOverride, setModelOverride] = createSignal<string | null>(null)
  const [pendingAttempt, setPendingAttempt] = createSignal<{ question: string; createKey: string; sendKey: string; prompt?: string } | null>(null)

  const matches = createMemo(() => managedAgentStore.sessionsForTask(props.origin.taskId)
    .filter((session) => session.origin && sameInlineLine(session.origin, props.origin) && !session.archivedAt)
    .sort((a, b) => b.createdAt - a.createdAt))
  const session = createMemo(() => sessionId() === 'new' ? undefined : matches().find((item) => item.id === sessionId()) ?? matches()[0])
  const defaults = createQuery(() => ({ ...agentSessionDefaultsOptions(), enabled: !session() }))
  const [providers] = createResource(() => session() ? undefined : 'new', () => managedAgentApi.providers())
  const [recent] = createResource(() => session() ? undefined : 'new', () => managedAgentApi.sessions({}))
  const snapshot = createMemo(() => session() ? managedAgentStore.snapshots()[session()!.id] : undefined)
  const requestsById = createMemo(() => new Map((snapshot()?.requests ?? []).map((request) => [request.providerRequestId, request])))
  const conversation = createMemo(() => chatItems(visibleConversationItems(
    buildConversationItems(snapshot()?.events ?? []), (requestId) => requestsById().get(requestId))))
  const collapsed = () => !!session() && collapsedChats().has(session()!.id)
  // A persisted query can contain defaults from before inline choices existed. The node normalizes
  // stored preferences, but the restored client cache is visible before that response arrives.
  const record = () => {
    const current = defaults.data
    const fallback = defaultAgentSessionDefaults()
    return {
      ...fallback,
      ...current,
      inline: {
        providerId: current?.inline?.providerId ?? fallback.inline.providerId,
        pinned: current?.inline?.pinned ?? fallback.inline.pinned,
      },
    }
  }
  const installed = createMemo(() => (providers() ?? []).filter((provider) => provider.installed))
  const provider = createMemo(() => {
    const id = providerOverride() ?? record().inline.providerId
    return installed().find((candidate) => candidate.id === id) ?? installed()[0]
  })
  const advertised = createMemo(() => {
    const id = provider()?.id
    const candidate = recent()?.sessions.find((item) => item.providerId === id && Array.isArray(item.config.configOptions))
    return candidate?.config.configOptions as AgentConfigOption[] | undefined
  })
  const modelOption = createMemo(() => advertised()?.find((option) => option.category === 'model'))
  const model = createMemo(() => modelOverride() ?? record().inline.pinned[provider()?.id ?? '']?.[modelOption()?.id ?? 'model'] ?? '')
  const readonlyProfile = createMemo(() => advertised()?.find((option) => option.category === 'permission')
    ?.values.find((value) => /read.?only/i.test(`${value.value} ${value.label} ${value.description ?? ''}`)))

  createEffect(() => {
    const id = session()?.id
    if (!id) return
    onCleanup(managedAgentStore.hold(id))
    void managedAgentStore.loadSnapshot(id).catch(() => undefined)
  })

  const saveInlineChoices = async (chosen: AgentProviderDescriptor, modelValue: string) => {
    const current = record()
    const pinned = { ...current.inline.pinned, [chosen.id]: { ...current.inline.pinned[chosen.id] } }
    if (modelOption() && modelValue) pinned[chosen.id]![modelOption()!.id] = modelValue
    await writeAgentSessionDefaults(queryClient, current, { inline: { providerId: chosen.id, pinned } })
  }

  const submit = async () => {
    const question = draft().trim()
    if (!question || busy()) return
    setBusy(true)
    setError('')
    try {
      const attempt = pendingAttempt()?.question === question ? pendingAttempt()! : {
        question, createKey: crypto.randomUUID(), sendKey: crypto.randomUUID(),
      }
      setPendingAttempt(attempt)
      let target = session()
      if (!target) {
        const chosen = provider()
        if (!chosen) throw new Error('No agent provider is installed.')
        const values = { ...record().inline.pinned[chosen.id] }
        if (modelOption() && model()) values[modelOption()!.id] = model()
        const permission = advertised()?.find((option) => option.category === 'permission')
        if (access() === 'read-only' && readonlyProfile() && permission) values[permission.id] = readonlyProfile()!.value
        const origin = { ...props.origin, access: access() }
        target = await managedAgentStore.startInlineSession(props.origin.taskId, chosen, origin, values, attempt.createKey)
        setSessionId(target.id)
        void saveInlineChoices(chosen, model()).catch(() => undefined)
      }
      let prompt = attempt.prompt
      if (!prompt) {
        const current = await managedAgentApi.snapshot(target.id)
        const firstTurn = current.turns.length === 0
        const context = firstTurn ? await props.loadContext().catch(() => props.origin.quote) : ''
        const instruction = target.origin?.access === 'read-only' ? 'Please answer without changing files or running write commands.\n\n' : ''
        prompt = firstTurn
          ? `Question about ${props.origin.path}:${props.origin.line} (${props.origin.side} side, patch ${props.origin.patchKey}):\n\n${context}\n\n${instruction}Question:\n${question}`
          : `${instruction}${question}`
        setPendingAttempt({ ...attempt, prompt })
      }
      await managedAgentApi.enqueue(target.id, { input: [{ type: 'text', text: prompt }], source: 'interactive', effectivePolicy: {} }, attempt.sendKey)
      setDraft('')
      setPendingAttempt(null)
      void managedAgentStore.loadSnapshot(target.id).catch(() => undefined)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not send the question.')
    } finally {
      setBusy(false)
    }
  }

  return <Card pad="sm"><Stack gap="row">
      <Inline gap="inline" spread>
        <Inline gap="inline">
          <Show when={session()}>{(current) => <RuntimeStateIcon state={current().runtimeState} queued={current().queuedTurns} />}</Show>
          <Text emphasis="strong">Ask agent · {props.origin.path}:{props.origin.line}</Text>
          <Show when={session()}>{(current) => <Text emphasis="muted">{current().runtimeState}</Text>}</Show>
        </Inline>
        <Show when={props.onClose && !session()}><Button size="sm" onPress={() => props.onClose?.()}>Close</Button></Show>
        <Show when={session()}>{(current) => <Button size="sm" onPress={() => setChatCollapsed(current().id, !collapsed())}>
          {collapsed() ? 'Show' : 'Hide'}
        </Button>}</Show>
      </Inline>
      <Show when={!collapsed()}>
        {/* Index, not For: every snapshot rebuilds the items, and For would remount each card on it. */}
        <Index each={conversation()}>{(item) => <AgentEventCard
          item={item()}
          taskId={props.origin.taskId}
          sessionId={session()?.id ?? ''}
          request={item().event.type === 'request' ? requestsById().get((item().event as Extract<AgentNormalizedEvent, { type: 'request' }>).requestId) : undefined}
          onRequestResolved={() => { void managedAgentStore.loadSnapshot(session()!.id).catch(() => undefined) }}
        />}</Index>
        <Show when={!session()}>
          <Inline gap="inline" wrap>
            <Select label="Provider" size="sm" value={provider()?.id ?? ''}
              options={installed().map((item) => ({ value: item.id, label: item.label }))}
              onChange={setProviderOverride} />
            <Show when={modelOption()}>{(option) => <Select label="Model" size="sm" value={model()}
              options={[{ value: '', label: 'Provider default' }, ...option().values.map((value) => ({ value: value.value, label: value.label }))]}
              onChange={setModelOverride} />}</Show>
            <Select label="Access" size="sm" value={access()} options={[{ value: 'read-only', label: 'Read only' }, { value: 'full', label: 'Full access' }]}
              onChange={(value) => setAccess(value as 'read-only' | 'full')} />
          </Inline>
          <Show when={access() === 'read-only' && !readonlyProfile()}><Text emphasis="muted" wrap>Read only is best effort with this provider.</Text></Show>
        </Show>
        <Textarea label="Ask agent" size="sm" rows={3} value={draft()} onInput={setDraft}
          onCommit={() => void submit()} placeholder="Ask about this change…" />
        <Inline gap="inline">
          <Button size="sm" disabled={busy() || !draft().trim()} onPress={() => void submit()}>{busy() ? 'Sending…' : 'Send'}</Button>
          <Show when={session()}>{(current) => <>
            <Button size="sm" onPress={() => openManagedSession(props.origin.taskId, current().id)}>Open in Agents</Button>
            <Button size="sm" onPress={() => { setSessionId('new'); setDraft(''); setPendingAttempt(null) }}>New chat</Button>
          </>}</Show>
        </Inline>
        <Show when={error()}>{(message) => <Alert tone="warn">{message()}</Alert>}</Show>
      </Show>
  </Stack></Card>
}
