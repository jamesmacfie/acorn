import { desktopLinks } from '@acorn/client-core/infra/platform'
import { createLogger } from '@acorn/client-core/infra/telemetry'
import { clientEvents, openLink } from '@acorn/client-core/host/registries/commands'

const log = createLogger('links')
let opening = Promise.resolve()

function enqueue(href: string) {
  const next = opening.then(() => openLink(href))
  opening = next.then(() => {}, (error: unknown) => log.error('Could not open Acorn link', error))
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
export async function startDesktopLinks(): Promise<void> {
  clientEvents.on('presentation:open-link', ({ href }) => { void enqueue(href) })
  // The agent driver dispatches into this renderer; its debug shell has no OS scheme registration.
  window.addEventListener('acorn:agent-link', (event) => {
    const { href, done } = (event as CustomEvent<{ href: string; done: (result: unknown) => void }>).detail
    void enqueue(href).then(done, (error: unknown) => done({ kind: 'error', reason: String(error) }))
  })
  const shell = desktopLinks()
  if (!shell) return
  try {
    await shell.subscribe(() => { void drainNativeLinks() })
    await drainNativeLinks()
  } catch (error) {
    log.error('Could not listen for Acorn links', error)
  }
}
