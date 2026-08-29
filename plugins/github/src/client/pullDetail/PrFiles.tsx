import { Show } from 'solid-js'
import { fileStatusMeta } from '@acorn/plugin-api/client'
import { Badge, Checkbox, DetailColumn, EmptyState, ListColumn, ListDetail, Row, Rows, Text } from '@acorn/plugin-api/ui'
import { DiffForPull } from '../DiffForPull'
import { routeKey } from '../fileNavigation'
import type { PrModel } from './prModel'

// The changed files of a pull request: the list on its own, and the list beside the diff.
//
// Accepted difference from the plan: the list is flat rather than a directory tree. A tree is a
// change in what the navigator says, not a move to the kit, and this list has always been the file
// order the finder and `[` / `]` cycling agree on (../changedFiles.ts).

export function PrFileList(props: {
  model: PrModel
  current: () => string | undefined
  onSelect: (path: string) => void
  /** Draw only the rows on screen, in a scroller of the list's own. True where the list is a column
   *  of its own, false inside a fold that is already in one — a scroller nested in a scroller has no
   *  height to fill. */
  virtual?: boolean
}) {
  const model = () => props.model
  return (
    <Show
      when={model().files().length}
      fallback={<EmptyState align="start" busy={model().filesLoading()}>{model().filesLoading() ? 'Loading…' : 'No files.'}</EmptyState>}
    >
      <Rows
        virtual={props.virtual}
        id={`gh-files:${model().scope.owner}/${model().scope.repo}#${model().scope.number}`}
        ariaLabel="Changed files"
        items={model().files().map((file) => ({ key: file.path, label: file.path }))}
        selected={props.current() ?? null}
        onSelect={props.onSelect}
      >
        {(item, itemProps, selected, place) => {
          const file = () => model().files().find((candidate) => candidate.path === item.key)
          const status = () => fileStatusMeta(file()?.status)
          // `muted` is the file-status vocabulary's word for "nothing special"; the badge's is
          // `neutral`.
          const tone = (): 'ok' | 'danger' | 'warn' | 'neutral' => {
            const value = status().tone
            return value === 'muted' ? 'neutral' : value
          }
          return (
            <Row
              item={itemProps}
              density="compact"
              selected={selected()}
              offset={place.offset}
              height={place.height}
              onPress={() => props.onSelect(item.key)}
              title={item.key}
              label={item.key}
              leading={
                <>
                  <Checkbox
                    ariaLabel={`Mark ${item.key} viewed`}
                    title="Mark viewed"
                    checked={!!file()?.viewed}
                    disabled={model().readOnly}
                    onChange={(checked) => { if (!model().readOnly) model().setViewed(item.key, checked) }}
                  />
                  <Badge size="xs" tone={tone()}>{status().letter}</Badge>
                </>
              }
              meta={<Text emphasis="muted">+{file()?.additions ?? 0} −{file()?.deletions ?? 0}</Text>}
            >
              <Text tone={file()?.viewed ? 'muted' : undefined}>{item.key}</Text>
            </Row>
          )
        }}
      </Rows>
    </Show>
  )
}

/** The Files tab: the navigator beside the diff, as a split the host draws. */
export function PrFilesTab(props: {
  model: PrModel
  current: () => string | undefined
  onSelect: (path: string) => void
  /** Pinned above the list. The pull strip, so the Files tab can switch pulls like the others; it
   *  goes in the navigator column rather than over the split, which would put a scroller between the
   *  layout and the two panes it sizes. */
  header?: import('solid-js').JSX.Element
}) {
  const model = () => props.model
  const route = () => ({
    owner: model().scope.owner,
    repo: model().scope.repo,
    number: model().scope.number,
    key: routeKey(model().scope.owner, model().scope.repo, model().scope.number),
  })
  return (
    <ListDetail split>
      <ListColumn label="Changed files">
        {props.header}
        <PrFileList virtual model={model()} current={props.current} onSelect={props.onSelect} />
      </ListColumn>
      <DetailColumn>
        <DiffForPull
          route={route()}
          router={false}
          taskId={model().scope.taskId}
          readOnly={model().readOnly}
        />
      </DetailColumn>
    </ListDetail>
  )
}
