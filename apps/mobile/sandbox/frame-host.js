// Host-owned code at https://<label>.<sandbox domain>/frame-host.js. The plugin's frame bundle never runs from
// bytes this page hasn't checked against its own name (bundle-check.js). The phone app posts them after this
// page says it is ready, and the page tells it when the module has evaluated, which is when the bundle is
// listening for the bridge (packages/client-core/src/host/frames/phoneFrame.ts).
const nonce = location.hash.slice(1)
let started = false

// What these messages carry is the nonce the parent chose, so '*' reveals nothing, as in worker-host.js.
const tell = (kind) => window.parent.postMessage({ kind, nonce }, '*')

window.addEventListener('message', async (event) => {
  const message = event.data
  if (started || event.source !== window.parent) return
  if (message?.kind !== 'acorn:frame-bundle' || message.nonce !== nonce || !(message.bundle instanceof ArrayBuffer)) return
  started = true
  try {
    const url = await checkedBundleUrl(message.bundle)
    try {
      await import(url)
    } finally {
      URL.revokeObjectURL(url)
    }
    tell('acorn:frame-loaded')
  } catch {
    tell('acorn:frame-error')
  }
})

tell('acorn:frame-ready')
