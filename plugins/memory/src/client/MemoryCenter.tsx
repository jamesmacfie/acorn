import { createQuery } from '@tanstack/solid-query'
import { useParams } from '@solidjs/router'
import { createMemo, createResource, createSignal, For, onCleanup, Show } from 'solid-js'
import { Alert, Badge, Button, CodeBlock, DetailColumn, EmptyState, Heading, Icon, Inline, Input, ListDetail, Row, Stack, Text } from '@acorn/plugin-api/ui'
import { clientEvents, onPluginFrame, tasksOptions } from '@acorn/plugin-api/client'
import { pluginChannel } from '@acorn/protocol/plugin/state.ts'
import { MEMORY_SCOPE_LABEL, MEMORY_TYPE_LABEL, memoryApi } from './memoryClient'
import { highlightedFinding, clearHighlightedFinding } from './proposalTarget'
import FindingsBundleReview from './FindingsBundleReview'
import MemoryAddForm from './MemoryAddForm'
import { selectedMemory, selectMemory } from './memorySelection'

export default function MemoryCenter() {
  const params = useParams()
  // Rail sources can open while the URL still names a task rather than a project.
  const tasks = createQuery(() => tasksOptions(true))
  const task = () => tasks.data?.find((task) => task.id === params.taskId)
  const projectId = createMemo(() => params.projectId ?? task()?.projectId ?? undefined)
  const [reviewSettings, { refetch: refetchReviewSettings }] = createResource(() => memoryApi().reviewSettings())
  onCleanup(onPluginFrame('findings', pluginChannel('findings', 'settings-changed'), () => void refetchReviewSettings()))
  const [memories, { refetch: refetchMemories }] = createResource(
    () => projectId() ?? '',
    async (projectId) => {
      const rows = await memoryApi().list(projectId || undefined)
      return 'error' in rows ? [] : rows
    },
    { initialValue: [] },
  )
  onCleanup(onPluginFrame('memory', pluginChannel('memory', 'memories-changed'), () => void refetchMemories()))
  const selected = createMemo(() => memories().find((row) => row.name === selectedMemory()?.name && row.scope === selectedMemory()?.scope))
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
  // same shape. `measure="page"` stops it at the page width, so a wide window does not stretch it.
  return (
    <ListDetail>
      <DetailColumn scroll measure="page">
        <Stack gap="section">
          <Heading level={1} help="Durable memory shared by your agents, and suggestions from finished tasks.">Memory</Heading>
          <Show when={reviewSettings() && (!reviewSettings()!.backendId || !reviewSettings()!.targetId)}>
            <Alert
              tone="warn"
              title="Configure memory review"
              actions={<Button size="sm" onPress={() => clientEvents.emit('presentation:open-settings', { tab: 'findings-settings' })}>Open review settings</Button>}
            >
              To get suggestions, choose a review model and where they go.
            </Alert>
          </Show>
          <FindingsBundleReview focusCandidateId={highlightedFinding()} scope={projectId() ? { kind: 'project', projectId: projectId()! } : { kind: 'private' }} onChanged={() => void refetchMemories()} />
          <Stack gap="row">
            <MemoryAddForm task={task()} projectId={projectId()} onChanged={() => void refetchMemories()} />
            <Show when={selected()}>{(memory) => <Stack gap="row">
              <Heading level={2}>{memory().name}</Heading>
              <Text>{memory().description}</Text>
              <CodeBlock wrap maxHeight="block">{memory().body}</CodeBlock>
            </Stack>}</Show>
            <Heading level={2}>Memories</Heading>
            {/* Only when there is something to narrow. */}
            <Show when={memories().length}>
              <Input kind="filter" size="sm" label="Filter memories" placeholder="Filter memories…" value={filter()} onInput={setFilter} />
            </Show>
            <Show
              when={shown().length}
              fallback={(
                <EmptyState icon={<Icon name="brain" />} title={memories().length ? 'No memories match' : 'No memories yet'}>
                  <Show when={!memories().length}>
                    Agents save memories as they work. Use Add memory to save one yourself.
                  </Show>
                </EmptyState>
              )}
            >
              {/* Filename selection opens the full body; the path locates the backing Markdown file. */}
              <Stack gap="none">
                <For each={shown()}>
                  {(memory) => (
                    <Row
                      variant="stacked"
                      label={memory.name}
                      meta={(
                        <Inline gap="inline">
                          <Badge size="xs">{MEMORY_TYPE_LABEL[memory.type] ?? memory.type}</Badge>
                          <Badge size="xs">{MEMORY_SCOPE_LABEL[memory.scope]}</Badge>
                        </Inline>
                      )}
                    >
                      <Button variant="bare" onPress={() => selectMemory({ name: memory.name, scope: memory.scope })}>{memory.name}</Button>
                      <Text wrap>{memory.description}</Text>
                      <Text emphasis="mono" tone="muted">{memory.path}</Text>
                    </Row>
                  )}
                </For>
              </Stack>
            </Show>
          </Stack>
        </Stack>
      </DetailColumn>
    </ListDetail>
  )
}
