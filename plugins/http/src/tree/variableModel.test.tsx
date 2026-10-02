import { createRoot, createSignal } from "solid-js"
import { afterEach, expect, it, vi } from "vitest"
import { createHttpClient } from "./httpClient"
import { createVariableModel } from "./variableModel"
import type { AcornBridge } from "@acorn/plugin-api/ui/sdk"
const held = <T,>() => { let resolve!: (value: T) => void; let reject!: (error: Error) => void; const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no }); return { promise, resolve, reject } }
const stored = (id: string) => ({ id, name: id, kind: "value" as const, value: "saved", enabled: true, updatedAt: 1 })
const roots: (() => void)[] = []
let testScope = 0
const mount = (api: Record<string, unknown>, scope = `node/grant:${testScope}`) => createRoot((dispose) => {
  roots.push(dispose)
  const [project, setProject] = createSignal("A")
  const model = createVariableModel(() => createHttpClient(api as AcornBridge["api"], scope), project)
  return { model, setProject, dispose }
})
afterEach(() => { for (const dispose of roots.splice(0)) dispose(); testScope++ })

it("keeps row identity and newer edits across save and delete completions", async () => {
  const save = held<unknown>(), deleted = held<void>()
  const root = mount({ get: async () => [stored("first"), stored("second")], put: () => save.promise, del: () => deleted.promise })
  await vi.waitFor(() => expect(root.model.rows()).toHaveLength(2))
  root.model.editRow(1, { value: "submitted" })
  const saving = root.model.save(1)
  const deleting = root.model.remove(0)
  root.model.editRow(1, { value: "newer" })
  deleted.resolve()
  await deleting
  save.resolve({ ...stored("second"), value: "submitted" })
  await saving
  expect(root.model.rows()).toEqual([expect.objectContaining({ id: "second", value: "newer" })])
  expect(root.model.busy()).toEqual([])
})

it("single-flights creation and captures its project while selection changes", async () => {
  const created = held<unknown>(), post = vi.fn(() => created.promise), put = vi.fn(async (_path, body) => ({ ...stored("created"), ...body }))
  const root = mount({ get: async () => [], post, put })
  root.model.add()
  root.model.editRow(0, { name: "TOKEN", value: "first" })
  const first = root.model.save(0)
  root.model.editRow(0, { value: "later" })
  const second = root.model.save(0)
  created.resolve({ ...stored("created"), name: "TOKEN", value: "first" })
  await Promise.all([first, second])
  expect(post).toHaveBeenCalledTimes(1)
  expect(put).toHaveBeenCalledWith(expect.stringContaining("/projects/A/"), expect.objectContaining({ value: "later" }), expect.anything())
  root.setProject("B")
  await vi.waitFor(() => expect(root.model.rows()).toHaveLength(0))
})

it("preserves full secret drafts through failed refresh, disposal, and equivalent remount without replay", async () => {
  const saving = held<unknown>(), get = vi.fn().mockResolvedValueOnce([stored("first")]).mockRejectedValue(new Error("offline")), put = vi.fn(() => saving.promise)
  const first = mount({ get, put })
  await vi.waitFor(() => expect(first.model.rows()).toHaveLength(1))
  first.model.editRow(0, { kind: "secret", value: "synthetic unsent secret", name: "TOKEN" })
  const pending = first.model.save(0)
  first.dispose()
  await pending
  const warm = mount({ get, put })
  await vi.waitFor(() => expect(warm.model.error()).toBe("offline"))
  expect(warm.model.rows()[0]).toMatchObject({ kind: "secret", name: "TOKEN", value: "synthetic unsent secret" })
  expect(put).toHaveBeenCalledTimes(1)
  expect(warm.model.busy()).toEqual([])
  saving.resolve(stored("first"))
  expect(warm.model.rows()[0].value).toBe("synthetic unsent secret")
  const foreign = mount({ get: async () => [] }, "other-node/grant")
  expect(foreign.model.rows()).toEqual([])
})

it("does not publish held project-A saves, lists, or deletes into project B", async () => {
  const saved = held<unknown>(), listB = held<unknown>(), deleted = held<void>()
  const get = vi.fn().mockResolvedValueOnce([stored("first")]).mockReturnValueOnce(listB.promise)
  const root = mount({ get, put: () => saved.promise, del: () => deleted.promise })
  await vi.waitFor(() => expect(root.model.rows()).toHaveLength(1))
  root.model.editRow(0, { value: "unsent" })
  const save = root.model.save(0), remove = root.model.remove(0)
  root.setProject("B")
  await Promise.all([save, remove])
  saved.resolve(stored("first")); deleted.resolve()
  listB.resolve([stored("B")])
  await vi.waitFor(() => expect(root.model.rows()[0]?.id).toBe("B"))
  expect(root.model.error()).toBeNull()
})
