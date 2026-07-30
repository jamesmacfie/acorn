import { createSignal } from 'solid-js'

const [drafts, setDrafts] = createSignal<Record<string, string>>({})

export const managedDraft = (sessionId: string): string => drafts()[sessionId] ?? ''

export function hydrateManagedDraft(sessionId: string, value: string): void {
  setDrafts((current) => sessionId in current ? current : { ...current, [sessionId]: value })
}

export function setManagedDraft(sessionId: string, value: string): void {
  setDrafts((current) => current[sessionId] === value ? current : { ...current, [sessionId]: value })
}

export function appendManagedDraft(sessionId: string, value: string): void {
  setDrafts((current) => {
    const existing = current[sessionId] ?? ''
    const next = `${existing}${existing && !existing.endsWith('\n') ? '\n' : ''}${value}`
    return { ...current, [sessionId]: next }
  })
}
