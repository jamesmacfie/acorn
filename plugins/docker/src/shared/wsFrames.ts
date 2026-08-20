// Docker's WebSocket frame contracts. They lived in @acorn/protocol/docker.ts, and protocol's ws.ts
// imported this file to build eleven docker channels into a union core owned. The envelope is open now
// (@acorn/protocol/ws.ts), so the payloads come home: core routes on the `docker` prefix and never
// looks inside.

// One sample per `docker stats` tick, about 1s.
export type DockerStatsSample = {
  cpuPercent: number
  memPercent: number
  memUsage: string // "24.5MiB / 7.75GiB" — display text; parsing bytes adds nothing
  netIO: string
  blockIO: string
  pids: number
}

// Renderer to node. Refs are shape-validated at the handler (main/wsChannel.ts) before they reach argv.
export type DockerClientFrame =
  | { channel: 'docker:logs:attach'; id: string }
  | { channel: 'docker:logs:detach'; id: string }
  | { channel: 'docker:stats:attach'; id: string }
  | { channel: 'docker:stats:detach'; id: string }
  | { channel: 'docker:exec:open'; execId: string; ref: string; cols: number; rows: number }
  | { channel: 'docker:exec:in'; execId: string; data: string }
  | { channel: 'docker:exec:resize'; execId: string; cols: number; rows: number }
  | { channel: 'docker:exec:kill'; execId: string }

// Node to renderer. `docker:changed` is the cache-dirty ping; its scopes are containers, images, volumes
// and networks.
export type DockerServerFrame =
  | { channel: 'docker:changed'; scopes: string[] }
  | { channel: 'docker:log'; id: string; data: string }
  | { channel: 'docker:stats'; id: string; sample: DockerStatsSample }
  | { channel: 'docker:stream-end'; id: string; kind: 'logs' | 'stats' }
  | { channel: 'docker:exec:out'; execId: string; data: string }
  | { channel: 'docker:exec:exit'; execId: string }
