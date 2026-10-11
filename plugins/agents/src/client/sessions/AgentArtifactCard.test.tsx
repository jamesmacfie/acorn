import { render } from 'solid-js/web'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  extensionPointRegistry,
  extensionRegistry,
  type Disposable,
  type ExtensionContribution,
} from '@acorn/plugin-api/testkit/client'
import { AGENT_ARTIFACT_POINT, type TranscriptMediaProps } from '../../contract/transcriptMedia.ts'
import type { AgentNormalizedEvent } from '../../contract/wire.ts'

const artifactContent = vi.fn()
const artifactPreview = vi.fn()
const saveFile = vi.fn()

// The reader's arbitration preference, the one thing a slot reads that needs a shell behind it.
vi.mock('@tanstack/solid-query', () => ({ createQuery: () => ({ data: {} }) }))
vi.mock('./managedClient', () => ({ managedAgentApi: { artifactContent, artifactPreview } }))
vi.mock('@acorn/plugin-api/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@acorn/plugin-api/client')>()),
  saveFile,
}))

const { default: AgentArtifactCard } = await import('./AgentArtifactCard')
type ArtifactEvent = Extract<AgentNormalizedEvent, { type: 'artifact' }>

const hosts: Array<() => void> = []
const registered: Disposable[] = []
afterEach(() => {
  for (const dispose of hosts.splice(0).reverse()) dispose()
  for (const disposable of registered.splice(0).reverse()) disposable.dispose()
  vi.clearAllMocks()
})

const draw = (artifact: ArtifactEvent) => {
  const host = document.createElement('div')
  document.body.append(host)
  const dispose = render(() => <AgentArtifactCard artifact={artifact} taskId="task-1" sessionId="session-1" />, host)
  hosts.push(() => {
    dispose()
    host.remove()
  })
  return host
}

it('fetches an authenticated raster artifact and displays it inline', async () => {
  const content = {
    bytes: Uint8Array.from([0x89, 0x50, 0x4e, 0x47]),
    type: 'image/png',
    filename: 'Generated image.png',
  }
  artifactPreview.mockResolvedValue(content)
  artifactContent.mockResolvedValue(content)
  const host = draw({
    type: 'artifact',
    artifactId: 'image-1',
    kind: 'file',
    title: 'Generated image.png',
    mediaType: 'image/png',
    byteSize: 4,
  })

  await vi.waitFor(() => expect(host.querySelector('img')).not.toBeNull())
  expect(host.querySelector('img')?.getAttribute('src')).toMatch(/^data:image\/png;base64,/)
  expect(host.querySelector('img')?.getAttribute('alt')).toBe('Generated image.png')
  expect(host.textContent).toContain('Download')

  const download = host.querySelector<HTMLElement>('[role="button"]')
  download?.click()
  await vi.waitFor(() =>
    expect(saveFile).toHaveBeenCalledWith({
      bytes: Uint8Array.from([0x89, 0x50, 0x4e, 0x47]),
      mimeType: 'image/png',
      suggestedName: 'Generated image.png',
    }),
  )
})

it('keeps non-image artifacts on the download-only path', () => {
  const host = draw({
    type: 'artifact',
    artifactId: 'log-1',
    kind: 'command_output',
    title: 'Command output',
    mediaType: 'text/plain; charset=utf-8',
    byteSize: 42,
  })

  expect(host.querySelector('img')).toBeNull()
  expect(host.textContent).toContain('Command output')
  expect(artifactContent).not.toHaveBeenCalled()
  expect(artifactPreview).not.toHaveBeenCalled()
})

it('does not automatically fetch an oversized advertised image', () => {
  const host = draw({
    type: 'artifact',
    artifactId: 'large',
    kind: 'file',
    title: 'large.png',
    mediaType: 'image/png',
    byteSize: 8 * 1024 * 1024 + 1,
  })
  expect(host.querySelector('img')).toBeNull()
  expect(artifactPreview).not.toHaveBeenCalled()
  expect(host.textContent).toContain('Download')
})

describe('the agents:artifact point', () => {
  const seen: TranscriptMediaProps[] = []
  const point = () =>
    registered.push(
      extensionPointRegistry.register({
        id: AGENT_ARTIFACT_POINT,
        ownerId: 'agents',
        label: 'Agent artifact',
        kind: 'remote',
        mode: 'replace',
        max: 1,
      }),
    )
  // A compiled contributor, so the tree host stays out of this. Which render path answers is
  // client-core's to test; the key and the props are this plugin's.
  const contributor = (pluginId: string, matches: string[]) => {
    const registration = extensionRegistry.register({
      id: `plugin:${pluginId}:artifact`,
      pluginId,
      point: AGENT_ARTIFACT_POINT,
      label: `${pluginId} viewer`,
      order: 500,
      carrier: 'component',
      matches,
      component: (props: TranscriptMediaProps) => {
        seen.push(props)
        return <span>drawn by {pluginId}</span>
      },
    } as ExtensionContribution)
    registered.push(registration)
    return registration
  }
  const log: ArtifactEvent = {
    type: 'artifact',
    artifactId: 'log-1',
    kind: 'command_output',
    title: 'Command output',
    mediaType: 'text/plain; charset=utf-8',
    byteSize: 42,
  }
  const image: ArtifactEvent = {
    type: 'artifact',
    artifactId: 'image-2',
    kind: 'file',
    title: 'chart.png',
    mediaType: 'image/png',
    byteSize: 4,
  }

  afterEach(() => {
    seen.length = 0
  })

  it('hands the body to the plugin that matched the bare media type, with the session that owns it', async () => {
    point()
    contributor('logs', ['text/plain'])
    const host = draw(log)
    expect(host.textContent).toContain('drawn by logs')
    expect(seen.at(-1)).toEqual({
      taskId: 'task-1',
      sessionId: 'session-1',
      media: { kind: 'artifact', id: 'log-1', filename: 'Command output', mediaType: 'text/plain', byteSize: 42 },
    })

    // The title, size and download stay the owner's, outside the plugin's body.
    artifactContent.mockResolvedValue({ bytes: Uint8Array.from([1]), type: 'text/plain', filename: 'output.txt' })
    expect(host.textContent).toContain('Command output')
    host.querySelector<HTMLElement>('[role="button"]')?.click()
    await vi.waitFor(() =>
      expect(saveFile).toHaveBeenCalledWith({
        bytes: Uint8Array.from([1]),
        mimeType: 'text/plain',
        suggestedName: 'output.txt',
      }),
    )
  })

  it('fetches no inline image while a plugin draws the body', () => {
    point()
    contributor('charts', ['image/png'])
    const host = draw(image)
    expect(host.textContent).toContain('drawn by charts')
    expect(host.querySelector('img')).toBeNull()
    expect(artifactPreview).not.toHaveBeenCalled()
  })

  it('draws its own body while two plugins tie and nobody has picked', async () => {
    artifactPreview.mockResolvedValue({
      bytes: Uint8Array.from([0x89, 0x50, 0x4e, 0x47]),
      type: 'image/png',
      filename: 'chart.png',
    })
    point()
    contributor('charts', ['image/png'])
    contributor('pixels', ['image/*'])
    const host = draw(image)
    await vi.waitFor(() => expect(host.querySelector('img')).not.toBeNull())
    expect(host.textContent).not.toContain('drawn by')
    expect(host.textContent).toContain('Download')
  })

  it('goes back to its own body when the plugin is disabled', async () => {
    artifactPreview.mockResolvedValue({
      bytes: Uint8Array.from([0x89, 0x50, 0x4e, 0x47]),
      type: 'image/png',
      filename: 'chart.png',
    })
    point()
    const charts = contributor('charts', ['image/png'])
    const host = draw(image)
    expect(host.textContent).toContain('drawn by charts')
    charts.dispose()
    await vi.waitFor(() => expect(host.querySelector('img')).not.toBeNull())
    expect(host.textContent).not.toContain('drawn by charts')
    expect(host.textContent).toContain('Download')
  })

  it('keys an artifact with no media type as application/octet-stream', () => {
    point()
    contributor('hex', ['application/octet-stream'])
    const host = draw({ type: 'artifact', artifactId: 'blob', kind: 'file', title: 'blob' })
    expect(host.textContent).toContain('drawn by hex')
    expect(seen.at(-1)?.media).toEqual({
      kind: 'artifact',
      id: 'blob',
      filename: 'blob',
      mediaType: 'application/octet-stream',
    })
  })
})
