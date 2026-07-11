import { For, Show } from 'solid-js'
import type { RollbarOccurrenceDetail } from '../../../core/shared/api'

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

export default function RollbarOccurrenceView(props: { occurrence: RollbarOccurrenceDetail }) {
  return (
    <article class="rollbar-occurrence-detail">
      <header class="rollbar-occurrence-head">
        <div>
          <span class="rollbar-occurrence-kind">{KIND_LABEL[props.occurrence.kind]}</span>
          <span class="muted"> · <Show when={props.occurrence.url} fallback={`#${props.occurrence.id}`}>
            {(url) => <a class="rollbar-external-id" href={url()} target="_blank" rel="noreferrer">#{props.occurrence.id}</a>}
          </Show></span>
        </div>
        <Show when={relAge(props.occurrence.occurredAt)}>{(age) => <span class="muted">{age()}</span>}</Show>
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
                  <span class="rollbar-frame-file">{frame.filename}</span>
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
