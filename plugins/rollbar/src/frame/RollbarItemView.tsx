import { Badge, Button, Row, Spinner, Tabs } from '@acorn/plugin-api/ui'
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

const Fact = (props: { label: string; value: string }) => (
  <div class="rb-fact">
    <span class="rb-fact-label">{props.label}</span>
    <span class="rb-fact-value">{props.value}</span>
  </div>
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

      <section
        id="rollbar-panel-overview"
        class="rb-panel"
        role="tabpanel"
        aria-labelledby="rollbar-tab-overview"
        hidden={props.activeTab !== 'overview'}
      >
        <div class="rb-stats">
          <Fact label="Occurrences" value={String(item().totalOccurrences)} />
          <Fact label="First seen" value={relativeTime(item().firstOccurrenceAt)} />
          <Fact label="Last seen" value={relativeTime(item().lastOccurrenceAt)} />
          <Fact label="Framework" value={item().framework || 'unknown'} />
          <Fact label="Assigned to" value={item().assignedTo || 'unassigned'} />
          <Fact label="Resolved in" value={item().resolvedInVersion || '—'} />
        </div>
      </section>

      <section
        id="rollbar-panel-occurrences"
        class="rb-panel"
        role="tabpanel"
        aria-labelledby="rollbar-tab-occurrences"
        hidden={props.activeTab !== 'occurrences'}
      >
        <Show
          when={props.state.occurrences.length}
          fallback={<div class="rb-placeholder">No occurrence sample is available.</div>}
        >
          <div class="rb-occurrence-workbench">
            <div class="rb-occurrence-list">
              <For each={props.state.occurrences}>{(entry) => (
                <Row
                  class="rb-occurrence-row"
                  density="roomy"
                  onActivate={() => props.onOccurrence(entry.id)}
                  meta={relativeTime(entry.occurredAt)}
                >
                  <span class="rb-occurrence-summary">
                    <span class="rb-occurrence-title">{occurrenceTitle(entry)}</span>
                    <span class="rb-occurrence-meta">
                      {[entry.environment, entry.codeVersion].filter(Boolean).join(' · ')}
                    </span>
                  </span>
                </Row>
              )}</For>
            </div>
            <OccurrenceDetail state={props.occurrence} onCopy={props.onCopy} />
          </div>
        </Show>
      </section>
    </>
  )
}

function OccurrenceDetail(props: {
  state: OccurrenceState
  onCopy(detail: RollbarOccurrenceDetail): void
}) {
  return (
    <div class="rb-occurrence-detail">
      <Show when={props.state.kind === 'empty'}>
        <div class="rb-placeholder">Choose an occurrence to inspect its stack.</div>
      </Show>
      <Show when={props.state.kind === 'loading'}>
        <div class="rb-placeholder"><Spinner label="Loading occurrence" /></div>
      </Show>
      <Show when={props.state.kind === 'error'}>
        <div class="rb-error" role="alert">
          <strong>Could not load the occurrence.</strong>
          <span>{props.state.kind === 'error' ? props.state.detail : ''}</span>
        </div>
      </Show>
      <Show when={props.state.kind === 'ready' ? props.state.detail : undefined}>
        {(detail) => <OccurrenceContent detail={detail()} onCopy={props.onCopy} />}
      </Show>
    </div>
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
      <Show when={detail().request?.url}>
        <Fact label="Request" value={[detail().request?.method, detail().request?.url].filter(Boolean).join(' ')} />
      </Show>
      <Show when={detail().context}><Fact label="Context" value={detail().context!} /></Show>
      <Show when={detail().server?.host}><Fact label="Server" value={detail().server!.host!} /></Show>
      <ol class="rb-stack">
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
