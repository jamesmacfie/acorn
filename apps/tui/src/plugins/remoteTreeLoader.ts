import { lazy } from 'solid-js'

// Both the shell seam and the host facade use this component. The kit table and tree host are
// needed only when an accepted plugin actually renders a remote tree.
export const RemoteTree = lazy(() => import('./RemoteTree').then((module) => ({ default: module.RemoteTree })))
