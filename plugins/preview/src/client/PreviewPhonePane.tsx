import { createResource, createSignal, Match, onCleanup, Switch } from 'solid-js'
import { activeNodeId, writeJson, type Task } from '@acorn/plugin-api/client'
import { Button, EmptyState, Rectangle, Spinner } from '@acorn/plugin-api/ui'
import { previewOpenRoute } from '../shared/api'

// What a page in the frame says when the browser held back the cookie that opens it. Safari does, for a
// frame from another site (apps/mobile and docs/relay/phone-channel.md § Previews).
const COOKIE_BLOCKED = 'acorn-preview:cookie-blocked'

type Opened =
  | { kind: 'ready'; url: string }
  | { kind: 'none' }
  // `message` is the Node's own sentence, which says what to do.
  | { kind: 'unavailable'; message: string }
  | { kind: 'failed' }

async function open(taskId: string, nodeId: string | null, ancestor?: string): Promise<Opened> {
  try {
    const { url } = await writeJson<{ url: string }>(previewOpenRoute(taskId), {
      method: 'POST',
      nodeId,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(ancestor ? { ancestor } : {}),
    })
    return { kind: 'ready', url }
  } catch (error) {
    const { status, message } = error as { status?: number; message?: string }
    if (status === 404) return { kind: 'none' }
    return status === 503 && message ? { kind: 'unavailable', message } : { kind: 'failed' }
  }
}

// A task's running app, shown by the Node through the relay. The page is a frame on a name of its own, so
// it reaches only itself, and the Node refuses any request that doesn't carry the cookie this phone's grant
// issued. Where the browser won't keep that cookie in a frame, the page says so and the pane offers the
// same app as a page of its own.
export default function PreviewPhonePane(props: { task: Task }) {
  const [attempt, setAttempt] = createSignal(0)
  const [blocked, setBlocked] = createSignal(false)
  let frame: HTMLIFrameElement | undefined

  // `ancestor` lets the Node frame-protect the page: only this app may embed it.
  const [framed] = createResource(
    () => ({ taskId: props.task.id, nodeId: activeNodeId(), attempt: attempt() }),
    (key) => {
      setBlocked(false)
      return open(key.taskId, key.nodeId, window.location.origin)
    },
  )
  // Asked for as soon as the frame reports the problem, so the button opens it in the same tap.
  const [standalone] = createResource(blocked, (isBlocked) =>
    isBlocked ? open(props.task.id, activeNodeId()) : Promise.resolve(undefined),
  )

  const onMessage = (event: MessageEvent) => {
    const opened = framed.latest
    if (opened?.kind !== 'ready' || event.source !== frame?.contentWindow) return
    if (event.origin === new URL(opened.url).origin && event.data === COOKIE_BLOCKED) setBlocked(true)
  }
  window.addEventListener('message', onMessage)
  onCleanup(() => window.removeEventListener('message', onMessage))

  const retry = () => setAttempt((value) => value + 1)
  // The kit hands over the box and the page draws into it, so the pane writes no markup of its own.
  const mountFrame = (address: string) => (box: HTMLElement) => {
    frame = document.createElement('iframe')
    frame.title = 'Preview'
    frame.src = address
    frame.referrerPolicy = 'no-referrer'
    // No `allow-top-navigation`, so the page can't send the whole app somewhere else.
    frame.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-forms allow-modals')
    Object.assign(frame.style, { width: '100%', height: '100%', border: '0' })
    box.append(frame)
  }
  const url = () => {
    const opened = framed()
    return opened?.kind === 'ready' ? opened.url : undefined
  }
  const unavailable = () => {
    const opened = framed()
    return opened?.kind === 'unavailable' ? opened.message : undefined
  }
  const openStandalone = () => {
    const page = standalone()
    if (page?.kind === 'ready') window.open(page.url, '_blank', 'noopener,noreferrer')
  }

  return (
    <Switch>
      <Match when={framed.loading}>
        <Spinner label="Opening preview" />
      </Match>
      <Match when={blocked()}>
        <EmptyState
          title="This browser blocks the preview in a frame"
          action={
            <Button onPress={openStandalone} disabled={standalone()?.kind !== 'ready'}>
              Open preview
            </Button>
          }
        >
          Open it as a page of its own instead. Hot reload still works there.
        </EmptyState>
      </Match>
      <Match when={url()} keyed>
        {(address) => <Rectangle kind="frame" label="Preview" mount={mountFrame(address)} />}
      </Match>
      <Match when={framed()?.kind === 'none'}>
        <EmptyState title="No preview address">
          The app isn't running on this Node, or its address isn't on the Node's own computer.
        </EmptyState>
      </Match>
      <Match when={unavailable()}>
        {(message) => (
          <EmptyState title="Preview isn't ready" action={<Button onPress={retry}>Try again</Button>}>
            {message()}
          </EmptyState>
        )}
      </Match>
      <Match when={true}>
        <EmptyState title="Could not open the preview" action={<Button onPress={retry}>Try again</Button>} />
      </Match>
    </Switch>
  )
}
