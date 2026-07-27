// The response half of the API panel: a status strip plus Body / Headers / Timeline tabs.
// Bruno's shape, minus the TLS/DNS phase rows (those need an https.Agent subclass).
import { createMemo, createSignal, For, Show } from 'solid-js'
import { Tabs, type TabDef } from '../../../core/client/ui/Tabs'
import CopyButton from '../../../core/client/ui/CopyButton'
import { Badge } from '../../../core/client/ui/primitives'
import type { SendResult } from '../shared/model'
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

export default function ResponseView(props: { result: SendResult | null; error: string | null; sending: boolean }) {
  const [tab, setTab] = createSignal<ResponseTab>('body')
  const [raw, setRaw] = createSignal(false)

  const contentType = createMemo(() => props.result?.headers.find(([k]) => k.toLowerCase() === 'content-type')?.[1] ?? '')
  const decoded = createMemo(() => (props.result ? decodeBody(props.result.bodyBase64) : null))
  const bodyText = createMemo(() => {
    const d = decoded()
    if (!d) return ''
    return raw() ? d.text : formatBody(d.text, contentType())
  })

  const tabs = (): TabDef[] => [
    { id: 'body', label: 'Body' },
    { id: 'headers', label: 'Headers', count: props.result?.headers.length },
    { id: 'timeline', label: 'Timeline', count: props.result?.timeline.length },
  ]

  return (
    <section class="http-response">
      <Show
        when={props.result}
        fallback={
          <div class="http-response-empty">
            <Show when={props.error} fallback={<span>{props.sending ? 'Sending…' : 'No response yet — press Send.'}</span>}>
              <span class="http-response-error" role="alert">
                {props.error}
              </span>
            </Show>
          </div>
        }
      >
        {(result) => (
          <>
            <div class="http-response-strip">
              <Badge tone={statusTone(result().status)} shape="pill">
                {result().status} {result().statusText}
              </Badge>
              <span class="http-response-meta">{result().durationMs} ms</span>
              <span class="http-response-meta">{formatSize(result().size)}</span>
              <Show when={result().redirected}>
                <Badge tone="neutral">redirected</Badge>
              </Show>
              <Show when={result().truncated}>
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
                  <For each={result().headers}>
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
                <ul class="http-timeline">
                  <For each={result().timeline}>
                    {(entry) => (
                      <li class="http-timeline-row" data-label={entry.label}>
                        <span class="http-timeline-label">{entry.label}</span>
                        <span class="http-timeline-detail">{entry.detail}</span>
                      </li>
                    )}
                  </For>
                </ul>
              </Show>
            </div>
          </>
        )}
      </Show>
    </section>
  )
}
