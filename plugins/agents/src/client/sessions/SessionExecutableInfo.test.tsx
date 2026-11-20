import { createSignal } from 'solid-js'
import { render } from 'solid-js/web'
import { afterEach, expect, it } from 'vitest'
import type { AgentProviderDescriptor, AgentSession } from '../../contract/wire.ts'
import SessionExecutableInfo, { SessionExecutableNotice } from './SessionExecutableInfo'

const session: AgentSession = {
  id: 'session',
  taskId: 'task',
  providerId: 'codex',
  profileId: 'codex',
  kind: 'interactive',
  driverKind: 'codex-app-server',
  driverVersion: '1',
  providerSessionRef: 'thread',
  controller: 'acorn',
  runtimeState: 'ready',
  attention: 'none',
  statusAuthority: 'protocol',
  title: 'Session',
  model: null,
  config: { executable: { path: '/node24/bin/codex', version: 'codex-cli 0.159.2' } },
  parentSessionId: null,
  parentTurnId: null,
  subagents: [],
  queuedTurns: 0,
  lastEventSeq: 0,
  lastReadSeq: 0,
  archivedAt: null,
  createdAt: 1,
  updatedAt: 1,
}
const provider: AgentProviderDescriptor = {
  id: 'codex',
  profileId: 'codex',
  label: 'Codex',
  driverKind: 'codex-app-server',
  driverVersion: '1',
  installed: true,
  authenticated: true,
  statusAuthority: 'protocol',
  capabilities: [],
  configOptions: [],
  commands: [],
  skills: [],
  diagnostics: [],
  executable: '/node24/bin/codex',
  executableVersion: 'codex-cli 0.159.2',
}
let dispose: (() => void) | undefined
const host = document.createElement('div')
afterEach(() => {
  dispose?.()
  host.replaceChildren()
})

it('shows the session path and version and warns after refresh finds a different installation', () => {
  const [installed, setInstalled] = createSignal(provider)
  dispose = render(
    () => (
      <>
        <SessionExecutableNotice session={session} provider={installed()} />
        <SessionExecutableInfo session={session} provider={installed()} />
      </>
    ),
    host,
  )
  expect(host.querySelector('[role="status"]')).toBeNull()
  expect(host.textContent).toContain('/node24/bin/codex')
  expect(host.textContent).toContain('codex-cli 0.159.2')
  setInstalled({ ...provider, executable: '/home/owner/.local/bin/codex', executableVersion: 'codex-cli 0.171.0' })
  expect(host.querySelector('[role="status"]')?.textContent).toContain('Start a new session')
  expect(host.textContent).toContain('/home/owner/.local/bin/codex')
  setInstalled(provider)
  expect(host.querySelector('[role="status"]')).toBeNull()
})

it('detects an update at the same path, without flagging stopped sessions or unknown versions', () => {
  const [current, setCurrent] = createSignal(session)
  dispose = render(
    () => (
      <>
        <SessionExecutableNotice
          session={current()}
          provider={{ ...provider, executableVersion: 'codex-cli 0.171.0' }}
        />
        <SessionExecutableInfo session={current()} provider={provider} />
      </>
    ),
    host,
  )
  expect(host.querySelector('[role="status"]')).not.toBeNull()
  setCurrent({ ...session, runtimeState: 'stopped' })
  expect(host.querySelector('[role="status"]')).toBeNull()
  setCurrent({ ...session, config: {} })
  expect(host.querySelector('[role="status"]')).toBeNull()
  expect(host.textContent).toContain('The executable was not recorded')
})
