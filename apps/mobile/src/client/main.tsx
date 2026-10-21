import { installPlatform } from './platform'

// The seam first, then the app. A module evaluates once, so one that reached the Node before
// `window.acorn` existed would find no transport for the life of the page.
installPlatform()
await import('./start')
