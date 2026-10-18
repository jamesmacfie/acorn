import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import Ajv from 'ajv'
import { describe, expect, it } from 'vitest'
import {
  deviceResource,
  nodeResource,
  pairingWindowResource,
  pluginResources,
  projectResource,
  taskResource,
  workspaceResource,
} from './projection'

const read = (name: string): unknown =>
  JSON.parse(readFileSync(resolve(import.meta.dirname, '../schemas', name), 'utf8'))
const schema = read('resources-v1.schema.json') as object
const examples = read('resources-v1.examples.json') as Record<string, unknown>[]
const validate = new Ajv({ strict: false }).compile(schema)

describe('versioned resource contract', () => {
  it('keeps golden examples schema-valid', () => {
    for (const example of examples) expect(validate(example), JSON.stringify(validate.errors)).toBe(true)
    const error = read('error-v1.example.json')
    const validateError = new Ajv({ strict: false }).compile(read('error-v1.schema.json') as object)
    expect(validateError(error), JSON.stringify(validateError.errors)).toBe(true)
  })

  it('projects only fields declared by the schema', () => {
    const [node, workspace, project, task, plugin] = examples
    const projected = [
      nodeResource('node-one', { protocolVersion: 1, baseline: 'acorn-1', endpoint: 'https://node-one.test' }),
      workspaceResource('node-one', {
        id: 'workspace-one',
        name: 'Default',
        isDefault: true,
        sort: 0,
        projects: [{ id: 'project-one', name: 'App', sort: 0 }],
      }),
      projectResource('node-one', {
        id: 'project-one',
        name: 'App',
        workspaceId: 'workspace-one',
        path: '/srv/app',
        hidden: false,
        vcs: 'git',
        defaultBranch: 'main',
        remoteUrl: null,
        sort: 0,
        color: null,
        github: null,
      }),
      taskResource('node-one', {
        id: 'task-one',
        projectId: 'project-one',
        title: 'Investigate timeout',
        status: 'active',
        branch: null,
        worktreePath: null,
        parentId: null,
        icon: null,
        origin: 'manual',
        github: null,
        pullNumber: null,
        sort: 0,
        links: [],
      }),
      pluginResources('node-one', {
        plugins: [
          {
            name: 'agents',
            state: 'active',
            running: true,
            disabled: false,
            required: true,
            active: { version: '1.0.0' } as never,
          },
        ],
        restartRequired: false,
        requests: [],
      })[0],
    ]
    expect(projected).toEqual([node, workspace, project, task, plugin])
    for (const resource of projected) expect(validate(resource), JSON.stringify(validate.errors)).toBe(true)
  })

  it('projects a pairing window and a device without token material', () => {
    const example = (kind: string) => examples.find((row) => row.kind === kind)
    const window = pairingWindowResource('node-one', {
      endpoints: ['https://127.0.0.1:4317'],
      identity: 'maple orbit velvet canyon ember lantern',
      code: 'Rk3vQ9mZt2LxWp8sYc4HbA',
      expiresAt: Date.parse('2026-10-18T10:10:00.000Z'),
    })
    const device = deviceResource(
      'node-one',
      {
        id: 'device-one',
        name: 'Standalone node launcher',
        createdAt: Date.parse('2026-10-18T10:00:00.000Z'),
        lastSeenAt: null,
        revokedAt: null,
      },
      'device-one',
    )
    expect(window).toEqual(example('PairingWindow'))
    expect(device).toEqual(example('Device'))
    expect(deviceResource('node-one', { ...device, createdAt: 0, lastSeenAt: 0, revokedAt: 0 }, 'other')).toMatchObject(
      {
        lastSeenAt: '1970-01-01T00:00:00.000Z',
        revokedAt: '1970-01-01T00:00:00.000Z',
        thisTerminal: false,
      },
    )
    for (const resource of [window, device]) expect(validate(resource), JSON.stringify(validate.errors)).toBe(true)
  })
})
