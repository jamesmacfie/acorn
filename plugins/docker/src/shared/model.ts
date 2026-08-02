// Wire types for the Docker surface (local daemon via the docker CLI), shared between the
// main-process service (main/) and the renderer (client/) across the HTTP/bridge boundary.
// Containers carry the standard compose labels; task↔container linking matches
// `com.docker.compose.project.working_dir` against task worktree paths (docs/plugins.md).

export type DockerInfo =
  | { available: true; version: string; context: string | null }
  | { available: false; reason: 'not_installed' | 'daemon_down'; detail: string }

export type DockerPort = {
  hostIp: string | null
  hostPort: number | null
  containerPort: number
  protocol: string
}

export type DockerContainerSummary = {
  id: string
  name: string
  image: string
  // The daemon's state machine value: created | running | paused | restarting | exited | dead
  state: string
  status: string // human text, e.g. "Up 3 hours (healthy)"
  createdAt: number | null // epoch ms
  ports: DockerPort[]
  composeProject: string | null
  composeService: string | null
  composeWorkingDir: string | null
  labels: Record<string, string>
  // The compose working_dir no longer exists on disk — the worktree behind this stack is gone
  // (the stale-cleanup signal). Computed main-side; absent when there is no working_dir label.
  workingDirMissing?: boolean
}

export type DockerImage = {
  id: string
  repository: string
  tag: string
  size: string
  createdAt: number | null
  containers: number | null // in-use count; null when the CLI reports N/A
}

export type DockerVolume = {
  name: string
  driver: string
  mountpoint: string
  composeProject: string | null
  anonymous: boolean
}

export type DockerNetwork = {
  id: string
  name: string
  driver: string
  scope: string
  internal: boolean
}

export type DockerMount = { type: string; source: string; destination: string; rw: boolean }

export type DockerContainerDetail = DockerContainerSummary & {
  command: string
  startedAt: string | null
  finishedAt: string | null
  exitCode: number | null
  restartCount: number
  health: string | null // healthy | unhealthy | starting
  env: string[]
  mounts: DockerMount[]
  networks: string[]
  imageId: string
}

export type DockerContainerAction = 'start' | 'stop' | 'restart' | 'kill' | 'pause' | 'unpause'
export const dockerContainerActions: readonly DockerContainerAction[] = ['start', 'stop', 'restart', 'kill', 'pause', 'unpause']

// Compose bulk ops act on the recorded project (labels), so they work without compose files —
// which rules out `up`; `start` restarts the project's existing containers.
export type DockerComposeAction = 'start' | 'stop' | 'restart' | 'down'
export const dockerComposeActions: readonly DockerComposeAction[] = ['start', 'stop', 'restart', 'down']

export type DockerPruneKind = 'containers' | 'images' | 'volumes' | 'networks' | 'builder'
export const dockerPruneKinds: readonly DockerPruneKind[] = ['containers', 'images', 'volumes', 'networks', 'builder']

// Cache scopes — also the payload of the `docker:changed` WS frame.
export type DockerScope = 'containers' | 'images' | 'volumes' | 'networks'

// Container/image/network refs and compose project names reach argv in the main process — validate
// shape and forbid a leading dash so a ref can never be read as a flag (privileged-boundary contract).
const REF_RE = /^[A-Za-z0-9][A-Za-z0-9_.:/-]{0,255}$/
export const isDockerRef = (ref: string): boolean => REF_RE.test(ref)

// Task↔container linkage (docs/workspaces-and-tasks.md): computed main-side by matching compose
// working_dir labels (and slug fallbacks) against task worktrees. One entry per active task with
// at least one matched container.
export type DockerTaskSummary = {
  taskId: string
  running: number
  total: number
  projects: string[] // distinct compose projects among the matched containers
}

// Route helpers (loopback HTTP; mounted at /api/docker in app/server/routes.ts).
export const dockerInfoRoute = (): string => '/api/docker/info'
export const dockerContainersRoute = (): string => '/api/docker/containers'
export const dockerContainerInspectRoute = (ref: string): string => `/api/docker/containers/${encodeURIComponent(ref)}/inspect`
export const dockerContainerActionRoute = (ref: string): string => `/api/docker/containers/${encodeURIComponent(ref)}/action`
export const dockerContainerRemoveRoute = (ref: string): string => `/api/docker/containers/${encodeURIComponent(ref)}/remove`
export const dockerImagesRoute = (): string => '/api/docker/images'
export const dockerImageRemoveRoute = (ref: string): string => `/api/docker/images/${encodeURIComponent(ref)}/remove`
export const dockerVolumesRoute = (): string => '/api/docker/volumes'
export const dockerVolumeRemoveRoute = (name: string): string => `/api/docker/volumes/${encodeURIComponent(name)}/remove`
export const dockerNetworksRoute = (): string => '/api/docker/networks'
export const dockerNetworkRemoveRoute = (ref: string): string => `/api/docker/networks/${encodeURIComponent(ref)}/remove`
export const dockerPruneRoute = (): string => '/api/docker/prune'
export const dockerComposeActionRoute = (): string => '/api/docker/compose/action'
export const dockerTaskSummaryRoute = (): string => '/api/docker/task-summary'
export const dockerTaskContainersRoute = (taskId: string): string => `/api/docker/tasks/${encodeURIComponent(taskId)}/containers`
export const dockerTaskTeardownRoute = (taskId: string): string => `/api/docker/tasks/${encodeURIComponent(taskId)}/teardown`
