import { afterEach, expect, it, vi } from 'vitest'
import { clientCustodyDirs, configDir } from './listenerConfig'

afterEach(() => {
  vi.unstubAllEnvs()
})

it('lists the client folder, a moved one, and the desktop custody root beside a development Node', () => {
  vi.stubEnv('ACORN_TUI_CONFIG_DIR', '/tmp/acorn-client')
  const dirs = clientCustodyDirs('/repo/apps/node/.acorn/')
  expect(dirs).toEqual(expect.arrayContaining(['/tmp/acorn-client', '/repo/apps/node/.acorn-shell']))
  vi.stubEnv('ACORN_TUI_CONFIG_DIR', '')
  expect(clientCustodyDirs('/repo/apps/node/.acorn')).toContain(configDir())
})

// On Linux the installed desktop keeps its folder under ~/.local/share, not the client's ~/.config.
it("lists an installed desktop Node's own custody root wherever it is", () => {
  expect(clientCustodyDirs('/home/a/.local/share/com.acorn.desktop/node')).toContain(
    '/home/a/.local/share/com.acorn.desktop',
  )
  expect(clientCustodyDirs('/srv/acorn/node')).not.toContain('/srv/acorn')
})
