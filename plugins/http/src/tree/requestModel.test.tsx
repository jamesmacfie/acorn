import { createRoot } from "solid-js"
import { afterEach, expect, it, vi } from "vitest"
import { _resetHttpPanelModel, httpPanelModel, type PanelSubject } from "./panelModel"
import { emptyDraft, toDraft } from "./draft"
import type { HttpRequest } from "../shared/model"
const held = <T,>() => { let resolve!: (value: T) => void; let reject!: (error: Error) => void; const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no }); return { promise, resolve, reject } }
const row = (id: string, url = `https://${id}.test`): HttpRequest => ({ ...emptyDraft(), id, projectId: "project", name: id, url, createdAt: 1, updatedAt: 1 })
const regions: (() => void)[] = []
const mount = (api: Record<string, unknown>, authority = "node/http", projectId = "project", nodeId = "node") => {
  const bridge = { context: { nodeId, authority }, api: { get: async () => [], ...api }, onSelect: () => () => {}, onSurfaceAction: () => () => {}, ui: { copy: vi.fn() } } as unknown as PanelSubject["bridge"]
  const region = createRoot((dispose) => ({ dispose, model: httpPanelModel({ bridge, projectId, projectName: projectId }) }))
  regions.push(region.dispose)
  return region
}
afterEach(() => { for (const dispose of regions.splice(0)) dispose(); _resetHttpPanelModel() })

it("retires selected sends and ignores completion after navigation or a newer send", async () => {
  const first = held<unknown>(), second = held<unknown>(), signals: AbortSignal[] = []
  const post = vi.fn((_path, _body, options) => { signals.push(options.signal); return post.mock.calls.length === 1 ? first.promise : second.promise })
  const { model } = mount({ post })
  model.open(row("A"))
  const sending = model.fire()
  model.open(row("B"))
  expect(signals[0].aborted).toBe(true)
  await sending
  first.resolve({ url: "A" })
  expect(model.result()).toBeNull()
  const next = model.fire()
  model.patch({ body: "edit during send" })
  second.resolve({ url: "B" })
  await next
  expect(model.result()).toBeNull()
  expect(model.sending()).toBe(false)
})

it("serializes request writes and preserves later full edits across old acknowledgements and selection", async () => {
  const first = held<HttpRequest>(), second = held<HttpRequest>()
  const put = vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise)
  const { model } = mount({ put })
  model.open(row("A"))
  model.patch({ body: "submitted", auth: { mode: "bearer", token: "synthetic" }, vars: { key: "value" } })
  const before = model.draft(), save = model.persist(before)
  model.patch({ body: "newer" })
  const newer = model.draft(), queued = model.persist(newer)
  expect(put).toHaveBeenCalledTimes(1)
  first.resolve({ ...row("A"), ...before })
  await save
  await vi.waitFor(() => expect(put).toHaveBeenCalledTimes(2))
  expect(model.draft().body).toBe("newer")
  model.open(row("B"))
  second.resolve({ ...row("A"), ...newer })
  await queued
  expect(model.selection()).toEqual({ kind: "saved", id: "B" })
  expect(model.draft()).toEqual(toDraft(row("B")))
  model.open({ ...row("A"), ...newer })
  expect(model.dirty()).toBe(false)
})

it("creates once, then saves edits against the acknowledged ID", async () => {
  const created = held<HttpRequest>()
  const post = vi.fn(() => created.promise), put = vi.fn(async (_path, body) => ({ ...row("created"), ...body }))
  const { model } = mount({ post, put })
  model.patch({ url: "https://new.test", folder: "folder", headers: [{ name: "X", value: "v", enabled: true }] })
  const submitted = model.draft(), first = model.persist(submitted)
  model.patch({ body: "typed while creating", bodyMode: "text" })
  const second = model.persist(model.draft())
  expect(post).toHaveBeenCalledTimes(1)
  created.resolve({ ...row("created"), ...submitted })
  await Promise.all([first, second])
  expect(post).toHaveBeenCalledTimes(1)
  expect(put).toHaveBeenCalledWith(expect.stringContaining("/created"), expect.objectContaining({ body: "typed while creating", folder: "folder" }), expect.anything())
  expect(model.draft().body).toBe("typed while creating")
  expect(model.selection()).toEqual({ kind: "saved", id: "created" })
})

it("recovers failed full drafts after root eviction only through equivalent Node and authority", async () => {
  const post = vi.fn(async () => { throw new Error("offline") })
  const origin = mount({ post })
  origin.model.patch({ url: "https://draft.test", body: "full unsent body", auth: { mode: "basic", username: "u", password: "synthetic" }, folder: "auth", vars: { token: "v" } })
  const expected = origin.model.draft()
  await origin.model.persist(expected)
  origin.model.startNew()
  expect(origin.model.recoveries()).toHaveLength(1)
  origin.dispose()
  const foreign = mount({}, "node/http", "project", "other-node")
  expect(foreign.model.recoveries()).toHaveLength(0)
  foreign.dispose()
  const equivalent = mount({ post })
  equivalent.model.recover(equivalent.model.recoveries()[0].key)
  expect(equivalent.model.draft()).toEqual(expected)
  expect(equivalent.model.dirty()).toBe(true)
  expect(post).toHaveBeenCalledTimes(1)
})

it("settles held saves on retirement without accepting a late acknowledgement or replaying them", async () => {
  const saved = held<HttpRequest>(), put = vi.fn(() => saved.promise)
  const origin = mount({ put })
  origin.model.open(row("A"))
  origin.model.patch({ body: "failed draft" })
  const save = origin.model.persist(origin.model.draft())
  origin.dispose()
  await save
  expect(origin.model.saving()).toBe(false)
  saved.resolve(row("A"))
  const warm = mount({ put })
  expect(warm.model.draft().body).toBe("failed draft")
  expect(warm.model.dirty()).toBe(true)
  expect(put).toHaveBeenCalledTimes(1)
})

it("retains last-known requests after refresh failure", async () => {
  const get = vi.fn().mockResolvedValueOnce([row("A")]).mockRejectedValue(new Error("offline"))
  const { model } = mount({ get })
  await vi.waitFor(() => expect(model.saved.loading).toBe(false))
  model.refresh()
  await vi.waitFor(() => expect(get).toHaveBeenCalledTimes(2))
  await vi.waitFor(() => expect(model.saved.loading).toBe(false))
  expect(model.saved()).toEqual([row("A")])
  expect(model.error()).toBe("offline")
})

it("captures deletion identity and preserves text entered while the delete is held", async () => {
  const deleted = held<void>(), del = vi.fn(() => deleted.promise)
  const { model } = mount({ del })
  model.open(row("A"))
  const remove = model.remove(row("A"))
  model.patch({ body: "typed while deleting" })
  deleted.resolve(); await remove
  expect(model.selection()).toEqual({ kind: "new" })
  expect(model.draft().body).toBe("typed while deleting")
  expect(model.dirty()).toBe(true)
  model.open(row("B"))
  model.recover(model.recoveries()[0].key)
  expect(model.draft().body).toBe("typed while deleting")
})

it("does not delete B or erase a draft when A deletion fails or completes after navigation", async () => {
  const deleted = held<void>(), del = vi.fn(() => deleted.promise)
  const { model } = mount({ del })
  model.open(row("A")); model.patch({ body: "keep A" })
  const remove = model.remove(row("A"))
  model.open(row("B")); model.patch({ body: "keep B" })
  deleted.reject(new Error("offline")); await remove
  expect(model.draft().body).toBe("keep B")
  expect(model.error()).toBeNull()
  model.open(row("A"))
  expect(model.draft().body).toBe("keep A")
})

it("orders writes to one saved request across separate subject grants, without joining foreign Nodes", async () => {
  const first = held<HttpRequest>(), putA = vi.fn(() => first.promise)
  const putB = vi.fn(async (_path, body) => ({ ...row("shared"), ...body }))
  const project = mount({ put: putA }, "project/grant")
  const task = mount({ put: putB }, "task/grant")
  project.model.open(row("shared")); task.model.open(row("shared"))
  project.model.patch({ body: "first" }); task.model.patch({ body: "second" })
  const a = project.model.persist(project.model.draft()), b = task.model.persist(task.model.draft())
  expect(putB).not.toHaveBeenCalled()
  const putForeign = vi.fn(async (_path, body) => ({ ...row("shared"), ...body }))
  const foreign = mount({ put: putForeign }, "task/grant", "project", "foreign-node")
  foreign.model.open(row("shared"))
  await foreign.model.persist(foreign.model.draft())
  expect(putForeign).toHaveBeenCalledOnce()
  first.resolve({ ...row("shared"), body: "first" })
  await Promise.all([a, b])
  expect(putB).toHaveBeenCalledOnce()
  expect(project.model.draft().body).toBe("first")
  expect(task.model.draft().body).toBe("second")
})

it("settles a queued retired write without executing it or blocking a surviving grant", async () => {
  const first = held<HttpRequest>(), putA = vi.fn(() => first.promise), putB = vi.fn(), putC = vi.fn(async () => row("shared"))
  const a = mount({ put: putA }, "A/grant"), b = mount({ put: putB }, "B/grant"), c = mount({ put: putC }, "C/grant")
  for (const region of [a, b, c]) region.model.open(row("shared"))
  const active = a.model.persist(a.model.draft()), retired = b.model.persist(b.model.draft()), surviving = c.model.persist(c.model.draft())
  b.dispose(); await retired
  expect(putB).not.toHaveBeenCalled()
  first.resolve(row("shared")); await Promise.all([active, surviving])
  expect(putC).toHaveBeenCalledOnce()
})
