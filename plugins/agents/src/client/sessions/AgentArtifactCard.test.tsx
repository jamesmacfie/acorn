import { render } from 'solid-js/web'
import { afterEach, expect, it, vi } from 'vitest'
import type { AgentNormalizedEvent } from '@acorn/protocol/managedAgents.ts'

const artifactContent = vi.fn()
const saveFile = vi.fn()

vi.mock('./managedClient', () => ({ managedAgentApi: { artifactContent } }))
vi.mock('@acorn/plugin-api/client', async (importOriginal) => ({
  ...await importOriginal<typeof import('@acorn/plugin-api/client')>(),
  saveFile,
}))

const { default: AgentArtifactCard } = await import('./AgentArtifactCard')
type ArtifactEvent = Extract<AgentNormalizedEvent, { type: 'artifact' }>

const hosts: Array<() => void> = []
afterEach(() => {
  for (const dispose of hosts.splice(0).reverse()) dispose()
  vi.clearAllMocks()
})

const draw = (artifact: ArtifactEvent) => {
  const host = document.createElement('div')
  document.body.append(host)
  const dispose = render(() => <AgentArtifactCard artifact={artifact} />, host)
  hosts.push(() => {
    dispose()
    host.remove()
  })
  return host
}

it('fetches an authenticated raster artifact and displays it inline', async () => {
  artifactContent.mockResolvedValue({
    bytes: Uint8Array.from([0x89, 0x50, 0x4e, 0x47]),
    type: 'image/png',
    filename: 'Generated image.png',
  })
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
  await vi.waitFor(() => expect(saveFile).toHaveBeenCalledWith({
    bytes: Uint8Array.from([0x89, 0x50, 0x4e, 0x47]),
    mimeType: 'image/png',
    suggestedName: 'Generated image.png',
  }))
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
})
