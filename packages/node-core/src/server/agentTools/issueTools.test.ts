import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { makeTestDb, type TestDb } from '../../testkit/db'
import { defaultBudgets, publicProvider } from '../integrations/providerShared'
import { connectionProviderRegistry } from '../integrations/connectionRegistry'
import { integrationProviderRegistry } from '../integrations/registry'
import { schema } from '../db'
import { issueCommentTool, issueImageTool } from './issueTools'
import type { IntegrationProviderContribution } from '../integrations/types'

// A provider that answers from memory. What is under test is the link lookup and the checks around the
// hooks, not the resource runtime.
const fakeProvider = (
  hooks: Partial<Pick<IntegrationProviderContribution, 'comment' | 'image' | 'detail'>>,
  capabilities = hooks.comment ? { comments: 'write' } : {},
): IntegrationProviderContribution =>
  publicProvider({
    id: 'tracker',
    label: 'Tracker',
    glyph: 'brand:linear',
    kind: 'issue-tracker',
    connection: { authKind: 'api-key', connectable: true, disconnectable: true, fields: [], validate: async () => ({}), normalize: () => ({}), test: async () => ({ ok: true }) },
    capabilities,
    externalIds: { fromDisplay: (connectionId: string, displayId: string) => ({ providerId: 'tracker', connectionId, displayId }), parse: () => null },
    resources: [],
    budgets: defaultBudgets,
    memory: {},
    ...hooks,
  } as never)

const ctx = { taskId: 'task-1', userLogin: 'owner', callId: '0b5c3a1e-4f7d-4c2a-9e8b-1d2f3a4b5c6d' }
const PNG = Buffer.from('png bytes').toString('base64')

describe('issue tools', () => {
  let db: TestDb

  beforeEach(async () => {
    db = makeTestDb()
    await db.db.insert(schema.integrations).values({
      id: 'conn-a', userId: 'owner', provider: 'tracker', status: 'connected', authRef: await db.secrets.seal('the-key'), label: 'a', createdAt: 1, updatedAt: 1,
    } as never)
    await db.db.insert(schema.taskLinks).values({ taskId: 'task-1', integrationId: 'conn-a', provider: 'tracker', identifier: 'ENG-42', createdAt: 1 })
  })

  afterEach(() => {
    connectionProviderRegistry.removeForPlugin('test')
    integrationProviderRegistry.removeForPlugin('test')
    db.cleanup()
  })

  const register = (provider: IntegrationProviderContribution) => {
    connectionProviderRegistry.register(provider, 'test')
    integrationProviderRegistry.register(provider, 'test')
  }
  const deps = () => ({ db: db.db, secrets: db.secrets })

  it('posts on the linked item with the connection key and the call id', async () => {
    const posted: unknown[] = []
    register(fakeProvider({
      comment: async (context, identifier, body) => {
        posted.push({ secret: context.secret, key: context.idempotencyKey, identifier, body })
        return { url: 'https://tracker.test/ENG-42#c1' }
      },
    }))

    await expect(issueCommentTool(deps()).handler({ identifier: 'ENG-42', body: ' Done. ' }, ctx)).resolves.toEqual({
      provider: 'tracker', identifier: 'ENG-42', url: 'https://tracker.test/ENG-42#c1',
    })
    expect(posted).toEqual([{ secret: 'the-key', key: ctx.callId, identifier: 'ENG-42', body: 'Done.' }])
  })

  it('refuses an item the task does not link, and a connection without the grant', async () => {
    register(fakeProvider({ comment: async () => ({}) }))
    const tool = issueCommentTool(deps())

    await expect(tool.handler({ identifier: 'ENG-7', body: 'hi' }, ctx)).rejects.toThrow(/not linked to this task/)
    await db.db.update(schema.integrations).set({ capabilities: JSON.stringify({ comments: 'missing-scope' }) })
    await expect(tool.handler({ identifier: 'ENG-42', body: 'hi' }, ctx)).rejects.toThrow(/not granted comment access/)
  })

  it('returns an image the item references', async () => {
    register(fakeProvider({
      detail: async () => ({ description: '![shot](https://files.test/a.png)' }),
      image: async ({ secret }, url) => (secret === 'the-key' && url === 'https://files.test/a.png' ? { mimeType: 'image/png; charset=binary', data: PNG } : null),
    }))

    await expect(issueImageTool(deps()).handler({ identifier: 'ENG-42', url: 'https://files.test/a.png' }, ctx)).resolves.toEqual({
      type: 'image', mimeType: 'image/png', data: PNG,
    })
  })

  it('refuses a URL the item does not contain, and a file that is not an image', async () => {
    register(fakeProvider({
      detail: async () => ({ description: 'see https://files.test/clip.mp4' }),
      image: async () => ({ mimeType: 'video/mp4', data: '' }),
    }))
    const tool = issueImageTool(deps())

    await expect(tool.handler({ identifier: 'ENG-42', url: 'https://files.test/other.png' }, ctx)).rejects.toThrow(/does not appear in 'ENG-42'/)
    await expect(tool.handler({ identifier: 'ENG-42', url: 'https://files.test/clip.mp4' }, ctx)).rejects.toThrow(/video\/mp4/)
  })

  it('will not register writable comments without the hook, or images without detail', () => {
    expect(() => integrationProviderRegistry.register(fakeProvider({}, { comments: 'write' }), 'test')).toThrow(/comments: 'write'/)
    expect(() => integrationProviderRegistry.register(fakeProvider({ image: async () => null }), 'test')).toThrow(/without `detail`/)
  })
})
