import { createQuery } from '@tanstack/solid-query'
import { useParams } from '@solidjs/router'
import { createEffect, createMemo, createSignal, For, Match, onCleanup, Show, Switch } from 'solid-js'
import { Button, EmptyState, Heading, Icon, Input, Row, Rows, SectionHeader, sidebarCollapsed, Stack, TabPanel, Tabs, Text, Toolbar } from '@acorn/plugin-api/ui'
import { formatRelativeTime, onPluginFrame, tasksOptions } from '@acorn/plugin-api/client'
import { pluginChannel } from '@acorn/protocol/plugin/state.ts'
import { MEMORY_SCOPE_LABEL, memoryApi } from './memoryClient'
import { createMemoryResource } from './memoryResource'
import MemoryAddForm from './MemoryAddForm'
import MemoryDetail from './MemoryDetail'
import MemoryFeed from './MemoryFeed'
import MemoryContext from './MemoryContext'
import MemoryImport from './MemoryImport'
import { addingMemory, memoriesChanged, memoryRevision, selectedMemory, selectMemory, setAddingMemory, setSelectedMemory } from './memorySelection'
import { MEMORY_SOURCE_ID, type MemoryAddress } from '../shared/api'

type Scope = 'project' | 'private'
const keyOf = (memory: { scope: string; name: string }) => `${memory.scope}:${memory.name}`
const initials = (name: string) => name.split(/[-_.]/).slice(0, 2).map((part) => part[0] ?? '').join('').toUpperCase()

// One frame subscription for both regions, so a change refetches once.
let watchers = 0
let unwatch: (() => void) | undefined
function watchMemoryChanges(): void {
  if (watchers++ === 0) unwatch = onPluginFrame('memory', pluginChannel('memory', 'memories-changed'), memoriesChanged)
  onCleanup(() => { if (--watchers === 0) unwatch?.() })
}

// The project both regions show: the routed one, or the routed task's.
function useMemoryScope() {
  watchMemoryChanges()
  const params = useParams()
  const tasks = createQuery(() => tasksOptions(true))
  const task = () => tasks.data?.find((task) => task.id === params.taskId)
  const projectId = createMemo(() => params.projectId ?? task()?.projectId ?? undefined)
  return { task, projectId }
}

/** The `list` region: this project's memories and the owner's private ones, newest first. */
export function MemoryList() {
  const { projectId } = useMemoryScope()
  const collapsed = sidebarCollapsed(MEMORY_SOURCE_ID)
  const [filter, setFilter] = createSignal('')
  // A collapsed rail shows every memory rather than keeping a filter whose box is out of sight.
  createEffect(() => { if (collapsed()) setFilter('') })
  const { value: memories, error, loaded, refetch } = createMemoryResource(() => [projectId(), memoryRevision(), filter()] as const, async ([projectId, , filter]) => {
    const rows = filter.trim() ? await memoryApi().search(filter, projectId) : await memoryApi().list(projectId)
    if ('error' in rows) throw new Error(rows.error)
    return rows.sort((a, b) => b.updatedAt - a.updatedAt || a.name.localeCompare(b.name))
  }, [])
  // Without a project there is only private memory, and no strip to choose it with.
  const scopes = (): Scope[] => projectId() ? ['project', 'private'] : ['private']
  const [tab, setTab] = createSignal<Scope>('project')
  const active = () => scopes().includes(tab()) ? tab() : 'private'
  // A memory opened from the palette or a transcript shows its own scope's list.
  createEffect(() => {
    const scope = selectedMemory()?.scope
    if (scope === 'project' || scope === 'private') setTab(scope)
  })
  const inScope = (scope: Scope) => memories().filter((memory) => memory.scope === scope)
  const open = (key: string) => {
    const memory = memories().find((memory) => keyOf(memory) === key)
    if (memory) selectMemory({ name: memory.name, scope: memory.scope })
  }
  const selectedKey = () => {
    const selected = selectedMemory()
    return selected ? keyOf(selected) : null
  }
  return <>
    <SectionHeader
      count={loaded() && !error() ? memories().length : undefined}
      actions={<Button size="sm" tip="New memory" onPress={() => { setSelectedMemory(undefined); setAddingMemory(true) }}><Icon name="plus" /> New</Button>}
    >
      Memories
    </SectionHeader>
    <Show when={!collapsed()}>
      <Show when={scopes().length > 1}>
        <Tabs
          idPrefix="memory-scope"
          ariaLabel="Memory scope"
          active={active()}
          onChange={(id) => setTab(id as Scope)}
          tabs={scopes().map((scope) => ({ id: scope, label: MEMORY_SCOPE_LABEL[scope], count: loaded() && !error() ? inScope(scope).length : undefined }))}
        />
      </Show>
      <Toolbar size="sm" ariaLabel="Filter memories">
        <Input kind="filter" label="Filter memories" placeholder="Filter memories…" title="Matches names, descriptions, and bodies." value={filter()} onInput={setFilter} />
      </Toolbar>
    </Show>
    <For each={scopes()}>{(scope) => (
      <TabPanel idPrefix="memory-scope" id={scope} active={active()}>
        <Switch>
          <Match when={!loaded()}><EmptyState busy align="start" size="sm">Loading…</EmptyState></Match>
          <Match when={error()}>
            {(reason) => <EmptyState title="Couldn't load memories" action={<Button onPress={() => void refetch()}>Try again</Button>}>{reason()}</EmptyState>}
          </Match>
          <Match when={!inScope(scope).length}>
            <EmptyState align="start" size="sm">{filter().trim() ? 'Nothing matches that filter.' : 'No memories yet. Agents save them as they work.'}</EmptyState>
          </Match>
          <Match when={inScope(scope).length}>
            <Rows
              id={`memory.${scope}`}
              ariaLabel={MEMORY_SCOPE_LABEL[scope]}
              items={inScope(scope).map((memory) => ({ key: keyOf(memory), label: memory.name }))}
              selected={selectedKey()}
              onSelect={open}
              onActivate={open}
            >
              {(item, itemProps, selected) => (
                <Show when={inScope(scope).find((memory) => keyOf(memory) === item.key)}>
                  {(memory) => (
                    <Row
                      item={itemProps}
                      variant="stacked"
                      selected={selected()}
                      onPress={() => open(item.key)}
                      title={memory().name}
                      collapsed={collapsed() ? <Text>{initials(memory().name)}</Text> : undefined}
                      meta={<Text emphasis="muted">{formatRelativeTime(memory().updatedAt)}</Text>}
                    >
                      <Text emphasis="strong">{memory().name}</Text>
                      <Text emphasis="muted">{memory().description}</Text>
                    </Row>
                  )}
                </Show>
              )}
            </Rows>
          </Match>
        </Switch>
      </TabPanel>
    )}</For>
  </>
}

/** The `detail` region: the open memory, the new-memory form, or the page's overview. */
export function MemoryCenterDetail() {
  const { task, projectId } = useMemoryScope()
  const address = createMemo<MemoryAddress | undefined>(() => {
    const selected = selectedMemory()
    return selected && (selected.scope === 'private' || selected.scope === 'project')
      ? { name: selected.name, scope: selected.scope, projectId: selected.scope === 'project' ? projectId() ?? null : null } : undefined
  })
  return (
    <Switch fallback={<MemoryOverview projectId={projectId()} />}>
      <Match when={addingMemory()}><MemoryAddForm task={task()} projectId={projectId()} /></Match>
      {/* Keyed, so opening another memory is a fresh reader rather than the last one's draft. */}
      <Match when={address()} keyed>{(address) => <MemoryDetail address={address} projectId={projectId()} />}</Match>
    </Switch>
  )
}

function MemoryOverview(props: { projectId?: string }) {
  return (
    <Stack gap="section">
      <Heading level={1} help="What your agents remember between sessions. They save to it as they work, and you can read, edit, and undo anything here.">Memory</Heading>
      <MemoryFeed projectId={props.projectId} />
      <MemoryContext projectId={props.projectId} />
      <Show when={props.projectId} keyed>{(id) => <MemoryImport projectId={id} />}</Show>
    </Stack>
  )
}
