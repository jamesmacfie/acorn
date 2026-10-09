import { createMemo, For, Show } from 'solid-js'
import { createQuery } from '@tanstack/solid-query'
import { activeNodeId, openActionPicker, prefsOptions, PrefKeys, requestTaskLaunch } from '@acorn/plugin-api/client'
import { Alert, Button, EmptyState, HistoryMark, IconButton, Input, Menu, Row, RowActions, Rows, SectionHeader, Select, Stack, Text, Toolbar, historyLayout } from '@acorn/plugin-api/ui'
import type { HistoryModel } from './historyModel'
import { commitActionRequest, launchWorkflowAtCommit, sameGitActionScope } from './launchWorkflow'

const searchFields = [
  { value: 'message', label: 'Message', placeholder: 'Search messages…' },
  { value: 'author', label: 'Author name or email', placeholder: 'Search authors…' },
  { value: 'hash', label: 'Full object ID', placeholder: 'Search commit hashes…' },
] as const

export function HistoryRows(props: { projectId: string; model: HistoryModel; selected: string | null; onSelect: (id: string) => void; onChanges?: () => void; onRefresh?: () => void }) {
  const prefs = createQuery(() => prefsOptions(true))
  const graphVisible = () => prefs.data?.[PrefKeys.gitGraphVisible] !== 'false'
  const valid = (nodeId: string | null, projectId: string) => sameGitActionScope(nodeId, projectId, props.projectId)
  const launchTask = (nodeId: string | null, projectId: string, id: string, title: string) => {
    if (valid(nodeId, projectId)) requestTaskLaunch({ nodeId, projectId, title, baseCommit: id })
  }
  const launchWorkflow = (nodeId: string | null, projectId: string, id: string, title: string) => {
    if (valid(nodeId, projectId)) launchWorkflowAtCommit(nodeId, projectId, id, title)
  }
  const openActions = (id: string) => {
    const commit = commits().find((entry) => entry.id === id)
    if (!commit) return
    openActionPicker(commitActionRequest(commit, activeNodeId(), props.projectId, () => props.projectId, props.onSelect))
  }
  const commits = () => props.model.commits()
  const slots = createMemo(() => historyLayout(commits(), !props.model.filter().query, !!props.model.next(), props.model.dropped()))
  const items = createMemo(() => commits().map((commit) => ({ key: commit.id, label: `${commit.subject} ${commit.id}` })))
  return <Stack gap="none">
    <SectionHeader count={commits().length} actions={<IconButton icon="refresh-cw" label="Refresh history" spin={props.model.first.isFetching} onPress={props.onRefresh ?? props.model.refresh} />}>History</SectionHeader>
    <Toolbar size="sm" ariaLabel="History ref">
      <Select size="sm" label="Ref" value={props.model.ref() ?? ''} options={[{ value: '', label: 'All refs and HEAD' }, ...(props.model.first.data?.refs ?? []).map((ref) => ({ value: ref, label: ref }))]}
        onChange={(value) => props.model.setRef(value || null)} />
    </Toolbar>
    <Toolbar size="sm" ariaLabel="Search history">
      <Input kind="filter" label="Search history" type="search" value={props.model.query()} maxLength={128} onInput={props.model.setQuery}
        placeholder={searchFields.find((field) => field.value === props.model.field())!.placeholder} />
      <Menu ariaLabel="Search in" placement="bottom-end" trigger={({ open, toggle }) =>
        <IconButton icon="list-filter" label={`Search in: ${searchFields.find((field) => field.value === props.model.field())!.label}`}
          opens="menu" expanded={open()} onPress={toggle} />}>
        {(menu) => <><Menu.Label>Search in</Menu.Label><For each={searchFields}>{(field) =>
          <Menu.Item context={menu} kind="radio" checked={props.model.field() === field.value} onSelect={() => props.model.setField(field.value)}>{field.label}</Menu.Item>
        }</For></>}
      </Menu>
    </Toolbar>
    <Show when={props.onChanges}><Button variant="ghost" onPress={props.onChanges}>Working changes in Changes</Button></Show>
    <Show when={props.model.first.isLoading}><EmptyState title="Loading history" /></Show>
    <Show when={props.model.first.error}><Alert tone="warn">{String(props.model.first.error)}{props.model.first.data ? ' Showing the last available page.' : ''}</Alert></Show>
    <Show when={props.model.moreError()}><Alert tone="warn">{props.model.moreError()}</Alert></Show>
    <Show when={props.model.pages()[0]?.omitted}><Alert tone="warn">{props.model.pages()[0]?.omitted}</Alert></Show>
    <Show when={props.model.pages().length === 10}><Alert tone="muted">Showing a 1,000-commit window. Loading more replaces the oldest rows.</Alert></Show>
    <Show when={!props.model.first.isLoading && !commits().length && !props.model.first.error}>
      <EmptyState title={props.model.filter().query ? 'No matching commits' : 'No commits'}>
        {props.model.filter().query ? 'Search is limited to the newest 5,000 reachable commits.' : 'This repository may have an unborn HEAD.'}
      </EmptyState>
    </Show>
    <Rows id={`git-history:${props.model.viewKey()}`} ariaLabel="Git history" items={items()} selected={props.selected}
      onSelect={props.onSelect} onActivate={props.onSelect} onMenu={openActions}>
      {(item, itemProps, selected) => {
        const commit = () => commits().find((row) => row.id === item.key)!
        const slot = () => slots().find((row) => row.id === item.key)!
        const nodeId = activeNodeId()
        const projectId = props.projectId
        const pinnedCommit = commit()
        return <Row item={itemProps} selected={selected()} onPress={() => props.onSelect(item.key)} density="compact" variant="stacked"
          leading={graphVisible() ? <HistoryMark slot={slot()} /> : undefined}
          trailing={<RowActions ariaLabel={`Actions for ${pinnedCommit.id}`}>
            {(menu) => <><Menu.Item context={menu} onSelect={() => { if (valid(nodeId, projectId)) props.onSelect(pinnedCommit.id) }}>Inspect commit</Menu.Item>
              <Menu.Item context={menu} onSelect={() => launchTask(nodeId, projectId, pinnedCommit.id, pinnedCommit.subject)}>Start task here</Menu.Item>
              <Menu.Item context={menu} onSelect={() => launchWorkflow(nodeId, projectId, pinnedCommit.id, pinnedCommit.subject)}>Start workflow here</Menu.Item>
              <For each={pinnedCommit.refs.filter((ref) => ref.startsWith('refs/heads/'))}>{(ref) => <>
                <Menu.Item context={menu} onSelect={() => launchTask(nodeId, projectId, pinnedCommit.id, pinnedCommit.subject)}>Start task at {ref.slice(11)} tip</Menu.Item>
                <Menu.Item context={menu} onSelect={() => launchWorkflow(nodeId, projectId, pinnedCommit.id, pinnedCommit.subject)}>Start workflow at {ref.slice(11)} tip</Menu.Item>
              </>}</For>
              <For each={pinnedCommit.parents}>{(parent, index) => <Menu.Item context={menu} onSelect={() => { if (valid(nodeId, projectId)) props.onSelect(parent) }}>Open parent {index() + 1} · {parent.slice(0, 8)}</Menu.Item>}</For>
            </>}
          </RowActions>}>
          <Text>{commit().subject}</Text>
          <Text emphasis="muted">{commit().id.slice(0, 8)}</Text>
          <Show when={commit().refs.length}><Text emphasis="muted">Refs {commit().refs.join(', ')}</Text></Show>
        </Row>
      }}
    </Rows>
    <Show when={props.model.next()}><Button disabled={props.model.loadingMore()} onPress={() => void props.model.loadMore()}>
      {props.model.loadingMore() ? 'Loading more…' : 'Load 100 more'}
    </Button></Show>
  </Stack>
}
