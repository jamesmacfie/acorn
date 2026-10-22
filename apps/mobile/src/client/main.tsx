import { installPlatform } from './platform'

// The seam first, then the app. A module evaluates once, so one that reached the Node before
// `window.acorn` existed would find no transport for the life of the page.
installPlatform()
// The sandbox check page stands apart from the account and the Nodes (./devSandbox.tsx). A production
// build drops this branch.
if (import.meta.env.DEV && location.pathname === `${import.meta.env.BASE_URL}dev/sandbox`) await import('./devSandbox')
else await import('./start')

// The app's own files stay for a relaunch (apps/mobile/public/sw.js). The dev server has no use for them.
if (import.meta.env.PROD && 'serviceWorker' in navigator)
  void navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`)
