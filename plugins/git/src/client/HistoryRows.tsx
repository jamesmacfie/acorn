import { createMemo, For, Show } from 'solid-js'
import { activeNodeId } from '@acorn/plugin-api/client'
import { Alert, Button, EmptyState, HistoryMark, Input, Menu, Row, RowActions, Rows, SectionHeader, Select, Stack, Text, historyLayout } from '@acorn/plugin-api/ui'
import type { HistoryModel } from './historyModel'

export function HistoryRows(props: { projectId: string; model: HistoryModel; selected: string | null; onSelect: (id: string) => void; onChanges?: () => void; onRefresh?: () => void }) {
  const commits = () => props.model.commits()
  const slots = createMemo(() => historyLayout(commits(), !props.model.filter().query, !!props.model.next(), props.model.dropped()))
  const items = createMemo(() => commits().map((commit) => ({ key: commit.id, label: `${commit.subject} ${commit.id}` })))
  return <Stack gap="section">
    <SectionHeader count={commits().length} actions={<Button size="sm" variant="ghost" onPress={props.onRefresh ?? props.model.refresh}>Refresh</Button>}>History</SectionHeader>
    <Select label="Ref" value={props.model.ref() ?? ''} options={[{ value: '', label: 'All refs and HEAD' }, ...(props.model.first.data?.refs ?? []).map((ref) => ({ value: ref, label: ref }))]}
      onChange={(value) => props.model.setRef(value || null)} />
    <Select label="Search in" value={props.model.field()} options={[
      { value: 'message', label: 'Message' }, { value: 'author', label: 'Author name or email' }, { value: 'hash', label: 'Full object ID' },
    ]} onChange={(value) => props.model.setField(value as 'message' | 'author' | 'hash')} />
    <Input label="Search history" type="search" value={props.model.query()} maxLength={128} onInput={props.model.setQuery} placeholder="Case insensitive substring" />
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
    <Rows id={`git-history:${activeNodeId()}:${props.projectId}`} ariaLabel="Git history" items={items()} selected={props.selected}
      onSelect={props.onSelect} onActivate={props.onSelect}>
      {(item, itemProps, selected) => {
        const commit = () => commits().find((row) => row.id === item.key)!
        const slot = () => slots().find((row) => row.id === item.key)!
        return <Row item={itemProps} selected={selected()} onPress={() => props.onSelect(item.key)} density="compact" variant="stacked"
          leading={<HistoryMark slot={slot()} />}
          trailing={<RowActions ariaLabel={`Actions for ${commit().id}`}>
            {(menu) => <><Menu.Item context={menu} onSelect={() => props.onSelect(item.key)}>Inspect commit</Menu.Item>
              <For each={commit().parents}>{(parent, index) => <Menu.Item context={menu} onSelect={() => props.onSelect(parent)}>Open parent {index() + 1} · {parent.slice(0, 8)}</Menu.Item>}</For>
            </>}
          </RowActions>}>
          <Text>{commit().subject}</Text>
          <Text emphasis="muted">{commit().id.slice(0, 8)} · {commit().parents.length ? `Parents ${commit().parents.map((id) => id.slice(0, 8)).join(', ')}` : 'Root commit'}</Text>
          <Show when={commit().refs.length}><Text emphasis="muted">Refs {commit().refs.join(', ')}</Text></Show>
        </Row>
      }}
    </Rows>
    <Show when={props.model.next()}><Button disabled={props.model.loadingMore()} onPress={() => void props.model.loadMore()}>
      {props.model.loadingMore() ? 'Loading more…' : 'Load 100 more'}
    </Button></Show>
  </Stack>
}
