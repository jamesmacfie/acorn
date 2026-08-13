import { Alert, Badge, Button, DescriptionList, EmptyState, ListDetail, Row, Tabs } from '@acorn/plugin-api/ui'
import { For, Show } from 'solid-js'
import type {
  RollbarItemMetadata,
  RollbarOccurrenceDetail,
  RollbarOccurrenceSummary,
} from '../shared/api'
import type { RollbarRailTarget } from '../shared/rail'
import { relativeTime } from './model'

export type RollbarViewState = {
  target: RollbarRailTarget
  item: RollbarItemMetadata
  occurrences: RollbarOccurrenceSummary[]
}

export type OccurrenceState =
  | { kind: 'empty' }
  | { kind: 'loading' }
  | { kind: 'ready'; detail: RollbarOccurrenceDetail }
  | { kind: 'error'; detail: string }

const occurrenceTitle = (occurrence: RollbarOccurrenceSummary | RollbarOccurrenceDetail): string =>
  occurrence.exceptionClass || occurrence.message || occurrence.kind

const badgeTone = (value: string): 'neutral' | 'add' | 'del' | 'warn' => {
  if (/critical|error|failed/i.test(value)) return 'del'
  if (/warning|active/i.test(value)) return 'warn'
  if (/resolved|enabled/i.test(value)) return 'add'
  return 'neutral'
}

// `Fact` was a local div-pair with no <dt>/<dd> pairing; DescriptionList.Item is the same shape with
// the semantics. This alias keeps the call sites reading as facts rather than as list items.
const Fact = (props: { label: string; value: string }) => (
  <DescriptionList.Item class="rb-fact" label={props.label} mono>{props.value}</DescriptionList.Item>
)

export function RollbarItemView(props: {
  state: RollbarViewState
  activeTab: string
  occurrence: OccurrenceState
  onTab(id: string): void
  onRefresh(): void
  onOccurrence(id: string): void
  onCopy(detail: RollbarOccurrenceDetail): void
}) {
  const item = () => props.state.item

  return (
    <>
      <header class="rb-item-head">
        <div class="rb-heading">
          <div class="rb-eyebrow">{item().integrationLabel} · #{item().identifier}</div>
          <h1>{item().title}</h1>
        </div>
        <Button size="sm" onClick={props.onRefresh}>Refresh</Button>
      </header>

      <div class="rb-chips">
        <For each={[item().level, item().environment, item().status].filter(Boolean)}>{(value) => (
          <Badge tone={badgeTone(value!)} size="xs">{value}</Badge>
        )}</For>
      </div>

      <Tabs
        tabs={[
          { id: 'overview', label: 'Overview' },
          { id: 'occurrences', label: 'Occurrences', count: props.state.occurrences.length },
        ]}
        active={props.activeTab}
        onChange={props.onTab}
        idPrefix="rollbar"
        ariaLabel="Rollbar item sections"
      />

      {/* Was six hand-written attributes that had to agree with the strip's ids, twice. */}
      <Tabs.Panel idPrefix="rollbar" id="overview" active={props.activeTab} class="rb-panel">
        <DescriptionList class="rb-stats" layout="facts">
          <Fact label="Occurrences" value={String(item().totalOccurrences)} />
          <Fact label="First seen" value={relativeTime(item().firstOccurrenceAt)} />
          <Fact label="Last seen" value={relativeTime(item().lastOccurrenceAt)} />
          <Fact label="Framework" value={item().framework || 'unknown'} />
          <Fact label="Assigned to" value={item().assignedTo || 'unassigned'} />
          <Fact label="Resolved in" value={item().resolvedInVersion || '—'} />
        </DescriptionList>
      </Tabs.Panel>

      <Tabs.Panel idPrefix="rollbar" id="occurrences" active={props.activeTab} class="rb-panel">
        <Show
          when={props.state.occurrences.length}
          fallback={<EmptyState>No occurrence sample is available.</EmptyState>}
        >
          <ListDetail
            class="rb-occurrence-workbench"
            listLabel="Occurrences"
            listClass="rb-occurrence-list"
            detailClass="rb-occurrence-detail"
            scrollDetail
            list={
              <For each={props.state.occurrences}>{(entry) => (
                <Row
                  class="rb-occurrence-row"
                  density="roomy"
                  onActivate={() => props.onOccurrence(entry.id)}
                  meta={relativeTime(entry.occurredAt)}
                >
                  <span class="rb-occurrence-summary">
                    <span class="truncate">{occurrenceTitle(entry)}</span>
                    <span class="rb-occurrence-meta truncate">
                      {[entry.environment, entry.codeVersion].filter(Boolean).join(' · ')}
                    </span>
                  </span>
                </Row>
              )}</For>
            }
          >
            <OccurrenceDetail state={props.occurrence} onCopy={props.onCopy} />
          </ListDetail>
        </Show>
      </Tabs.Panel>
    </>
  )
}

function OccurrenceDetail(props: {
  state: OccurrenceState
  onCopy(detail: RollbarOccurrenceDetail): void
}) {
  // Contents, not a box: ListDetail draws the detail column and `detailClass` carries this padding.
  return (
    <>
      <Show when={props.state.kind === 'empty'}>
        <EmptyState>Choose an occurrence to inspect its stack.</EmptyState>
      </Show>
      <Show when={props.state.kind === 'loading'}>
        <EmptyState busy>Loading occurrence…</EmptyState>
      </Show>
      <Show when={props.state.kind === 'error'}>
        <Alert variant="banner" title="Could not load the occurrence.">
          {props.state.kind === 'error' ? props.state.detail : ''}
        </Alert>
      </Show>
      <Show when={props.state.kind === 'ready' ? props.state.detail : undefined}>
        {(detail) => <OccurrenceContent detail={detail()} onCopy={props.onCopy} />}
      </Show>
    </>
  )
}

function OccurrenceContent(props: {
  detail: RollbarOccurrenceDetail
  onCopy(detail: RollbarOccurrenceDetail): void
}) {
  const detail = () => props.detail
  return (
    <>
      <div class="rb-occurrence-head">
        <div>
          <strong>{occurrenceTitle(detail())}</strong>
          <div class="rb-muted">
            {[relativeTime(detail().occurredAt), detail().environment, detail().codeVersion].filter(Boolean).join(' · ')}
          </div>
        </div>
        <Button size="sm" onClick={() => props.onCopy(detail())}>Copy context</Button>
      </div>
      <DescriptionList layout="facts">
        <Show when={detail().request?.url}>
          <Fact label="Request" value={[detail().request?.method, detail().request?.url].filter(Boolean).join(' ')} />
        </Show>
        <Show when={detail().context}><Fact label="Context" value={detail().context!} /></Show>
        <Show when={detail().server?.host}><Fact label="Server" value={detail().server!.host!} /></Show>
      </DescriptionList>
      <ol class="list-reset">
        <For each={detail().frames}>{(frame) => (
          <li class="rb-stack-frame" classList={{ 'rb-stack-frame-project': frame.inProject !== false }}>
            <div class="rb-stack-location">
              {frame.filename}{frame.line == null ? '' : `:${frame.line}`}{frame.method ? ` · ${frame.method}` : ''}
            </div>
            <Show when={frame.code.length}>
              <pre class="rb-code">
                {frame.code.map((line) => `${String(line.line).padStart(4)}  ${line.text}`).join('\n')}
              </pre>
            </Show>
          </li>
        )}</For>
      </ol>
    </>
  )
}
