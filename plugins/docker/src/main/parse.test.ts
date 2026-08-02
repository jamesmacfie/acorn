import { describe, expect, it } from 'vitest'
import { eventScope, parseCliTimestamp, parseInspectOutput, parseJsonLines, parseLabelString, parsePortString, parsePsOutput, parseStatsLine } from './parse'

// Fixtures captured from a live daemon (docker 29.x, compose 5.x labels).
const PS_LINE = JSON.stringify({
  Command: '"docker-entrypoint.s…"',
  CreatedAt: '2026-07-24 10:03:46 +1200 NZST',
  ID: '8ec3a53d3f7c',
  Image: 'runn_runn-branch-ed8dbb-hasura',
  Labels:
    'com.docker.compose.config-hash=f5e1,com.docker.compose.depends_on=postgres:service_healthy:false,app:service_healthy:false,com.docker.compose.project.config_files=/w/t/docker-compose.yml,/w/t/.runn/docker-compose.git-metadata.yml,com.docker.compose.project.working_dir=/w/t,com.docker.compose.project=runn_runn-branch-ed8dbb,com.docker.compose.service=hasura',
  Names: 'runn_runn-branch-ed8dbb-hasura-1',
  Ports: '127.0.0.1:5535->5432/tcp, 80/tcp, :::5535->5432/tcp',
  State: 'running',
  Status: 'Up 16 minutes (healthy)',
})

describe('parseJsonLines', () => {
  it('parses one object per line and skips malformed lines', () => {
    expect(parseJsonLines<{ a: number }>('{"a":1}\nnot json\n\n{"a":2}\n')).toEqual([{ a: 1 }, { a: 2 }])
  })
})

describe('parseLabelString', () => {
  it('re-joins comma-containing values to their key (compose config_files / depends_on)', () => {
    const labels = parseLabelString('a=1,b=x,y,z,c=3')
    expect(labels).toEqual({ a: '1', b: 'x,y,z', c: '3' })
  })
})

describe('parsePortString', () => {
  it('parses published, unpublished, and range entries; dedupes the IPv6 twin', () => {
    const ports = parsePortString('127.0.0.1:5535->5432/tcp, 80/tcp, :::5535->5432/tcp, 3108-3109/tcp')
    expect(ports).toEqual([
      { hostIp: '127.0.0.1', hostPort: 5535, containerPort: 5432, protocol: 'tcp' },
      { hostIp: null, hostPort: null, containerPort: 80, protocol: 'tcp' },
      { hostIp: null, hostPort: null, containerPort: 3108, protocol: 'tcp' },
    ])
  })
})

describe('parseCliTimestamp', () => {
  it('drops the trailing zone name and honours the offset', () => {
    expect(parseCliTimestamp('2026-07-24 10:03:46 +1200 NZST')).toBe(Date.parse('2026-07-24T10:03:46+12:00'))
    expect(parseCliTimestamp('garbage')).toBeNull()
  })
})

describe('parsePsOutput', () => {
  it('maps a live ps line to the summary model with compose labels lifted', () => {
    const [c] = parsePsOutput(`${PS_LINE}\n`)
    expect(c.id).toBe('8ec3a53d3f7c')
    expect(c.name).toBe('runn_runn-branch-ed8dbb-hasura-1')
    expect(c.state).toBe('running')
    expect(c.composeProject).toBe('runn_runn-branch-ed8dbb')
    expect(c.composeService).toBe('hasura')
    expect(c.composeWorkingDir).toBe('/w/t')
    expect(c.labels['com.docker.compose.depends_on']).toBe('postgres:service_healthy:false,app:service_healthy:false')
    expect(c.ports).toHaveLength(2)
    expect(c.createdAt).toBe(Date.parse('2026-07-24T10:03:46+12:00'))
  })
})

describe('parseInspectOutput', () => {
  it('maps the inspect array shape, normalizing go zero-times and the /name prefix', () => {
    const detail = parseInspectOutput(JSON.stringify([{
      Id: 'a52e9c718b8801c9b1065ad29a88728a4b3e197f8f7e5561fe482ca79ad892df',
      Name: '/runn-postgres-1',
      Created: '2026-07-23T22:10:09.777918174Z',
      Path: 'docker-entrypoint.sh',
      Args: ['postgres'],
      Image: 'sha256:abc',
      RestartCount: 2,
      State: { Status: 'running', ExitCode: 0, StartedAt: '2026-07-23T22:10:09.777918174Z', FinishedAt: '0001-01-01T00:00:00Z', Health: { Status: 'healthy' } },
      Config: { Image: 'pgvector/pgvector:0.8.0-pg15', Env: ['POSTGRES_USER=postgres'], Labels: { 'com.docker.compose.project': 'runn', 'com.docker.compose.project.working_dir': '/w/t' } },
      Mounts: [{ Type: 'volume', Source: 'pgdata', Destination: '/var/lib/postgresql/data', RW: true }],
      NetworkSettings: { Networks: { runn_default: {} }, Ports: { '5432/tcp': [{ HostIp: '127.0.0.1', HostPort: '5535' }, { HostIp: '::', HostPort: '5535' }], '9000/tcp': null } },
    }]))
    expect(detail).not.toBeNull()
    expect(detail!.id).toBe('a52e9c718b88')
    expect(detail!.name).toBe('runn-postgres-1')
    expect(detail!.command).toBe('docker-entrypoint.sh postgres')
    expect(detail!.finishedAt).toBeNull()
    expect(detail!.health).toBe('healthy')
    expect(detail!.composeWorkingDir).toBe('/w/t')
    expect(detail!.ports).toEqual([
      { hostIp: '127.0.0.1', hostPort: 5535, containerPort: 5432, protocol: 'tcp' },
      { hostIp: null, hostPort: null, containerPort: 9000, protocol: 'tcp' },
    ])
    expect(detail!.networks).toEqual(['runn_default'])
    expect(parseInspectOutput('[]')).toBeNull()
    expect(parseInspectOutput('nope')).toBeNull()
  })
})

describe('parseStatsLine', () => {
  it('parses a stats tick, stripping percent signs', () => {
    const line = JSON.stringify({ BlockIO: '0B / 0B', CPUPerc: '0.50%', ID: 'abc', MemPerc: '0.31%', MemUsage: '24.5MiB / 7.751GiB', NetIO: '1.2kB / 800B', PIDs: '9' })
    expect(parseStatsLine(line)).toEqual({ cpuPercent: 0.5, memPercent: 0.31, memUsage: '24.5MiB / 7.751GiB', netIO: '1.2kB / 800B', blockIO: '0B / 0B', pids: 9 })
    expect(parseStatsLine('not json')).toBeNull()
    expect(parseStatsLine('{}')).toBeNull()
  })
})

describe('eventScope', () => {
  it('maps state-changing events to scopes and drops exec/health-probe noise', () => {
    expect(eventScope({ Type: 'container', Action: 'die' })).toBe('containers')
    expect(eventScope({ Type: 'image', Action: 'delete' })).toBe('images')
    expect(eventScope({ Type: 'volume', Action: 'create' })).toBe('volumes')
    expect(eventScope({ Type: 'network', Action: 'connect' })).toBe('networks')
    expect(eventScope({ Type: 'container', Action: 'exec_create: /bin/sh -c pg_isready' })).toBeNull()
    expect(eventScope({ Type: 'container', Action: 'exec_die' })).toBeNull()
    expect(eventScope({ Type: 'builder', Action: 'prune' })).toBeNull()
    expect(eventScope({})).toBeNull()
  })
})
