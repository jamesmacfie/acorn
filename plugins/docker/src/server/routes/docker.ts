// Docker surface routes (docs/plugins.md): the local daemon browsed/actioned over loopback HTTP
// behind the DockerBridge (main/dockerBridge.ts). Refs reach argv in the main process, so every
// ref is shape-validated here first (leading-dash guard) — 503 when the bridge isn't wired.
import { Hono } from 'hono'
import { z } from 'zod'
import { bridgeSlot, viaBridge } from '@acorn/node-core/server/bridge.ts'
import type { AppEnv } from '@acorn/node-core/server/middleware/auth.ts'
import { requireDevice } from '@acorn/node-core/server/middleware/requireUser.ts'
import { respondError } from '@acorn/node-core/server/respond.ts'
import type {
  DockerComposeAction,
  DockerContainerAction,
  DockerContainerDetail,
  DockerContainerSummary,
  DockerImage,
  DockerInfo,
  DockerNetwork,
  DockerPruneKind,
  DockerTaskSummary,
  DockerVolume,
} from '../../shared/model'
import { dockerComposeActions, dockerContainerActions, dockerPruneKinds, isDockerRef } from '../../shared/model'

export type DockerBridge = {
  info(): Promise<DockerInfo>
  containers(): Promise<DockerContainerSummary[]>
  inspectContainer(ref: string): Promise<DockerContainerDetail>
  containerAction(ref: string, action: DockerContainerAction): Promise<{ ok: true }>
  removeContainer(ref: string, force: boolean): Promise<{ ok: true }>
  images(): Promise<DockerImage[]>
  removeImage(ref: string, force: boolean): Promise<{ ok: true }>
  volumes(): Promise<DockerVolume[]>
  removeVolume(name: string, force: boolean): Promise<{ ok: true }>
  networks(): Promise<DockerNetwork[]>
  removeNetwork(ref: string): Promise<{ ok: true }>
  prune(kind: DockerPruneKind): Promise<{ reclaimed: string }>
  composeAction(project: string, action: DockerComposeAction): Promise<{ ok: true }>
  taskSummary(): Promise<DockerTaskSummary[]>
  taskContainers(taskId: string): Promise<DockerContainerSummary[]>
  taskTeardown(taskId: string): Promise<{ ok: true }>
}

export const dockerBridgeSlot = bridgeSlot<DockerBridge>()
export const setDockerBridge = dockerBridgeSlot.set

const actionBody = z.object({ action: z.enum(dockerContainerActions as [DockerContainerAction, ...DockerContainerAction[]]) })
const removeBody = z.object({ force: z.boolean().optional() })
const pruneBody = z.object({ kind: z.enum(dockerPruneKinds as [DockerPruneKind, ...DockerPruneKind[]]) })
const composeBody = z.object({
  project: z.string().refine(isDockerRef),
  action: z.enum(dockerComposeActions as [DockerComposeAction, ...DockerComposeAction[]]),
})

const ref = (c: { req: { param(k: string): string } }): string | null => {
  const value = c.req.param('ref')
  return isDockerRef(value) ? value : null
}

// Every DAEMON-WIDE path in this router is device-only. Only the two task-addressed routes at the bottom are
// reachable by a task-scoped agent, and those are already confined by core's `/v2/p/:plugin/tasks/:id` mount.
//
// phase3-notes.md named this gap but described it as availability — "a task-scoped agent can still prune the
// daemon". The sharper half is exfiltration: `GET /containers/:ref/inspect` returns `env: string[]`
// (shared/model.ts), i.e. every container's full environment. With `/containers` and `/task-summary`
// enumerating what exists, a confined agent could walk the machine and read `POSTGRES_PASSWORD` and every API
// key in every container the owner runs — including containers belonging to work it has nothing to do with.
// The delete surface (`/prune`, the four `*/remove`, `/containers/:ref/action`, `/compose/action`) is real too
// and none of it has a task to check, which is why `mayActOnTask` was never the shape of this fix.
//
// requireDevice, not requireProviderAccess: nothing on the node's own loopback path browses the daemon, so
// there is no 'service'-scope caller to keep working. Docker browse is a renderer surface.
//
// Enumerated per subtree rather than one `use('*')` with a path-string exemption for `/tasks/`, because this
// router is mounted under `/v2/p/docker` and a middleware matching `*` sees the full request path — sniffing
// for a `/tasks/` segment in it would be a guard whose correctness depends on the mount prefix. The cost is
// that a NEW daemon-wide route must be added to this list; docker.test.ts closes that by walking the router's
// own route table and refusing any ungated non-task path, so forgetting fails the suite rather than shipping.
// Measured: Hono's trailing `/*` matches zero segments, so `/containers/*` also covers bare `/containers`.
export const docker = new Hono<AppEnv>()
  .use('/info', requireDevice)
  .use('/containers/*', requireDevice)
  .use('/images/*', requireDevice)
  .use('/volumes/*', requireDevice)
  .use('/networks/*', requireDevice)
  .use('/prune', requireDevice)
  .use('/compose/*', requireDevice)
  .use('/task-summary', requireDevice)
  .get('/info', (c) => viaBridge(c, dockerBridgeSlot, (b) => b.info()))
  .get('/containers', (c) => viaBridge(c, dockerBridgeSlot, (b) => b.containers()))
  .get('/containers/:ref/inspect', (c) => {
    const r = ref(c)
    if (!r) return respondError(c, 400, 'bad_request')
    return viaBridge(c, dockerBridgeSlot, (b) => b.inspectContainer(r))
  })
  .post('/containers/:ref/action', async (c) => {
    const r = ref(c)
    const p = actionBody.safeParse(await c.req.json().catch(() => null))
    if (!r || !p.success) return respondError(c, 400, 'bad_request')
    return viaBridge(c, dockerBridgeSlot, (b) => b.containerAction(r, p.data.action))
  })
  .post('/containers/:ref/remove', async (c) => {
    const r = ref(c)
    const p = removeBody.safeParse(await c.req.json().catch(() => ({})))
    if (!r || !p.success) return respondError(c, 400, 'bad_request')
    return viaBridge(c, dockerBridgeSlot, (b) => b.removeContainer(r, p.data.force ?? false))
  })
  .get('/images', (c) => viaBridge(c, dockerBridgeSlot, (b) => b.images()))
  .post('/images/:ref/remove', async (c) => {
    const r = ref(c)
    const p = removeBody.safeParse(await c.req.json().catch(() => ({})))
    if (!r || !p.success) return respondError(c, 400, 'bad_request')
    return viaBridge(c, dockerBridgeSlot, (b) => b.removeImage(r, p.data.force ?? false))
  })
  .get('/volumes', (c) => viaBridge(c, dockerBridgeSlot, (b) => b.volumes()))
  .post('/volumes/:ref/remove', async (c) => {
    const r = ref(c)
    const p = removeBody.safeParse(await c.req.json().catch(() => ({})))
    if (!r || !p.success) return respondError(c, 400, 'bad_request')
    return viaBridge(c, dockerBridgeSlot, (b) => b.removeVolume(r, p.data.force ?? false))
  })
  .get('/networks', (c) => viaBridge(c, dockerBridgeSlot, (b) => b.networks()))
  .post('/networks/:ref/remove', (c) => {
    const r = ref(c)
    if (!r) return respondError(c, 400, 'bad_request')
    return viaBridge(c, dockerBridgeSlot, (b) => b.removeNetwork(r))
  })
  .post('/prune', async (c) => {
    const p = pruneBody.safeParse(await c.req.json().catch(() => null))
    if (!p.success) return respondError(c, 400, 'bad_request')
    return viaBridge(c, dockerBridgeSlot, (b) => b.prune(p.data.kind))
  })
  .post('/compose/action', async (c) => {
    const p = composeBody.safeParse(await c.req.json().catch(() => null))
    if (!p.success) return respondError(c, 400, 'bad_request')
    return viaBridge(c, dockerBridgeSlot, (b) => b.composeAction(p.data.project, p.data.action))
  })
  .get('/task-summary', (c) => viaBridge(c, dockerBridgeSlot, (b) => b.taskSummary()))
  .get('/tasks/:id/containers', (c) => viaBridge(c, dockerBridgeSlot, (b) => b.taskContainers(c.req.param('id'))))
  .post('/tasks/:id/teardown', (c) => viaBridge(c, dockerBridgeSlot, (b) => b.taskTeardown(c.req.param('id'))))
