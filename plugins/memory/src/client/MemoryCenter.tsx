import { createQuery } from '@tanstack/solid-query'
import { useParams } from '@solidjs/router'
import { createMemo, createSignal, For, onCleanup, Show } from 'solid-js'
import { Alert, Badge, Button, DetailColumn, EmptyState, Heading, Icon, Inline, Input, ListDetail, Row, Stack, Text } from '@acorn/plugin-api/ui'
import { onPluginFrame, tasksOptions } from '@acorn/plugin-api/client'
import { pluginChannel } from '@acorn/protocol/plugin/state.ts'
import { MEMORY_SCOPE_LABEL, MEMORY_TYPE_LABEL, memoryApi } from './memoryClient'
import { createMemoryResource } from './memoryResource'
import MemoryAddForm from './MemoryAddForm'
import MemoryDetail from './MemoryDetail'
import MemoryFeed from './MemoryFeed'
import MemoryContext from './MemoryContext'
import MemoryImport from './MemoryImport'
import { selectedMemory, selectMemory } from './memorySelection'
import type { MemoryAddress } from '../shared/api'

export default function MemoryCenter() {
  const params = useParams()
  const tasks = createQuery(() => tasksOptions(true))
  const task = () => tasks.data?.find((task) => task.id === params.taskId)
  const projectId = createMemo(() => params.projectId ?? task()?.projectId ?? undefined)
  const [revision, setRevision] = createSignal(0)
  const changed = () => setRevision((value) => value + 1)
  const [filter, setFilter] = createSignal('')
  const { value: memories, error: loadError } = createMemoryResource(() => [projectId(), revision(), filter()] as const, async ([projectId, , filter]) => {
    const rows = filter.trim() ? await memoryApi().search(filter, projectId) : await memoryApi().list(projectId)
    if ('error' in rows) throw new Error(rows.error)
    return rows.sort((a, b) => b.updatedAt - a.updatedAt || a.name.localeCompare(b.name))
  }, [])
  onCleanup(onPluginFrame('memory', pluginChannel('memory', 'memories-changed'), changed))
  const address = createMemo<MemoryAddress | undefined>(() => {
    const selected = selectedMemory()
    return selected && (selected.scope === 'private' || selected.scope === 'project')
      ? { name: selected.name, scope: selected.scope, projectId: selected.scope === 'project' ? projectId() ?? null : null } : undefined
  })
  return <ListDetail>
    <DetailColumn scroll measure="page">
      <Stack gap="section">
        <Heading level={1} help="Durable memory shared by your agents.">Memory</Heading>
        <MemoryFeed projectId={projectId()} revision={revision()} onChanged={changed} />
        <MemoryAddForm task={task()} projectId={projectId()} onChanged={changed} />
        <Show when={address()}>{(address) => <MemoryDetail address={address()} row={memories().find((row) => row.name === address().name && row.scope === address().scope)} projectId={projectId()} revision={revision()} onChanged={(next) => { if (next) selectMemory(next); changed() }} />}</Show>
        <Stack gap="row">
          <Heading level={2}>Memories</Heading>
          <Input kind="filter" size="sm" label="Filter memories" placeholder="Search names, descriptions, and bodies…" value={filter()} onInput={setFilter} />
          <Show when={loadError()}><Alert>{String(loadError())}</Alert></Show>
          <Show when={memories().length} fallback={<EmptyState icon={<Icon name="brain" />} title={filter() ? 'No memories match' : 'No memories yet'}>Agents save memories as they work. Use Add memory to save one yourself.</EmptyState>}>
            <For each={['project', 'private'] as const}>{(scope) => <Show when={memories().some((memory) => memory.scope === scope)}>
              <Stack gap="row">
                <Heading level={3}>{MEMORY_SCOPE_LABEL[scope]}</Heading>
                <For each={memories().filter((memory) => memory.scope === scope)}>{(memory) => <Row variant="stacked" label={memory.name} meta={<Inline gap="inline"><Badge size="xs">{MEMORY_TYPE_LABEL[memory.type] ?? memory.type}</Badge></Inline>}>
                  <Button variant="bare" onPress={() => selectMemory({ name: memory.name, scope: memory.scope })}>{memory.name}</Button>
                  <Text wrap>{memory.description}</Text>
                </Row>}</For>
              </Stack>
            </Show>}</For>
          </Show>
        </Stack>
        <MemoryContext projectId={projectId()} revision={revision()} onChanged={changed} />
        <Show when={projectId()}>{(id) => <MemoryImport projectId={id()} onChanged={changed} />}</Show>
      </Stack>
    </DetailColumn>
  </ListDetail>
}
