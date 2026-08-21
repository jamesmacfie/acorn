// Docker surface routes (docs/plugins.md): the local daemon browsed/actioned over loopback HTTP
// behind the DockerBridge (main/dockerBridge.ts). Refs reach argv in the main process, so every
// ref is shape-validated here first (leading-dash guard). Answers 503 when the bridge isn't wired.
import { Hono } from 'hono'
import { z } from 'zod'
import { type AppEnv, requireDevice, respondError, routeCapability, setRouteTestCapability, viaBridge } from '@acorn/plugin-api/node'
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

export const DOCKER = routeCapability<DockerBridge>('docker.route')
/** @internal test compatibility; production providers use CapabilityRegistry.provide. */
export const setDockerBridge = (bridge: DockerBridge | null): void => setRouteTestCapability(DOCKER, bridge)

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

// Every daemon-wide path in this router is device-only. Only the task-addressed routes at the bottom are
// reachable by a task-scoped agent, and core confines those routes to the task in the caller's token.
// Device-only access protects both destructive operations and container inspection, whose environment data
// can contain credentials belonging to unrelated work.
//
// requireDevice, not requireProviderAccess: nothing on the node's own loopback path browses the daemon, so
// there is no 'service'-scope caller to keep working. Docker browse is a renderer surface.
//
// Subtrees are enumerated instead of using one path-string exemption for `/tasks/`: the router is mounted under
// `/v2/p/docker`, so a guard based on the full request path would depend on the mount prefix. The route test
// walks Hono's route table and fails if a new daemon-wide path is added without a device gate.
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
  .get('/info', (c) => viaBridge(c, DOCKER, (b) => b.info()))
  .get('/containers', (c) => viaBridge(c, DOCKER, (b) => b.containers()))
  .get('/containers/:ref/inspect', (c) => {
    const r = ref(c)
    if (!r) return respondError(c, 400, 'bad_request')
    return viaBridge(c, DOCKER, (b) => b.inspectContainer(r))
  })
  .post('/containers/:ref/action', async (c) => {
    const r = ref(c)
    const p = actionBody.safeParse(await c.req.json().catch(() => null))
    if (!r || !p.success) return respondError(c, 400, 'bad_request')
    return viaBridge(c, DOCKER, (b) => b.containerAction(r, p.data.action))
  })
  .post('/containers/:ref/remove', async (c) => {
    const r = ref(c)
    const p = removeBody.safeParse(await c.req.json().catch(() => ({})))
    if (!r || !p.success) return respondError(c, 400, 'bad_request')
    return viaBridge(c, DOCKER, (b) => b.removeContainer(r, p.data.force ?? false))
  })
  .get('/images', (c) => viaBridge(c, DOCKER, (b) => b.images()))
  .post('/images/:ref/remove', async (c) => {
    const r = ref(c)
    const p = removeBody.safeParse(await c.req.json().catch(() => ({})))
    if (!r || !p.success) return respondError(c, 400, 'bad_request')
    return viaBridge(c, DOCKER, (b) => b.removeImage(r, p.data.force ?? false))
  })
  .get('/volumes', (c) => viaBridge(c, DOCKER, (b) => b.volumes()))
  .post('/volumes/:ref/remove', async (c) => {
    const r = ref(c)
    const p = removeBody.safeParse(await c.req.json().catch(() => ({})))
    if (!r || !p.success) return respondError(c, 400, 'bad_request')
    return viaBridge(c, DOCKER, (b) => b.removeVolume(r, p.data.force ?? false))
  })
  .get('/networks', (c) => viaBridge(c, DOCKER, (b) => b.networks()))
  .post('/networks/:ref/remove', (c) => {
    const r = ref(c)
    if (!r) return respondError(c, 400, 'bad_request')
    return viaBridge(c, DOCKER, (b) => b.removeNetwork(r))
  })
  .post('/prune', async (c) => {
    const p = pruneBody.safeParse(await c.req.json().catch(() => null))
    if (!p.success) return respondError(c, 400, 'bad_request')
    return viaBridge(c, DOCKER, (b) => b.prune(p.data.kind))
  })
  .post('/compose/action', async (c) => {
    const p = composeBody.safeParse(await c.req.json().catch(() => null))
    if (!p.success) return respondError(c, 400, 'bad_request')
    return viaBridge(c, DOCKER, (b) => b.composeAction(p.data.project, p.data.action))
  })
  .get('/task-summary', (c) => viaBridge(c, DOCKER, (b) => b.taskSummary()))
  .get('/tasks/:id/containers', (c) => viaBridge(c, DOCKER, (b) => b.taskContainers(c.req.param('id'))))
  .post('/tasks/:id/teardown', (c) => viaBridge(c, DOCKER, (b) => b.taskTeardown(c.req.param('id'))))
