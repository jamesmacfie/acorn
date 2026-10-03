import { createMemo, createSignal, For, Show } from 'solid-js'
import {
  Alert, Badge, Checkbox, CodeBlock, CopyButton, EmptyState, Facts, SectionHeader, Stack, TabPanel, Tabs, Text,
  Toolbar, ToolbarSpacer,
} from '@acorn/plugin-api/ui/tree'
import { formatSize, type SendFailure, type SendResult, type SendSuccess, type TimelineEntry } from '../shared/model'
import { decodeBody } from './httpClient'

// The response half of the API panel. Every box, rule and monospace block here used to be a class in
// this plugin's stylesheet; now the status strip is a `Toolbar`, the header table is `Facts`, and the
// body is a `CodeBlock`, so the panel follows the reader's appearance pack without this file knowing
// one exists.

type ResponseTab = 'body' | 'headers' | 'timeline'
type TabDef = { id: string; label: string; count?: number }

const statusTone = (status: number): 'accent' | 'warn' | 'danger' | 'neutral' => {
  if (status >= 200 && status < 300) return 'accent'
  if (status >= 300 && status < 400) return 'neutral'
  if (status >= 400 && status < 500) return 'warn'
  return 'danger'
}

// Pretty-print JSON when it is JSON; otherwise show it as it came. No syntax highlighting: the host's
// editor is off-limits here, its one cross-plugin import is baselined, and the baseline is shrink-only.
function formatBody(text: string, contentType: string): string {
  if (!contentType.includes('json')) return text
  try {
    return JSON.stringify(JSON.parse(text), null, 2)
  } catch {
    return text
  }
}

const GROUP_LABEL = { sent: 'Sent', received: 'Received' } as const

/** The send timeline: what went out, what came back, and how long each step took. Label and detail,
 *  which is what `Facts` means, as rows under a heading for each side of the exchange. */
function Timeline(props: { entries: TimelineEntry[] }) {
  // Consecutive entries with the same group, so a heading lands where the side changes.
  const runs = () => props.entries.reduce<{ group?: TimelineEntry['group']; entries: TimelineEntry[] }[]>((out, entry) => {
    const last = out[out.length - 1]
    if (last && last.group === entry.group) last.entries.push(entry)
    else out.push({ group: entry.group, entries: [entry] })
    return out
  }, [])
  return (
    <Stack gap="row">
      <For each={runs()}>
        {(run) => (
          <Stack gap="none">
            <Show when={run.group}>{(group) => <SectionHeader level="sub">{GROUP_LABEL[group()]}</SectionHeader>}</Show>
            <Facts size="sm" grouping="rows" items={run.entries.map((entry) => ({ label: entry.label, value: entry.detail, mono: true }))} />
          </Stack>
        )}
      </For>
    </Stack>
  )
}

function SuccessResponse(props: { result: SendSuccess; onCopy: (text: string) => void }) {
  const [tab, setTab] = createSignal<ResponseTab>('body')
  const [raw, setRaw] = createSignal(false)

  const contentType = createMemo(() => props.result.headers.find(([k]) => k.toLowerCase() === 'content-type')?.[1] ?? '')
  const decoded = createMemo(() => decodeBody(props.result.bodyBase64))
  const bodyText = createMemo(() => {
    const d = decoded()
    return raw() ? d.text : formatBody(d.text, contentType())
  })

  const tabs = (): TabDef[] => [
    { id: 'body', label: 'Body' },
    { id: 'headers', label: 'Headers', count: props.result.headers.length },
    { id: 'timeline', label: 'Timeline', count: props.result.timeline.length },
  ]

  // `grow`, so the response takes the rest of the region and its body scrolls inside it; the region
  // clipped a long body at the pane's edge.
  //
  // The status and the time are one template string each. A host from before tree text could hold
  // numbers drew a bare number as nothing.
  return (
    <Stack gap="row" grow>
      <Toolbar variant="bar" size="sm" ariaLabel="Response status">
        <Badge tone={statusTone(props.result.status)} shape="pill">
          {`${props.result.status} ${props.result.statusText}`}
        </Badge>
        <Text tone="muted">{`${props.result.durationMs} ms`}</Text>
        <Text tone="muted">{formatSize(props.result.size)}</Text>
        <Show when={props.result.redirected}>
          <Badge tone="neutral">Redirected</Badge>
        </Show>
        <Show when={props.result.truncated}>
          <Badge tone="warn">Cut off at 5 MB</Badge>
        </Show>
        <ToolbarSpacer />
        <Show when={tab() === 'body'}>
          <Checkbox label="Raw" checked={raw()} onChange={(checked: boolean) => setRaw(checked)} />
          {/* A string, not an accessor: a tree's props are JSON on a message port, and the host
              re-reads this one whenever the body changes because the prop itself is patched.
              `always`, because the button otherwise shows only under a `.copyable` ancestor, which a
              tree cannot draw. */}
          <CopyButton always text={bodyText()} onCopy={props.onCopy} title="Copy body" />
        </Show>
      </Toolbar>

      <Tabs tabs={tabs()} active={tab()} onChange={(id: string) => setTab(id as ResponseTab)} idPrefix="http-response" ariaLabel="Response" />

      <TabPanel idPrefix="http-response" id={tab()} active={tab()}>
        <Show when={tab() === 'body'}>
          <Show when={bodyText()} fallback={<EmptyState size="sm">The response has no body.</EmptyState>}>
            <CodeBlock size="sm">{bodyText()}</CodeBlock>
          </Show>
        </Show>

        <Show when={tab() === 'headers'}>
          <Facts size="sm" grouping="rows" items={props.result.headers.map(([name, value]) => ({ label: name, value, mono: true }))} />
        </Show>

        <Show when={tab() === 'timeline'}>
          <Timeline entries={props.result.timeline} />
        </Show>
      </TabPanel>
    </Stack>
  )
}

type FailureTab = 'error' | 'timeline'

function FailedResponse(props: { result: SendFailure }) {
  const [tab, setTab] = createSignal<FailureTab>('error')
  const tabs = (): TabDef[] => [
    { id: 'error', label: 'Error' },
    { id: 'timeline', label: 'Timeline', count: props.result.timeline.length },
  ]
  const facts = () => [
    { label: 'URL', value: props.result.url, mono: true },
    props.result.code ? { label: 'Code', value: props.result.code, mono: true } : null,
    props.result.detail && props.result.detail !== props.result.error
      ? { label: 'Detail', value: props.result.detail, mono: true }
      : null,
  ].filter((fact) => fact !== null)

  return (
    <Stack gap="row" grow>
      <Toolbar variant="bar" size="sm" ariaLabel="Response status">
        <Badge tone="danger" shape="pill">Network error</Badge>
        <Text tone="muted">{`${props.result.durationMs} ms`}</Text>
      </Toolbar>

      <Tabs tabs={tabs()} active={tab()} onChange={(id: string) => setTab(id as FailureTab)} idPrefix="http-response-failure" ariaLabel="Failed request" />

      <TabPanel idPrefix="http-response-failure" id={tab()} active={tab()}>
        <Show when={tab() === 'error'}>
          <Stack gap="row">
            <Alert>{props.result.error}</Alert>
            <Facts size="sm" items={facts()} />
          </Stack>
        </Show>

        <Show when={tab() === 'timeline'}>
          <Timeline entries={props.result.timeline} />
        </Show>
      </TabPanel>
    </Stack>
  )
}

export default function ResponseView(props: {
  result: SendResult | null
  error: string | null
  sending: boolean
  /** The bridge's copy: a plugin's code has no document to copy from, so the host copies on its
   *  behalf (docs/http-client/client.md § Client). */
  onCopy: (text: string) => void
}) {
  const success = createMemo((): SendSuccess | null => {
    const result = props.result
    return result?.ok ? result : null
  })
  const failure = createMemo((): SendFailure | null => {
    const result = props.result
    return result && !result.ok ? result : null
  })

  return (
    <Show
      when={props.result}
      fallback={
        <Show
          when={props.error}
          fallback={<EmptyState busy={props.sending}>{props.sending ? 'Sending…' : 'Send the request to see the response.'}</EmptyState>}
        >
          <Alert variant="banner">{props.error}</Alert>
        </Show>
      }
    >
      <Show when={success()} fallback={<Show when={failure()}>{(result) => <FailedResponse result={result()} />}</Show>}>
        {(result) => <SuccessResponse result={result()} onCopy={props.onCopy} />}
      </Show>
    </Show>
  )
}
