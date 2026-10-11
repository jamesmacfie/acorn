import { For, Show, createSignal, onCleanup } from 'solid-js'
import {
  LANGUAGE_REQUEST_TOO_LARGE, languageRequestTooLarge, latestSignal, positionAt, requestDiagnostics,
  type CheckedDiagnostic, type DocumentServiceRoute,
} from '@acorn/plugin-api/client'
import { Button, Row, Text } from '@acorn/plugin-api/ui'

// Diagnostics for a file where nothing draws them as you type: the terminal, whose editor is the
// person's own `$EDITOR` (docs/editor/document-surface.md § Language smarts). The person asks, the file
// as saved is sent to the provider the Node chose, and the answer is listed with each line and column.
// A pointer hover has no equivalent here, and this host has no cursor in Editor to inspect.
type Answer = { label: string; text: string; items: CheckedDiagnostic[] } | { label: string; failed: true } | string

export default function FileDiagnostics(props: {
  nodeId: string
  route: () => DocumentServiceRoute | undefined
  read: () => Promise<string>
}) {
  const [answer, setAnswer] = createSignal<Answer>()
  // Sent with each request, for the language service. The newest check aborts the ones before it.
  let revision = 0
  const checking = latestSignal()
  onCleanup(() => checking.abort())

  const check = async (route: DocumentServiceRoute): Promise<void> => {
    const signal = checking.next()
    const sent = ++revision
    const text = await props.read().catch(() => undefined)
    if (signal.aborted) return
    if (text === undefined || languageRequestTooLarge(text)) {
      setAnswer(text === undefined ? 'Could not read this file.' : LANGUAGE_REQUEST_TOO_LARGE)
      return
    }
    const items = await requestDiagnostics(route.route, props.nodeId, { text, revision: sent }, signal)
    if (signal.aborted) return
    setAnswer(items ? { label: route.label, text, items } : { label: route.label, failed: true })
  }

  const line = (text: string, item: CheckedDiagnostic): string => {
    const { line, column } = positionAt(text, item.from)
    return `${line}:${column} ${item.severity} ${item.message}${item.code ? ` (${item.code})` : ''}`
  }

  return (
    <Show when={props.route()}>
      {(route) => (
        <>
          <Row>
            <Button onPress={() => void check(route())}>Diagnostics</Button>
          </Row>
          <Show when={answer()} keyed>
            {(value) => {
              if (typeof value === 'string') return <Text emphasis="muted" wrap>{value}</Text>
              if ('failed' in value) return <Text emphasis="muted" wrap>{`${value.label} did not answer.`}</Text>
              return (
                <Show when={value.items.length} fallback={<Text emphasis="muted" wrap>{`No problems, from ${value.label}.`}</Text>}>
                  <Text emphasis="muted" wrap>{`From ${value.label}:`}</Text>
                  <For each={value.items}>
                    {(item) => <Text tone={item.severity === 'error' ? 'danger' : item.severity === 'warning' ? 'warn' : undefined} wrap>{line(value.text, item)}</Text>}
                  </For>
                </Show>
              )
            }}
          </Show>
        </>
      )}
    </Show>
  )
}
