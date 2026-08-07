import { createMemo, createSignal, For, Show } from 'solid-js'
import { Tabs, type TabDef } from '@acorn/client-core/ui/Tabs.tsx'
import CopyButton from '@acorn/client-core/ui/CopyButton.tsx'
import { Badge } from '@acorn/client-core/ui/primitives.tsx'
import type { SendFailure, SendResult, SendSuccess, TimelineEntry } from '../shared/model'
import { decodeBody } from './httpClient'

type ResponseTab = 'body' | 'headers' | 'timeline'

const formatSize = (bytes: number): string => {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

const statusTone = (status: number): 'accent' | 'warn' | 'del' | 'neutral' => {
  if (status >= 200 && status < 300) return 'accent'
  if (status >= 300 && status < 400) return 'neutral'
  if (status >= 400 && status < 500) return 'warn'
  return 'del'
}

// Pretty-print JSON when it is JSON; otherwise show it as it came. No syntax highlighting —
// Monaco is off-limits here (its only cross-plugin import is baselined and the baseline is
// shrink-only), and a highlighter for the sake of colour isn't worth a new dependency.
function formatBody(text: string, contentType: string): string {
  if (!contentType.includes('json')) return text
  try {
    return JSON.stringify(JSON.parse(text), null, 2)
  } catch {
    return text
  }
}

function Timeline(props: { entries: TimelineEntry[] }) {
  return (
    <ul class="http-timeline">
      <For each={props.entries}>
        {(entry) => (
          <li class="http-timeline-row" data-label={entry.label}>
            <span class="http-timeline-label">{entry.label}</span>
            <span class="http-timeline-detail">{entry.detail}</span>
          </li>
        )}
      </For>
    </ul>
  )
}

function SuccessResponse(props: { result: SendSuccess }) {
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

  return (
    <>
      <div class="http-response-strip">
        <Badge tone={statusTone(props.result.status)} shape="pill">
          {props.result.status} {props.result.statusText}
        </Badge>
        <span class="http-response-meta">{props.result.durationMs} ms</span>
        <span class="http-response-meta">{formatSize(props.result.size)}</span>
        <Show when={props.result.redirected}>
          <Badge tone="neutral">redirected</Badge>
        </Show>
        <Show when={props.result.truncated}>
          <Badge tone="warn">truncated at 5 MB</Badge>
        </Show>
        <span class="http-response-spacer" />
        <Show when={tab() === 'body'}>
          <label class="http-toggle">
            <input type="checkbox" checked={raw()} onChange={(e) => setRaw(e.currentTarget.checked)} /> Raw
          </label>
          <CopyButton text={bodyText} title="Copy body" />
        </Show>
      </div>

      <Tabs tabs={tabs()} active={tab()} onChange={(id) => setTab(id as ResponseTab)} idPrefix="http-response" ariaLabel="Response" />

      <div class="http-response-body" id={`http-response-panel-${tab()}`} role="tabpanel">
        <Show when={tab() === 'body'}>
          <Show when={bodyText()} fallback={<p class="http-empty">Empty response body.</p>}>
            <pre class="http-pre">{bodyText()}</pre>
          </Show>
        </Show>

        <Show when={tab() === 'headers'}>
          <dl class="http-kv-list">
            <For each={props.result.headers}>
              {([name, value]) => (
                <>
                  <dt>{name}</dt>
                  <dd>{value}</dd>
                </>
              )}
            </For>
          </dl>
        </Show>

        <Show when={tab() === 'timeline'}>
          <Timeline entries={props.result.timeline} />
        </Show>
      </div>
    </>
  )
}

type FailureTab = 'error' | 'timeline'

function FailedResponse(props: { result: SendFailure }) {
  const [tab, setTab] = createSignal<FailureTab>('error')
  const tabs = (): TabDef[] => [
    { id: 'error', label: 'Error' },
    { id: 'timeline', label: 'Timeline', count: props.result.timeline.length },
  ]

  return (
    <>
      <div class="http-response-strip">
        <Badge tone="del" shape="pill">Network error</Badge>
        <span class="http-response-meta">{props.result.durationMs} ms</span>
      </div>

      <Tabs tabs={tabs()} active={tab()} onChange={(id) => setTab(id as FailureTab)} idPrefix="http-response-failure" ariaLabel="Failed request" />

      <div class="http-response-body" id={`http-response-failure-panel-${tab()}`} role="tabpanel">
        <Show when={tab() === 'error'}>
          <p class="http-failure-message" role="alert">{props.result.error}</p>
          <dl class="http-kv-list">
            <dt>URL</dt>
            <dd>{props.result.url}</dd>
            <Show when={props.result.code}>
              {(code) => (
                <>
                  <dt>Code</dt>
                  <dd>{code()}</dd>
                </>
              )}
            </Show>
            <Show when={props.result.detail && props.result.detail !== props.result.error}>
              <dt>Detail</dt>
              <dd>{props.result.detail}</dd>
            </Show>
          </dl>
        </Show>

        <Show when={tab() === 'timeline'}>
          <Timeline entries={props.result.timeline} />
        </Show>
      </div>
    </>
  )
}

export default function ResponseView(props: { result: SendResult | null; error: string | null; sending: boolean }) {
  const success = createMemo((): SendSuccess | null => {
    const result = props.result
    return result?.ok ? result : null
  })
  const failure = createMemo((): SendFailure | null => {
    const result = props.result
    return result && !result.ok ? result : null
  })

  return (
    <section class="http-response">
      <Show
        when={props.result}
        fallback={
          <div class="http-response-empty">
            <Show when={props.error} fallback={<span>{props.sending ? 'Sending…' : 'No response yet — press Send.'}</span>}>
              <span class="http-response-error" role="alert">{props.error}</span>
            </Show>
          </div>
        }
      >
        <Show when={success()} fallback={<Show when={failure()}>{(result) => <FailedResponse result={result()} />}</Show>}>
          {(result) => <SuccessResponse result={result()} />}
        </Show>
      </Show>
    </section>
  )
}
