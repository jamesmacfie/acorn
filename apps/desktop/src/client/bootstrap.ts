// Static imports run before a module's body, so an error anywhere in the renderer graph used to
// leave an empty white window before index.tsx could install its telemetry handlers. Keep this
// dependency-free boundary first and make an early startup failure visible and diagnosable.
const root = document.getElementById('root')

const showStartupFailure = (reason: unknown) => {
  if (!root || root.childElementCount > 0) return
  const error = reason instanceof Error ? reason : new Error(String(reason))
  const main = document.createElement('main')
  main.setAttribute('role', 'alert')
  main.style.cssText = 'max-width:42rem;margin:10vh auto;padding:2rem;font:14px system-ui;color:#222'
  const heading = document.createElement('h1')
  heading.textContent = 'Acorn could not start'
  const detail = document.createElement('pre')
  detail.style.cssText = 'white-space:pre-wrap;overflow-wrap:anywhere'
  detail.textContent = error.stack || error.message
  main.append(heading, detail)
  root.replaceChildren(main)
}

window.addEventListener('error', event => showStartupFailure(event.error ?? event.message), { once: true })
window.addEventListener('unhandledrejection', event => showStartupFailure(event.reason), { once: true })

void import('./index.tsx').catch(showStartupFailure)
