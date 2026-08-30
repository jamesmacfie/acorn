export type FileTreeRevealRequest = {
  path: string
  revision: number
}

// `directoryContainsFile` lived here until phase 9 of the layout programme: the recursive tree asked
// every directory component whether it contained the file being revealed. The flat tree splits the
// path instead, so the containment test has no caller and segment-aware matching is a property of
// splitting on '/' rather than a function (FileTree.tsx).

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
