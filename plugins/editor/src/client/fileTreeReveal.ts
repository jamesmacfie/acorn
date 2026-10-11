/** One request to reveal a path in the tree. The tree acknowledges it by identity, so asking
 *  for the same path twice makes two requests. */
export type FileTreeRevealRequest = {
  path: string
}

export const canRevealActiveFile = (context: {
  paneTaskId: string
  activeTaskId: string | null
  focusedPane: string | undefined
  activeFile: string | null
  treeAvailable: boolean
}): boolean =>
  context.paneTaskId === context.activeTaskId &&
  context.focusedPane === 'editor' &&
  context.activeFile !== null &&
  context.treeAvailable
