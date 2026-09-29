import { createQuery, useQueryClient } from '@tanstack/solid-query'
import { createEffect, createMemo, createSignal, For, on, Show } from 'solid-js'
import { clientEvents } from '@acorn/plugin-api/client'
import { Alert, Badge, Button, Card, Checkbox, IconButton, Inline, Section, Stack, Text } from '@acorn/plugin-api/ui'
import { RESERVED_MCP_SERVER_NAMES, type AgentMcpReportedServer } from '../../shared/mcpServers'
import { managedAgentApi } from './managedClient'

// While the panel is open. A harness reports a server's start as it happens, so a server that was
// connecting a moment ago has usually finished by the next read.
const POLL_MS = 3_000

const STATUS_TONE: Record<string, 'ok' | 'warn' | 'danger' | 'neutral'> = {
  connected: 'ok',
  starting: 'neutral',
  needs_auth: 'warn',
  failed: 'danger',
}
const STATUS_LABEL: Record<string, string> = { needs_auth: 'needs sign-in', unknown: 'not reported' }

// What `/mcp` opens (docs/mcp.md § Your own servers): this session's switches over the servers in
// Settings → MCP servers, and whatever the harness itself reports.
export default function AgentMcpPanel(props: { sessionId: string; onClose: () => void }) {
  const queryClient = useQueryClient()
  const queryKey = () => ['agents', 'session-mcp', props.sessionId] as const
  const mcp = createQuery(() => ({
    queryKey: queryKey(),
    queryFn: () => managedAgentApi.mcp(props.sessionId),
    refetchInterval: POLL_MS,
  }))
  // The switches are a draft until Apply, because every apply restarts the agent once.
  const [selected, setSelected] = createSignal<ReadonlySet<string>>(new Set())
  const [applying, setApplying] = createSignal(false)
  const [error, setError] = createSignal('')
  const stored = createMemo(() => new Set((mcp.data?.servers ?? []).filter((server) => server.enabled).map((server) => server.name)))
  // Reseeded when the stored list changes, not on every poll, so a switch the reader just flipped is not
  // put back by the next read. A memo of the names, because `on()` re-runs whenever its source does and
  // only a memo compares the value.
  const storedKey = createMemo(() => [...stored()].sort().join('\n'))
  createEffect(on(storedKey, () => setSelected(stored())))
  const changed = () => {
    const now = selected()
    const before = stored()
    return now.size !== before.size || [...now].some((name) => !before.has(name))
  }

  const apply = async () => {
    setApplying(true)
    setError('')
    try {
      queryClient.setQueryData(queryKey(), await managedAgentApi.setMcp(props.sessionId, [...selected()]))
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The servers could not be changed.')
    } finally {
      setApplying(false)
    }
  }

  const acorns = (name: string) => RESERVED_MCP_SERVER_NAMES.has(name)
  const reported = () => mcp.data?.reported ?? null

  return (
    <Section
      label="MCP servers"
      actions={<IconButton icon="x" label="Close MCP servers" onPress={props.onClose} />}
    >
      <Stack gap="row">
        <Show when={mcp.error}>
          <Alert>{mcp.error instanceof Error ? mcp.error.message : 'MCP servers could not be loaded.'}</Alert>
        </Show>
        <Show when={mcp.data?.locked}>{(reason) => <Alert tone="muted">{reason()}</Alert>}</Show>
        <Show when={error()}><Alert>{error()}</Alert></Show>

        <Card pad="sm">
          <Stack gap="inline">
            <Show
              when={mcp.data?.servers.length}
              fallback={<Text emphasis="muted" wrap>You have not added any servers in Settings → MCP servers.</Text>}
            >
              <For each={mcp.data?.servers ?? []}>
                {(server) => (
                  <Checkbox
                    switch
                    size="sm"
                    label={server.name}
                    checked={selected().has(server.name)}
                    disabled={!!mcp.data?.locked || applying()}
                    onChange={(on) => setSelected((before) => {
                      const next = new Set(before)
                      if (on) next.add(server.name)
                      else next.delete(server.name)
                      return next
                    })}
                  />
                )}
              </For>
            </Show>
            <Inline spread>
              <Button
                variant="bare"
                size="sm"
                onPress={() => clientEvents.emit('presentation:open-settings', { tab: 'agent-mcp-servers' })}
              >
                Manage servers
              </Button>
              <Show when={changed()}>
                <Button size="sm" tone="accent" variant="solid" busy={applying()} disabled={!!mcp.data?.locked} onPress={() => void apply()}>
                  Apply and restart the agent
                </Button>
              </Show>
            </Inline>
          </Stack>
        </Card>

        <Show
          when={reported()}
          fallback={
            <Text emphasis="muted" wrap>
              This agent does not tell acorn which servers it has connected, so servers from its own config
              are not listed here. Settings → MCP config files shows them.
            </Text>
          }
        >
          {(servers) => (
            <Stack gap="inline">
              <Text emphasis="eyebrow">What the agent reports</Text>
              <For each={servers()}>
                {(server) => <ReportedRow server={server} acorn={acorns(server.name)} />}
              </For>
            </Stack>
          )}
        </Show>
      </Stack>
    </Section>
  )
}

function ReportedRow(props: { server: AgentMcpReportedServer; acorn: boolean }) {
  return (
    <Stack gap="none">
      <Inline>
        <Text>{props.server.name}</Text>
        <Badge size="xs" tone={STATUS_TONE[props.server.status] ?? 'neutral'}>
          {STATUS_LABEL[props.server.status] ?? props.server.status.replaceAll('_', ' ')}
        </Badge>
        <Show when={props.server.toolCount != null}>
          <Text emphasis="muted">{props.server.toolCount === 1 ? '1 tool' : `${props.server.toolCount} tools`}</Text>
        </Show>
        <Show when={props.acorn}><Text emphasis="muted">acorn's own tools</Text></Show>
      </Inline>
      <Show when={props.server.error}>{(detail) => <Text emphasis="muted" wrap>{detail()}</Text>}</Show>
    </Stack>
  )
}
