// Renderer API for the /v1/p/docker routes: loopback HTTP, same shape as databaseClient.ts.
import { activeNodeId, readJson, writeJson } from '@acorn/plugin-api/client'
import type {
  DockerComposeAction,
  DockerContainerAction,
  DockerContainerDetail,
  DockerContainerSummary,
  DockerImage,
  DockerInfo,
  DockerNetwork,
  DockerProjectMatcher,
  DockerPruneKind,
  DockerTaskSummary,
  DockerVolume,
} from '../shared/model'
import {
  dockerComposeActionRoute,
  dockerContainerActionRoute,
  dockerContainerInspectRoute,
  dockerContainerRemoveRoute,
  dockerContainersRoute,
  dockerImageRemoveRoute,
  dockerImagesRoute,
  dockerInfoRoute,
  dockerNetworkRemoveRoute,
  dockerNetworksRoute,
  dockerProjectMatcherRoute,
  dockerPruneRoute,
  dockerTaskContainersRoute,
  dockerTaskSummaryRoute,
  dockerTaskTeardownRoute,
  dockerVolumeRemoveRoute,
  dockerVolumesRoute,
} from '../shared/model'

const post = <T>(url: string, body: unknown, nodeId: string | null): Promise<T> =>
  writeJson<T>(url, { nodeId, method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })

export const fetchDockerInfo = (nodeId: string | null = activeNodeId()): Promise<DockerInfo> => readJson<DockerInfo>(dockerInfoRoute(), { nodeId })
export const fetchProjectMatcher = (projectId: string, nodeId: string | null = activeNodeId()): Promise<DockerProjectMatcher> => readJson<DockerProjectMatcher>(dockerProjectMatcherRoute(projectId), { nodeId })
export const fetchContainers = (nodeId: string | null = activeNodeId()): Promise<DockerContainerSummary[]> => readJson<DockerContainerSummary[]>(dockerContainersRoute(), { nodeId })
export const fetchContainerDetail = (ref: string, nodeId: string | null = activeNodeId()): Promise<DockerContainerDetail> => readJson<DockerContainerDetail>(dockerContainerInspectRoute(ref), { nodeId })
export const containerAction = (ref: string, action: DockerContainerAction, nodeId: string | null = activeNodeId()): Promise<{ ok: true }> => post(dockerContainerActionRoute(ref), { action }, nodeId)
export const removeContainer = (ref: string, force = false, nodeId: string | null = activeNodeId()): Promise<{ ok: true }> => post(dockerContainerRemoveRoute(ref), { force }, nodeId)
export const fetchImages = (nodeId: string | null = activeNodeId()): Promise<DockerImage[]> => readJson<DockerImage[]>(dockerImagesRoute(), { nodeId })
export const removeImage = (ref: string, force = false, nodeId: string | null = activeNodeId()): Promise<{ ok: true }> => post(dockerImageRemoveRoute(ref), { force }, nodeId)
export const fetchVolumes = (nodeId: string | null = activeNodeId()): Promise<DockerVolume[]> => readJson<DockerVolume[]>(dockerVolumesRoute(), { nodeId })
export const removeVolume = (name: string, force = false, nodeId: string | null = activeNodeId()): Promise<{ ok: true }> => post(dockerVolumeRemoveRoute(name), { force }, nodeId)
export const fetchNetworks = (nodeId: string | null = activeNodeId()): Promise<DockerNetwork[]> => readJson<DockerNetwork[]>(dockerNetworksRoute(), { nodeId })
export const removeNetwork = (ref: string, nodeId: string | null = activeNodeId()): Promise<{ ok: true }> => post(dockerNetworkRemoveRoute(ref), {}, nodeId)
export const dockerPrune = (kind: DockerPruneKind, nodeId: string | null = activeNodeId()): Promise<{ reclaimed: string }> => post(dockerPruneRoute(), { kind }, nodeId)
export const composeAction = (project: string, action: DockerComposeAction, nodeId: string | null = activeNodeId()): Promise<{ ok: true }> => post(dockerComposeActionRoute(), { project, action }, nodeId)
export const fetchTaskSummaries = (nodeId: string | null = activeNodeId()): Promise<DockerTaskSummary[]> => readJson<DockerTaskSummary[]>(dockerTaskSummaryRoute(), { nodeId })
export const fetchTaskContainers = (taskId: string, nodeId: string | null = activeNodeId()): Promise<DockerContainerSummary[]> => readJson<DockerContainerSummary[]>(dockerTaskContainersRoute(taskId), { nodeId })
export const teardownTaskContainers = (taskId: string, nodeId: string | null = activeNodeId()): Promise<{ ok: true }> => post(dockerTaskTeardownRoute(taskId), {}, nodeId)
