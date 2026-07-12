import { createSignal, For, Show } from 'solid-js'
import type { RollbarItemSummary, RollbarOccurrenceDetail } from '../../../core/shared/api'
import { openPane } from '../../../core/client/registries/clientEvents'
import { agentContext, frameRepoPath } from './model'

const relAge = (at: number | null): string => {
  if (!at) return ''
  const seconds = Math.max(0, Math.round((Date.now() - at) / 1000))
  if (seconds < 60) return `${seconds}s ago`
  if (seconds < 3600) return `${Math.round(seconds / 60)}m ago`
  if (seconds < 86400) return `${Math.round(seconds / 3600)}h ago`
  return `${Math.round(seconds / 86400)}d ago`
}

const KIND_LABEL: Record<RollbarOccurrenceDetail['kind'], string> = {
  trace: 'Exception',
  'trace-chain': 'Exception chain',
  message: 'Message',
  'crash-report': 'Crash report',
  unknown: 'Occurrence',
}

export default function RollbarOccurrenceView(props: {
  occurrence: RollbarOccurrenceDetail
  item?: RollbarItemSummary
  taskId?: string
}) {
  const [copied, setCopied] = createSignal(false)
  let copyTimer: ReturnType<typeof setTimeout> | undefined
  const copyContext = () => {
    void navigator.clipboard.writeText(agentContext(props.item, props.occurrence))
    setCopied(true)
    clearTimeout(copyTimer)
    copyTimer = setTimeout(() => setCopied(false), 1200)
  }
  // In-project frames open in the task's editor via the core pane-intent bus (editor:reveal opens the
  // tab and scrolls to the line). Needs a task — only the task pane supplies one.
  const revealFrame = (path: string, line: number | null) => {
    openPane(props.taskId!, 'editor', { kind: 'editor:reveal', path, line: line ?? 1 }, 'add')
  }
  return (
    <article class="rollbar-occurrence-detail">
      <header class="rollbar-occurrence-head">
        <div>
          <span class="rollbar-occurrence-kind">{KIND_LABEL[props.occurrence.kind]}</span>
          <span class="muted"> · <Show when={props.occurrence.url} fallback={`#${props.occurrence.id}`}>
            {(url) => <a class="rollbar-external-id" href={url()} target="_blank" rel="noreferrer">#{props.occurrence.id}</a>}
          </Show></span>
        </div>
        <span class="rollbar-occurrence-head-actions">
          <button type="button" class="new-pr-btn" title="Copy the exception, trace, and facts for pasting into a task terminal" onClick={copyContext}>
            {copied() ? 'Copied' : 'Copy as agent context'}
          </button>
          <Show when={relAge(props.occurrence.occurredAt)}>{(age) => <span class="muted">{age()}</span>}</Show>
        </span>
      </header>

      <Show when={props.occurrence.exceptionClass || props.occurrence.message} fallback={<p class="muted">No message was supplied for this occurrence.</p>}>
        <p class="rollbar-exception">
          <Show when={props.occurrence.exceptionClass}>{(name) => <span class="rollbar-exception-class">{name()}: </span>}</Show>
          {props.occurrence.message}
        </p>
      </Show>

      <Show when={props.occurrence.frames.length} fallback={<p class="muted">No stack frames are available.</p>}>
        <ul class="rollbar-frames">
          <For each={props.occurrence.frames}>
            {(frame) => (
              <li class="rollbar-frame" classList={{ 'rollbar-frame-app': frame.inProject === true }}>
                <div class="rollbar-frame-loc">
                  <Show
                    when={props.taskId && frame.inProject === true ? frameRepoPath(frame.filename) : null}
                    fallback={<span class="rollbar-frame-file">{frame.filename}</span>}
                  >
                    {(path) => (
                      <button type="button" class="rollbar-frame-open" title={`Open ${path()} in the editor`} onClick={() => revealFrame(path(), frame.line)}>
                        {frame.filename}
                      </button>
                    )}
                  </Show>
                  <Show when={frame.line != null}><span class="muted">:{frame.line}{frame.column != null ? `:${frame.column}` : ''}</span></Show>
                  <Show when={frame.method}>{(method) => <span class="rollbar-frame-method"> {method()}</span>}</Show>
                </div>
                <Show when={frame.code.length}>
                  <pre class="rollbar-frame-code"><For each={frame.code}>{(line) => <div classList={{ 'rollbar-code-anchor': line.line === frame.line }}><span class="rollbar-code-ln">{line.line}</span>{line.text}</div>}</For></pre>
                </Show>
              </li>
            )}
          </For>
        </ul>
      </Show>

      <dl class="rollbar-facts rollbar-context">
        <Show when={props.occurrence.request}>{(request) => (<><dt>Request</dt><dd>{[request().method, request().url].filter(Boolean).join(' ') || '—'}</dd></>)}</Show>
        <Show when={props.occurrence.environment}>{(env) => (<><dt>Environment</dt><dd>{env()}</dd></>)}</Show>
        <Show when={props.occurrence.context}>{(context) => (<><dt>Context</dt><dd>{context()}</dd></>)}</Show>
        <Show when={props.occurrence.codeVersion}>{(version) => (<><dt>Version</dt><dd>{version()}</dd></>)}</Show>
        <Show when={props.occurrence.language || props.occurrence.platform || props.occurrence.framework}>
          <dt>Runtime</dt><dd>{[props.occurrence.language, props.occurrence.platform, props.occurrence.framework].filter(Boolean).join(' · ')}</dd>
        </Show>
        <Show when={props.occurrence.server}>{(server) => (<Show when={server().host || server().branch}><dt>Server</dt><dd>{[server().host, server().branch].filter(Boolean).join(' · ')}</dd></Show>)}</Show>
        <Show when={props.occurrence.person}>{(person) => (<Show when={person().id || person().username || person().email}><dt>Person</dt><dd>{person().username || person().id || person().email}</dd></Show>)}</Show>
        <Show when={props.occurrence.notifier}>{(notifier) => (<Show when={notifier().name}><dt>Notifier</dt><dd>{[notifier().name, notifier().version].filter(Boolean).join(' ')}</dd></Show>)}</Show>
      </dl>

      <Show when={props.occurrence.truncated}>
        <p class="muted rollbar-truncated">Some occurrence data was omitted by Acorn's size and privacy limits.</p>
      </Show>
    </article>
  )
}
