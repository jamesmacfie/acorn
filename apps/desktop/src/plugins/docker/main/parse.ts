// Pure parsers: docker CLI `--format '{{json .}}'` output → shared wire models. Kept free of
// child-process concerns so they unit-test against captured fixtures (parse.test.ts).
import type { DockerStatsSample } from '../../../core/shared/docker'
import type { DockerContainerDetail, DockerContainerSummary, DockerImage, DockerNetwork, DockerPort, DockerScope, DockerVolume } from '../shared/model'

// Every list command emits one JSON object per line. Malformed lines are skipped, not fatal —
// a torn read mid-stream must never take the whole list down.
export function parseJsonLines<T>(text: string): T[] {
  const out: T[] = []
  for (const line of text.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed) continue
    try {
      out.push(JSON.parse(trimmed) as T)
    } catch {
      // skip
    }
  }
  return out
}

// `docker ps` Labels is one comma-joined "k=v" string, but values themselves may contain commas
// (compose's config_files / depends_on do). Segments without '=' belong to the previous value.
export function parseLabelString(raw: string): Record<string, string> {
  const labels: Record<string, string> = {}
  let lastKey: string | null = null
  for (const segment of raw.split(',')) {
    const eq = segment.indexOf('=')
    if (eq > 0) {
      lastKey = segment.slice(0, eq)
      labels[lastKey] = segment.slice(eq + 1)
    } else if (lastKey) {
      labels[lastKey] += `,${segment}`
    }
  }
  return labels
}

// "127.0.0.1:5535->5432/tcp, 80/tcp, :::55432->5432/tcp" → structured ports. Unpublished entries
// keep hostIp/hostPort null; IPv6 duplicates of the same mapping are dropped by the caller-visible
// dedupe on (hostPort, containerPort, protocol).
export function parsePortString(raw: string): DockerPort[] {
  const ports: DockerPort[] = []
  const seen = new Set<string>()
  for (const entry of raw.split(',')) {
    const part = entry.trim()
    if (!part) continue
    const m = /^(?:(.+):(\d+(?:-\d+)?)->)?(\d+(?:-\d+)?)\/(\w+)$/.exec(part)
    if (!m) continue
    const [, hostIp, hostPortRaw, containerPortRaw, protocol] = m
    // Ranges ("3108-3109") list their first port; the row text keeps the full detail.
    const hostPort = hostPortRaw ? Number(hostPortRaw.split('-')[0]) : null
    const containerPort = Number(containerPortRaw.split('-')[0])
    const key = `${hostPort}:${containerPort}/${protocol}`
    if (seen.has(key)) continue
    seen.add(key)
    ports.push({ hostIp: hostIp === '::' ? null : (hostIp ?? null), hostPort, containerPort, protocol })
  }
  return ports
}

// "2026-07-24 10:03:46 +1200 NZST" → epoch ms (the trailing zone name is redundant with the offset).
export function parseCliTimestamp(raw: string): number | null {
  const ms = Date.parse(raw.replace(/ [A-Z]{3,5}$/, ''))
  return Number.isNaN(ms) ? null : ms
}

type PsLine = {
  ID?: string
  Names?: string
  Image?: string
  State?: string
  Status?: string
  Ports?: string
  Labels?: string
  CreatedAt?: string
}

export function parsePsOutput(text: string): DockerContainerSummary[] {
  return parseJsonLines<PsLine>(text).flatMap((line) => {
    if (!line.ID || !line.Names) return []
    const labels = parseLabelString(line.Labels ?? '')
    return [{
      id: line.ID,
      name: line.Names,
      image: line.Image ?? '',
      state: line.State ?? 'unknown',
      status: line.Status ?? '',
      createdAt: line.CreatedAt ? parseCliTimestamp(line.CreatedAt) : null,
      ports: parsePortString(line.Ports ?? ''),
      composeProject: labels['com.docker.compose.project'] ?? null,
      composeService: labels['com.docker.compose.service'] ?? null,
      composeWorkingDir: labels['com.docker.compose.project.working_dir'] ?? null,
      labels,
    }]
  })
}

// `docker inspect <ref>` emits a JSON array; we inspect one ref at a time.
type InspectEntry = {
  Id?: string
  Name?: string
  Created?: string
  Path?: string
  Args?: string[]
  Image?: string
  RestartCount?: number
  State?: {
    Status?: string
    ExitCode?: number
    StartedAt?: string
    FinishedAt?: string
    Health?: { Status?: string }
  }
  Config?: { Image?: string; Env?: string[]; Labels?: Record<string, string> }
  Mounts?: { Type?: string; Source?: string; Destination?: string; RW?: boolean }[]
  NetworkSettings?: { Networks?: Record<string, unknown>; Ports?: Record<string, { HostIp?: string; HostPort?: string }[] | null> }
}

const GO_ZERO_TIME = '0001-01-01T00:00:00Z'
const timeOrNull = (v: string | undefined): string | null => (v && v !== GO_ZERO_TIME ? v : null)

export function parseInspectOutput(text: string): DockerContainerDetail | null {
  let entries: InspectEntry[]
  try {
    entries = JSON.parse(text) as InspectEntry[]
  } catch {
    return null
  }
  const e = entries[0]
  if (!e?.Id) return null
  const labels = e.Config?.Labels ?? {}
  const ports: DockerPort[] = []
  const seen = new Set<string>()
  for (const [spec, bindings] of Object.entries(e.NetworkSettings?.Ports ?? {})) {
    const m = /^(\d+)\/(\w+)$/.exec(spec)
    if (!m) continue
    const containerPort = Number(m[1])
    const protocol = m[2]
    for (const b of bindings ?? [{}]) {
      const hostPort = b.HostPort ? Number(b.HostPort) : null
      const key = `${hostPort}:${containerPort}/${protocol}`
      if (seen.has(key)) continue
      seen.add(key)
      ports.push({ hostIp: b.HostIp && b.HostIp !== '::' ? b.HostIp : null, hostPort, containerPort, protocol })
    }
  }
  return {
    id: e.Id.slice(0, 12),
    name: (e.Name ?? '').replace(/^\//, ''),
    image: e.Config?.Image ?? '',
    state: e.State?.Status ?? 'unknown',
    status: e.State?.Status ?? '',
    createdAt: e.Created ? (Number.isNaN(Date.parse(e.Created)) ? null : Date.parse(e.Created)) : null,
    ports,
    composeProject: labels['com.docker.compose.project'] ?? null,
    composeService: labels['com.docker.compose.service'] ?? null,
    composeWorkingDir: labels['com.docker.compose.project.working_dir'] ?? null,
    labels,
    command: [e.Path ?? '', ...(e.Args ?? [])].join(' ').trim(),
    startedAt: timeOrNull(e.State?.StartedAt),
    finishedAt: timeOrNull(e.State?.FinishedAt),
    exitCode: e.State?.ExitCode ?? null,
    restartCount: e.RestartCount ?? 0,
    health: e.State?.Health?.Status ?? null,
    env: e.Config?.Env ?? [],
    mounts: (e.Mounts ?? []).map((m) => ({ type: m.Type ?? '', source: m.Source ?? '', destination: m.Destination ?? '', rw: m.RW ?? true })),
    networks: Object.keys(e.NetworkSettings?.Networks ?? {}),
    imageId: e.Image ?? '',
  }
}

type ImageLine = { ID?: string; Repository?: string; Tag?: string; Size?: string; CreatedAt?: string; Containers?: string }

export function parseImagesOutput(text: string): DockerImage[] {
  return parseJsonLines<ImageLine>(text).flatMap((line) => {
    if (!line.ID) return []
    const containers = Number(line.Containers ?? '')
    return [{
      id: line.ID,
      repository: line.Repository ?? '<none>',
      tag: line.Tag ?? '<none>',
      size: line.Size ?? '',
      createdAt: line.CreatedAt ? parseCliTimestamp(line.CreatedAt) : null,
      containers: Number.isNaN(containers) ? null : containers,
    }]
  })
}

type VolumeLine = { Name?: string; Driver?: string; Mountpoint?: string; Labels?: string }

export function parseVolumesOutput(text: string): DockerVolume[] {
  return parseJsonLines<VolumeLine>(text).flatMap((line) => {
    if (!line.Name) return []
    const labels = parseLabelString(line.Labels ?? '')
    return [{
      name: line.Name,
      driver: line.Driver ?? '',
      mountpoint: line.Mountpoint ?? '',
      composeProject: labels['com.docker.compose.project'] ?? null,
      anonymous: 'com.docker.volume.anonymous' in labels,
    }]
  })
}

type NetworkLine = { ID?: string; Name?: string; Driver?: string; Scope?: string; Internal?: string }

export function parseNetworksOutput(text: string): DockerNetwork[] {
  return parseJsonLines<NetworkLine>(text).flatMap((line) => {
    if (!line.ID || !line.Name) return []
    return [{
      id: line.ID,
      name: line.Name,
      driver: line.Driver ?? '',
      scope: line.Scope ?? '',
      internal: line.Internal === 'true',
    }]
  })
}

// One `docker stats --format '{{json .}}'` tick → a sample. Percentages arrive as "0.50%".
type StatsLine = { CPUPerc?: string; MemPerc?: string; MemUsage?: string; NetIO?: string; BlockIO?: string; PIDs?: string }

const percent = (v: string | undefined): number => {
  const n = Number((v ?? '').replace('%', ''))
  return Number.isNaN(n) ? 0 : n
}

export function parseStatsLine(line: string): DockerStatsSample | null {
  let raw: StatsLine
  try {
    raw = JSON.parse(line) as StatsLine
  } catch {
    return null
  }
  if (raw.CPUPerc === undefined && raw.MemUsage === undefined) return null
  return {
    cpuPercent: percent(raw.CPUPerc),
    memPercent: percent(raw.MemPerc),
    memUsage: raw.MemUsage ?? '',
    netIO: raw.NetIO ?? '',
    blockIO: raw.BlockIO ?? '',
    pids: Number(raw.PIDs ?? 0) || 0,
  }
}

// `docker events` frames → which cache scope they dirty. Noisy non-state events (execs, health
// probes' exec plumbing, top/attach) are ignored so a busy stack doesn't thrash the cache.
type EventLine = { Type?: string; Action?: string }

const EVENT_SCOPES: Record<string, DockerScope> = { container: 'containers', image: 'images', volume: 'volumes', network: 'networks' }
const IGNORED_ACTION_RE = /^(exec_|top|attach|detach|resize|archive-path|extract-to-dir)/

export function eventScope(line: unknown): DockerScope | null {
  const e = line as EventLine
  const scope = e.Type ? (EVENT_SCOPES[e.Type] ?? null) : null
  if (!scope) return null
  if (e.Action && IGNORED_ACTION_RE.test(e.Action)) return null
  return scope
}
