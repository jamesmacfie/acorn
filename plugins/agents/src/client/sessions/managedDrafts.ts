import { composerDraftState } from '../composer/composerState'

export const managedDraft = (sessionId: string): string => composerDraftState(sessionId).text()

export function appendManagedDraft(sessionId: string, value: string): void {
  const state = composerDraftState(sessionId)
  const existing = state.text()
  state.setText(`${existing}${existing && !existing.endsWith('\n') ? '\n' : ''}${value}`)
}
