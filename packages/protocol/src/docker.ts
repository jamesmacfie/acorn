// Docker WS stream payloads (the terminal.ts precedent: core/shared owns frame payload types so
// ws.ts stays plugin-agnostic). One sample per `docker stats` tick (~1s).
export type DockerStatsSample = {
  cpuPercent: number
  memPercent: number
  memUsage: string // "24.5MiB / 7.75GiB" — display text; parsing bytes adds nothing
  netIO: string
  blockIO: string
  pids: number
}
