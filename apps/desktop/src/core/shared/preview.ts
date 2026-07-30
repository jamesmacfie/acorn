// Serializable contracts for the renderer <-> Electron-main preview bridge. The bridge is
// deliberately task-addressed: raw WebContents identifiers and Electron result objects never cross
// into the renderer.

export type PreviewNavigationCommand = 'back' | 'forward' | 'reload' | 'stop' | 'devtools'

export type PreviewState = {
  taskId: string
  url: string
  loading: boolean
  canGoBack: boolean
  canGoForward: boolean
}

export type PreviewFindDirection = 'initial' | 'forward' | 'backward'
export type PreviewFindStopAction = 'clearSelection' | 'keepSelection'

export type PreviewFindResult = {
  taskId: string
  activeMatchOrdinal: number
  matches: number
  finalUpdate: boolean
}

export type PreviewFindRequested = { taskId: string }
