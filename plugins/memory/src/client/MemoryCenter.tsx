import { useParams } from '@solidjs/router'
import { createMemo, createResource, createSignal, For, onCleanup, Show } from 'solid-js'
import { Alert, Badge, Button, Card, DetailColumn, EmptyState, Heading, Icon, Inline, Input, ListDetail, Stack, Text } from '@acorn/plugin-api/ui'
import { clientEvents, onPluginFrame } from '@acorn/plugin-api/client'
import { pluginChannel } from '@acorn/protocol/plugin/state.ts'
import { memoryApi } from './memoryClient'
import { highlightedFinding, clearHighlightedFinding } from './proposalTarget'
import FindingsBundleReview from './FindingsBundleReview'

export default function MemoryCenter() {
  const params = useParams()
  const [reviewSettings, { refetch: refetchReviewSettings }] = createResource(() => memoryApi().reviewSettings())
  onCleanup(onPluginFrame('findings', pluginChannel('findings', 'settings-changed'), () => void refetchReviewSettings()))
  const [memories, { refetch: refetchMemories }] = createResource(
    () => params.projectId ?? '',
    async (projectId) => {
      const rows = await memoryApi().list(projectId || undefined)
      return 'error' in rows ? [] : rows
    },
    { initialValue: [] },
  )
  // The highlight belongs to one arrival from the bell, not to the page.
  onCleanup(clearHighlightedFinding)
  const [filter, setFilter] = createSignal('')
  // Filtered on the device rather than through the node's index: this is a list already in hand, and
  // the full-text search is a separate question the palette's "Search memory" answers.
  const shown = createMemo(() => {
    const needle = filter().trim().toLowerCase()
    if (!needle) return memories()
    return memories().filter((memory) =>
      memory.name.toLowerCase().includes(needle) || memory.description.toLowerCase().includes(needle))
  })

  // No `list` on the split, so it draws one full-width column: this page has nothing to put beside its
  // content, and `DetailColumn scroll` makes the whole page one scroll region. Agent Center is the
  // same shape.
  return (
    <ListDetail>
      <DetailColumn scroll>
        <Stack gap="section">
          <Stack gap="row">
            <Heading level={1}>Memory</Heading>
            <Text emphasis="muted">Durable knowledge and suggestions distilled from completed tasks.</Text>
          </Stack>
          <Show when={reviewSettings() && (!reviewSettings()!.backendId || !reviewSettings()!.targetId)}>
            <Alert tone="warn" title="Configure memory review">
              Closing a task will keep its evidence, but suggestions need a review model and target.
              <Button size="sm" onPress={() => clientEvents.emit('presentation:open-settings', { tab: 'findings-settings' })}>Open review settings</Button>
            </Alert>
          </Show>
          <FindingsBundleReview focusCandidateId={highlightedFinding()} scope={params.projectId ? { kind: 'project', projectId: params.projectId } : { kind: 'private' }} onChanged={() => void refetchMemories()} />
          <Stack gap="row">
            <Heading level={2}>Memories</Heading>
            <Input label="Filter memories" placeholder="Filter by name or description…" value={filter()} onInput={setFilter} />
            <Show
              when={shown().length}
              fallback={(
                <EmptyState icon={<Icon name="brain" />} title={memories().length ? 'Nothing matches that filter.' : 'No memories yet.'}>
                  <Show when={!memories().length}>
                    Agents propose these as they work, and you can add one by hand from a task's Context pane.
                  </Show>
                </EmptyState>
              )}
            >
              <For each={shown()}>
                {(memory) => (
                  <Card>
                    <Stack gap="row">
                      <Inline gap="inline" wrap>
                        <Badge shape="pill">{memory.type}</Badge>
                        <Text emphasis="strong">{memory.name}</Text>
                        <Show when={memory.scope === 'private'}><Badge tone="warn" shape="pill">private</Badge></Show>
                      </Inline>
                      <Text>{memory.description}</Text>
                      <Text emphasis="muted">{memory.path}</Text>
                    </Stack>
                  </Card>
                )}
              </For>
            </Show>
          </Stack>
        </Stack>
      </DetailColumn>
    </ListDetail>
  )
}
