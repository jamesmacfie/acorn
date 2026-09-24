// The window's startup failure screen. Static imports run before a module's body, so an error anywhere
// in the renderer graph would otherwise leave an empty white window before index.tsx could install its
// telemetry handlers.
//
// A deferred classic script, named in index.html ahead of the module script. Deferred scripts and
// module scripts run in document order once parsing finishes, so these listeners are in place before
// any app module evaluates. Deferred rather than parser-blocking because a parser-blocking script
// stalled the window's start by up to 2.6 s whenever the automation driver (`pnpm dev:agent`) polled
// the page during the load.
//
// It is a file in public/, not inline markup, because the renderer's policy is `script-src 'self'`
// (src-tauri/src/app_scheme.rs). It is not a module, because a module entry that dynamic-imports the
// app costs a serial fetch in front of the whole graph and loses the page's preloads.
//
// A module that throws, does not parse, or rejects a top-level await is an `error` event on the
// window. A module that cannot be fetched fails the whole graph, which fires `error` at the module
// script element instead. That one does not bubble, so the listener is registered for the capture
// phase.
//
// It does not listen for `unhandledrejection`, which the module guard before it did. Every failure
// above reaches `error` in both WebKit and Chromium, and a promise nobody awaited does not stop the
// app from starting. One such promise is known: tauri-plugin-notification's injected script asks for
// `is_permission_granted`, which the capability file does not grant. It usually rejects before any
// page script runs, but not always, and a guard listening for it has drawn this screen with that
// message in place of the real error.
{
  const showStartupFailure = (reason) => {
    const root = document.getElementById('root')
    if (!root || root.childElementCount > 0) return
    const main = document.createElement('main')
    main.setAttribute('role', 'alert')
    main.style.cssText = 'max-width:42rem;margin:10vh auto;padding:2rem;font:14px system-ui;color:#222'
    const heading = document.createElement('h1')
    heading.textContent = 'Acorn could not start'
    const detail = document.createElement('pre')
    detail.style.cssText = 'white-space:pre-wrap;overflow-wrap:anywhere'
    // WebKit's `stack` is the frames alone, without the `Name: message` line V8 starts it with. A
    // string reason is a message the guard wrote itself, and a stack made here would only point at
    // this file.
    const message = String(reason)
    const stack = reason instanceof Error ? (reason.stack ?? '') : ''
    detail.textContent = stack.startsWith(message) ? stack : [message, stack].filter(Boolean).join('\n')
    // A module that failed to load is often a one-off fetch miss, and a fresh load fetches it again.
    const reload = document.createElement('button')
    reload.type = 'button'
    reload.textContent = 'Reload'
    reload.addEventListener('click', () => location.reload())
    main.append(heading, detail, reload)
    root.replaceChildren(main)
  }

  const onError = (event) => {
    // The capture phase also sees an image or a stylesheet that failed to load. Only a script's
    // failure stops the app.
    const target = event.target
    if (target !== window && !(target instanceof HTMLScriptElement)) return
    window.removeEventListener('error', onError, true)
    showStartupFailure(target === window ? (event.error ?? event.message) : `Could not load ${target.src}`)
  }

  window.addEventListener('error', onError, true)
}
