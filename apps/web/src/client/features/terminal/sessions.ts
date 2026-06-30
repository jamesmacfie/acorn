// Shared terminal-session store. Lifted out of TerminalPanel so the rail and topbar can read live
// session state even when the drawer is closed — a single onStatus subscription + one session list,
// in the codebase's signals-only style (cf. ../tabs/tabs.ts).
import { createSignal } from 'solid-js'
import { terminalApi } from './terminalClient'
import type { TerminalSession } from '../../../shared/terminal'

const [sessions, setSessions] = createSignal<TerminalSession[]>([])
export { sessions }

export async function refreshSessions(): Promise<void> {
  const api = terminalApi()
  if (!api) return
  setSessions(await api.list())
}

// Pull once then track main-process idle/exit broadcasts. Returns an unsubscribe; a noop when the
// terminal bridge is absent (web build / flag off), so consumers naturally show nothing.
export function initSessions(): () => void {
  const api = terminalApi()
  if (!api) return () => {}
  void refreshSessions()
  return api.onStatus(() => void refreshSessions())
}

// Agents actively working for a tab's repo. Mirrors TerminalPanel's visibleSessions repo predicate
// (repo-less sessions match every tab). "Working" = a running agent that isn't idle.
export function workingCountFor(owner?: string, repo?: string): number {
  return sessions().filter(
    (s) =>
      s.kind === 'agent' &&
      s.status === 'running' &&
      !s.idle &&
      (!s.repo || (s.repo.owner === owner && s.repo.name === repo)),
  ).length
}
