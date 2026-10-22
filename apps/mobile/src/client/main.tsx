import { installPlatform } from './platform'

// The seam first, then the app. A module evaluates once, so one that reached the Node before
// `window.acorn` existed would find no transport for the life of the page.
installPlatform()
await import('./start')

// The app's own files stay for a relaunch (apps/mobile/public/sw.js). The dev server has no use for them.
if (import.meta.env.PROD && 'serviceWorker' in navigator)
  void navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`)
