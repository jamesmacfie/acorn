export type FileTreeRevealRequest = {
  path: string
  revision: number
}

// Segment-aware containment keeps similarly-prefixed siblings separate: revealing
// `src/application.ts` must not expand `src/app`.
export const directoryContainsFile = (directoryPath: string, filePath: string): boolean =>
  filePath.startsWith(`${directoryPath}/`)

export const canRevealActiveFile = (context: {
  paneTaskId: string
  activeTaskId: string | null
  focusedPane: string | undefined
  activeFile: string | null
  treeAvailable: boolean
}): boolean =>
  context.paneTaskId === context.activeTaskId
  && context.focusedPane === 'editor'
  && context.activeFile !== null
  && context.treeAvailable
