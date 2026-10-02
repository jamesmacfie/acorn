import { execFileSync } from "node:child_process"
import { createServer } from "node:http"
import type { Socket } from "node:net"
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs"
import { join, resolve } from "node:path"
import { tmpdir } from "node:os"
import { MessageChannel } from "node:worker_threads"
import { expect, it, vi } from "vitest"
import { makeTestDb } from "../../packages/node-core/src/testkit/public"
import { memoryIdentityStore } from "../../packages/node-core/src/server/activeIdentity"
import { createCoreServices, SecretService } from "../../packages/node-core/src/server/core/index"
import { schema } from "../../packages/node-core/src/server/db/index"
import { loadExternalPlugins } from "../../packages/node-core/src/server/plugins/public"
import { CapabilityRegistry } from "../../packages/node-core/src/server/pluginHost/capabilities"
import { initPlugins } from "../../packages/node-core/src/server/pluginHost/host"
import { pluginRouteContributions } from "../../packages/node-core/src/server/routes/registry"
import { connect, _resetConnection } from "../../packages/client-core/src/host/frames/sdk"
import { createFrameBridge, type FrameServices } from "../../packages/client-core/src/host/frames/broker"

it("cancels real loaded HTTP body/header waits and all owned variable command trees through SDK and host", async () => {
  const root = mkdtempSync(join(tmpdir(), "acorn-unit20-")), db = makeTestDb(), checkout = join(root, "checkout")
  let running: Awaited<ReturnType<typeof initPlugins>> | undefined
  try {
  mkdirSync(checkout)
  const services = createCoreServices({ db: db.db, secrets: new SecretService("0".repeat(64)), activeIdentity: memoryIdentityStore() })
  const commands: Promise<unknown>[] = []
  const original = services.proc.runProcess
  vi.spyOn(services.proc, "runProcess").mockImplementation((spec) => { const pending = original(spec); commands.push(pending); return pending })
  const now = Date.now()
  await db.db.insert(schema.workspaces).values({ id: "ws", name: "Synthetic", isDefault: true, sort: 0, createdAt: now, updatedAt: now })
  await db.db.insert(schema.projects).values({ id: "project", name: "Synthetic", workspaceId: "ws", path: checkout, sort: 0, hidden: false, vcs: "git", defaultBranch: "main", remoteUrl: null, githubOwner: null, githubName: null, githubRepoId: null, createdAt: now, updatedAt: now })
  execFileSync(process.execPath, [resolve("apps/node/scripts/build-plugin.mjs"), "http"], { cwd: resolve("apps/node"), env: { ...process.env, ACORN_DATA_DIR: root }, stdio: "pipe" })
  const { loaded, failures } = await loadExternalPlugins(root, { builtins: [] })
  expect(failures).toEqual([])
  const entry = loaded.find((item) => item.manifest.id === "http")!
  running = await initPlugins([entry.plugin], { capabilities: new CapabilityRegistry(), core: services, dataDir: root, loaded: new Map([["http", { permissions: entry.manifest.permissions.node, storage: entry.storage }]]) })
  expect(running.failed).toEqual([])
  const route = pluginRouteContributions().find((item) => item.plugin === "http")!
  const channels = new MessageChannel(), listeners = new Set<(event: MessageEvent) => void>(), calls: Promise<unknown>[] = []
  vi.stubGlobal("addEventListener", (_kind: string, listener: (event: MessageEvent) => void) => listeners.add(listener))
  vi.stubGlobal("removeEventListener", (_kind: string, listener: (event: MessageEvent) => void) => listeners.delete(listener))
  const context = { userId: "owner", principal: { kind: "device", userId: "owner", deviceId: "device" }, providers: { connections: async () => [], resource: async () => { throw new Error("unused") }, withConnections: async () => [], items: () => { throw new Error("unused") } } }
  const connecting = connect()
  for (const listener of listeners) listener({ data: { acornBridge: 1 }, ports: [channels.port2] } as unknown as MessageEvent)
  const host = createFrameBridge({ port: channels.port1 as unknown as MessagePort,
    binding: { pluginId: "http", surface: "http", target: "remote", nodeId: "synthetic", projectId: "project", api: [], events: [], panes: [], claimsKeys: [] },
    context: { surface: "http", target: "remote", nodeId: "synthetic", authority: "synthetic/http", theme: "light", style: "terminal" },
    services: { fetch: async (method, path, body, signal) => {
      const pending = route.fetch!(new Request(`http://node.test${path.replace("/v1/p/http", "")}`, { method, signal, headers: { "content-type": "application/json" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }), context)
      calls.push(pending)
      const response = await pending
      return { ok: response.ok, status: response.status, body: await response.json() }
    } } as FrameServices,
  })
  const sdk = await connecting
  const records: unknown[] = [], sockets = new Set<Socket>()
  let entered!: () => void, closed!: () => void
  const server = createServer((request, response) => {
    if (request.url === "/body") { response.writeHead(200); response.write("partial") }
    response.on("close", () => closed())
    entered()
  })
  server.on("connection", (socket) => { sockets.add(socket); socket.on("close", () => sockets.delete(socket)) })
  await new Promise<void>((yes, no) => { server.once("error", no); server.listen(0, "127.0.0.1", yes) })
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`
  try {
    for (const phase of ["headers", "body"]) {
      const reached = new Promise<void>((yes) => { entered = yes }), retired = new Promise<void>((yes) => { closed = yes })
      const controller = new AbortController()
      const pending = sdk.api.post("/v1/p/http/projects/project/send", { method: "GET", url: `${base}/${phase}` }, { signal: controller.signal })
      const rejected = expect(pending).rejects.toBeDefined()
      await reached
      controller.abort()
      await rejected; await retired
      records.push({ phase, SDKRejected: true, loopbackResponseClosed: true })
    }
    writeFileSync(join(checkout, "owned.mjs"), `import { spawn } from "node:child_process"; import { writeFileSync } from "node:fs"; const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore" }); writeFileSync("pids-" + process.argv[2] + ".json", JSON.stringify([process.pid, child.pid])); setInterval(() => {}, 1000);`)
    for (const name of ["ONE", "TWO", "OVERRIDDEN"]) await sdk.api.post("/v1/p/http/projects/project/vars", { name, kind: "command", enabled: true, value: `node owned.mjs ${name}` })
    const controller = new AbortController()
    const pending = sdk.api.post("/v1/p/http/projects/project/send", { method: "GET", url: `${base}/{{ONE}}/{{TWO}}/{{OVERRIDDEN}}`, vars: { OVERRIDDEN: "explicit" } }, { signal: controller.signal })
    const rejected = expect(pending).rejects.toBeDefined()
    await vi.waitFor(() => { expect(existsSync(join(checkout, "pids-ONE.json"))).toBe(true); expect(existsSync(join(checkout, "pids-TWO.json"))).toBe(true) })
    const pids = ["ONE", "TWO"].flatMap((name) => JSON.parse(readFileSync(join(checkout, `pids-${name}.json`), "utf8")) as number[])
    controller.abort(); await rejected
    await Promise.allSettled(commands)
    await vi.waitFor(() => { for (const pid of pids) expect(() => process.kill(pid, 0)).toThrow() })
    expect(existsSync(join(checkout, "pids-OVERRIDDEN.json"))).toBe(false)
    records.push({ phase: "commands", ownedCommands: commands.length, ownedParentsAndDescendants: pids.length, allRetired: true, overriddenCommandExecuted: false })
    writeFileSync(resolve("plans/performance/unit20-loaded-after.json"), JSON.stringify({ runtime: process.version, path: "real SDK MessageChannel → real host broker → loaded permission-scoped worker RPC → portable HTTP route → real loopback fetch / host core.proc", note: "Device HTTPS transport is adapted by the host service in this probe; no external URL or normal profile", records }, null, 2) + "\n")
  } finally {
    host.dispose(); channels.port1.close(); channels.port2.close(); _resetConnection(); vi.unstubAllGlobals(); vi.restoreAllMocks()
    for (const socket of sockets) socket.destroy()
    await new Promise<void>((yes) => server.close(() => yes()))
    await Promise.allSettled(calls); await Promise.allSettled(commands)
  }
  } finally { await running?.dispose(); db.cleanup(); rmSync(root, { recursive: true, force: true }) }
}, 120_000)
