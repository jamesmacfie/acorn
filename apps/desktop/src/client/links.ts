import { desktopLinks } from '@acorn/client-core/infra/platform'
import { createLogger } from '@acorn/client-core/infra/telemetry'
import { clientEvents, openLink, reportLinkFailure } from '@acorn/client-core/host/registries/commands'

const log = createLogger('links')
let opening = Promise.resolve()

function enqueue(href: string) {
  const next = opening.then(() => openLink(href)).catch((error: unknown) => {
    log.error('Could not open Acorn link', error)
    return reportLinkFailure(href, error instanceof Error ? error.message : String(error))
  })
  opening = next.then(() => {})
  return next
}

let draining = Promise.resolve()
function drainNativeLinks(): Promise<void> {
  const next = draining.then(async () => {
    const shell = desktopLinks()
    if (!shell) return
    for (const href of await shell.takePending()) await enqueue(href)
  })
  draining = next.catch((error: unknown) => log.error('Could not receive Acorn links', error))
  return next
}

/** Subscribe before draining. Rust retains URLs that arrive before this renderer has a listener. */
export async function startDesktopLinks(): Promise<() => void> {
  const stopContent = clientEvents.on('presentation:open-link', ({ href }) => {
    void enqueue(href).catch((error: unknown) => log.error('Could not report Acorn link refusal', error))
  })
  // The agent driver dispatches into this renderer; its debug shell has no OS scheme registration.
  const onAgentLink = (event: Event) => {
    const { href, done } = (event as CustomEvent<{ href: string; done: (result: unknown) => void }>).detail
    void enqueue(href).then(done, (error: unknown) => done({ kind: 'error', reason: String(error) }))
  }
  window.addEventListener('acorn:agent-link', onAgentLink)
  const stop = (stopNative: () => void = () => {}) => () => {
    stopNative()
    stopContent()
    window.removeEventListener('acorn:agent-link', onAgentLink)
  }
  const shell = desktopLinks()
  if (!shell) return stop()
  let stopNative = () => {}
  try {
    stopNative = await shell.subscribe(() => { void drainNativeLinks().catch(() => {}) })
    await drainNativeLinks()
    return stop(stopNative)
  } catch (error) {
    log.error('Could not listen for Acorn links', error)
    return stop(stopNative)
  }
}
