import { render } from 'solid-js/web'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AGENT_ATTACHMENT_POINT } from '@acorn/protocol/extensionPoints.ts'
import type { AgentAttachment } from '@acorn/protocol/managedAgents.ts'
import {
  extensionPointRegistry,
  extensionRegistry,
  type ExtensionContribution,
} from '@acorn/client-core/registries/extensionPoints.ts'
import type { Disposable } from '@acorn/client-core/registries/registry.ts'
import { AttachmentSlot } from './AttachmentSlot'

// The composer's one extension point, rendered where it lives (docs/plugins.md § Cooperative
// extension points, the `remote` kind). `Slot`'s arbitration is tested in client-core; what this adds
// is the agents plugin's half — the key it passes is the media type, so a plugin that declared
// `image/png` draws the `.png` and the composer's own chip draws everything else.
//
// The first test in this package's jsdom tier, which is what made it possible to test a region a
// plugin ships at all (plugins/vitest.shared.ts).

vi.mock('@acorn/client-core/hostCapabilities.ts', () => ({ hasHostCapability: () => true }))
vi.mock('@tanstack/solid-query', () => ({ createQuery: () => ({ data: {} }) }))
vi.mock('@acorn/client-core/queries.ts', () => ({ prefsOptions: () => ({}) }))

// The worker path itself is client-core's to test; here it only has to be identifiable on screen.
vi.mock('@acorn/client-core/plugins/tree/RemoteTree.tsx', () => ({
  RemoteTree: (props: { contribution: { pluginId: string } }) => <span>drawn by {props.contribution.pluginId}</span>,
}))

const registered: Disposable[] = []

const attachment = (filename: string, mediaType: string): AgentAttachment =>
  ({ id: 'a1', filename, mediaType, byteSize: 2048 } as AgentAttachment)

const point = () =>
  registered.push(extensionPointRegistry.register({
    id: AGENT_ATTACHMENT_POINT,
    ownerId: 'agents',
    label: 'Attachment',
    kind: 'remote',
    mode: 'replace',
    max: 4,
  }))

const contributor = (pluginId: string, matches: string[]) =>
  registered.push(extensionRegistry.register({
    id: `plugin:${pluginId}:attachment`,
    pluginId,
    point: AGENT_ATTACHMENT_POINT,
    label: `${pluginId} viewer`,
    order: 500,
    carrier: 'remote',
    entry: 'attachment',
    hash: 'abc',
    matches,
  } as ExtensionContribution))

const draw = (file: AgentAttachment): string => {
  const host = document.createElement('div')
  document.body.append(host)
  const dispose = render(() => <AttachmentSlot attachment={file} taskId="t1" onRemove={() => {}} />, host)
  const text = host.textContent ?? ''
  dispose()
  host.remove()
  return text
}

afterEach(() => {
  for (const disposable of registered.reverse()) disposable.dispose()
  registered.length = 0
})

describe('the composer’s attachment slot', () => {
  it('draws the composer’s own chip when nobody has anything to say about the type', () => {
    point()
    expect(draw(attachment('notes.txt', 'text/plain'))).toContain('notes.txt · 2 KiB')
  })

  it('hands a .png to the plugin that declared it, instead of the chip', () => {
    point()
    contributor('images', ['image/png', 'image/jpeg'])
    expect(draw(attachment('screenshot.png', 'image/png'))).toBe('drawn by images')
  })

  it('leaves a type that plugin did not declare to the chip', () => {
    point()
    contributor('images', ['image/png'])
    expect(draw(attachment('data.csv', 'text/csv'))).toContain('data.csv')
  })
})
