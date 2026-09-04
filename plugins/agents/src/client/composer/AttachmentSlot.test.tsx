import { render } from 'solid-js/web'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AGENT_ATTACHMENT_POINT } from '@acorn/protocol/extensionPoints.ts'
import type { AgentAttachment } from '@acorn/protocol/managedAgents.ts'
import {
  extensionPointRegistry,
  extensionRegistry,
  type Disposable,
  type ExtensionContribution,
} from '@acorn/plugin-api/testkit/client'
import { AttachmentSlot } from './AttachmentSlot'

// The composer's one extension point, rendered where it lives (docs/plugins.md § Cooperative
// extension points, the `remote` kind). `Slot`'s arbitration is tested in client-core; what this adds
// is the agents plugin's half — the key it passes is the media type, so a plugin that declared
// `image/png` draws the `.png` and the composer's own chip draws everything else.
//
// The first test in this package's jsdom tier, which is what made it possible to test a region a
// plugin ships at all (plugins/vitest.shared.ts).

// The one thing a slot reads that needs a shell behind it: the reader's arbitration preference. Every
// other mock this test could have grown was avoidable, and avoiding them is what keeps the deep
// imports into core down to the two registries a contribution is registered through
// (tools/arch/boundaries.test.ts § plugin tests).
vi.mock('@tanstack/solid-query', () => ({ createQuery: () => ({ data: {} }) }))

// A compiled contributor rather than a worker one, so the tree host stays out of this. Which render
// path answers is the point's business and client-core's to test (`plugins/tree/Slot.test.tsx`); what
// is the agents plugin's own is the key it hands the slot, and both paths are keyed the same way.
const Contributor = () => <span>drawn by images</span>

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
    carrier: 'component',
    component: Contributor,
    matches,
  } as ExtensionContribution))

const draw = (file: AgentAttachment): string => {
  const host = document.createElement('div')
  document.body.append(host)
  const dispose = render(
    () => <AttachmentSlot attachment={file} taskId="t1" sessionId="s1" onRemove={() => {}} onReplace={async () => {}} />,
    host,
  )
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
    expect(draw(attachment('screenshot.png', 'image/png'))).toContain('drawn by images')
  })

  // The ✕ lives inside the chip a contributor replaces, so without this the reader would be unable to
  // take an attachment off the turn for as long as a plugin was drawing it.
  it('keeps removal available outside the slot when a plugin replaced the chip', () => {
    point()
    contributor('images', ['image/png'])
    expect(draw(attachment('screenshot.png', 'image/png'))).toBe('drawn by images✕')
  })

  // And does not draw a second one when nobody did: the chip already has its own.
  it('leaves removal to the chip when nobody replaced it', () => {
    point()
    expect(draw(attachment('notes.txt', 'text/plain'))).not.toContain('✕✕')
  })

  it('leaves a type that plugin did not declare to the chip', () => {
    point()
    contributor('images', ['image/png'])
    expect(draw(attachment('data.csv', 'text/csv'))).toContain('data.csv')
  })
})
