// Renderer API for the /api/docker routes — loopback HTTP, same shape as databaseClient.ts.
import { readJson, writeJson } from '../../../core/client/apiClient'
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
  dockerPruneRoute,
  dockerTaskContainersRoute,
  dockerTaskSummaryRoute,
  dockerTaskTeardownRoute,
  dockerVolumeRemoveRoute,
  dockerVolumesRoute,
} from '../shared/model'

const post = <T>(url: string, body: unknown): Promise<T> =>
  writeJson<T>(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })

export const fetchDockerInfo = (): Promise<DockerInfo> => readJson<DockerInfo>(dockerInfoRoute())
export const fetchContainers = (): Promise<DockerContainerSummary[]> => readJson<DockerContainerSummary[]>(dockerContainersRoute())
export const fetchContainerDetail = (ref: string): Promise<DockerContainerDetail> => readJson<DockerContainerDetail>(dockerContainerInspectRoute(ref))
export const containerAction = (ref: string, action: DockerContainerAction): Promise<{ ok: true }> => post(dockerContainerActionRoute(ref), { action })
export const removeContainer = (ref: string, force = false): Promise<{ ok: true }> => post(dockerContainerRemoveRoute(ref), { force })
export const fetchImages = (): Promise<DockerImage[]> => readJson<DockerImage[]>(dockerImagesRoute())
export const removeImage = (ref: string, force = false): Promise<{ ok: true }> => post(dockerImageRemoveRoute(ref), { force })
export const fetchVolumes = (): Promise<DockerVolume[]> => readJson<DockerVolume[]>(dockerVolumesRoute())
export const removeVolume = (name: string, force = false): Promise<{ ok: true }> => post(dockerVolumeRemoveRoute(name), { force })
export const fetchNetworks = (): Promise<DockerNetwork[]> => readJson<DockerNetwork[]>(dockerNetworksRoute())
export const removeNetwork = (ref: string): Promise<{ ok: true }> => post(dockerNetworkRemoveRoute(ref), {})
export const dockerPrune = (kind: DockerPruneKind): Promise<{ reclaimed: string }> => post(dockerPruneRoute(), { kind })
export const composeAction = (project: string, action: DockerComposeAction): Promise<{ ok: true }> => post(dockerComposeActionRoute(), { project, action })
export const fetchTaskSummaries = (): Promise<DockerTaskSummary[]> => readJson<DockerTaskSummary[]>(dockerTaskSummaryRoute())
export const fetchTaskContainers = (taskId: string): Promise<DockerContainerSummary[]> => readJson<DockerContainerSummary[]>(dockerTaskContainersRoute(taskId))
export const teardownTaskContainers = (taskId: string): Promise<{ ok: true }> => post(dockerTaskTeardownRoute(taskId), {})
