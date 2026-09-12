import { render } from 'solid-js/web'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AgentSession, AgentSessionDelegation, AgentSubagent } from '@acorn/protocol/managedAgents.ts'
import type { AgentPaneModel } from './agentPaneModel'
import { agentSessionRoster } from './sessionRoster'
import {
  clearManagedSession,
  clearManagedSubagent,
  selectManagedSession,
  selectedManagedSession,
  selectedManagedSubagent,
} from './managedSelection'
import AgentTaskSidebar from './AgentTaskSidebar'

const taskId = 'task-sidebar'
const session = (id: string, over: Partial<AgentSession> = {}): AgentSession => ({
  id,
  taskId,
  providerId: 'codex',
  profileId: 'codex',
  kind: 'interactive',
  driverKind: 'codex-app-server',
  driverVersion: '1',
  providerSessionRef: null,
  controller: 'acorn',
  runtimeState: 'ready',
  attention: 'none',
  statusAuthority: 'protocol',
  title: id,
  model: null,
  config: {},
  parentSessionId: null,
  parentTurnId: null,
  subagents: [], queuedTurns: 0,
  lastEventSeq: 0,
  lastReadSeq: 0,
  archivedAt: null,
  createdAt: 1,
  updatedAt: 1,
  ...over,
})

const nativeSubagent: AgentSubagent = {
  id: 'native',
  turnId: null,
  title: 'Provider child',
  status: 'running',
  startedAt: 1,
  updatedAt: 2,
}

let host: HTMLDivElement
let dispose: (() => void) | undefined

const mount = (
  sessions: AgentSession[],
  delegations: Record<string, AgentSessionDelegation>,
): void => {
  const model = {
    taskSessions: () => sessions,
    sessionRoster: () => agentSessionRoster(sessions, delegations),
    selectedSessionId: () => selectedManagedSession(taskId),
    sessionsLoaded: Promise.resolve(sessions),
    sessionAction: vi.fn(),
  } as unknown as AgentPaneModel
  host = document.createElement('div')
  document.body.append(host)
  dispose = render(() => <AgentTaskSidebar task={{ id: taskId } as never} model={model} />, host)
}

const rowNamed = (title: string): HTMLElement => {
  const text = [...host.querySelectorAll('.ui-row-body')].find((item) => item.textContent?.includes(title))
  const row = text?.closest('.ui-row') as HTMLElement | null
  if (!row) throw new Error(`Missing row '${title}'.`)
  return row
}

afterEach(() => {
  dispose?.()
  host?.remove()
  clearManagedSubagent('root')
  clearManagedSubagent('terminal-child')
  clearManagedSession(taskId)
})

describe('the delegated session sidebar', () => {
  it('renders nested managed and terminal-owned children with state, attention, depth, and isolation', () => {
    const root = session('root', { title: 'Parent' })
    const managedChild = session('managed-child', {
      kind: 'delegated',
      title: 'Nested child',
      runtimeState: 'waiting',
      attention: 'permission',
      parentSessionId: root.id,
    })
    const terminalChild = session('terminal-child', { kind: 'delegated', title: 'Terminal child' })
    mount([managedChild, terminalChild, root], {
      'managed-child': {
        sessionId: managedChild.id,
        depth: 1,
        isolation: 'shared',
        owner: { kind: 'managed', parentSessionId: root.id },
      },
      'terminal-child': {
        sessionId: terminalChild.id,
        depth: 1,
        isolation: 'shared',
        owner: { kind: 'terminal', label: 'Claude terminal', profileId: 'claude-code' },
      },
    })

    expect(rowNamed('Nested child').dataset.depth).toBe('1')
    expect(rowNamed('Nested child').textContent).toContain('waiting')
    // The attention mark is an icon now, so what a reader gets is its title rather than a pill's words.
    expect(rowNamed('Nested child').querySelector('svg > title')?.textContent).toBe('Wants permission')
    expect(rowNamed('Nested child').textContent).toContain('depth 1 · shared')
    expect(rowNamed('Terminal child').dataset.depth).toBeUndefined()
    expect(rowNamed('Terminal child').textContent)
      .toContain('Delegated by Claude terminal (claude-code) · depth 1 · shared')
  })

  it('keeps key-based managed and provider-subagent selection behavior', () => {
    const root = session('root', { title: 'Parent', subagents: [nativeSubagent] })
    const child = session('managed-child', { kind: 'delegated', title: 'Managed child', parentSessionId: root.id })
    selectManagedSession(taskId, child.id)
    mount([child, root], {
      'managed-child': {
        sessionId: child.id,
        depth: 1,
        isolation: 'shared',
        owner: { kind: 'managed', parentSessionId: root.id },
      },
    })

    expect(rowNamed('Managed child').getAttribute('aria-selected')).toBe('true')
    rowNamed('Provider child').click()
    expect(selectedManagedSession(taskId)).toBe(root.id)
    expect(selectedManagedSubagent(root.id)).toBe(nativeSubagent.id)
    expect(rowNamed('Provider child').getAttribute('aria-selected')).toBe('true')

    rowNamed('Parent').click()
    expect(selectedManagedSession(taskId)).toBe(root.id)
    expect(selectedManagedSubagent(root.id)).toBeUndefined()
    expect(rowNamed('Parent').getAttribute('aria-selected')).toBe('true')
  })
})
