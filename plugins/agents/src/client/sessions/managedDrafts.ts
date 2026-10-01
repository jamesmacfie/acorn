import { composerDraftState } from '../composer/composerState'

export const managedDraft = (sessionId: string): string => composerDraftState(sessionId).text()

export function hydrateManagedDraft(sessionId: string, value: string): void {
  const state = composerDraftState(sessionId)
  if (!state.text()) state.setText(value)
}

export function setManagedDraft(sessionId: string, value: string): void {
  composerDraftState(sessionId).setText(value)
}

export function appendManagedDraft(sessionId: string, value: string): void {
  const state = composerDraftState(sessionId)
  const existing = state.text()
  state.setText(`${existing}${existing && !existing.endsWith('\n') ? '\n' : ''}${value}`)
}
