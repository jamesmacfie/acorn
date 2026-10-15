import { describe, expect, it } from 'vitest'
import { browserPanelView, type BrowserPanelBlock } from '@acorn/protocol/plugin/handoffs.ts'
import type { DockerContainerSummary } from '../shared/model'
import { dockerBrowserPanel, logContainer, sourceIdOf } from './browserPanel'

const container = (service: string, over: Partial<DockerContainerSummary> = {}): DockerContainerSummary => ({
  id: `${service}-id`,
  name: `shop-${service}-1`,
  image: service,
  state: 'running',
  status: 'Up 3 hours',
  createdAt: null,
  ports: [],
  composeProject: 'shop',
  composeService: service,
  composeWorkingDir: '/work/shop',
  labels: {},
  ...over,
})

const web = container('web', {
  status: 'Up 3 hours (healthy)',
  ports: [
    { hostIp: '0.0.0.0', hostPort: 3000, containerPort: 3000, protocol: 'tcp' },
    { hostIp: '0.0.0.0', hostPort: 3001, containerPort: 3001, protocol: 'udp' },
    { hostIp: null, hostPort: null, containerPort: 9229, protocol: 'tcp' },
  ],
})
const db = container('db', { ports: [{ hostIp: '127.0.0.1', hostPort: 5432, containerPort: 5432, protocol: 'tcp' }] })

// Builds the view the route answers, and holds it to the schema the browser's host applies.
const view = (containers: DockerContainerSummary[], source: string | null = null, lines = ['ready']) => {
  const picked = logContainer(containers, source)!
  return browserPanelView.parse(dockerBrowserPanel(containers, { container: picked, lines }))
}
const block = <K extends BrowserPanelBlock['kind']>(blocks: BrowserPanelBlock[], kind: K) =>
  blocks.find((b): b is Extract<BrowserPanelBlock, { kind: K }> => b.kind === kind)

describe('the Docker browser panel', () => {
  it('shows a healthy stack ordered by service, with its TCP ports and the first running logs', () => {
    expect(view([web, db]).blocks).toEqual([
      { kind: 'status', label: 'Containers', state: '2 of 2 running', severity: 'info' },
      {
        kind: 'rows',
        title: 'Containers',
        rows: [
          { label: 'db', state: 'Up 3 hours', severity: 'info' },
          { label: 'web', state: 'Up 3 hours (healthy)', severity: 'info' },
        ],
      },
      {
        kind: 'links',
        title: 'Ports',
        links: [
          { label: 'db 5432', url: 'http://localhost:5432', ready: true },
          { label: 'web 3000', url: 'http://localhost:3000', ready: true },
        ],
      },
      {
        kind: 'logs',
        title: 'Logs',
        sources: [
          { id: 'shop-db-1', label: 'db' },
          { id: 'shop-web-1', label: 'web' },
        ],
        source: 'shop-db-1',
        lines: ['ready'],
      },
    ])
  })

  it('names an exited container, picks its logs, and marks its ports not ready', () => {
    const api = container('api', {
      state: 'exited',
      status: 'Exited (1) 2 minutes ago',
      ports: [{ hostIp: null, hostPort: 8080, containerPort: 80, protocol: 'tcp' }],
    })
    const done = container('migrate', { state: 'exited', status: 'Exited (0) 5 minutes ago' })
    const { blocks } = view([web, api, done])
    expect(block(blocks, 'status')).toMatchObject({
      state: '1 of 3 running',
      severity: 'danger',
      detail: 'api: Exited (1) 2 minutes ago',
    })
    expect(block(blocks, 'rows')!.rows.map((r) => r.severity)).toEqual(['danger', 'info', 'info'])
    expect(block(blocks, 'links')!.links[0]).toEqual({ label: 'api 80', url: 'http://localhost:8080', ready: false })
    expect(block(blocks, 'logs')!.source).toBe('shop-api-1')
  })

  it('reads health from the status text, and ranks the worst state', () => {
    const sick = container('cache', { status: 'Up 1 minute (unhealthy)' })
    const starting = container('queue', { status: 'Up 5 seconds (health: starting)' })
    const paused = container('worker', { state: 'paused', status: 'Up 1 hour (Paused)' })
    expect(block(view([starting, paused]).blocks, 'status')).toMatchObject({
      severity: 'warn',
      detail: 'queue: Up 5 seconds (health: starting)\nworker: Up 1 hour (Paused)',
    })
    expect(block(view([starting]).blocks, 'status')!.severity).toBe('pending')
    expect(block(view([starting, sick]).blocks, 'status')!.severity).toBe('danger')
  })

  it('says when the worktree behind the stack is gone, and leaves out empty blocks', () => {
    const { blocks } = view([container('web', { workingDirMissing: true })])
    expect(block(blocks, 'status')!.detail).toBe('The worktree behind this stack is gone.')
    expect(block(blocks, 'links')).toBeUndefined()
  })

  it('keeps a picked source across a recreated container, and falls back for an unknown one', () => {
    const recreated = container('web', { id: 'new-id' })
    expect(logContainer([db, recreated], 'shop-web-1')?.id).toBe('new-id')
    expect(logContainer([db, recreated], 'gone')?.id).toBe('db-id')
    const stopped = container('db', { state: 'exited', status: 'Exited (0) 1 hour ago' })
    expect(logContainer([stopped], null)).toBe(stopped)
    expect(sourceIdOf(container('x', { name: '_My App/Web 1' }))).toBe('my-app-web-1')
  })

  it('cuts long lines and drops the oldest until a large tail fits under the host limit', () => {
    const lines = Array.from({ length: 200 }, (_, i) => `${i}`.padEnd(1_200, '中'))
    const answer = view([web], null, lines)
    const logs = block(answer.blocks, 'logs')!
    expect(logs.lines.every((line) => line.length === 1_000)).toBe(true)
    expect(logs.lines.at(-1)!.startsWith('199')).toBe(true)
    expect(logs.lines.length).toBeLessThan(200)
    expect(Buffer.byteLength(JSON.stringify(answer))).toBeLessThanOrEqual(480 * 1024)
  })
})
