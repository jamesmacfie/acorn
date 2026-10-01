import { afterEach, expect, it, vi } from 'vitest'
import { render } from 'solid-js/web'
import { setActiveNode } from '@acorn/plugin-api/testkit/client'
import { holdAgentMedia } from './agentMediaStore'
import AgentAttachmentCard from './AgentAttachmentCard'

const requests: { node: string; path: string }[] = []
const json = (body: unknown) => ({ status: 200, headers: {}, body: new TextEncoder().encode(JSON.stringify(body)) })
const serve = (size: number, deferred?: (node: string) => Promise<Uint8Array>) => {
  requests.length = 0
  Object.assign(window, { acorn: { desktop: true, onNodeStatus: () => () => {}, nodeFetch: async (node: string, request: { path: string }) => {
    requests.push({ node, path: request.path })
    return request.path.endsWith('/content')
      ? { status: 200, headers: { 'content-type': 'image/png', 'content-disposition': 'attachment; filename="exact.png"' }, body: deferred ? await deferred(node) : new Uint8Array(size) }
      : json({ id: request.path.split('/').at(-1), filename: 'fallback.png', mediaType: 'image/png', byteSize: size })
  } } })
  setActiveNode('media-A')
}
afterEach(() => { vi.restoreAllMocks(); setActiveNode(null); delete window.acorn })

it('shares metadata, full bytes, and conversion for eight consumers and their download', async () => {
  serve(1024)
  const conversion = vi.spyOn(FileReader.prototype, 'readAsDataURL')
  const leases = Array.from({ length: 8 }, () => holdAgentMedia('attachment', 'eight-consumers'))
  const sources = await Promise.all(leases.map(lease => lease.preview()))
  expect(sources.every(value => value?.startsWith('data:image/png;base64,'))).toBe(true)
  expect(requests).toHaveLength(2)
  expect(conversion).toHaveBeenCalledTimes(1)
  const content = await leases[0].content()
  expect(content).toMatchObject({ type: 'image/png', filename: 'exact.png' })
  expect(content.bytes.byteLength).toBe(1024)
  expect(requests).toHaveLength(2)
  leases.forEach(lease => lease.release())
})

it('keeps active consumers while evicting idle bytes past the budget', async () => {
  serve(3 * 1024 * 1024)
  const first = holdAgentMedia('attachment', 'budget-first')
  const survivor = holdAgentMedia('attachment', 'budget-first')
  await first.preview()
  first.release()
  for (const id of ['budget-second', 'budget-third']) {
    const lease = holdAgentMedia('attachment', id)
    await lease.preview()
    lease.release()
  }
  const count = requests.length
  await survivor.content()
  expect(requests).toHaveLength(count)
  survivor.release()
  const retained = holdAgentMedia('attachment', 'budget-first')
  await retained.preview()
  expect(requests).toHaveLength(count)
  retained.release()
  const evicted = holdAgentMedia('attachment', 'budget-second')
  await evicted.preview()
  expect(requests).toHaveLength(count + 2)
  evicted.release()
})

it('isolates kinds and Nodes, and a departed reader does not cancel a surviving read', async () => {
  let finish!: (value: Uint8Array) => void
  serve(1, node => node === 'media-A' ? new Promise(resolve => { finish = resolve }) : Promise.resolve(new Uint8Array([2])))
  const old = holdAgentMedia('attachment', 'collision')
  const survivor = holdAgentMedia('attachment', 'collision')
  const reading = old.content()
  old.release()
  setActiveNode('media-B')
  const incoming = holdAgentMedia('attachment', 'collision')
  expect((await incoming.content()).bytes).toEqual(new Uint8Array([2]))
  finish(new Uint8Array([1]))
  await reading
  expect((await survivor.content()).bytes).toEqual(new Uint8Array([1]))
  const artifact = holdAgentMedia('artifact', 'collision')
  await artifact.content()
  expect(requests.map(item => item.node)).toEqual(['media-A', 'media-B', 'media-B'])
  expect(requests.at(-1)?.path).toContain('/artifacts/')
  survivor.release(); incoming.release(); artifact.release()
})

it('retries a settled failure and refuses an active image type without conversion', async () => {
  serve(1)
  let fail = true
  window.acorn!.nodeFetch = async () => fail ? { status: 503, headers: {} as Record<string, string>, body: new Uint8Array() }
    : { status: 200, headers: { 'content-type': 'image/svg+xml' }, body: new Uint8Array([1]) }
  const first = holdAgentMedia('artifact', 'failed')
  await expect(first.preview({ mediaType: 'image/png' })).rejects.toThrow()
  first.release()
  fail = false
  const conversion = vi.spyOn(FileReader.prototype, 'readAsDataURL')
  const retry = holdAgentMedia('artifact', 'failed')
  expect(await retry.preview({ mediaType: 'image/png' })).toBeNull()
  expect(conversion).not.toHaveBeenCalled()
  expect((await retry.content()).bytes).toEqual(new Uint8Array([1]))
  retry.release()
})

it('hides the departing card while a colliding attachment loads on another Node', async () => {
  let finish!: (value: Uint8Array) => void
  serve(1, node => node === 'media-B' ? new Promise(resolve => { finish = resolve }) : Promise.resolve(new Uint8Array([1])))
  const host = document.createElement('div')
  document.body.append(host)
  const dispose = render(() => <AgentAttachmentCard attachmentId="card-collision" />, host)
  try {
    await vi.waitFor(() => expect(host.textContent).toContain('fallback.png'))
    setActiveNode('media-B')
    expect(host.textContent).not.toContain('fallback.png')
    await vi.waitFor(() => expect(finish).toBeTypeOf('function'))
    finish(new Uint8Array([2]))
    await vi.waitFor(() => expect(host.textContent).toContain('fallback.png'))
    expect(requests.map(request => request.node)).toEqual(['media-A', 'media-A', 'media-B', 'media-B'])
  } finally { dispose(); host.remove() }
})
