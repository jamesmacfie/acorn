import { createMemo, For, Match, Show, Switch } from 'solid-js'
import {
  clientEvents,
  contextMenuItems,
  formatRelativeTime,
  railDotProps,
  runContextMenuItem,
  type ItemRowTarget,
} from '@acorn/plugin-api/client'
import {
  Alert,
  Button,
  EmptyState,
  FilterBar,
  Icon,
  Inline,
  Input,
  Menu,
  Row,
  RowActions,
  Rows,
  StatusDot,
  Tabs,
  Text,
  UserAvatar,
} from '@acorn/plugin-api/ui'
import { CHECK_TONE, checksState, checksSummary } from '../model/checkStatus'
import type { ChangeRequestSummary, Check } from '../model/types'

// A repository's change requests, as an Open and a Closed tab over a filter and one row per change
// request. The host owns the reads, the search, and what a row's menu offers. This draws them.
//
// The list is a `Rows` collection with `virtual`, so the scroller, the row placement, the arrows,
// type-ahead and the place it keeps across a refetch are all the kit's
// (docs/command-palette-and-shortcuts/focus-and-typing.md § Focus and typing).

// Draft, closed, and merged as one glyph. Open draws none, or the Open tab would say "open" on every
// row.
const STATE_MARK = {
  draft: { icon: 'git-pull-request-draft', word: 'Draft' },
  closed: { icon: 'git-pull-request-closed', word: 'Closed' },
  merged: { icon: 'git-merge', word: 'Merged' },
} as const
const stateMark = (row: ChangeRequestSummary) =>
  row.draft ? STATE_MARK.draft : row.state === 'open' ? undefined : STATE_MARK[row.state]

/** The checks dot, always drawn so every row's leading marks line up. Muted when there are none. */
function ChecksDot(props: { checks: readonly { status: string | null }[] }) {
  return (
    <Show when={props.checks.length} fallback={<StatusDot tone="muted" tip="No checks" />}>
      <StatusDot
        {...railDotProps(CHECK_TONE[checksState(props.checks)])}
        label={checksSummary(props.checks)}
        tip={checksSummary(props.checks)}
      />
    </Show>
  )
}

// "14m ago" says less in less room as "14m". The row's tip carries the age in full.
const shortAge = (at: number | null) => formatRelativeTime(at).replace(/ ago$/, '')

const LIST_TABS = [
  { id: 'open', label: 'Open' },
  { id: 'closed', label: 'Closed' },
]

const openIntegrations = () => clientEvents.emit('presentation:open-settings', { tab: 'integrations' })

export type ChangeRequestListStatus =
  | { kind: 'ready' }
  | { kind: 'loading' }
  | { kind: 'disconnected' }
  | { kind: 'failed'; reason?: string; reconnect: boolean; retry: () => void }

export function ChangeRequestList(props: {
  host: { label: string; noun: string; prefix: string; avatar: (login: string | null) => string | undefined }
  /** Prefix for the tab and list ids, such as `github-pulls`. */
  idPrefix: string
  /** Narrowed to the rail: avatars and numbers only, no tabs or filter. */
  collapsed: () => boolean
  tab: () => 'open' | 'closed'
  setTab: (tab: 'open' | 'closed') => void
  filter: () => string
  setFilter: (text: string) => void
  searching: () => boolean
  /** A line above the rows about the search, such as "GitHub has 412 matches". */
  notice: () => string | undefined
  /** What to say when no row is left, such as "No open pull requests." */
  emptyText: () => string
  taskError: () => string
  status: () => ChangeRequestListStatus
  rows: () => ChangeRequestSummary[]
  /** Scopes the list's own state to one repository and tab. */
  listKey: () => string
  selected: () => string | null
  href: (number: string) => string | null
  onOpen: (number: string) => void
  onHover?: (number: number, entered: boolean) => void
  /** One row's checks and body, read in the row's own scope so a host can open a query per row. */
  rowDetail: (number: string) => { checks: () => readonly Check[]; body: () => string | null | undefined }
  /** What a row's menu is about. `body` comes from `rowDetail` when the host has it. */
  rowTarget: (row: ChangeRequestSummary, body?: string | null) => ItemRowTarget
  loadMore?: { shown: () => boolean; busy: () => boolean; run: () => void }
}) {
  const host = () => props.host
  const plural = () => `${host().noun}s`
  const items = createMemo(() =>
    props.rows().map((row) => ({ key: String(row.number), label: `${host().prefix}${row.number} ${row.title}` })),
  )
  const byNumber = createMemo(() => new Map(props.rows().map((row) => [String(row.number), row])))
  const failure = () => {
    const status = props.status()
    return status.kind === 'failed' ? status : undefined
  }

  return (
    <>
      <Show when={!props.collapsed()}>
        <Tabs
          tabs={LIST_TABS}
          active={props.tab()}
          onChange={(next) => props.setTab(next === 'closed' ? 'closed' : 'open')}
          idPrefix={props.idPrefix}
          ariaLabel={`${host().noun.charAt(0).toUpperCase()}${host().noun.slice(1)} state`}
        />
        {/* Under the strip rather than beside it. Open and Closed choose which list this is; the filter
            is about the list that choice produced, and squeezed into the tab row it had no room and no
            inset of its own. */}
        <FilterBar ariaLabel={`Search ${plural()}`} busy={props.searching()}>
          <Input
            kind="filter"
            label={`Search ${plural()}`}
            placeholder="Search…"
            value={props.filter()}
            onInput={props.setFilter}
          />
        </FilterBar>
        <Show when={props.rows().length ? props.notice() : undefined}>
          {(notice) => (
            <EmptyState align="start" size="sm">
              {notice()}
            </EmptyState>
          )}
        </Show>
      </Show>
      <Show when={props.taskError()}>{(text) => <Alert>{text()}</Alert>}</Show>
      <Switch>
        <Match when={props.status().kind === 'disconnected'}>
          <EmptyState
            align="start"
            title={`${host().label} isn't connected`}
            action={<Button onPress={openIntegrations}>Connect {host().label}</Button>}
          >
            Connect {host().label} to see this project's {plural()}.
          </EmptyState>
        </Match>
        <Match when={failure()}>
          {(failed) => (
            <EmptyState
              align="start"
              size="sm"
              title={`Couldn't load ${plural()}.`}
              action={
                <Show
                  when={failed().reconnect}
                  fallback={
                    <Button size="sm" onPress={() => failed().retry()}>
                      Try again
                    </Button>
                  }
                >
                  <Button size="sm" onPress={openIntegrations}>
                    Reconnect {host().label}
                  </Button>
                </Show>
              }
            >
              {failed().reason}
            </EmptyState>
          )}
        </Match>
        <Match when={props.status().kind === 'loading'}>
          <EmptyState align="start" size="sm" busy>
            Loading…
          </EmptyState>
        </Match>
        <Match when={props.status().kind === 'ready'}>
          <Show
            when={items().length}
            fallback={
              // The search bar's spinner stands in while the host answers.
              <Show when={!props.searching()}>
                <EmptyState align="start" size="sm">
                  {props.emptyText()}
                </EmptyState>
              </Show>
            }
          >
            <Rows
              virtual
              rowHeight={props.collapsed() ? 'rail' : 'default'}
              id={`${props.idPrefix}:${props.listKey()}`}
              ariaLabel={plural().charAt(0).toUpperCase() + plural().slice(1)}
              items={items()}
              selected={props.selected()}
              onSelect={props.onOpen}
              onActivate={props.onOpen}
            >
              {(item, itemProps, selected, place) => {
                // Not `byNumber().get(item.key)!`. A row outlives the list it was built from by one
                // update: when the list refetches, a row whose entry has left the map runs its
                // accessors once more before it is disposed. A throw there takes the whole list down,
                // which in a terminal is a browse panel that goes blank and says nothing.
                const row = () => byNumber().get(item.key)
                const detail = props.rowDetail(item.key)
                const checks = () => detail.checks()
                return (
                  <Show when={row()}>
                    {(row) => (
                      <Row
                        item={itemProps}
                        // `href` keeps the real link for middle-click and copy address; `onPress` routes
                        // the plain click.
                        {...(props.href(item.key) ? { href: props.href(item.key)! } : {})}
                        onPress={() => props.onOpen(item.key)}
                        selected={selected()}
                        onHover={(entered) => props.onHover?.(row().number, entered)}
                        offset={place.offset}
                        height={place.height}
                        title={row().title}
                        tip={row().title}
                        tipAt={row().updatedAt ?? undefined}
                        label={item.label}
                        // Collapsed: the author's avatar over the number, which is how a change request is
                        // named in conversation. The checks dot stays, because "is it green" is the
                        // other thing worth seeing at a glance, and it costs no width sitting beside
                        // the avatar. The state glyph and the age go; the title is the tooltip.
                        //
                        // Both marks fit the row's existing height, which is not negotiable here: this
                        // list is virtualized and its row height is a number read off the document
                        // root, so a taller row would tear the scroll range.
                        collapsed={
                          props.collapsed() ? (
                            <>
                              <Inline gap="inline">
                                <UserAvatar login={row().author} src={host().avatar(row().author)} />
                                <Show when={checks().length}>
                                  <StatusDot
                                    {...railDotProps(CHECK_TONE[checksState(checks())])}
                                    label={checksSummary(checks())}
                                  />
                                </Show>
                              </Inline>
                              <Text emphasis="muted">
                                {host().prefix}
                                {item.key}
                              </Text>
                            </>
                          ) : undefined
                        }
                        leading={
                          <>
                            <ChecksDot checks={checks()} />
                            <Show when={stateMark(row())}>
                              {(mark) => <Icon name={mark().icon} title={mark().word} size={14} />}
                            </Show>
                            {/* The author column is gone, so the avatar carries the login on hover. */}
                            <UserAvatar login={row().author} src={host().avatar(row().author)} />
                          </>
                        }
                        meta={<Text emphasis="muted">{shortAge(row().updatedAt)}</Text>}
                        trailing={
                          <Show when={contextMenuItems('item.row', props.rowTarget(row())).length}>
                            <RowActions ariaLabel={`Actions for ${host().noun} ${host().prefix}${item.key}`}>
                              {(menu) => (
                                <For each={contextMenuItems('item.row', props.rowTarget(row()))}>
                                  {(entry) => (
                                    <Menu.Item
                                      context={menu}
                                      tone={entry.tone ?? 'neutral'}
                                      onSelect={() => runContextMenuItem(entry, props.rowTarget(row(), detail.body()))}
                                    >
                                      {entry.label}
                                    </Menu.Item>
                                  )}
                                </For>
                              )}
                            </RowActions>
                          </Show>
                        }
                      >
                        {/* The number leads the title and keeps its width; the title gives way. */}
                        <Text emphasis="mono" tone="muted">
                          {host().prefix}
                          {item.key}
                        </Text>
                        <Text>{row().title}</Text>
                      </Row>
                    )}
                  </Show>
                )
              }}
            </Rows>
          </Show>
          {/* Load-more only where the host pages; hidden while filtering, since the filter only sees
            loaded pages. */}
          <Show when={props.loadMore?.shown()}>
            <Button variant="ghost" size="sm" disabled={props.loadMore!.busy()} onPress={() => props.loadMore!.run()}>
              {props.loadMore!.busy() ? 'Loading…' : 'Load more'}
            </Button>
          </Show>
        </Match>
      </Switch>
    </>
  )
}
