import { afterEach, describe, expect, it, vi } from 'vitest'
import { SEAM_GROUPS, seamProblems, type SeamGroup } from './contract'
import { canPickFolder, fleetBridge, nodeTransport, pickFolder } from './index'

// The seam contract against a mock host. The same checker runs against each shell's real host object
// in that shell's own suite (apps/desktop/src/shell/bridge.test.ts), which is the half that
// catches a renamed preload key; this half pins the semantics the checker is written against.

// A host that implements everything, shaped as the preload is: flat members for the transport and
// fleet groups, nested objects for the rest.
const fullHost = () => ({
  desktop: true,
  platform: 'darwin',
  onClosePane: vi.fn(() => () => {}),
  onWillQuit: vi.fn(() => () => {}),
  nodeFetch: vi.fn(async () => ({ status: 200, headers: {}, body: new Uint8Array() })),
  nodeAbort: vi.fn(),
  nodeSend: vi.fn(),
  onNodeFrame: vi.fn(() => () => {}),
  onNodeStatus: vi.fn(() => () => {}),
  fleetList: vi.fn(async () => ({ nodes: [], statuses: [] })),
  nodeProbe: vi.fn(),
  nodePair: vi.fn(),
  nodeRename: vi.fn(),
  nodeForget: vi.fn(),
  nodeReconnect: vi.fn(),
  nodeRestartLocal: vi.fn(),
  nodeTunnelOpen: vi.fn(),
  nodeTunnelClose: vi.fn(),
  plugins: { state: vi.fn(), cachePut: vi.fn(), trustRecord: vi.fn(), devGrant: vi.fn() },
  recovery: { openDataFolder: vi.fn(), quit: vi.fn() },
  folderPath: { pick: vi.fn(async () => '/tmp/picked') },
  preview: { ensure: vi.fn(), setBounds: vi.fn(), show: vi.fn(), hide: vi.fn(), load: vi.fn(), command: vi.fn(), evict: vi.fn(), onEvent: vi.fn() },
  webview: { ensure: vi.fn(), setBounds: vi.fn(), show: vi.fn(), hide: vi.fn(), load: vi.fn(), command: vi.fn(), evict: vi.fn(), onEvent: vi.fn(), onBlocked: vi.fn() },
})

const install = (acorn: unknown): void => {
  vi.stubGlobal('window', { acorn })
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('the platform seam contract', () => {
  it('holds for a host that implements every group', () => {
    install(fullHost())
    expect(seamProblems(SEAM_GROUPS)).toEqual([])
  })

  it('holds for no host at all, which is a plain browser served by a node', () => {
    install(undefined)
    expect(seamProblems([])).toEqual([])
  })

  // The shape a phase-2 Tauri shell ships in: no preview panes, no plugin webviews.
  it('holds for a host without the webview groups', () => {
    const { preview: _preview, webview: _webview, ...host } = fullHost()
    install(host)
    expect(seamProblems(SEAM_GROUPS.filter((g) => g !== 'preview' && g !== 'webviews'))).toEqual([])
  })

  it('fails a group the host claims but the seam cannot resolve', () => {
    const { plugins: _plugins, ...host } = fullHost()
    install(host)
    expect(seamProblems(SEAM_GROUPS)).toEqual(['plugins: implemented by the host but the seam resolved null'])
  })

  it('fails a group the host half-builds', () => {
    const host = fullHost()
    const { onEvent: _onEvent, ...preview } = host.preview
    install({ ...host, preview })
    expect(seamProblems(SEAM_GROUPS)).toEqual(['preview.onEvent: not a function'])
  })

  it('fails a group that resolves on a host which does not declare it', () => {
    install(fullHost())
    expect(seamProblems(SEAM_GROUPS.filter((g) => g !== 'recovery'))).toEqual(['recovery: resolved on a host that does not implement it'])
  })

  // The discriminator rules the groups are built on, since the checker above only sees whole groups.
  describe('the discriminators', () => {
    it('makes nodeFetch alone stand up the transport, with the rest degrading to no-ops', () => {
      install({ nodeFetch: vi.fn() })
      const transport = nodeTransport()
      expect(transport).not.toBeNull()
      expect(() => transport?.abort('r1')).not.toThrow()
      expect(() => transport?.send('n1', { channel: 'x' } as never)).not.toThrow()
      expect(transport?.onFrame(() => {})).toBeTypeOf('function')
      expect(transport?.onStatus(() => {})).toBeTypeOf('function')
    })

    it('lets a host read the fleet without being able to change it', async () => {
      install({ nodeFetch: vi.fn(), fleetList: vi.fn(async () => ({ nodes: [], statuses: [] })) })
      const fleet = fleetBridge()
      expect(fleet).not.toBeNull()
      expect(() => fleet?.probe('https://1.2.3.4')).toThrow(/cannot pair/)
      await expect(fleet?.restartLocal()).rejects.toThrow(/does not supervise/)
      // A rename or a forget the host cannot perform is not an error: the caller learns nothing changed.
      await expect(fleet?.rename('n1', 'x')).resolves.toBeNull()
      await expect(fleet?.forget('n1', false)).resolves.toBeUndefined()
    })

    it('answers the folder picker the same way whether it is missing or dismissed', async () => {
      install({})
      expect(canPickFolder()).toBe(false)
      await expect(pickFolder()).resolves.toBeNull()
      install({ folderPath: { pick: async () => null } })
      expect(canPickFolder()).toBe(true)
      await expect(pickFolder()).resolves.toBeNull()
    })
  })

  it('names every group in the seam, so a new one cannot be added without a decision here', () => {
    const expected: SeamGroup[] = [
      'desktop',
      'transport',
      'fleet',
      'pairing',
      'plugins',
      'desktopExtras',
      'folderPicker',
      'recovery',
      'preview',
      'webviews',
    ]
    expect(SEAM_GROUPS).toEqual(expected)
  })
})
