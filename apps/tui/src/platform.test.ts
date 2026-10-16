import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { SEAM_GROUPS, seamProblems, type SeamGroup } from '@acorn/client-core/infra/platform'
import type { OpenedNode } from './node/open'

// The terminal client's half of the platform-seam contract, beside the desktop's
// (apps/desktop/src/shell/bridge.test.ts). Unlike the desktop, a terminal leaves some groups out on
// purpose, so the list below is the decision: a group added to the seam fails here until it is named
// as implemented or left out.

const configDir = mkdtempSync(join(tmpdir(), 'acorn-tui-platform-'))
process.env.ACORN_TUI_CONFIG_DIR = configDir
const { installPlatform } = await import('./platform')

const IMPLEMENTED: SeamGroup[] = [
  'transport',
  'fleet',
  'pairing',
  'plugins',
  'config',
  'files',
  'notify',
  'recovery',
  'oauthCallback',
]
const LEFT_OUT: SeamGroup[] = [
  'desktop',
  'desktopExtras',
  'cli',
  'folderPicker',
  'rendererLayer',
  'preview',
  'webviews',
]

const opened = {
  nodeId: 'node-1',
  fleet: { list: () => [], get: () => null, tokenFor: () => null },
  supervised: false,
  stop: async () => undefined,
} as unknown as OpenedNode
const platform = installPlatform(opened, () => undefined)

afterAll(async () => {
  await platform.dispose()
  rmSync(configDir, { recursive: true, force: true })
})

describe('the terminal client satisfies the platform seam', () => {
  it('implements the groups it claims, completely, and nothing else', () => {
    expect(seamProblems(IMPLEMENTED)).toEqual([])
    expect([...IMPLEMENTED, ...LEFT_OUT].sort()).toEqual([...SEAM_GROUPS].sort())
  })
})
