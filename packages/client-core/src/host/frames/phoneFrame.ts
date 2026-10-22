import { bundleSource } from '../tree/sandboxOrigin'

// How a frame's bundle starts on the phone. The desktop's scheme handler serves the bundle as `/client.js`
// and the iframe's `load` event says it has run. A browser has no such cache, so the phone app posts the
// bytes to the frame page on the sandbox domain, which checks them against its own host name and imports
// them from a `blob:` URL (apps/mobile/sandbox/frame-host.js, docs/mobile/plugin-sandbox.md § Frames).
//
// The page speaks first, with `acorn:frame-ready`, and the host answers with `acorn:frame-bundle`. The page
// says `acorn:frame-loaded` once the module has evaluated, which is the moment `load` stands for on the
// desktop: the bundle's `connect()` is listening, so the host can transfer the bridge port. `acorn:frame-error`
// is the page refusing the bytes or failing to import them.

const START_DEADLINE_MS = 10_000

export function startPhoneFrame(
  frame: HTMLIFrameElement,
  frameId: { hash: string; origin: string; nonce: string },
  signal: AbortSignal,
): Promise<void> {
  return new Promise((resolve, reject) => {
    let requested = false
    const finish = (settle: () => void): void => {
      clearTimeout(deadline)
      window.removeEventListener('message', onMessage)
      signal.removeEventListener('abort', onAbort)
      settle()
    }
    // The frame is gone, so nobody is waiting.
    const onAbort = (): void => finish(() => {})
    const deliver = (target: Window, bytes: ArrayBuffer): void => {
      try {
        target.postMessage({ kind: 'acorn:frame-bundle', nonce: frameId.nonce, bundle: bytes }, frameId.origin)
      } catch (error) {
        finish(() => reject(error))
      }
    }
    const onMessage = (event: MessageEvent): void => {
      // An unrelated frame, even one on this origin, can't ask for the bytes or say they ran.
      const target = frame.contentWindow
      if (!target || event.source !== target || event.origin !== frameId.origin) return
      const data = event.data as { kind?: unknown; nonce?: unknown } | null
      if (data?.nonce !== frameId.nonce) return
      if (data.kind === 'acorn:frame-loaded') return finish(resolve)
      if (data.kind === 'acorn:frame-error') return finish(() => reject(new Error('the frame page refused the bundle')))
      if (data.kind !== 'acorn:frame-ready' || requested) return
      requested = true
      const read = bundleSource()
      if (!read) return finish(() => reject(new Error('no source for the plugin bundle on this device')))
      read(frameId.hash).then(
        (bytes) => {
          if (!signal.aborted) deliver(target, bytes)
        },
        () => finish(() => reject(new Error('the plugin bundle could not be read'))),
      )
    }
    const deadline = setTimeout(
      () => finish(() => reject(new Error('the frame page did not start the bundle'))),
      START_DEADLINE_MS,
    )
    window.addEventListener('message', onMessage)
    signal.addEventListener('abort', onAbort)
  })
}
