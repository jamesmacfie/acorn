import { Hono } from 'hono'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Workspace } from '@acorn/protocol/api.ts'
import { getDb } from '../../db'
import { WORKSPACES_PREF_KEY } from '@acorn/protocol/workspacesMode.ts'
import type { AppEnv } from '../../middleware/auth'
import { workspaces } from './workspaces'
import { makeTestDb, type TestDb } from '../../../testkit/db'
import type { Env } from '../../bindings'
import sharp from 'sharp'
import { schema } from '../../db'
import { WORKSPACE_IMAGE_UPLOAD_BYTES } from '@acorn/protocol/workspaceAppearance.ts'
import * as notify from '../../notify'

vi.mock('../../db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../db')>()
  return { ...actual, getDb: vi.fn() }
})

const makeApp = () => {
  const app = new Hono<AppEnv>()
  app.use('/api/*', async (c, next) => {
    c.set('principal', { kind: 'device', userId: 'james' })
    await next()
  })
  app.route('/api/workspaces', workspaces)
  return app
}

const jsonReq = (url: string, method: string, body: unknown) =>
  new Request(`http://acorn.test${url}`, {
    method,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })

describe('workspace identity', () => {
  let t: TestDb
  let app: Hono<AppEnv>

  beforeEach(() => {
    t = makeTestDb()
    t.db.insert(schema.prefs).values({ userId: 'james', key: WORKSPACES_PREF_KEY, value: 'on' }).run()
    vi.mocked(getDb).mockReturnValue(t.db)
    app = makeApp()
  })

  afterEach(() => t.cleanup())

  const create = async (): Promise<Workspace> => {
    const res = await app.fetch(jsonReq('/api/workspaces', 'POST', { name: 'Runn' }), {} as Env)
    expect(res.status).toBe(200)
    return (await res.json()) as Workspace
  }

  const read = async (id: string): Promise<Workspace | undefined> => {
    const res = await app.fetch(new Request('http://acorn.test/api/workspaces'), {} as Env)
    const all = (await res.json()) as Workspace[]
    return all.find((w) => w.id === id)
  }

  it('PATCHes a workspace name and reads it back', async () => {
    const w = await create()
    const res = await app.fetch(jsonReq(`/api/workspaces/${w.id}`, 'PATCH', { name: 'Acorn' }), {} as Env)
    expect(res.status).toBe(200)
    const back = await read(w.id)
    expect(back?.name).toBe('Acorn')
  })

  it('rejects an empty or unrelated patch', async () => {
    const w = await create()
    expect((await app.fetch(jsonReq(`/api/workspaces/${w.id}`, 'PATCH', {}), {} as Env)).status).toBe(400)
    expect((await app.fetch(jsonReq(`/api/workspaces/${w.id}`, 'PATCH', { color: 'green' }), {} as Env)).status).toBe(
      400,
    )
    expect(
      (
        await app.fetch(
          jsonReq(`/api/workspaces/${w.id}`, 'PATCH', { name: 'Acorn', icon: { kind: 'github' } }),
          {} as Env,
        )
      ).status,
    ).toBe(400)
  })

  it('404s a PATCH for an unknown workspace id', async () => {
    const res = await app.fetch(jsonReq('/api/workspaces/nope', 'PATCH', { name: 'Ghost' }), {} as Env)
    expect(res.status).toBe(404)
  })
  const upload = async (id: string, bytes: Uint8Array, crop = { x: 0.5, y: 0.5, size: 1 }) => {
    const form = new FormData()
    // Deliberately untrustworthy filename and MIME: the Node must inspect content.
    form.append('image', new Blob([bytes.slice().buffer], { type: 'application/octet-stream' }), 'icon.dat')
    form.append('crop', JSON.stringify(crop))
    return app.fetch(
      new Request(`http://acorn.test/api/workspaces/${id}/icon-image`, { method: 'POST', body: form }),
      {} as Env,
    )
  }
  const raster = (format: 'png' | 'jpeg' | 'webp', color = '#ff0000') =>
    sharp({ create: { width: 200, height: 100, channels: 3, background: color } })
      .toFormat(format)
      .toBuffer()

  it('saves solid and gradient icons without renaming, including Default, and publishes changes', async () => {
    const changed = vi.spyOn(notify, 'broadcastWorkspaceChanged')
    await app.fetch(new Request('http://acorn.test/api/workspaces/bootstrap', { method: 'POST' }), {} as Env)
    const [w] = t.db.select().from(schema.workspaces).all()
    for (const background of [
      { kind: 'solid', color: 'blue' },
      { kind: 'gradient', colors: ['#000000', '#ffffff'], angle: 135 },
    ]) {
      const appearance = { version: 1, kind: 'icon', icon: 'rocket', background }
      expect((await app.fetch(jsonReq(`/api/workspaces/${w.id}`, 'PATCH', { appearance }), {} as Env)).status).toBe(200)
      expect(await read(w.id)).toMatchObject({ name: 'Default', isDefault: true, appearance })
    }
    expect(changed).toHaveBeenLastCalledWith({ workspaceId: w.id })
    changed.mockRestore()
  })

  it.each(['png', 'jpeg', 'webp'] as const)(
    'normalizes %s content into a durable static thumbnail and keeps bytes out of lists',
    async (format) => {
      const w = await create()
      expect((await upload(w.id, await raster(format))).status).toBe(200)
      const back = await read(w.id)
      expect(back?.appearance?.kind).toBe('image')
      if (back?.appearance?.kind !== 'image') throw new Error('Missing image reference')
      const response = await app.fetch(
        new Request(`http://acorn.test/api/workspaces/icon-images/${back.appearance.imageId}`),
        {} as Env,
      )
      expect(response.headers.get('content-type')).toBe('image/png')
      const bytes = Buffer.from(await response.arrayBuffer())
      expect(await sharp(bytes).metadata()).toMatchObject({ format: 'png', width: 128, height: 128 })
      expect(JSON.stringify(back)).not.toContain(bytes.toString('base64'))
      expect(t.db.select().from(schema.workspaceIconImages).all()).toHaveLength(1)
    },
  )

  it('persists the selected square crop rather than the original image', async () => {
    const w = await create()
    const half = await sharp({ create: { width: 100, height: 100, channels: 3, background: '#0000ff' } })
      .png()
      .toBuffer()
    const image = await sharp(await raster('png'))
      .composite([{ input: half, left: 100, top: 0 }])
      .png()
      .toBuffer()
    expect((await upload(w.id, image, { x: 1, y: 0.5, size: 1 })).status).toBe(200)
    const [stored] = t.db.select().from(schema.workspaceIconImages).all()
    const pixel = await sharp(stored.bytes).resize(1, 1).removeAlpha().raw().toBuffer()
    expect([...pixel]).toEqual([0, 0, 255])
  })

  it('preserves a saved icon on invalid metadata and failed uploads, and rejects dangling references', async () => {
    const w = await create()
    await upload(w.id, await raster('png'))
    const original = (await read(w.id))?.appearance
    for (const appearance of [
      { version: 1, kind: 'icon', icon: 'not-a-real-icon', background: { kind: 'solid', color: 'blue' } },
      { version: 1, kind: 'icon', icon: 'rocket', background: { kind: 'gradient', colors: ['blue'], angle: 0 } },
      { version: 1, kind: 'icon', icon: 'rocket', background: { kind: 'solid', color: 'url(https://example.com)' } },
      { version: 1, kind: 'image', imageId: 'f'.repeat(64) },
      { version: 2, kind: 'image', imageId: 'a'.repeat(64) },
    ])
      expect((await app.fetch(jsonReq(`/api/workspaces/${w.id}`, 'PATCH', { appearance }), {} as Env)).status).toBe(400)
    for (const input of [
      Buffer.from('<svg/>'),
      Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
      Buffer.alloc(WORKSPACE_IMAGE_UPLOAD_BYTES + 1),
    ]) {
      expect((await upload(w.id, input)).status).toBeGreaterThanOrEqual(400)
    }
    const huge = await sharp({ create: { width: 4096, height: 4096, channels: 3, background: '#000000' } })
      .png()
      .toBuffer()
    expect((await upload(w.id, huge)).status).toBe(400)
    expect((await read(w.id))?.appearance).toEqual(original)
    expect(t.db.select().from(schema.workspaceIconImages).all()).toHaveLength(1)
  })

  it('releases replaced, reset, and deleted images while preserving shared references', async () => {
    const a = await create(),
      b = await create()
    await upload(a.id, await raster('png'))
    const original = (await read(a.id))!.appearance!
    await app.fetch(jsonReq(`/api/workspaces/${b.id}`, 'PATCH', { appearance: original }), {} as Env)
    await upload(a.id, await raster('webp', '#0000ff'))
    const replacement = (await read(a.id))!.appearance!
    expect(replacement).not.toEqual(original)
    expect(t.db.select().from(schema.workspaceIconImages).all()).toHaveLength(2)
    await app.fetch(jsonReq(`/api/workspaces/${a.id}`, 'PATCH', { appearance: null }), {} as Env)
    expect((await read(a.id))!.appearance).toBeNull()
    expect(t.db.select().from(schema.workspaceIconImages).all()).toHaveLength(1)
    await app.fetch(new Request(`http://acorn.test/api/workspaces/${b.id}`, { method: 'DELETE' }), {} as Env)
    expect(t.db.select().from(schema.workspaceIconImages).all()).toHaveLength(0)
  })
  // Build/run/db/preview config (including the AI schema source) is repository-scoped and is set via
  // the repo-path config route, not this workspace route.
})
